# Beepify v2 —— 桌面 Channel + 配置向导 实现计划

> **说明:** 本文件是**中文 review 版**,内容与英文版 `2026-07-01-beepify-v2-desktop-and-setup.md` 对应;英文版为执行(subagent)canonical 版本。代码块两版逐字一致。
>
> **给执行 agent:** 必需子技能:用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务实现。步骤用复选框(`- [ ]`)跟踪。

**目标:** 新增 `desktop` 通知 channel(macOS 原生 + Open Island provider),以及一个可编辑现有配置的 `beepify setup` 交互向导。

**架构:** `desktop` channel 经 `selectProvider` 口子解析出平台 **provider**(osascript / terminal-notifier / open-island),因此 Linux/Windows 后端将来只是纯新增。每个 provider 拆成「纯构造函数(argv / stdin payload,单测)+ 接受注入 `Runner` 的薄工厂」,除默认 runner 的一个冒烟测试外,没有测试会真正启动进程。向导把「纯配置对象构造器」与「注入 IO 的 readline 薄壳」分离。

**技术栈:** TypeScript(ESM,NodeNext),Node ≥18(开发用 22),vitest,tsup,smol-toml(用 `stringify` 输出配置),`node:child_process`(`execFile`)。

## 全局约束(每个任务隐含继承)

- 包名 `@elbc/beepify`,目标发布 `0.2.0`。`src/cli/index.ts` 的 `VERSION` 与 `package.json` 保持一致。
- 运行时依赖只有 `smol-toml`。**不得新增依赖**(不装 `terminal-notifier` npm 包、不装 prompt 库 —— 用 `node:readline`)。
- channel 的 `send()` **绝不抛错**;失败返回 `{ channel, ok: false, error }`。provider 同理返回 `{ ok, error? }`,绝不抛错。
- 面向用户的 desktop provider 取值精确为 `native`(默认)与 `open-island`。`auto` / `osascript` / `terminal-notifier` 作为高级别名被接受,但向导不提供。
- 进程执行用 `execFile` + 参数数组(绝不用 shell 字符串),防注入。
- `beepify init` 不变。所有交互只在新命令 `beepify setup`。
- 本仓库 commit **不加** `Co-Authored-By` trailer。
- 测试放在 `test/` 下、镜像 `src/`。全量 `npm test`;类型检查 `npm run typecheck`。

## 文件结构

```
src/channels/desktop/
  types.ts             DesktopProvider、Runner、RunResult、Probe、SelectCtx
  osascript.ts         osascriptScript() + makeOsascriptProvider(run)
  terminal-notifier.ts terminalNotifierArgs() + makeTerminalNotifierProvider(run)
  open-island.ts       openIslandPayload() + makeOpenIslandProvider(run, detect)
  detect.ts            detectOpenIsland(deps) + realProbe()
  run.ts               defaultRun(execFile Runner)
  select.ts            selectProvider(name, ctx)
  index.ts             desktopChannel: Channel(接默认值、委派)
src/cli/
  setup-core.ts        SetupAnswers、buildConfigObject()、校验 helper
  setup.ts             runSetup(io, deps) readline 薄壳
```

改动:`src/cli/commands.ts`(注册 desktop channel)、`src/cli/index.ts`(`setup` 命令 + 版本)、`config.example.toml`、`README.md`、`README.zh-CN.md`、`package.json`。

---

### Task 1:osascript provider

**文件:**
- 新建:`src/channels/desktop/types.ts`
- 新建:`src/channels/desktop/osascript.ts`
- 测试:`test/channels/desktop/osascript.test.ts`

**接口:**
- 产出:`RunResult = { code: number; stderr: string }`;`Runner = (file, args, input?) => Promise<RunResult>`;`DesktopProvider = (msg, cfg) => Promise<{ ok, error? }>`;`Probe = (bin) => boolean`;`osascriptScript(title, body, sound?)`;`makeOsascriptProvider(run)`。

- [ ] **步骤 1:写失败测试**

```ts
// test/channels/desktop/osascript.test.ts
import { describe, it, expect, vi } from 'vitest'
import { osascriptScript, makeOsascriptProvider } from '../../../src/channels/desktop/osascript'
import type { RenderedMessage } from '../../../src/core/types'
import type { Runner } from '../../../src/channels/desktop/types'

const msg: RenderedMessage = {
  title: '✅ Done · H', body: 'Edit: /Users/x "f"', group: 'Beepify',
  event: { kind: 'done', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('osascriptScript', () => {
  it('escapes double quotes and backslashes', () => {
    const s = osascriptScript('T"a\\b', 'B"c', undefined)
    expect(s).toBe('display notification "B\\"c" with title "T\\"a\\\\b"')
  })
  it('appends sound when provided', () => {
    expect(osascriptScript('T', 'B', 'Ping')).toBe('display notification "B" with title "T" sound name "Ping"')
  })
})

describe('makeOsascriptProvider', () => {
  it('invokes osascript -e with the built script and reports ok on code 0', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const run: Runner = vi.fn(async (file, args) => { calls.push({ file, args }); return { code: 0, stderr: '' } })
    const r = await makeOsascriptProvider(run)(msg, { type: 'desktop' })
    expect(r).toEqual({ ok: true })
    expect(calls[0].file).toBe('osascript')
    expect(calls[0].args[0]).toBe('-e')
    expect(calls[0].args[1]).toContain('with title "✅ Done · H"')
  })
  it('reports ok:false with stderr on non-zero exit', async () => {
    const run: Runner = async () => ({ code: 1, stderr: 'boom' })
    expect(await makeOsascriptProvider(run)(msg, { type: 'desktop' })).toEqual({ ok: false, error: 'boom' })
  })
})
```

