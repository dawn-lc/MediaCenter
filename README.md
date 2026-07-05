# MediaCenter 流媒体服务器

基于 **Node.js + Express + React + Drizzle ORM + PostgreSQL** 的全栈流媒体中心，支持视频/音频流式传输、图片预览、媒体资源管理、标签系统、作者管理、用户认证和角色权限控制。

## 技术栈

### 后端

| 技术                   | 用途          |
| ---------------------- | ------------- |
| **TypeScript**         | 开发语言      |
| **Express**            | HTTP 框架     |
| **Drizzle ORM**        | 数据库 ORM    |
| **PostgreSQL**         | 数据库        |
| **esbuild**            | 后端构建工具  |
| **JWT**                | 身份认证      |
| **Multer**             | 文件上传      |
| **express-rate-limit** | 速率限制      |
| **pg_trgm**            | 全文模糊搜索  |
| **HMAC-SHA256**        | 签名 URL 鉴权 |

### 前端

| 技术                        | 用途          |
| --------------------------- | ------------- |
| **React 19**                | UI 框架       |
| **React Router 7**          | 前端路由      |
| **Zustand**                 | 状态管理      |
| **i18next + react-i18next** | 国际化        |
| **react-markdown**          | Markdown 渲染 |
| **sonner**                  | Toast 通知    |
| **Video.js**                | 视频播放器    |
| **Vite 8**                  | 构建工具      |
| **TypeScript**              | 开发语言      |

## 快速开始

### 前置条件

- **Node.js** >= 24
- **PostgreSQL** >= 16

### 1. 配置环境变量

创建 `.env` 文件（项目根目录）：

```env
# 必需
JWT_SECRET=your-random-secret-here        # openssl rand -hex 32 生成
DATABASE_URL=postgres://user:password@localhost:5432/mediacenter
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password

# 可选
PORT=3000
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=68719476764                  # 默认 64GB
API_TOKEN=                                  # 静态 API 令牌（机器间调用，授予管理员权限）
```

### 2. 安装依赖

```bash
npm install && cd client && npm install && cd ..
```

### 3. 启动

```bash
# 编译并启动（构建 + 运行）
npm run start
```

首次启动时程序会自动：

1. 自动创建数据库（如不存在）
2. 启用 `pg_trgm` 扩展
3. 根据 `schema.ts` 自动同步全部表结构和索引
4. 创建管理员账号（根据 `.env` 配置）

访问 **http://localhost:3000** 即可使用。

## 项目结构

```
├── client/                            # 前端 (React + Vite + TS)
│   ├── src/
│   │   ├── components/                # 通用组件
│   │   │   ├── Modal.tsx              #   模态框
│   │   │   ├── Navbar.tsx             #   导航栏
│   │   │   ├── TagSelector.tsx        #   标签选择器
│   │   │   └── AuthorSelector.tsx     #   作者选择器
│   │   ├── pages/                     # 页面
│   │   │   ├── HomePage.tsx           #   首页（媒体列表）
│   │   │   ├── PlayerPage.tsx         #   播放页
│   │   │   ├── UploadPage.tsx         #   上传页
│   │   │   └── AdminPage.tsx          #   管理后台
│   │   ├── players/                   # 播放器模块
│   │   │   ├── VideoPlayer.tsx        #   视频播放器（Video.js）
│   │   │   ├── AudioPlayer.tsx        #   音频播放器
│   │   │   ├── ImageViewer.tsx        #   图片查看器
│   │   │   ├── PlayerControls.tsx     #   播放控制栏
│   │   │   ├── PlayerInfo.tsx         #   播放器信息
│   │   │   ├── PlayerMeta.tsx         #   元数据展示
│   │   │   ├── MediaActions.tsx       #   媒体操作按钮
│   │   │   └── PlaylistSidebar.tsx    #   播放列表侧栏
│   │   ├── stores/                    # Zustand 状态管理
│   │   │   ├── auth.ts               #   认证状态
│   │   │   └── playlist.ts            #   播放列表状态
│   │   ├── hooks/                     # 自定义 Hooks
│   │   │   └── useStreamToken.ts      #   流媒体令牌自动刷新
│   │   ├── styles/                    # 结构化 CSS（按组件拆分）
│   │   │   ├── base/                  #   variables.css + reset.css
│   │   │   ├── components/            #   各组件样式
│   │   │   ├── responsive.css         #   响应式适配
│   │   │   └── index.css              #   @import 入口
│   │   ├── locales/                   # i18n 翻译
│   │   │   ├── zh-CN.json             #   中文
│   │   │   └── en-US.json             #   英文
│   │   ├── utils/                     # 工具函数
│   │   │   └── utils.ts               #   格式化、类型判断等
│   │   ├── api.ts                     # API 客户端
│   │   ├── types.ts                   # 共享类型定义
│   │   ├── App.tsx                    # 根组件 + 路由
│   │   └── main.tsx                   # 入口
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── src/                               # 后端 (Express + Drizzle + TS)
│   ├── controllers/                   # 控制器
│   │   ├── authController.ts          #   认证
│   │   ├── mediaController.ts         #   媒体 CRUD
│   │   ├── streamController.ts        #   流式播放
│   │   ├── adminController.ts         #   管理后台
│   │   ├── tagsController.ts          #   标签管理
│   │   ├── authorsController.ts       #   作者管理
│   │   └── scanController.ts          #   目录扫描
│   ├── middleware/                    # 中间件
│   │   ├── auth.ts                    #   JWT 验证 + 角色授权
│   │   ├── upload.ts                  #   文件上传（Multer）
│   │   └── rateLimit.ts               #   速率限制（三级限流）
│   ├── routes/                        # 路由
│   │   ├── auth.ts                    #   认证路由
│   │   ├── media.ts                   #   媒体路由
│   │   ├── stream.ts                  #   流媒体路由
│   │   ├── admin.ts                   #   管理路由
│   │   ├── tags.ts                    #   标签路由
│   │   └── authors.ts                 #   作者路由
│   ├── utils/                         # 工具函数
│   │   ├── hash.ts                    #   密码哈希 + 文件哈希
│   │   ├── roles.ts                   #   角色权限工具
│   │   ├── signUrl.ts                 #   HMAC-SHA256 签名 URL
│   │   ├── storage.ts                 #   文件存储操作
│   │   ├── scanner.ts                 #   目录扫描导入
│   │   └── tagParser.ts              #   标签表达式解析（AND/OR/括号分组）
│   ├── db/                            # 数据库
│   │   ├── index.ts                   #   连接池 + 自动迁移
│   │   └── schema.ts                  #   表结构定义（7 张表）
│   ├── config.ts                      # 配置校验
│   └── index.ts                       # 入口
├── drizzle.config.ts                  # Drizzle Kit 配置文件
├── Dockerfile                         # Docker 多阶段构建
├── dist/                              # 构建产物
│   ├── index.js                       # 后端单文件
│   └── public/                        # 前端构建产物
├── uploads/                           # 用户上传文件
├── tsconfig.json
└── package.json
```

