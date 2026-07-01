# Beepify v3 — Codex Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Chinese version: [`2026-07-02-beepify-v3-codex-support.zh-CN.md`](./2026-07-02-beepify-v3-codex-support.zh-CN.md)
> Design spec: [`../design/2026-07-01-beepify-v3-codex-support-design.md`](../design/2026-07-01-beepify-v3-codex-support-design.md)

**Goal:** Add `--source codex` so the OpenAI Codex CLI can trigger Beepify through its `[hooks]` lifecycle system, reusing the existing Bark / ntfy / desktop channels.

**Architecture:** Codex `[hooks]` deliver one JSON object on stdin keyed on `hook_event_name` — structurally the same envelope as Claude Code, so the existing `beepify notify` stdin path is reused verbatim with no new argv layer. A new `codex` source parses `Stop` → done and `PermissionRequest` → needs-approval. Wiring appends an idempotent managed block to `~/.codex/config.toml`. The `init` command gains `--agent`, and the `setup` wizard gains a multi-select over agents.

**Tech Stack:** TypeScript / ESM (NodeNext), Node ≥18, vitest, tsup, smol-toml (only runtime dep; provides `parse` + `stringify`).

## Global Constraints

- Runtime dependencies limited to `smol-toml`. No new runtime deps.
- No unit test spawns a real process.
- A Beepify command run as a Codex hook MUST always exit 0 with empty stdout — Codex treats exit 2 as "block the session". The existing dispatch already never throws; keep it that way for the codex path.
- Codex hooks are wired into the **user-level** `~/.codex/config.toml` (repo-level `.codex/` has a known non-firing bug, openai/codex #17532).
- Managed-block markers are exactly `# >>> beepify (managed) >>>` and `# <<< beepify (managed) <<<`.
- The Codex hook command string is exactly `beepify notify --source codex` (bare `beepify`, matching the Claude Code `HOOK_COMMAND` convention).
- Back-compat: `beepify init` with no flags keeps installing the Claude Code hook exactly as before.

---

## File Structure

- **Create `src/sources/shared.ts`** — `resolveHost()` and `toolDesc()` (plus their private helpers), extracted from `claude-code.ts` so both sources share them without a reverse dependency.
- **Modify `src/sources/claude-code.ts`** — import the two helpers from `./shared`, re-export them for back-compat.
- **Create `src/sources/codex.ts`** — the `codexSource` parser.
- **Modify `src/cli/commands.ts`** — register `codexSource`; extract `ensureBeepifyConfig()`; add `runInitCodex()`.
- **Create `src/config/codex-toml.ts`** — managed-block render/upsert/remove + `installCodexHook` / `uninstallCodexHook`.
- **Modify `src/cli/setup-core.ts`** — `AgentName`, `normalizeAgents()`, `SetupAnswers.agents`.
- **Modify `src/cli/setup.ts`** — ask the agent multi-select.
- **Modify `src/cli/index.ts`** — `init --agent`, wizard acts on `answers.agents`, VERSION bump.
- **Modify** `package.json`, `README.md`, `README.zh-CN.md`, `config.example.toml`.

---

## Task 1: Extract shared source helpers

**Files:**
- Create: `src/sources/shared.ts`
- Modify: `src/sources/claude-code.ts` (remove the moved definitions; import + re-export)
- Test: `test/sources/shared.test.ts`

**Interfaces:**
- Produces: `resolveHost(env?: NodeJS.ProcessEnv): string`, `toolDesc(b: unknown): string` — both exported from `src/sources/shared.ts`.
- `claude-code.ts` continues to export `toolDesc` and `resolveHost` (re-export) so `test/sources/claude-code.test.ts` keeps compiling.

- [ ] **Step 1: Write the failing test**

Create `test/sources/shared.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sources/shared.test.ts`
Expected: FAIL — cannot find module `../../src/sources/shared`.

- [ ] **Step 3: Create `src/sources/shared.ts` with the moved code**

Move the following verbatim out of `claude-code.ts` into a new `src/sources/shared.ts`: `STRING_KEYS`, `RECOVER_KEYS`, `firstFieldFromRaw`, `toolDesc`, `resolveHost`. Keep `execFileSync` imported here (needed by `resolveHost`).

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

- [ ] **Step 4: Update `claude-code.ts` to import + re-export the helpers**

In `src/sources/claude-code.ts`: delete the moved definitions (`STRING_KEYS`, `RECOVER_KEYS`, `firstFieldFromRaw`, `toolDesc`, `resolveHost`) and the now-unused `execFileSync` import. At the top, add:

```ts
import { resolveHost, toolDesc } from './shared'
// re-export for back-compat with existing importers/tests
export { toolDesc, resolveHost } from './shared'
```

Keep the remaining `claude-code.ts` code (`readFileSync`, `basename` imports, `parseTranscript`, `claudeCodeSource`) unchanged — `parseTranscript` still calls the now-imported `toolDesc`, and `claudeCodeSource` still calls the now-imported `resolveHost`.

- [ ] **Step 5: Run the full suite to verify nothing regressed**

Run: `npx vitest run test/sources/shared.test.ts test/sources/claude-code.test.ts`
Expected: PASS (new shared test + all existing claude-code tests green).

- [ ] **Step 6: Commit**

```bash
git add src/sources/shared.ts src/sources/claude-code.ts test/sources/shared.test.ts
git commit -m "refactor: extract resolveHost/toolDesc into sources/shared"
```

---

## Task 2: Codex source parser + registration

**Files:**
- Create: `src/sources/codex.ts`
- Modify: `src/cli/commands.ts` (register the source)
- Test: `test/sources/codex.test.ts`

**Interfaces:**
- Consumes: `resolveHost`, `toolDesc` from `src/sources/shared.ts`; `Source`, `NormalizedEvent`, `BeepifyConfig` from `src/core/types`.
- Produces: `export const codexSource: Source` (name `'codex'`). Registered inside `registerBuiltins()` so `getSource('codex')` resolves and `beepify notify --source codex` works with no CLI change.

- [ ] **Step 1: Write the failing test**

Create `test/sources/codex.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sources/codex.test.ts`
Expected: FAIL — cannot find module `../../src/sources/codex`.

- [ ] **Step 3: Create `src/sources/codex.ts`**

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

- [ ] **Step 4: Register the source in `commands.ts`**

In `src/cli/commands.ts`, add the import near the other source import:

```ts
import { codexSource } from '../sources/codex'
```

and inside `registerBuiltins()`, after `registerSource(claudeCodeSource)`:

```ts
  registerSource(codexSource)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/sources/codex.test.ts`
Expected: PASS (all four parse cases + registration).

- [ ] **Step 6: Commit**

```bash
git add src/sources/codex.ts src/cli/commands.ts test/sources/codex.test.ts
git commit -m "feat: add codex source (Stop -> done, PermissionRequest -> needs-approval)"
```

---

## Task 3: Codex `config.toml` managed-block wiring

**Files:**
- Create: `src/config/codex-toml.ts`
- Test: `test/config/codex-toml.test.ts`

**Interfaces:**
- Produces:
  - `CODEX_HOOK_COMMAND: string` = `'beepify notify --source codex'`
  - `renderCodexHookBlock(command?: string): string` — the marked TOML block.
  - `upsertManagedBlock(existing: string, block: string): string` — idempotent insert/replace.
  - `removeManagedBlock(existing: string): { text: string; changed: boolean }`
  - `installCodexHook(configPath: string, command?: string, now?: number): { changed: boolean; backup?: string }`
  - `uninstallCodexHook(configPath: string): { changed: boolean }`

- [ ] **Step 1: Write the failing test**

Create `test/config/codex-toml.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/codex-toml.test.ts`
Expected: FAIL — cannot find module `../../src/config/codex-toml`.

- [ ] **Step 3: Create `src/config/codex-toml.ts`**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/codex-toml.test.ts`
Expected: PASS (all render / upsert / remove / install / uninstall cases).

- [ ] **Step 5: Commit**

```bash
git add src/config/codex-toml.ts test/config/codex-toml.test.ts
git commit -m "feat: idempotent codex config.toml managed-block wiring"
```

---

## Task 4: `runInitCodex` + `init --agent`

**Files:**
- Modify: `src/cli/commands.ts` (extract `ensureBeepifyConfig`, add `runInitCodex`)
- Modify: `src/cli/index.ts` (parse `--agent`, dispatch to codex path)
- Test: `test/cli/commands.test.ts` (add codex-init cases)

**Interfaces:**
- Consumes: `installCodexHook`, `uninstallCodexHook` from `src/config/codex-toml`.
- Produces: `runInitCodex(opts: { codexConfigPath: string; beepifyConfigPath: string; uninstall?: boolean }): { hook: { changed: boolean; backup?: string }; configCreated: boolean }`.
- `ensureBeepifyConfig(configPath: string): boolean` — private to `commands.ts`, reused by both `runInit` and `runInitCodex`.

- [ ] **Step 1: Write the failing test**

`test/cli/commands.test.ts` already exists and already imports `mkdtempSync, writeFileSync, existsSync, readFileSync` from `node:fs`, `tmpdir`, and `join`. Do NOT re-import them. Add `runInitCodex` to the existing commands import line:

```ts
import { registerBuiltins, runNotify, runInit, runInitCodex, runDoctor } from '../../src/cli/commands'
```

Then append this `describe` block to the file:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/commands.test.ts`
Expected: FAIL — `runInitCodex` is not exported from `commands.ts`.

- [ ] **Step 3: Extract `ensureBeepifyConfig` and add `runInitCodex` in `commands.ts`**

At the top of `src/cli/commands.ts`, add the import:

```ts
import { installCodexHook, uninstallCodexHook } from '../config/codex-toml'
```

Add the extracted helper (place it above `runInit`):

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

Replace the config-scaffold block inside `runInit` (the `let configCreated = false … configCreated = true }` section) with a single call:

```ts
  const configCreated = ensureBeepifyConfig(opts.configPath)
```

so `runInit` becomes:

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

Add `runInitCodex` immediately after `runInit`:

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `init --agent` in `index.ts`**

In `src/cli/index.ts`, add `runInitCodex` to the commands import:

```ts
import { registerBuiltins, runNotify, runTest, runInit, runInitCodex, runDoctor } from './commands'
```

Replace the `if (cmd === 'init') { … }` block with:

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

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: PASS (typecheck clean; all tests green).

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands.ts src/cli/index.ts test/cli/commands.test.ts
git commit -m "feat: beepify init --agent codex wiring"
```

---

## Task 5: Setup wizard agent multi-select

**Files:**
- Modify: `src/cli/setup-core.ts` (`AgentName`, `normalizeAgents`, `SetupAnswers.agents`)
- Modify: `src/cli/setup.ts` (ask the multi-select)
- Modify: `src/cli/index.ts` (act on `answers.agents`)
- Test: `test/cli/setup-core.test.ts`, `test/cli/setup.test.ts`

**Interfaces:**
- Produces: `AgentName = 'claude-code' | 'codex'`; `normalizeAgents(s: string): AgentName[]`; `SetupAnswers` gains `agents: AgentName[]`.
- `runSetup` now asks one extra question and returns `agents` in its result. `agents` is NOT written into `config.toml` (it drives wiring only), so `buildConfigObject` / `renderConfigToml` are unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `test/cli/setup-core.test.ts`:

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

Update the two existing tests in `test/cli/setup.test.ts` to supply the new agents answer and assert it. Replace the first test body's scripted array and add an assertion:

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

and the second test:

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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/cli/setup-core.test.ts test/cli/setup.test.ts`
Expected: FAIL — `normalizeAgents` missing; `answers.agents` undefined.

- [ ] **Step 3: Extend `setup-core.ts`**

In `src/cli/setup-core.ts`, add above `SetupAnswers`:

```ts
export type AgentName = 'claude-code' | 'codex'

export function normalizeAgents(s: string): AgentName[] {
  const t = s.trim().toLowerCase()
  if (t === '2' || t === 'codex') return ['codex']
  if (t === '3' || t === 'both') return ['claude-code', 'codex']
  return ['claude-code']
}
```

and add `agents` to the interface:

```ts
export interface SetupAnswers {
  locale: 'en' | 'zh-CN'
  notify_idle: boolean
  agents: AgentName[]
  channels: ChannelAnswer[]
}
```

(Leave `buildConfigObject` / `renderConfigToml` unchanged — `agents` is not part of the runtime config.)

- [ ] **Step 4: Ask the multi-select in `setup.ts`**

In `src/cli/setup.ts`, update the import:

```ts
import { normalizeLocale, normalizeProvider, normalizeAgents } from './setup-core'
```

Replace the final two lines of `runSetup` (the `notify_idle` line and `return`) with:

```ts
  const notify_idle = yes(await io.ask('Send the ~60s idle reminder too? (y/n)', cur?.notify_idle ? 'y' : 'n'))
  const agents = normalizeAgents(
    await io.ask('Which coding agents to wire up? 1) Claude Code  2) Codex  3) both', '1'),
  )
  return { locale, notify_idle, agents, channels }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/cli/setup-core.test.ts test/cli/setup.test.ts`
Expected: PASS.

- [ ] **Step 6: Act on `answers.agents` in `index.ts`**

In `src/cli/index.ts`, inside the `if (cmd === 'setup')` block, replace the single hook-install prompt:

```ts
    if (/^y/i.test(await io.ask('Install the Claude Code hook now? (y/n)', 'y'))) {
      const settingsPath = join(homedir(), '.claude', 'settings.json')
      const r = runInit({ settingsPath, configPath, uninstall: false })
      console.log(r.hook.changed ? 'Installed Beepify hook.' : 'Hook already installed.')
    }
```

with an iteration over the selected agents:

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

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cli/setup-core.ts src/cli/setup.ts src/cli/index.ts test/cli/setup-core.test.ts test/cli/setup.test.ts
git commit -m "feat: setup wizard multi-selects agents (Claude Code / Codex)"
```

---

## Task 6: Docs, help text, version bump

**Files:**
- Modify: `src/cli/index.ts` (VERSION, HELP text)
- Modify: `package.json` (version)
- Modify: `README.md`, `README.zh-CN.md`, `config.example.toml`

**Interfaces:** none (docs + constants).

- [ ] **Step 1: Bump the version in two places**

In `src/cli/index.ts`:

```ts
const VERSION = '0.3.0' // keep in sync with package.json
```

In `package.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 2: Update the HELP text in `index.ts`**

Replace the `init` line inside the `HELP` template literal:

```
  init [--agent codex] [--uninstall]   scaffold config + install a hook (Claude Code by default, or Codex)
```

- [ ] **Step 3: Add a Codex note to `config.example.toml`**

Append at the end of `config.example.toml`:

```toml
# Codex CLI: channels above are shared. To let Codex trigger Beepify, run
#   beepify init --agent codex   (or choose Codex in `beepify setup`)
# which wires a managed [hooks] block into ~/.codex/config.toml.
```

- [ ] **Step 4: Add a Codex section to `README.md`**

Under the existing agent/install documentation, add:

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

- [ ] **Step 5: Add the matching Codex section to `README.zh-CN.md`**

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

- [ ] **Step 6: Verify build, typecheck, and the full suite**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: PASS — typecheck clean, all tests green, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts package.json README.md README.zh-CN.md config.example.toml
git commit -m "docs: document Codex support; bump to 0.3.0"
```

---

## Completion

After all tasks: use superpowers:finishing-a-development-branch to verify tests, then push `feat/v3-codex-support` and open a PR. Recommended merge type: **squash** (keeps `main` history one-commit-per-feature, matching prior Beepify PRs). Do not publish 0.3.0 to npm until the PR is merged and the user confirms.
