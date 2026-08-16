import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import config from '../config';
import { hasPermission } from '../utils/roles';
import { isUuid } from '../utils/uuid';
import { verifySignedUrl } from '../utils/signUrl';
import { isString } from '../utils/env';
import { apiUserId } from '../db';

// 扩展 Express Request 类型
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string | null;
                username: string;
                role: string;
            };
        }
    }
}

/**
 * 从令牌字符串解析用户身份（JWT 或静态 API 令牌），非法令牌返回 null
 * 供 authenticate（Authorization header）与 SSE 连接（token 走 query）复用
 */
export function resolveUserFromToken(token: string | null | undefined): Express.Request['user'] | null {
    if (!token) return null;

    // 静态 API 令牌（机器间调用）：映射到启动时创建的专属 'api' 服务账户（role=admin）
    if (config.apiToken && token === config.apiToken) {
        return { id: apiUserId, username: 'api', role: 'admin' };
    }

    try {
        const payload = jwt.verify(token, config.jwtSecret);
        if (typeof payload !== 'object' || !payload) return null;
        const data = payload as Record<string, unknown>;
        if (!isString(data.id) || !isString(data.username) || !isString(data.role)) return null;
        return {
            id: data.id,
            username: data.username,
            role: data.role
        };
    } catch {
        return null;
    }
}

/**
 * 验证 JWT 令牌或静态 API 令牌的中间件
 * 将用户信息附加到 req.user，无令牌时视为访客
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
    let token: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }

    if (!token) {
        req.user = { id: null, username: 'guest', role: 'guest' };
        next();
        return;
    }

    const user = resolveUserFromToken(token);
    if (!user) {
        res.status(401).json({ error: 'auth.tokenInvalid' });
        return;
    }
    req.user = user;
    next();
}

/**
 * 强制要求登录的中间件
 * 接受 JWT 登录用户（有 id）或 API 令牌（映射到 api 服务账户，role=admin）
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (!req.user || (!req.user.id && req.user.role !== 'admin')) {
        res.status(401).json({ error: 'auth.loginRequired' });
        return;
    }
    next();
}

/**
 * 权限检查中间件工厂
 * @param minLevel - 所需最低权限等级
 */
export function requirePermission(minLevel: number) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const userRole = req.user ? req.user.role : 'guest';
        if (!hasPermission(userRole, minLevel)) {
            res.status(403).json({ error: 'error.permissionDenied' });
            return;
        }
        next();
    };
}

/** 管理员权限中间件 */
export const requireAdmin = requirePermission(config.roles.admin);

/** 用户权限中间件 */
export const requireUser = requirePermission(config.roles.user);

/**
 * 从签名 URL 中解析用户身份并设置 req.user
 * 先验签名，再查 uid，防止伪造身份
 * 用于流媒体请求（<video> 标签无法携带 Authorization header）
 */
export async function resolveStreamUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    // 路由参数尚未填充，用 URL 类安全解析路径
    const id = new URL(req.url, `${req.protocol}://${req.hostname}`).pathname.split('/').filter(Boolean)[0];
    if (!id || !isUuid(id)) {
        res.status(404).json({ error: 'media.notFound' });
        return;
    }
    const q = req.query;
    const expires = isString(q.expires) ? q.expires : undefined;
    const purpose = isString(q.purpose) ? q.purpose : undefined;
    const sig = isString(q.sig) ? q.sig : undefined;
    const uid = isString(q.uid) ? q.uid : undefined;
    const role = isString(q.role) ? q.role : undefined;
    const result = verifySignedUrl(id, { expires, purpose, sig, uid, role });

    if (!result.valid) {
        // 缺少签名参数 → 回退到已认证身份（authenticate 已设置 req.user，不要覆盖）
        if (result.error === 'signUrl.missingParams') {
            // 若 authenticate 在此之前未设置用户（如未带 token），则设为访客
            if (!req.user) {
                req.user = { id: null, username: 'guest', role: 'guest' };
            }
            next();
            return;
        }
        // 签名参数存在但不合法 → 拒绝
        res.status(403).json({ error: result.error || 'signUrl.invalid' });
        return;
    }

    if (!result.userId) {
        req.user = { id: null, username: 'guest', role: 'guest' };
        next();
        return;
    }

    // 签名已验证，uid+role 不可伪造，直接信任身份；username 对流媒体不重要
    req.user = { id: result.userId, username: 'stream', role: result.userRole || 'guest' };
    next();
}
