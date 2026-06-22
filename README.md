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
npm install -g beepify
beepify init        # scaffolds ~/.config/beepify/config.toml and installs the Claude Code hook
```

Edit `~/.config/beepify/config.toml`, add a channel, then:

```bash
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

## Commands

| command | purpose |
|---|---|
| `beepify notify --source claude-code` | hook entry (invoked automatically) |
| `beepify init [--uninstall]` | scaffold config + install/remove the hook |
| `beepify test` | send a sample push to verify channels |
| `beepify doctor` | print config / channel / hook diagnostics |

## License

MIT
