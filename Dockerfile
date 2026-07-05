# ============================================================
# Stage 1: Build
# ============================================================
FROM node:24-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json ./
RUN npm ci
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

# 复制源码并构建
COPY . .
RUN npm run build

# ============================================================
# Stage 2: Production
# ============================================================
FROM node:24-alpine AS runner

WORKDIR /app

# 安装生产依赖
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 复制构建产物（直接将 dist/ 内容展开到 /app）
COPY --from=builder /app/dist/ ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
