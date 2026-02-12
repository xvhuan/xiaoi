# ============================================
# xiaoi - 小爱音箱语音通知 Webhook Docker 镜像
# ============================================
FROM node:18-alpine

# 安装 pm2 全局
RUN npm install -g pm2

# 创建工作目录
WORKDIR /app

# 先复制 package 文件，利用 Docker 缓存层加速重建
COPY package.json ./

# 安装依赖（生产模式）
RUN npm install --omit=dev

# 复制项目源码
COPY bin/ ./bin/
COPY lib/ ./lib/
COPY mcp_server.js ./
COPY config.example.json ./

# 创建日志目录和用户配置目录
RUN mkdir -p /root/.xiaoi/log

# 复制入口脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 暴露 Webhook 默认端口
EXPOSE 51666

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:51666/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
