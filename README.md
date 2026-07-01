# Beepify

Turn your AI coding agent's events into phone & desktop notifications, so you know the moment a long run finishes — or needs your approval.

> 中文文档见 [README.zh-CN.md](./README.zh-CN.md).

## What it does

Beepify is a one-way notification router. It takes events from an agent (v1: **Claude Code**) and fans them out to push channels (v1: **Bark** for iOS, **ntfy** for iOS/Android). It classifies each event as:

- ✅ **done** — the agent finished this round
- 🔔 **needs-approval** — a tool/command is waiting for your permission (shows the actual command)
- 💬 **waiting-input** — the agent is waiting for your reply

## Install

```bash
npm install -g @elbc/beepify
beepify setup       # interactive: pick language, add channels, install the hook, send a test
```

`beepify setup` edits an existing config in place (current values shown as defaults). Prefer scripting? `beepify init` remains the non-interactive path:

```bash
beepify init        # scaffolds ~/.config/beepify/config.toml and installs the Claude Code hook
beepify test        # sends a sample notification
```

## Configuration

See [`config.example.toml`](./config.example.toml). Minimal Bark setup:

```toml
locale = "en"        # or "zh-CN"

[[channels]]
type   = "bark"
key    = "your-bark-key"
```

Secrets can also come from `BEEPIFY_*` env vars (`BARK_KEY`, `NTFY_TOPIC`).

Set `notify_idle = true` to also receive the "Claude is waiting for your input" reminder that fires ~60s after a turn ends. It is off by default because it duplicates the done notification.

### Desktop notifications (macOS)

Add a `desktop` channel to get native macOS notifications:

```toml
[[channels]]
type = "desktop"
provider = "native"        # Notification Center (uses terminal-notifier if installed, else osascript)
```

Set `provider = "open-island"` to drive the Open Island Dynamic Island app instead (install it separately; Beepify auto-detects `open-island-hooks.py`).

## Codex CLI

Beepify also works with the OpenAI Codex CLI via its `[hooks]` lifecycle system.

```bash
beepify init --agent codex   # wires ~/.codex/config.toml, scaffolds config
# or run `beepify setup` and choose Codex (or "both")
```

This appends a managed block to `~/.codex/config.toml` that notifies on `Stop`
(task done) and `PermissionRequest` (needs approval). The Bark / ntfy / desktop
channels are shared with Claude Code — configure them once. Remove with
`beepify init --agent codex --uninstall`.

## Commands

| command | purpose |
|---|---|
| `beepify notify --source <claude-code\|codex>` | hook entry (invoked automatically) |
| `beepify setup` | interactive wizard: edit config, install hook(s), send a test |
| `beepify init [--agent codex] [--uninstall]` | scaffold config + install/remove a hook |
| `beepify test` | send a sample push to verify channels |
| `beepify doctor` | print config / channel / hook diagnostics |

## License

MIT