- [ ] **步骤 2:跑测试确认失败** —— `npx vitest run test/channels/desktop/osascript.test.ts`,预期找不到模块。

- [ ] **步骤 3:写最小实现**

```ts
// src/channels/desktop/types.ts
import type { RenderedMessage, ChannelConfig } from '../../core/types'

export interface RunResult { code: number; stderr: string }
export type Runner = (file: string, args: string[], input?: string) => Promise<RunResult>
export type DesktopProvider = (msg: RenderedMessage, cfg: ChannelConfig) => Promise<{ ok: boolean; error?: string }>
export type Probe = (bin: string) => boolean
```

```ts
// src/channels/desktop/osascript.ts
import type { Runner, DesktopProvider } from './types'

export function osascriptScript(title: string, body: string, sound?: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  let s = `display notification "${esc(body)}" with title "${esc(title)}"`
  if (sound) s += ` sound name "${esc(sound)}"`
  return s
}

export function makeOsascriptProvider(run: Runner): DesktopProvider {
  return async (msg, cfg) => {
    const sound = typeof cfg.sound === 'string' && cfg.sound ? cfg.sound : undefined
    const r = await run('osascript', ['-e', osascriptScript(msg.title, msg.body, sound)])
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr || `osascript exit ${r.code}` }
  }
}
```

- [ ] **步骤 4:跑测试确认通过**(4 个)。
- [ ] **步骤 5:提交**

```bash
git add src/channels/desktop/types.ts src/channels/desktop/osascript.ts test/channels/desktop/osascript.test.ts
git commit -m "feat(desktop): osascript provider with escaped notification script"
```

---

### Task 2:terminal-notifier provider

**文件:** 新建 `src/channels/desktop/terminal-notifier.ts`;测试 `test/channels/desktop/terminal-notifier.test.ts`。

**接口:** 消费 `./types` 的 `Runner`、`DesktopProvider`;产出 `terminalNotifierArgs(msg)`、`makeTerminalNotifierProvider(run)`。

- [ ] **步骤 1:写失败测试**

```ts
// test/channels/desktop/terminal-notifier.test.ts
import { describe, it, expect, vi } from 'vitest'
import { terminalNotifierArgs, makeTerminalNotifierProvider } from '../../../src/channels/desktop/terminal-notifier'
import type { RenderedMessage } from '../../../src/core/types'
import type { Runner } from '../../../src/channels/desktop/types'

const msg: RenderedMessage = {
  title: '🔔 Needs approval · H', body: 'Bash: ls', group: 'Beepify',
  event: { kind: 'needs-approval', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('terminalNotifierArgs', () => {
  it('maps title, message and group to flags', () => {
    expect(terminalNotifierArgs(msg)).toEqual(['-title', '🔔 Needs approval · H', '-message', 'Bash: ls', '-group', 'Beepify'])
  })
  it('omits -group when group is empty', () => {
    expect(terminalNotifierArgs({ ...msg, group: '' })).toEqual(['-title', msg.title, '-message', msg.body])
  })
})

describe('makeTerminalNotifierProvider', () => {
  it('calls terminal-notifier and reports ok on code 0', async () => {
    let seen: string[] = []
    const run: Runner = vi.fn(async (_f, args) => { seen = args; return { code: 0, stderr: '' } })
    expect(await makeTerminalNotifierProvider(run)(msg, { type: 'desktop' })).toEqual({ ok: true })
    expect(seen).toContain('-title')
  })
})
```

- [ ] **步骤 2:跑测试确认失败。**
- [ ] **步骤 3:写最小实现**

> `RenderedMessage` 从 `../../core/types` import(**不**从 `./types` 再导出);`Runner`/`DesktopProvider` 从 `./types` import。

```ts
// src/channels/desktop/terminal-notifier.ts
import type { RenderedMessage } from '../../core/types'
import type { Runner, DesktopProvider } from './types'

export function terminalNotifierArgs(msg: RenderedMessage): string[] {
  const args = ['-title', msg.title, '-message', msg.body]
  if (msg.group) args.push('-group', msg.group)
  return args
}

export function makeTerminalNotifierProvider(run: Runner): DesktopProvider {
  return async (msg) => {
    const r = await run('terminal-notifier', terminalNotifierArgs(msg))
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr || `terminal-notifier exit ${r.code}` }
  }
}
```

- [ ] **步骤 4:跑测试确认通过**(3 个)。
- [ ] **步骤 5:提交**

