# Beepify v2 设计 —— 桌面通知 + 交互式配置向导

日期:2026-07-01
状态:设计已认可,待写实现计划
目标版本:`@elbc/beepify@0.2.0`

## 1. 目标与范围

Beepify v1 把 Claude Code 的 hook 事件路由到移动端推送通道(Bark、ntfy)。
v2 在本机层面扩展**覆盖面**与**易用性**:

1. 新增 **`desktop` channel** —— macOS 原生通知,外加一个 **Open Island**
   provider,用于驱动用户已有的灵动岛 app。
2. 新增 **`beepify setup`** 交互式向导,用于**编辑**配置(而非仅仅脚手架生成),
   降低配置 channel 与 hook 的门槛。

### 不在范围内(推迟到 v3)

- `codex` / `opencode` 源(多 agent 支持)。
- Linux(`notify-send`)/ Windows(PowerShell toast)桌面 provider —— v2 只搭好
  **provider 抽象口子**,不落地任何非 macOS 后端。
- 点击动作、内联回复,或任何双向交互(Beepify 是单向的)。
- 安装 Open Island app 本体(第三方 GUI —— 只检测与链接)。

## 2. 背景:当前架构

- **Source** 插件:`parse(raw, config) → NormalizedEvent | null`,由 `--source`
  选择,从注册表解析。目前只有 `claude-code`。
- **Channel** 插件:`send(msg: RenderedMessage, cfg) → ChannelResult`,`config.toml`
  中每个 `[[channels]]` 对应一个,从注册表解析。现有 `bark`、`ntfy`。
- **Dispatch**:事件渲染一次(`render()` → `{title, body, group, icon}`),
  **扇出到每一个已配置的 channel**;各 `ChannelResult` 相互独立,单个 channel
  失败绝不会抛给 agent。
- **`beepify init`**:非交互、幂等的脚手架 —— 复制 `config.example.toml` 并把
  Claude Code hook 装进 `settings.json`。

Open Island 的 hook(`~/.local/bin/open-island-hooks.py`)从 **stdin 读取一份
Claude Code 形状的 hook JSON**(`--source claude`),再通过 Unix socket
(`OPEN_ISLAND_SOCKET_PATH` / `VIBE_ISLAND_SOCKET_PATH`)转发给常驻 app。正是这一
形状让 Beepify → Open Island 的 provider 变得廉价:往它的 stdin 喂一份 payload 即可。

## 3. desktop channel

新建目录 `src/channels/desktop/`,把 channel 与各 provider 拆开,使每个 provider
可独立理解、独立测试。

### 3.1 配置 schema

```toml
[[channels]]
type = "desktop"
provider = "native"          # "native"(默认) | "open-island"
sound = ""                   # 可选;仅 native
open_island_command = ""     # 可选;open-island-hooks.py 路径。留空则自动探测
```

- **`provider`** —— 用户面取值精确为两个:`native`(默认)与 `open-island`。
  内部 `native` 按可用性解析后端(macOS:`PATH` 上有 `terminal-notifier` 就用它,
  否则 `osascript`)。`auto`、`osascript`、`terminal-notifier` 也作为高级别名被接受,
  但向导不暴露。
- desktop 与 bark/ntfy 是**平级 channel**:配置里可任意混搭;同一事件扇出到全部。
  移动端与桌面之间无耦合。

### 3.2 provider 抽象(为 Linux/Windows 留口子)

```
desktop channel (src/channels/desktop/index.ts)
  ── selectProvider(providerName, platform, probe) → DesktopProvider
       DesktopProvider 注册表:
         osascript          (macOS,零依赖)         ← v2
         terminal-notifier  (macOS,检测到才用)      ← v2
         open-island        (驱动灵动岛)            ← v2
         notify-send        (Linux)                ← 将来,纯新增
         powershell-toast   (Windows)              ← 将来,纯新增
```

- `DesktopProvider = (msg: RenderedMessage, cfg: ChannelConfig) => Promise<{ ok: boolean; error?: string }>`。
- `desktop` channel 本身只消费现有 `render()` 产出(`title` / `body` / `group` /
  `icon`)并委派。将来加非 macOS 后端 = 新增 provider 文件 + 注册表条目;
  **channel、config schema、render 逻辑一律不动。**
- `probe(bin)`(类 `which` 的可用性探测)是**注入的**,因此 provider 选择无需触碰
  真实 `PATH` 即可单测。

### 3.3 v2 交付的 provider

