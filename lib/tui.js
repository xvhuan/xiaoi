/**
 * 小爱音箱 TUI 交互界面
 *
 * 功能：
 * - 发送语音通知
 * - 设置音量
 * - 账号登录配置
 * - Webhook 服务开关
 * - 连接测试
 */

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const http = require("http");

// ============================================
// ANSI 颜色和样式
// ============================================
const c = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    // 前景色
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
    // 背景色
    bgBlue: "\x1b[44m",
    bgGreen: "\x1b[42m",
    bgRed: "\x1b[41m",
    bgYellow: "\x1b[43m",
    bgMagenta: "\x1b[45m",
    bgCyan: "\x1b[46m",
};

// ============================================
// 配置管理
// ============================================
const CONFIG_PATHS = {
    home: path.join(
        process.env.USERPROFILE || process.env.HOME || "",
        ".xiaoi",
        "config.json"
    ),
    local: path.join(__dirname, "..", "config.json"),
};

function getConfigPath() {
    // 默认写入用户目录（全局安装/任意目录执行都更合理，也更安全）
    const homeDir = process.env.USERPROFILE || process.env.HOME || "";
    if (homeDir) return CONFIG_PATHS.home;

    // 极端情况下拿不到 HOME/USERPROFILE，再退回本地目录
    return CONFIG_PATHS.local;
}

function loadConfig() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return {
            speaker: { userId: "", password: "", passToken: "", did: "" },
            webhook: { port: 3088, host: "localhost", token: "", logFile: "log/webhook.log" },
            mcp: { logFile: "log/mcp_server.log" },
        };
    }
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function saveConfig(config) {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), "utf-8");
}

// ============================================
// TUI 核心
// ============================================
let rl;
let webhookServer = null;
let speaker = null;

function createRL() {
    if (rl) rl.close();
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

function clear() {
    process.stdout.write("\x1b[2J\x1b[H");
}

function print(text = "") {
    console.log(text);
}

function maskStr(str, showLast = 4) {
    if (!str) return c.dim + "(未设置)" + c.reset;
    if (str.length <= showLast) return "****";
    return "****" + str.slice(-showLast);
}

// ============================================
// UI 组件
// ============================================
const PKG_VERSION = (() => {
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
        );
        return pkg.version || "1.0.0";
    } catch {
        return "1.0.0";
    }
})();

const REPO_URL = "https://github.com/xvhuan/xiaoi";

function drawHeader() {
    print("");
    print(`  ${c.cyan}${c.bold}██╗  ██╗██╗ █████╗  ██████╗ ██╗${c.reset}`);
    print(`  ${c.cyan}${c.bold}╚██╗██╔╝██║██╔══██╗██╔═══██╗██║${c.reset}`);
    print(`  ${c.cyan}${c.bold} ╚███╔╝ ██║███████║██║   ██║██║${c.reset}`);
    print(`  ${c.cyan}${c.bold} ██╔██╗ ██║██╔══██║██║   ██║██║${c.reset}`);
    print(`  ${c.cyan}${c.bold}██╔╝ ██╗██║██║  ██║╚██████╔╝██║${c.reset}`);
    print(`  ${c.cyan}${c.bold}╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝${c.reset}`);
    print("");
    print(`  ${c.dim}小爱音箱语音通知工具  v${PKG_VERSION}${c.reset}`);
    print(`  ${c.dim}by ${c.cyan}${c.bold}ius${c.reset}${c.dim}  ${c.blue}${REPO_URL}${c.reset}`);
    print("");
}

function drawStatus(config) {
    const speakerOk = config.speaker.userId && config.speaker.did;
    const webhookOn = !!webhookServer;

    print(
        `  ${c.gray}状态:${c.reset} ` +
        `${speakerOk ? c.green + "● 已配置" : c.red + "○ 未配置"}${c.reset}  ` +
        `${c.gray}Webhook:${c.reset} ` +
        `${webhookOn ? c.green + "● :" + webhookServer.address().port : c.dim + "○ 关闭"}${c.reset}  ` +
        `${c.gray}设备:${c.reset} ${c.cyan}${config.speaker.did || "未设置"}${c.reset}`
    );
    print("");
}

