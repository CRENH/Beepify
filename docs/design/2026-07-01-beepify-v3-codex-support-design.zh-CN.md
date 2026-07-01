# Beepify v3 — Codex 支持设计

> 英文版:[`2026-07-01-beepify-v3-codex-support-design.md`](./2026-07-01-beepify-v3-codex-support-design.md)

**状态:** 已批准,可进入计划
**日期:** 2026-07-01
**范围:** 新增 Codex CLI 作为第二个通知源。OpenCode 与 Linux/Windows 桌面 provider 明确顺延至 v4。

## 1. 目标

让 OpenAI **Codex CLI** 通过其 `[hooks]` 生命周期系统触发 Beepify,复用现有
Bark / ntfy / desktop 通道。v3 之后,一份 Beepify 安装即可同时服务 Claude Code
与 Codex,共享同一套 channel 配置。

## 2. 背景 — 为何用 `[hooks]` 而非 `notify`

Codex 对外集成有两种机制:

- **`notify`** — `config.toml` 根键,spawn 一个命令,事件 JSON 走 `argv[1]`。
  它**只**触发 `agent-turn-complete`(一个"完成"信号),无法投递批准 / 等待事件。
- **`[hooks]`** — 生命周期钩子引擎,已 GA 且默认开启,几乎是 Claude Code 钩子模型
  的克隆:**stdin 上一个 JSON 对象**,以 `hook_event_name` 分支,含 `Stop`、
  `PermissionRequest`、`UserPromptSubmit` 等。

Beepify 最有价值的信号是"需批准"。只有 `[hooks]` 能投递它,因此 v3 通过 `[hooks]`
接线 Codex。一个顺带的好处:由于 `[hooks]` 的 JSON 走 **stdin**——与 Claude Code
完全一致——v3 **无需新增 argv 输入层**,现有 `beepify notify` 的 stdin 通路原样复用。

## 3. 事件映射(核心契约)

Codex 钩子载荷经 stdin 到达,按 `hook_event_name` 分派:

| Codex 事件 | 关键字段 | → `NormalizedEvent` |
|---|---|---|
| `Stop` | `last_assistant_message`、`cwd` | `kind: 'done'`,`summary = last_assistant_message` |
| `PermissionRequest` | `tool_name`、`tool_input`(`.command`、`.description`) | `kind: 'needs-approval'`,`action = toolDesc({ name, input })` |
| 其它 | — | `null`(忽略) |

每个产出的事件共有:
`agent: 'codex'`、`project = basename(cwd)`、`host = resolveHost()`、
`ts = Date.now()`、`raw = <载荷>`。

说明:

- **无需解析 transcript。** `Stop` 直接携带 `last_assistant_message`,
  `PermissionRequest` 直接携带 `tool_name` / `tool_input`——比 Claude Code 源
  更简单(后者需从 transcript 重建这些)。
- Codex 上游**没有** `Notification` / idle 事件,因此 Codex 源只产出 `done` 与
  `needs-approval`——最有价值的两种。Codex 无 `waiting-input`。
- `PermissionRequest.tool_input` 映射到现有 `toolDesc({ name, input })` 的
  `input` 位,批准描述走与 Claude Code 相同的渲染路径(`Bash: rm -rf …` 等)。

## 4. 组件

### 4.1 `src/sources/shared.ts`(新增 — 抽取)

把 `resolveHost()` 与 `toolDesc()` 从 `src/sources/claude-code.ts` 抽到共享模块。
`claude-code.ts` 改为 re-import,行为不变。

理由:Codex 源要复用这两个工具。抽取可避免 `codex.ts` 反向依赖 `claude-code.ts`。
这是被新消费者正当触发的定向重构,不是大范围重构。

`toolDesc()` 中 Claude 特有的 `__unparsedToolInput` 恢复逻辑对 Codex 载荷无害
(它们从不携带该字段)——它只读取 `name` + `input`,而 Codex 用 `tool_name` +
`tool_input` 满足之。

### 4.2 `src/sources/codex.ts`(新增)

```ts
import { basename } from 'node:path'
import type { Source, NormalizedEvent, BeepifyConfig } from '../core/types'
import { resolveHost, toolDesc } from './shared'

export const codexSource: Source = {
  name: 'codex',
  parse(raw: unknown, _config?: BeepifyConfig): NormalizedEvent | null {
    const d = (raw ?? {}) as {
      hook_event_name?: string
      cwd?: string
      last_assistant_message?: string
      tool_name?: string
      tool_input?: Record<string, unknown>
    }
    const event = d.hook_event_name
    if (event !== 'Stop' && event !== 'PermissionRequest') return null

    const cwd = d.cwd || process.cwd()
    const base = {
      agent: 'codex' as const,
      host: resolveHost(),
      project: basename(cwd),
      raw,
      ts: Date.now(),
    }

    if (event === 'Stop') {
      return { kind: 'done', summary: d.last_assistant_message || '', ...base }
    }
    // PermissionRequest
    const action = toolDesc({ name: d.tool_name, input: d.tool_input })
    const summary =
      (d.tool_input && typeof d.tool_input.description === 'string' && d.tool_input.description) || ''
    return { kind: 'needs-approval', action, summary, ...base }
  },
}
```

