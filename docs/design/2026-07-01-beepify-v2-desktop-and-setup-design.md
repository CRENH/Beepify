# Beepify v2 Design — Desktop notifications + interactive setup wizard

Date: 2026-07-01
Status: Approved (design), pending implementation plan
Version target: `@elbc/beepify@0.2.0`

## 1. Goal & scope

Beepify v1 routes Claude Code hook events to mobile push channels (Bark, ntfy).
v2 extends **reach** and **usability** on the local machine:

1. A **`desktop` channel** — native macOS notifications, plus an **Open Island**
   provider that drives the user's existing Dynamic Island app.
2. A **`beepify setup`** interactive wizard that edits configuration (not just
   scaffolds it), lowering the barrier to configuring channels and the hook.

### Out of scope (deferred to v3)

- `codex` / `opencode` sources (multi-agent support).
- Linux (`notify-send`) / Windows (PowerShell toast) desktop providers — only the
  **provider abstraction seam** is built now; no non-macOS backend ships in v2.
- Click actions, inline reply, or any two-way interaction (Beepify is one-way).
- Installing the Open Island app itself (third-party GUI — detect & link only).

## 2. Background: current architecture

- **Source** plugin: `parse(raw, config) → NormalizedEvent | null`, selected by
  `--source`, resolved from a registry. Only `claude-code` exists today.
- **Channel** plugin: `send(msg: RenderedMessage, cfg) → ChannelResult`, one entry
  per `[[channels]]` in `config.toml`, resolved from a registry. `bark`, `ntfy`.
- **Dispatch**: an event is rendered once (`render()` → `{title, body, group, icon}`)
  and **fanned out to every configured channel**; each `ChannelResult` is
  independent and a channel failure never throws to the agent.
- **`beepify init`**: non-interactive, idempotent scaffolder — copies
  `config.example.toml` and installs the Claude Code hook into `settings.json`.

The Open Island hook (`~/.local/bin/open-island-hooks.py`) reads a **Claude-Code-shaped
hook JSON on stdin** (`--source claude`) and forwards it to the running app over a
Unix socket (`OPEN_ISLAND_SOCKET_PATH` / `VIBE_ISLAND_SOCKET_PATH`). This shape is
what makes a Beepify → Open Island provider cheap: pipe a payload to its stdin.

## 3. Desktop channel

New directory `src/channels/desktop/` with the channel and its providers split so
each provider is independently understandable and testable.

### 3.1 Config schema

```toml
[[channels]]
type = "desktop"
provider = "native"          # "native" (default) | "open-island"
sound = ""                   # optional; native only
open_island_command = ""     # optional; path to open-island-hooks.py. auto-detected if empty
```

- **`provider`** — user-facing values are exactly two: `native` (default) and
  `open-island`. Internally `native` resolves to a backend by availability
  (macOS: `terminal-notifier` if on `PATH`, else `osascript`). `auto`,
  `osascript`, `terminal-notifier` are also accepted as advanced aliases but are
  not surfaced by the wizard.
- Desktop is a **peer channel** to bark/ntfy: a config may contain any mix; the
  same event fans out to all. No coupling between mobile and desktop.

### 3.2 Provider abstraction (seam for Linux/Windows)

```
desktop channel (src/channels/desktop/index.ts)
  ── selectProvider(providerName, platform, probe) → DesktopProvider
       registry of DesktopProvider:
         osascript          (macOS, zero-dep)        ← v2
         terminal-notifier  (macOS, if present)      ← v2
         open-island        (drives Dynamic Island)  ← v2
         notify-send        (Linux)                  ← future, pure addition
         powershell-toast   (Windows)                ← future, pure addition
```

- `DesktopProvider = (msg: RenderedMessage, cfg: ChannelConfig) => Promise<{ ok: boolean; error?: string }>`.
- The `desktop` channel itself only consumes the existing `render()` output
  (`title` / `body` / `group` / `icon`) and delegates. Adding a non-macOS backend
  later = new provider file + registry entry; **the channel, config schema, and
  render logic do not change.**
- `probe(bin)` (a `which`-style availability check) is **injected**, so provider
  selection is unit-testable without touching the real `PATH`.

### 3.3 Providers shipped in v2