function drawMenu() {
    print(`  ${c.bold}请选择操作:${c.reset}`);
    print("");
    print(`  ${c.cyan}1${c.reset}  发送语音通知`);
    print(`  ${c.cyan}2${c.reset}  设置音量`);
    print(`  ${c.cyan}3${c.reset}  账号设置`);
    print(`  ${c.cyan}4${c.reset}  Webhook 服务`);
    print(`  ${c.cyan}5${c.reset}  连接测试`);
    print(`  ${c.cyan}0${c.reset}  退出`);
    print("");
}

// ============================================
// 音箱连接
// ============================================
async function ensureSpeaker() {
    if (!speaker) {
        speaker = require("../lib/speaker");
    }
    await speaker.init();
}

// ============================================
// 功能：发送语音通知
// ============================================
async function handleTTS() {
    print(`\n  ${c.bold}📢 发送语音通知${c.reset}`);
    print(`  ${c.dim}输入要播报的文字，输入空行返回主菜单${c.reset}\n`);

    const text = await ask(`  ${c.cyan}▶${c.reset} 请输入: `);
    if (!text) return;

    try {
        print(`\n  ${c.yellow}⏳ 正在连接音箱...${c.reset}`);
        await ensureSpeaker();
        await speaker.tts(text);
        print(`  ${c.green}✅ 播报成功: "${text}"${c.reset}\n`);
    } catch (err) {
        printError(err);
    }

    await ask(`  ${c.dim}按回车返回主菜单...${c.reset}`);
}

// ============================================
// 功能：设置音量
// ============================================
async function handleVolume() {
    print(`\n  ${c.bold}🔊 设置音量${c.reset}`);
    print(`  ${c.dim}输入 0-100 的数字，输入空行返回主菜单${c.reset}\n`);

    const input = await ask(`  ${c.cyan}▶${c.reset} 音量值: `);
    if (!input) return;

    const volume = parseInt(input);
    if (isNaN(volume) || volume < 0 || volume > 100) {
        print(`  ${c.red}❌ 音量值必须为 0-100 的整数${c.reset}\n`);
        await ask(`  ${c.dim}按回车返回主菜单...${c.reset}`);
        return;
    }

    try {
        print(`\n  ${c.yellow}⏳ 正在连接音箱...${c.reset}`);
        await ensureSpeaker();
        await speaker.setVolume(volume);
        print(`  ${c.green}✅ 音量已设置为: ${volume}${c.reset}\n`);
    } catch (err) {
        printError(err);
    }

    await ask(`  ${c.dim}按回车返回主菜单...${c.reset}`);
}