(`NormalizedEvent` 中 `agent` 类型为 `string`;`as const` 仅为示意。)

### 4.3 `src/cli/commands.ts`(修改)

加入 `import { codexSource } from '../sources/codex'` 与
`registerSource(codexSource)`(在 `registerBuiltins()` 内)。`--source codex`
随即经现有 `getSource` 解析,stdin 读取路径不变——`beepify notify --source codex`
无需任何其它 CLI 改动即可工作。

## 5. 接线 — 写入 `~/.codex/config.toml`

Codex 钩子命令为 `beepify notify --source codex`,用与 Claude Code `init` 相同的
二进制路径解析逻辑得出。

### 5.1 托管块(managed block)策略

用户的 `config.toml` 可能含手写内容与注释。与其经 `smol-toml` 全量往返(会重排键、
丢注释),Beepify 采用幂等的**标记块**追加:

```toml
# >>> beepify (managed) >>>
[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "beepify notify --source codex"
[[hooks.PermissionRequest]]
[[hooks.PermissionRequest.hooks]]
type = "command"
command = "beepify notify --source codex"
# <<< beepify (managed) <<<
```

- **幂等合并**(`upsertManagedBlock(existing, block)`):若标记对已存在,替换标记之间
  的内容;否则把块追加到文件末尾。只追加 table(无 root key)在 TOML 中恒合法——
  root key 必须先于所有 table,而现有文件已满足这点。
- **写前备份:** 复制为 `config.toml.beepify-bak.<ts>`(与 v2 的 `config.toml`
  备份同一模式)。
- **用户级路径:** 写入 `~/.codex/config.toml`。repo 级 `.codex/` 钩子在交互会话
  中有已知不触发的 bug(openai/codex #17532),故用户级是可靠目标。

### 5.2 退出码安全(硬约束)

Codex 钩子执行器把 **exit 2 视为"阻断会话"**(拒绝工具、阻断 prompt、强制续turn)。
因此作为 Codex 钩子运行的 Beepify notify 命令**必须始终 exit 0、空 stdout**,即使
通道失败也是如此。这与现有分发设计一致(通道失败从不抛出);该约束写进 `codex.ts`
与 notify 路径的注释,以防回归。分发要控制在钩子 `timeout` 内(默认由 Codex 处理)。

## 6. 命令与向导

### 6.1 `beepify init`(修改)

加 `--agent <claude-code|codex>`,默认 `claude-code` 以向后兼容。`--agent codex`
执行第 5 节的 `config.toml` 接线;`--agent claude-code` 为当前行为不变。

### 6.2 `beepify setup` 向导(修改)

在 channel 采集之后,新增一步:**"要为哪些 coding agent 安装接线?"**——对
`Claude Code` 与 `Codex` 的多选。每选中一个 agent,向导安装其钩子(Claude Code →
`settings.json`;Codex → `~/.codex/config.toml`)。channel 在所有选中 agent 间共享,
用户只需配置一次 Bark/ntfy/desktop,每个 agent 复用。

保留 v2 的编辑模式行为:再次运行 `setup` 时,已有答案作为可编辑默认值展示。

## 7. 测试

遵循现有测试套件约定;无单测 spawn 真实进程。

- **`test/sources/codex.test.ts`**:`Stop` → `done`(summary 取自
  `last_assistant_message`);`PermissionRequest` → `needs-approval`(action 经
  `toolDesc`,如 `Bash: rm -rf /tmp/build`);未知 `hook_event_name` → `null`;
  缺 `cwd` 回退到 `process.cwd()`。
- **`test/sources/shared.test.ts`**:抽取后 `resolveHost` / `toolDesc` 的行为
  (或经现有 claude-code 测试保留覆盖,另加一个薄测试断言共享导出)。
- **接线测试**(`test/cli/codex-wiring.test.ts`):纯函数 `renderCodexHookBlock()`
  的输出;`upsertManagedBlock()` 覆盖三种情形——空文件、含无关内容的文件、已含托管块
  的文件(幂等替换)。
- **向导测试**:扩展脚本化 IO 的 `setup` 测试,覆盖 agent 多选产出正确的接线调用集合。

## 8. 不在本次范围(v4)

- **OpenCode**:通过丢在 `~/.config/opencode/plugins/` 的 TypeScript 插件集成,
  在 `session.idle` / `permission.asked` 时 spawn `beepify notify --source opencode`
  并把事件 JSON 从 stdin 喂入(复用同一 stdin 路径)。无需新传输。
- desktop 通道的 **Linux / Windows provider**。

此处列出仅为确认 v3 架构为其预留了空间;v3 无代码指向它们。
