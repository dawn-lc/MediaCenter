import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import config from '../config';

/**
 * 确保上传目录存在
 */
export function ensureUploadDir(): void {
    if (!existsSync(config.uploadDir)) {
        mkdirSync(config.uploadDir, { recursive: true });
    }
}

/**
 * 获取文件的完整存储路径
 */
export function getStoragePath(subPath = ''): string {
    return join(config.uploadDir, subPath);
}

/**
 * 删除文件
 */
export function deleteFile(filePath: string): void {
    try {
        if (existsSync(filePath)) {
            unlinkSync(filePath);
        }
    } catch (err) {
        console.error('[Storage] 删除文件失败: %s, err: %s', filePath, err instanceof Error ? err.message : String(err));
    }
}

type MediaCategory = 'video' | 'audio' | 'image' | 'other';

/**
 * 获取文件的 MIME 类型分类
 */
export function getMediaCategory(mimeType: string): MediaCategory {
    if (config.supportedMimeTypes.video.includes(mimeType)) return 'video';
    if (config.supportedMimeTypes.audio.includes(mimeType)) return 'audio';
    if (config.supportedMimeTypes.image.includes(mimeType)) return 'image';
    return 'other';
}

/**
 * 检查 MIME 类型是否受支持
 */
export function isSupportedMimeType(mimeType: string): boolean {
    return getMediaCategory(mimeType) !== 'other';
}
