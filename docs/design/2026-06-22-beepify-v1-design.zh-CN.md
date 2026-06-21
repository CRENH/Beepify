# Beepify v1 — 设计规格(中文版)

> 本文是英文版 `2026-06-22-beepify-v1-design.md` 的中文对照版本,供审核方便。
> 仓库以英文为主语言;若两版有出入,**以英文版为准**。

- **状态:** 设计已批准,待实现计划
- **日期:** 2026-06-22
- **范围:** v1 —— 单向通知、Claude Code 源、Bark + ntfy channel、CLI 交付物

---

## 1. 概览

Beepify 把 AI 编码 agent 的**状态事件**翻译成人一眼能懂的通知(回答"我现在能不能走开")。它本质是一个**单向事件路由器**:左边进各种 agent 特有的事件,经归一化与分类,右边 fan-out 到一个或多个推送 channel。

v1 是一个刻意更大愿景的第一块 dogfooding 切片。它交付能跑通的最小端到端路径,同时验证插件架构,并为后续(v2+)留好干净接缝。

### 目标(v1)

- 用一个真正模块化、可开源的工具,取代作者临时的 `notify-phone.sh`。
- 在作者本机产生价值:Claude Code → 手机推送(Bark + ntfy)。
- 通过上线**两个 API 形状不同**的 channel(Bark = URL 路径;ntfy = JSON 发布)来验证 **Source / Channel** 插件抽象。
- 让核心保持**纯库**,使未来的 daemon / HTTP 入口成为纯增量。

### 非目标(v1,留给 v2+)

- 不做 daemon / HTTP 入口(仅 CLI 入口)。
- 不做双向"手机点批准"(无隧道 / Transport 层)。
- 不做跨多机的中央聚合。
- 仅实现一个 source(`claude-code`);仅两个 channel(`bark`、`ntfy`)。
- 不产出 `error` 类型(Claude Code 未提供用量超限 / 系统异常的 hook)。

### 头脑风暴中已锁定的决策

| 决策 | 选择 |
|---|---|
| 名字 | **Beepify**(npm `beepify`)|
| v1 表面 | 仅单向通知 |
| 技术栈 | Node / TypeScript(ESM)|
| v1 channel | Bark + ntfy |
| 运行形态 | **CLI 交付物 + 核心即库架构**(daemon 延后,日后作为新入口加入,不破坏 v1)|
| License | MIT |
| 文档语言 | 英文为主;`README.zh-CN.md` 作为第二语言 |

---

## 2. 架构

一条单向管线,两端可插拔,中间是与具体 agent 无关的核心。

```
  入口(ingress)         核心 core(纯库,稳定 API)                出口 channels
┌──────────────┐   ┌──────────────────────────────────────────┐   ┌──────────┐
│ CLI          │   │  Source.parse(raw) → NormalizedEvent       │   │ bark     │
│ `beepify     │──▶│        → 分类(在 source 内)                │──▶│ ntfy     │
│  notify`     │   │        → 渲染(模板 + flat)                 │   │ (更多…)  │
│ (stdin JSON) │   │        → 去抖 → dispatch(fan-out)          │   └──────────┘
└──────────────┘   └──────────────────────────────────────────┘
 [v2: HTTP/daemon 入口 —— 增量;调用同一个 dispatch()]
```

### 各层职责

| 层 | 干什么 | 不知道什么 |
|---|---|---|
| **入口 ingress** | 把外界输入(v1 = hook 的 stdin JSON)交给核心。薄。 | 不知道事件含义;不知道往哪推 |
| **核心 core** | `parse → NormalizedEvent → render → debounce → dispatch`。灵魂所在。一个**纯库**,可被 CLI、未来 daemon、测试直接调用。 | 不知道自己被 CLI 还是 daemon 调用;不认识任何 channel 的 API |
| **出口 channels** | 拿渲染好的 `{title, body}`,按各自协议发出去。 | 不知道事件怎么来的、怎么分类的 |

### 关键不变量

