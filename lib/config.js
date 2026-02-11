const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function getHomeDir() {
    return process.env.USERPROFILE || process.env.HOME || os.homedir() || "";
}

function getXiaoiDir() {
    const home = getHomeDir();
    return home ? path.join(home, ".xiaoi") : "";
}

function getUserConfigPath() {
    const dir = getXiaoiDir();
    return dir ? path.join(dir, "config.json") : "";
}

function defaultConfig() {
    return {
        speaker: {
            userId: "",
            password: "",
            passToken: "",
            did: "",
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
        webhook: {
            port: 3088,
            host: "localhost",
            token: "",
            logFile: "log/webhook.log",
        },
        mcp: {
            logFile: "log/mcp_server.log",
        },
    };
}

function ensureDir(dirPath) {
    if (!dirPath) return;
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function saveConfigFile(configPath, config) {
    if (!configPath) throw new Error("configPath 为空");
    ensureDir(path.dirname(configPath));
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), "utf-8");
}

function ensureUserConfigExists() {
    const cfgPath = getUserConfigPath();
    if (!cfgPath) return { created: false, path: "" };

    const dir = path.dirname(cfgPath);
    try {
        ensureDir(dir);
    } catch {
        return { created: false, path: cfgPath };
    }

    if (fs.existsSync(cfgPath)) return { created: false, path: cfgPath };

    try {
        saveConfigFile(cfgPath, defaultConfig());
        return { created: true, path: cfgPath };
    } catch {
        return { created: false, path: cfgPath };
    }
}

function loadUserConfig() {
    const { path: cfgPath } = ensureUserConfigExists();
    if (!cfgPath || !fs.existsSync(cfgPath)) {
        throw new Error("无法创建/读取用户配置文件 ~/.xiaoi/config.json");
    }
    const config = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    return { config, path: cfgPath };
}

function resolveLogFile(config, configPath, key /* "webhook" | "mcp" */) {
    const base = configPath ? path.dirname(configPath) : getXiaoiDir() || process.cwd();
    const val =
        config &&
        config[key] &&
        typeof config[key].logFile === "string" &&
        config[key].logFile.trim()
            ? config[key].logFile.trim()
            : "";
    if (!val) {
        return path.join(base, `${key}.log`);
    }
    if (path.isAbsolute(val)) return val;
    return path.join(base, val);
}

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

module.exports = {
    getHomeDir,
    getXiaoiDir,
    getUserConfigPath,
    defaultConfig,
    saveConfigFile,
    ensureUserConfigExists,
    loadUserConfig,
    resolveLogFile,
    generateToken,
};