## API 文档

### 认证

| 方法 | 路径                 | 说明         | 权限   |
| ---- | -------------------- | ------------ | ------ |
| POST | `/api/auth/register` | 注册         | 开放   |
| POST | `/api/auth/login`    | 登录         | 开放   |
| POST | `/api/auth/refresh`  | 刷新令牌     | 开放   |
| GET  | `/api/auth/profile`  | 当前用户信息 | 需登录 |

### 媒体管理

| 方法   | 路径                          | 说明                                                                    | 权限          |
| ------ | ----------------------------- | ----------------------------------------------------------------------- | ------------- |
| GET    | `/api/media`                  | 媒体列表（支持 `?page=&limit=&type=&search=&tags=&sortBy=&sortOrder=`） | 访客          |
| GET    | `/api/media/:id`              | 媒体详情                                                                | 访客          |
| GET    | `/api/media/:id/stream-token` | 刷新流媒体签名令牌（前端自动定时刷新，访客也可用）                      | 访客          |
| POST   | `/api/media`                  | 上传媒体（新标签/新作者仅限管理员）                                     | 需登录        |
| PUT    | `/api/media/:id`              | 更新元数据（标题/描述/标签/作者/来源/权限）                             | 上传者/管理员 |
| DELETE | `/api/media/:id`              | 删除媒体                                                                | 上传者/管理员 |

### 流媒体

| 方法 | 路径                       | 说明                        | 权限 |
| ---- | -------------------------- | --------------------------- | ---- |
| GET  | `/api/stream/:id`          | 流式播放（支持 HTTP Range） | 访客 |
| GET  | `/api/stream/:id/download` | 下载文件（带签名验证）      | 访客 |
| GET  | `/api/stream/:id/thumb`    | 获取缩略图（带签名验证）    | 访客 |

所有流媒体 URL 使用 **HMAC-SHA256 签名**，默认 **3 分钟**有效期（前端定时自动刷新）。

### 管理后台

| 方法   | 路径                              | 说明             | 权限   |
| ------ | --------------------------------- | ---------------- | ------ |
| GET    | `/api/admin/users`                | 用户列表         | 管理员 |
| PUT    | `/api/admin/users/:id/role`       | 修改用户角色     | 管理员 |
| DELETE | `/api/admin/users/:id`            | 删除用户         | 管理员 |
| POST   | `/api/admin/users/:id/toggle-ban` | 切换用户封禁状态 | 管理员 |
| POST   | `/api/admin/scan`                 | 扫描目录导入媒体 | 管理员 |
| POST   | `/api/admin/reset-db`             | 重置数据库       | 管理员 |

### 标签

| 方法   | 路径            | 说明     | 权限   |
| ------ | --------------- | -------- | ------ |
| GET    | `/api/tags`     | 标签列表 | 访客   |
| POST   | `/api/tags`     | 创建标签 | 管理员 |
| DELETE | `/api/tags/:id` | 删除标签 | 管理员 |

### 作者