// ============================================
// 功能：账号设置
// ============================================
async function handleAccountSetup() {
    const config = loadConfig();

    print(`\n  ${c.bold}⚙️  账号设置${c.reset}`);
    print(`  ${c.dim}─────────────────────────────────${c.reset}`);
    print(
        `  ${c.gray}当前账号:${c.reset} ${config.speaker.userId || c.dim + "(未设置)" + c.reset}`
    );
    print(
        `  ${c.gray}当前密码:${c.reset} ${maskStr(config.speaker.password)}`
    );
    print(
        `  ${c.gray}passToken:${c.reset} ${maskStr(config.speaker.passToken, 8)}`
    );
    print(
        `  ${c.gray}设备名称:${c.reset} ${config.speaker.did || c.dim + "(未设置)" + c.reset}`
    );
    print(`  ${c.dim}─────────────────────────────────${c.reset}`);
    print("");
    print(`  ${c.cyan}1${c.reset}  修改小米 ID（userId）`);
    print(`  ${c.cyan}2${c.reset}  修改密码`);
    print(`  ${c.cyan}3${c.reset}  修改 passToken`);
    print(`  ${c.cyan}4${c.reset}  修改设备名称（did）`);
    print(`  ${c.cyan}5${c.reset}  一键配置所有项`);
    print(`  ${c.cyan}0${c.reset}  返回主菜单`);
    print("");

    const choice = await ask(`  ${c.cyan}▶${c.reset} 选择: `);

    switch (choice) {
        case "1": {
            const val = await ask(`  ${c.cyan}▶${c.reset} 小米 ID: `);
            if (val) {
                config.speaker.userId = val;
                saveConfig(config);
                print(`  ${c.green}✅ 已保存${c.reset}`);
            }
            break;
        }
        case "2": {
            const val = await ask(`  ${c.cyan}▶${c.reset} 密码: `);
            if (val) {
                config.speaker.password = val;
                saveConfig(config);
                print(`  ${c.green}✅ 已保存${c.reset}`);
            }
            break;
        }
        case "3": {
            print(`\n  ${c.yellow}💡 获取 passToken 教程:${c.reset}`);
            print(
                `  ${c.blue}https://github.com/idootop/migpt-next/issues/4${c.reset}`
            );
            print("");
            const val = await ask(`  ${c.cyan}▶${c.reset} passToken: `);
            if (val) {
                config.speaker.passToken = val;
                saveConfig(config);
                print(`  ${c.green}✅ 已保存${c.reset}`);
            }
            break;
        }
        case "4": {
            print(
                `  ${c.dim}设备名称是音箱在米家 App 中设置的名称${c.reset}`
            );
            const val = await ask(`  ${c.cyan}▶${c.reset} 设备名称: `);
            if (val) {
                config.speaker.did = val;
                saveConfig(config);
                print(`  ${c.green}✅ 已保存${c.reset}`);
            }
            break;
        }
        case "5": {
            print(`\n  ${c.bold}一键配置${c.reset}`);
            print(
                `  ${c.dim}直接回车跳过该项（保留原值）${c.reset}\n`
            );

            const userId = await ask(
                `  ${c.cyan}▶${c.reset} 小米 ID ${c.dim}[${config.speaker.userId || "未设置"}]${c.reset}: `
            );
            if (userId) config.speaker.userId = userId;

            const password = await ask(
                `  ${c.cyan}▶${c.reset} 密码 ${c.dim}[${maskStr(config.speaker.password)}]${c.reset}: `
            );
            if (password) config.speaker.password = password;

            print(`\n  ${c.yellow}💡 获取 passToken 教程:${c.reset}`);
            print(
                `  ${c.blue}https://github.com/idootop/migpt-next/issues/4${c.reset}\n`
            );
            const passToken = await ask(
                `  ${c.cyan}▶${c.reset} passToken ${c.dim}[${maskStr(config.speaker.passToken, 8)}]${c.reset}: `
            );
            if (passToken) config.speaker.passToken = passToken;

            const did = await ask(
                `  ${c.cyan}▶${c.reset} 设备名称 ${c.dim}[${config.speaker.did || "未设置"}]${c.reset}: `
            );
            if (did) config.speaker.did = did;

            saveConfig(config);
            print(`\n  ${c.green}✅ 配置已保存到: ${getConfigPath()}${c.reset}`);
            break;
        }
        case "0":
            return;
        default:
            break;
    }

    print("");
    await ask(`  ${c.dim}按回车返回主菜单...${c.reset}`);
}

