/**
 * 限流中间件（基于 express-rate-limit）
 * 对 API 请求进行频率限制，防止滥用
 */
import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/** 管理员跳过限流 */
function skipIfAdmin(req: Request): boolean {
    return req.user?.role === 'admin';
}

/**
 * 通用 API 限流：每分钟最多 120 次请求
 */
export const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    skip: skipIfAdmin,
    message: { error: 'error.rateLimit' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * 严格限流：每分钟最多 20 次（用于管理接口）
 */
export const strictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    skip: skipIfAdmin,
    message: { error: 'error.rateLimitStrict' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * 流媒体限流：每分钟最多 300 次（视频分段请求较多）
 */
export const streamLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    skip: skipIfAdmin,
    message: { error: 'error.rateLimitStream' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * 认证限流：每分钟最多 10 次（登录/注册接口，防止暴力破解）
 */
export const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'error.rateLimit' },
    standardHeaders: true,
    legacyHeaders: false
});