```bash
git add src/channels/desktop/terminal-notifier.ts test/channels/desktop/terminal-notifier.test.ts
git commit -m "feat(desktop): terminal-notifier provider"
```

---

### Task 3:open-island provider

**文件:** 新建 `src/channels/desktop/open-island.ts`;测试 `test/channels/desktop/open-island.test.ts`。

**接口:** 消费 `./types` 的 `Runner`、`DesktopProvider`;`../../core/types` 的 `NormalizedEvent`。产出 `openIslandPayload(event)`;`makeOpenIslandProvider(run, detect)`,其中 `detect()` 返回已解析命令路径或 `''`。

- [ ] **步骤 1:写失败测试**

```ts
// test/channels/desktop/open-island.test.ts
import { describe, it, expect, vi } from 'vitest'
import { openIslandPayload, makeOpenIslandProvider } from '../../../src/channels/desktop/open-island'
import type { RenderedMessage } from '../../../src/core/types'
import type { Runner } from '../../../src/channels/desktop/types'

const raw = { hook_event_name: 'Stop', cwd: '/a/proj', transcript_path: '/t.jsonl' }
const msg: RenderedMessage = {
  title: '✅ Done · H', body: 'done', group: 'Beepify',
  event: { kind: 'done', agent: 'claude-code', host: 'H', project: 'proj', ts: 1, raw },
}

describe('openIslandPayload', () => {
  it('passes the original raw hook payload through for claude-code', () => {
    expect(JSON.parse(openIslandPayload(msg.event))).toEqual(raw)
  })
  it('synthesizes a claude-shaped payload when raw is absent', () => {
    const p = JSON.parse(openIslandPayload({ kind: 'waiting-input', agent: 'x', host: 'H', project: 'proj', summary: 'hi', ts: 1 }))
    expect(p).toMatchObject({ hook_event_name: 'Notification', message: 'hi' })
  })
})

describe('makeOpenIslandProvider', () => {
  it('spawns the detected command with --source claude and pipes the payload on stdin', async () => {
    let seen = { file: '', args: [] as string[], input: '' }
    const run: Runner = vi.fn(async (file, args, input) => { seen = { file, args, input: input ?? '' }; return { code: 0, stderr: '' } })
    const r = await makeOpenIslandProvider(run, () => '/bin/open-island-hooks.py')(msg, { type: 'desktop' })
    expect(r).toEqual({ ok: true })
    expect(seen.file).toBe('/bin/open-island-hooks.py')
    expect(seen.args).toEqual(['--source', 'claude'])
    expect(JSON.parse(seen.input)).toEqual(raw)
  })
  it('prefers cfg.open_island_command over detect()', async () => {
    let file = ''
    const run: Runner = async (f) => { file = f; return { code: 0, stderr: '' } }
    await makeOpenIslandProvider(run, () => '/detected')(msg, { type: 'desktop', open_island_command: '/from-cfg' })
    expect(file).toBe('/from-cfg')
  })
  it('reports ok:false when no command can be resolved', async () => {
    const run: Runner = vi.fn(async () => ({ code: 0, stderr: '' }))
    const r = await makeOpenIslandProvider(run, () => '')(msg, { type: 'desktop' })
    expect(r.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
```

- [ ] **步骤 2:跑测试确认失败。**
- [ ] **步骤 3:写最小实现**

```ts
// src/channels/desktop/open-island.ts
import type { NormalizedEvent } from '../../core/types'
import type { Runner, DesktopProvider } from './types'

export function openIslandPayload(event: NormalizedEvent): string {
  if (event.raw && typeof event.raw === 'object') return JSON.stringify(event.raw)
  return JSON.stringify({
    hook_event_name: event.kind === 'done' ? 'Stop' : 'Notification',
    cwd: event.project,
    message: event.summary || '',
  })
}

export function makeOpenIslandProvider(run: Runner, detect: () => string): DesktopProvider {
  return async (msg, cfg) => {
    const cmd = (typeof cfg.open_island_command === 'string' && cfg.open_island_command) || detect()
    if (!cmd) return { ok: false, error: 'open-island not detected; set open_island_command' }
    const r = await run(cmd, ['--source', 'claude'], openIslandPayload(msg.event))
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr || `open-island exit ${r.code}` }
  }
}
```

- [ ] **步骤 4:跑测试确认通过**(5 个)。
- [ ] **步骤 5:提交**

```bash
git add src/channels/desktop/open-island.ts test/channels/desktop/open-island.test.ts
git commit -m "feat(desktop): open-island provider with stdin payload passthrough"
```

---

### Task 4:Open Island 检测

**文件:** 新建 `src/channels/desktop/detect.ts`;测试 `test/channels/desktop/detect.test.ts`。

**接口:** 消费 `./types` 的 `Probe`;产出 `detectOpenIsland(deps: { probe; exists; home }) => { installed, command? }`;`realProbe(bin)`。

- [ ] **步骤 1:写失败测试**

