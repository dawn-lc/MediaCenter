import { createHash, scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { createReadStream } from 'fs';

/**
 * 计算文件的 SHA256 哈希值
 * @param filePath - 文件绝对路径
 * @returns 小写十六进制哈希字符串
 */
export function computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);

        stream.on('data', (chunk: Buffer) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

/** scrypt 参数（与 OWASP 推荐一致） */
const SCRYPTOPTIONS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

/**
 * 密码哈希 — 返回 `salt:hash` 格式的字符串（均为 base64）
 */
export function hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, KEY_LENGTH, SCRYPTOPTIONS);
    return `${salt.toString('base64')}:${hash.toString('base64')}`;
}

/**
 * 验证密码 — 兼容 `salt:hash`（scrypt）格式
 */
export function verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split(':');
    if (parts.length !== 2) return false;
    const salt = Buffer.from(parts[0], 'base64');
    const hash = Buffer.from(parts[1], 'base64');
    const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPTOPTIONS);
    if (hash.length !== derived.length) return false;
    return timingSafeEqual(hash, derived);
}
