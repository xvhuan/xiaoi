#!/usr/bin/env node
/**
 * 小爱音箱语音通知 MCP Server
 *
 * 使用 @modelcontextprotocol/sdk 官方 SDK
 * 通过调用 xiaoi CLI 命令完成操作
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

// ============================================
// 日志
// ============================================
const LOG_DIR = path.join(
    process.env.USERPROFILE || process.env.HOME || __dirname,
    ".xiaoi"
);
const LOG_FILE = path.join(LOG_DIR, "mcp_server.log");

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(msg) {
    const time = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    fs.appendFileSync(LOG_FILE, `[${time}] ${msg}\n`, "utf-8");
}

// ============================================
// xiaoi CLI 调用
// ============================================
const XIAOI_BIN = path.join(__dirname, "bin", "xiaoi.js");

function runXiaoiCLI(args) {
    return new Promise((resolve, reject) => {
        log(`执行: node ${XIAOI_BIN} ${args.join(" ")}`);
        execFile("node", [XIAOI_BIN, ...args], {
            timeout: 30000,
            env: { ...process.env },
        }, (err, stdout, stderr) => {
            if (err) {
                const errMsg = stderr || err.message;
                log(`CLI 错误: ${errMsg}`);
                reject(new Error(errMsg.trim()));
                return;
            }
            const output = stdout.trim();
            log(`CLI 输出: ${output}`);
            resolve(output);
        });
    });
}

function normalizeDid(value) {
    return typeof value === "string" ? value.trim() : "";
}

function withDidArgs(args, did) {
    const targetDid = normalizeDid(did);
    if (!targetDid) return args;
    return [...args, "--did", targetDid];
}

// ============================================
// 创建 MCP Server
// ============================================
const server = new McpServer({
    name: "xiaoi-voice-notify",
    version: "1.0.10",
});

// 工具: notify
server.tool(
    "notify",
    "向小爱音箱发送语音通知。适用于任务完成通知、提醒、警告等场景。音箱会用 TTS 播报传入的文字内容。",
    {
        message: z.string().describe("要播报的通知内容。建议简洁明了，例如：'代码编译完成'、'测试全部通过'"),
        did: z.string().optional().describe("可选，目标音箱 did；不传则使用默认音箱"),
    },
    async ({ message, did }) => {
        const targetDid = normalizeDid(did);
        log(`[notify] message: ${message}, did: ${targetDid || "(default)"}`);
        try {
            const output = await runXiaoiCLI(withDidArgs(["tts", message], targetDid));
            return {
                content: [
                    {
                        type: "text",
                        text: `✅ 语音通知已发送: "${message}"${targetDid ? `（did: ${targetDid}）` : ""}\n${output}`,
                    },
                ],
            };
        } catch (err) {
            return { content: [{ type: "text", text: `❌ 发送失败: ${err.message}` }], isError: true };
        }
    }
);

// 工具: play_audio
server.tool(
    "play_audio",
    "让小爱音箱播放指定的音频链接。",
    {
        url: z.string().describe("音频文件的 URL 地址"),
        did: z.string().optional().describe("可选，目标音箱 did；不传则使用默认音箱"),
    },
    async ({ url, did }) => {
        const targetDid = normalizeDid(did);
        log(`[play_audio] url: ${url}, did: ${targetDid || "(default)"}`);
        try {
            const output = await runXiaoiCLI(withDidArgs(["audio", url], targetDid));
            return {
                content: [
                    {
                        type: "text",
                        text: `✅ 音频已开始播放: ${url}${targetDid ? `（did: ${targetDid}）` : ""}\n${output}`,
                    },
                ],
            };
        } catch (err) {
            return { content: [{ type: "text", text: `❌ 播放失败: ${err.message}` }], isError: true };
        }
    }
);

// 工具: set_volume
server.tool(
    "set_volume",
    "设置小爱音箱的音量。",
    {
        volume: z.number().min(0).max(100).describe("音量值，范围 0-100"),
        did: z.string().optional().describe("可选，目标音箱 did；不传则使用默认音箱"),
    },
    async ({ volume, did }) => {
        const targetDid = normalizeDid(did);
        log(`[set_volume] volume: ${volume}, did: ${targetDid || "(default)"}`);
        try {
            const output = await runXiaoiCLI(
                withDidArgs(["volume", String(volume)], targetDid)
            );
            return {
                content: [
                    {
                        type: "text",
                        text: `✅ 音量已设置为: ${volume}${targetDid ? `（did: ${targetDid}）` : ""}\n${output}`,
                    },
                ],
            };
        } catch (err) {
            return { content: [{ type: "text", text: `❌ 设置失败: ${err.message}` }], isError: true };
        }
    }
);

// 工具: do_action
server.tool(
    "do_action",
    "向小爱音箱发送 MiOT 指令。",
    {
        siid: z.number().describe("MiOT Service ID"),
        aiid: z.number().describe("MiOT Action ID"),
        params: z
            .array(z.any())
            .optional()
            .describe("可选，MiOT 参数数组；不传时默认 []"),
        did: z.string().optional().describe("可选，目标音箱 did；不传则使用默认音箱"),
    },
    async ({ siid, aiid, params, did }) => {
        const targetDid = normalizeDid(did);
        const payload = Array.isArray(params) ? params : [];
        log(
            `[do_action] siid=${siid}, aiid=${aiid}, params=${JSON.stringify(payload)}, did: ${targetDid || "(default)"}`
        );
        try {
            const output = await runXiaoiCLI(
                withDidArgs(
                    [
                        "command",
                        String(siid),
                        String(aiid),
                        JSON.stringify(payload),
                    ],
                    targetDid
                )
            );
            return {
                content: [
                    {
                        type: "text",
                        text: `✅ MiOT 指令已发送: siid=${siid}, aiid=${aiid}${targetDid ? `（did: ${targetDid}）` : ""}\n${output}`,
                    },
                ],
            };
        } catch (err) {
            return {
                content: [{ type: "text", text: `❌ 指令发送失败: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// 工具: get_property
server.tool(
    "get_property",
    "读取小爱音箱 MiOT 属性值。",
    {
        siid: z.number().describe("MiOT Service ID"),
        piid: z.number().describe("MiOT Property ID"),
        did: z.string().optional().describe("可选，目标音箱 did；不传则使用默认音箱"),
    },
    async ({ siid, piid, did }) => {
        const targetDid = normalizeDid(did);
        log(`[get_property] siid=${siid}, piid=${piid}, did: ${targetDid || "(default)"}`);
        try {
            const output = await runXiaoiCLI(
                withDidArgs(["getprop", String(siid), String(piid)], targetDid)
            );
            return {
                content: [
                    {
                        type: "text",
                        text: `✅ 属性读取成功: siid=${siid}, piid=${piid}${targetDid ? `（did: ${targetDid}）` : ""}\n${output}`,
                    },
                ],
            };
        } catch (err) {
            return {
                content: [{ type: "text", text: `❌ 属性读取失败: ${err.message}` }],
                isError: true,
            };
        }
    }
);

// ============================================
// 启动
// ============================================
async function main() {
    log("========================================");
    log("小爱音箱语音通知 MCP Server 启动（SDK 模式）");
    log(`日志路径: ${LOG_FILE}`);
    log(`CLI 路径: ${XIAOI_BIN}`);
    log("========================================");

    const transport = new StdioServerTransport();
    await server.connect(transport);

    log("MCP Server 已连接，等待请求...");
}

main().catch((err) => {
    log(`启动失败: ${err.message}\n${err.stack}`);
    process.exit(1);
});
