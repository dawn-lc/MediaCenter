import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import http from 'http';
import https from 'https';
import { readFileSync, watchFile } from 'fs';
import cors from 'cors';
import { join, resolve } from 'path';
import config from './config';
import { initDatabase, ensureDefaultUsers, ensureApiUser, closeDatabase } from './db/index';
import { ensureUploadDir } from './utils/storage';
import { authenticate, resolveStreamUser, resolveUserFromToken } from './middleware/auth';
import { apiLimiter, strictLimiter, streamLimiter, authLimiter } from './middleware/rateLimit';
import { serverEvents, PUSH_EVENTS, canSeeMedia, type MediaEventPayload } from './utils/serverEvents';
import { prune, isObject, isString } from './utils/env';

/** MulterError 的简化类型 */
interface MulterErrorLike extends Error {
    code: string;
}

function isMulterError(err: Error): err is MulterErrorLike {
    return err.name === 'MulterError' && 'code' in err;
}

// 未捕获的异步错误直接退出（防止静默吞错）
process.on('unhandledRejection', (reason) => {
    console.error('[Fatal] 未捕获的 Promise 拒绝:', reason);
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    console.error('[Fatal] 未捕获的异常:', err);
    process.exit(1);
});

const app = express();

/** 日志中需脱敏的敏感查询参数（JWT token / 签名 sig 等） */
const SENSITIVE_LOG_PARAMS = new Set(['token', 'sig']);
/** 对请求 URL 脱敏：隐藏敏感查询参数值，避免 JWT/签名落入日志 */
function sanitizeLogUrl(originalUrl: string): string {
    try {
        const u = new URL(originalUrl, 'http://localhost');
        let changed = false;
        for (const key of SENSITIVE_LOG_PARAMS) {
            if (u.searchParams.has(key)) {
                u.searchParams.set(key, '[REDACTED]');
                changed = true;
            }
        }
        return changed ? u.pathname + u.search : originalUrl;
    } catch {
        return originalUrl;
    }
}

// 请求日志（注册在最前面，记录所有请求）
// 在下一个事件循环写入，完全不阻塞请求处理
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.on('finish', () => console.log(`[${new Date().toISOString()}] ${req.method} ${sanitizeLogUrl(req.originalUrl)} ${res.statusCode} ${(performance.now() - start).toFixed(2)}ms`));
    next();
});

// 维护模式标记（数据库就绪前阻断所有请求）
app.set('maintenance', true);
app.use((_req: Request, res: Response, next: NextFunction) => {
    if (app.get('maintenance')) {
        res.status(503).json({ error: 'error.maintenance' });
        return;
    }
    next();
});

// 安全响应头 + CSP（仅对后端产出的响应生效；dev 页面由 Vite 提供，不受此影响）
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],                       // 生产构建无内联脚本（含 SW 注册，均为外部文件）
                styleSrc: ["'self'", "'unsafe-inline'"],     // React 内联样式（进度条/虚拟滚动/竖屏宽度等）
                imgSrc: ["'self'", 'data:', 'blob:', 'https:'], // 同源缩略图 + 前端生成 blob + 描述内 data 图 + 外部图床
                mediaSrc: ["'self'", 'blob:'],               // 视频/音频（video.js 可能用 blob/MSE）
                connectSrc: ["'self'"],                      // API / SSE 同源；dev HMR 走 Vite 不受影响
                fontSrc: ["'self'", 'data:'],
                workerSrc: ["'self'"],                       // Service Worker（离线 + 缩略图缓存）
                frameAncestors: ["'none'"],                  // 禁止被 iframe 嵌入（点击劫持防护）
                reportUri: '/api/csp-report'                 // 违规上报（只记录不阻断）
            }
        },
        // 自托管：关闭 HSTS，避免因访问方式（IP/不同域名）变化导致浏览器强制 HTTPS 锁定
        strictTransportSecurity: false
    })
);

// 中间件
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 自动 prune JSON 请求体（去除 null/undefined/空值，避免下游重复校验）
app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.is('json') && isObject(req.body)) {
        req.body = prune(req.body);
    }
    next();
});

// 自动 prune 所有 JSON 响应（res.json() 始终输出 JSON，天然对位）
app.use((_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
        return originalJson(prune(body));
    } as typeof res.json;
    next();
});

// SPA 静态文件服务
const publicDir = resolve(process.cwd(), 'public');

// 1. 带 hash 的构建资源 → 强缓存（immutable）
app.use(
    '/assets',
    express.static(join(publicDir, 'assets'), {
        maxAge: '1y',
        immutable: true
    })
);
// 2. 其他静态文件（favicon, index.html, manifest, sw 等）
app.use(
    express.static(publicDir, {
        setHeaders(res, filePath) {
            const name = filePath.toLowerCase();
            // HTML：禁止缓存
            if (name.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                return;
            }
            // Service Worker：禁止缓存，必须设置正确的作用域
            if (name.endsWith('sw.js')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Service-Worker-Allowed', '/');
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                return;
            }
            // manifest.webmanifest：较短的缓存时间
            if (name.endsWith('.webmanifest')) {
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
                return;
            }
        }
    })
);

