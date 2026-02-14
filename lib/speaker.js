/**
 * 核心模块：小爱音箱控制器
 *
 * 直接使用 @mi-gpt/next 底层 API，不需要 webhook 中间层
 * 提供 init / tts / playAudio / setVolume / doAction 等方法
 */

const fs = require("fs");
const path = require("path");

let MiService;
let MiSpeaker;
const LOG_PREFIX = "[XIAOI]";

const DEFAULT_TTS_FALLBACK_COMMANDS = Object.freeze({
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
    x4b: [5, 3],
    x6a: [7, 3],
    x08e: [7, 3],
    x8f: [7, 3],
});

const TTS_MODES = Object.freeze({
    AUTO: "auto",
    COMMAND: "command",
    DEFAULT: "default",
});

let initialized = false;
let activeSpeakerConfig = null;
let detailedLogEnabled = false;

/**
 * 获取 .mi.json 缓存目录（固定为 ~/.xiaoi/），确保目录存在
 */
function getMiCacheDir() {
    const home = process.env.USERPROFILE || process.env.HOME || require("os").homedir();
    const dir = path.join(home, ".xiaoi");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * 在回调执行期间临时切换 cwd 到 ~/.xiaoi/
 * 确保 @mi-gpt/miot 的 .mi.json 始终写入固定位置，而非调用者的 cwd
 */
async function withMiCwd(fn) {
    const originalCwd = process.cwd();
    const cacheDir = getMiCacheDir();
    try {
        process.chdir(cacheDir);
        return await fn();
    } finally {
        // 恢复原始工作目录（目录可能已被删除，忽略错误）
        try { process.chdir(originalCwd); } catch (_) { }
    }
}

// 动态加载 ESM 模块
async function loadModules() {
    if (MiService && MiSpeaker) return;
    const serviceModule = await import("@mi-gpt/next/service");
    const speakerModule = await import("@mi-gpt/next/speaker");
    MiService = serviceModule.MiService;
    MiSpeaker = speakerModule.MiSpeaker;
}

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

function normalizeModel(model) {
    return String(model || "")
        .trim()
        .toLowerCase();
}

function normalizeActionCommand(command) {
    if (!Array.isArray(command) || command.length < 2) return null;
    const siid = Number(command[0]);
    const aiid = Number(command[1]);
    if (!Number.isFinite(siid) || !Number.isFinite(aiid)) return null;
    return [Math.trunc(siid), Math.trunc(aiid)];
}

function normalizeTTSMode(mode) {
    const text = String(mode || "").trim().toLowerCase();
    if (text === TTS_MODES.COMMAND || text === TTS_MODES.DEFAULT) {
        return text;
    }
    return TTS_MODES.AUTO;
}

function logDetailed(message) {
    if (!detailedLogEnabled) return;
    console.log(`${LOG_PREFIX} ${message}`);
}

function formatActionCommand(command) {
    if (!Array.isArray(command) || command.length < 2) return "[?, ?]";
    return `[${command[0]}, ${command[1]}]`;
}

function buildModelCandidates(model) {
    const normalized = normalizeModel(model);
    if (!normalized) return [];

    const candidates = new Set();
    candidates.add(normalized);
    candidates.add(normalized.replace(/\s+/g, ""));

    const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    if (parts.length > 0) {
        candidates.add(parts[parts.length - 1]);
    }

    const prefixes = [
        "xiaomi.wifispeaker.",
        "xiaomi.wifispeaker_",
        "xiaomi.wifispeaker-",
        "xiaomi.",
        "xiaomi_",
        "xiaomi-",
    ];

    for (const prefix of prefixes) {
        if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
            candidates.add(normalized.slice(prefix.length));
        }
    }

    return Array.from(candidates).filter(Boolean);
}

function normalizeCommandMap(rawMap) {
    const normalizedMap = {};
    if (!rawMap || typeof rawMap !== "object") return normalizedMap;

    for (const [key, value] of Object.entries(rawMap)) {
        const normalizedKey = normalizeModel(key);
        if (!normalizedKey) continue;
        normalizedMap[normalizedKey] = value;
    }
    return normalizedMap;
}