```ts
// test/channels/desktop/detect.test.ts
import { describe, it, expect } from 'vitest'
import { detectOpenIsland } from '../../../src/channels/desktop/detect'

const HOOK = 'open-island-hooks.py'

describe('detectOpenIsland', () => {
  it('uses PATH when the hook is on PATH', () => {
    const r = detectOpenIsland({ probe: (b) => b === HOOK, exists: () => false, home: '/home/e' })
    expect(r).toEqual({ installed: true, command: HOOK })
  })
  it('falls back to ~/.local/bin when not on PATH but the file exists', () => {
    const path = '/home/e/.local/bin/open-island-hooks.py'
    const r = detectOpenIsland({ probe: () => false, exists: (p) => p === path, home: '/home/e' })
    expect(r).toEqual({ installed: true, command: path })
  })
  it('reports not installed when neither is present', () => {
    expect(detectOpenIsland({ probe: () => false, exists: () => false, home: '/home/e' })).toEqual({ installed: false })
  })
})
```

- [ ] **步骤 2:跑测试确认失败。**
- [ ] **步骤 3:写最小实现**

```ts
// src/channels/desktop/detect.ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { Probe } from './types'

const HOOK = 'open-island-hooks.py'

export function detectOpenIsland(deps: {
  probe: Probe
  exists: (p: string) => boolean
  home: string
}): { installed: boolean; command?: string } {
  if (deps.probe(HOOK)) return { installed: true, command: HOOK }
  const local = join(deps.home, '.local', 'bin', HOOK)
  if (deps.exists(local)) return { installed: true, command: local }
  return { installed: false }
}

export function realProbe(bin: string): boolean {
  try {
    // `which` exits 0 iff the binary is on PATH; macOS/Linux both ship it.
    execFileSync('which', [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
```

- [ ] **步骤 4:跑测试确认通过**(3 个)。
- [ ] **步骤 5:提交**

```bash
git add src/channels/desktop/detect.ts test/channels/desktop/detect.test.ts
git commit -m "feat(desktop): detectOpenIsland (PATH then ~/.local/bin)"
```

---

### Task 5:provider 选择 + 默认 runner + desktop channel + 注册

**文件:** 新建 `src/channels/desktop/run.ts`、`select.ts`、`index.ts`;改 `src/cli/commands.ts`(注册);测试 `test/channels/desktop/select.test.ts`、`index.test.ts`。

**接口:** 消费四个 provider、`detectOpenIsland`、`realProbe`、`Runner`、`Probe`、`DesktopProvider`。产出 `defaultRun: Runner`;`selectProvider(name, ctx) => DesktopProvider | { error }`,`SelectCtx = { platform; probe; run; detect }`;`desktopChannel: Channel`。

- [ ] **步骤 1:写失败测试**

```ts
// test/channels/desktop/select.test.ts
import { describe, it, expect } from 'vitest'
import { selectProvider } from '../../../src/channels/desktop/select'
import type { Runner } from '../../../src/channels/desktop/types'

const run: Runner = async () => ({ code: 0, stderr: '' })
const base = { run, detect: () => '/oi', platform: 'darwin' as NodeJS.Platform, probe: () => false }

describe('selectProvider', () => {
  it('native on macOS with terminal-notifier present -> a callable provider', () => {
    const p = selectProvider('native', { ...base, probe: (b) => b === 'terminal-notifier' })
    expect(typeof p).toBe('function')
  })
  it('native on macOS without terminal-notifier still resolves (osascript)', () => {
    expect(typeof selectProvider('native', base)).toBe('function')
  })
  it('open-island resolves to a callable provider', () => {
    expect(typeof selectProvider('open-island', base)).toBe('function')
  })
  it('unknown provider returns an error object', () => {
    expect(selectProvider('carrier-pigeon', base)).toEqual({ error: expect.stringContaining('carrier-pigeon') })
  })
  it('native on a non-macOS platform returns an error (seam, no backend yet)', () => {
    expect(selectProvider('native', { ...base, platform: 'linux' })).toMatchObject({ error: expect.stringContaining('linux') })
  })
})
```

```ts
// test/channels/desktop/index.test.ts
import { describe, it, expect } from 'vitest'
import { desktopChannel } from '../../../src/channels/desktop'
import type { RenderedMessage } from '../../../src/core/types'

const msg: RenderedMessage = {
  title: '✅ Done · H', body: 'done', group: 'Beepify',
  event: { kind: 'done', agent: 'a', host: 'H', project: 'p', ts: 1 },
}

describe('desktopChannel', () => {
  it('returns a desktop ChannelResult (ok true/false) without throwing on an unknown provider', async () => {
    const r = await desktopChannel.send(msg, { type: 'desktop', provider: 'carrier-pigeon' })
    expect(r.channel).toBe('desktop')
    expect(r.ok).toBe(false)
    expect(typeof r.error).toBe('string')
  })
})
```

- [ ] **步骤 2:跑测试确认失败。**
- [ ] **步骤 3:写最小实现**

