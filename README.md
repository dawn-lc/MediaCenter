# MediaCenter

Node.js + Express + React + PostgreSQL 全栈流媒体服务器。

## 快速开始

### 前置条件

- Node.js >= 24
- PostgreSQL >= 16

### 配置

创建 `.env`：

```env
JWT_SECRET=your-random-secret-here
DATABASE_URL=postgres://user:password@localhost:5432/mediacenter
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
UPLOAD_DIR=./uploads
```

所有环境变量：

| 变量             | 说明                                              | 默认     |
| ---------------- | ------------------------------------------------- | -------- |
| `JWT_SECRET`     | JWT 签名密钥                                      | **必填** |
| `DATABASE_URL`   | PostgreSQL 连接字符串                             | **必填** |
| `ADMIN_USERNAME` | 管理员用户名                                      | **必填** |
| `ADMIN_PASSWORD` | 管理员密码                                        | **必填** |
| `UPLOAD_DIR`     | 上传目录                                          | **必填** |
| `PORT`           | HTTP 端口                                         | `3000`   |
| `SSL_CERT`       | SSL 证书路径（与 `SSL_KEY` 同时设置时启用 HTTPS） | 可选     |
| `SSL_KEY`        | SSL 私钥路径                                      | 可选     |
| `SSL_PORT`       | HTTPS 端口                                        | `443`    |
| `API_TOKEN`      | 静态 API 令牌                                     | 可选     |

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

| 命令                 | 说明                     |
| -------------------- | ------------------------ |
| `npm start`          | 编译 + 启动              |
| `npm run dev`        | 开发模式（热重载 + HMR） |
| `npm run build`      | 构建                     |
| `npm run server:dev` | 仅后端开发               |
| `npm run client:dev` | 仅前端开发               |

## 部署

```bash
docker build -t mediacenter .
docker run -d --name mediacenter -p 3000:3000 --env-file .env mediacenter
```

HTTPS 模式（不启动 HTTP）：

```bash
docker run -d --name mediacenter -p 443:443 \
  -v /certs:/certs:ro \
  -e SSL_CERT=/certs/fullchain.pem \
  -e SSL_KEY=/certs/privkey.pem \
  --env-file .env mediacenter
```

## 许可证

[PolyForm Noncommercial 1.0.0](./LICENSE) — 个人/教育免费，商业使用需授权。