| Provider | 机制 | 说明 |
|---|---|---|
| `osascript` | `execFile('osascript', ['-e', 'display notification "<body>" with title "<title>" [sound name "<sound>"]'])` | **`execFile` + 参数数组**(不走 shell)。转义插值文本中的 `"` 与 `\`。 |
| `terminal-notifier` | `execFile('terminal-notifier', ['-title', title, '-message', body, '-group', group, ...])` | 当 `provider=terminal-notifier`、或 `native`+检测到时选用。更丰富(group/icon)。 |
| `open-island` | `spawn(cmd, ['--source', 'claude'])`,把一份 **Claude Code 形状的 hook JSON** 写入子进程 stdin | 对 `claude-code` 源,原样透传 `event.raw`。命令缺失 / 非零退出 → `{ ok: false, error }`,绝不抛错。 |

对 `open-island` provider,当来源事件缺少原生 Claude payload(将来的非 Claude 源)时,
合成一份最小的 `{ hook_event_name, cwd, message }`。v2 只有 `claude-code`,故透传
`event.raw` 是主路径。

### 3.4 错误处理

与 bark/ntfy 一致:provider 失败(二进制缺失、非零退出、spawn 出错)时返回
`{ ok: false, error }`。channel 绝不抛错;dispatch 把失败的 `ChannelResult` 与成功的
并列记录。

## 4. `beepify setup` —— 交互式、可编辑的向导

新建 `src/cli/setup.ts`。**纯核心与终端 IO 解耦**,使配置逻辑可单测,readline 层保持薄壳。

### 4.1 行为

1. **加载现有配置**(若 `config.toml` 存在)并展示。每个问题以当前值作默认(回车保留)。
   这是**编辑器**,不是覆盖:首次运行(无配置)用空默认。
2. **语言** —— `en` / `zh-CN`,默认 = 当前。
3. **Channel** —— 以列表呈现,可**保留 / 修改 / 删除 / 新增**:
   - `bark` → key、server、icon
   - `ntfy` → topic、server
   - `desktop` → provider 选择展示为 **系统原生通知(native)**〔默认〕/
     **Open Island(推荐,需另外安装)**。
     - 选 `open-island` 时:**探测**是否已装 Open Island(查 `PATH` 上的
       `open-island-hooks.py` / `OPEN_ISLAND_SOCKET_PATH`)。找到则自动填入
       `open_island_command` 并确认。未找到则打印安装引导,但**仍允许把该 channel
       加上**(延迟生效)—— 不假装已装好。
4. **`notify_idle`** —— 是/否,默认 = 当前(否则 `false`)。
5. **写入** `config.toml`。若已存在,写入前**先备份**(`.beepify-bak.<ts>`)。
6. **装 hook** —— 询问;复用 `runInit` 的 hook 安装器。
7. **测试推送** —— 复用 `runTest`;打印每个 channel 的 `ok` / `skipped` / `FAIL`,
   当场闭合验证回路。

`beepify init` **保持不变** —— 它仍是非交互、可脚本化的路径。

### 4.2 为可测性而设计的结构

- `renderConfigToml(answers): string` —— 纯函数;针对每种 channel 类型、语言、
  `notify_idle` 单测。
- 答案校验 / 归一化 —— 纯 helper,单测。
- `detectOpenIsland(probe, env): { installed: boolean; command?: string }` —— 给定
  注入的 `probe` 与 `env` 后为纯函数。
- readline 循环是上述之上的薄壳,用脚本化 stdin(或注入的 prompt 函数)做冒烟测试。

## 5. 文档

- `config.example.toml` —— 补一段带注释的 `[[channels]] type = "desktop"`。
- `README.md` / `README.zh-CN.md` —— 记录 desktop channel(两种 provider)与
  `beepify setup`。

## 6. 测试策略(TDD,逐任务,任务间两段式 review)

- **desktop 选择**:`selectProvider` 用注入的 `probe` 解析 `native`
  (有 terminal-notifier → 选它;没有 → osascript);显式 provider 名被尊重;
  未知 provider → 错误结果。
- **osascript**:断言 `execFile` argv 构造与 `"` / `\` 的转义。
- **terminal-notifier**:断言 argv 含 title/message/group。
- **open-island**:断言子进程收到预期的 stdin payload(`event.raw` 透传);
  命令缺失 → `{ ok: false }`。
- **向导**:`renderConfigToml` 纯测(bark、ntfy、desktop×2 provider、语言、
  notify_idle);`detectOpenIsland` 找到/未找到;readline 薄壳冒烟。

## 7. 交付

合并并发布 `@elbc/beepify@0.2.0` 后:用户可新增 `desktop` channel,并可选把
Open Island 收编进 Beepify(一个 hook 同时驱动手机 + 灵动岛)。不强制任何改动;
现有配置照常工作。

## 8. 非目标 / YAGNI 复述

- 暂无 Linux/Windows provider —— 仅留口子。
- 不安装 Open Island app —— 仅检测与链接。
- 无点击动作、回复或 GUI。
- 不改动 `beepify init`、Source 抽象或现有 channel。
