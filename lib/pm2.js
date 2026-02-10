const path = require("path");
const { spawnSync } = require("child_process");

const PM2_APP_NAME = "xiaoi-webhook";
const WEBHOOK_ENTRY = path.join(__dirname, "webhook_server.js");
const PKG_ROOT = path.join(__dirname, "..");

function normalizeResult(r) {
    return {
        status: typeof r.status === "number" ? r.status : null,
        stdout: (r.stdout || "").toString(),
        stderr: (r.stderr || "").toString(),
        error: r.error || null,
    };
}

function tryRun(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
        cwd: opts.cwd || PKG_ROOT,
        env: { ...process.env, ...(opts.env || {}) },
        encoding: "utf-8",
        timeout: opts.timeoutMs || 120000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    });
    return normalizeResult(r);
}

function isENOENT(err) {
    return !!err && (err.code === "ENOENT" || err.errno === -2);
}

function detectPm2CLI() {
    const r = tryRun("pm2", ["-v"], { timeoutMs: 10000 });
    if (isENOENT(r.error)) return null;
    return { kind: "pm2", cmd: "pm2", prefixArgs: [] };
}

function detectNpx() {
    const r = tryRun("npx", ["-v"], { timeoutMs: 10000 });
    if (isENOENT(r.error)) return null;
    return { kind: "npx", cmd: "npx", prefixArgs: ["-y", "pm2"] };
}

function runPm2(args, opts = {}) {
    const allowNpx = opts.allowNpx !== false;

    const pm2 = detectPm2CLI();
    if (pm2) {
        const r = tryRun(pm2.cmd, [...pm2.prefixArgs, ...args], opts);
        return { invoker: pm2.kind, ...r };
    }

    if (!allowNpx) {
        const err = new Error("未检测到 pm2（可先安装：npm i -g pm2），或使用带 npx 的 Node 环境");
        err.code = "PM2_NOT_FOUND";
        throw err;
    }

    const npx = detectNpx();
    if (!npx) {
        const err = new Error("未检测到 pm2，也未检测到 npx；请先安装 npm/Node 或手动安装 pm2");
        err.code = "PM2_AND_NPX_NOT_FOUND";
        throw err;
    }

    const r = tryRun(npx.cmd, [...npx.prefixArgs, ...args], opts);
    return { invoker: npx.kind, ...r };
}

function pm2DescribeWebhook(opts = {}) {
    return runPm2(["describe", PM2_APP_NAME], opts);
}

function pm2WebhookExists(opts = {}) {
    try {
        const r = pm2DescribeWebhook({ ...opts, allowNpx: opts.allowNpx });
        return r.status === 0;
    } catch (e) {
        // pm2 不存在时，这里返回 false 让上层决定是否走 npx
        return false;
    }
}

function pm2StartWebhook() {
    // 如果已存在，优先 restart，避免重复创建进程
    if (pm2WebhookExists({ allowNpx: true })) {
        return runPm2(["restart", PM2_APP_NAME, "--update-env"], { allowNpx: true });
    }

    return runPm2(
        [
            "start",
            WEBHOOK_ENTRY,
            "--name",
            PM2_APP_NAME,
            "--time",
            "--cwd",
            PKG_ROOT,
        ],
        { allowNpx: true }
    );
}

function pm2StopWebhook() {
    return runPm2(["stop", PM2_APP_NAME], { allowNpx: true });
}

function pm2RestartWebhook() {
    return runPm2(["restart", PM2_APP_NAME, "--update-env"], { allowNpx: true });
}

function pm2DeleteWebhook() {
    return runPm2(["delete", PM2_APP_NAME], { allowNpx: true });
}

function pm2Save() {
    return runPm2(["save"], { allowNpx: true });
}

function pm2Startup() {
    return runPm2(["startup"], { allowNpx: true });
}

function pm2Logs(lines = 100) {
    // 优先用 --nostream（不进入持续输出模式），旧版 pm2 可能不支持，失败则回退
    const args = ["logs", PM2_APP_NAME, "--lines", String(lines), "--nostream"];
    const r = runPm2(args, { allowNpx: true });
    if (r.status === 0) return r;
    return runPm2(["logs", PM2_APP_NAME, "--lines", String(lines)], { allowNpx: true });
}

function pm2Status(opts = {}) {
    // 不强制下载 pm2：TUI 展示状态时更友好
    const allowNpx = opts.allowNpx === true;
    return runPm2(["jlist"], { allowNpx });
}

function getWebhookStatus(opts = {}) {
    try {
        const r = pm2Status({ allowNpx: !!opts.allowNpx });
        if (r.status !== 0) {
            return {
                available: true,
                running: false,
                status: "unknown",
                detail: (r.stderr || r.stdout || "").trim(),
            };
        }

        const list = JSON.parse(r.stdout || "[]");
        const proc = Array.isArray(list)
            ? list.find((p) => p && p.name === PM2_APP_NAME)
            : null;

        if (!proc) {
            return { available: true, running: false, status: "stopped" };
        }

        const env = proc.pm2_env || {};
        const status = env.status || "unknown";

        return {
            available: true,
            running: status === "online",
            status,
            pid: proc.pid,
            pm_id: proc.pm_id,
            uptime: env.pm_uptime,
        };
    } catch (e) {
        if (e && e.code === "PM2_NOT_FOUND") {
            return { available: false, running: false, status: "pm2_not_found" };
        }
        return {
            available: false,
            running: false,
            status: "error",
            detail: e && e.message ? e.message : String(e),
        };
    }
}

module.exports = {
    PM2_APP_NAME,
    WEBHOOK_ENTRY,
    pm2StartWebhook,
    pm2StopWebhook,
    pm2RestartWebhook,
    pm2DeleteWebhook,
    pm2DescribeWebhook,
    pm2Save,
    pm2Startup,
    pm2Logs,
    getWebhookStatus,
};
