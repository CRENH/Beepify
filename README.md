# Beepify

**Get a phone or desktop notification the moment your AI coding agent finishes a long run — or stops to ask for your approval.**

> 中文文档见 [README.zh-CN.md](./README.zh-CN.md).

You kick off a long task in Claude Code or Codex, switch to another window, and then keep checking back to see whether it's done, stuck, or waiting on a `rm -rf` you need to approve. Beepify removes the checking: it watches your agent and pushes a notification to your phone or desktop the instant something needs you.

It's a small, single-purpose CLI — no daemon, no account, no telemetry. It hooks into the agent you already run, reads each event locally, and forwards a short message to the channels you choose.

## What you get

Every notification is classified so you know at a glance whether you need to act:

- ✅ **done** — the agent finished this round
- 🔔 **needs-approval** — a tool/command is waiting for your permission (the notification shows the actual command, e.g. `Bash: rm -rf /tmp/build`)
- 💬 **waiting-input** — the agent is waiting for your reply

## Support matrix

**Coding agents** — where the events come from:

| Agent | Status | Wiring |
|---|---|---|
| **Claude Code** | ✅ supported | hook in `~/.claude/settings.json` |
| **OpenAI Codex CLI** | ✅ supported (v0.3) | managed `[hooks]` block in `~/.codex/config.toml` |
| **OpenCode** | 🗓️ planned (v4) | — |

**Notification channels** — where the notifications go:

| Channel | Reaches | Notes |
|---|---|---|
| **Bark** | iOS | free push app; needs a Bark key |
| **ntfy** | iOS · Android · web/desktop | free/self-hostable pub-sub; needs a topic |
| **desktop — native** | macOS | Notification Center (uses `terminal-notifier` if installed, else `osascript`) |
| **desktop — Open Island** | macOS | drives the Open Island Dynamic Island app |
| Linux / Windows desktop | 🗓️ planned (v4) | — |

You can enable several channels at once, and all of them are **shared across every agent** — configure Bark/ntfy/desktop once and both Claude Code and Codex reuse them.

## Quick start

```bash
npm install -g @elbc/beepify
beepify setup       # interactive: pick language, add channels, choose agents, install hooks, send a test
```

`beepify setup` is the recommended path — it walks you through language, channels, and which agents to wire up, then installs the hooks and sends a test notification. It also edits an existing config in place (current values shown as defaults), so it's safe to re-run.

Prefer scripting? `beepify init` is the non-interactive path:

```bash
beepify init                 # scaffold config + install the Claude Code hook
beepify init --agent codex   # scaffold config + wire the Codex hook
beepify test                 # send a sample notification to verify channels
```

## Configuration

See [`config.example.toml`](./config.example.toml) for the full annotated file. A minimal Bark setup:

```toml
locale = "en"        # or "zh-CN"

[[channels]]
type   = "bark"
key    = "your-bark-key"
```

- **Multiple channels:** add more `[[channels]]` blocks — every enabled channel receives every notification.
- **Secrets via env:** keys can also come from `BEEPIFY_*` env vars (`BARK_KEY`, `NTFY_TOPIC`), so you don't have to commit them.
- **Idle reminder:** set `notify_idle = true` to also receive the "agent is waiting for your input" reminder that fires ~60s after a turn ends (Claude Code only). Off by default because it duplicates the *done* notification.

### Desktop notifications (macOS)

```toml
[[channels]]
type = "desktop"
provider = "native"        # Notification Center
```

Set `provider = "open-island"` to drive the Open Island Dynamic Island app instead (install it separately; Beepify auto-detects `open-island-hooks.py`).

## Wiring your agents

### Claude Code

`beepify setup` / `beepify init` installs a hook into `~/.claude/settings.json` that runs `beepify notify --source claude-code` on the `Stop` and `Notification` events. Remove it with `beepify init --uninstall`.

### Codex CLI

`beepify init --agent codex` (or choose Codex / "both" in `beepify setup`) appends a **managed block** to `~/.codex/config.toml` that notifies on `Stop` (task done) and `PermissionRequest` (needs approval):

```bash
beepify init --agent codex               # wire it up
beepify init --agent codex --uninstall   # remove it
```

The block is bounded by `# >>> beepify (managed) >>>` markers, and the file is backed up before every write — your hand-written config and comments are preserved.

## Commands

| command | purpose |
|---|---|
| `beepify setup` | interactive wizard: edit config, choose agents, install hooks, send a test |
| `beepify init [--agent codex] [--uninstall]` | scaffold config + install/remove a hook (Claude Code by default, or Codex) |
| `beepify notify --source <claude-code\|codex>` | hook entry (invoked automatically by the agent) |
| `beepify test` | send a sample push to verify channels |
| `beepify doctor` | print config / channel / hook diagnostics |
| `beepify --version` | print version |

## How it works

Beepify is a one-way router with four stages: **parse → render → debounce → dispatch**. A *source* plugin turns a raw agent hook event into a normalized event; it's rendered into a localized message; a short debounce collapses duplicate bursts; then it's dispatched to every configured *channel*. Sources and channels are plugins behind a small registry, which is what makes adding a new agent or push target a self-contained change. Dispatch is crash-safe and never fails the agent — a hook that errored could otherwise block your session.

## Roadmap

| Version | Highlights |
|---|---|
| **v1** (0.1.x) | One-way router: Claude Code → Bark + ntfy; real HTTP status hardening |
| **v2** (0.2.0) | Desktop channel (macOS native + Open Island); interactive `setup` wizard |
| **v3** (0.3.0) | **Codex CLI** support via `[hooks]`; multi-agent `setup` (shared channels) |
| **v4** (planned) | **OpenCode** support; Linux / Windows desktop providers |

## License

MIT
