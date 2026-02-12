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
const pm2 = require("./pm2");
const crypto = require("crypto");
const { checkForUpdate } = require("./version_check");

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
            speaker: {
                userId: "",
                password: "",
                passToken: "",
                did: "",
                ttsMode: "auto",
                verboseLog: false,
                ttsFallbackCommand: [5, 1],
                ttsFallbackCommands: {
                    oh2p: [7, 3],
                    oh2: [5, 3],
                    lx06: [5, 1],
                    s12: [5, 1],
                    l15a: [7, 3],
                    lx5a: [5, 1],
                    lx05: [5, 1],
                    x10a: [7, 3],
                    l17a: [7, 3],
                    l06a: [5, 1],
                    lx01: [5, 1],
                    l05b: [5, 3],
                    l05c: [5, 3],
                    l09a: [3, 1],
                    lx04: [5, 1],
                    asx4b: [5, 3],
                    x6a: [7, 3],
                    x08e: [7, 3],
                    x8f: [7, 3],
                },
            },
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

async function selectMenu({
    items,
    render,
    initialIndex = 0,
    fallbackQuestion = `  ${c.cyan}▶${c.reset} 选择: `,
}) {
    // 非 TTY 环境直接退化为输入
    if (!process.stdin.isTTY) {
        render(initialIndex);
        return await ask(fallbackQuestion);
    }

    readline.emitKeypressEvents(process.stdin);

    let rawOk = false;
    try {
        process.stdin.setRawMode(true);
        rawOk = true;
    } catch {
        render(initialIndex);
        return await ask(fallbackQuestion);
    }

    process.stdin.resume();

    let idx = Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1));
    // 合并同一时间片内的多次按键重绘，减少 Windows 控制台卡顿
    let renderScheduled = false;
    const queueRender = () => {
        if (renderScheduled) return;
        renderScheduled = true;
        setTimeout(() => {
            renderScheduled = false;
            render(idx);
        }, 0);
    };
    render(idx);

    return await new Promise((resolve) => {
        const cleanup = () => {
            process.stdin.off("keypress", onKeypress);
            if (rawOk) {
                try {
                    process.stdin.setRawMode(false);
                } catch {
                    // ignore
                }
            }
        };

        const pickKey = (k) => {
            const s = String(k);
            if (!items.some((it) => String(it.key) === s)) return false;
            cleanup();
            resolve(s);
            return true;
        };

        const onKeypress = (str, key) => {
            // Ctrl+C
            if (key && key.ctrl && key.name === "c") {
                cleanup();
                process.exit(0);
                return;
            }

            // 快捷键选择（数字/字母，含小键盘数字）
            if (str && /^[0-9a-zA-Z]$/.test(str)) {
                if (pickKey(str)) return;
            }

            // ↑/↓ 选择（方向键或小键盘方向键，兼容 j/k）
            if (key && (key.name === "up" || key.name === "k")) {
                idx = (idx - 1 + items.length) % items.length;
                queueRender();
                return;
            }
            if (key && (key.name === "down" || key.name === "j")) {
                idx = (idx + 1) % items.length;
                queueRender();
                return;
            }

            // 回车确认
            if (key && key.name === "return") {
                const chosen = items[idx];
                cleanup();
                resolve(String(chosen.key));
                return;
            }

            // ESC/q：如果存在 0，则返回 0
            if ((key && key.name === "escape") || str === "q") {
                if (pickKey("0")) return;
            }
        };

        process.stdin.on("keypress", onKeypress);
    });
}

function clear() {
    process.stdout.write("\x1b[2J\x1b[H");
}

function print(text = "") {
    process.stdout.write(String(text) + "\n");
}

function maskStr(str, showLast = 4) {
    if (!str) return c.dim + "(未设置)" + c.reset;
    if (str.length <= showLast) return "****";
    return "****" + str.slice(-showLast);
}

function parseCommandInput(input) {
    const text = String(input || "").trim();
    if (!text) return null;

    const parts = text
        .split(/[^0-9]+/)
        .map((item) => Number(item))
        .filter((num) => Number.isFinite(num));

    if (parts.length < 2) return null;
    return [Math.trunc(parts[0]), Math.trunc(parts[1])];
}

function formatCommand(command) {
    if (!Array.isArray(command) || command.length < 2) {
        return "(未设置)";
    }
    return `[${command[0]}, ${command[1]}]`;
}

function formatTTSMode(mode) {
    const val = String(mode || "auto").trim().toLowerCase();
    if (val === "command") return "仅 ttscmd";
    if (val === "default") return "仅默认链路";
    return "自动（先 ttscmd 后默认）";
}

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
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

const PKG_NAME = (() => {
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
        );
        return pkg.name || "xiaoii";
    } catch {
        return "xiaoii";
    }
})();

let _updateInfo = null;
let _updateCheckStarted = false;
function startUpdateCheckOnce() {
    if (_updateCheckStarted) return;
    _updateCheckStarted = true;
    if (process.env.XIAOI_NO_UPDATE_CHECK) return;

    checkForUpdate({ packageName: PKG_NAME, currentVersion: PKG_VERSION })
        .then((r) => {
            if (r && r.ok) _updateInfo = r;
        })
        .catch(() => {});
}

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
    if (_updateInfo && _updateInfo.ok && _updateInfo.outdated && _updateInfo.latestVersion) {
        print(
            `  ${c.yellow}⬆ 发现新版本 v${_updateInfo.latestVersion}${c.reset}` +
            `${c.dim}（当前 v${_updateInfo.currentVersion}，npm i -g ${_updateInfo.packageName}@latest）${c.reset}`
        );
    }
    print("");
}

