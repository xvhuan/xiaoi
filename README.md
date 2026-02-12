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
[![npm](https://img.shields.io/npm/v/xiaoii)](https://www.npmjs.com/package/xiaoii)

</div>

---

## 功能

- TUI 交互界面：配置账号、发送通知、管理 Webhook/PM2
- CLI 命令：适合脚本/自动化场景
- MCP Server：供 Codex/Cursor/VS Code 等 AI 编程助手调用
- Webhook 服务：提供 HTTP 接口，方便第三方系统集成
- PM2 常驻：一键后台运行 Webhook（不需要挂着终端）

## 更新日志

### v1.0.6 (2026-02-12)

- 修复 `ttscmd` 输入解析错误：`[7,3]` 不再被误解析为 `[0,7]`
- 优化账号设置显示：默认 `ttscmd` 未设置时，自动显示当前 `did` 解析出的设备命令（自动映射）

### v1.0.5 (2026-02-12)

- 新增 `ttscmd` 自动映射日志输出：显示 `model / match / source / command`
- 详细日志统一增加 `[XIAOI]` 前缀，便于在 PM2/控制台过滤检索

### v1.0.4 (2026-02-12)

- 账号设置页新增按 `did` 自动解析机型并展示“生效 ttscmd 映射”
- 链路调试能力完善：支持手动 `cmd`、临时链路模式、详细日志开关

### v1.0.3 (2026-02-12)

- 新增 TTS 链路模式切换：`auto / command / default`
- 连接测试支持手动输入临时 `ttscmd` 与临时模式，便于现场调试
- 新增详细日志开关，可显示/隐藏 `ttscmd` 与默认链路执行细节

### v1.0.2 (2026-02-11)

- 调整 TTS 调用顺序：优先 `ttscmd(MiOT.doAction)`，失败后回退默认 `MiNA.play(text)`
- 内置完整机型 `ttsFallbackCommands` 映射（含 `LX04` 等常见型号），并支持用户自定义覆盖
- 账号设置新增「查看设备列表并选择 did」，可直接从设备列表一键写回配置，降低 did 填错概率
- 配置模板/自动生成配置/README 同步新增 `speaker.ttsFallbackCommand` 与 `speaker.ttsFallbackCommands`
- 新增主动测试模式：支持分别测试 `ttscmd` 链路和默认链路（`MiNA.play`）
- 账号设置新增 `ttscmd` 编辑入口：支持修改默认命令与按机型覆盖命令
- 新增 TTS 链路模式：支持 `auto / command / default` 三种模式，用户可手动切换
- 新增详细日志开关：支持显示/隐藏 `ttscmd` 与默认链路的执行日志
- 连接测试支持手动输入临时 `ttscmd` 与临时链路模式，便于现场调试

### v1.0.1 (2026-02-10)

- 修复 Windows 下 `pm2/npm/npx` 探测误判（`.cmd` shim 导致的 ENOENT/不可执行问题）
- 修复 npm v10+ 不支持 `npm bin -g` 导致的全局 pm2 识别失败（改用 `npm prefix -g` 回退）
- TUI 方向键/小键盘数字选择体验优化（减少重绘卡顿、返回不再二次回车）
- Webhook 菜单状态显示优化（区分内嵌/PM2 常驻，避免误导）
- 新增：TUI 查看 PM2 日志
- 新增：每次启动都会检测更新（可用 `XIAOI_NO_UPDATE_CHECK=1` 禁用）

## 安装

### 全局安装（推荐）

```bash
# npm
npm i -g xiaoii

# 或 pnpm
pnpm add -g xiaoii
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
        "did": "音箱在米家中的名称",
        "ttsMode": "auto",
        "verboseLog": false,
        "ttsFallbackCommand": [5, 1],
        "ttsFallbackCommands": {
            "oh2p": [7, 3],
            "oh2": [5, 3],
            "lx06": [5, 1],
            "s12": [5, 1],
            "l15a": [7, 3],
            "lx5a": [5, 1],
            "lx05": [5, 1],
            "x10a": [7, 3],
            "l17a": [7, 3],
            "l06a": [5, 1],
            "lx01": [5, 1],
            "l05b": [5, 3],
            "l05c": [5, 3],
            "l09a": [3, 1],
            "lx04": [5, 1],
            "asx4b": [5, 3],
            "x6a": [7, 3],
            "x08e": [7, 3],
            "x8f": [7, 3]
        }
    },
    "webhook": {
        "port": 51666,
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
| `speaker.ttsMode` | TTS 链路模式：`auto`（先 ttscmd 后默认）、`command`（仅 ttscmd）、`default`（仅默认链路） |
| `speaker.verboseLog` | 详细日志开关（`true/false`），控制是否打印链路执行细节 |
| `speaker.ttsFallbackCommand` | 默认 `ttscmd`（默认 `[5,1]`，优先调用） |
| `speaker.ttsFallbackCommands` | 按型号覆盖 `ttscmd`（如 `lx04:[5,1]`、`l09a:[3,1]`） |
| `webhook.host` | 监听地址；需要外网访问可设置为 `0.0.0.0`（注意安全） |
| `webhook.port` | Webhook 端口 |
| `webhook.token` | Webhook 鉴权 Token（可选；常驻 Webhook 如果留空会自动生成并写回配置） |

> 提示：在 TUI 的「账号设置」里可切换 TTS 模式、修改默认/机型 `ttscmd`、开关详细日志；在「连接测试」里可手动输入临时 `ttscmd` 与临时模式进行调试。

> 推荐使用 passToken 登录。passToken 获取参考：[migpt-next/issues/4](https://github.com/idootop/migpt-next/issues/4)

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
curl -X POST http://localhost:51666/webhook/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"text":"你好，世界"}'

# 播放音频
curl -X POST http://localhost:51666/webhook/audio \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"url":"https://example.com/audio.mp3"}'

# 设置音量
curl -X POST http://localhost:51666/webhook/volume \
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

# 查看 pm2 进程日志（stdout/stderr）
xiaoi pm2 logs 200

# 查看 Webhook 日志文件（~/.xiaoi/log/webhook.log 等）
xiaoi pm2 webhook-log 200

# 开关公网访问（修改 webhook.host）
xiaoi pm2 public on
xiaoi pm2 public off

# 停止/删除
xiaoi pm2 stop
xiaoi pm2 delete

# 保存进程列表（配合 pm2 startup 可实现开机自启）
xiaoi pm2 save

# 生成开机自启命令（通常需要管理员/Root 权限）
xiaoi pm2 startup
```

> 如果你的 Webhook 要对外网提供服务，请务必设置 `webhook.token` 或配合防火墙/反向代理做鉴权，避免被任意调用。

### Docker 部署（容器化 Webhook）

将 xiaoi Webhook 封装到 Docker 容器运行，适合服务器/NAS/云主机。**不需要手动编辑任何配置文件**，只需填写环境变量即可启动。

#### 快速开始（直接拉镜像，不用 clone）

```bash
# 拉取镜像
docker pull iusy/xiaoi:latest

# 一行启动
docker run -d \
  --name xiaoi-webhook \
  --restart unless-stopped \
  -p 51666:51666 \
  -e XIAOI_USER_ID=你的小米ID \
  -e XIAOI_PASS_TOKEN=你的passToken \
  -e XIAOI_DID=你的音箱名称 \
  iusy/xiaoi:latest
```

搞定！🎉 不需要 clone 代码、不需要编辑配置文件。

#### 或者用 Docker Compose

```bash
# 1. 下载 docker-compose.yml 和 .env 模板
curl -O https://raw.githubusercontent.com/xvhuan/xiaoi/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/xvhuan/xiaoi/main/.env.example

# 2. 编辑 .env，填入你的信息
#    XIAOI_USER_ID、XIAOI_PASS_TOKEN、XIAOI_DID

# 3. 一键启动
docker-compose up -d
```

`.env` 文件只需填 3 项：

```env
XIAOI_USER_ID=你的小米ID（数字）
XIAOI_PASS_TOKEN=你的passToken
XIAOI_DID=你的音箱名称
```

> passToken 获取方法：[migpt-next/issues/4](https://github.com/idootop/migpt-next/issues/4)


#### 纯 Docker 命令（不用 docker-compose）

```bash
# 构建镜像
docker build -t xiaoi-webhook .

# 运行（直接用 -e 传环境变量）
docker run -d \
  --name xiaoi-webhook \
  --restart unless-stopped \
  -p 51666:51666 \
  -e XIAOI_USER_ID=你的小米ID \
  -e XIAOI_PASS_TOKEN=你的passToken \
  -e XIAOI_DID=你的音箱名称 \
  xiaoi-webhook
```

#### 环境变量一览

| 变量 | 必填 | 说明 |
|------|------|------|
| `XIAOI_USER_ID` | ✅ | 小米 ID（数字，在小米账号个人信息中查看） |
| `XIAOI_PASS_TOKEN` | ✅ | passToken（推荐登录方式） |
| `XIAOI_DID` | ✅ | 音箱在米家 App 中的名称（必须完全一致） |
| `XIAOI_PASSWORD` | | 密码登录（不推荐，可能被安全验证拦截） |
| `XIAOI_TOKEN` | | Webhook 鉴权 Token（留空自动生成） |
| `XIAOI_PORT` | | 端口号（默认 `51666`） |
| `XIAOI_TTS_MODE` | | TTS 模式：`auto` / `command` / `default` |
| `XIAOI_VERBOSE_LOG` | | 详细日志：`true` / `false` |

#### 验证服务

```bash
# 查看容器日志（看 Token 和启动状态）
docker-compose logs

# 状态检查
curl http://localhost:51666/

# 发送语音通知
curl -X POST http://localhost:51666/webhook/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <从日志中获取的token>" \
  -d '{"text":"Docker 部署成功！"}'
```

#### 常用命令

```bash
# 查看日志
docker-compose logs -f

# 重启
docker-compose restart

# 停止
docker-compose down

# 更新（拉取最新代码后）
git pull
docker-compose up -d --build
```


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
├── Dockerfile                # Docker 镜像构建
├── docker-compose.yml        # Docker Compose 编排
├── docker-entrypoint.sh      # 容器启动入口脚本
├── .env.example              # Docker 环境变量模板
└── README.md
```

## 常见问题

### 登录失败怎么办？

1. 确认 `userId` 是小米 ID（数字），不是手机号或邮箱
2. 推荐使用 `passToken` 代替密码登录
3. passToken 获取参考：[migpt-next/issues/4](https://github.com/idootop/migpt-next/issues/4)

### 找不到设备？

- 确认 `did` 与米家 App 中音箱名称完全一致

## 致谢

基于 `@mi-gpt/next` 构建。
https://github.com/idootop/migpt-next

## License

MIT，详见 `LICENSE`。