| 方法   | 路径               | 说明                     | 权限   |
| ------ | ------------------ | ------------------------ | ------ |
| GET    | `/api/authors`     | 作者列表（含媒体数量）   | 需登录 |
| POST   | `/api/authors`     | 创建作者                 | 管理员 |
| PUT    | `/api/authors/:id` | 更新作者（别名、链接等） | 管理员 |
| DELETE | `/api/authors/:id` | 删除作者                 | 管理员 |

## 权限模型

| 角色    | 等级 | 权限                                                          |
| ------- | ---- | ------------------------------------------------------------- |
| `guest` | 0    | 浏览媒体、流式播放、下载                                      |
| `user`  | 1    | 继承访客权限 + 上传媒体、编辑/删除自己的媒体                  |
| `admin` | 2    | 全部权限 + 用户管理、角色修改、封禁用户、目录扫描、数据库重置 |

权限在 **SQL 层过滤**，非管理员用户无法越权访问。用户被封禁（`banned`）后无法进行任何操作。

## 标签系统

- 支持 **AND（`&`）** 和 **OR（`|`）** 表达式语法
- 支持**括号分组**：`(动作 & 科幻) | (喜剧 & 国产)`
- 标签点击自动跳转到首页筛选
- 搜索结果中匹配的标签自动高亮（7 色分组）
- 非管理员上传媒体时不能创建新标签（只能关联已有标签）

## 作者系统

- 每个媒体可关联一个作者
- 作者支持**别名**（`altNames`）和 **外部链接**（`urls`）
- 作者列表按媒体数量排序，便于发现活跃作者
- 仅管理员可创建/编辑/删除作者

## 脚本命令

| 命令                   | 说明                                              |
| ---------------------- | ------------------------------------------------- |
| `npm start`            | 编译 + 启动（构建后端和前端，然后运行）           |
| `npm run dev`          | 开发模式：并行启动后端(tsx watch)和前端(Vite HMR) |
| `npm run build`        | 构建：esbuild 打包后端 + Vite 构建前端 → dist/    |
| `npm run server:dev`   | 仅启动后端开发模式（tsx watch）                   |
| `npm run server:build` | 仅构建后端                                        |
| `npm run client:dev`   | 仅启动前端开发服务器（Vite HMR）                  |
| `npm run client:build` | 仅构建前端（Vite）                                |

## 流媒体特性

- 支持 **HTTP Range 请求**，实现视频拖拽播放、快进快退
- 自动识别 Content-Type，适配浏览器原生播放器
- 支持视频（mp4/webm/mkv/mov 等）、音频（mp3/flac/wav 等）、图片（jpg/png/webp/gif）
- 流媒体 URL 使用 **HMAC-SHA256 签名**，绑定媒体 ID、用途和过期时间
- **签名仅校验新请求**，已建立的 HTTP 流连接不受签名过期影响，可持续播放
- 视频拖拽（seek）时自动获取新签名并保持播放进度
- 支持**缩略图**签名访问（`/api/stream/:id/thumb`）

## 限流策略

| 限流器          | 限制        | 适用范围                         |
| --------------- | ----------- | -------------------------------- |
| `apiLimiter`    | 120 次/分钟 | 认证、媒体、标签、作者等通用 API |
| `strictLimiter` | 20 次/分钟  | 管理后台接口                     |
| `streamLimiter` | 300 次/分钟 | 流媒体播放（视频分段请求较多）   |

管理员自动跳过所有限流。

## 签名 URL 安全机制

- 所有流媒体、下载、缩略图 URL 均使用 **HMAC-SHA256** 签名
- 签名绑定 `mediaId + 过期时间 + 用途 + 用户ID`
- 默认 **3 分钟**有效期
- **访客用户也可刷新签名**：`GET /api/media/:id/stream-token` 仅需 `authenticate` 中间件，无需登录，访客同样能获取新签名
- **签名仅用于新 HTTP 请求的鉴权**：一旦流连接建立，数据传输不依赖签名有效性，即使签名过期，已建立的 HTTP 流仍能继续传输数据，播放不中断
- 需要新发起请求的场景（如拖拽 seek、页面刷新）会自动获取新签名并保持播放进度
- 即使 URL 被截获，也只在有限时间内有效
- 不会在 URL 中暴露 JWT Token，适合 `<video>`/`<audio>` 原生标签使用

## 文件去重

系统通过 **fileHash**（SHA-256）对上传文件进行去重。当检测到相同哈希的文件已存在时，会跳过上传并返回已有媒体记录，避免存储浪费。

## Docker 部署

项目根目录提供 `Dockerfile`，支持多阶段构建：

```bash
# 构建镜像
docker build -t mediacenter .

# 运行容器
docker run -d \
  --name mediacenter \
  -p 3000:3000 \
  -e JWT_SECRET=your-secret \
  -e DATABASE_URL=postgres://user:password@host:5432/mediacenter \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=your-password \
  -v /path/to/uploads:/app/uploads \
  mediacenter
```

## 开发

```bash
# 一键开发（后端热重载 + 前端 HMR）
npm run dev

# 单独开发
npm run server:dev     # 后端
npm run client:dev     # 前端
```
