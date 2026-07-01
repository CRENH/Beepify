# Beepify v3 — Codex 支持实施计划

> **面向 agent 执行者:** 必需子技能:用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务实施本计划。步骤用复选框(`- [ ]`)语法追踪。
>
> 英文版:[`2026-07-02-beepify-v3-codex-support.md`](./2026-07-02-beepify-v3-codex-support.md)
> 设计 spec:[`../design/2026-07-01-beepify-v3-codex-support-design.zh-CN.md`](../design/2026-07-01-beepify-v3-codex-support-design.zh-CN.md)

**目标:** 新增 `--source codex`,让 OpenAI Codex CLI 通过其 `[hooks]` 生命周期系统触发 Beepify,复用现有 Bark / ntfy / desktop 通道。

**架构:** Codex `[hooks]` 在 stdin 投递一个 JSON 对象,以 `hook_event_name` 分支——与 Claude Code 同构,故现有 `beepify notify` 的 stdin 路径原样复用,无需新增 argv 层。新增 `codex` 源解析 `Stop` → done、`PermissionRequest` → needs-approval。接线以幂等托管块追加到 `~/.codex/config.toml`。`init` 命令新增 `--agent`,`setup` 向导新增 agent 多选。

**技术栈:** TypeScript / ESM(NodeNext)、Node ≥18、vitest、tsup、smol-toml(唯一运行时依赖;提供 `parse` + `stringify`)。

## 全局约束

