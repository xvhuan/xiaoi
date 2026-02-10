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

通过命令行 / MCP / Webhook 向小爱音箱发送语音通知

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/xiaoi-notify)](https://www.npmjs.com/package/xiaoi-notify)

---

## ✨ 功能

- 🖥️ **TUI 交互界面** — 可视化操作，配置账号、开关 Webhook
- ⌨️ **CLI 命令** — 一行命令发送语音通知，适合脚本和自动化
- 🤖 **MCP Server** — AI 编程助手任务完成后自动语音通知
- 🌐 **Webhook 服务** — HTTP 接口，方便第三方系统集成

## 📦 安装

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

## ⚙️ 配置

### 快捷配置（推荐）

直接运行 `xiaoi` 进入交互界面，选择「账号设置」→「一键配置所有项」。

首次安装/运行会自动创建配置目录和空配置文件：
- 目录：`~/.xiaoi/`（Windows 为 `%USERPROFILE%\\.xiaoi\\`）
- 配置：`~/.xiaoi/config.json`

### 手动配置

编辑 `config.json`：

```json
{
    "speaker": {
        "userId": "你的小米ID",
        "password": "你的密码",
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

配置文件按优先级查找：
1. `~/.xiaoi/config.json`（用户主目录）
2. 项目目录下的 `config.json`

### 配置说明

| 字段 | 说明 |
|------|------|
| `speaker.userId` | 小米 ID（一串数字，在小米账号「个人信息」中查看，**不是手机号**） |
| `speaker.password` | 小米账号密码 |
| `speaker.passToken` | 小米账号 passToken（推荐，[获取方法](https://github.com/idootop/migpt-next/issues/4)） |
| `speaker.did` | 音箱在米家 App 中设置的名称 |
| `webhook.port` | Webhook 服务端口号 |
| `webhook.host` | Webhook 监听地址（默认 `localhost`；如需外网访问可设为 `0.0.0.0`，并注意安全） |
| `webhook.token` | Webhook 鉴权 Token（可选；如果留空，服务启动时会自动生成并写回配置；请求中携带 `Authorization: Bearer <token>` 或 `X-Xiaoi-Token`） |

> 💡 **推荐使用 passToken 登录**，密码登录可能因安全验证失败。获取方法：[migpt-next/issues/4](https://github.com/idootop/migpt-next/issues/4)

## 🚀 使用

### TUI 交互界面

```bash
xiaoi
```

```
  ██╗  ██╗██╗ █████╗  ██████╗ ██╗
  ╚██╗██╔╝██║██╔══██╗██╔═══██╗██║
   ╚███╔╝ ██║███████║██║   ██║██║
   ██╔██╗ ██║██╔══██║██║   ██║██║
  ██╔╝ ██╗██║██║  ██║╚██████╔╝██║
  ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝

  小爱音箱语音通知工具  v1.0.0
  by ius  https://github.com/xvhuan/xiaoi

  状态: ● 已配置  Webhook: ○ 关闭  设备: 响

  请选择操作:

  1  发送语音通知
  2  设置音量
  3  账号设置
  4  Webhook 服务
  5  连接测试
  0  退出
```

### CLI 命令

```bash
# 发送语音通知
xiaoi tts "代码编译完成"
xiaoi tts "部署已完成，请查看"

# 设置音量
xiaoi volume 30

# 检查连接状态
xiaoi status

# 显示帮助
xiaoi help
```

### MCP Server（AI 编程助手集成）

> ⚠️ 必须先全局安装 `xiaoi-notify` 并运行 `xiaoi` 完成账号配置，MCP 才能正常工作。

#### VS Code / Cursor（JSON 格式）

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

#### Codex CLI（TOML 格式）

```toml
[mcp_servers.xiaoi-voice-notify]
command = "xiaoi-mcp"
```

配置后，AI 编程助手（如 GitHub Copilot、Gemini、Codex）可以自动调用以下工具：

| 工具 | 说明 |
|------|------|
| `notify` | 发送语音通知 |
| `play_audio` | 播放音频链接 |
| `set_volume` | 设置音量 |

对话中说「完成后用音箱通知我」，AI 会在任务完成后自动调用 `notify` 工具播报。

### Webhook 服务

在 TUI 中选择「Webhook 服务」→「启动」，或在代码中通过 HTTP 调用：

```bash
# 如果你配置了 webhook.token（或服务自动生成了 token），需要携带请求头：
#   -H "Authorization: Bearer <token>"
# 或:
#   -H "X-Xiaoi-Token: <token>"
#
# 发送语音通知
curl -X POST http://localhost:3088/webhook/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"text": "你好，世界"}'

# 播放音频
curl -X POST http://localhost:3088/webhook/audio \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"url": "https://example.com/audio.mp3"}'

# 设置音量
curl -X POST http://localhost:3088/webhook/volume \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"volume": 50}'
```

#### Webhook 常驻（PM2 一键启动）

如果你希望 Webhook 在服务器/电脑上长期后台运行（不需要挂着终端），可以使用内置的 PM2 管理命令：

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

> ⚠️ 如果你的 Webhook 要对外网提供服务，请务必设置 `webhook.token` 或配合防火墙/反向代理做鉴权，避免被任意调用。

## 📁 项目结构

```
xiaoi/
├── bin/
│   └── xiaoi.js          # CLI + TUI 入口
├── lib/
│   ├── speaker.js        # 核心模块（直连音箱 API）
│   ├── tui.js            # TUI 交互界面
│   ├── webhook_server.js # Webhook 常驻服务入口（可配合 PM2）
│   └── pm2.js            # PM2 一键管理封装
├── mcp_server.js         # MCP Server
├── config.json           # 配置文件
├── package.json          # npm 包配置
└── .vscode/
    └── mcp.json          # VS Code MCP 配置
```

## ❓ 常见问题

### 登录失败怎么办？

1. 确认 `userId` 是**小米 ID**（一串数字），不是手机号或邮箱
2. 推荐使用 `passToken` 代替密码登录
3. 获取 passToken：[migpt-next/issues/4](https://github.com/idootop/migpt-next/issues/4)

### 找不到设备？

- 确认 `did` 与米家 App 中音箱的名称**完全一致**
- 在 `config.json` 的 `speaker` 中添加 `"debug": true` 可以查看所有设备列表

### MCP Server 没有响应？

- 确认 `mcp.json` 中的路径正确
- 重启 VS Code 使 MCP 配置生效
- 查看 `log/mcp_server.log` 排查问题

## 🙏 致谢

基于 [@mi-gpt/next](https://github.com/idootop/migpt-next) 构建。

## 📄 License

[MIT](LICENSE)
