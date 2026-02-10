#!/usr/bin/env node

/**
 * 发布前检查脚本
 * 确保不会把敏感配置发布到 npm
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

console.log("🔍 发布前检查...\n");

let hasError = false;

// 1. 检查 config.json 不在 files 白名单中
const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")
);

if (pkg.files && pkg.files.includes("config.json")) {
    console.error("❌ config.json 不应出现在 package.json 的 files 中！");
    hasError = true;
} else {
    console.log("✅ config.json 未在 files 白名单中");
}

// 2. 检查必要文件存在
const requiredFiles = [
    "bin/xiaoi.js",
    "lib/speaker.js",
    "lib/tui.js",
    "lib/webhook_server.js",
    "lib/pm2.js",
    "lib/config.js",
    "lib/version_check.js",
    "mcp_server.js",
    "config.example.json",
    "README.md",
];

for (const file of requiredFiles) {
    if (fs.existsSync(path.join(ROOT, file))) {
        console.log(`✅ ${file}`);
    } else {
        console.error(`❌ 缺少文件: ${file}`);
        hasError = true;
    }
}

// 3. 检查 bin 文件有 shebang
const binFiles = ["bin/xiaoi.js", "mcp_server.js"];
for (const file of binFiles) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf-8");
    if (content.startsWith("#!/usr/bin/env node")) {
        console.log(`✅ ${file} shebang 正确`);
    } else {
        console.error(`❌ ${file} 缺少 shebang (#!/usr/bin/env node)`);
        hasError = true;
    }
}

// 4. 打印发布信息
console.log(`\n📦 包名: ${pkg.name}`);
console.log(`📌 版本: ${pkg.version}`);
console.log(`📄 文件: ${pkg.files.join(", ")}`);

if (hasError) {
    console.error("\n❌ 检查未通过，请修复后重试");
    process.exit(1);
} else {
    console.log("\n✅ 全部检查通过，可以发布！");
}