```ts
// src/channels/desktop/run.ts
import { execFile } from 'node:child_process'
import type { Runner } from './types'

export const defaultRun: Runner = (file, args, input) =>
  new Promise((resolve) => {
    const child = execFile(file, args, (err, _stdout, stderr) => {
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, stderr: (stderr || (err ? err.message : '')).toString() })
    })
    if (input !== undefined) child.stdin?.end(input)
  })
```

```ts
// src/channels/desktop/select.ts
import type { Probe, Runner, DesktopProvider } from './types'
import { makeOsascriptProvider } from './osascript'
import { makeTerminalNotifierProvider } from './terminal-notifier'
import { makeOpenIslandProvider } from './open-island'

export interface SelectCtx {
  platform: NodeJS.Platform
  probe: Probe
  run: Runner
  detect: () => string
}

export function selectProvider(name: string, ctx: SelectCtx): DesktopProvider | { error: string } {
  const oi = () => makeOpenIslandProvider(ctx.run, ctx.detect)
  const osa = () => makeOsascriptProvider(ctx.run)
  const tn = () => makeTerminalNotifierProvider(ctx.run)

  switch (name) {
    case 'open-island':
      return oi()
    case 'osascript':
      return osa()
    case 'terminal-notifier':
      return tn()
    case 'native':
    case 'auto':
    case '':
      if (ctx.platform !== 'darwin') return { error: `no native desktop provider for platform "${ctx.platform}" yet` }
      return ctx.probe('terminal-notifier') ? tn() : osa()
    default:
      return { error: `unknown desktop provider "${name}"` }
  }
}
```

```ts
// src/channels/desktop/index.ts
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import type { Channel, RenderedMessage, ChannelConfig, ChannelResult } from '../../core/types'
import { selectProvider } from './select'
import { defaultRun } from './run'
import { detectOpenIsland, realProbe } from './detect'

export const desktopChannel: Channel = {
  name: 'desktop',
  async send(msg: RenderedMessage, cfg: ChannelConfig): Promise<ChannelResult> {
    const name = typeof cfg.provider === 'string' && cfg.provider ? cfg.provider : 'native'
    const detect = () => detectOpenIsland({ probe: realProbe, exists: existsSync, home: homedir() }).command || ''
    const provider = selectProvider(name, { platform: process.platform, probe: realProbe, run: defaultRun, detect })
    if (typeof provider !== 'function') return { channel: 'desktop', ok: false, error: provider.error }
    const r = await provider(msg, cfg)
    return { channel: 'desktop', ok: r.ok, error: r.error }
  },
}
```

在 `src/cli/commands.ts` 注册:

```ts
// 在其它 channel import 旁边
import { desktopChannel } from '../channels/desktop'

// registerBuiltins() 里,registerChannel(ntfyChannel) 之后
  registerChannel(desktopChannel)
```

- [ ] **步骤 4:跑测试 + 类型检查** —— `npx vitest run test/channels/desktop/ && npm run typecheck`,预期全绿。
- [ ] **步骤 5:提交**

```bash
git add src/channels/desktop/run.ts src/channels/desktop/select.ts src/channels/desktop/index.ts src/cli/commands.ts test/channels/desktop/select.test.ts test/channels/desktop/index.test.ts
git commit -m "feat(desktop): provider selection + channel wiring + registration"
```

---

### Task 6:默认 runner 冒烟测试 + desktop 文档

**文件:** 测试 `test/channels/desktop/run.test.ts`;改 `config.example.toml`、`README.md`、`README.zh-CN.md`。

- [ ] **步骤 1:写测试**

```ts
// test/channels/desktop/run.test.ts
import { describe, it, expect } from 'vitest'
import { defaultRun } from '../../../src/channels/desktop/run'

describe('defaultRun', () => {
  it('resolves code 0 for a succeeding command', async () => {
    expect((await defaultRun('true', [])).code).toBe(0)
  })
  it('resolves a non-zero code for a failing command', async () => {
    expect((await defaultRun('false', [])).code).not.toBe(0)
  })
  it('pipes stdin input to the child', async () => {
    expect((await defaultRun('cat', [], 'hello')).code).toBe(0)
  })
})
```

- [ ] **步骤 2:跑测试** —— 因 Task 5 已实现,预期直接通过。`true`/`false`/`cat` 为 POSIX 标准,macOS/Linux 均有。
- [ ] **步骤 3:`config.example.toml` 追加**

```toml
# Desktop notifications (macOS). provider = "native" (Notification Center) or
# "open-island" (drives the Dynamic Island app; needs Open Island installed).
# [[channels]]
# type = "desktop"
# provider = "native"
# sound = ""               # optional; native only
# open_island_command = "" # optional; auto-detected if empty
```

- [ ] **步骤 4:两个 README 加「桌面通知」小节**

`README.md`:

````markdown
### Desktop notifications (macOS)

Add a `desktop` channel to get native macOS notifications:

```toml
[[channels]]
type = "desktop"
provider = "native"        # Notification Center (uses terminal-notifier if installed, else osascript)
```

Set `provider = "open-island"` to drive the Open Island Dynamic Island app instead (install it separately; Beepify auto-detects `open-island-hooks.py`).
````

