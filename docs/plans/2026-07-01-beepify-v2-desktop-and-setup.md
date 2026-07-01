# Beepify v2 — Desktop Channel + Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `desktop` notification channel (macOS native + Open Island provider) and an edit-aware `beepify setup` interactive wizard.

**Architecture:** The `desktop` channel resolves a platform **provider** (osascript / terminal-notifier / open-island) behind a `selectProvider` seam, so Linux/Windows backends are pure future additions. Providers split into a pure builder (argv / stdin payload — unit-tested) plus a thin factory that takes an injected `Runner`, so no test spawns a real process except one smoke test of the default runner. The wizard splits a pure config-object builder from a thin readline shell that injects its IO.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥18 (dev on 22), vitest, tsup, smol-toml (`stringify` for config emission), `node:child_process` (`execFile`).

## Global Constraints

- Package: `@elbc/beepify`, target release `0.2.0`. Keep `VERSION` in `src/cli/index.ts` in sync with `package.json`.
- Runtime dependencies: only `smol-toml`. Do NOT add new deps (no `terminal-notifier` npm pkg, no prompt libs — use `node:readline`).
- A channel `send()` MUST NEVER throw; on failure return `{ channel, ok: false, error }`. Providers likewise return `{ ok, error? }`, never throw.
- Desktop provider values surfaced to users are exactly `native` (default) and `open-island`. `auto` / `osascript` / `terminal-notifier` are accepted advanced aliases but the wizard does not offer them.
- Process execution uses `execFile` with an args array (never a shell string) to avoid injection.
- `beepify init` is unchanged. All interactivity lives in the new `beepify setup`.
- Commits in this repo do NOT add a `Co-Authored-By` trailer.
- Tests colocate under `test/` mirroring `src/`. Run the full suite with `npm test`; typecheck with `npm run typecheck`.

## File Structure

```
src/channels/desktop/
  types.ts             DesktopProvider, Runner, RunResult, Probe, SelectCtx
  osascript.ts         osascriptScript() + makeOsascriptProvider(run)
  terminal-notifier.ts terminalNotifierArgs() + makeTerminalNotifierProvider(run)
  open-island.ts       openIslandPayload() + makeOpenIslandProvider(run, detect)
  detect.ts            detectOpenIsland(deps) + realProbe()
  run.ts               defaultRun (execFile Runner)
  select.ts            selectProvider(name, ctx)
  index.ts             desktopChannel: Channel  (wires defaults, delegates)
src/cli/
  setup-core.ts        SetupAnswers, buildConfigObject(), validation helpers
  setup.ts             runSetup(io, deps) readline shell
```

Modified: `src/cli/commands.ts` (register desktop channel), `src/cli/index.ts` (`setup` command + version), `config.example.toml`, `README.md`, `README.zh-CN.md`, `package.json`.

---

### Task 1: osascript provider

**Files:**
- Create: `src/channels/desktop/types.ts`
- Create: `src/channels/desktop/osascript.ts`
- Test: `test/channels/desktop/osascript.test.ts`

**Interfaces:**
- Produces: `RunResult = { code: number; stderr: string }`; `Runner = (file: string, args: string[], input?: string) => Promise<RunResult>`; `DesktopProvider = (msg: RenderedMessage, cfg: ChannelConfig) => Promise<{ ok: boolean; error?: string }>`; `Probe = (bin: string) => boolean`; `osascriptScript(title, body, sound?) => string`; `makeOsascriptProvider(run: Runner) => DesktopProvider`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channels/desktop/osascript.test.ts`
Expected: FAIL — cannot find module `osascript` / `types`.

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/channels/desktop/osascript.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channels/desktop/types.ts src/channels/desktop/osascript.ts test/channels/desktop/osascript.test.ts
git commit -m "feat(desktop): osascript provider with escaped notification script"
```

---

### Task 2: terminal-notifier provider

**Files:**
- Create: `src/channels/desktop/terminal-notifier.ts`
- Test: `test/channels/desktop/terminal-notifier.test.ts`

