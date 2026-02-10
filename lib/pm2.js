const path = require("path");
const { spawnSync } = require("child_process");
const fs = require("fs");

const PM2_APP_NAME = "xiaoi-webhook";
const WEBHOOK_ENTRY = path.join(__dirname, "webhook_server.js");
const PKG_ROOT = path.join(__dirname, "..");

function normalizeResult(r) {
    const stdout = (r.stdout || "").toString();
    let stderr = (r.stderr || "").toString();

    // spawnSync 在找不到命令（ENOENT）等场景下，往往只有 r.error 没有 stderr
    if ((!stderr || !stderr.trim()) && r.error && r.error.message) {
        stderr = String(r.error.message);
    }

    return {
        status: typeof r.status === "number" ? r.status : r.error ? 1 : null,
        stdout,
        stderr,
        error: r.error || null,
    };
}

function tryRun(cmd, args, opts = {}) {
    const spawnOpts = {
        cwd: opts.cwd || PKG_ROOT,
        env: { ...process.env, ...(opts.env || {}) },
        encoding: "utf-8",
        timeout: opts.timeoutMs || 120000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    };

    // Windows 下 npm/npx/pm2 往往是 .cmd shim；直接 spawnSync("npm") 会出现 ENOENT/不可执行等误判。
    // 统一走 cmd.exe /c 来执行，可最大化贴近 PowerShell/CMD 的行为。
    if (process.platform === "win32" && !opts.noCmdShim) {
        const base = path.basename(String(cmd)).toLowerCase();
        const needsShim =
            base === "npm" ||
            base === "npm.cmd" ||
            base === "npx" ||
            base === "npx.cmd" ||
            base === "pm2" ||
            base === "pm2.cmd" ||
            base.endsWith(".cmd") ||
            base.endsWith(".bat");

        if (needsShim) {
            const comspec = process.env.ComSpec || "cmd.exe";
            const r2 = spawnSync(comspec, ["/d", "/s", "/c", cmd, ...args], spawnOpts);
            return normalizeResult(r2);
        }
    }

    const r = spawnSync(cmd, args, spawnOpts);
    return normalizeResult(r);
}

function isENOENT(err) {
    return !!err && (err.code === "ENOENT" || err.errno === -2);
}

function isWSL() {
    return (
        process.platform === "linux" &&
        (!!process.env.WSL_INTEROP || !!process.env.WSL_DISTRO_NAME)
    );
}

function getCmdCandidates(base) {
    // Windows 下很多命令（npm/npx/pm2）其实是 .cmd shim；
    // child_process.spawnSync 不会像交互式终端那样自动解析 .cmd，
    // 所以需要显式尝试 base.cmd。
    if (process.platform !== "win32") return [base];
    return [`${base}.cmd`, `${base}.exe`, base];
}

function tryRunFirst(cmdCandidates, args, opts = {}) {
    let last = null;
    for (const cmd of cmdCandidates) {
        const r = tryRun(cmd, args, opts);
        if (isENOENT(r.error)) continue;
        last = { ...r, cmdUsed: cmd };
        // 对于探测类命令，status==0 即成功
        return last;
    }
    return last;
}

function runNpm(args, opts = {}) {
    const cands = getCmdCandidates("npm");
    const r = tryRunFirst(cands, args, opts);
    if (r) return r;
    return {
        status: 1,
        stdout: "",
        stderr: "spawnSync npm ENOENT",
        error: Object.assign(new Error("spawnSync npm ENOENT"), { code: "ENOENT" }),
        cmdUsed: null,
    };
}