// 客户端 Service Worker 内部缩略图缓存路由（/thumb?id=xxx）
// 正常由 SW 的 CacheFirst 拦截响应，不应到达后端；
// 缓存未命中时快速 404，不消耗页面限流、不 fallback 到 index.html
app.use('/thumb', (_req: Request, res: Response) => {
    res.status(404).end();
});

// SPA fallback：非 API / 非静态文件 / 非 SW → 返回 index.html
// 先对非 API 页面请求限流，避免高并发触发 sendFile 造成 I/O 压力
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next();
    return strictLimiter(req, res, next);
});
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next();
    // 有扩展名的静态文件直接跳过（由前面的 express.static 处理）
    if (/\.[\w-]+$/.test(req.path)) return next();
    res.sendFile(join(publicDir, 'index.html'));
});

// CSP 违规上报端点（浏览器上报，无需认证；仅记录不阻断）
app.post('/api/csp-report', (req: Request, res: Response) => {
    try {
        const report = (req.body as Record<string, unknown>)?.['csp-report'] ?? req.body;
        console.warn('[CSP] 违规上报:', JSON.stringify(report).slice(0, 500));
    } catch { /* ignore */ }
    res.status(204).end();
});

// API 路由（此后的中间件和路由仅处理 API 请求）
// 全局认证（让限流等前置中间件能识别用户角色）
app.use('/api', authenticate);
// 全链路 UTF-8：确保所有 API 响应都带 charset=utf-8
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    next();
});

// ===== SSE 存活 + 推送通道（GET /api/events）=====
// 客户端 EventSource 长连接：15s 心跳注释帧判定存活；媒体变更等业务事件实时推送。
// 挂在 /api 认证之后 → 登录用户可连，访客也可连（仅收心跳/公开事件）。
// 不挂具体路由限流（长连接非请求型），但加并发连接上限防资源耗尽。
// 推送按连接用户过滤：仅推送给能看到该媒体且非触发者的用户，避免广播全量。
interface SseConnection {
    res: Response;
    user: { id: string | null; username: string; role: string };
}

const sseConnections = new Set<SseConnection>();
const SSE_MAX_CONNECTIONS = 200;
app.get('/api/events', (req: Request, res: Response) => {
    if (sseConnections.size >= SSE_MAX_CONNECTIONS) {
        res.status(429).json({ error: 'error.tooManyConnections' });
        return;
    }
    // 解析连接用户：优先 query token（EventSource 无法携带 Authorization header，
    // authenticate 会把无 header 的连接标记为 guest），其次回退 req.user
    const queryToken = isString(req.query.token) ? req.query.token : null;
    const user = resolveUserFromToken(queryToken) ?? req.user ?? { id: null, username: 'guest', role: 'guest' };
    const conn: SseConnection = { res, user };
    sseConnections.add(conn);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 15s 心跳注释帧：客户端据"收到任何字节"判断连接存活
    const heartbeat = setInterval(() => {
        try {
            res.write(': ping\n\n');
        } catch { /* 连接已断，由 close 事件清理 */ }
    }, 15_000);

    // 订阅推送事件（按连接用户过滤：仅推送可见且非自身触发的变更）
    const fns = PUSH_EVENTS.map((event) => {
        const fn = (payload: unknown) => {
            if (!shouldPushToUser(conn.user, event, payload)) return;
            try {
                res.write(`event: ${event}\ndata: ${JSON.stringify(payload ?? null)}\n\n`);
            } catch { /* ignore */ }
        };
        serverEvents.on(event, fn);
        return [event, fn] as const;
    });

    req.on('close', () => {
        clearInterval(heartbeat);
        for (const [event, fn] of fns) serverEvents.off(event, fn);
        sseConnections.delete(conn);
    });
});

/**
 * 判断某事件是否与该用户相关：
 * - 自身触发的变更不推回（触发者 UI 已反映该变更）
 * - 携带可见性信息的变更仅推送给能看到它的用户
 * - 无可见性信息的事件广播
 */
function shouldPushToUser(user: { id: string | null; username: string; role: string }, event: string, payload: unknown): boolean {
    if (event !== 'media.updated') return true;
    const p = payload as MediaEventPayload | undefined;
    if (!p) return true;
    // 自身触发的变更不推回
    if (p.actorId && user.id && p.actorId === user.id) return false;
    // 具体媒体变更：按可见性过滤
    if (p.visibility) return canSeeMedia(user, p.visibility);
    return true;
}

import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import streamRoutes from './routes/stream';
import adminRoutes from './routes/admin';
import tagsRoutes from './routes/tags';
import authorsRoutes from './routes/authors';
import usersRoutes from './routes/users';
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/media', apiLimiter, mediaRoutes);
app.use('/api/stream', resolveStreamUser, streamLimiter, streamRoutes);
app.use('/api/admin', strictLimiter, adminRoutes);
app.use('/api/tags', apiLimiter, tagsRoutes);
app.use('/api/authors', apiLimiter, authorsRoutes);
app.use('/api/users', apiLimiter, usersRoutes);

