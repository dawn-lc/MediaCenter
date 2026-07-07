import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import https from 'https';
import { readFileSync, watchFile } from 'fs';
import { createPrivateKey, createPublicKey, X509Certificate, type KeyObject } from 'crypto';
import cors from 'cors';
import { join, resolve } from 'path';
import config from './config';
import { initDatabase, ensureDefaultUsers, closeDatabase } from './db/index';
import { ensureUploadDir } from './utils/storage';
import { authenticate, resolveStreamUser } from './middleware/auth';
import { apiLimiter, strictLimiter, streamLimiter, authLimiter } from './middleware/rateLimit';
import { prune, isObject } from './utils/env';

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

// 请求日志（注册在最前面，记录所有请求）
// 在下一个事件循环写入，完全不阻塞请求处理
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.on('finish', () => console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${(performance.now() - start).toFixed(2)}ms`));
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

// SPA fallback：非 API / 非静态文件 / 非 SW → 返回 index.html
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next();
    // 有扩展名的静态文件直接跳过（由前面的 express.static 处理）
    if (/\.[\w-]+$/.test(req.path)) return next();
    res.sendFile(join(publicDir, 'index.html'));
});

// API 路由（此后的中间件和路由仅处理 API 请求）
// 全局认证（让限流等前置中间件能识别用户角色）
app.use('/api', authenticate);
// 全链路 UTF-8：确保所有 API 响应都带 charset=utf-8
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    next();
});

import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import streamRoutes from './routes/stream';
import adminRoutes from './routes/admin';
import tagsRoutes from './routes/tags';
import authorsRoutes from './routes/authors';
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/media', apiLimiter, mediaRoutes);
app.use('/api/stream', resolveStreamUser, streamLimiter, streamRoutes);
app.use('/api/admin', strictLimiter, adminRoutes);
app.use('/api/tags', apiLimiter, tagsRoutes);
app.use('/api/authors', apiLimiter, authorsRoutes);

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
    app.set('maintenance', false);
    console.log('[Server] 数据库就绪，服务已开通');
}

if (config.sslEnabled) {
    // ── HTTPS 模式（仅监听 HTTPS，不启动 HTTP） ──
    console.log('[SSL] 证书:', config.sslCert);
    console.log('[SSL] 私钥:', config.sslKey);

    /** 读取并校验证书文件，失败时退出进程（仅在启动时调用） */
    function loadSSLCredentials(): { cert: Buffer; key: Buffer } {
        try {
            const certPath = config.sslCert!;
            const keyPath = config.sslKey!;
            console.log('[SSL] 正在读取证书...');
            const cert = readFileSync(certPath);
            console.log('[SSL] 正在读取私钥...');
            const key = readFileSync(keyPath);
            console.log('[SSL] 证书/私钥读取成功');

            // 提取证书链中的第一张叶子证书
            const certChain = cert.toString('utf-8');
            const firstCertPem = certChain.match(
                /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/
            )?.[0];
            if (!firstCertPem) {
                console.error('[Fatal] 证书文件中未找到有效的 PEM 证书');
                process.exit(1);
            }

            // 验证私钥
            let privateKey: KeyObject;
            try {
                privateKey = createPrivateKey(key);
            } catch {
                console.error('[Fatal] 私钥格式无效，请确认是 PEM 格式且未设置 passphrase');
                process.exit(1);
            }

            // 验证证书与私钥是否匹配（比较公钥指纹）
            try {
                const x509 = new X509Certificate(firstCertPem);
                const certPub = x509.publicKey.export({ type: 'spki', format: 'pem' });
                const keyPub = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
                if (certPub !== keyPub) {
                    console.error('[Fatal] 证书与私钥不匹配，请检查文件是否正确对应');
                    process.exit(1);
                }
                console.log(`[SSL] 证书验证通过: ${x509.subject} (${x509.validTo})`);
            } catch (err) {
                console.error('[Fatal] 证书验证失败:', (err as Error).message);
                process.exit(1);
            }
            return { cert, key };
        } catch (err) {
            console.error('[Fatal] 读取 SSL 证书失败:', (err as Error).message);
            process.exit(1);
        }
    }

    const httpsServer = https.createServer(loadSSLCredentials(), app);
    startServer(httpsServer, config.sslPort, 'https');
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
    startServer(server, config.port, 'http');
    activeServers.push(server);
    server.once('listening', onServerReady);
}