| Provider | Mechanism | Notes |
|---|---|---|
| `osascript` | `execFile('osascript', ['-e', 'display notification "<body>" with title "<title>" [sound name "<sound>"]'])` | **`execFile` + args array** (no shell). Escape `"` and `\` in interpolated text. |
| `terminal-notifier` | `execFile('terminal-notifier', ['-title', title, '-message', body, '-group', group, ...])` | Selected when `provider=terminal-notifier`, or `native`+detected. Richer (group/icon). |
| `open-island` | `spawn(cmd, ['--source', 'claude'])`, write a **Claude-Code-shaped hook JSON** to child stdin | For the `claude-code` source, pass `event.raw` through unchanged. Missing command / non-zero exit → `{ ok: false, error }`, never throws. |

For the `open-island` provider, when the originating event lacks a native Claude
payload (future non-Claude sources), synthesize a minimal
`{ hook_event_name, cwd, message }`. In v2 only `claude-code` exists, so
passthrough of `event.raw` is the primary path.

### 3.4 Error handling

Consistent with bark/ntfy: a provider returns `{ ok: false, error }` on failure
(binary missing, non-zero exit, spawn error). The channel never throws; dispatch
records the failed `ChannelResult` alongside successful ones.

## 4. `beepify setup` — interactive, edit-aware wizard

New `src/cli/setup.ts`. **Pure core separated from terminal IO** so the config
logic is unit-tested and the readline layer stays a thin shell.

### 4.1 Behaviour

1. **Load existing config** (if `config.toml` exists) and display it. Every prompt
   is pre-filled with the current value as its default (Enter keeps it). This is an
   **editor**, not an overwrite: first run (no config) uses empty defaults.
2. **Locale** — `en` / `zh-CN`, default = current.
3. **Channels** — shown as a list the user can **keep / edit / remove / add**:
   - `bark` → key, server, icon
   - `ntfy` → topic, server
   - `desktop` → provider choice presented as **系统原生通知 (native)** [default] /
     **Open Island (recommended, needs separate install)**.
     - On `open-island`: **detect** an installed Open Island (probe for
       `open-island-hooks.py` on `PATH` / `OPEN_ISLAND_SOCKET_PATH`). If found,
       auto-fill `open_island_command` and confirm. If not found, print install
       guidance but **still allow adding the channel** (deferred activation) — do
       not pretend it is installed.
4. **`notify_idle`** — yes/no, default = current (else `false`).
5. **Write** `config.toml`. If one exists, **back it up** (`.beepify-bak.<ts>`)
   before writing.
6. **Install hook** — ask; reuse `runInit`'s hook installer.
7. **Test push** — reuse `runTest`; print per-channel `ok` / `skipped` / `FAIL`,
   closing the verification loop immediately.

`beepify init` is **unchanged** — it remains the non-interactive, scriptable path.

### 4.2 Structure for testability

- `renderConfigToml(answers): string` — pure; unit-tested for each channel type,
  locale, and `notify_idle`.
- Answer validation / normalization — pure helpers, unit-tested.
- `detectOpenIsland(probe, env): { installed: boolean; command?: string }` — pure
  given injected `probe` and `env`.
- The readline loop is a thin shell over the above, covered by a smoke test with
  scripted stdin (or an injected prompt function).

## 5. Docs

- `config.example.toml` — add a commented `[[channels]] type = "desktop"` block.
- `README.md` / `README.zh-CN.md` — document the desktop channel (both providers)
  and `beepify setup`.

## 6. Testing strategy (TDD, per task, two-stage review between tasks)

- **desktop selection**: `selectProvider` resolves `native` by injected `probe`
  (terminal-notifier present → chosen; absent → osascript); explicit provider names
  honored; unknown provider → error result.
- **osascript**: assert `execFile` argv construction and escaping of `"` / `\`.
- **terminal-notifier**: assert argv includes title/message/group.
- **open-island**: assert the child receives the expected stdin payload
  (passthrough of `event.raw`); missing command → `{ ok: false }`.
- **wizard**: `renderConfigToml` pure tests (bark, ntfy, desktop×2 providers,
  locale, notify_idle); `detectOpenIsland` found/not-found; readline shell smoke.

## 7. Rollout

After merge + publish `@elbc/beepify@0.2.0`: users can add a `desktop` channel and
optionally consolidate Open Island under Beepify (one hook driving phone + island).
Nothing is forced; existing configs keep working unchanged.

## 8. Non-goals / YAGNI recap

- No Linux/Windows providers yet — seam only.
- No installing the Open Island app — detect & link only.
- No click actions, reply, or GUI.
- No change to `beepify init`, the Source abstraction, or existing channels.
