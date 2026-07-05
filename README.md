# MediaCenter 流媒体服务器

基于 **Node.js + Express + React + Drizzle ORM + PostgreSQL** 的全栈流媒体中心，支持视频/音频流式传输、图片预览、媒体资源管理、标签系统、作者管理、用户认证和角色权限控制。

## 许可证

本软件采用 **PolyForm Noncommercial License 1.0.0** 发布。

- **非商业使用**（个人学习、研究、娱乐、教育机构等）—— 完全免费
- **商业使用**（SaaS 服务、企业内部系统、付费分发等）—— 需获得商业授权

详见 [LICENSE](./LICENSE) 和 [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)。

## 快速开始

### 前置条件

- **Node.js** >= 24
- **PostgreSQL** >= 16

### 1. 配置环境变量

创建 `.env` 文件：

```env
JWT_SECRET=your-random-secret-here
DATABASE_URL=postgres://user:password@localhost:5432/mediacenter
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
```

### 2. 安装依赖

```bash
npm install && cd client && npm install && cd ..
```

### 3. 启动

```bash
npm run start
```

访问 **http://localhost:3000**

## 开发

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
