#!/bin/sh
set -e

CONFIG_DIR="/root/.xiaoi"
CONFIG_FILE="$CONFIG_DIR/config.json"

# ============================================
# 1. 确保目录存在
# ============================================
mkdir -p "$CONFIG_DIR/log"

# ============================================
# 2. 从环境变量自动生成/更新配置文件
#    支持的环境变量：
#      XIAOI_USER_ID     - 小米 ID（必填）
#      XIAOI_PASSWORD    - 小米密码（不推荐）
#      XIAOI_PASS_TOKEN  - passToken（推荐）
#      XIAOI_DID         - 设备名称（必填）
#      XIAOI_TTS_MODE    - TTS 模式: auto/command/default
#      XIAOI_VERBOSE_LOG - 详细日志: true/false
#      XIAOI_PORT        - Webhook 端口（默认 51666）
#      XIAOI_TOKEN       - Webhook 鉴权 Token
# ============================================
node -e "
const fs = require('fs');
const crypto = require('crypto');
const cfgPath = '$CONFIG_FILE';

// 尝试读取已有配置
let cfg = {};
try {
  if (fs.existsSync(cfgPath)) {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  }
} catch (e) {}

// 确保结构
if (!cfg.speaker) cfg.speaker = {};
if (!cfg.webhook) cfg.webhook = {};
if (!cfg.mcp) cfg.mcp = {};

// ---- speaker 配置 ----
const env = process.env;

// 环境变量优先覆盖（非空时才覆盖）
if (env.XIAOI_USER_ID)    cfg.speaker.userId    = env.XIAOI_USER_ID;
if (env.XIAOI_PASSWORD)   cfg.speaker.password  = env.XIAOI_PASSWORD;
if (env.XIAOI_PASS_TOKEN) cfg.speaker.passToken = env.XIAOI_PASS_TOKEN;
if (env.XIAOI_DID)        cfg.speaker.did       = env.XIAOI_DID;
if (env.XIAOI_TTS_MODE)   cfg.speaker.ttsMode   = env.XIAOI_TTS_MODE;

if (env.XIAOI_VERBOSE_LOG !== undefined) {
  cfg.speaker.verboseLog = (env.XIAOI_VERBOSE_LOG === 'true' || env.XIAOI_VERBOSE_LOG === '1');
}

// 默认 ttsFallbackCommand
if (!cfg.speaker.ttsFallbackCommand) {
  cfg.speaker.ttsFallbackCommand = [5, 1];
}

// 默认 ttsFallbackCommands 映射
if (!cfg.speaker.ttsFallbackCommands) {
  cfg.speaker.ttsFallbackCommands = {
    oh2p:[7,3], oh2:[5,3], lx06:[5,1], s12:[5,1], l15a:[7,3],
    lx5a:[5,1], lx05:[5,1], x10a:[7,3], l17a:[7,3], l06a:[5,1],
    lx01:[5,1], l05b:[5,3], l05c:[5,3], l09a:[3,1], lx04:[5,1],
    asx4b:[5,3], x6a:[7,3], x08e:[7,3], x8f:[7,3]
  };
}

// ---- webhook 配置 ----
cfg.webhook.host = '0.0.0.0';  // 容器内必须监听所有网卡
cfg.webhook.port = parseInt(env.XIAOI_PORT || cfg.webhook.port || '51666', 10);
cfg.webhook.logFile = '$CONFIG_DIR/log/webhook.log';

if (env.XIAOI_TOKEN) {
  cfg.webhook.token = env.XIAOI_TOKEN;
} else if (!cfg.webhook.token) {
  // 没有 token 时自动生成一个
  cfg.webhook.token = crypto.randomBytes(32).toString('hex');
  console.log('[XIAOI-DOCKER] 自动生成 Webhook Token（首次启动）');
}

// ---- mcp 配置 ----
cfg.mcp.logFile = '$CONFIG_DIR/log/mcp_server.log';

// 写回配置
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 4), 'utf-8');

// ---- 启动前校验 ----
const missing = [];
if (!cfg.speaker.userId) missing.push('XIAOI_USER_ID (小米ID)');
if (!cfg.speaker.passToken && !cfg.speaker.password) missing.push('XIAOI_PASS_TOKEN 或 XIAOI_PASSWORD');
if (!cfg.speaker.did) missing.push('XIAOI_DID (设备名称)');

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║          XIAOI Webhook - Docker 启动         ║');
console.log('╠══════════════════════════════════════════════╣');
console.log('║  配置文件: ' + cfgPath.padEnd(34) + '║');
console.log('║  监听端口: ' + String(cfg.webhook.port).padEnd(34) + '║');
console.log('║  TTS 模式: ' + (cfg.speaker.ttsMode || 'auto').padEnd(34) + '║');
console.log('║  Webhook Token: ' + (cfg.webhook.token ? cfg.webhook.token.substring(0, 8) + '...' : '无').padEnd(28) + '║');
console.log('╚══════════════════════════════════════════════╝');

if (missing.length > 0) {
  console.log('');
  console.log('⚠️  以下必填配置缺失，服务可能无法正常工作：');
  missing.forEach(m => console.log('   ❌ ' + m));
  console.log('');
  console.log('💡 请通过环境变量设置，例如：');
  console.log('   docker run -e XIAOI_USER_ID=你的小米ID \\\\');
  console.log('              -e XIAOI_PASS_TOKEN=你的passToken \\\\');
  console.log('              -e XIAOI_DID=你的音箱名称 ...');
  console.log('');
} else {
  console.log('');
  console.log('✅ 配置完整，正在启动 Webhook 服务...');
  console.log('');
}
"

# ============================================
# 3. 使用 pm2-runtime 启动 Webhook（前台模式）
#    pm2-runtime 会保持进程前台运行，防止容器退出
# ============================================
INTERNAL_PORT=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));console.log(c.webhook&&c.webhook.port||51666)}catch(e){console.log(51666)}")

exec pm2-runtime start /app/lib/webhook_server.js \
  --name xiaoi-webhook \
  --max-memory-restart 200M \
  -- "$@"