**Interfaces:**
- Consumes: `Runner`, `DesktopProvider` from `./types`.
- Produces: `terminalNotifierArgs(msg: RenderedMessage) => string[]`; `makeTerminalNotifierProvider(run: Runner) => DesktopProvider`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channels/desktop/terminal-notifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

> Import `RenderedMessage` from `../../core/types` (it is NOT re-exported from `./types`); import `Runner`/`DesktopProvider` from `./types`.

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/channels/desktop/terminal-notifier.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channels/desktop/terminal-notifier.ts test/channels/desktop/terminal-notifier.test.ts
git commit -m "feat(desktop): terminal-notifier provider"
```

---

### Task 3: open-island provider

**Files:**
- Create: `src/channels/desktop/open-island.ts`
- Test: `test/channels/desktop/open-island.test.ts`

**Interfaces:**
- Consumes: `Runner`, `DesktopProvider` from `./types`; `NormalizedEvent` from `../../core/types`.
- Produces: `openIslandPayload(event: NormalizedEvent) => string`; `makeOpenIslandProvider(run: Runner, detect: () => string) => DesktopProvider`. `detect()` returns a resolved command path or `''`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channels/desktop/open-island.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/channels/desktop/open-island.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channels/desktop/open-island.ts test/channels/desktop/open-island.test.ts
git commit -m "feat(desktop): open-island provider with stdin payload passthrough"
```

---

### Task 4: Open Island detection

**Files:**
- Create: `src/channels/desktop/detect.ts`
- Test: `test/channels/desktop/detect.test.ts`

**Interfaces:**
- Consumes: `Probe` from `./types`.
- Produces: `detectOpenIsland(deps: { probe: Probe; exists: (p: string) => boolean; home: string }) => { installed: boolean; command?: string }`; `realProbe(bin: string) => boolean`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channels/desktop/detect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/channels/desktop/detect.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channels/desktop/detect.ts test/channels/desktop/detect.test.ts
git commit -m "feat(desktop): detectOpenIsland (PATH then ~/.local/bin)"
```

---

### Task 5: Provider selection, default runner, desktop channel, registration

**Files:**
- Create: `src/channels/desktop/run.ts`
- Create: `src/channels/desktop/select.ts`
- Create: `src/channels/desktop/index.ts`
- Modify: `src/cli/commands.ts` (register the channel)
- Test: `test/channels/desktop/select.test.ts`, `test/channels/desktop/index.test.ts`

**Interfaces:**
- Consumes: all four providers, `detectOpenIsland`, `realProbe`, `Runner`, `Probe`, `DesktopProvider`.
- Produces: `defaultRun: Runner`; `selectProvider(name: string, ctx: SelectCtx) => DesktopProvider | { error: string }` where `SelectCtx = { platform: NodeJS.Platform; probe: Probe; run: Runner; detect: () => string }`; `desktopChannel: Channel`.

- [ ] **Step 1: Write the failing test**

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
import { describe, it, expect, vi } from 'vitest'
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/channels/desktop/select.test.ts test/channels/desktop/index.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

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

Register it in `src/cli/commands.ts`:

```ts
// add import near the other channel imports
import { desktopChannel } from '../channels/desktop'

// inside registerBuiltins(), after registerChannel(ntfyChannel)
  registerChannel(desktopChannel)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/channels/desktop/ && npm run typecheck`
Expected: PASS (all desktop tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/channels/desktop/run.ts src/channels/desktop/select.ts src/channels/desktop/index.ts src/cli/commands.ts test/channels/desktop/select.test.ts test/channels/desktop/index.test.ts
git commit -m "feat(desktop): provider selection + channel wiring + registration"
```

---

### Task 6: Default-runner smoke test + desktop docs

**Files:**
- Test: `test/channels/desktop/run.test.ts`
- Modify: `config.example.toml`, `README.md`, `README.zh-CN.md`

**Interfaces:**
- Consumes: `defaultRun` from `./run`.

