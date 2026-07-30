# ============================================================
# Stage 1: Server Builder — 编译服务器 TypeScript 代码
# ============================================================
FROM node:24-alpine AS server-builder

WORKDIR /app

# 利用 BuildKit 缓存挂载加速 npm 依赖安装
# --mount=type=cache 将 /root/.npm 持久化在宿主机，后续构建直接复用已下载的包
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# 编译服务器代码（esbuild --packages=external → 单一 bundle 输出到 dist/index.js）
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run server:build

# ============================================================
# Stage 2: Client Builder — 构建 React 前端（Vite）
# ============================================================
FROM node:24-alpine AS client-builder

WORKDIR /app/client

# 安装客户端依赖
COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# 构建客户端（outDir: ../dist/public/ → 输出到 /app/dist/public/）
COPY client/ ./
RUN npm run build

# ============================================================
# Stage 3: Production Runtime
# ============================================================
FROM node:24-alpine AS runner

WORKDIR /app

# 安装运行时依赖（ffmpeg 用于提取媒体元数据）
RUN apk add --no-cache ffmpeg

# 安装生产依赖
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && npm cache clean --force

# 分别从各 Builder 复制产物，避免引入任何构建时文件
COPY --from=server-builder /app/dist/index.js ./index.js
COPY --from=client-builder /app/dist/public ./public

EXPOSE 3000

CMD ["node", "index.js"]
