import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import config from '../config';

const execFileAsync = promisify(execFile);

/** 缩略图存储目录（<UPLOAD_DIR>/<config.thumbSubdir>） */
export function getThumbDir(): string {
    const dir = join(config.uploadDir, config.thumbSubdir);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/** 媒体缩略图文件路径（WebP 格式，与前端客户端生成的缩略图一致） */
export function getThumbPath(mediaId: string): string {
    return join(getThumbDir(), `${mediaId}.webp`);
}

/**
 * 用 ffmpeg 从视频提取一帧生成缩略图（幂等：已存在直接返回）
 * @param videoPath      视频文件绝对路径
 * @param mediaId        媒体 id（决定缩略图文件名）
 * @param durationSeconds 视频时长（秒），用于选择提帧位置；未知则取第 1 秒
 * @returns 缩略图文件绝对路径；失败返回 null
 */
export async function ensureVideoThumbnail(
    videoPath: string,
    mediaId: string,
    durationSeconds: number | null,
): Promise<string | null> {
    const outPath = getThumbPath(mediaId);
    if (existsSync(outPath)) return outPath;

    // 提帧时间：取视频 10% 处（夹在 1s ~ 10s），避开片头黑屏/片尾
    let seek = 1;
    if (durationSeconds && durationSeconds > 0) {
        seek = Math.max(1, Math.min(durationSeconds * 0.1, 10));
    }

    try {
        await execFileAsync(
            'ffmpeg',
            [
                '-y',
                '-ss', String(seek), // 快速 seek（在 -i 之前）
                '-i', videoPath,
                '-frames:v', '1',
                '-vf', `scale=${config.thumbWidth}:-2`,
                '-c:v', 'libwebp',
                '-quality', '85',
                outPath,
            ],
            { timeout: config.thumbTimeoutMs },
        );
        return existsSync(outPath) ? outPath : null;
    } catch (err) {
        console.error(
            `[Thumbnail] ffmpeg 生成失败 media=${mediaId}:`,
            err instanceof Error ? err.message : err,
        );
        return null;
    }
}

/**
 * 用 ffmpeg 提取音频内嵌封面作为缩略图（幂等：已存在直接返回）
 * 音频文件无内嵌封面（无视频流）时 ffmpeg 失败 → 返回 null，调用方回退占位
 * @returns 缩略图文件绝对路径；无封面或失败返回 null
 */
export async function ensureAudioThumbnail(
    audioPath: string,
    mediaId: string,
): Promise<string | null> {
    const outPath = getThumbPath(mediaId);
    if (existsSync(outPath)) return outPath;

    try {
        await execFileAsync(
            'ffmpeg',
            [
                '-y',
                '-i', audioPath,
                '-map', '0:v:0', // 提取第一个视频流（音频内嵌封面通常是 attachment/video 流）
                '-frames:v', '1',
                '-c:v', 'libwebp',
                '-quality', '85',
                outPath,
            ],
            { timeout: config.thumbTimeoutMs },
        );
        return existsSync(outPath) ? outPath : null;
    } catch (err) {
        console.error(
            `[Thumbnail] 音频封面提取失败 media=${mediaId}:`,
            err instanceof Error ? err.message : err,
        );
        return null;
    }
}
