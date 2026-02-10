const fs = require("fs");
const os = require("os");
const path = require("path");

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
        fs.writeFileSync(cfgPath, JSON.stringify(defaultConfig(), null, 4), "utf-8");
        return { created: true, path: cfgPath };
    } catch {
        return { created: false, path: cfgPath };
    }
}

module.exports = {
    getHomeDir,
    getXiaoiDir,
    getUserConfigPath,
    defaultConfig,
    ensureUserConfigExists,
};