`README.zh-CN.md`:

````markdown
### 桌面通知(macOS)

加一个 `desktop` channel 即可收到 macOS 原生通知:

```toml
[[channels]]
type = "desktop"
provider = "native"        # 通知中心(装了 terminal-notifier 就用它,否则 osascript)
```

把 `provider` 设为 `"open-island"` 可改为驱动 Open Island 灵动岛 app(需另外安装;Beepify 会自动探测 `open-island-hooks.py`)。
````

- [ ] **步骤 5:提交**

```bash
git add test/channels/desktop/run.test.ts config.example.toml README.md README.zh-CN.md
git commit -m "test(desktop): defaultRun smoke test; docs: desktop channel"
```

---

### Task 7:向导纯核心

**文件:** 新建 `src/cli/setup-core.ts`;测试 `test/cli/setup-core.test.ts`。

**接口:** 产出 `ChannelAnswer` 联合类型、`SetupAnswers`、`buildConfigObject(a)`、`renderConfigToml(a)`、`normalizeLocale(s, fallback)`、`normalizeProvider(s)`。

- [ ] **步骤 1:写失败测试**

```ts
// test/cli/setup-core.test.ts
import { describe, it, expect } from 'vitest'
import { buildConfigObject, renderConfigToml, normalizeLocale, normalizeProvider } from '../../src/cli/setup-core'
import { parse as parseToml } from 'smol-toml'

describe('normalizeLocale / normalizeProvider', () => {
  it('accepts zh-CN and falls back otherwise', () => {
    expect(normalizeLocale('zh-CN', 'en')).toBe('zh-CN')
    expect(normalizeLocale('nonsense', 'en')).toBe('en')
    expect(normalizeLocale('', 'zh-CN')).toBe('zh-CN')
  })
  it('maps provider input to native/open-island', () => {
    expect(normalizeProvider('open-island')).toBe('open-island')
    expect(normalizeProvider('2')).toBe('open-island')
    expect(normalizeProvider('anything-else')).toBe('native')
  })
})

describe('buildConfigObject', () => {
  it('emits locale, notify_idle and channels array', () => {
    const obj = buildConfigObject({
      locale: 'zh-CN', notify_idle: true,
      channels: [
        { type: 'bark', key: 'K', server: 'https://api.day.app', icon: 'https://i' },
        { type: 'desktop', provider: 'native' },
      ],
    })
    expect(obj).toMatchObject({ locale: 'zh-CN', notify_idle: true })
    expect((obj.channels as unknown[])[0]).toMatchObject({ type: 'bark', key: 'K' })
    expect((obj.channels as unknown[])[1]).toMatchObject({ type: 'desktop', provider: 'native' })
  })
  it('omits empty optional fields (no empty server/icon keys)', () => {
    const obj = buildConfigObject({ locale: 'en', notify_idle: false, channels: [{ type: 'bark', key: 'K' }] })
    expect((obj.channels as Array<Record<string, unknown>>)[0]).toEqual({ type: 'bark', key: 'K' })
  })
})

describe('renderConfigToml', () => {
  it('produces TOML that round-trips back to the same object', () => {
    const a = { locale: 'en' as const, notify_idle: false, channels: [{ type: 'ntfy' as const, topic: 'T' }] }
    const toml = renderConfigToml(a)
    expect(parseToml(toml)).toEqual(buildConfigObject(a))
  })
})
```

- [ ] **步骤 2:跑测试确认失败。**
- [ ] **步骤 3:写最小实现**

```ts
// src/cli/setup-core.ts
import { stringify as toToml } from 'smol-toml'

export type ChannelAnswer =
  | { type: 'bark'; key: string; server?: string; icon?: string }
  | { type: 'ntfy'; topic: string; server?: string }
  | { type: 'desktop'; provider: 'native' | 'open-island'; open_island_command?: string }

export interface SetupAnswers {
  locale: 'en' | 'zh-CN'
  notify_idle: boolean
  channels: ChannelAnswer[]
}

export function normalizeLocale(s: string, fallback: 'en' | 'zh-CN'): 'en' | 'zh-CN' {
  return s === 'zh-CN' ? 'zh-CN' : s === 'en' ? 'en' : fallback
}

export function normalizeProvider(s: string): 'native' | 'open-island' {
  return s === 'open-island' || s.trim() === '2' ? 'open-island' : 'native'
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') out[k] = v
  return out
}

export function buildConfigObject(a: SetupAnswers): Record<string, unknown> {
  return {
    locale: a.locale,
    notify_idle: a.notify_idle,
    channels: a.channels.map((c) => clean({ ...c })),
  }
}

export function renderConfigToml(a: SetupAnswers): string {
  return toToml(buildConfigObject(a))
}
```

- [ ] **步骤 4:跑测试确认通过**(5 个)。
- [ ] **步骤 5:提交**

```bash
git add src/cli/setup-core.ts test/cli/setup-core.test.ts
git commit -m "feat(setup): pure config-object builder + normalizers"
```

---

### Task 8:向导薄壳 + CLI 接线 + 版本号

