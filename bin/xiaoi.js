#!/usr/bin/env node

/**
 * 小爱音箱 CLI + TUI 工具
 *
 * 用法:
 *   xiaoi                            # 启动交互式 TUI 界面
 *   xiaoi tts "你好，代码已完成"       # 直接发送语音通知
 *   xiaoi audio <url>                # 播放音频
 *   xiaoi volume <0-100>             # 设置音量
 *   xiaoi status                     # 检查连接状态
 *   xiaoi help                       # 显示帮助
 */

const speaker = require("../lib/speaker");
const { ensureUserConfigExists } = require("../lib/config");

const HELP_TEXT = `
小爱音箱通知工具 - xiaoi

用法:
  xiaoi                     启动交互式界面（TUI）
  xiaoi tts <文字>          发送语音通知
  xiaoi audio <url>         播放音频链接
  xiaoi volume <0-100>      设置音箱音量
  xiaoi status              检查连接状态
  xiaoi pm2 <命令>           Webhook 常驻（PM2）一键管理
  xiaoi help                显示此帮助

示例:
  xiaoi                          # 打开交互界面
  xiaoi tts "代码编译完成"
  xiaoi tts 部署已完成，请查看
  xiaoi volume 30
  xiaoi pm2 start                # 一键常驻启动 Webhook（后台运行）
  xiaoi pm2 status               # 查看 PM2 常驻状态

配置文件位置（按优先级）:
  1. ~/.xiaoi/config.json
  2. 安装目录/config.json

登录问题: https://github.com/idootop/migpt-next/issues/4
`;

async function main() {
    // 首次运行自动创建 ~/.xiaoi/config.json（空模板），避免用户找不到配置位置
    ensureUserConfigExists();

    const args = process.argv.slice(2);
    const command = args[0];

    // 无参数 → 启动 TUI
    if (!command) {
        const { mainLoop } = require("../lib/tui");
        await mainLoop();
        return;
    }

    // 帮助
    if (command === "help" || command === "--help" || command === "-h") {
        console.log(HELP_TEXT);
        return;
    }

    // PM2 常驻管理（不需要连接音箱）
    if (command === "pm2") {
        const pm2 = require("../lib/pm2");
        const action = (args[1] || "help").toLowerCase();

        function printResult(r) {
            const out = (r.stdout || "").trim();
            const err = (r.stderr || "").trim();
            if (out) console.log(out);
            if (err) console.error(err);
            if (typeof r.status === "number" && r.status !== 0) {
                process.exit(r.status);
            }
        }

        try {
            switch (action) {
                case "start":
                    printResult(pm2.pm2StartWebhook());
                    return;
                case "deploy":
                case "setup":
                    printResult(pm2.pm2StartWebhook());
                    printResult(pm2.pm2Save());
                    console.log("提示: 如需开机自启，请执行: xiaoi pm2 startup（并按输出提示完成系统配置）");
                    return;
                case "stop":
                    printResult(pm2.pm2StopWebhook());
                    return;
                case "restart":
                    printResult(pm2.pm2RestartWebhook());
                    return;
                case "delete":
                case "remove":
                    printResult(pm2.pm2DeleteWebhook());
                    return;
                case "status": {
                    const st = pm2.getWebhookStatus({ allowNpx: false });
                    if (!st.available) {
                        console.log("未检测到 pm2（可选安装：npm i -g pm2）。也可以直接执行: xiaoi pm2 start（将自动使用 npx pm2）");
                        return;
                    }
                    console.log(
                        `PM2: ${st.running ? "运行中" : "未运行"}  状态=${st.status}` +
                        (st.pid ? `  pid=${st.pid}` : "")
                    );
                    return;
                }
                case "describe":
                case "info":
                    printResult(pm2.pm2DescribeWebhook({ allowNpx: true }));
                    return;
                case "logs": {
                    const lines = args[2] ? parseInt(args[2], 10) : 100;
                    printResult(pm2.pm2Logs(Number.isFinite(lines) ? lines : 100));
                    return;
                }
                case "save":
                    printResult(pm2.pm2Save());
                    return;
                case "startup":
                    printResult(pm2.pm2Startup());
                    return;
                case "help":
                default:
                    console.log(`
xiaoi pm2 用法:
  xiaoi pm2 deploy           一键部署（start + save）
  xiaoi pm2 start            启动/重启 Webhook 常驻进程（PM2）
  xiaoi pm2 stop             停止 Webhook 常驻进程
  xiaoi pm2 restart          重启 Webhook 常驻进程
  xiaoi pm2 delete           删除 Webhook 常驻进程
  xiaoi pm2 status           显示是否在运行（不会自动下载 pm2）
  xiaoi pm2 describe         显示 PM2 进程详情
  xiaoi pm2 logs [lines]     查看日志（默认 100 行）
  xiaoi pm2 save             保存当前 PM2 进程列表（配合 pm2 startup 可开机自启）
  xiaoi pm2 startup          生成开机自启命令（通常需要管理员/Root 权限）
`);
                    return;
            }
        } catch (err) {
            console.error(`❌ ${err.message}`);
            process.exit(1);
        }
    }

    // CLI 模式
    try {
        console.log("🔗 正在连接音箱...");
        await speaker.init();
        console.log("✅ 连接成功");

        switch (command) {
            case "tts": {
                const text = args.slice(1).join(" ");
                if (!text) {
                    console.error("❌ 请提供要播报的文字");
                    console.error("  用法: xiaoi tts <文字>");
                    process.exit(1);
                }
                console.log(`📢 发送: ${text}`);
                await speaker.tts(text);
                console.log("✅ 播报完成");
                break;
            }

            case "audio": {
                const url = args[1];
                if (!url) {
                    console.error("❌ 请提供音频 URL");
                    process.exit(1);
                }
                console.log(`🎵 播放: ${url}`);
                await speaker.playAudio(url);
                console.log("✅ 播放完成");
                break;
            }

            case "volume": {
                const volume = parseInt(args[1]);
                if (isNaN(volume) || volume < 0 || volume > 100) {
                    console.error("❌ 音量值必须为 0-100 的整数");
                    process.exit(1);
                }
                console.log(`🔊 设置音量: ${volume}`);
                await speaker.setVolume(volume);
                console.log("✅ 音量已设置");
                break;
            }

            case "status": {
                console.log("✅ 音箱服务正常");
                const config = speaker.loadConfig();
                console.log(`📱 设备: ${config.speaker.did}`);
                console.log(`👤 用户: ${config.speaker.userId}`);
                break;
            }

            default:
                console.error(`❌ 未知命令: ${command}`);
                console.log(HELP_TEXT);
                process.exit(1);
        }
    } catch (err) {
        console.error(`❌ ${err.message}`);
        if (
            err.message.includes("登录") ||
            err.message.includes("login") ||
            err.message.includes("auth")
        ) {
            console.error(
                "\n💡 登录失败？请参考: https://github.com/idootop/migpt-next/issues/4"
            );
        }
        process.exit(1);
    }

    process.exit(0);
}

main();