- `dispatch(event: NormalizedEvent, config): Promise<ChannelResult[]>` 是核心**唯一的主入口**。CLI 只是"读 stdin → 调 dispatch";未来 daemon 是"收 HTTP → 调 dispatch"。**加 daemon = 加一个入口,核心与 channel 不动。**
- **Source** 与 **Channel** 都是注册制插件(`name` + 接口)。核心只跟接口打交道。加 Cursor = 新 source;加 OpenIsland/Windows = 新 channel。
- 一次事件可 **fan-out 到多个 channel**;channel 并行执行,单个失败不影响其它。

### 为何"CLI 交付 + 库架构"能面向未来

疑虑:现在选 CLI,以后做远程 / 多 agent 会不会很贵?不会,因为:

- **远程单向通知用 CLI 模式现在就能跑。** 推送目标(Bark / ntfy)是**云**服务。agent 跑在任何能出网的机器上,本地执行 `beepify notify`,推送即达手机。**不需要 daemon。**
- **多 agent 由 Source 层负责**,与 CLI/daemon 正交。v1 实现 `claude-code`,其它作为 source 插件加入。
- daemon 仅在**中央聚合**或**双向**流程时才需要 —— 二者都是 v2 —— 届时作为同一个 `dispatch()` 前面的新入口加入。

---

## 3. 核心数据模型与分类

核心流转两个结构。

### NormalizedEvent(Source 产出 → 核心输入)

```ts
type EventKind = 'done' | 'needs-approval' | 'waiting-input' | 'error'

interface NormalizedEvent {
  kind: EventKind
  agent: string      // 'claude-code'
  host: string       // ComputerName,如 SIRC-MBP2015
  project: string    // basename(cwd)
  summary?: string   // agent 最后回复正文
  action?: string    // 待执行工具/动作描述(needs-approval 用)
  raw?: unknown      // 原始 hook JSON,供调试 / 未来 channel
  ts: number
}
```

### RenderedMessage(核心渲染输出 → channel 输入)

```ts
interface RenderedMessage {
  title: string
  body: string
  group?: string
  icon?: string
  event: NormalizedEvent   // 透传;channel 想要更细节可取
}
```

### 分类归属

「raw → kind」是 **agent 特有语义**,故放在 **Source** 内(Claude Code 的 Stop/Notification 映射只对 Claude Code 成立)。核心只做与 agent 无关的渲染 / 去抖 / 分发。

### claude-code source 分类规则

| hook 事件 | 条件 | → kind | body 取 |
|---|---|---|---|
| `Stop` | — | `done` | `summary`,回退「`<project>` 已结束本轮」|
| `Notification` | 有待执行工具 | `needs-approval` | `action`(结构化提取,见 §5)|
| `Notification` | 无工具 | `waiting-input` | `summary`,回退 hook `message` |

### 渲染(核心)

按 `kind` 套标题模板。模板集由 `locale` 配置选定。**v1 内置两套:`en`(默认)与 `zh-CN`**;模板抽离,后续加语言很容易。`en` 示例:

- `done` → `✅ Done · {host}`
- `needs-approval` → `🔔 Needs approval · {host}`
- `waiting-input` → `💬 Waiting for you · {host}`
- `error` → `⚠️ Error · {host}`(保留;v1 无产出者)

`zh-CN` 套对应作者现有推送(`✅ 任务完成 · {host}`、`🔔 需要授权 · {host}`、`💬 在等你回复 · {host}`、`⚠️ 错误 · {host}`),使 dogfood 保留中文标题。

随后按表选 `body`,再过 `flat()`:把所有空白(含换行)合并为单空格,截取前 300 字(超出补 `…`)。

### 去抖(核心)

按 `kind`、N 秒,用 stamp 文件。默认 `debounce_seconds = 20`。

### `error` 类型

枚举里保留以便前向兼容,但 **v1 的 `claude-code` source 不会产出** —— Claude Code 没有用量超限 / 系统异常的 hook。待有能感知错误的 source / 机制再接。

---

## 4. 插件接口与 v1 实现

### 接口