// ============================================
// 功能：Webhook 服务
// ============================================
async function handleWebhook() {
    const config = loadConfig();
    const pm2 = require("./pm2");
    const pm2Status = pm2.getWebhookStatus({ allowNpx: false });

    print(`\n  ${c.bold}🌐 Webhook 服务${c.reset}`);
    print(`  ${c.dim}─────────────────────────────────${c.reset}`);
    print(
        `  ${c.gray}状态:${c.reset} ${webhookServer ? c.green + "● 运行中" : c.red + "○ 已停止"}${c.reset}`
    );
    print(
        `  ${c.gray}端口:${c.reset} ${config.webhook ? config.webhook.port : 3088}`
    );
    print(
        `  ${c.gray}PM2 常驻:${c.reset} ` +
        `${pm2Status.available
            ? (pm2Status.running ? c.green + "● 运行中" : c.red + "○ 未运行") + c.reset + ` ${c.dim}(${pm2.PM2_APP_NAME})${c.reset}`
            : c.dim + "○ 未检测到 pm2" + c.reset}`
    );
    print(`  ${c.dim}─────────────────────────────────${c.reset}`);
    print("");

    if (webhookServer) {
        print(`  ${c.cyan}1${c.reset}  停止 Webhook 服务`);
        print(`  ${c.cyan}2${c.reset}  修改端口`);
        print(`  ${c.cyan}3${c.reset}  PM2 常驻（启动/停止）`);
        print(`  ${c.cyan}4${c.reset}  查看 PM2 状态详情`);
        print(`  ${c.cyan}0${c.reset}  返回主菜单`);
    } else {
        print(`  ${c.cyan}1${c.reset}  启动 Webhook 服务`);
        print(`  ${c.cyan}2${c.reset}  修改端口`);
        print(`  ${c.cyan}3${c.reset}  PM2 常驻（启动/停止）`);
        print(`  ${c.cyan}4${c.reset}  查看 PM2 状态详情`);
        print(`  ${c.cyan}0${c.reset}  返回主菜单`);
    }
    print("");

    const choice = await ask(`  ${c.cyan}▶${c.reset} 选择: `);

    switch (choice) {
        case "1": {
            if (webhookServer) {
                webhookServer.close();
                webhookServer = null;
                print(`  ${c.yellow}⏹  Webhook 服务已停止${c.reset}`);
            } else {
                try {
                    if (pm2Status.available && pm2Status.running) {
                        print(`  ${c.yellow}⚠️ 检测到 PM2 常驻正在运行，可能会与当前端口冲突。${c.reset}`);
                        print(`  ${c.dim}建议先停止 PM2 常驻，或修改端口后再启动。${c.reset}`);
                        print("");
                    }
                    await ensureSpeaker();
                    const port =
                        config.webhook && config.webhook.port ? config.webhook.port : 3088;
                    webhookServer = await startWebhookServer(port);
                    print(`  ${c.green}✅ Webhook 已启动: http://localhost:${port}${c.reset}`);
                    print(`  ${c.dim}POST /webhook/tts   { "text": "..." }${c.reset}`);
                    print(`  ${c.dim}POST /webhook/volume { "volume": 50 }${c.reset}`);
                } catch (err) {
                    printError(err);
                }
            }
            break;
        }
        case "2": {
            const port = await ask(`  ${c.cyan}▶${c.reset} 新端口: `);
            if (port && !isNaN(parseInt(port))) {
                if (!config.webhook) config.webhook = {};
                config.webhook.port = parseInt(port);
                saveConfig(config);
                print(`  ${c.green}✅ 端口已更新为: ${port}${c.reset}`);
            }
            break;
        }
        case "3": {
            // 避免端口被当前 TUI 内嵌服务占用导致 pm2 进程反复重启
            if (webhookServer) {
                print(`  ${c.red}❌ 请先停止当前 Webhook 服务（避免端口占用）${c.reset}`);
                break;
            }

            try {
                const st = pm2.getWebhookStatus({ allowNpx: false });
                if (st.available && st.running) {
                    const r = pm2.pm2StopWebhook();
                    print(`  ${c.yellow}⏹  已请求停止 PM2 常驻${c.reset}`);
                    const out = (r.stdout || "").trim();
                    const err = (r.stderr || "").trim();
                    if (out) print(out);
                    if (err) print(err);
                } else {
                    const r = pm2.pm2StartWebhook();
                    print(`  ${c.green}✅ 已请求启动 PM2 常驻${c.reset}`);
                    const out = (r.stdout || "").trim();
                    const err = (r.stderr || "").trim();
                    if (out) print(out);
                    if (err) print(err);
                }
            } catch (err) {
                printError(err);
            }

            break;
        }
        case "4": {
            try {
                const r = pm2.pm2DescribeWebhook({ allowNpx: true });
                const out = (r.stdout || "").trim();
                const err = (r.stderr || "").trim();
                print("");
                if (out) print(out);
                if (err) print(err);
            } catch (err) {
                printError(err);
            }
            break;
        }
        case "0":
            return;
    }

    print("");
    await ask(`  ${c.dim}按回车返回主菜单...${c.reset}`);
}

// ============================================
// Webhook 服务器（内嵌版本）
// ============================================
function startWebhookServer(port) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");

            if (req.method === "OPTIONS") {
                res.writeHead(204);
                res.end();
                return;
            }

            const url = new URL(req.url, `http://localhost:${port}`);
            const sendJSON = (code, data) => {
                res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(data));
            };

            if (req.method === "GET" && url.pathname === "/") {
                return sendJSON(200, { status: "running", time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) });
            }

            if (req.method !== "POST") {
                return sendJSON(405, { error: "仅支持 POST" });
            }

            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);

                    switch (url.pathname) {
                        case "/webhook/tts":
                            if (!data.text) return sendJSON(400, { error: "缺少 text" });
                            await speaker.tts(data.text);
                            return sendJSON(200, { success: true, text: data.text });

                        case "/webhook/audio":
                            if (!data.url) return sendJSON(400, { error: "缺少 url" });
                            await speaker.playAudio(data.url);
                            return sendJSON(200, { success: true, url: data.url });

                        case "/webhook/volume":
                            if (data.volume === undefined) return sendJSON(400, { error: "缺少 volume" });
                            await speaker.setVolume(data.volume);
                            return sendJSON(200, { success: true, volume: data.volume });

                        default:
                            return sendJSON(404, { error: "未知路径" });
                    }
                } catch (err) {
                    sendJSON(500, { error: err.message });
                }
            });
        });

        server.on("error", (err) => {
            reject(err);
        });

        server.listen(port, () => {
            resolve(server);
        });
    });
}

