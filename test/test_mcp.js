/**
 * MCP Server 测试脚本
 *
 * 模拟 MCP 客户端，向 MCP Server 发送请求并验证响应
 * 用法: node test/test_mcp.js
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOG_FILE = "test/test_mcp.log";

function getBeijingTime() {
    return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function log(msg) {
    const line = `[${getBeijingTime()}] ${msg}\n`;
    console.log(line.trim());
    fs.appendFileSync(LOG_FILE, line, "utf-8");
}

// 发送 MCP 消息（Content-Length 格式）
function sendMessage(proc, message) {
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    proc.stdin.write(header + json);
    log(`>>> 发送: ${json}`);
}

// ============================================
// 用 Buffer 按字节处理响应（解决中文多字节问题）
// ============================================
let rawBuffer = Buffer.alloc(0);

function processRawBuffer() {
    const responses = [];

    while (true) {
        // 查找 \r\n\r\n 分隔符
        const separator = Buffer.from("\r\n\r\n");
        let headerEndIdx = -1;
        for (let i = 0; i <= rawBuffer.length - 4; i++) {
            if (
                rawBuffer[i] === 0x0d &&
                rawBuffer[i + 1] === 0x0a &&
                rawBuffer[i + 2] === 0x0d &&
                rawBuffer[i + 3] === 0x0a
            ) {
                headerEndIdx = i;
                break;
            }
        }

        if (headerEndIdx === -1) break;

        const headerStr = rawBuffer.subarray(0, headerEndIdx).toString("utf-8");
        const match = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
            // 跳过无效头
            rawBuffer = rawBuffer.subarray(headerEndIdx + 4);
            continue;
        }

        const contentLength = parseInt(match[1], 10);
        const contentStart = headerEndIdx + 4;

        // 内容是否完整
        if (rawBuffer.length < contentStart + contentLength) break;

        const contentBuf = rawBuffer.subarray(
            contentStart,
            contentStart + contentLength
        );
        rawBuffer = rawBuffer.subarray(contentStart + contentLength);

        try {
            const json = contentBuf.toString("utf-8");
            responses.push(JSON.parse(json));
        } catch (e) {
            log(`解析失败: ${e.message}`);
        }
    }

    return responses;
}

async function main() {
    log("===== MCP Server 测试开始 =====");

    const mcpServer = spawn("node", [
        path.resolve(__dirname, "../mcp_server.js"),
    ]);

    let allResponses = [];

    // 以 Buffer 模式接收数据，不设置 encoding
    mcpServer.stdout.on("data", (chunk) => {
        rawBuffer = Buffer.concat([rawBuffer, chunk]);
        const responses = processRawBuffer();
        for (const resp of responses) {
            log(`<<< 收到: ${JSON.stringify(resp, null, 2)}`);
            allResponses.push(resp);
        }
    });

    mcpServer.stderr.on("data", (data) => {
        log(`[stderr] ${data}`);
    });

    // 等待服务器启动
    await new Promise((r) => setTimeout(r, 500));

    // 1. 初始化
    log("\n--- 步骤1: 初始化 ---");
    sendMessage(mcpServer, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
        },
    });
    await new Promise((r) => setTimeout(r, 500));

    // 发送 initialized 通知
    sendMessage(mcpServer, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
    });
    await new Promise((r) => setTimeout(r, 300));

    // 2. 列出工具
    log("\n--- 步骤2: 列出工具 ---");
    sendMessage(mcpServer, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
    });
    await new Promise((r) => setTimeout(r, 1000));

    // 3. 发送通知（通过 CLI 调用）
    log("\n--- 步骤3: 发送语音通知 ---");
    sendMessage(mcpServer, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
            name: "notify",
            arguments: {
                message: "MCP测试通知，语音通知功能正常工作",
            },
        },
    });
    await new Promise((r) => setTimeout(r, 10000));

    // 结束
    log("\n--- 测试完成 ---");
    log(`共收到 ${allResponses.length} 个响应`);

    for (let i = 0; i < allResponses.length; i++) {
        const r = allResponses[i];
        log(`  响应${i + 1} (id=${r.id}): ${r.error ? "❌ 错误" : "✅ 成功"}`);
    }

    mcpServer.stdin.end();
    mcpServer.kill();

    log("===== MCP Server 测试结束 =====");
    process.exit(0);
}

main().catch((err) => {
    log(`测试异常: ${err.message}`);
    process.exit(1);
});