```ts
interface Source {
  name: string
  // 解析 hook 原始 JSON。返回 null = 跳过(如纯 tool_result、不关心的事件)。
  parse(raw: unknown): NormalizedEvent | null
}

interface Channel {
  name: string
  send(msg: RenderedMessage, cfg: ChannelConfig): Promise<ChannelResult>
}

interface ChannelResult {
  channel: string
  ok: boolean
  skipped?: boolean   // 未配置 → 跳过,而非失败
  error?: string
}
```

### 注册制 + dispatch fan-out

```
dispatch(event, config):
  msg = render(event, config)                 // 模板 + flat()
  if debounced(event.kind): return [{ skipped: true }]
  enabled = config.channels ∩ registry         // 已注册且已配置
  return Promise.allSettled(enabled.map(ch => ch.send(msg, cfg)))   // 并行
```

- 未配置的 channel → `skipped`,不是 `error`(区分"没开"与"发失败")。
- `allSettled` 保证 Bark 挂了 ntfy 照发。

### v1 实现

**`claude-code` source** —— 把现有 shell 逻辑搬进 TS:

- 读 `{ hook_event_name, cwd, transcript_path, message }`。
- `host` 走 `scutil --get ComputerName`(子进程),带 `HOST_LABEL` 覆盖与 `LocalHostName` / `hostname -s` 回退。
- 读 transcript JSONL,取 last assistant 文本(`summary`)与最后一个待执行工具,经 `tool_desc` 构造 `action`。
- `tool_desc` 处理结构化工具,使不同提问产生不同正文:
  - `AskUserQuestion` → 拼接每问的 `header: question`(否则两条通知都塌缩成工具名)。
  - `ExitPlanMode` → 方案正文。
  - 通用工具 → 在 `command, file_path, path, url, query, pattern, plan, description, prompt` 里取第一个非空字符串字段;最终回退 = 任意非空字符串字段,再不行就工具名。
- 按 §3 的表分类 → `NormalizedEvent`。

**`bark` channel** —— URL 路径 API:

- `${server}/${key}/${enc(title)}/${enc(body)}?group=Beepify&icon=…`
- **关键不变量:** `title` 与 `body` 全量百分号编码,**连 `/` 也编码**(`encodeURIComponent`)。正文里未编码的斜杠会冲掉 Bark 的 `/key/title/body` 路径结构,导致推送被静默丢弃。此点锁为单元测试不变量,永不回归。

**`ntfy` channel** —— 对 shell 版的改进:

- 用 ntfy 的 **JSON 发布端点**(`POST ${server}`,body `{ topic, title, message }`),而非 `Title:` header。ntfy header 对非 ASCII 不友好,中文标题走 header 会乱;JSON 发布能稳定承载 Unicode 标题。

### 共用工具

`core/http`:`enc()`(全量百分号编码)、retry(超时 + 弱网重试,沿用现有 `--retry`)、请求超时。所有 channel 复用。基于 Node 18 内置 `fetch`(无 HTTP 依赖)。

---

## 5. CLI 表面、配置与密钥

### CLI 命令(刻意极简)

| 命令 | 作用 |
|---|---|
| `beepify notify --source claude-code` | **hook 入口**:读 stdin JSON → dispatch。settings.json 挂的就是它。 |
| `beepify init` | 一键配置:生成配置 + 把 hook 装进 Claude Code 的 settings.json。 |
| `beepify test` | 发各类型(done / needs-approval / waiting-input)样例推送,验证 channel。 |
| `beepify doctor` | 自检:配置在不在?channel 可达?hook 装没装?(密钥脱敏)|

### 配置与密钥

- 位置:`~/.config/beepify/config.toml`(在仓库之外 → 不进 git;权限 `0600`)。
- 格式:**TOML**(可注释,无 YAML 缩进坑)。OSS 仓库只发 `config.example.toml`。
- `BEEPIFY_*` 环境变量覆盖文件值(如 `BARK_KEY`),给用密钥管理器、不想落盘的用户。