// 404 处理
app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'error.notFound' });
});

// 全局错误处理
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('[Error]', err);

    if (isMulterError(err)) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: 'error.fileTooLarge' });
            return;
        }
        res.status(400).json({ error: 'error.uploadError' });
        return;
    }

    // Multer 在过滤文件类型时抛出的错误
    if (err.message && err.message.startsWith('不支持的媒体类型')) {
        res.status(415).json({ error: err.message });
        return;
    }

    res.status(500).json({ error: 'error.internal' });
});

// 优雅关闭
/** 所有活跃的服务器实例，供优雅关闭使用 */
const activeServers: (http.Server | https.Server)[] = [];

async function gracefulShutdown(signal: string) {
    console.log(`\n[Server] 收到 ${signal}，正在关闭...`);
    await Promise.allSettled(activeServers.map(s => new Promise<void>((resolve, reject) => {
        s.close((err) => (err ? reject(err) : resolve()));
    })));
    await closeDatabase();
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── 启动服务器 ──

/** 创建服务器实例并绑定到端口 */
function startServer(
    server: http.Server | https.Server,
    port: number,
    protocol: string,
): void {
    server.listen(port, () => {
        console.log(`[Server] 监听于 ${protocol}://0.0.0.0:${port}`);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[Fatal] 端口 ${port} 已被占用`);
        } else {
            console.error('[Fatal] 服务器启动失败:', err.message);
        }
        process.exit(1);
    });
}

/** 初始化回调（数据库、上传目录等） */
async function onServerReady() {
    console.log('[Server] 正在初始化数据库...');
    ensureUploadDir();
    await initDatabase();
    await ensureDefaultUsers();
    if (config.apiToken) {
        // 静态 API 令牌启用时创建专属服务账户（映射到真实用户 id）
        await ensureApiUser();
    }
    app.set('maintenance', false);
    console.log('[Server] 数据库就绪，服务已开通');
}

if (config.sslEnabled) {
    // ── HTTPS 模式（仅监听 HTTPS，不启动 HTTP） ──
    console.log('[SSL] 证书:', config.sslCert);
    console.log('[SSL] 私钥:', config.sslKey);

    /** 读取证书文件，失败时退出进程 */
    function loadSSLCredentials(): { cert: Buffer; key: Buffer } {
        try {
            console.log('[SSL] 正在读取证书...');
            const cert = readFileSync(config.sslCert!);
            console.log('[SSL] 正在读取私钥...');
            const key = readFileSync(config.sslKey!);
            console.log('[SSL] 证书/私钥读取成功');
            return { cert, key };
        } catch (err) {
            console.error('[Fatal] 读取 SSL 证书失败:', (err as Error).message);
            process.exit(1);
        }
    }

    const httpsServer = https.createServer(loadSSLCredentials(), app);
    // 语义精排请求可能长达 20+ 分钟, 放宽 Node 默认请求超时(默认 5 分钟会断连)
    httpsServer.requestTimeout = 2 * 60 * 60 * 1000; // 2 小时
    httpsServer.headersTimeout = 60 * 1000; // 请求头仍按 60s
    httpsServer.keepAliveTimeout = 65 * 1000;
    startServer(httpsServer, config.port, 'https');
    activeServers.push(httpsServer);

    // 监听证书文件变化，热重载 TLS 上下文
    for (const file of [config.sslCert!, config.sslKey!]) {
        watchFile(file, { interval: 86_400_000 }, (curr, prev) => {
            if (curr.mtime <= prev.mtime) return;
            console.log(`[SSL] 检测到文件变更: ${file}`);
            try {
                httpsServer.setSecureContext({
                    cert: readFileSync(config.sslCert!),
                    key: readFileSync(config.sslKey!),
                });
                console.log(`[SSL] 证书已热重载 (${file})`);
            } catch (err) {
                console.error(`[SSL] 证书热重载失败，保留旧证书:`, (err as Error).message);
            }
        });
    }
    console.log('[SSL] 证书热更新已启用（每日轮检一次）');

    httpsServer.once('listening', onServerReady);
} else {
    // ── HTTP 模式 ──
    console.log('[Server] 未配置 SSL 证书，以 HTTP 模式运行');
    const server = http.createServer(app);
    // 语义精排请求可能长达 20+ 分钟, 放宽 Node 默认请求超时(默认 5 分钟会断连)
    server.requestTimeout = 2 * 60 * 60 * 1000; // 2 小时
    server.headersTimeout = 60 * 1000; // 请求头仍按 60s
    server.keepAliveTimeout = 65 * 1000;
    startServer(server, config.port, 'http');
    activeServers.push(server);
    server.once('listening', onServerReady);
}
