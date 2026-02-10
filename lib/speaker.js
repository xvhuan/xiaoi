/**
 * 核心模块：小爱音箱控制器
 *
 * 直接使用 @mi-gpt/next 底层 API，不需要 webhook 中间层
 * 提供 init / tts / playAudio / setVolume / doAction 等方法
 */

const fs = require("fs");
const path = require("path");

let MiService, MiSpeaker;

// 动态加载 ESM 模块
async function loadModules() {
    if (MiService && MiSpeaker) return;
    const serviceModule = await import("@mi-gpt/next/service");
    const speakerModule = await import("@mi-gpt/next/speaker");
    MiService = serviceModule.MiService;
    MiSpeaker = speakerModule.MiSpeaker;
}

// 状态
let initialized = false;

/**
 * 加载配置文件
 * 优先从用户主目录 ~/.xiaoi/config.json 读取
 * 其次从项目根目录 config.json 读取
 */
function loadConfig() {
    const homeConfig = path.join(
        process.env.USERPROFILE || process.env.HOME || "",
        ".xiaoi",
        "config.json"
    );
    const localConfig = path.join(__dirname, "..", "config.json");

    let configPath;
    if (fs.existsSync(homeConfig)) {
        configPath = homeConfig;
    } else if (fs.existsSync(localConfig)) {
        configPath = localConfig;
    } else {
        throw new Error(
            `找不到配置文件，请创建:\n  - ${homeConfig}\n  - 或 ${localConfig}`
        );
    }

    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/**
 * 初始化音箱连接
 */
async function init(speakerConfig) {
    if (initialized) return;

    await loadModules();

    const config = speakerConfig || loadConfig().speaker;

    await MiService.init({
        debug: false,
        speaker: config,
    });

    initialized = true;
}

/**
 * 发送文字 TTS
 */
async function tts(text) {
    if (!initialized) throw new Error("请先调用 init() 初始化");
    return await MiSpeaker.play({ text });
}

/**
 * 播放音频链接
 */
async function playAudio(url) {
    if (!initialized) throw new Error("请先调用 init() 初始化");
    return await MiSpeaker.play({ url });
}

/**
 * 设置音量
 */
async function setVolume(volume) {
    if (!initialized) throw new Error("请先调用 init() 初始化");
    return await MiService.MiNA.setVolume(volume);
}

/**
 * 执行 MioT 指令
 */
async function doAction(siid, aiid, params) {
    if (!initialized) throw new Error("请先调用 init() 初始化");
    return await MiService.MiOT.doAction(siid, aiid, params);
}

module.exports = {
    loadConfig,
    init,
    tts,
    playAudio,
    setVolume,
    doAction,
};
