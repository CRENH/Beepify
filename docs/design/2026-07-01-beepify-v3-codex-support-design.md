# Beepify v3 — Codex Support Design

> Chinese version: [`2026-07-01-beepify-v3-codex-support-design.zh-CN.md`](./2026-07-01-beepify-v3-codex-support-design.zh-CN.md)

**Status:** Approved for planning
**Date:** 2026-07-01
**Scope:** Add Codex CLI as a second notification source. OpenCode and Linux/Windows desktop providers are explicitly deferred to v4.

## 1. Goal

Let the OpenAI **Codex CLI** trigger Beepify through its `[hooks]` lifecycle
system, reusing the existing Bark / ntfy / desktop channels. After v3 a single
Beepify install serves both Claude Code and Codex, sharing one channel
configuration.

## 2. Background — why `[hooks]`, not `notify`

Codex exposes two external-integration mechanisms:

- **`notify`** — a `config.toml` root key that spawns a command with the event
  JSON on `argv[1]`. It fires **only** `agent-turn-complete` (a "done" signal).
  It cannot deliver approval / waiting events.
- **`[hooks]`** — a lifecycle-hook engine, GA and on by default, that is a near
  clone of Claude Code's hook model: **one JSON object on stdin**, keyed on
  `hook_event_name`, with `Stop`, `PermissionRequest`, `UserPromptSubmit`, and
  more.

Beepify's most valuable signal is "needs approval". Only `[hooks]` delivers it,
so v3 wires Codex through `[hooks]`. A welcome consequence: because `[hooks]`
delivers JSON on **stdin** — exactly like Claude Code — v3 needs **no new argv
input layer**. The existing `beepify notify` stdin path is reused verbatim.

## 3. Event mapping (the contract)

Codex hook payloads arrive on stdin and are dispatched on `hook_event_name`:

| Codex event | Key fields | → `NormalizedEvent` |
|---|---|---|
| `Stop` | `last_assistant_message`, `cwd` | `kind: 'done'`, `summary = last_assistant_message` |
| `PermissionRequest` | `tool_name`, `tool_input` (`.command`, `.description`) | `kind: 'needs-approval'`, `action = toolDesc({ name, input })` |
| anything else | — | `null` (ignored) |

Common to every produced event:
`agent: 'codex'`, `project = basename(cwd)`, `host = resolveHost()`,
`ts = Date.now()`, `raw = <the payload>`.

Notes:

- **No transcript parsing.** `Stop` carries `last_assistant_message` directly and
  `PermissionRequest` carries `tool_name` / `tool_input` directly — simpler than
  the Claude Code source, which reconstructs these from the transcript.
- Codex has **no** `Notification` / idle event in upstream, so the Codex source
  produces only `done` and `needs-approval` — the two highest-value kinds. There
  is no `waiting-input` for Codex.
- `PermissionRequest.tool_input` maps onto the `input` slot of the existing
  `toolDesc({ name, input })` helper, so approval descriptions render through the
  same code path as Claude Code (`Bash: rm -rf …`, etc.).

## 4. Components

### 4.1 `src/sources/shared.ts` (new — extract)

Move `resolveHost()` and `toolDesc()` out of `src/sources/claude-code.ts` into a
shared module. `claude-code.ts` re-imports them; its behaviour is unchanged.

Rationale: the Codex source reuses both helpers. Extraction avoids a reverse
dependency from `codex.ts` onto `claude-code.ts`. This is a targeted refactor
justified by the new consumer, not a broad restructuring.

`toolDesc()`'s Claude-specific `__unparsedToolInput` recovery is harmless for
Codex payloads (they never carry that field) — it simply reads `name` + `input`,
which Codex satisfies via `tool_name` + `tool_input`.

### 4.2 `src/sources/codex.ts` (new)

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

(`agent` is typed `string` in `NormalizedEvent`; the `as const` is illustrative.)

### 4.3 `src/cli/commands.ts` (modify)

