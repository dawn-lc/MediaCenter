import { randomUUID } from 'node:crypto';

/**
 * 生成 UUID v4 —— Node 内置 crypto.randomUUID（替代 uuid 包，避免额外依赖）
 */
export const uuidv4 = randomUUID;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验字符串是否为合法 UUID 格式（替代 uuid 包的 validate）
 */
export function isUuid(value: string): boolean {
    return UUID_RE.test(value);
}
