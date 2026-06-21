# Beepify v1 — Design Spec

- **Status:** Approved (design), pending implementation plan
- **Date:** 2026-06-22
- **Scope:** v1 — one-way notification, Claude Code source, Bark + ntfy channels, CLI deliverable

---

## 1. Overview

Beepify turns the *state events* of AI coding agents into notifications a human can grok at a glance ("can I walk away from this run?"). It is, at its core, a **one-way event router**: agent-specific events come in on the left, get normalized and classified, and fan out to one or more push channels on the right.

v1 is the first dogfooding slice of a deliberately larger vision. It ships the smallest end-to-end path that still validates the plugin architecture, and reserves clean seams for everything deferred to v2+.

### Goals (v1)

- Replace the author's ad-hoc `notify-phone.sh` hook with a real, modular, open-sourceable tool.
- Deliver value on the author's own machine: Claude Code → phone push (Bark + ntfy).
- Prove the **Source** and **Channel** plugin abstractions by shipping two channels of *different API shapes* (Bark = URL-path; ntfy = JSON publish).
- Keep the core a **pure library** so a future daemon/HTTP ingress is purely additive.

### Non-goals (v1, reserved for v2+)

- No daemon / HTTP ingress (CLI ingress only).
- No bidirectional "approve from phone" (no tunnel/Transport layer).
- No central aggregation across multiple machines.
- Only one source implemented (`claude-code`); only two channels (`bark`, `ntfy`).
- No `error`-kind producer (Claude Code exposes no hook for usage-limit / system errors).

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Name | **Beepify** (npm `beepify`) |
| v1 surface | One-way notification only |
| Stack | Node / TypeScript (ESM) |
| v1 channels | Bark + ntfy |
| Runtime form | **CLI deliverable, core-as-library architecture** (daemon deferred, added later as a new ingress without breaking v1) |
| License | MIT |
| Docs language | English primary; `README.zh-CN.md` as a second language |

---

## 2. Architecture

A single one-way pipeline with pluggable ends and an agent-agnostic core.

```
  ingress                 core (pure library, stable API)            channels
┌──────────────┐   ┌──────────────────────────────────────────┐   ┌──────────┐
│ CLI          │   │  Source.parse(raw) → NormalizedEvent       │   │ bark     │
│ `beepify     │──▶│        → classify (in source)              │──▶│ ntfy     │
│  notify`     │   │        → render (template + flat)          │   │ (more…)  │
│ (stdin JSON) │   │        → debounce → dispatch (fan-out)     │   └──────────┘
└──────────────┘   └──────────────────────────────────────────┘
 [v2: HTTP/daemon ingress — additive, calls the same dispatch()]
```

### Layer responsibilities

| Layer | Does | Does NOT know |
|---|---|---|
| **ingress** | Hand external input (v1 = hook stdin JSON) to the core. Thin. | What the event means; where it gets pushed |
| **core** | `parse → NormalizedEvent → render → debounce → dispatch`. The soul. A **pure library**, callable by the CLI, a future daemon, or tests. | Whether it was invoked by CLI or daemon; any channel's API |
| **channels** | Take a rendered `{title, body}` and send it per their protocol. | How the event arrived or was classified |

### Key invariants

- `dispatch(event: NormalizedEvent, config): Promise<ChannelResult[]>` is the **single primary entry point** of the core. The CLI is just "read stdin → call dispatch"; a future daemon is "receive HTTP → call dispatch". **Adding a daemon = adding an ingress; core and channels are untouched.**
- **Source** and **Channel** are registered plugins (`name` + interface). The core only talks to the interfaces. Adding Cursor = a new source; adding OpenIsland/Windows = a new channel.
- One event can **fan out to multiple channels**; channels run in parallel and a single channel failure does not affect the others.

### Why "CLI deliverable + library architecture" is future-proof

The concern: does choosing CLI now make remote / multi-agent expensive later? No, because:

- **Remote one-way notification already works with the CLI model.** The push target (Bark / ntfy) is a *cloud* service. An agent running on any box with internet just runs `beepify notify` locally and the push reaches the phone. No daemon required.
- **Multi-agent is handled by the Source layer**, orthogonal to CLI-vs-daemon. v1 implements `claude-code`; others are added as source plugins.
- A daemon is only needed for **central aggregation** or **bidirectional** flows — both v2 — and is added later as a new ingress in front of the same `dispatch()`.

---

## 3. Core data model & classification

Two structures flow through the core.

### NormalizedEvent (Source output → core input)

```ts
type EventKind = 'done' | 'needs-approval' | 'waiting-input' | 'error'

interface NormalizedEvent {
  kind: EventKind
  agent: string      // 'claude-code'
  host: string       // ComputerName, e.g. SIRC-MBP2015
  project: string    // basename(cwd)
  summary?: string   // agent's last reply text
  action?: string    // pending tool/action description (used by needs-approval)
  raw?: unknown      // original hook JSON, for debugging / future channels
  ts: number
}
```

