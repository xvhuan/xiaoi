const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

function getHomeDir() {
    return process.env.USERPROFILE || process.env.HOME || os.homedir() || "";
}

function getCachePath() {
    const home = getHomeDir();
    if (!home) return null;
    return path.join(home, ".xiaoi", "update.json");
}

function safeReadJson(p) {
    try {
        if (!p) return null;
        if (!fs.existsSync(p)) return null;
        const s = fs.readFileSync(p, "utf-8");
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function safeWriteJson(p, obj) {
    try {
        if (!p) return;
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
    } catch {
        // ignore
    }
}

function parseSemver(v) {
    // 支持 "1.2.3" / "v1.2.3" / "1.2.3-beta.1"
    if (!v) return null;
    const s = String(v).trim().replace(/^v/i, "");
    const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function cmpSemver(a, b) {
    const aa = parseSemver(a);
    const bb = parseSemver(b);
    if (!aa || !bb) return null;
    if (aa.major !== bb.major) return aa.major - bb.major;
    if (aa.minor !== bb.minor) return aa.minor - bb.minor;
    return aa.patch - bb.patch;
}

function fetchJson(url, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: {
                    "User-Agent": "xiaoii-update-check",
                    Accept: "application/json",
                },
            },
            (res) => {
                let data = "";
                res.setEncoding("utf-8");
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    try {
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}`));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on("error", reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error("timeout"));
        });
    });
}

async function getLatestVersionFromNpm(packageName, timeoutMs = 1500) {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
    const json = await fetchJson(url, timeoutMs);
    const v = json && json.version ? String(json.version).trim() : "";
    return v || null;
}

async function checkForUpdate({
    packageName,
    currentVersion,
    cacheTtlMs = 24 * 60 * 60 * 1000,
    timeoutMs = 1500,
    nowMs = Date.now(),
} = {}) {
    if (!packageName || !currentVersion) {
        return { ok: false, reason: "missing_args" };
    }

    const cachePath = getCachePath();
    const cached = safeReadJson(cachePath);
    if (cached && cached.checkedAt && nowMs - Number(cached.checkedAt) < cacheTtlMs) {
        const latest = cached.latestVersion || null;
        const cmp = latest ? cmpSemver(currentVersion, latest) : null;
        return {
            ok: true,
            packageName,
            currentVersion,
            latestVersion: latest,
            outdated: typeof cmp === "number" ? cmp < 0 : false,
            cached: true,
            checkedAt: Number(cached.checkedAt),
        };
    }

    try {
        const latest = await getLatestVersionFromNpm(packageName, timeoutMs);
        const cmp = latest ? cmpSemver(currentVersion, latest) : null;
        const result = {
            ok: true,
            packageName,
            currentVersion,
            latestVersion: latest,
            outdated: typeof cmp === "number" ? cmp < 0 : false,
            cached: false,
            checkedAt: nowMs,
        };
        safeWriteJson(cachePath, {
            checkedAt: nowMs,
            latestVersion: latest,
        });
        return result;
    } catch (e) {
        // 失败不影响主流程；写入 checkedAt，避免每次启动都卡在网络错误上
        safeWriteJson(cachePath, { checkedAt: nowMs, latestVersion: cached ? cached.latestVersion : null });
        return {
            ok: false,
            packageName,
            currentVersion,
            error: e && e.message ? e.message : String(e),
        };
    }
}

module.exports = {
    checkForUpdate,
    getCachePath,
};