// ============================================
// 功能：连接测试
// ============================================
async function handleTest() {
    const config = loadConfig();

    print(`\n  ${c.bold}📡 连接测试${c.reset}\n`);

    // 检查配置
    if (!config.speaker.userId || !config.speaker.did) {
        print(`  ${c.red}❌ 请先在「账号设置」中配置账号信息${c.reset}`);
        print("");
        await ask(`  ${c.dim}按回车返回主菜单...${c.reset}`);
        return;
    }

    print(`  ${c.gray}用户 ID:${c.reset}   ${config.speaker.userId}`);
    print(`  ${c.gray}设备名称:${c.reset}  ${config.speaker.did}`);
    print(`  ${c.gray}认证方式:${c.reset}  ${config.speaker.passToken ? "passToken" : "密码"}`);
    print("");

    try {
        print(`  ${c.yellow}⏳ 正在连接...${c.reset}`);
        await ensureSpeaker();
        print(`  ${c.green}✅ 连接成功！${c.reset}\n`);

        const testText = await ask(
            `  ${c.cyan}▶${c.reset} 发送测试语音？输入文字（回车跳过）: `
        );
        if (testText) {
            await speaker.tts(testText);
            print(`  ${c.green}✅ 播报成功${c.reset}`);
        }
    } catch (err) {
        print(`  ${c.red}❌ 连接失败: ${err.message}${c.reset}`);
        print("");
        print(`  ${c.yellow}💡 如果登录失败，请参考:${c.reset}`);
        print(
            `  ${c.blue}https://github.com/idootop/migpt-next/issues/4${c.reset}`
        );
        print("");
        print(`  ${c.dim}常见解决方案:${c.reset}`);
        print(`  ${c.dim}  1. 确认小米 ID 正确（不是手机号）${c.reset}`);
        print(`  ${c.dim}  2. 使用 passToken 代替密码登录${c.reset}`);
        print(`  ${c.dim}  3. 确认设备名称与米家 App 中一致${c.reset}`);
    }

    print("");
    await ask(`  ${c.dim}按回车返回主菜单...${c.reset}`);
}

// ============================================
// 错误打印
// ============================================
function printError(err) {
    print(`  ${c.red}❌ ${err.message}${c.reset}`);
    if (
        err.message.includes("登录") ||
        err.message.includes("login") ||
        err.message.includes("auth") ||
        err.message.includes("token") ||
        err.message.includes("401")
    ) {
        print("");
        print(`  ${c.yellow}💡 登录失败？请参考:${c.reset}`);
        print(
            `  ${c.blue}https://github.com/idootop/migpt-next/issues/4${c.reset}`
        );
    }
}

// ============================================
// 主循环
// ============================================
async function mainLoop() {
    createRL();

    while (true) {
        clear();
        const config = loadConfig();
        drawHeader();
        drawStatus(config);
        drawMenu();

        const choice = await ask(`  ${c.cyan}▶${c.reset} 请选择: `);

        switch (choice) {
            case "1":
                await handleTTS();
                break;
            case "2":
                await handleVolume();
                break;
            case "3":
                await handleAccountSetup();
                break;
            case "4":
                await handleWebhook();
                break;
            case "5":
                await handleTest();
                break;
            case "0":
            case "q":
            case "quit":
            case "exit":
                if (webhookServer) {
                    webhookServer.close();
                }
                print(`\n  ${c.dim}再见！${c.reset}\n`);
                rl.close();
                process.exit(0);
            default:
                break;
        }
    }
}

module.exports = { mainLoop };
