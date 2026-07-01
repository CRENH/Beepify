# Beepify

**当你的 AI 编码 agent 跑完一个长任务、或停下来等你授权的那一刻,给你的手机或桌面推一条通知。**

> English docs: [README.md](./README.md).

你在 Claude Code 或 Codex 里发起一个长任务,切到别的窗口,然后就得反复回来看:跑完了吗?卡住了吗?是不是在等一条你要批准的 `rm -rf`?Beepify 帮你省掉这份反复查看 —— 它盯着你的 agent,一旦有事需要你,就把一条通知推到手机或桌面。

它是一个小而专一的 CLI —— 没有常驻进程、不用注册账号、无遥测。它接入你已经在用的 agent,在本地读取每个事件,把一条简短消息转发到你选择的渠道。

## 你会收到什么

每条通知都做了分类,让你一眼就知道要不要动手:

- ✅ **done** —— agent 已结束本轮
- 🔔 **needs-approval** —— 有命令/工具在等你授权(通知会显示实际命令,如 `Bash: rm -rf /tmp/build`)
- 💬 **waiting-input** —— agent 在等你回复

## 支持矩阵

**编码 agent** —— 事件的来源:

| Agent | 状态 | 接线方式 |
|---|---|---|
| **Claude Code** | ✅ 已支持 | `~/.claude/settings.json` 里的 hook |
| **OpenAI Codex CLI** | ✅ 已支持(v0.3) | `~/.codex/config.toml` 里的托管 `[hooks]` 块 |
| **OpenCode** | 🗓️ 计划中(v4) | —— |

**通知渠道** —— 通知的去向:

| 渠道 | 触达 | 说明 |
|---|---|---|
| **Bark** | iOS | 免费推送 app;需一个 Bark key |
| **ntfy** | iOS · 安卓 · web/桌面 | 免费/可自托管的 pub-sub;需一个 topic |
| **desktop — native** | macOS | 通知中心(装了 `terminal-notifier` 就用它,否则 `osascript`) |
| **desktop — Open Island** | macOS | 驱动 Open Island 灵动岛 app |
| Linux / Windows 桌面 | 🗓️ 计划中(v4) | —— |

多个渠道可同时启用,且**所有渠道在各 agent 间共享** —— Bark/ntfy/desktop 只配一次,Claude Code 与 Codex 都复用。

## 快速开始

```bash
npm install -g @elbc/beepify
beepify setup       # 交互式:选语言、加渠道、选 agent、装 hook、发测试
```

推荐走 `beepify setup` —— 它会带你走一遍语言、渠道、要接线哪些 agent,然后装好 hook 并发一条测试通知。它也会就地编辑现有配置(当前值作默认),可安全地重复运行。

想脚本化?`beepify init` 是非交互路径:

```bash
beepify init                 # 生成配置 + 装好 Claude Code hook
beepify init --agent codex   # 生成配置 + 接线 Codex hook
beepify test                 # 发一条样例通知验证渠道
```

## 配置

完整带注释的文件见 [`config.example.toml`](./config.example.toml)。最小 Bark 配置:

```toml
locale = "zh-CN"     # 或 "en"

[[channels]]
type   = "bark"
key    = "你的-bark-key"
```

- **多渠道:** 追加更多 `[[channels]]` 块 —— 每个启用的渠道都会收到每条通知。
- **密钥走环境变量:** key 也可来自 `BEEPIFY_*` 环境变量(`BARK_KEY`、`NTFY_TOPIC`),不必写进文件。
- **空闲提醒:** 设 `notify_idle = true` 可额外接收"agent 在等你回复"的提醒(turn 结束约 60 秒后触发,仅 Claude Code)。默认关闭,因为它与 *done* 通知重复。

### 桌面通知(macOS)

```toml
[[channels]]
type = "desktop"
provider = "native"        # 通知中心
```

把 `provider` 设为 `"open-island"` 可改为驱动 Open Island 灵动岛 app(需另外安装;Beepify 会自动探测 `open-island-hooks.py`)。

## 接线你的 agent

### Claude Code

`beepify setup` / `beepify init` 会往 `~/.claude/settings.json` 装一个 hook,在 `Stop` 与 `Notification` 事件上运行 `beepify notify --source claude-code`。卸载:`beepify init --uninstall`。

### Codex CLI

`beepify init --agent codex`(或在 `beepify setup` 里选 Codex / "both")会往 `~/.codex/config.toml` 追加一个**托管块**,在 `Stop`(任务完成)与 `PermissionRequest`(需批准)时通知:

```bash
beepify init --agent codex               # 接线
beepify init --agent codex --uninstall   # 移除
```

这个块由 `# >>> beepify (managed) >>>` 标记界定,且每次写入前都会备份文件 —— 你手写的配置和注释都会保留。

## 命令

| 命令 | 作用 |
|---|---|
| `beepify setup` | 交互向导:编辑配置、选 agent、装 hook、发测试 |
| `beepify init [--agent codex] [--uninstall]` | 生成配置 + 安装/移除 hook(默认 Claude Code,或 Codex) |
| `beepify notify --source <claude-code\|codex>` | hook 入口(agent 自动调用) |
| `beepify test` | 发样例推送验证渠道 |
| `beepify doctor` | 打印配置 / 渠道 / hook 诊断 |
| `beepify --version` | 打印版本 |

## 工作原理

Beepify 是一个单向路由器,四个阶段:**parse → render → debounce → dispatch**(解析 → 渲染 → 去抖 → 分发)。一个 *source* 插件把 agent 的原始 hook 事件转成归一化事件;再渲染成本地化消息;短去抖合并重复的突发;然后分发给每个已配置的 *channel*。source 与 channel 都是注册表背后的插件,这正是让"加一个新 agent 或推送目标"成为自包含改动的原因。分发是崩溃安全的、绝不让 agent 失败 —— 否则一个报错的 hook 可能会阻断你的会话。

## 迭代路线

| 版本 | 要点 |
|---|---|
| **v1**(0.1.x) | 单向路由器:Claude Code → Bark + ntfy;HTTP 状态硬化 |
| **v2**(0.2.0) | 桌面渠道(macOS native + Open Island);交互式 `setup` 向导 |
| **v3**(0.3.0) | 经 `[hooks]` 的 **Codex CLI** 支持;多 agent `setup`(共享渠道) |
| **v4**(计划中) | **OpenCode** 支持;Linux / Windows 桌面 provider |

## License

MIT