- [ ] **Step 1: Write the failing test**

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
    // `cat` echoes stdin to stdout and exits 0; we only assert it consumed input without error
    expect((await defaultRun('cat', [], 'hello')).code).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run test/channels/desktop/run.test.ts`
Expected: PASS immediately (implementation already exists from Task 5). If a shell lacks `true`/`false`/`cat`, this smoke test is environment-dependent — they are POSIX standard and present on macOS/Linux.

- [ ] **Step 3: Document the channel — `config.example.toml`**

Append:

```toml
# Desktop notifications (macOS). provider = "native" (Notification Center) or
# "open-island" (drives the Dynamic Island app; needs Open Island installed).
# [[channels]]
# type = "desktop"
# provider = "native"
# sound = ""               # optional; native only
# open_island_command = "" # optional; auto-detected if empty
```

- [ ] **Step 4: Document the channel — READMEs**

Add a "Desktop notifications" subsection to `README.md` and `README.zh-CN.md` describing the two providers and that `open-island` requires the separately-installed app.

`README.md`:

```markdown
### Desktop notifications (macOS)

Add a `desktop` channel to get native macOS notifications:

```toml
[[channels]]
type = "desktop"
provider = "native"        # Notification Center (uses terminal-notifier if installed, else osascript)
```

Set `provider = "open-island"` to drive the [Open Island](https://github.com/) Dynamic Island app instead (install it separately; Beepify auto-detects `open-island-hooks.py`).
```

`README.zh-CN.md`:

```markdown
### 桌面通知(macOS)

加一个 `desktop` channel 即可收到 macOS 原生通知:

```toml
[[channels]]
type = "desktop"
provider = "native"        # 通知中心(装了 terminal-notifier 就用它,否则 osascript)
```

把 `provider` 设为 `"open-island"` 可改为驱动 Open Island 灵动岛 app(需另外安装;Beepify 会自动探测 `open-island-hooks.py`)。
```

- [ ] **Step 5: Commit**

```bash
git add test/channels/desktop/run.test.ts config.example.toml README.md README.zh-CN.md
git commit -m "test(desktop): defaultRun smoke test; docs: desktop channel"
```

---

### Task 7: Setup wizard pure core

**Files:**
- Create: `src/cli/setup-core.ts`
- Test: `test/cli/setup-core.test.ts`

**Interfaces:**
- Produces:
  - `type ChannelAnswer = { type: 'bark'; key: string; server?: string; icon?: string } | { type: 'ntfy'; topic: string; server?: string } | { type: 'desktop'; provider: 'native' | 'open-island'; open_island_command?: string }`
  - `interface SetupAnswers { locale: 'en' | 'zh-CN'; notify_idle: boolean; channels: ChannelAnswer[] }`
  - `buildConfigObject(a: SetupAnswers) => Record<string, unknown>`
  - `renderConfigToml(a: SetupAnswers) => string`
  - `normalizeLocale(s: string, fallback: 'en' | 'zh-CN') => 'en' | 'zh-CN'`
  - `normalizeProvider(s: string) => 'native' | 'open-island'`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/setup-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli/setup-core.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/setup-core.ts test/cli/setup-core.test.ts
git commit -m "feat(setup): pure config-object builder + normalizers"
```

---

### Task 8: Setup wizard shell + CLI wiring + version bump

**Files:**
- Create: `src/cli/setup.ts`
- Modify: `src/cli/index.ts` (add `setup` command; bump `VERSION` to `0.2.0`)
- Modify: `package.json` (version `0.2.0`)
- Test: `test/cli/setup.test.ts`

**Interfaces:**
- Consumes: `SetupAnswers`, `ChannelAnswer`, `renderConfigToml`, `normalizeLocale`, `normalizeProvider` from `./setup-core`; `detectOpenIsland`, `realProbe` from `../channels/desktop/detect`; `loadConfig`, `defaultConfigPath` from `../config/load`; `runInit`, `runTest` from `./commands`.
- Produces: `interface SetupIO { ask(question: string, def?: string): Promise<string>; print(s: string): void }`; `runSetup(io: SetupIO, deps: { configPath: string; existing?: BeepifyConfig; detect?: () => { installed: boolean; command?: string } }) => Promise<SetupAnswers>`.

Note: `runSetup` returns the collected `SetupAnswers` (so it is unit-testable with a scripted IO); the `beepify setup` command in `index.ts` calls it, writes the file, then optionally installs the hook and runs the test push. Keep file-writing and hook/test side effects in `index.ts`, not in `runSetup`, so the core stays pure-ish and testable.

- [ ] **Step 1: Write the failing test**

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
    // Script: locale -> add channel? yes -> type bark -> key -> server -> icon -> add another? no -> notify_idle? no
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/setup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

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

Wire the command in `src/cli/index.ts` — bump version and add the branch:

```ts
const VERSION = '0.2.0' // keep in sync with package.json
```

```ts
// add these NEW imports at top. (index.ts ALREADY imports join, homedir,
// loadConfig, defaultConfigPath, runTest, runInit — do NOT re-import those.)
import { createInterface } from 'node:readline'
import { writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { runSetup, type SetupIO } from './setup'
import { renderConfigToml } from './setup-core'
import { detectOpenIsland, realProbe } from '../channels/desktop/detect'
```

```ts
// add this command branch before the `--version` branch
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

No import changes are needed for `runTest`, `runInit`, `join`, `homedir`, `loadConfig`, or `defaultConfigPath` — `index.ts` already imports all of them (see its current top-of-file imports).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run test/cli/setup.test.ts && npm run typecheck`
Expected: PASS (2 tests), typecheck clean.

- [ ] **Step 5: Update `package.json` version and commit**

Set `"version": "0.2.0"` in `package.json`.

```bash
git add src/cli/setup.ts src/cli/index.ts package.json test/cli/setup.test.ts
git commit -m "feat(setup): interactive beepify setup wizard + bump to 0.2.0"
```

---

### Task 9: Setup docs + full-suite green + build

**Files:**
- Modify: `README.md`, `README.zh-CN.md`

- [ ] **Step 1: Document `beepify setup` — READMEs**

Add a "Quick start" note in both READMEs:

`README.md`:

```markdown
## Quick start

```bash
npm install -g @elbc/beepify
beepify setup   # interactive: pick language, add channels, install the hook, send a test
```

`beepify setup` edits an existing config in place (current values shown as defaults). `beepify init` remains the non-interactive path for scripts.
```

`README.zh-CN.md`:

```markdown
## 快速开始

```bash
npm install -g @elbc/beepify
beepify setup   # 交互式:选语言、加 channel、装 hook、发测试
```

`beepify setup` 会就地编辑现有配置(当前值作默认)。`beepify init` 仍是脚本用的非交互路径。
```

- [ ] **Step 2: Run the full suite, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests PASS, typecheck clean, `dist/` builds.

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: document beepify setup wizard"
```

- [ ] **Step 4: Manual verification checklist (not automated)**

- `node dist/cli/index.js --version` prints `0.2.0`.
- With a `desktop`/`native` channel configured, `beepify test` shows a macOS notification.
- `beepify setup` round-trips: run once, re-run, confirm current values appear as defaults and the config still parses.

---

## Self-Review Notes

- **Spec coverage:** desktop channel (Tasks 1–6), provider seam (Task 5 `selectProvider` + platform guard), osascript/terminal-notifier/open-island (Tasks 1–3), detect-not-install (Tasks 4, 8), edit-aware wizard (Tasks 7–8), test-push closer (Task 8 index wiring), docs bilingual (Tasks 6, 9), v0.2.0 + version sync (Task 8). Linux/Windows explicitly deferred (Task 5 returns an error for non-darwin native — the seam, not a backend).
- **No-throw invariant:** every provider and the channel return result objects; `dispatch` already wraps `send` in try/catch as a backstop.
- **Type consistency:** `Runner`, `DesktopProvider`, `SetupAnswers`, `ChannelAnswer` names are used identically across tasks; `RenderedMessage` is always imported from `../../core/types` (never re-exported from `./types`).
```