```toml
debounce_seconds = 20
host_label = ""              # 空 = 自动 ComputerName
locale = "en"                # "en"(默认)| "zh-CN"

[[channels]]
type   = "bark"
key    = "..."
server = "https://api.day.app"
icon   = "https://..."

[[channels]]
type   = "ntfy"
topic  = "..."
server = "https://ntfy.sh"
```

### `beepify init` 改 settings.json —— 安全红线

这是最敏感的操作(改用户的 Claude Code 配置):

- **合并,绝不覆盖** —— 任何已有 hook(如作者的 `open-island-hooks.py`)原样保留,Beepify 追加在旁边。
- **幂等** —— 已存在则不重复加。
- 改前对 settings.json 做**时间戳备份**。
- **可逆** —— `beepify init --uninstall` 撤回。

### 分发

`npx beepify`(免装)或 `npm i -g beepify`。hook 触发频繁,全局装(`beepify`)比 `npx` 快;`init` 检测到没全局装就提示安装。

### 与现有资产共存

v1 让 **Beepify 接管手机推送(Bark / ntfy)**,而作者的 `open-island-hooks.py`(macOS 灵动岛展示)**不动**。待 Beepify 验证稳定后,再退役旧的 `notify-phone.sh` —— 使在用链路在 dogfood 期间不被破坏。

---

## 6. 项目结构、构建与测试

单 npm 包,内部模块化(v1 不上 monorepo —— 暂无需独立发布的子包;日后真要拆 `@beepify/core` 再说)。

```
beepify/
├─ src/
│  ├─ core/        types.ts · dispatch.ts · render.ts · debounce.ts
│  │              · http.ts(enc/retry/timeout)· registry.ts
│  ├─ sources/    claude-code.ts(hook 解析 + transcript + tool_desc + 分类)
│  ├─ channels/   bark.ts · ntfy.ts
│  ├─ config/     load.ts(TOML + env 覆盖)· settings-json.ts(合并/幂等/备份/卸载)
│  └─ cli/        index.ts(notify / init / test / doctor)
├─ test/          (vitest)
├─ config.example.toml · package.json · tsconfig.json
├─ README.md · README.zh-CN.md · LICENSE(MIT)
└─ docs/design/ · docs/plans/   ← 设计 spec 与实现计划
```

### 技术选型(刻意压依赖)

- TypeScript + ESM,**Node ≥ 18**:用内置 `fetch`(HTTP 零依赖);CLI 解析用内置 `util.parseArgs`(不引 commander)。
- 运行依赖基本只剩一个 **TOML 解析器**(`smol-toml`)。
- 构建 **tsup**(打出带 shebang 的单文件 CLI;`package.json` `bin: beepify`)。
- 包管理:**npm**(贡献者门槛最低)。

### 测试(vitest —— 核心路径全覆盖)

- `render`/`flat`:300 字截断 + 抹换行。
- **bark 斜杠转义不变量**(防回归)。
- ntfy JSON 发布体结构。
- claude-code 分类表(Stop→done;Notification+工具→needs-approval;AskUserQuestion / ExitPlanMode 提取)。
- 去抖。
- settings-json 合并:幂等且保留已有的(open-island)hook。
- channel 的网络发送 mock 掉。

### 仓库卫生

GitHub Actions 跑 lint + test + build。遵循 PR 工作流:feature 分支 → PR → 人工 merge;绝不直推 `main`。文档英文为主,附 `README.zh-CN.md` 第二语言版本。

---

## 7. 路线图(v2+ —— 预留接缝,均为增量)

- **更多 channel:** OpenIsland(macOS)、Telegram、webhook、Windows toast。
- **更多 source:** Cursor、Aider、Codex CLI、通用 CLI 退出码包装。
- **daemon / HTTP 入口:** 跨多 agent / 多机的中央聚合。
- **双向:** 手机点批准打回 agent(Tailscale / Cloudflare Tunnel —— Transport 层)。
- **i18n:** 更多语言 / 消息 catalog 系统(v1 已内置 `en` + `zh-CN` 模板)。