- 运行时依赖仅限 `smol-toml`,不新增运行时依赖。
- 无单测 spawn 真实进程。
- 作为 Codex 钩子运行的 Beepify 命令**必须始终 exit 0、空 stdout**——Codex 把 exit 2 视为"阻断会话"。现有 dispatch 从不抛出;codex 路径保持这一性质。
- Codex 钩子写入**用户级** `~/.codex/config.toml`(repo 级 `.codex/` 有已知不触发 bug,openai/codex #17532)。
- 托管块标记严格为 `# >>> beepify (managed) >>>` 与 `# <<< beepify (managed) <<<`。
- Codex 钩子命令字符串严格为 `beepify notify --source codex`(裸 `beepify`,与 Claude Code 的 `HOOK_COMMAND` 约定一致)。
- 向后兼容:`beepify init` 无参数时仍完全按原样安装 Claude Code 钩子。

---

## 文件结构

- **新建 `src/sources/shared.ts`** — 从 `claude-code.ts` 抽出 `resolveHost()` 与 `toolDesc()`(及其私有助手),供两个源共享而无反向依赖。
- **改 `src/sources/claude-code.ts`** — 从 `./shared` 导入这两个助手,并 re-export 以向后兼容。
- **新建 `src/sources/codex.ts`** — `codexSource` 解析器。
- **改 `src/cli/commands.ts`** — 注册 `codexSource`;抽出 `ensureBeepifyConfig()`;新增 `runInitCodex()`。
- **新建 `src/config/codex-toml.ts`** — 托管块 render/upsert/remove + `installCodexHook` / `uninstallCodexHook`。
- **改 `src/cli/setup-core.ts`** — `AgentName`、`normalizeAgents()`、`SetupAnswers.agents`。
- **改 `src/cli/setup.ts`** — 询问 agent 多选。
- **改 `src/cli/index.ts`** — `init --agent`、向导按 `answers.agents` 行动、VERSION 升级。
- **改** `package.json`、`README.md`、`README.zh-CN.md`、`config.example.toml`。

---

## 任务 1:抽取共享源助手

**文件:**
- 新建:`src/sources/shared.ts`
- 改:`src/sources/claude-code.ts`(移除被搬走的定义;导入 + re-export)
- 测试:`test/sources/shared.test.ts`

**接口:**
- 产出:`resolveHost(env?: NodeJS.ProcessEnv): string`、`toolDesc(b: unknown): string`——均从 `src/sources/shared.ts` 导出。
- `claude-code.ts` 继续导出 `toolDesc` 与 `resolveHost`(re-export),使 `test/sources/claude-code.test.ts` 仍能编译。

- [ ] **步骤 1:写失败测试**

新建 `test/sources/shared.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toolDesc, resolveHost } from '../../src/sources/shared'

describe('shared source helpers', () => {
  it('toolDesc surfaces a tool command', () => {
    expect(toolDesc({ name: 'Bash', input: { command: 'ls -la' } })).toBe('Bash: ls -la')
  })
  it('resolveHost honours the HOST_LABEL env override', () => {
    expect(resolveHost({ HOST_LABEL: 'my-mac' } as NodeJS.ProcessEnv)).toBe('my-mac')
  })
})
```

- [ ] **步骤 2:运行测试确认失败**

运行:`npx vitest run test/sources/shared.test.ts`
预期:FAIL——找不到模块 `../../src/sources/shared`。

- [ ] **步骤 3:创建 `src/sources/shared.ts`(搬入代码)**

把以下内容逐字从 `claude-code.ts` 搬到新建的 `src/sources/shared.ts`:`STRING_KEYS`、`RECOVER_KEYS`、`firstFieldFromRaw`、`toolDesc`、`resolveHost`。`execFileSync` 的 import 留在此文件(`resolveHost` 需要)。

```ts
import { execFileSync } from 'node:child_process'

const STRING_KEYS = ['command', 'file_path', 'path', 'url', 'query', 'pattern', 'plan', 'description', 'prompt']

// Fields worth surfacing when recovering a best-effort snippet from an unparsed
// raw tool input. 'question' is first so AskUserQuestion shows the prompt text.
const RECOVER_KEYS = ['question', 'command', 'prompt', 'plan', 'description', 'query', 'path', 'url', 'file_path', 'pattern', 'header']

function firstFieldFromRaw(raw: string): string {
  for (const k of RECOVER_KEYS) {
    const m = raw.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
    if (m && m[1].trim()) return m[1].replace(/\\"/g, '"').trim()
  }
  return ''
}

export function toolDesc(b: unknown): string {
  const block = (b ?? {}) as { name?: string; input?: Record<string, unknown> }
  const name = block.name || 'tool'
  let inp = block.input || {}

  const unparsed = inp.__unparsedToolInput as { raw?: unknown } | undefined
  if (unparsed && typeof unparsed.raw === 'string') {
    try {
      const parsed = JSON.parse(unparsed.raw)
      if (parsed && typeof parsed === 'object') inp = parsed as Record<string, unknown>
    } catch {
      const snippet = firstFieldFromRaw(unparsed.raw)
      if (snippet) return `${name}: ${snippet}`
    }
  }

  if (name === 'AskUserQuestion') {
    const qs = inp.questions
    if (Array.isArray(qs) && qs.length) {
      const parts: string[] = []
      for (const q of qs) {
        if (!q || typeof q !== 'object') continue
        const qq = q as { header?: unknown; question?: unknown }
        const h = String(qq.header ?? '').trim()
        const qt = String(qq.question ?? '').trim()
        const seg = h && qt ? `${h}: ${qt}` : qt || h
        if (seg) parts.push(seg)
      }
      if (parts.length) return `${name}: ${parts.join(' / ')}`
    }
    return name
  }

  if (name === 'ExitPlanMode') {
    const plan = inp.plan
    if (typeof plan === 'string' && plan.trim()) return `${name}: ${plan.trim()}`
    return name
  }

  for (const k of STRING_KEYS) {
    const v = inp[k]
    if (typeof v === 'string' && v.trim()) return `${name}: ${v}`
  }
  for (const k of Object.keys(inp)) {
    const v = inp[k]
    if (typeof v === 'string' && v.trim()) return `${name}: ${v}`
  }
  return name
}

export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HOST_LABEL) return env.HOST_LABEL
  for (const args of [['--get', 'ComputerName'], ['--get', 'LocalHostName']]) {
    try {
      const out = execFileSync('scutil', args, { encoding: 'utf8' }).trim()
      if (out) return out
    } catch {
      // ignore — not macOS or scutil unavailable
    }
  }
  try {
    return execFileSync('hostname', ['-s'], { encoding: 'utf8' }).trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}
```

- [ ] **步骤 4:改 `claude-code.ts` 为导入 + re-export**

在 `src/sources/claude-code.ts`:删除被搬走的定义(`STRING_KEYS`、`RECOVER_KEYS`、`firstFieldFromRaw`、`toolDesc`、`resolveHost`)以及此时已无用的 `execFileSync` import。在文件顶部加:

```ts
import { resolveHost, toolDesc } from './shared'
// re-export for back-compat with existing importers/tests
export { toolDesc, resolveHost } from './shared'
```

`claude-code.ts` 其余代码(`readFileSync`、`basename` 的 import、`parseTranscript`、`claudeCodeSource`)保持不变——`parseTranscript` 仍调用现已导入的 `toolDesc`,`claudeCodeSource` 仍调用现已导入的 `resolveHost`。

- [ ] **步骤 5:运行完整套件确认无回归**

运行:`npx vitest run test/sources/shared.test.ts test/sources/claude-code.test.ts`
预期:PASS(新 shared 测试 + 全部现有 claude-code 测试通过)。

- [ ] **步骤 6:提交**

```bash
git add src/sources/shared.ts src/sources/claude-code.ts test/sources/shared.test.ts
git commit -m "refactor: extract resolveHost/toolDesc into sources/shared"
```

---

## 任务 2:Codex 源解析器 + 注册

**文件:**
- 新建:`src/sources/codex.ts`
- 改:`src/cli/commands.ts`(注册源)
- 测试:`test/sources/codex.test.ts`

**接口:**
- 消费:`src/sources/shared.ts` 的 `resolveHost`、`toolDesc`;`src/core/types` 的 `Source`、`NormalizedEvent`、`BeepifyConfig`。
- 产出:`export const codexSource: Source`(name `'codex'`)。在 `registerBuiltins()` 内注册,使 `getSource('codex')` 可解析,`beepify notify --source codex` 无需 CLI 改动即可工作。

- [ ] **步骤 1:写失败测试**

新建 `test/sources/codex.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { basename } from 'node:path'
import { codexSource } from '../../src/sources/codex'
import { getSource, clearRegistry } from '../../src/core/registry'
import { registerBuiltins } from '../../src/cli/commands'

describe('codexSource.parse', () => {
  it('maps Stop to a done event carrying the last assistant message', () => {
    const e = codexSource.parse({ hook_event_name: 'Stop', cwd: '/home/u/proj', last_assistant_message: 'All done.' })
    expect(e).toMatchObject({ kind: 'done', agent: 'codex', project: 'proj', summary: 'All done.' })
  })
  it('maps PermissionRequest to needs-approval with a tool action and description summary', () => {
    const e = codexSource.parse({
      hook_event_name: 'PermissionRequest', cwd: '/home/u/proj',
      tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/build', description: 'clean build' },
    })
    expect(e).toMatchObject({
      kind: 'needs-approval', agent: 'codex', project: 'proj',
      action: 'Bash: rm -rf /tmp/build', summary: 'clean build',
    })
  })
  it('returns null for events it does not handle', () => {
    expect(codexSource.parse({ hook_event_name: 'SessionStart' })).toBeNull()
  })
  it('falls back to process.cwd() when cwd is missing', () => {
    const e = codexSource.parse({ hook_event_name: 'Stop', last_assistant_message: 'x' })
    expect(e?.project).toBe(basename(process.cwd()))
  })
})

describe('registerBuiltins', () => {
  it('registers the codex source', () => {
    clearRegistry()
    registerBuiltins()
    expect(getSource('codex')).toBe(codexSource)
  })
})
```

- [ ] **步骤 2:运行测试确认失败**

运行:`npx vitest run test/sources/codex.test.ts`
预期:FAIL——找不到模块 `../../src/sources/codex`。

- [ ] **步骤 3:创建 `src/sources/codex.ts`**

```ts
import { basename } from 'node:path'
import type { Source, NormalizedEvent, BeepifyConfig } from '../core/types'
import { resolveHost, toolDesc } from './shared'

// Codex delivers hooks as JSON on stdin, keyed on hook_event_name — the same
// envelope as Claude Code. We surface only the two highest-value kinds:
//   Stop              -> done          (last_assistant_message)
//   PermissionRequest -> needs-approval (tool_name + tool_input)
// Codex has no idle/Notification event, so there is no waiting-input kind.
//
// A Beepify command run as a Codex hook must always exit 0 (Codex treats exit 2
// as "block the session"). This parser only maps data; the CLI notify path is
// already crash-safe and never exits non-zero.
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
      agent: 'codex',
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
      d.tool_input && typeof d.tool_input.description === 'string' ? d.tool_input.description : ''
    return { kind: 'needs-approval', action, summary, ...base }
  },
}
```

- [ ] **步骤 4:在 `commands.ts` 注册源**

在 `src/cli/commands.ts`,于其它源 import 附近加:

```ts
import { codexSource } from '../sources/codex'
```

并在 `registerBuiltins()` 内、`registerSource(claudeCodeSource)` 之后加:

```ts
  registerSource(codexSource)
```

- [ ] **步骤 5:运行测试确认通过**

运行:`npx vitest run test/sources/codex.test.ts`
预期:PASS(四个 parse 情形 + 注册)。

- [ ] **步骤 6:提交**

```bash
git add src/sources/codex.ts src/cli/commands.ts test/sources/codex.test.ts
git commit -m "feat: add codex source (Stop -> done, PermissionRequest -> needs-approval)"
```

---

## 任务 3:Codex `config.toml` 托管块接线

**文件:**
- 新建:`src/config/codex-toml.ts`
- 测试:`test/config/codex-toml.test.ts`

**接口:**
- 产出:
  - `CODEX_HOOK_COMMAND: string` = `'beepify notify --source codex'`
  - `renderCodexHookBlock(command?: string): string` — 带标记的 TOML 块。
  - `upsertManagedBlock(existing: string, block: string): string` — 幂等插入/替换。
  - `removeManagedBlock(existing: string): { text: string; changed: boolean }`
  - `installCodexHook(configPath: string, command?: string, now?: number): { changed: boolean; backup?: string }`
  - `uninstallCodexHook(configPath: string): { changed: boolean }`

- [ ] **步骤 1:写失败测试**

新建 `test/config/codex-toml.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import {
  CODEX_HOOK_COMMAND, renderCodexHookBlock, upsertManagedBlock, removeManagedBlock,
  installCodexHook, uninstallCodexHook,
} from '../../src/config/codex-toml'

describe('renderCodexHookBlock', () => {
  it('parses as TOML wiring Stop + PermissionRequest to the codex command', () => {
    const parsed = parseToml(renderCodexHookBlock()) as any
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe(CODEX_HOOK_COMMAND)
    expect(parsed.hooks.PermissionRequest[0].hooks[0].command).toBe(CODEX_HOOK_COMMAND)
  })
})

describe('upsertManagedBlock', () => {
  const block = renderCodexHookBlock()
  it('appends to an empty file', () => {
    expect(upsertManagedBlock('', block)).toContain('[[hooks.Stop]]')
  })
  it('preserves unrelated content when appending', () => {
    const out = upsertManagedBlock('model = "o4-mini"\n', block)
    expect(out).toContain('model = "o4-mini"')
    expect(out).toContain('[[hooks.Stop]]')
  })
  it('is idempotent — a second upsert yields identical output', () => {
    const once = upsertManagedBlock('model = "x"\n', block)
    expect(upsertManagedBlock(once, block)).toBe(once)
  })
})

describe('removeManagedBlock', () => {
  it('removes the block, keeps other content, reports changed', () => {
    const withBlock = upsertManagedBlock('model = "x"\n', renderCodexHookBlock())
    const { text, changed } = removeManagedBlock(withBlock)
    expect(changed).toBe(true)
    expect(text).toContain('model = "x"')
    expect(text).not.toContain('[[hooks.Stop]]')
  })
  it('reports no change when no managed block is present', () => {
    expect(removeManagedBlock('model = "x"\n').changed).toBe(false)
  })
})

describe('installCodexHook / uninstallCodexHook', () => {
  it('creates the file (and parent dir), backs up on rewrite, is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-codex-'))
    const cfg = join(dir, 'codex', 'config.toml') // parent dir does not exist yet
    const first = installCodexHook(cfg, CODEX_HOOK_COMMAND, 111)
    expect(first.changed).toBe(true)
    expect(first.backup).toBeUndefined() // no prior file to back up
    expect(readFileSync(cfg, 'utf8')).toContain('[[hooks.PermissionRequest]]')
    const second = installCodexHook(cfg, CODEX_HOOK_COMMAND, 222)
    expect(second.changed).toBe(false) // already installed
  })
  it('backs up an existing file before rewriting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-codex-'))
    const cfg = join(dir, 'config.toml')
    writeFileSync(cfg, 'model = "x"\n')
    const r = installCodexHook(cfg, CODEX_HOOK_COMMAND, 333)
    expect(r.changed).toBe(true)
    expect(r.backup).toBe(`${cfg}.beepify-bak.333`)
    expect(existsSync(r.backup!)).toBe(true)
  })
  it('uninstall removes the block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-codex-'))
    const cfg = join(dir, 'config.toml')
    installCodexHook(cfg)
    const r = uninstallCodexHook(cfg)
    expect(r.changed).toBe(true)
    expect(readFileSync(cfg, 'utf8')).not.toContain('[[hooks.Stop]]')
  })
})
```

- [ ] **步骤 2:运行测试确认失败**

运行:`npx vitest run test/config/codex-toml.test.ts`
预期:FAIL——找不到模块 `../../src/config/codex-toml`。

- [ ] **步骤 3:创建 `src/config/codex-toml.ts`**

```ts
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const CODEX_HOOK_COMMAND = 'beepify notify --source codex'
const BEGIN = '# >>> beepify (managed) >>>'
const END = '# <<< beepify (managed) <<<'

export function renderCodexHookBlock(command: string = CODEX_HOOK_COMMAND): string {
  return [
    BEGIN,
    '[[hooks.Stop]]',
    '[[hooks.Stop.hooks]]',
    'type = "command"',
    `command = "${command}"`,
    '[[hooks.PermissionRequest]]',
    '[[hooks.PermissionRequest.hooks]]',
    'type = "command"',
    `command = "${command}"`,
    END,
  ].join('\n')
}

// Insert the managed block, or replace it in place if the markers already exist.
// Only TOML tables are appended (never root keys), which is always valid because
// existing root keys already precede all tables.
export function upsertManagedBlock(existing: string, block: string): string {
  const b = existing.indexOf(BEGIN)
  const e = existing.indexOf(END)
  if (b !== -1 && e !== -1 && e > b) {
    return existing.slice(0, b) + block + existing.slice(e + END.length)
  }
  const sep = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return existing + sep + block + '\n'
}

export function removeManagedBlock(existing: string): { text: string; changed: boolean } {
  const b = existing.indexOf(BEGIN)
  const e = existing.indexOf(END)
  if (b === -1 || e === -1 || e < b) return { text: existing, changed: false }
  const before = existing.slice(0, b).replace(/\n+$/, '\n')
  const after = existing.slice(e + END.length).replace(/^\n+/, '')
  return { text: (before + after).replace(/\n{3,}/g, '\n\n'), changed: true }
}

export function installCodexHook(
  configPath: string,
  command: string = CODEX_HOOK_COMMAND,
  now: number = Date.now(),
): { changed: boolean; backup?: string } {
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  const next = upsertManagedBlock(existing, renderCodexHookBlock(command))
  if (next === existing) return { changed: false }
  let backup: string | undefined
  if (existsSync(configPath)) {
    backup = `${configPath}.beepify-bak.${now}`
    copyFileSync(configPath, backup)
  }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, next)
  return { changed: true, backup }
}

export function uninstallCodexHook(configPath: string): { changed: boolean } {
  if (!existsSync(configPath)) return { changed: false }
  const { text, changed } = removeManagedBlock(readFileSync(configPath, 'utf8'))
  if (changed) writeFileSync(configPath, text)
  return { changed }
}
```

- [ ] **步骤 4:运行测试确认通过**

运行:`npx vitest run test/config/codex-toml.test.ts`
预期:PASS(render / upsert / remove / install / uninstall 全部情形)。

- [ ] **步骤 5:提交**

```bash
git add src/config/codex-toml.ts test/config/codex-toml.test.ts
git commit -m "feat: idempotent codex config.toml managed-block wiring"
```

---

## 任务 4:`runInitCodex` + `init --agent`

**文件:**
- 改:`src/cli/commands.ts`(抽出 `ensureBeepifyConfig`,新增 `runInitCodex`)
- 改:`src/cli/index.ts`(解析 `--agent`,分派到 codex 路径)
- 测试:`test/cli/commands.test.ts`(追加 codex-init 情形)

**接口:**
- 消费:`src/config/codex-toml` 的 `installCodexHook`、`uninstallCodexHook`。
- 产出:`runInitCodex(opts: { codexConfigPath: string; beepifyConfigPath: string; uninstall?: boolean }): { hook: { changed: boolean; backup?: string }; configCreated: boolean }`。
- `ensureBeepifyConfig(configPath: string): boolean` — `commands.ts` 私有,`runInit` 与 `runInitCodex` 共用。

- [ ] **步骤 1:写失败测试**

`test/cli/commands.test.ts` 已存在,且已 import `mkdtempSync, writeFileSync, existsSync, readFileSync`(`node:fs`)、`tmpdir`、`join`。**不要**重复 import。在现有 commands import 行加入 `runInitCodex`:

```ts
import { registerBuiltins, runNotify, runInit, runInitCodex, runDoctor } from '../../src/cli/commands'
```

然后在文件末尾追加此 `describe` 块:

```ts
describe('runInitCodex', () => {
  it('scaffolds the beepify config and installs the codex hook', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-init-'))
    const codexConfigPath = join(dir, 'codex', 'config.toml')
    const beepifyConfigPath = join(dir, 'beepify', 'config.toml')
    const r = runInitCodex({ codexConfigPath, beepifyConfigPath })
    expect(r.configCreated).toBe(true)
    expect(r.hook.changed).toBe(true)
    expect(readFileSync(codexConfigPath, 'utf8')).toContain('[[hooks.Stop]]')
  })
  it('uninstall removes the codex hook and does not scaffold config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beepify-init-'))
    const codexConfigPath = join(dir, 'config.toml')
    const beepifyConfigPath = join(dir, 'beepify.toml')
    writeFileSync(codexConfigPath, '')
    runInitCodex({ codexConfigPath, beepifyConfigPath })
    const r = runInitCodex({ codexConfigPath, beepifyConfigPath, uninstall: true })
    expect(r.hook.changed).toBe(true)
    expect(r.configCreated).toBe(false)
    expect(readFileSync(codexConfigPath, 'utf8')).not.toContain('[[hooks.Stop]]')
  })
})
```

- [ ] **步骤 2:运行测试确认失败**

运行:`npx vitest run test/cli/commands.test.ts`
预期:FAIL——`commands.ts` 未导出 `runInitCodex`。

- [ ] **步骤 3:在 `commands.ts` 抽出 `ensureBeepifyConfig` 并新增 `runInitCodex`**

在 `src/cli/commands.ts` 顶部加 import:

```ts
import { installCodexHook, uninstallCodexHook } from '../config/codex-toml'
```

加入抽出的助手(置于 `runInit` 之上):

```ts
function ensureBeepifyConfig(configPath: string): boolean {
  if (existsSync(configPath)) return false
  mkdirSync(dirname(configPath), { recursive: true })
  const example = exampleConfigPath()
  if (existsSync(example)) copyFileSync(example, configPath)
  else writeFileSync(configPath, 'debounce_seconds = 20\nlocale = "en"\nchannels = []\n')
  return true
}
```

将 `runInit` 内的配置脚手架块(`let configCreated = false … configCreated = true }` 段)替换为一次调用:

```ts
  const configCreated = ensureBeepifyConfig(opts.configPath)
```

于是 `runInit` 变为:

```ts
export function runInit(opts: {
  settingsPath: string
  configPath: string
  uninstall?: boolean
}): {
  hook: { changed: boolean; backup?: string }
  configCreated: boolean
} {
  if (opts.uninstall) {
    return { hook: uninstallHook(opts.settingsPath, HOOK_COMMAND), configCreated: false }
  }
  const configCreated = ensureBeepifyConfig(opts.configPath)
  const hook = installHook(opts.settingsPath, HOOK_COMMAND)
  return { hook, configCreated }
}
```

在 `runInit` 之后紧接着加 `runInitCodex`:

```ts
export function runInitCodex(opts: {
  codexConfigPath: string
  beepifyConfigPath: string
  uninstall?: boolean
}): {
  hook: { changed: boolean; backup?: string }
  configCreated: boolean
} {
  if (opts.uninstall) {
    return { hook: uninstallCodexHook(opts.codexConfigPath), configCreated: false }
  }
  const configCreated = ensureBeepifyConfig(opts.beepifyConfigPath)
  const hook = installCodexHook(opts.codexConfigPath)
  return { hook, configCreated }
}
```

- [ ] **步骤 4:运行测试确认通过**

运行:`npx vitest run test/cli/commands.test.ts`
预期:PASS。

- [ ] **步骤 5:在 `index.ts` 接线 `init --agent`**

在 `src/cli/index.ts`,把 `runInitCodex` 加入 commands import:

```ts
import { registerBuiltins, runNotify, runTest, runInit, runInitCodex, runDoctor } from './commands'
```

将 `if (cmd === 'init') { … }` 块替换为:

```ts
  if (cmd === 'init') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        uninstall: { type: 'boolean', default: false },
        agent: { type: 'string', default: 'claude-code' },
      },
      allowPositionals: true,
    })
    const uninstall = values.uninstall as boolean
    const agent = values.agent as string

    if (agent === 'codex') {
      const codexConfigPath = join(homedir(), '.codex', 'config.toml')
      const r = runInitCodex({ codexConfigPath, beepifyConfigPath: defaultConfigPath(), uninstall })
      if (uninstall) {
        console.log(r.hook.changed ? 'Removed Beepify hook from ~/.codex/config.toml' : 'No Beepify hook found')
      } else {
        console.log(r.configCreated ? `Created ${defaultConfigPath()}` : `Config already exists at ${defaultConfigPath()}`)
        console.log(r.hook.changed ? 'Installed Beepify hook into ~/.codex/config.toml' : 'Hook already installed')
        console.log('Next: edit your config.toml, then run `beepify test`.')
      }
      return 0
    }

    const settingsPath = join(homedir(), '.claude', 'settings.json')
    const r = runInit({ settingsPath, configPath: defaultConfigPath(), uninstall })
    if (uninstall) {
      console.log(r.hook.changed ? 'Removed Beepify hook from settings.json' : 'No Beepify hook found')
    } else {
      console.log(r.configCreated ? `Created ${defaultConfigPath()}` : `Config already exists at ${defaultConfigPath()}`)
      console.log(r.hook.changed ? 'Installed Beepify hook into settings.json' : 'Hook already installed')
      console.log('Next: edit your config.toml, then run `beepify test`.')
    }
    return 0
  }
```

- [ ] **步骤 6:运行完整套件 + typecheck**

运行:`npm run typecheck && npx vitest run`
预期:PASS(typecheck 干净;全部测试通过)。

- [ ] **步骤 7:提交**

```bash
git add src/cli/commands.ts src/cli/index.ts test/cli/commands.test.ts
git commit -m "feat: beepify init --agent codex wiring"
```

---

## 任务 5:Setup 向导 agent 多选

**文件:**
- 改:`src/cli/setup-core.ts`(`AgentName`、`normalizeAgents`、`SetupAnswers.agents`)
- 改:`src/cli/setup.ts`(询问多选)
- 改:`src/cli/index.ts`(按 `answers.agents` 行动)
- 测试:`test/cli/setup-core.test.ts`、`test/cli/setup.test.ts`

**接口:**
- 产出:`AgentName = 'claude-code' | 'codex'`;`normalizeAgents(s: string): AgentName[]`;`SetupAnswers` 新增 `agents: AgentName[]`。
- `runSetup` 现在多问一个问题并在结果中返回 `agents`。`agents` **不**写入 `config.toml`(仅驱动接线),故 `buildConfigObject` / `renderConfigToml` 不变。

- [ ] **步骤 1:写失败测试**

在 `test/cli/setup-core.test.ts` 追加:

```ts
import { normalizeAgents } from '../../src/cli/setup-core'

describe('normalizeAgents', () => {
  it('maps menu choices to agent sets', () => {
    expect(normalizeAgents('1')).toEqual(['claude-code'])
    expect(normalizeAgents('2')).toEqual(['codex'])
    expect(normalizeAgents('3')).toEqual(['claude-code', 'codex'])
    expect(normalizeAgents('both')).toEqual(['claude-code', 'codex'])
    expect(normalizeAgents('')).toEqual(['claude-code'])
  })
})
```

更新 `test/cli/setup.test.ts` 中两个现有测试,补上新的 agents 答案并断言。第一个测试的 scripted 数组与断言改为:

```ts
  it('collects locale, one bark channel, then stops, with notify_idle off', async () => {
    // locale -> add? y -> bark -> key -> server -> icon -> add? n -> notify_idle? n -> agents
    const { io } = scriptedIO(['zh-CN', 'y', 'bark', 'K', '', '', 'n', 'n', '3'])
    const answers = await runSetup(io, { configPath: '/tmp/none.toml' })
    expect(answers.locale).toBe('zh-CN')
    expect(answers.notify_idle).toBe(false)
    expect(answers.channels).toEqual([{ type: 'bark', key: 'K' }])
    expect(answers.agents).toEqual(['claude-code', 'codex'])
  })
```

第二个测试:

```ts
  it('detects Open Island and records the command for a desktop channel', async () => {
    const { io } = scriptedIO(['en', 'y', 'desktop', 'open-island', 'n', 'n', '2'])
    const answers = await runSetup(io, {
      configPath: '/tmp/none.toml',
      detect: () => ({ installed: true, command: '/x/open-island-hooks.py' }),
    })
    expect(answers.channels[0]).toEqual({ type: 'desktop', provider: 'open-island', open_island_command: '/x/open-island-hooks.py' })
    expect(answers.agents).toEqual(['codex'])
  })
```

- [ ] **步骤 2:运行测试确认失败**

运行:`npx vitest run test/cli/setup-core.test.ts test/cli/setup.test.ts`
预期:FAIL——缺 `normalizeAgents`;`answers.agents` 为 undefined。

- [ ] **步骤 3:扩展 `setup-core.ts`**

在 `src/cli/setup-core.ts`,于 `SetupAnswers` 之上加:

```ts
export type AgentName = 'claude-code' | 'codex'

export function normalizeAgents(s: string): AgentName[] {
  const t = s.trim().toLowerCase()
  if (t === '2' || t === 'codex') return ['codex']
  if (t === '3' || t === 'both') return ['claude-code', 'codex']
  return ['claude-code']
}
```

并在接口加 `agents`:

```ts
export interface SetupAnswers {
  locale: 'en' | 'zh-CN'
  notify_idle: boolean
  agents: AgentName[]
  channels: ChannelAnswer[]
}
```

(`buildConfigObject` / `renderConfigToml` 保持不变——`agents` 不属于运行时配置。)

- [ ] **步骤 4:在 `setup.ts` 询问多选**

在 `src/cli/setup.ts`,更新 import:

```ts
import { normalizeLocale, normalizeProvider, normalizeAgents } from './setup-core'
```

将 `runSetup` 末尾两行(`notify_idle` 行与 `return`)替换为:

```ts
  const notify_idle = yes(await io.ask('Send the ~60s idle reminder too? (y/n)', cur?.notify_idle ? 'y' : 'n'))
  const agents = normalizeAgents(
    await io.ask('Which coding agents to wire up? 1) Claude Code  2) Codex  3) both', '1'),
  )
  return { locale, notify_idle, agents, channels }
```

- [ ] **步骤 5:运行测试确认通过**

运行:`npx vitest run test/cli/setup-core.test.ts test/cli/setup.test.ts`
预期:PASS。

- [ ] **步骤 6:在 `index.ts` 按 `answers.agents` 行动**

在 `src/cli/index.ts` 的 `if (cmd === 'setup')` 块内,将单一的钩子安装提问:

```ts
    if (/^y/i.test(await io.ask('Install the Claude Code hook now? (y/n)', 'y'))) {
      const settingsPath = join(homedir(), '.claude', 'settings.json')
      const r = runInit({ settingsPath, configPath, uninstall: false })
      console.log(r.hook.changed ? 'Installed Beepify hook.' : 'Hook already installed.')
    }
```

替换为对所选 agent 的遍历:

```ts
    for (const agent of answers.agents) {
      if (agent === 'claude-code') {
        const settingsPath = join(homedir(), '.claude', 'settings.json')
        const r = runInit({ settingsPath, configPath, uninstall: false })
        console.log(r.hook.changed ? 'Installed Claude Code hook.' : 'Claude Code hook already installed.')
      } else if (agent === 'codex') {
        const codexConfigPath = join(homedir(), '.codex', 'config.toml')
        const r = runInitCodex({ codexConfigPath, beepifyConfigPath: configPath, uninstall: false })
        console.log(r.hook.changed ? 'Installed Codex hook into ~/.codex/config.toml.' : 'Codex hook already installed.')
      }
    }
```

- [ ] **步骤 7:运行完整套件 + typecheck**

运行:`npm run typecheck && npx vitest run`
预期:PASS。

- [ ] **步骤 8:提交**

```bash
git add src/cli/setup-core.ts src/cli/setup.ts src/cli/index.ts test/cli/setup-core.test.ts test/cli/setup.test.ts
git commit -m "feat: setup wizard multi-selects agents (Claude Code / Codex)"
```

---

## 任务 6:文档、帮助文本、版本升级

**文件:**
- 改:`src/cli/index.ts`(VERSION、HELP 文本)
- 改:`package.json`(version)
- 改:`README.md`、`README.zh-CN.md`、`config.example.toml`

**接口:** 无(文档 + 常量)。

- [ ] **步骤 1:两处升级版本号**

`src/cli/index.ts`:

```ts
const VERSION = '0.3.0' // keep in sync with package.json
```

`package.json`,把 `"version": "0.2.0"` 改为 `"version": "0.3.0"`。

- [ ] **步骤 2:更新 `index.ts` 的 HELP 文本**

替换 `HELP` 模板字符串里的 `init` 行:

```
  init [--agent codex] [--uninstall]   scaffold config + install a hook (Claude Code by default, or Codex)
```

- [ ] **步骤 3:在 `config.example.toml` 加 Codex 说明**

在 `config.example.toml` 末尾追加:

```toml
# Codex CLI: channels above are shared. To let Codex trigger Beepify, run
#   beepify init --agent codex   (or choose Codex in `beepify setup`)
# which wires a managed [hooks] block into ~/.codex/config.toml.
```

- [ ] **步骤 4:在 `README.md` 加 Codex 章节**

在现有 agent/安装文档之下加:

```markdown
### Codex CLI

Beepify also works with the OpenAI Codex CLI via its `[hooks]` lifecycle system.

```bash
beepify init --agent codex   # wires ~/.codex/config.toml, scaffolds config
# or run `beepify setup` and choose Codex (or "both")
```

This appends a managed block to `~/.codex/config.toml` that notifies on `Stop`
(task done) and `PermissionRequest` (needs approval). The Bark / ntfy / desktop
channels are shared with Claude Code — configure them once. Remove with
`beepify init --agent codex --uninstall`.
```

- [ ] **步骤 5:在 `README.zh-CN.md` 加对应 Codex 章节**

```markdown
### Codex CLI

Beepify 也可通过 OpenAI Codex CLI 的 `[hooks]` 生命周期系统工作。

```bash
beepify init --agent codex   # 接线 ~/.codex/config.toml,并生成配置
# 或运行 `beepify setup` 选择 Codex(或"both")
```

这会向 `~/.codex/config.toml` 追加一个托管块,在 `Stop`(任务完成)与
`PermissionRequest`(需批准)时通知。Bark / ntfy / desktop 通道与 Claude Code
共享——只需配置一次。卸载:`beepify init --agent codex --uninstall`。
```

- [ ] **步骤 6:验证 build、typecheck 与完整套件**

运行:`npm run typecheck && npx vitest run && npm run build`
预期:PASS——typecheck 干净,全部测试通过,build 成功。

- [ ] **步骤 7:提交**

```bash
git add src/cli/index.ts package.json README.md README.zh-CN.md config.example.toml
git commit -m "docs: document Codex support; bump to 0.3.0"
```

---

## 收尾

全部任务完成后:用 superpowers:finishing-a-development-branch 验证测试,再推送 `feat/v3-codex-support` 并开 PR。推荐合并方式:**squash**(保持 `main` 历史每功能一 commit,与先前 Beepify PR 一致)。在 PR 合并且用户确认前,不要把 0.3.0 发布到 npm。