function resolveTTSCommandForModel(model, speakerConfig) {
    const customMap = normalizeCommandMap(
        speakerConfig && speakerConfig.ttsFallbackCommands
    );

    const commandMap = {
        ...DEFAULT_TTS_FALLBACK_COMMANDS,
        ...customMap,
    };

    const explicitDefault =
        normalizeActionCommand(speakerConfig && speakerConfig.ttsFallbackCommand) ||
        normalizeActionCommand(commandMap.default) ||
        [5, 1];

    const normalizedModel = normalizeModel(model);
    for (const key of buildModelCandidates(model)) {
        const cmd = normalizeActionCommand(commandMap[key]);
        if (cmd) {
            return {
                model: normalizedModel,
                matchedKey: key,
                command: cmd,
                source: "model",
            };
        }
    }

    return {
        model: normalizedModel,
        matchedKey: "default",
        command: explicitDefault,
        source: "default",
    };
}

function resolveFallbackCommand(model, speakerConfig) {
    return resolveTTSCommandForModel(model, speakerConfig).command;
}

function ensureActiveSpeakerConfig() {
    if (!activeSpeakerConfig || typeof activeSpeakerConfig !== "object") {
        activeSpeakerConfig = {};
    }
    if (
        !activeSpeakerConfig.ttsFallbackCommands ||
        typeof activeSpeakerConfig.ttsFallbackCommands !== "object"
    ) {
        activeSpeakerConfig.ttsFallbackCommands = {};
    }
    return activeSpeakerConfig;
}

function getActiveTTSMode() {
    return normalizeTTSMode(activeSpeakerConfig && activeSpeakerConfig.ttsMode);
}

function setTTSMode(mode) {
    const normalized = normalizeTTSMode(mode);
    const config = ensureActiveSpeakerConfig();
    config.ttsMode = normalized;
    return normalized;
}

function setDetailedLogEnabled(enabled) {
    const value = !!enabled;
    detailedLogEnabled = value;
    const config = ensureActiveSpeakerConfig();
    config.verboseLog = value;
    return value;
}

function isDetailedLogEnabled() {
    return !!detailedLogEnabled;
}

function getActiveTTSCommandInfo() {
    const model = getCurrentDeviceModel();
    const candidates = buildModelCandidates(model);
    const resolved = resolveTTSCommandForModel(model, activeSpeakerConfig || {});
    return {
        model,
        candidates,
        command: resolved.command,
        matchedKey: resolved.matchedKey,
        source: resolved.source,
    };
}

function setTTSFallbackCommand(command) {
    const normalized = normalizeActionCommand(command);
    if (!normalized) {
        throw new Error("ttscmd 格式无效，需要 [siid, aiid]");
    }
    const config = ensureActiveSpeakerConfig();
    config.ttsFallbackCommand = normalized;
    return normalized;
}

function setTTSFallbackCommandForModel(model, command) {
    const modelKey = normalizeModel(model);
    if (!modelKey) {
        throw new Error("model 不能为空");
    }
    const normalized = normalizeActionCommand(command);
    if (!normalized) {
        throw new Error("ttscmd 格式无效，需要 [siid, aiid]");
    }
    const config = ensureActiveSpeakerConfig();
    config.ttsFallbackCommands[modelKey] = normalized;
    return {
        model: modelKey,
        command: normalized,
    };
}

function getCurrentDeviceModel() {
    return (
        MiService?.MiOT?.account?.device?.model ||
        MiService?.MiNA?.account?.device?.hardware ||
        ""
    );
}

function normalizeDeviceList(devices) {
    if (!Array.isArray(devices)) return [];
    return devices.filter((item) => item && typeof item === "object");
}

function toUnifiedMiNADevice(device) {
    const did = String(device.miotDID || device.deviceID || device.deviceId || "").trim();
    const name = String(device.alias || device.name || did || "未知设备").trim();
    const model = normalizeModel(device.hardware || "");
    const online =
        typeof device.presence === "string"
            ? device.presence.toLowerCase() === "online"
            : undefined;

    return {
        did,
        name,
        alias: String(device.alias || "").trim(),
        model,
        mac: String(device.mac || "").trim(),
        online,
        source: "MiNA",
    };
}

