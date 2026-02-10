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
const { checkForUpdate } = require("../lib/version_check");

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

    // 静默更新检测：不阻塞启动，只在发现新版本时提示一次
    if (!process.env.XIAOI_NO_UPDATE_CHECK) {
        const pkg = (() => {
            try {
                return require("../package.json");
            } catch {
                return null;
            }
        })();
        if (pkg && pkg.name && pkg.version) {
            // 不 await，避免影响启动速度
            checkForUpdate({ packageName: pkg.name, currentVersion: pkg.version })
                .then((r) => {
                    if (r && r.ok && r.outdated && r.latestVersion) {
                        console.log(
                            `\n发现新版本：v${r.latestVersion}（当前 v${r.currentVersion}）`
                        );
                        console.log(`更新命令：npm i -g ${r.packageName}@latest\n`);
                    }
                })
                .catch(() => {});
        }
    }

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
        const { loadUserConfig, saveConfigFile, resolveLogFile, generateToken } = require("../lib/config");
        const action = (args[1] || "help").toLowerCase();
        let allowNpx = false;

        function printResult(r) {
            const out = (r.stdout || "").trim();
            const err = (r.stderr || "").trim();
            if (out) console.log(out);
            if (err) console.error(err);
            if (typeof r.status === "number" && r.status !== 0) {
                process.exit(r.status);
            }
        }

        async function ensurePm2InvokerSelected() {
            // help 不需要选择
            if (action === "help") return;

            // 以下命令不依赖 pm2：配置/文件类操作
            if (action === "public" || action === "webhook-log" || action === "weblog" || action === "doctor" || action === "diag") return;

            const avail = pm2.detectAvailability();
            if (avail.pm2) {
                allowNpx = false;
                return;
            }

            // 没有 pm2 的情况下，给用户选择是否使用 npx
            const readline = require("readline");
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const ask = (q) => new Promise((r) => rl.question(q, (ans) => r(ans.trim())));

            console.log("未检测到 pm2。请选择一个方案：");
            console.log("  1  全局安装 pm2（推荐）");
            console.log("  2  临时使用 npx pm2（仅本次命令，可能较慢）");
            console.log("  0  取消");
            const choice = await ask("  ▶ 选择: ");
            rl.close();

            if (choice === "1") {
                const r = pm2.installPm2Global();
                printResult(r);
                const avail2 = pm2.detectAvailability();
                if (!avail2.pm2) {
                    if (avail.npx) {
                        console.log("全局安装已执行，但仍未检测到 pm2。是否本次改用 npx pm2 执行（仅本次命令，可能较慢）？");
                        const readline2 = require("readline");
                        const rl2 = readline2.createInterface({ input: process.stdin, output: process.stdout });
                        const ask2 = (q) => new Promise((rr) => rl2.question(q, (ans) => rr(ans.trim())));
                        console.log("  1  使用 npx pm2 执行本次命令");
                        console.log("  0  取消");
                        const c2 = await ask2("  ▶ 选择: ");
                        rl2.close();
                        if (c2 === "1") {
                            allowNpx = true;
                            return;
                        }
                    }
                    console.error("❌ 全局安装后仍未检测到 pm2。你也可以手动执行: npm i -g pm2");
                    process.exit(1);
                }
                allowNpx = false;
                return;
            }

            if (choice === "2") {
                if (!avail.npx) {
                    console.error("❌ 未检测到 npx。请先安装 Node.js/npm，或全局安装 pm2。");
                    process.exit(1);
                }
                allowNpx = true;
                return;
            }

            process.exit(0);
        }

        try {
            await ensurePm2InvokerSelected();
            switch (action) {
                case "start":
                    printResult(pm2.pm2StartWebhook({ allowNpx }));
                    return;
                case "deploy":
                case "setup":
                    printResult(pm2.pm2StartWebhook({ allowNpx }));
                    printResult(pm2.pm2Save({ allowNpx }));
                    console.log("提示: 如需开机自启，请执行: xiaoi pm2 startup（并按输出提示完成系统配置）");
                    return;
                case "stop":
                    printResult(pm2.pm2StopWebhook({ allowNpx }));
                    return;
                case "restart":
                    printResult(pm2.pm2RestartWebhook({ allowNpx }));
                    return;
                case "delete":
                case "remove":
                    printResult(pm2.pm2DeleteWebhook({ allowNpx }));
                    return;
                case "status": {
                    const st = pm2.getWebhookStatus({ allowNpx });
                    console.log(
                        `PM2: ${st.running ? "运行中" : "未运行"}  状态=${st.status}` +
                        (st.pid ? `  pid=${st.pid}` : "")
                    );
                    return;
                }
                case "describe":
                case "info":
                    printResult(pm2.pm2DescribeWebhook({ allowNpx }));
                    return;
                case "logs": {
                    const lines = args[2] ? parseInt(args[2], 10) : 100;
                    printResult(pm2.pm2Logs(Number.isFinite(lines) ? lines : 100, { allowNpx }));
                    return;
                }
                case "doctor":
                case "diag": {
                    const info = pm2.getPm2DebugInfo();
                    console.log("PM2 检测信息（用于排查“安装成功但识别不到”）");
                    console.log("────────────────────────────────────────");
                    console.log(`platform: ${info.platform}`);
                    console.log(`node: ${info.nodeExecPath}`);
                    console.log(`cwd: ${info.cwd}`);
                    console.log("");
                    console.log(`npm: ${info.npm.version || "(不可用)"}`);
                    console.log(`npm prefix -g: ${info.npm.prefix || "(不可用)"}`);
                    console.log(`npm root -g: ${info.npm.root || "(不可用)"}`);
                    if (info.npm.errors && info.npm.errors.length) {
                        console.log("");
                        console.log("npm 错误：");
                        for (const e of info.npm.errors) {
                            console.log(`- ${e.cmd}: ${e.stderr}`);
                        }
                    }
                    console.log("");
                    console.log(`global bin dirs: ${Array.isArray(info.globalBinDirs) ? info.globalBinDirs.join(", ") : ""}`);
                    console.log("");
                    console.log(`detectAvailability: pm2=${info.availability && info.availability.pm2 ? "yes" : "no"}  npx=${info.availability && info.availability.npx ? "yes" : "no"}`);
                    console.log(`pm2Cli: ${info.pm2Cli ? info.pm2Cli.cmd : "(not found)"}`);
                    console.log(`npx: ${info.npx ? info.npx.cmd : "(not found)"}`);
                    return;
                }
                case "webhook-log":
                case "weblog": {
                    const lines = args[2] ? parseInt(args[2], 10) : 200;
                    const { config, path: cfgPath } = loadUserConfig();
                    const logFile = resolveLogFile(config, cfgPath, "webhook");
                    const n = Number.isFinite(lines) ? lines : 200;

                    const fs = require("fs");
                    if (!fs.existsSync(logFile)) {
                        console.log(`未找到 webhook 日志文件: ${logFile}`);
                        console.log("提示: 先启动 Webhook（TUI 或 pm2 常驻）后才会产生日志。");
                        return;
                    }
                    const data = fs.readFileSync(logFile, "utf-8");
                    const arr = data.split(/\r?\n/);
                    const tail = arr.slice(Math.max(0, arr.length - n - 1)).join("\n");
                    console.log(`==> ${logFile} (last ${n} lines)\n`);
                    console.log(tail.trimEnd());
                    return;
                }
                case "public": {
                    const sub = (args[2] || "").toLowerCase(); // on/off/status
                    const { config, path: cfgPath } = loadUserConfig();
                    if (!config.webhook) config.webhook = {};

                    const curHost = (config.webhook.host || "localhost").toString().trim() || "localhost";
                    const curPublic = curHost === "0.0.0.0" || curHost === "::";

                    const setPublic = (on) => {
                        config.webhook.host = on ? "0.0.0.0" : "localhost";
                        if (on) {
                            const t = (config.webhook.token || "").toString().trim();
                            if (!t) {
                                config.webhook.token = generateToken();
                                console.log(`🔐 已生成 webhook.token: ${config.webhook.token}`);
                            }
                        }
                        saveConfigFile(cfgPath, config);
                        console.log(`已更新 webhook.host = ${config.webhook.host}`);
                        console.log("提示: 如果使用 pm2 常驻，需要执行: xiaoi pm2 restart 使配置生效。");
                    };

                    if (sub === "status" || sub === "") {
                        if (sub === "status") {
                            console.log(`公网访问: ${curPublic ? "开启" : "关闭"}（host=${curHost}）`);
                            return;
                        }

                        const readline = require("readline");
                        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                        const ask = (q) => new Promise((r) => rl.question(q, (ans) => r(ans.trim())));

                        console.log(`当前公网访问: ${curPublic ? "开启" : "关闭"}（host=${curHost}）`);
                        console.log("请选择：");
                        console.log("  1  开启公网访问（host=0.0.0.0）");
                        console.log("  2  关闭公网访问（host=localhost）");
                        console.log("  0  取消");
                        const c = await ask("  ▶ 选择: ");
                        rl.close();
                        if (c === "1") setPublic(true);
                        else if (c === "2") setPublic(false);
                        return;
                    }

                    if (sub === "on" || sub === "enable" || sub === "true") {
                        setPublic(true);
                        return;
                    }
                    if (sub === "off" || sub === "disable" || sub === "false") {
                        setPublic(false);
                        return;
                    }

                    console.log("用法: xiaoi pm2 public [on|off|status]");
                    return;
                }
                case "save":
                    printResult(pm2.pm2Save({ allowNpx }));
                    return;
                case "startup":
                    printResult(pm2.pm2Startup({ allowNpx }));
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
  xiaoi pm2 status           显示是否在运行（未安装 pm2 会提示选择安装方式）
  xiaoi pm2 describe         显示 PM2 进程详情
  xiaoi pm2 logs [lines]     查看日志（默认 100 行）
  xiaoi pm2 webhook-log [n]  查看 Webhook 日志文件（默认 200 行）
  xiaoi pm2 public [on|off]  开关公网访问（修改 webhook.host；默认交互选择）
  xiaoi pm2 doctor           输出 PM2 检测信息（排查识别不到）
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
