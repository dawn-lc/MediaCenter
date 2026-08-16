# MediaCenter

Node.js + Express + React + PostgreSQL 全栈流媒体服务器。

支持视频 / 音频 / 图片的在线播放、服务器目录扫描导入、标签与作者体系、全文 + 语义向量混合检索与多级权限控制；

## 特性

- **流媒体播放**：视频 / 音频 / 图片在线播放与下载（Range 流、签名 URL、ffprobe 元数据提取）
- **目录扫描**：扫描服务器指定目录自动导入媒体
- **检索**：全文（pg_trgm）+ 语义向量（OpenAI 兼容嵌入）+ 标签 / 作者表达式混合检索（RRF 融合）
- **权限体系**：访客 / 用户 / 管理员 / 仅自己 四级可见性 + 静态 API 令牌
- **管理面板**：标签、作者、用户管理；目录扫描；数据库重置
- **PWA**：响应式布局、离线可用、Service Worker 缓存缩略图
- **主题**：深色 / 浅色 / 跟随系统，右下角悬浮切换，偏好本地缓存

## 快速开始

### 前置条件

- Node.js >= 24
- PostgreSQL >= 16（需 `pg_trgm` 扩展）
- ffmpeg（Docker 镜像已内置；本地运行需自行安装）

### 配置

创建 `.env`：

```env
JWT_SECRET=your-random-secret-here
DATABASE_URL=postgres://user:password@localhost:5432/mediacenter
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
UPLOAD_DIR=./uploads
```

### 环境变量

**必填**

| 变量             | 说明                  |
| ---------------- | --------------------- |
| `JWT_SECRET`     | JWT 签名密钥          |
| `DATABASE_URL`   | PostgreSQL 连接字符串 |
| `ADMIN_USERNAME` | 管理员用户名          |
| `ADMIN_PASSWORD` | 管理员密码            |
| `UPLOAD_DIR`     | 上传 / 扫描目录       |

**可选**

| 变量                        | 说明                                                    | 默认                   |
| --------------------------- | ------------------------------------------------------- | ---------------------- |
| `PORT`                      | 监听端口                                                | `3000`                 |
| `SSL_CERT` / `SSL_KEY`      | SSL 证书 / 私钥路径（同时设置时启用 HTTPS）             | 无                     |
| `API_TOKEN`                 | 静态 API 令牌（不设置则禁用）                           | 无                     |
| `DB_POOL_SIZE`              | 数据库连接池上限                                        | `16`                   |
| `MAX_FILE_SIZE`             | 单文件上传上限（字节）                                  | `34359738368`（32 GB） |
| `ALLOW_REGISTRATION`        | 是否开放自助注册                                        | `false`                |
| `MIN_PASSWORD_LENGTH`       | 注册密码最小长度                                        | `8`                    |
| `EMBEDDING_BASE_URL`        | 语义搜索：OpenAI 兼容嵌入服务地址（配置后启用向量检索） | 无                     |
| `EMBEDDING_MODEL`           | 嵌入模型名                                              | `qwen3-embedding:0.6b` |
| `EMBEDDING_DIM`             | 嵌入输出维度（模型输出更高时按 MRL 截断）               | `1024`                 |
| `EMBEDDING_API_KEY`         | 嵌入服务 API Key（如需要鉴权）                          | 无                     |
| `SEMANTIC_MIN_RELEVANCE`    | 语义搜索动态阈值下限                                    | `0.3`                  |
| `SEMANTIC_SIGMA_MULTIPLIER` | 语义搜索动态阈值 σ 倍数                                 | `2.5`                  |
| `RRF_K`                     | RRF 混合检索常数                                        | `60`                   |

> 语义检索兼容任意 OpenAI 兼容服务：Ollama、OpenAI、vLLM、LM Studio 等。未配置 `EMBEDDING_BASE_URL` 时相关性排序回退 pg_trgm 实现。

### 启动

```bash
npm install && cd client && npm install && cd ..
npm run build
npm start
```

访问 `http://localhost:3000`

### 开发

```bash
npm run dev
```

## 命令

| 命令                   | 说明                     |
| ---------------------- | ------------------------ |
| `npm start`            | 编译 + 启动              |
| `npm run dev`          | 开发模式（热重载 + HMR） |
| `npm run build`        | 构建（server + client）  |
| `npm run server:build` | 仅构建后端（esbuild）    |
| `npm run client:build` | 仅构建前端（Vite）       |
| `npm run server:dev`   | 仅后端开发               |
| `npm run client:dev`   | 仅前端开发               |

## 部署

### Docker

```bash
docker build -t mediacenter .
docker run -d --name mediacenter -p 3000:3000 --env-file .env mediacenter
```

### Docker Compose

```yaml
services:
    mediacenter:
        image: mediacenter:latest
        restart: unless-stopped
        ports:
            - '3000:3000'
        env_file: .env
        volumes:
            - ./uploads:/app/uploads
```

HTTPS 模式（`SSL_CERT` / `SSL_KEY` 指向容器内证书路径）：

```bash
docker run -d --name mediacenter -p 443:443 \
  -v /certs:/certs:ro \
  -e PORT=443 \
  -e SSL_CERT=/certs/fullchain.pem \
  -e SSL_KEY=/certs/privkey.pem \
  --env-file .env mediacenter
```

## 许可证

[PolyForm Noncommercial 1.0.0](./LICENSE) — 个人/教育免费，商业使用需授权。
