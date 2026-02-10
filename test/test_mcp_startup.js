/**
 * MCP Server 启动速度测试
 * 验证 initialize + tools/list 能否在 10 秒内完成
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const LOG_FILE = path.join(__dirname, "test_mcp_startup.log");

function log(msg) {
    const line = `[${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}] ${msg}\n`;
    console.log(line.trim());
    fs.appendFileSync(LOG_FILE, line, "utf-8");
}

function sendMessage(proc, message) {
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    proc.stdin.write(header + json);
}

let rawBuffer = Buffer.alloc(0);

function processBuffer() {
    const responses = [];
    while (true) {
        let headerEndIdx = -1;
        for (let i = 0; i <= rawBuffer.length - 4; i++) {
            if (rawBuffer[i] === 0x0d && rawBuffer[i + 1] === 0x0a &&
                rawBuffer[i + 2] === 0x0d && rawBuffer[i + 3] === 0x0a) {
                headerEndIdx = i;
                break;
            }
        }
        if (headerEndIdx === -1) break;

        const headerStr = rawBuffer.subarray(0, headerEndIdx).toString("utf-8");
        const match = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
            rawBuffer = rawBuffer.subarray(headerEndIdx + 4);
            continue;
        }

        const contentLength = parseInt(match[1], 10);
        const contentStart = headerEndIdx + 4;
        if (rawBuffer.length < contentStart + contentLength) break;

        const contentBuf = rawBuffer.subarray(contentStart, contentStart + contentLength);
        rawBuffer = rawBuffer.subarray(contentStart + contentLength);

        try {
            responses.push(JSON.parse(contentBuf.toString("utf-8")));
        } catch (e) {
            log(`解析失败: ${e.message}`);
        }
    }
    return responses;
}

async function main() {
    const startTime = Date.now();
    log("===== MCP 启动速度测试 =====");

    const mcpServer = spawn("node", [
        path.resolve(__dirname, "../mcp_server.js"),
    ]);

    let responses = [];

    mcpServer.stdout.on("data", (chunk) => {
        rawBuffer = Buffer.concat([rawBuffer, chunk]);
        const parsed = processBuffer();
        for (const r of parsed) {
            const elapsed = Date.now() - startTime;
            log(`[${elapsed}ms] 收到响应 id=${r.id}: ${JSON.stringify(r).substring(0, 150)}`);
            responses.push(r);
        }
    });

    mcpServer.stderr.on("data", (data) => {
        log(`[stderr] ${data}`);
    });

    // 等 200ms 让进程启动
    await new Promise((r) => setTimeout(r, 200));

    // 1. initialize
    log(">>> 发送 initialize...");
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

    // 2. initialized 通知
    sendMessage(mcpServer, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
    });

    await new Promise((r) => setTimeout(r, 200));

    // 3. tools/list
    log(">>> 发送 tools/list...");
    sendMessage(mcpServer, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
    });

    await new Promise((r) => setTimeout(r, 500));

    // 结果
    const totalTime = Date.now() - startTime;
    log(`\n===== 测试完成 =====`);
    log(`总耗时: ${totalTime}ms`);
    log(`收到 ${responses.length} 个响应`);

    if (responses.length >= 2 && totalTime < 10000) {
        log("✅ 启动速度正常，10 秒内完成握手");
    } else if (responses.length < 2) {
        log("❌ 未收到足够响应，MCP Server 可能有问题");
    } else {
        log("⚠️ 启动太慢，超过 10 秒");
    }

    mcpServer.stdin.end();
    mcpServer.kill();
    process.exit(0);
}

main().catch((err) => {
    log(`测试异常: ${err.message}`);
    process.exit(1);
});
