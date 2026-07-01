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
npm install -g @elbc/beepify
beepify setup       # 交互式:选语言、加 channel、装 hook、发测试
```

`beepify setup` 会就地编辑现有配置(当前值作默认)。想脚本化?`beepify init` 仍是非交互路径:

```bash
beepify init        # 生成 ~/.config/beepify/config.toml 并装好 Claude Code hook
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

设 `notify_idle = true` 可额外接收"Claude 在等你回复"的空闲提醒(turn 结束约 60 秒后触发)。默认关闭,因为它与"任务完成"通知重复。

### 桌面通知(macOS)

加一个 `desktop` channel 即可收到 macOS 原生通知:

```toml
[[channels]]
type = "desktop"
provider = "native"        # 通知中心(装了 terminal-notifier 就用它,否则 osascript)
```

把 `provider` 设为 `"open-island"` 可改为驱动 Open Island 灵动岛 app(需另外安装;Beepify 会自动探测 `open-island-hooks.py`)。

## Codex CLI

Beepify 也可通过 OpenAI Codex CLI 的 `[hooks]` 生命周期系统工作。

```bash
beepify init --agent codex   # 接线 ~/.codex/config.toml,并生成配置
# 或运行 `beepify setup` 选择 Codex(或 "both")
```

这会向 `~/.codex/config.toml` 追加一个托管块,在 `Stop`(任务完成)与
`PermissionRequest`(需批准)时通知。Bark / ntfy / desktop 通道与 Claude Code
共享——只需配置一次。卸载:`beepify init --agent codex --uninstall`。

## 命令

| 命令 | 作用 |
|---|---|
| `beepify notify --source <claude-code\|codex>` | hook 入口(自动调用)|
| `beepify setup` | 交互向导:编辑配置、装 hook、发测试 |
| `beepify init [--agent codex] [--uninstall]` | 生成配置 + 安装/移除 hook |
| `beepify test` | 发样例推送验证 channel |
| `beepify doctor` | 打印配置 / channel / hook 诊断 |

## License

MIT