function toUnifiedMIoTDevice(device) {
    const did = String(device.did || "").trim();
    const name = String(device.name || did || "未知设备").trim();
    const model = normalizeModel(device.model || "");
    const online =
        typeof device.isOnline === "boolean" ? device.isOnline : undefined;

    return {
        did,
        name,
        alias: "",
        model,
        mac: String(device.mac || "").trim(),
        online,
        source: "MIoT",
    };
}

function mergeDevices(devices) {
    const byDid = new Map();
    const byMac = new Map();
    const merged = [];

    function findExisting(device) {
        if (device.did && byDid.has(device.did)) return byDid.get(device.did);
        if (device.mac && byMac.has(device.mac)) return byMac.get(device.mac);
        return null;
    }

    function track(device) {
        if (device.did) byDid.set(device.did, device);
        if (device.mac) byMac.set(device.mac, device);
    }

    for (const device of devices) {
        const existing = findExisting(device);
        if (!existing) {
            const row = { ...device, sources: [device.source] };
            merged.push(row);
            track(row);
            continue;
        }

        existing.name = existing.name || device.name;
        existing.alias = existing.alias || device.alias;

        if (device.source === "MIoT" && device.model) {
            existing.model = device.model;
        } else if (!existing.model && device.model) {
            existing.model = device.model;
        }

        if (!existing.did && device.did) {
            existing.did = device.did;
            byDid.set(existing.did, existing);
        }
        if (!existing.mac && device.mac) {
            existing.mac = device.mac;
            byMac.set(existing.mac, existing);
        }
        if (existing.online === undefined && device.online !== undefined) {
            existing.online = device.online;
        }

        if (!Array.isArray(existing.sources)) {
            existing.sources = [existing.source].filter(Boolean);
        }
        if (device.source && !existing.sources.includes(device.source)) {
            existing.sources.push(device.source);
        }
    }

    return merged
        .filter((device) => device.did || device.name)
        .sort((left, right) => {
            const onlineLeft = left.online === true ? 1 : 0;
            const onlineRight = right.online === true ? 1 : 0;
            if (onlineLeft !== onlineRight) return onlineRight - onlineLeft;
            return left.name.localeCompare(right.name, "zh-CN");
        });
}

async function listDevices(speakerConfig) {
    const config = speakerConfig || loadConfig().speaker;

    if (!config || !config.userId || !(config.passToken || config.password)) {
        throw new Error("请先配置 userId 与 passToken（或 password）");
    }

    const miotModule = await import("@mi-gpt/miot");
    const getMiNA = miotModule.getMiNA || miotModule.default?.getMiNA;
    const getMIoT = miotModule.getMIoT || miotModule.default?.getMIoT;

    if (typeof getMiNA !== "function" || typeof getMIoT !== "function") {
        throw new Error("加载 @mi-gpt/miot 失败，无法读取设备列表");
    }

    const serviceConfig = {
        userId: config.userId,
        password: config.password,
        passToken: config.passToken,
        did: "",
        debug: false,
        timeout: config.timeout,
        relogin: true,
    };

    const [MiNAClient, MIoTClient] = await withMiCwd(() => Promise.all([
        getMiNA(serviceConfig),
        getMIoT(serviceConfig),
    ]));

    const [minaResult, miotResult] = await Promise.allSettled([
        MiNAClient?.getDevices?.(),
        MIoTClient?.getDevices?.(),
    ]);

    const minaDevices =
        minaResult.status === "fulfilled" ? normalizeDeviceList(minaResult.value) : [];
    const miotDevices =
        miotResult.status === "fulfilled" ? normalizeDeviceList(miotResult.value) : [];

    const unified = [
        ...minaDevices.map(toUnifiedMiNADevice),
        ...miotDevices.map(toUnifiedMIoTDevice),
    ];

    return mergeDevices(unified);
}

/**
 * 初始化音箱连接
 */