function getGlobalNpmBinDirs() {
    const dirs = [];
    // npm v10+ 已移除 `npm bin -g`，因此这里需要多策略：
    // 1) 优先尝试 `npm bin -g`（旧版）
    // 2) 回退到 `npm prefix -g` 推导全局 bin 目录（新版）
    //
    // 同时，只在 win32 才尝试 npm.cmd，避免在非 Windows 环境误调用到外部的 npm.cmd
    // 导致“安装/查询在另一个环境完成”，当前进程却检测不到 pm2。
    const tries = [
        { args: ["bin", "-g"], kind: "bin" },
        { args: ["prefix", "-g"], kind: "prefix" },
    ];

    for (const t of tries) {
        const r = runNpm(t.args, { timeoutMs: 10000 });
        if (isENOENT(r.error)) continue; // npm 不存在
        if (r.status !== 0) continue;
        const out = (r.stdout || "").trim();
        if (!out) continue;

        if (t.kind === "bin") {
            dirs.push(out);
            continue;
        }

        // prefix: *nix 通常是 <prefix>/bin；Windows 通常就是 prefix 本身（里面有 pm2.cmd 等 shim）
        const prefix = out;
        if (process.platform === "win32") {
            dirs.push(prefix);
        } else {
            dirs.push(path.join(prefix, "bin"));
        }
    }

    // 去重
    return [...new Set(dirs)];
}

function detectPm2CLI() {
    // 1) 优先使用 PATH 中的 pm2
    {
        const cands = getCmdCandidates("pm2");
        const r = tryRunFirst(cands, ["-v"], { timeoutMs: 10000 });
        if (r && !isENOENT(r.error) && r.status === 0) {
            return { kind: "pm2", cmd: r.cmdUsed || "pm2", prefixArgs: [] };
        }
    }

    // 2) PATH 可能未刷新：从 `npm bin -g` 找可执行目录再探测
    const binDirs = getGlobalNpmBinDirs();
    for (const dir of binDirs) {
        const candidates = [path.join(dir, "pm2")];
        if (process.platform === "win32") {
            candidates.unshift(path.join(dir, "pm2.cmd"));
            candidates.unshift(path.join(dir, "pm2.exe"));
        }
        for (const c of candidates) {
            if (!fs.existsSync(c)) continue;
            const rr = tryRun(c, ["-v"], { timeoutMs: 10000 });
            if (rr.status === 0) {
                return { kind: "pm2", cmd: c, prefixArgs: [] };
            }
        }
    }

    // 兜底：PATH 里没找到，npm 全局 bin 里也没找到
    return null;
}

function detectNpx() {
    const cands = getCmdCandidates("npx");
    const r = tryRunFirst(cands, ["-v"], { timeoutMs: 10000 });
    if (!r || isENOENT(r.error) || r.status !== 0) return null;
    return { kind: "npx", cmd: r.cmdUsed || "npx", prefixArgs: ["-y", "pm2"] };
}

function detectAvailability() {
    return { pm2: !!detectPm2CLI(), npx: !!detectNpx() };
}

function installPm2Global() {
    // 自动全局安装 pm2。
    // 只在 win32 才使用 npm.cmd / PowerShell；非 Windows 环境只使用当前的 npm，
    // 避免“安装跑到另一个环境（例如外部的 npm.cmd）”导致安装成功但当前进程仍检测不到。
    const timeoutMs = 20 * 60 * 1000;

    const attempts = [];
    if (process.platform === "win32") {
        attempts.push({ cmd: "npm.cmd", args: ["i", "-g", "pm2"], installedTo: "current" });
        attempts.push({ cmd: "npm", args: ["i", "-g", "pm2"], installedTo: "current" });
        attempts.push({
            cmd: "pwsh.exe",
            args: ["-NoProfile", "-Command", "npm i -g pm2"],
            installedTo: "windows",
        });
        attempts.push({
            cmd: "powershell.exe",
            args: ["-NoProfile", "-Command", "npm i -g pm2"],
            installedTo: "windows",
        });
    } else {
        attempts.push({ cmd: "npm", args: ["i", "-g", "pm2"], installedTo: "current" });
    }

    let last = null;
    for (const a of attempts) {
        const r = tryRun(a.cmd, a.args, { timeoutMs });
        if (isENOENT(r.error)) continue;

        last = { ...r, installedTo: a.installedTo };
        if (r.status === 0) return last;
    }

    if (last) return last;
    return {
        status: 1,
        stdout: "",
        stderr: "未找到可用的 npm/powershell 命令，无法自动全局安装 pm2",
        error: null,
        invoker: "manual",
        installedTo: isWSL() ? "windows" : "current",
    };
}

