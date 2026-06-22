# Beepify

把 AI 编码 agent 的事件变成手机/桌面通知 —— 长任务一跑完、或需要你授权的瞬间,你就知道。

> English docs: [README.md](./README.md).

## 它做什么

Beepify 是一个单向通知路由器。它接收 agent 的事件(v1:**Claude Code**),fan-out 到推送 channel(v1:**Bark** iOS、**ntfy** iOS/安卓),并把事件分为:

- ✅ **done** —— agent 已结束本轮
- 🔔 **needs-approval** —— 有命令/工具在等你授权(显示实际命令)
- 💬 **waiting-input** —— agent 在等你回复

## 安装

```bash
npm install -g beepify
beepify init        # 生成 ~/.config/beepify/config.toml 并装好 Claude Code hook
```

编辑 `~/.config/beepify/config.toml` 加一个 channel,然后:

```bash
beepify test        # 发一条样例通知
```

## 配置

见 [`config.example.toml`](./config.example.toml)。最小 Bark 配置:

```toml
locale = "zh-CN"     # 或 "en"

[[channels]]
type   = "bark"
key    = "你的-bark-key"
```

密钥也可用 `BEEPIFY_*` 环境变量(`BARK_KEY`、`NTFY_TOPIC`)。

## 命令

| 命令 | 作用 |
|---|---|
| `beepify notify --source claude-code` | hook 入口(自动调用)|
| `beepify init [--uninstall]` | 生成配置 + 安装/移除 hook |
| `beepify test` | 发样例推送验证 channel |
| `beepify doctor` | 打印配置 / channel / hook 诊断 |

## License

MIT