**文件:** 新建 `src/cli/setup.ts`;改 `src/cli/index.ts`(加 `setup` 命令、`VERSION` 升 `0.2.0`);改 `package.json`(版本 `0.2.0`);测试 `test/cli/setup.test.ts`。

**接口:** 消费 `./setup-core` 的 `SetupAnswers`/`ChannelAnswer`/`renderConfigToml`/`normalizeLocale`/`normalizeProvider`;`../channels/desktop/detect` 的 `detectOpenIsland`/`realProbe`;`../config/load` 的 `loadConfig`/`defaultConfigPath`;`./commands` 的 `runInit`/`runTest`。产出 `SetupIO` 接口;`runSetup(io, deps) => Promise<SetupAnswers>`。

> 说明:`runSetup` 返回收集到的 `SetupAnswers`(便于用脚本化 IO 单测);`index.ts` 里的 `beepify setup` 命令调用它,再写文件、可选装 hook、发测试推送。**写文件与 hook/测试副作用留在 `index.ts`**,让核心保持可测。

- [ ] **步骤 1:写失败测试**

```ts
// test/cli/setup.test.ts
import { describe, it, expect } from 'vitest'
import { runSetup, type SetupIO } from '../../src/cli/setup'

function scriptedIO(answers: string[]): { io: SetupIO; out: string[] } {
  const out: string[] = []
  let i = 0
  const io: SetupIO = {
    ask: async () => answers[i++] ?? '',
    print: (s) => out.push(s),
  }
  return { io, out }
}

describe('runSetup', () => {
  it('collects locale, one bark channel, then stops, with notify_idle off', async () => {
    const { io } = scriptedIO(['zh-CN', 'y', 'bark', 'K', '', '', 'n', 'n'])
    const answers = await runSetup(io, { configPath: '/tmp/none.toml' })
    expect(answers.locale).toBe('zh-CN')
    expect(answers.notify_idle).toBe(false)
    expect(answers.channels).toEqual([{ type: 'bark', key: 'K' }])
  })

  it('detects Open Island and records the command for a desktop channel', async () => {
    const { io } = scriptedIO(['en', 'y', 'desktop', 'open-island', 'n', 'n'])
    const answers = await runSetup(io, {
      configPath: '/tmp/none.toml',
      detect: () => ({ installed: true, command: '/x/open-island-hooks.py' }),
    })
    expect(answers.channels[0]).toEqual({ type: 'desktop', provider: 'open-island', open_island_command: '/x/open-island-hooks.py' })
  })
})
```

- [ ] **步骤 2:跑测试确认失败。**
- [ ] **步骤 3:写最小实现**

```ts
// src/cli/setup.ts
import type { BeepifyConfig } from '../core/types'
import type { SetupAnswers, ChannelAnswer } from './setup-core'
import { normalizeLocale, normalizeProvider } from './setup-core'

export interface SetupIO {
  ask(question: string, def?: string): Promise<string>
  print(s: string): void
}

const yes = (s: string) => /^y(es)?$/i.test(s.trim())

export async function runSetup(
  io: SetupIO,
  deps: { configPath: string; existing?: BeepifyConfig; detect?: () => { installed: boolean; command?: string } },
): Promise<SetupAnswers> {
  const cur = deps.existing
  const locale = normalizeLocale(await io.ask('Language (en / zh-CN)', cur?.locale ?? 'en'), cur?.locale ?? 'en')

  const channels: ChannelAnswer[] = []
  while (yes(await io.ask('Add a channel? (y/n)', channels.length ? 'n' : 'y'))) {
    const type = (await io.ask('  Channel type (bark / ntfy / desktop)', 'bark')).trim()
    if (type === 'bark') {
      const key = (await io.ask('  Bark key')).trim()
      const server = (await io.ask('  Bark server (blank = default)')).trim()
      const icon = (await io.ask('  Icon URL (blank = none)')).trim()
      const c: ChannelAnswer = { type: 'bark', key }
      if (server) c.server = server
      if (icon) c.icon = icon
      channels.push(c)
    } else if (type === 'ntfy') {
      const topic = (await io.ask('  ntfy topic')).trim()
      const server = (await io.ask('  ntfy server (blank = default)')).trim()
      const c: ChannelAnswer = { type: 'ntfy', topic }
      if (server) c.server = server
      channels.push(c)
    } else if (type === 'desktop') {
      const provider = normalizeProvider(await io.ask('  Provider — 1) native (default)  2) open-island', 'native'))
      const c: ChannelAnswer = { type: 'desktop', provider }
      if (provider === 'open-island') {
        const d = deps.detect ? deps.detect() : { installed: false }
        if (d.installed && d.command) {
          c.open_island_command = d.command
          io.print(`  Detected Open Island at ${d.command}`)
        } else {
          io.print('  Open Island not detected — install it, then it will be picked up. Channel added (deferred).')
        }
      }
      channels.push(c)
    } else {
      io.print(`  Unknown type "${type}" — skipped.`)
    }
  }

  const notify_idle = yes(await io.ask('Send the ~60s idle reminder too? (y/n)', cur?.notify_idle ? 'y' : 'n'))
  return { locale, notify_idle, channels }
}
```