function runPm2(args, opts = {}) {
    const allowNpx = opts.allowNpx !== false;

    const pm2 = detectPm2CLI();
    if (pm2) {
        const r = tryRun(pm2.cmd, [...pm2.prefixArgs, ...args], opts);
        return { invoker: pm2.kind, ...r };
    }

    if (!allowNpx) {
        const err = new Error("未检测到 pm2（可先安装：npm i -g pm2），或使用 npx 临时运行");
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

function pm2StartWebhook(opts = {}) {
    const allowNpx = opts.allowNpx !== false;
    // 如果已存在，优先 restart，避免重复创建进程
    if (pm2WebhookExists({ allowNpx })) {
        return runPm2(["restart", PM2_APP_NAME, "--update-env"], { allowNpx });
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
        { allowNpx }
    );
}

function pm2StopWebhook(opts = {}) {
    return runPm2(["stop", PM2_APP_NAME], { allowNpx: opts.allowNpx !== false });
}

function pm2RestartWebhook(opts = {}) {
    return runPm2(["restart", PM2_APP_NAME, "--update-env"], { allowNpx: opts.allowNpx !== false });
}

function pm2DeleteWebhook(opts = {}) {
    return runPm2(["delete", PM2_APP_NAME], { allowNpx: opts.allowNpx !== false });
}

function pm2Save(opts = {}) {
    return runPm2(["save"], { allowNpx: opts.allowNpx !== false });
}

function pm2Startup(opts = {}) {
    return runPm2(["startup"], { allowNpx: opts.allowNpx !== false });
}

function pm2Logs(lines = 100, opts = {}) {
    // 优先用 --nostream（不进入持续输出模式），旧版 pm2 可能不支持，失败则回退
    const args = ["logs", PM2_APP_NAME, "--lines", String(lines), "--nostream"];
    const r = runPm2(args, { allowNpx: opts.allowNpx !== false });
    if (r.status === 0) return r;
    return runPm2(["logs", PM2_APP_NAME, "--lines", String(lines)], { allowNpx: opts.allowNpx !== false });
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

function getPm2DebugInfo() {
    const info = {
        platform: process.platform,
        nodeExecPath: process.execPath,
        cwd: process.cwd(),
        availability: null,
        pm2Cli: null,
        npx: null,
        npm: {
            version: null,
            prefix: null,
            root: null,
            errors: [],
        },
        globalBinDirs: [],
    };

    // npm version
    {
        const r = runNpm(["-v"], { timeoutMs: 10000 });
        if (r.status === 0) info.npm.version = (r.stdout || "").trim();
        else info.npm.errors.push({ cmd: (r.cmdUsed || "npm") + " -v", stderr: (r.stderr || "").trim() });
    }

    // npm prefix -g
    {
        const r = runNpm(["prefix", "-g"], { timeoutMs: 10000 });
        if (r.status === 0) info.npm.prefix = (r.stdout || "").trim();
        else info.npm.errors.push({ cmd: (r.cmdUsed || "npm") + " prefix -g", stderr: (r.stderr || "").trim() });
    }

    // npm root -g（辅助判断）
    {
        const r = runNpm(["root", "-g"], { timeoutMs: 10000 });
        if (r.status === 0) info.npm.root = (r.stdout || "").trim();
        else info.npm.errors.push({ cmd: (r.cmdUsed || "npm") + " root -g", stderr: (r.stderr || "").trim() });
    }

    info.globalBinDirs = getGlobalNpmBinDirs();

    // detect
    info.availability = detectAvailability();
    const pm2 = detectPm2CLI();
    if (pm2) info.pm2Cli = pm2;
    const npx = detectNpx();
    if (npx) info.npx = npx;

    return info;
}

module.exports = {
    PM2_APP_NAME,
    WEBHOOK_ENTRY,
    detectAvailability,
    installPm2Global,
    pm2StartWebhook,
    pm2StopWebhook,
    pm2RestartWebhook,
    pm2DeleteWebhook,
    pm2DescribeWebhook,
    pm2Save,
    pm2Startup,
    pm2Logs,
    getWebhookStatus,
    getPm2DebugInfo,
};