function drawStatus(config) {
    const speakerOk = config.speaker.userId && config.speaker.did;
    const pm2St = getPm2StatusCached();
    const webhookOn = !!webhookServer;
    const pm2Text = (() => {
        if (!pm2St || !pm2St.available) return c.dim + "○ 未安装" + c.reset;
        return pm2St.running
            ? c.green + "● 运行中" + c.reset
            : c.dim + "○ 未运行" + c.reset;
    })();

    const webhookText = (() => {
        if (webhookOn) {
            try {
                return c.green + "● :" + webhookServer.address().port + c.reset;
            } catch {
                return c.green + "● 运行中" + c.reset;
            }
        }

        // TUI 内嵌未开启，但 PM2 常驻可能在运行
        if (pm2St && pm2St.available && pm2St.running) {
            const port =
                config.webhook && config.webhook.port ? String(config.webhook.port) : "";
            return c.green + "● PM2" + (port ? ":" + port : "") + c.reset;
        }

        return c.dim + "○ 关闭" + c.reset;
    })();

    print(
        `  ${c.gray}状态:${c.reset} ` +
        `${speakerOk ? c.green + "● 已配置" : c.red + "○ 未配置"}${c.reset}  ` +
        `${c.gray}Webhook:${c.reset} ` +
        `${webhookText}  ` +
        `${c.gray}PM2:${c.reset} ${pm2Text}  ` +
        `${c.gray}设备:${c.reset} ${c.cyan}${config.speaker.did || "未设置"}${c.reset}`
    );
    print("");
}