在 `src/cli/index.ts` 接线 —— 升版本、加分支:

```ts
const VERSION = '0.2.0' // keep in sync with package.json
```

```ts
// 顶部新增 import。(index.ts 已 import join、homedir、loadConfig、
// defaultConfigPath、runTest、runInit —— 不要重复 import。)
import { createInterface } from 'node:readline'
import { writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { runSetup, type SetupIO } from './setup'
import { renderConfigToml } from './setup-core'
import { detectOpenIsland, realProbe } from '../channels/desktop/detect'
```

```ts
// 在 `--version` 分支之前加入
  if (cmd === 'setup') {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const io: SetupIO = {
      ask: (q, def) =>
        new Promise((res) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => res(a.trim() || def || ''))),
      print: (s) => console.log(s),
    }
    const configPath = defaultConfigPath()
    const existing = existsSync(configPath) ? loadConfig(configPath) : undefined
    const detect = () => detectOpenIsland({ probe: realProbe, exists: existsSync, home: homedir() })
    const answers = await runSetup(io, { configPath, existing, detect })

    if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.beepify-bak.${Date.now()}`)
    writeFileSync(configPath, renderConfigToml(answers))
    console.log(`Wrote ${configPath}`)

    if (/^y/i.test(await io.ask('Install the Claude Code hook now? (y/n)', 'y'))) {
      const settingsPath = join(homedir(), '.claude', 'settings.json')
      const r = runInit({ settingsPath, configPath, uninstall: false })
      console.log(r.hook.changed ? 'Installed Beepify hook.' : 'Hook already installed.')
    }
    if (/^y/i.test(await io.ask('Send a test notification now? (y/n)', 'y'))) {
      for (const res of await runTest(loadConfig(configPath))) {
        console.log(`${res.channel}: ${res.skipped ? 'skipped' : res.ok ? 'ok' : 'FAIL ' + (res.error ?? '')}`)
      }
    }
    rl.close()
    return 0
  }
```

`runTest`、`runInit`、`join`、`homedir`、`loadConfig`、`defaultConfigPath` 无需改 import —— `index.ts` 已全部 import(见其现有顶部 import)。

- [ ] **步骤 4:跑测试 + 类型检查** —— `npx vitest run test/cli/setup.test.ts && npm run typecheck`,预期通过(2 个)。
- [ ] **步骤 5:改 `package.json` 版本为 `0.2.0` 并提交**

```bash
git add src/cli/setup.ts src/cli/index.ts package.json test/cli/setup.test.ts
git commit -m "feat(setup): interactive beepify setup wizard + bump to 0.2.0"
```

---

### Task 9:向导文档 + 全量绿 + build

**文件:** 改 `README.md`、`README.zh-CN.md`。

- [ ] **步骤 1:两个 README 加「快速开始」**

`README.md`:

````markdown
## Quick start

```bash
npm install -g @elbc/beepify
beepify setup   # interactive: pick language, add channels, install the hook, send a test
```

`beepify setup` edits an existing config in place (current values shown as defaults). `beepify init` remains the non-interactive path for scripts.
````

`README.zh-CN.md`:

````markdown
## 快速开始

```bash
npm install -g @elbc/beepify
beepify setup   # 交互式:选语言、加 channel、装 hook、发测试
```

`beepify setup` 会就地编辑现有配置(当前值作默认)。`beepify init` 仍是脚本用的非交互路径。
````

- [ ] **步骤 2:全量测试 + 类型检查 + build** —— `npm test && npm run typecheck && npm run build`,预期全绿、`dist/` 构建成功。
- [ ] **步骤 3:提交**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: document beepify setup wizard"
```

- [ ] **步骤 4:手动验证清单(非自动化)**

- `node dist/cli/index.js --version` 输出 `0.2.0`。
- 配了 `desktop`/`native` channel 后,`beepify test` 弹出 macOS 通知。
- `beepify setup` 可往返:跑一次,再跑一次,确认当前值作为默认出现且配置仍可解析。

---

## 自检备注

- **spec 覆盖:** desktop channel(Task 1–6)、provider 口子(Task 5 `selectProvider` + 平台守卫)、osascript/terminal-notifier/open-island(Task 1–3)、检测不代装(Task 4、8)、可编辑向导(Task 7–8)、测试推送闭环(Task 8 index 接线)、双语文档(Task 6、9)、v0.2.0 + 版本同步(Task 8)。Linux/Windows 明确推迟(Task 5 对非 darwin 的 native 返回 error —— 是口子,不是后端)。
- **不抛错不变量:** 每个 provider 与 channel 都返回结果对象;`dispatch` 已用 try/catch 兜底 `send`。
- **类型一致:** `Runner`、`DesktopProvider`、`SetupAnswers`、`ChannelAnswer` 在各任务命名一致;`RenderedMessage` 一律从 `../../core/types` import(绝不从 `./types` 再导出)。
