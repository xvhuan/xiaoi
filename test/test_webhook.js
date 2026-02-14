/**
 * Webhook 接口测试脚本
 *
 * 用法: node test/test_webhook.js [命令] [参数]
 *
 * 命令:
 *   status          - 查看服务状态
 *   tts <文字>      - 发送文字到音箱
 *   audio <url>     - 播放音频链接
 *   volume <0-100>  - 设置音量
 *   command <siid> <aiid> [jsonParams] - 发送 MiOT 指令
 *
 * 示例:
 *   node test/test_webhook.js status
 *   node test/test_webhook.js tts "你好，现在请注意"
 *   node test/test_webhook.js volume 30
 *
 * 可选环境变量:
 *   XIAOI_TARGET_DID=客厅小爱  # 指定本次请求目标音箱
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const WEBHOOK_HOST = "localhost";
const WEBHOOK_PORT = 3088;
const LOG_FILE = "test/test_webhook.log";
const TARGET_DID = (process.env.XIAOI_TARGET_DID || "").trim();

function resolveConfigPath() {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const homeConfig = home ? path.join(home, ".xiaoi", "config.json") : "";
    const localConfig = path.join(__dirname, "..", "config.json");

    if (homeConfig && fs.existsSync(homeConfig)) return homeConfig;
    if (fs.existsSync(localConfig)) return localConfig;
    return "";
}

function loadWebhookToken() {
    if (process.env.XIAOI_WEBHOOK_TOKEN) return process.env.XIAOI_WEBHOOK_TOKEN.trim();

    const cfgPath = resolveConfigPath();
    if (!cfgPath) return "";

    try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        const t = cfg && cfg.webhook && typeof cfg.webhook.token === "string" ? cfg.webhook.token.trim() : "";
        return t || "";
    } catch {
        return "";
    }
}

function getBeijingTime() {
    return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function log(msg) {
    const line = `[${getBeijingTime()}] ${msg}\n`;
    console.log(line.trim());
    fs.appendFileSync(LOG_FILE, line, "utf-8");
}

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : "";
        const token = loadWebhookToken();
        const options = {
            hostname: WEBHOOK_HOST,
            port: WEBHOOK_PORT,
            path: path,
            method: method,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData),
            },
        };

        if (token) {
            options.headers["Authorization"] = `Bearer ${token}`;
        }

        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on("error", (err) => {
            reject(err);
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || "status";

    log(`===== 测试开始: ${command} =====`);
    if (TARGET_DID) {
        log(`目标音箱 did: ${TARGET_DID}`);
    }

    try {
        let result;

        switch (command) {
            case "status":
                result = await request("GET", "/", null);
                break;

            case "tts": {
                const text = args.slice(1).join(" ") || "这是一条测试消息";
                const body = TARGET_DID ? { text, did: TARGET_DID } : { text };
                result = await request("POST", "/webhook/tts", body);
                break;
            }

            case "audio": {
                const url = args[1];
                if (!url) {
                    log("❌ 请提供音频 URL");
                    return;
                }
                const body = TARGET_DID ? { url, did: TARGET_DID } : { url };
                result = await request("POST", "/webhook/audio", body);
                break;
            }

            case "volume": {
                const volume = parseInt(args[1]);
                if (isNaN(volume)) {
                    log("❌ 请提供有效的音量数值（0-100）");
                    return;
                }
                const body = TARGET_DID ? { volume, did: TARGET_DID } : { volume };
                result = await request("POST", "/webhook/volume", body);
                break;
            }

            case "command": {
                const siid = Number(args[1]);
                const aiid = Number(args[2]);
                if (!Number.isFinite(siid) || !Number.isFinite(aiid)) {
                    log("❌ 请提供有效的 siid/aiid");
                    return;
                }
                let params = [];
                if (args[3]) {
                    try {
                        const parsed = JSON.parse(args[3]);
                        params = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        log("❌ jsonParams 解析失败，请传 JSON 数组字符串");
                        return;
                    }
                }
                const body = TARGET_DID
                    ? { siid, aiid, params, did: TARGET_DID }
                    : { siid, aiid, params };
                result = await request("POST", "/webhook/command", body);
                break;
            }

            default:
                log(`❌ 未知命令: ${command}`);
                log("可用命令: status, tts, audio, volume, command");
                return;
        }

        log(`响应状态: ${result.status}`);
        log(`响应内容: ${JSON.stringify(result.data, null, 2)}`);
    } catch (err) {
        log(`❌ 请求失败: ${err.message}`);
        log("请确保 Webhook 服务器正在运行 (node main.js)");
    }

    log(`===== 测试结束 =====`);
}

main();