// ============================================
// PM2 状态缓存（避免每次刷新都 spawn 一次 pm2）
// ============================================
let _pm2StatusCache = { ts: 0, value: null };
function invalidatePm2StatusCache() {
    _pm2StatusCache = { ts: 0, value: null };
}
function getPm2StatusCached() {
    // 只在首次（value 为空）时读取一次，之后仅在执行 PM2 操作后通过 invalidate 刷新，避免频繁 spawn。
    if (_pm2StatusCache.value) return _pm2StatusCache.value;

    const v = pm2.getWebhookStatus({ allowNpx: false });
    _pm2StatusCache = { ts: Date.now(), value: v };
    return v;
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

function drawSelectableItems(items, selectedIdx) {
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const selected = i === selectedIdx;
        const left = selected
            ? `${c.bgCyan}${c.white} ${String(it.key)} ${c.reset}`
            : `  ${c.cyan}${it.key}${c.reset}`;
        const label = selected ? `${c.bold}${it.label}${c.reset}` : it.label;
        print(`  ${left}  ${label}`);
    }
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

async function ensureSpeakerModule() {
    if (!speaker) {
        speaker = require("../lib/speaker");
    }
    return speaker;
}

async function selectDidFromDeviceList(config) {
    const speakerModule = await ensureSpeakerModule();
    const authReady =
        !!(config && config.speaker && config.speaker.userId) &&
        !!(
            config &&
            config.speaker &&
            (config.speaker.passToken || config.speaker.password)
        );

    if (!authReady) {
        print(`\n  ${c.red}❌ 请先填写 userId 和 passToken（或 password）${c.reset}`);
        await ask(`  ${c.dim}按回车返回...${c.reset}`);
        return null;
    }

    try {
        print(`\n  ${c.yellow}🔎 正在读取设备列表，请稍候...${c.reset}`);
        const devices = await speakerModule.listDevices(config.speaker);

        if (!devices || devices.length < 1) {
            print(`\n  ${c.red}❌ 未读取到设备，请检查账号或网络${c.reset}`);
            await ask(`  ${c.dim}按回车返回...${c.reset}`);
            return null;
        }

        const maxShow = Math.min(devices.length, 30);
        const items = [
            ...devices.slice(0, maxShow).map((device, index) => {
                const onlineText =
                    device.online === true
                        ? `${c.green}在线${c.reset}`
                        : device.online === false
                          ? `${c.gray}离线${c.reset}`
                          : `${c.dim}未知${c.reset}`;
                const modelText = device.model || "unknown";
                return {
                    key: String(index + 1),
                    did: device.did,
                    label:
                        `${device.name || "未命名设备"}` +
                        `  ${c.dim}[did:${device.did || "-"}]${c.reset}` +
                        `  ${c.dim}[model:${modelText}]${c.reset}` +
                        `  ${c.dim}[${onlineText}]${c.reset}`,
                };
            }),
            { key: "0", did: null, label: "返回" },
        ];

        const picked = await selectMenu({
            items,
            initialIndex: 0,
            render: (selectedIdx) => {
                clear();
                drawHeader();
                drawStatus(loadConfig());
                print(`\n  ${c.bold}📋 选择目标设备（将写入 did）${c.reset}`);
                print(
                    `  ${c.dim}共 ${devices.length} 台，当前展示 ${maxShow} 台（在线优先）${c.reset}`
                );
                print(`  ${c.dim}─────────────────────────────────${c.reset}`);
                drawSelectableItems(items, selectedIdx);
                print("");
                print(`  ${c.dim}↑↓选择，回车确认，数字快捷选择${c.reset}`);
            },
            fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择设备: `,
        });

        if (picked === "0") return null;
        const target = items.find((item) => item.key === picked && item.did);
        return target ? target.did : null;
    } catch (err) {
        print(`\n  ${c.red}❌ 读取设备列表失败: ${err.message}${c.reset}`);
        await ask(`  ${c.dim}按回车返回...${c.reset}`);
        return null;
    }
}

// ============================================
// 功能：发送语音通知
// ============================================
async function handleTTS() {
    clear();
    drawHeader();
    drawStatus(loadConfig());

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
    clear();
    drawHeader();
    drawStatus(loadConfig());

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
    while (true) {
        const items = [
            { key: "1", label: "修改小米 ID（userId）" },
            { key: "2", label: "修改密码" },
            { key: "3", label: "修改 passToken" },
            { key: "4", label: "修改设备名称（did）" },
            { key: "5", label: "查看设备列表并选择 did" },
            { key: "6", label: "修改默认 ttscmd（[siid, aiid]）" },
            { key: "7", label: "修改机型 ttscmd（按 model）" },
            { key: "8", label: "切换 TTS 链路模式" },
            { key: "9", label: "切换详细日志（verbose）" },
            { key: "a", label: "一键配置所有项" },
            { key: "0", label: "返回上级" },
        ];

        const choice = await selectMenu({
            items,
            initialIndex: 0,
            render: (selectedIdx) => {
                clear();
                const config = loadConfig();
                drawHeader();
                drawStatus(config);

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
                print(
                    `  ${c.gray}默认 ttscmd:${c.reset} ${formatCommand(config.speaker.ttsFallbackCommand)}`
                );
                print(
                    `  ${c.gray}TTS 模式:${c.reset} ${formatTTSMode(config.speaker.ttsMode)}`
                );
                print(
                    `  ${c.gray}详细日志:${c.reset} ${config.speaker.verboseLog ? c.green + "开启" + c.reset : c.dim + "关闭" + c.reset}`
                );
                print(`  ${c.dim}─────────────────────────────────${c.reset}`);
                print("");

                drawSelectableItems(items, selectedIdx);
                print("");
                print(`  ${c.dim}↑/↓ 选择，回车确认，数字快捷选择${c.reset}`);
            },
            fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择: `,
        });

        switch (choice) {
            case "1": {
                const config = loadConfig();
                const val = await ask(`  ${c.cyan}▶${c.reset} 小米 ID: `);
                if (val) {
                    config.speaker.userId = val;
                    saveConfig(config);
                    print(`  ${c.green}✅ 已保存${c.reset}`);
                }
                break;
            }
            case "2": {
                const config = loadConfig();
                const val = await ask(`  ${c.cyan}▶${c.reset} 密码: `);
                if (val) {
                    config.speaker.password = val;
                    saveConfig(config);
                    print(`  ${c.green}✅ 已保存${c.reset}`);
                }
                break;
            }
            case "3": {
                const config = loadConfig();
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
                const config = loadConfig();
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
                const config = loadConfig();
                const selectedDid = await selectDidFromDeviceList(config);
                if (selectedDid) {
                    config.speaker.did = selectedDid;
                    saveConfig(config);
                    print(`\n  ${c.green}✅ 已选择设备 did: ${selectedDid}${c.reset}`);
                }
                break;
            }
            case "6": {
                const config = loadConfig();
                const current = formatCommand(config.speaker.ttsFallbackCommand);
                const raw = await ask(
                    `  ${c.cyan}▶${c.reset} 默认 ttscmd ${c.dim}[当前 ${current}]${c.reset}: `
                );
                if (raw) {
                    const parsed = parseCommandInput(raw);
                    if (!parsed) {
                        print(
                            `  ${c.red}❌ 格式错误，请输入如 [5,1] 或 5,1${c.reset}`
                        );
                    } else {
                        config.speaker.ttsFallbackCommand = parsed;
                        saveConfig(config);
                        try {
                            const speakerModule = await ensureSpeakerModule();
                            if (typeof speakerModule.setTTSFallbackCommand === "function") {
                                speakerModule.setTTSFallbackCommand(parsed);
                            }
                        } catch {
                            // ignore runtime sync error
                        }
                        print(
                            `  ${c.green}✅ 已保存默认 ttscmd: ${formatCommand(parsed)}${c.reset}`
                        );
                    }
                }
                break;
            }
            case "7": {
                const config = loadConfig();
                const model = await ask(`  ${c.cyan}▶${c.reset} 机型 model（如 lx04）: `);
                if (model) {
                    const key = String(model).trim().toLowerCase();
                    const current = formatCommand(
                        config.speaker.ttsFallbackCommands &&
                            config.speaker.ttsFallbackCommands[key]
                    );
                    const raw = await ask(
                        `  ${c.cyan}▶${c.reset} ${key} 的 ttscmd ${c.dim}[当前 ${current}]${c.reset}: `
                    );
                    if (raw) {
                        const parsed = parseCommandInput(raw);
                        if (!parsed) {
                            print(
                                `  ${c.red}❌ 格式错误，请输入如 [5,1] 或 5,1${c.reset}`
                            );
                        } else {
                            if (
                                !config.speaker.ttsFallbackCommands ||
                                typeof config.speaker.ttsFallbackCommands !== "object"
                            ) {
                                config.speaker.ttsFallbackCommands = {};
                            }
                            config.speaker.ttsFallbackCommands[key] = parsed;
                            saveConfig(config);
                            try {
                                const speakerModule = await ensureSpeakerModule();
                                if (
                                    typeof speakerModule.setTTSFallbackCommandForModel ===
                                    "function"
                                ) {
                                    speakerModule.setTTSFallbackCommandForModel(
                                        key,
                                        parsed
                                    );
                                }
                            } catch {
                                // ignore runtime sync error
                            }
                            print(
                                `  ${c.green}✅ 已保存 ${key} 的 ttscmd: ${formatCommand(parsed)}${c.reset}`
                            );
                        }
                    }
                }
                break;
            }
            case "8": {
                const config = loadConfig();
                const mode = await selectMenu({
                    items: [
                        { key: "1", label: "自动（先 ttscmd 后默认）" },
                        { key: "2", label: "仅 ttscmd" },
                        { key: "3", label: "仅默认链路（MiNA.play）" },
                        { key: "0", label: "取消" },
                    ],
                    initialIndex: 0,
                    render: (selectedIdx) => {
                        clear();
                        drawHeader();
                        drawStatus(loadConfig());
                        print(`\n  ${c.bold}🎛️ 选择 TTS 模式${c.reset}\n`);
                        print(
                            `  ${c.dim}当前: ${formatTTSMode(config.speaker.ttsMode)}${c.reset}`
                        );
                        print("");
                        drawSelectableItems(
                            [
                                { key: "1", label: "自动（先 ttscmd 后默认）" },
                                { key: "2", label: "仅 ttscmd" },
                                { key: "3", label: "仅默认链路（MiNA.play）" },
                                { key: "0", label: "取消" },
                            ],
                            selectedIdx
                        );
                        print("");
                        print(`  ${c.dim}↑/↓ 选择，回车确认${c.reset}`);
                    },
                    fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择: `,
                });

                const map = { "1": "auto", "2": "command", "3": "default" };
                if (map[mode]) {
                    config.speaker.ttsMode = map[mode];
                    saveConfig(config);
                    try {
                        const speakerModule = await ensureSpeakerModule();
                        if (typeof speakerModule.setTTSMode === "function") {
                            speakerModule.setTTSMode(config.speaker.ttsMode);
                        }
                    } catch {
                        // ignore runtime sync error
                    }
                    print(
                        `  ${c.green}✅ 已切换模式: ${formatTTSMode(config.speaker.ttsMode)}${c.reset}`
                    );
                }
                break;
            }
            case "9": {
                const config = loadConfig();
                config.speaker.verboseLog = !config.speaker.verboseLog;
                saveConfig(config);
                try {
                    const speakerModule = await ensureSpeakerModule();
                    if (typeof speakerModule.setDetailedLogEnabled === "function") {
                        speakerModule.setDetailedLogEnabled(config.speaker.verboseLog);
                    }
                } catch {
                    // ignore runtime sync error
                }
                print(
                    `  ${c.green}✅ 详细日志已${config.speaker.verboseLog ? "开启" : "关闭"}${c.reset}`
                );
                break;
            }
            case "a": {
                const config = loadConfig();
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

                const defaultCmd = await ask(
                    `  ${c.cyan}▶${c.reset} 默认 ttscmd ${c.dim}[${formatCommand(config.speaker.ttsFallbackCommand)}]${c.reset}: `
                );
                if (defaultCmd) {
                    const parsed = parseCommandInput(defaultCmd);
                    if (parsed) {
                        config.speaker.ttsFallbackCommand = parsed;
                    } else {
                        print(
                            `  ${c.yellow}⚠️ ttscmd 格式无效，已保留原值${c.reset}`
                        );
                    }
                }

                const modeVal = await ask(
                    `  ${c.cyan}▶${c.reset} TTS 模式 ${c.dim}[auto/command/default，当前 ${config.speaker.ttsMode || "auto"}]${c.reset}: `
                );
                if (modeVal) {
                    const normalized = String(modeVal).trim().toLowerCase();
                    if (["auto", "command", "default"].includes(normalized)) {
                        config.speaker.ttsMode = normalized;
                    } else {
                        print(`  ${c.yellow}⚠️ 模式无效，已保留原值${c.reset}`);
                    }
                }

                const verboseVal = await ask(
                    `  ${c.cyan}▶${c.reset} 详细日志 ${c.dim}[on/off，当前 ${config.speaker.verboseLog ? "on" : "off"}]${c.reset}: `
                );
                if (verboseVal) {
                    const normalized = String(verboseVal).trim().toLowerCase();
                    if (["on", "true", "1", "yes", "y"].includes(normalized)) {
                        config.speaker.verboseLog = true;
                    } else if (
                        ["off", "false", "0", "no", "n"].includes(normalized)
                    ) {
                        config.speaker.verboseLog = false;
                    } else {
                        print(`  ${c.yellow}⚠️ 详细日志输入无效，已保留原值${c.reset}`);
                    }
                }

                saveConfig(config);
                try {
                    const speakerModule = await ensureSpeakerModule();
                    if (
                        typeof speakerModule.setTTSFallbackCommand === "function" &&
                        Array.isArray(config.speaker.ttsFallbackCommand)
                    ) {
                        speakerModule.setTTSFallbackCommand(
                            config.speaker.ttsFallbackCommand
                        );
                    }
                    if (typeof speakerModule.setTTSMode === "function") {
                        speakerModule.setTTSMode(config.speaker.ttsMode || "auto");
                    }
                    if (typeof speakerModule.setDetailedLogEnabled === "function") {
                        speakerModule.setDetailedLogEnabled(!!config.speaker.verboseLog);
                    }
                } catch {
                    // ignore runtime sync error
                }
                print(`\n  ${c.green}✅ 配置已保存到: ${getConfigPath()}${c.reset}`);
                break;
            }
            case "0":
                return;
            default:
                break;
        }

        print("");
        await ask(`  ${c.dim}按回车返回账号设置...${c.reset}`);
    }
}

// ============================================
// 功能：Webhook 服务
// ============================================
async function handleWebhook() {
    while (true) {
        const items = [
            { key: "1", label: webhookServer ? "停止 Webhook 服务" : "启动 Webhook 服务" },
            { key: "2", label: "修改端口" },
            { key: "3", label: "PM2 常驻（启动/停止）" },
            { key: "4", label: "查看 PM2 状态详情" },
            { key: "5", label: "查看 PM2 日志" },
            { key: "6", label: "Webhook Token（查看/修改）" },
            { key: "7", label: "公网访问开关（host）" },
            { key: "0", label: "返回上级" },
        ];

        const choice = await selectMenu({
            items,
            initialIndex: 0,
            render: (selectedIdx) => {
                clear();
                const config = loadConfig();
                const pm2Status = getPm2StatusCached();
                drawHeader();
                drawStatus(config);

                print(`\n  ${c.bold}🌐 Webhook 服务${c.reset}`);
                print(`  ${c.dim}─────────────────────────────────${c.reset}`);
                const embedRunning = !!webhookServer;
                const pm2Running = !!(pm2Status && pm2Status.available && pm2Status.running);
                const statusText = (() => {
                    if (embedRunning) return c.green + "● 运行中" + c.reset + ` ${c.dim}(内嵌)${c.reset}`;
                    if (pm2Running) return c.green + "● 运行中" + c.reset + ` ${c.dim}(PM2 常驻)${c.reset}`;
                    return c.red + "○ 已停止" + c.reset;
                })();

                print(`  ${c.gray}状态:${c.reset} ${statusText}`);
                print(
                    `  ${c.gray}端口:${c.reset} ${config.webhook ? config.webhook.port : 3088}`
                );
                print(
                    `  ${c.gray}监听:${c.reset} ${c.cyan}${(config.webhook && config.webhook.host) ? String(config.webhook.host) : "localhost"}${c.reset}`
                );
                print(
                    `  ${c.gray}Token:${c.reset} ${maskStr(config.webhook && config.webhook.token ? String(config.webhook.token).trim() : "", 8)}`
                );
                print(
                    `  ${c.gray}PM2 常驻:${c.reset} ` +
                    `${pm2Status.available
                        ? (pm2Status.running ? c.green + "● 运行中" : c.red + "○ 未运行") + c.reset + ` ${c.dim}(${pm2.PM2_APP_NAME})${c.reset}`
                        : c.dim + "○ 未检测到 pm2" + c.reset}`
                );
                print(`  ${c.dim}─────────────────────────────────${c.reset}`);
                print("");

                items[0].label = embedRunning
                    ? "停止 内嵌 Webhook 服务"
                    : (pm2Running ? "启动 内嵌 Webhook（需先停止 PM2 常驻）" : "启动 内嵌 Webhook 服务");
                items[2].label = pm2Running ? "PM2 常驻（停止）" : "PM2 常驻（启动）";
                drawSelectableItems(items, selectedIdx);
                print("");
                print(`  ${c.dim}↑/↓ 选择，回车确认，数字快捷选择${c.reset}`);
            },
        });

        async function ensurePm2Choice() {
            const avail = pm2.detectAvailability();
            if (avail.pm2) return { allowNpx: false };

            const items = [
                { key: "1", label: "全局安装 pm2（推荐）" },
                { key: "2", label: "临时使用 npx pm2（仅本次操作，可能较慢）" },
                { key: "0", label: "取消" },
            ];

            const c1 = await selectMenu({
                items,
                initialIndex: 0,
                render: (selectedIdx) => {
                    clear();
                    const config = loadConfig();
                    drawHeader();
                    drawStatus(config);
                    print(`\n  ${c.bold}PM2 安装/运行方式${c.reset}`);
                    print(`  ${c.dim}未检测到 pm2，请选择一个方案：${c.reset}\n`);
                    drawSelectableItems(items, selectedIdx);
                    print("");
                    print(`  ${c.dim}↑/↓ 选择，回车确认，数字快捷选择${c.reset}`);
                },
                fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择: `,
            });
            if (c1 === "1") {
                const r = pm2.installPm2Global();
                const out = (r.stdout || "").trim();
                const err = (r.stderr || "").trim();
                if (out) print(out);
                if (err) print(err);

                const avail2 = pm2.detectAvailability();
                if (!avail2.pm2) {
                    if (avail.npx) {
                        const items2 = [
                            { key: "1", label: "使用 npx pm2 执行本次操作" },
                            { key: "0", label: "取消" },
                        ];
                        const c2 = await selectMenu({
                            items: items2,
                            initialIndex: 0,
                            render: (selectedIdx) => {
                                clear();
                                const config = loadConfig();
                                drawHeader();
                                drawStatus(config);
                                print(`\n  ${c.yellow}⚠️ 全局安装已执行，但仍未检测到 pm2。${c.reset}`);
                                print(`  ${c.dim}是否本次改用 npx pm2 执行？${c.reset}\n`);
                                drawSelectableItems(items2, selectedIdx);
                                print("");
                                print(`  ${c.dim}↑/↓ 选择，回车确认，数字快捷选择${c.reset}`);
                            },
                            fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择: `,
                        });
                        if (c2 === "1") return { allowNpx: true };
                    }

                    print(`  ${c.red}❌ 全局安装后仍未检测到 pm2。你也可以手动执行: npm i -g pm2${c.reset}`);
                    await ask(`  ${c.dim}按回车返回...${c.reset}`);
                    return null;
                }

                return { allowNpx: false };
            }

            if (c1 === "2") {
                if (!avail.npx) {
                    print(`  ${c.red}❌ 未检测到 npx，请先安装 Node.js/npm 或全局安装 pm2${c.reset}`);
                    await ask(`  ${c.dim}按回车返回...${c.reset}`);
                    return null;
                }
                return { allowNpx: true };
            }

            return null;
        }

        // 选择“返回/取消”时不要再额外提示“按回车返回...”
        let skipPause = false;

        switch (choice) {
            case "1": {
                if (webhookServer) {
                    webhookServer.close();
                    webhookServer = null;
                    print(`  ${c.yellow}⏹  Webhook 服务已停止${c.reset}`);
                } else {
                    try {
                        const pm2Status = pm2.getWebhookStatus({ allowNpx: false });
                        const config = loadConfig();

                        if (pm2Status.available && pm2Status.running) {
                            print(`  ${c.yellow}⚠️ 检测到 PM2 常驻正在运行，可能会与当前端口冲突。${c.reset}`);
                            print(`  ${c.dim}建议先停止 PM2 常驻，或修改端口后再启动。${c.reset}`);
                            print("");
                        }
                        await ensureSpeaker();
                        const port =
                            config.webhook && config.webhook.port ? config.webhook.port : 3088;
                        const host =
                            config.webhook && config.webhook.host
                                ? String(config.webhook.host).trim()
                                : "localhost";
                        webhookServer = await startWebhookServer(port, host || "localhost");
                        print(`  ${c.green}✅ Webhook 已启动: http://localhost:${port}${c.reset}`);
                        if (host && host !== "localhost") {
                            print(`  ${c.yellow}⚠️ 当前监听地址为: ${host}${c.reset}`);
                        }
                        print(`  ${c.dim}POST /webhook/tts   { "text": "..." }${c.reset}`);
                        print(`  ${c.dim}POST /webhook/volume { "volume": 50 }${c.reset}`);
                    } catch (err) {
                        printError(err);
                    }
                }
                break;
            }
            case "2": {
                const config = loadConfig();
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
                    const opt = await ensurePm2Choice();
                    if (!opt) {
                        skipPause = true;
                        break;
                    }

                    const st = pm2.getWebhookStatus({ allowNpx: opt.allowNpx });
                    if (st.available && st.running) {
                        const r = pm2.pm2StopWebhook({ allowNpx: opt.allowNpx });
                        print(`  ${c.yellow}⏹  已请求停止 PM2 常驻${c.reset}`);
                        const out = (r.stdout || "").trim();
                        const err = (r.stderr || "").trim();
                        if (out) print(out);
                        if (err) print(err);
                        invalidatePm2StatusCache();
                    } else {
                        const r = pm2.pm2StartWebhook({ allowNpx: opt.allowNpx });
                        print(`  ${c.green}✅ 已请求启动 PM2 常驻${c.reset}`);
                        const out = (r.stdout || "").trim();
                        const err = (r.stderr || "").trim();
                        if (out) print(out);
                        if (err) print(err);
                        invalidatePm2StatusCache();
                    }
                } catch (err) {
                    printError(err);
                }

                break;
            }
            case "4": {
                try {
                    const opt = await ensurePm2Choice();
                    if (!opt) {
                        skipPause = true;
                        break;
                    }

                    const r = pm2.pm2DescribeWebhook({ allowNpx: opt.allowNpx });
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
            case "5": {
                try {
                    const opt = await ensurePm2Choice();
                    if (!opt) {
                        skipPause = true;
                        break;
                    }

                    clear();
                    const config = loadConfig();
                    drawHeader();
                    drawStatus(config);
                    print(`\n  ${c.bold}📄 PM2 日志${c.reset}`);
                    print(`  ${c.dim}显示最近 N 行（不跟随输出）。默认 200。${c.reset}\n`);

                    const input = await ask(`  ${c.cyan}▶${c.reset} 行数(回车=200): `);
                    const n = input ? parseInt(input, 10) : 200;
                    const lines = Number.isFinite(n) && n > 0 ? n : 200;

                    const r = pm2.pm2Logs(lines, { allowNpx: opt.allowNpx });
                    const out = (r.stdout || "").trimEnd();
                    const err = (r.stderr || "").trimEnd();
                    print("");
                    if (out) print(out);
                    if (err) print(err);
                } catch (err) {
                    printError(err);
                }

                print("");
                await ask(`  ${c.dim}按回车返回 Webhook 菜单...${c.reset}`);
                skipPause = true;
                break;
            }
            case "6": {
                const config = loadConfig();
                if (!config.webhook) config.webhook = {};
                while (true) {
                    const cur = config.webhook.token ? String(config.webhook.token).trim() : "";
                    const items = [
                        { key: "1", label: "显示完整 Token" },
                        { key: "2", label: "修改 Token" },
                        { key: "3", label: "重新生成 Token" },
                        { key: "4", label: "清空 Token（不鉴权，不推荐）" },
                        { key: "0", label: "返回" },
                    ];

                    const sub = await selectMenu({
                        items,
                        initialIndex: 0,
                        render: (selectedIdx) => {
                            clear();
                            const cfg = loadConfig();
                            drawHeader();
                            drawStatus(cfg);

                            const cur2 = cfg.webhook && cfg.webhook.token ? String(cfg.webhook.token).trim() : "";
                            print(`\n  ${c.bold}🔐 Webhook Token${c.reset}`);
                            print(`  ${c.dim}用于 Webhook 鉴权：Authorization: Bearer <token> 或 X-Xiaoi-Token${c.reset}`);
                            print(`  ${c.gray}当前:${c.reset} ${maskStr(cur2, 8)}`);
                            print("");
                            drawSelectableItems(items, selectedIdx);
                            print("");
                            print(`  ${c.dim}↑/↓ 选择，回车确认，数字快捷选择${c.reset}`);
                        },
                        fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择: `,
                    });

                    if (sub === "0") break;

                    // 每次操作都从配置文件读取最新值，避免循环内 config 过期
                    const cfgNow = loadConfig();
                    if (!cfgNow.webhook) cfgNow.webhook = {};
                    const curNow = cfgNow.webhook.token ? String(cfgNow.webhook.token).trim() : "";

                    switch (sub) {
                        case "1":
                            clear();
                            drawHeader();
                            drawStatus(cfgNow);
                            print(`\n  ${c.bold}🔐 Webhook Token${c.reset}\n`);
                            print(`  ${c.gray}完整 Token:${c.reset} ${curNow || c.dim + "(未设置)" + c.reset}`);
                            break;
                        case "2": {
                            clear();
                            drawHeader();
                            drawStatus(cfgNow);
                            print(`\n  ${c.bold}🔐 修改 Token${c.reset}\n`);
                            const val = await ask(`  ${c.cyan}▶${c.reset} 输入新 Token（回车取消）: `);
                            if (val) {
                                cfgNow.webhook.token = val.trim();
                                saveConfig(cfgNow);
                                print(`\n  ${c.green}✅ Token 已更新${c.reset}`);
                            }
                            break;
                        }
                        case "3": {
                            cfgNow.webhook.token = generateToken();
                            saveConfig(cfgNow);
                            clear();
                            drawHeader();
                            drawStatus(cfgNow);
                            print(`\n  ${c.green}✅ Token 已重新生成${c.reset}`);
                            print(`  ${c.gray}新 Token:${c.reset} ${cfgNow.webhook.token}`);
                            break;
                        }
                        case "4": {
                            cfgNow.webhook.token = "";
                            saveConfig(cfgNow);
                            clear();
                            drawHeader();
                            drawStatus(cfgNow);
                            print(`\n  ${c.yellow}⚠️ 已清空 Token（不鉴权）${c.reset}`);
                            break;
                        }
                        default:
                            break;
                    }

                    if (webhookServer) {
                        print("");
                        print(`  ${c.dim}提示：TUI 内嵌 Webhook 的 Token 在启动时读取，修改后需要重启 Webhook 才生效。${c.reset}`);
                    }

                    print("");
                    await ask(`  ${c.dim}按回车返回 Token 菜单...${c.reset}`);
                }

                // Token 子菜单自己已经处理了返回，不要再额外暂停一次
                skipPause = true;
                break;
            }
            case "7": {
                const config = loadConfig();
                if (!config.webhook) config.webhook = {};
                const items = [
                    { key: "1", label: "开启公网访问（host=0.0.0.0）" },
                    { key: "2", label: "关闭公网访问（host=localhost）" },
                    { key: "0", label: "返回" },
                ];

                const sub = await selectMenu({
                    items,
                    initialIndex: 0,
                    render: (selectedIdx) => {
                        clear();
                        const cfg = loadConfig();
                        drawHeader();
                        drawStatus(cfg);

                        const cur = cfg.webhook && cfg.webhook.host ? String(cfg.webhook.host).trim() : "localhost";
                        const isPublic = cur === "0.0.0.0" || cur === "::";

                        print(`\n  ${c.bold}🌍 公网访问开关${c.reset}`);
                        print(`  ${c.dim}关闭：仅本机访问（host=localhost）${c.reset}`);
                        print(`  ${c.dim}开启：监听所有网卡（host=0.0.0.0），需注意安全${c.reset}`);
                        print(`\n  ${c.gray}当前:${c.reset} ${isPublic ? c.green + "开启" : c.red + "关闭"}${c.reset}  ${c.dim}(host=${cur})${c.reset}`);
                        print("");
                        drawSelectableItems(items, selectedIdx);
                        print("");
                        print(`  ${c.dim}↑/↓ 选择，回车确认，数字快捷选择${c.reset}`);
                    },
                    fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择: `,
                });

                if (sub === "0") {
                    skipPause = true;
                    break;
                }

                if (sub === "1") {
                    const cfgNow = loadConfig();
                    if (!cfgNow.webhook) cfgNow.webhook = {};
                    cfgNow.webhook.host = "0.0.0.0";
                    const t = cfgNow.webhook.token ? String(cfgNow.webhook.token).trim() : "";
                    if (!t) {
                        cfgNow.webhook.token = generateToken();
                        print(`\n  ${c.green}✅ 已生成 Token${c.reset}`);
                        print(`  ${c.gray}Token:${c.reset} ${cfgNow.webhook.token}`);
                    }
                    saveConfig(cfgNow);
                    print(`\n  ${c.green}✅ 已开启公网访问${c.reset}`);
                    print(`  ${c.dim}提示：如使用 PM2 常驻，请重启：xiaoi pm2 restart${c.reset}`);
                    if (webhookServer) {
                        print(`  ${c.dim}提示：TUI 内嵌 Webhook 需要停止后再启动才会按新 host 绑定${c.reset}`);
                    }
                } else if (sub === "2") {
                    const cfgNow = loadConfig();
                    if (!cfgNow.webhook) cfgNow.webhook = {};
                    cfgNow.webhook.host = "localhost";
                    saveConfig(cfgNow);
                    print(`\n  ${c.green}✅ 已关闭公网访问${c.reset}`);
                    print(`  ${c.dim}提示：如使用 PM2 常驻，请重启：xiaoi pm2 restart${c.reset}`);
                    if (webhookServer) {
                        print(`  ${c.dim}提示：TUI 内嵌 Webhook 需要停止后再启动才会按新 host 绑定${c.reset}`);
                    }
                }
                break;
            }
            case "0":
                return;
            default:
                break;
        }

        if (skipPause) continue;

        print("");
        await ask(`  ${c.dim}按回车返回 Webhook 菜单...${c.reset}`);
    }
}

// ============================================
// Webhook 服务器（内嵌版本）
// ============================================
function startWebhookServer(port, host) {
    return new Promise((resolve, reject) => {
        const token = (() => {
            try {
                const cfg = loadConfig();
                const t =
                    cfg && cfg.webhook && typeof cfg.webhook.token === "string"
                        ? cfg.webhook.token.trim()
                        : "";
                return t || "";
            } catch {
                return "";
            }
        })();

        function checkAuth(req) {
            if (!token) return true;

            const auth = req.headers["authorization"] || "";
            if (typeof auth === "string" && auth.startsWith("Bearer ")) {
                const t = auth.slice("Bearer ".length).trim();
                if (t && t === token) return true;
            }

            const xToken = req.headers["x-xiaoi-token"];
            if (typeof xToken === "string" && xToken.trim() === token) return true;

            return false;
        }

        const server = http.createServer(async (req, res) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization, X-Xiaoi-Token"
            );

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

            if (!checkAuth(req)) {
                return sendJSON(401, { error: "未授权（需要 webhook.token）" });
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

        if (host) {
            server.listen(port, host, () => {
                resolve(server);
            });
            return;
        }

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

    clear();
    drawHeader();
    drawStatus(config);

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
    print(`  ${c.gray}TTS 模式:${c.reset}  ${formatTTSMode(config.speaker.ttsMode)}`);
    print(
        `  ${c.gray}详细日志:${c.reset}  ${config.speaker.verboseLog ? "开启" : "关闭"}`
    );
    print("");

    try {
        const speakerModule = await ensureSpeakerModule();

        print(`  ${c.yellow}⏳ 正在连接...${c.reset}`);
        await ensureSpeaker();
        print(`  ${c.green}✅ 连接成功！${c.reset}\n`);

        let info = null;
        if (typeof speakerModule.getActiveTTSCommandInfo === "function") {
            info = speakerModule.getActiveTTSCommandInfo();
        }

        if (info && Array.isArray(info.command)) {
            print(
                `  ${c.gray}当前机型:${c.reset} ${info.model || "unknown"}  ${c.gray}ttscmd:${c.reset} ${formatCommand(info.command)}`
            );
            if (Array.isArray(info.candidates) && info.candidates.length > 0) {
                print(
                    `  ${c.gray}匹配键:${c.reset} ${info.candidates.join(", ")}`
                );
            }
            print("");
        }

        const testText = await ask(
            `  ${c.cyan}▶${c.reset} 发送测试语音？输入文字（回车跳过）: `
        );
        if (testText) {
            const cmdInput = await ask(
                `  ${c.cyan}▶${c.reset} 手动指定 ttscmd（留空用当前映射，如 [5,1]）: `
            );
            const manualCmd = cmdInput ? parseCommandInput(cmdInput) : null;
            if (cmdInput && !manualCmd) {
                throw new Error("手动 ttscmd 格式错误，请使用 [siid,aiid] 或 siid,aiid");
            }

            const quickMode = await ask(
                `  ${c.cyan}▶${c.reset} 临时模式（auto/command/default，留空沿用当前）: `
            );
            let tempMode = null;
            if (quickMode) {
                const modeValue = String(quickMode).trim().toLowerCase();
                if (["auto", "command", "default"].includes(modeValue)) {
                    tempMode = modeValue;
                } else {
                    throw new Error("临时模式仅支持 auto/command/default");
                }
            }

            const mode = await selectMenu({
                items: [
                    { key: "1", label: "按当前模式执行（可被临时模式覆盖）" },
                    { key: "2", label: "仅测试 ttscmd 链路" },
                    { key: "3", label: "仅测试默认链路（MiNA.play）" },
                    { key: "0", label: "取消" },
                ],
                initialIndex: 0,
                render: (selectedIdx) => {
                    clear();
                    drawHeader();
                    drawStatus(loadConfig());
                    print(`\n  ${c.bold}🧪 TTS 主动测试${c.reset}\n`);
                    print(`  ${c.dim}文本: ${testText}${c.reset}`);
                    if (info && Array.isArray(info.command)) {
                        print(
                            `  ${c.dim}当前 ttscmd: ${formatCommand(info.command)}${c.reset}`
                        );
                    }
                    if (manualCmd) {
                        print(
                            `  ${c.dim}手动 ttscmd: ${formatCommand(manualCmd)}${c.reset}`
                        );
                    }
                    if (tempMode) {
                        print(
                            `  ${c.dim}临时模式: ${formatTTSMode(tempMode)}${c.reset}`
                        );
                    }
                    print("");
                    drawSelectableItems(
                        [
                            { key: "1", label: "按当前模式执行（可被临时模式覆盖）" },
                            { key: "2", label: "仅测试 ttscmd 链路" },
                            { key: "3", label: "仅测试默认链路（MiNA.play）" },
                            { key: "0", label: "取消" },
                        ],
                        selectedIdx
                    );
                    print("");
                    print(`  ${c.dim}↑/↓ 选择，回车确认${c.reset}`);
                },
                fallbackQuestion: `  ${c.cyan}▶${c.reset} 选择测试模式: `,
            });

            if (mode === "1") {
                if (tempMode) {
                    if (typeof speakerModule.setTTSMode === "function") {
                        speakerModule.setTTSMode(tempMode);
                    }
                    print(
                        `  ${c.gray}临时模式生效: ${formatTTSMode(tempMode)}${c.reset}`
                    );
                }

                if (manualCmd) {
                    if (typeof speakerModule.ttsByCommand !== "function") {
                        throw new Error("当前版本不支持手动 ttscmd 调试");
                    }
                    await speakerModule.ttsByCommand(testText, manualCmd);
                    print(
                        `  ${c.green}✅ 完成：手动 ttscmd 执行 ${formatCommand(manualCmd)}${c.reset}`
                    );
                } else {
                    await speaker.tts(testText);
                    print(`  ${c.green}✅ 完成：按当前模式执行${c.reset}`);
                }

                if (tempMode) {
                    try {
                        if (typeof speakerModule.setTTSMode === "function") {
                            speakerModule.setTTSMode(config.speaker.ttsMode || "auto");
                        }
                    } catch {
                        // ignore restore error
                    }
                }
            } else if (mode === "2") {
                if (typeof speakerModule.ttsByCommand !== "function") {
                    throw new Error("当前版本不支持单独测试 ttscmd 链路");
                }
                await speakerModule.ttsByCommand(testText, manualCmd || undefined);
                print(`  ${c.green}✅ 完成：ttscmd 链路测试${c.reset}`);
            } else if (mode === "3") {
                if (typeof speakerModule.ttsByDefault !== "function") {
                    throw new Error("当前版本不支持单独测试默认链路");
                }
                await speakerModule.ttsByDefault(testText);
                print(`  ${c.green}✅ 完成：默认链路测试${c.reset}`);
            }
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
    startUpdateCheckOnce();

    while (true) {
        const items = [
            { key: "1", label: "发送语音通知" },
            { key: "2", label: "设置音量" },
            { key: "3", label: "账号设置" },
            { key: "4", label: "Webhook 服务" },
            { key: "5", label: "连接测试" },
            { key: "0", label: "退出" },
        ];

        const choice = await selectMenu({
            items,
            initialIndex: 0,
            render: (selectedIdx) => {
                clear();
                const config = loadConfig();
                drawHeader();
                drawStatus(config);
                print(`  ${c.bold}请选择操作:${c.reset}`);
                print("");
                drawSelectableItems(items, selectedIdx);
                print("");
                print(`  ${c.dim}↑/↓ 选择，回车确认，数字快捷选择${c.reset}`);
            },
            fallbackQuestion: `  ${c.cyan}▶${c.reset} 请选择: `,
        });

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
