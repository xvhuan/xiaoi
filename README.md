<div align="center">

```
██╗  ██╗██╗ █████╗  ██████╗ ██╗
╚██╗██╔╝██║██╔══██╗██╔═══██╗██║
 ╚███╔╝ ██║███████║██║   ██║██║
 ██╔██╗ ██║██╔══██║██║   ██║██║
██╔╝ ██╗██║██║  ██║╚██████╔╝██║
╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝
```

**小爱音箱语音通知工具**

通过 CLI / TUI / MCP / Webhook 向小爱音箱发送语音通知

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/xiaoi-notify)](https://www.npmjs.com/package/xiaoi-notify)

</div>

---

## 功能

- TUI 交互界面：配置账号、发送通知、管理 Webhook/PM2
- CLI 命令：适合脚本/自动化场景
- MCP Server：供 Codex/Cursor/VS Code 等 AI 编程助手调用
- Webhook 服务：提供 HTTP 接口，方便第三方系统集成
- PM2 常驻：一键后台运行 Webhook（不需要挂着终端）

## 安装

### 全局安装（推荐）

```bash
# npm
npm i -g xiaoi-notify

# 或 pnpm
pnpm add -g xiaoi-notify
```

安装后即可在任何目录使用 `xiaoi` 和 `xiaoi-mcp` 命令。

### 从源码安装

```bash
git clone https://github.com/xvhuan/xiaoi.git
cd xiaoi

# npm
npm i
npm link

# 或 pnpm
pnpm install
pnpm link --global
```

## 配置

### 自动创建（安装/首次运行）

安装完成或首次执行 `xiaoi` 时，会自动创建：

- 目录：`~/.xiaoi/`（Windows 为 `%USERPROFILE%\.xiaoi\`）
- 配置：`~/.xiaoi/config.json`（空模板）

### 手动配置

编辑 `~/.xiaoi/config.json`：

```json
{
    "speaker": {
        "userId": "你的小米ID（数字，不是手机号）",
        "password": "你的密码（不推荐）",
        "passToken": "你的passToken（推荐）",
        "did": "音箱在米家中的名称"
    },
    "webhook": {
        "port": 3088,
        "host": "localhost",
        "token": "",
        "logFile": "log/webhook.log"
    },
    "mcp": {
        "logFile": "log/mcp_server.log"
    }
}
```

配置文件查找优先级：

1. `~/.xiaoi/config.json`
2. （兜底）安装目录/项目目录下的 `config.json`

字段说明（常用）：

| 字段 | 说明 |
|------|------|
| `speaker.userId` | 小米 ID（数字，在小米账号个人信息中查看） |
| `speaker.password` | 小米账号密码（可能因安全验证失败） |
| `speaker.passToken` | passToken（推荐） |
| `speaker.did` | 音箱在米家 App 中的设备名称（必须完全一致） |
| `webhook.host` | 监听地址；需要外网访问可设置为 `0.0.0.0`（注意安全） |
| `webhook.port` | Webhook 端口 |
| `webhook.token` | Webhook 鉴权 Token（可选；常驻 Webhook 如果留空会自动生成并写回配置） |

> 推荐使用 passToken 登录。passToken 获取参考：`migpt-next/issues/4`

## 使用

### TUI 交互界面

```bash
xiaoi
```

### CLI 命令

```bash
# 发送语音通知
xiaoi tts "代码编译完成"
xiaoi tts 部署已完成，请查看

# 设置音量
xiaoi volume 30

# 检查连接状态
xiaoi status

# 帮助
xiaoi help
```

### MCP Server（AI 编程助手集成）

> 需要先全局安装并运行 `xiaoi` 完成账号配置。

#### VS Code / Cursor（JSON）

在项目中创建 `.vscode/mcp.json`：

```json
{
  "servers": {
    "xiaoi-voice-notify": {
      "type": "stdio",
      "command": "xiaoi-mcp"
    }
  }
}
```

#### Codex CLI（TOML）

```toml
[mcp_servers.xiaoi-voice-notify]
command = "xiaoi-mcp"
```

工具列表：

| 工具 | 说明 |
|------|------|
| `notify` | 发送语音通知（TTS） |
| `play_audio` | 播放音频链接 |
| `set_volume` | 设置音量 |

### Webhook 服务（HTTP 接口）

你可以在 TUI 里启动 Webhook，也可以使用 PM2 常驻方式（见下节）。

当你配置了 `webhook.token`（或使用常驻 Webhook 自动生成的 token）时，请在请求中携带请求头：

- `Authorization: Bearer <token>`
- 或 `X-Xiaoi-Token: <token>`

```bash
# 发送语音通知
curl -X POST http://localhost:3088/webhook/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"text":"你好，世界"}'

# 播放音频
curl -X POST http://localhost:3088/webhook/audio \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"url":"https://example.com/audio.mp3"}'

# 设置音量
curl -X POST http://localhost:3088/webhook/volume \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"volume":50}'
```

### Webhook 常驻（PM2 一键启动）

如果你希望 Webhook 在服务器/电脑上长期后台运行（不需要挂着终端），使用内置 PM2 管理命令：

```bash
# 一键常驻启动（后台运行）
xiaoi pm2 start

# 一键部署（start + save）
xiaoi pm2 deploy

# 查看状态
xiaoi pm2 status

# 停止/删除
xiaoi pm2 stop
xiaoi pm2 delete

# 保存进程列表（配合 pm2 startup 可实现开机自启）
xiaoi pm2 save

# 生成开机自启命令（通常需要管理员/Root 权限）
xiaoi pm2 startup
```

> 如果你的 Webhook 要对外网提供服务，请务必设置 `webhook.token` 或配合防火墙/反向代理做鉴权，避免被任意调用。

## 项目结构

```
xiaoi/
├── bin/
│   └── xiaoi.js              # CLI + TUI 入口
├── lib/
│   ├── config.js             # 用户目录配置管理（自动生成 ~/.xiaoi/config.json）
│   ├── speaker.js            # 核心模块（直连音箱 API）
│   ├── tui.js                # TUI 交互界面
│   ├── webhook_server.js     # 常驻 Webhook 服务入口（可配合 PM2）
│   └── pm2.js                # PM2 一键管理封装
├── mcp_server.js             # MCP Server
├── config.example.json       # 配置模板
└── README.md
```

## 常见问题

### 登录失败怎么办？

1. 确认 `userId` 是小米 ID（数字），不是手机号或邮箱
2. 推荐使用 `passToken` 代替密码登录
3. passToken 获取参考：`migpt-next/issues/4`

### 找不到设备？

- 确认 `did` 与米家 App 中音箱名称完全一致

## 致谢

基于 `@mi-gpt/next` 构建。

## License

MIT，详见 `LICENSE`。

