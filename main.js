const { MiGPT } = require("@mi-gpt/next");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ============================================
// 加载配置
// ============================================
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"), "utf-8")
);
const WEBHOOK_PORT = config.webhook.port;
const LOG_FILE = config.webhook.logFile;

// 确保日志目录存在
const logDir = path.dirname(LOG_FILE);
if (logDir && !fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ============================================
// 日志工具
// ============================================
function getBeijingTime() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function log(message) {
  const timeStr = getBeijingTime();
  const logLine = `[${timeStr}] ${message}\n`;
  console.log(logLine.trim());
  fs.appendFileSync(LOG_FILE, logLine, "utf-8");
}

// ============================================
// Webhook 服务器
// ============================================
let engineReady = false;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data, null, 2));
}

async function handleWebhook(req, res) {
  const url = new URL(req.url, `http://localhost:${WEBHOOK_PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS 支持
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ========== GET / — 状态检查 ==========
  if (method === "GET" && pathname === "/") {
    return sendJSON(res, 200, {
      status: "running",
      engine_ready: engineReady,
      time: getBeijingTime(),
      endpoints: {
        "POST /webhook/tts": "发送文字到音箱播报（body: { text: '要说的话' }）",
        "POST /webhook/audio":
          "播放音频链接（body: { url: 'https://example.com/audio.mp3' }）",
        "POST /webhook/volume": "设置音量（body: { volume: 50 }，范围 0-100）",
        "POST /webhook/command":
          "执行 MioT 指令（body: { siid: 3, aiid: 1, params: [] }）",
      },
    });
  }

  // 以下为 POST 请求处理
  if (method !== "POST") {
    return sendJSON(res, 405, { error: "仅支持 GET 和 POST 请求" });
  }

  if (!engineReady) {
    return sendJSON(res, 503, {
      error: "MiGPT 引擎尚未就绪，请稍后重试",
    });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }

  try {
    switch (pathname) {
      // ========== 发送文字 TTS ==========
      case "/webhook/tts": {
        const { text } = body;
        if (!text) {
          return sendJSON(res, 400, { error: "缺少 text 字段" });
        }
        log(`[TTS] 发送文字: ${text}`);
        const result = await MiGPT.speaker.play({ text });
        return sendJSON(res, 200, {
          success: true,
          action: "tts",
          text,
          result,
        });
      }

      // ========== 播放音频 ==========
      case "/webhook/audio": {
        const { url: audioUrl } = body;
        if (!audioUrl) {
          return sendJSON(res, 400, { error: "缺少 url 字段" });
        }
        log(`[Audio] 播放音频: ${audioUrl}`);
        const result = await MiGPT.speaker.play({ url: audioUrl });
        return sendJSON(res, 200, {
          success: true,
          action: "audio",
          url: audioUrl,
          result,
        });
      }

      // ========== 设置音量 ==========
      case "/webhook/volume": {
        const { volume } = body;
        if (volume === undefined || volume < 0 || volume > 100) {
          return sendJSON(res, 400, {
            error: "volume 字段必须为 0-100 的整数",
          });
        }
        log(`[Volume] 设置音量: ${volume}`);
        const result = await MiGPT.MiNA.setVolume(volume);
        return sendJSON(res, 200, {
          success: true,
          action: "volume",
          volume,
          result,
        });
      }

      // ========== 执行 MioT 指令 ==========
      case "/webhook/command": {
        const { siid, aiid, params } = body;
        if (!siid || !aiid) {
          return sendJSON(res, 400, { error: "缺少 siid 或 aiid 字段" });
        }
        log(
          `[Command] 执行指令: siid=${siid}, aiid=${aiid}, params=${JSON.stringify(params)}`
        );
        const result = await MiGPT.MiOT.doAction(siid, aiid, params);
        return sendJSON(res, 200, {
          success: true,
          action: "command",
          siid,
          aiid,
          params,
          result,
        });
      }

      default:
        return sendJSON(res, 404, { error: `未知路径: ${pathname}` });
    }
  } catch (err) {
    log(`[Error] ${pathname} - ${err.message}`);
    return sendJSON(res, 500, { error: err.message });
  }
}

function startWebhookServer() {
  const server = http.createServer(handleWebhook);
  server.listen(WEBHOOK_PORT, () => {
    log(`✅ Webhook 服务器已启动，监听端口: ${WEBHOOK_PORT}`);
    log(`📡 状态页: http://localhost:${WEBHOOK_PORT}/`);
    log(`📡 TTS 接口: POST http://localhost:${WEBHOOK_PORT}/webhook/tts`);
    log(`📡 音频接口: POST http://localhost:${WEBHOOK_PORT}/webhook/audio`);
    log(`📡 音量接口: POST http://localhost:${WEBHOOK_PORT}/webhook/volume`);
    log(`📡 指令接口: POST http://localhost:${WEBHOOK_PORT}/webhook/command`);
  });
  return server;
}

// ============================================
// 主函数
// ============================================
async function main() {
  // 先启动 Webhook 服务器
  const server = startWebhookServer();

  // 切换 cwd 到 ~/.xiaoi/，确保 @mi-gpt/miot 的 .mi.json 写入固定位置
  const miCacheDir = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), ".xiaoi");
  if (!fs.existsSync(miCacheDir)) {
    fs.mkdirSync(miCacheDir, { recursive: true });
  }
  process.chdir(miCacheDir);

  // 启动 MiGPT（后台运行，不阻塞）
  MiGPT.start({
    speaker: config.speaker,
    async onMessage(engine, { text }) {
      console.log(text);
    },
  }).catch((err) => {
    log(`❌ MiGPT 运行异常: ${err.message}`);
  });

  // 轮询检测引擎是否就绪（检测 speaker 是否初始化完成）
  const readyCheck = setInterval(() => {
    try {
      if (MiGPT.speaker && MiGPT.speaker.play) {
        engineReady = true;
        log("🤖 MiGPT 引擎已就绪，Webhook 全部功能已激活");
        clearInterval(readyCheck);
      }
    } catch (e) {
      // 尚未初始化，继续等待
    }
  }, 1000);
}

main();