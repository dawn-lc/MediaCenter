/**
 * 签名 URL 工具
 * 生成带 HMAC 签名的临时访问链接，用于 <video>/<audio>/<img> 原生标签
 *
 * 签名 URL 格式：
 *   /api/stream/{mediaId}?expires={timestamp}&purpose={purpose}&sig={hmac}
 *
 * 工作原理：
 * 1. 后端在返回媒体信息时，生成临时签名 URL 返回给前端
 * 2. 前端将签名 URL 直接用于原生媒体标签
 * 3. 后端收到请求后验证签名和有效期，通过则允许访问
 *
 * 安全性：
 * - 签名使用 HMAC-SHA256，密钥不暴露给客户端
 * - URL 有过期时间（默认 3 分钟）
 * - 签名绑定了 mediaId、用途（stream/download）和过期时间
 * - 即使 URL 被截获，也只在有限时间内有效
 * - 不会在 URL 中暴露 JWT token
 */

import crypto from 'crypto';
import config from '../config';

/** 与 JWT 密钥独立的签名密钥（通过哈希派生，避免密钥复用风险） */
const SIGNING_KEY = crypto
    .createHash('sha256')
    .update('url-signing:' + config.jwtSecret)
    .digest();

export type SignedUrlPurpose = 'stream' | 'download' | 'thumb';

/**
 * 生成签名 URL
 * @param mediaId - 媒体 ID
 * @param purpose - 用途：'stream' | 'download' | 'thumb'
 * @param options.expiresIn - 可选，过期秒数，默认 3 分钟
 * @returns 完整的签名 URL 路径
 */
export function generateSignedUrl(mediaId: string, purpose: SignedUrlPurpose, userId: string | null, options?: { expiresIn?: number; role?: string }): string {
    const expiresIn = options?.expiresIn ?? config.defaultExpiresSeconds;
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const uid = userId || '';
    const role = options?.role || '';
    const sig = createSignature(mediaId, expires, purpose, uid, role);

    const url = new URL('/api/stream/' + mediaId, 'http://localhost');
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('uid', uid);
    url.searchParams.set('purpose', purpose);
    url.searchParams.set('role', role);
    url.searchParams.set('sig', sig);

    // 根据用途拼路径
    switch (purpose) {
        case 'download':
            url.pathname += '/download';
            break;
        case 'thumb':
            url.pathname += '/thumb';
            break;
    }

    return url.pathname + url.search;
}

/**
 * 验证签名 URL 是否有效
 * @param mediaId - 媒体 ID（来自路由参数）
 * @param query - 请求查询参数
 * @returns 验证结果，valid 为 true 时表示通过
 */
export function verifySignedUrl(mediaId: string, query: { expires?: string; purpose?: string; sig?: string; uid?: string; role?: string }): { valid: boolean; error?: string; userId?: string; userRole?: string } {
    const { expires, purpose, sig, uid, role } = query;

    if (!expires || !purpose || !sig || uid === undefined || role === undefined) {
        return { valid: false, error: 'signUrl.missingParams' };
    }

    const expiresNum = parseInt(expires, 10);
    const expectedSig = createSignature(mediaId, isNaN(expiresNum) ? 0 : expiresNum, purpose, uid || '', role);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
        return { valid: false, error: 'signUrl.invalid' };
    }

    // 检查过期时间
    if (isNaN(expiresNum)) {
        return { valid: false, error: 'signUrl.invalidExpiry' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > expiresNum) {
        return { valid: false, error: 'signUrl.expired' };
    }

    // 验证用途
    if (purpose !== 'stream' && purpose !== 'download' && purpose !== 'thumb') {
        return { valid: false, error: 'signUrl.invalidPurpose' };
    }

    return { valid: true, userId: uid || undefined, userRole: role || undefined };
}

/**
 * 创建 HMAC-SHA256 签名（绑定 uid + role）
 */
function createSignature(mediaId: string, expires: number, purpose: string, uid: string, role: string): string {
    const payload = `${mediaId}:${expires}:${purpose}:${uid}:${role}`;
    return crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest('hex');
}