Add `import { codexSource } from '../sources/codex'` and
`registerSource(codexSource)` inside `registerBuiltins()`. `--source codex` then
resolves through the existing `getSource`, and the stdin read path is unchanged —
`beepify notify --source codex` works with no further CLI changes.

## 5. Wiring — writing `~/.codex/config.toml`

The Codex hook command is `beepify notify --source codex`, resolved with the same
binary-path logic the Claude Code `init` already uses.

### 5.1 Managed-block strategy

The user's `config.toml` may hold hand-written content and comments. Rather than
round-trip through `smol-toml` (which would reorder keys and drop comments),
Beepify appends an idempotent **marked block**:

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

- **Idempotent merge** (`upsertManagedBlock(existing, block)`): if the marker
  pair is present, replace the content between the markers; otherwise append the
  block to end-of-file. Appending only tables (no root keys) is always valid
  TOML, since root keys must precede all tables and the existing file already
  satisfies that.
- **Backup before write:** copy to `config.toml.beepify-bak.<ts>` (same pattern
  as the v2 `config.toml` backup).
- **User-level path:** write to `~/.codex/config.toml`. Repo-level `.codex/`
  hooks have a known non-firing bug in interactive sessions (openai/codex
  #17532), so user-level is the reliable target.

### 5.2 Exit-code safety (hard constraint)

The Codex hook runner treats **exit 2 as "block the session"** (deny a tool,
block a prompt, force turn continuation). Beepify's notify command run as a Codex
hook must therefore **always exit 0 with empty stdout**, even on channel failure.
This matches the existing dispatch design (channel failures never throw); the
constraint is documented in `codex.ts` and the notify path so it is not
regressed. Keep dispatch within the hook `timeout` (default handled by Codex).

## 6. Commands & wizard

### 6.1 `beepify init` (modify)

Add `--agent <claude-code|codex>`, defaulting to `claude-code` for backward
compatibility. `--agent codex` performs the §5 `config.toml` wiring;
`--agent claude-code` is the current behaviour unchanged.

### 6.2 `beepify setup` wizard (modify)

After channel collection, add one step: **"Which coding agents should Beepify
wire up?"** — a multi-select over `Claude Code` and `Codex`. For each selected
agent the wizard installs its hook (Claude Code → `settings.json`; Codex →
`~/.codex/config.toml`). Channels are shared across all selected agents, so a
user configures Bark/ntfy/desktop once and every agent reuses it.

Edit-mode behaviour (from v2) is preserved: re-running `setup` shows existing
answers as editable defaults.

## 7. Testing

Follows the existing suite conventions; no unit test spawns a real process.

- **`test/sources/codex.test.ts`**: `Stop` → `done` (summary from
  `last_assistant_message`); `PermissionRequest` → `needs-approval` (action via
  `toolDesc`, e.g. `Bash: rm -rf /tmp/build`); unknown `hook_event_name` → `null`;
  missing `cwd` falls back to `process.cwd()`.
- **`test/sources/shared.test.ts`**: `resolveHost` / `toolDesc` behaviour after
  extraction (or keep coverage via the existing claude-code tests plus a thin new
  test asserting the shared exports).
- **Wiring tests** (`test/cli/codex-wiring.test.ts`): pure
  `renderCodexHookBlock()` output; `upsertManagedBlock()` across three cases —
  empty file, file with unrelated content, file already containing a managed
  block (idempotent replace).
- **Wizard tests**: extend the scripted-IO `setup` tests to cover the agent
  multi-select producing the right set of wiring calls.

## 8. Out of scope (v4)

- **OpenCode**: integrate via a TypeScript plugin dropped in
  `~/.config/opencode/plugins/` that, on `session.idle` / `permission.asked`,
  spawns `beepify notify --source opencode` and pipes the event JSON on stdin
  (reusing the same stdin path). No new transport required.
- **Linux / Windows desktop providers** for the desktop channel.

These are named here only to confirm the v3 architecture leaves room for them; no
v3 code targets them.