async function init(speakerConfig) {
    if (initialized) return;

    await loadModules();

    const config = speakerConfig || loadConfig().speaker;
    config.ttsMode = normalizeTTSMode(config.ttsMode);
    config.verboseLog = !!config.verboseLog;
    activeSpeakerConfig = config;
    detailedLogEnabled = !!config.verboseLog;

    await withMiCwd(() => MiService.init({
        debug: false,
        speaker: config,
    }));

    initialized = true;
}

/**
 * 发送文字 TTS
 *
 * 逻辑：
 * 1) 优先按型号映射执行 ttscmd（MiOT.doAction）
 * 2) ttscmd 失败后回退到 @mi-gpt/next 默认链路（MiNA.play(text)）
 */
async function tts(text) {
    if (!initialized) throw new Error("请先调用 init() 初始化");

    const mode = getActiveTTSMode();
    if (mode === TTS_MODES.COMMAND) {
        const result = await ttsByCommand(text);
        return !!result.ok;
    }
    if (mode === TTS_MODES.DEFAULT) {
        const result = await ttsByDefault(text);
        return !!result.ok;
    }

    const commandInfo = getActiveTTSCommandInfo();
    let fallbackError = null;

    if (commandInfo.command) {
        try {
            const cmdResult = await ttsByCommand(text);
            if (cmdResult.ok) return true;
        } catch (err) {
            fallbackError = err;
        }
    }

    try {
        const primaryResult = await ttsByDefault(text);
        if (primaryResult.ok) return true;
    } catch (primaryError) {
        if (fallbackError) {
            const mergedError = new Error(
                `TTS ttscmd 与默认链路均失败: ttscmd=${fallbackError.message}; default=${primaryError.message}`
            );
            mergedError.cause = { fallbackError, primaryError };
            throw mergedError;
        }
        throw primaryError;
    }

    if (fallbackError) throw fallbackError;
    return false;
}

async function ttsByCommand(text, command) {
    if (!initialized) throw new Error("请先调用 init() 初始化");
    const model = getCurrentDeviceModel();
    const manualCommand = normalizeActionCommand(command);
    const resolved = manualCommand
        ? {
            model: normalizeModel(model),
            matchedKey: "manual",
            command: manualCommand,
            source: "manual",
        }
        : resolveTTSCommandForModel(model, activeSpeakerConfig || {});
    const resolvedCommand = resolved.command;
    if (!resolvedCommand) {
        throw new Error("未找到可用的 ttscmd");
    }

    const [siid, aiid] = resolvedCommand;
    if (resolved.source === "manual") {
        logDetailed(`[TTS Map] source=manual, command=${formatActionCommand(resolvedCommand)}`);
    } else {
        logDetailed(
            `[TTS AutoMap] model=${resolved.model || "unknown"}, match=${resolved.matchedKey}, source=${resolved.source}, command=${formatActionCommand(resolvedCommand)}`
        );
    }

    const result = await MiService.MiOT.doAction(siid, aiid, text);
    logDetailed(
        `[TTS Command] source=${resolved.source}, command=${formatActionCommand(resolvedCommand)}, ok=${!!result}`
    );

    return {
        ok: !!result,
        model,
        command: [siid, aiid],
        source: resolved.source,
        matchedKey: resolved.matchedKey,
        result,
    };
}

async function ttsByDefault(text) {
    if (!initialized) throw new Error("请先调用 init() 初始化");
    const result = await MiSpeaker.play({ text });
    logDetailed(`[TTS Default] MiNA.play(text) ok=${!!result}`);
    return {
        ok: !!result,
        result,
    };
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
    DEFAULT_TTS_FALLBACK_COMMANDS,
    TTS_MODES,
    loadConfig,
    init,
    listDevices,
    resolveTTSCommandForModel,
    getActiveTTSMode,
    setTTSMode,
    setDetailedLogEnabled,
    isDetailedLogEnabled,
    getActiveTTSCommandInfo,
    setTTSFallbackCommand,
    setTTSFallbackCommandForModel,
    tts,
    ttsByCommand,
    ttsByDefault,
    playAudio,
    setVolume,
    doAction,
};