### RenderedMessage (core render output → channel input)

```ts
interface RenderedMessage {
  title: string
  body: string
  group?: string
  icon?: string
  event: NormalizedEvent   // passed through; a channel may read finer detail
}
```

### Classification ownership

Mapping `raw → kind` is **agent-specific semantics**, so it lives **in the Source** (Claude Code's Stop/Notification mapping is only true for Claude Code). The core only does agent-agnostic render / debounce / dispatch.

### claude-code source classification rules

| hook event | condition | → kind | body source |
|---|---|---|---|
| `Stop` | — | `done` | `summary`, fallback "`<project>` finished this round" |
| `Notification` | has a pending tool | `needs-approval` | `action` (structured extraction, see §5) |
| `Notification` | no tool | `waiting-input` | `summary`, fallback to hook `message` |

### Rendering (core)

Per `kind`, apply a title template. The template set is chosen by a `locale` config. **v1 ships two template sets: `en` (default) and `zh-CN`**; the templates are extracted so adding more locales later is trivial. Example (`en`):

- `done` → `✅ Done · {host}`
- `needs-approval` → `🔔 Needs approval · {host}`
- `waiting-input` → `💬 Waiting for you · {host}`
- `error` → `⚠️ Error · {host}` (reserved; no v1 producer)

The `zh-CN` set mirrors the author's existing pushes (`✅ 任务完成 · {host}`, `🔔 需要授权 · {host}`, `💬 在等你回复 · {host}`, `⚠️ 错误 · {host}`), so dogfooding keeps its Chinese titles.

Then select `body` per the table, then pass through `flat()`: collapse all whitespace (incl. newlines) to single spaces and truncate to the first 300 chars (append `…` if longer).

### Debounce (core)

Per `kind`, N seconds, via a stamp file. Default `debounce_seconds = 20`.

### `error` kind

Kept in the enum for forward-compat, but **v1's `claude-code` source never emits it** — Claude Code provides no hook for usage-limit / system errors. To be wired when a source/mechanism that can perceive errors exists.

---

## 4. Plugin interfaces & v1 implementations

### Interfaces

```ts
interface Source {
  name: string
  // Parse the hook's raw JSON. Return null = skip (e.g. bare tool_result, uninteresting events).
  parse(raw: unknown): NormalizedEvent | null
}

interface Channel {
  name: string
  send(msg: RenderedMessage, cfg: ChannelConfig): Promise<ChannelResult>
}

interface ChannelResult {
  channel: string
  ok: boolean
  skipped?: boolean   // not configured → skipped, NOT a failure
  error?: string
}
```

### Registry + dispatch fan-out

```
dispatch(event, config):
  msg = render(event, config)                 // template + flat()
  if debounced(event.kind): return [{ skipped: true }]
  enabled = config.channels ∩ registry         // registered AND configured
  return Promise.allSettled(enabled.map(ch => ch.send(msg, cfg)))   // parallel
```

- An unconfigured channel → `skipped`, not `error` (distinguish "off" from "send failed").
- `allSettled` guarantees that if Bark fails, ntfy still sends.

### v1 implementations

**`claude-code` source** — ports the existing shell logic to TS:

- Reads `{ hook_event_name, cwd, transcript_path, message }`.
- `host` via `scutil --get ComputerName` (child process), with `HOST_LABEL` override and `LocalHostName` / `hostname -s` fallbacks.
- Reads the transcript JSONL, extracts the last assistant text (`summary`) and the last pending tool, building `action` via `tool_desc`.
- `tool_desc` handles structured tools so distinct prompts produce distinct bodies:
  - `AskUserQuestion` → join each question's `header: question` (otherwise both notifications collapse to the bare tool name).
  - `ExitPlanMode` → the plan text.
  - generic tools → first non-empty string field among `command, file_path, path, url, query, pattern, plan, description, prompt`; final fallback = any non-empty string field, else the tool name.
- Classifies per the §3 table → `NormalizedEvent`.

**`bark` channel** — URL-path API:

- `${server}/${key}/${enc(title)}/${enc(body)}?group=Beepify&icon=…`
- **Critical invariant:** both `title` and `body` are fully percent-encoded **including `/`** (`encodeURIComponent`). Unencoded slashes in the body collide with Bark's `/key/title/body` path structure and silently drop the push. This is locked as a unit-test invariant so it can never regress.

**`ntfy` channel** — improvement over the shell version:

- Uses ntfy's **JSON publishing endpoint** (`POST ${server}` with body `{ topic, title, message }`) instead of the `Title:` header. ntfy headers are unfriendly to non-ASCII, so Chinese titles break over the header path; JSON publish carries Unicode titles reliably.

### Shared utilities

`core/http`: `enc()` (full percent-encode), retry (timeout + transient-failure retry, matching the existing `--retry` behavior), and a request timeout. All channels reuse it. Built on Node 18's global `fetch` (no HTTP dependency).

---

## 5. CLI surface, config & secrets

### CLI commands (deliberately minimal)

| command | purpose |
|---|---|
| `beepify notify --source claude-code` | **hook entry**: read stdin JSON → dispatch. This is what settings.json invokes. |
| `beepify init` | one-shot setup: scaffold config + install the hook into Claude Code's settings.json. |
| `beepify test` | send sample pushes of each kind (done / needs-approval / waiting-input) to verify channels. |
| `beepify doctor` | diagnostics: config present? channels reachable? hook installed? (secrets redacted) |

### Config & secrets

- Location: `~/.config/beepify/config.toml` (outside any repo → never committed; file mode `0600`).
- Format: **TOML** (comments, no YAML indentation traps). The OSS repo ships only `config.example.toml`.
- `BEEPIFY_*` environment variables override file values (e.g. `BARK_KEY`) for users who keep secrets in a manager rather than on disk.

```toml
debounce_seconds = 20
host_label = ""              # empty = auto ComputerName
locale = "en"                # "en" (default) | "zh-CN"

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

### `beepify init` editing settings.json — safety red lines

This is the most sensitive operation (it mutates the user's Claude Code config):

- **Merge, never overwrite** — any existing hooks (e.g. the author's `open-island-hooks.py`) are preserved; Beepify is appended alongside.
- **Idempotent** — if already present, do not add twice.
- **Timestamped backup** of settings.json before editing.
- **Reversible** — `beepify init --uninstall` removes the hook.

### Distribution

`npx beepify` (no install) or `npm i -g beepify`. Because the hook fires frequently, a global install (`beepify`) is snappier than `npx`; `init` detects a missing global install and suggests it.

### Coexistence with existing assets

v1 has **Beepify take over phone push (Bark / ntfy)**, while the author's `open-island-hooks.py` (macOS Dynamic-Island display) is **left untouched**. The legacy `notify-phone.sh` is retired only once Beepify is verified — so the working setup is never broken during dogfooding.

---

## 6. Project structure, build & test

Single npm package, modular internally (no monorepo in v1 — there is no independently publishable sub-package yet; split into `@beepify/core` later only if that changes).

```
beepify/
├─ src/
│  ├─ core/        types.ts · dispatch.ts · render.ts · debounce.ts
│  │              · http.ts (enc/retry/timeout) · registry.ts
│  ├─ sources/    claude-code.ts (hook parse + transcript + tool_desc + classify)
│  ├─ channels/   bark.ts · ntfy.ts
│  ├─ config/     load.ts (TOML + env override) · settings-json.ts (merge/idempotent/backup/uninstall)
│  └─ cli/        index.ts (notify / init / test / doctor)
├─ test/          (vitest)
├─ config.example.toml · package.json · tsconfig.json
├─ README.md · README.zh-CN.md · LICENSE (MIT)
└─ docs/design/ · docs/plans/   ← design spec + implementation plan
```

### Tech choices (dependencies kept minimal)

- TypeScript + ESM, **Node ≥ 18**: use built-in `fetch` (zero HTTP deps); CLI parsing via built-in `util.parseArgs` (no commander).
- Runtime deps reduced to essentially one **TOML parser** (`smol-toml`).
- Build with **tsup** (bundles a shebang'd single-file CLI; `package.json` `bin: beepify`).
- Package manager: **npm** (lowest contributor friction).

### Testing (vitest — core paths covered)

- `render`/`flat`: 300-char truncation + whitespace flattening.
- **bark slash-encoding invariant** (regression guard).
- ntfy JSON publish body shape.
- claude-code classification table (Stop→done; Notification+tool→needs-approval; AskUserQuestion / ExitPlanMode extraction).
- debounce.
- settings-json merge: idempotent and preserves an existing (open-island) hook.
- Channel network sends are mocked.

### Repo hygiene

GitHub Actions runs lint + test + build. Follow the PR workflow: feature branch → PR → human merge; never push to `main`. Docs are English-primary with a `README.zh-CN.md` second-language version.

---

## 7. Roadmap (v2+ — reserved seams, all additive)

- **More channels:** OpenIsland (macOS), Telegram, webhook, Windows toast.
- **More sources:** Cursor, Aider, Codex CLI, generic CLI exit-code wrapper.
- **Daemon / HTTP ingress:** central aggregation across multiple agents / machines.
- **Bidirectional:** approve-from-phone back to the agent (Tailscale / Cloudflare Tunnel — a Transport layer).
- **i18n:** more locales / a message-catalog system (v1 already ships `en` + `zh-CN` templates).
