// ---------------------------------------------------------------------------
// 客户端缩略图生成与缓存
// 用于服务端未提供缩略图的视频/音频文件，在浏览器端生成缩略图并存入
// Service Worker 的 thumbnails 缓存中供后续复用。
// ---------------------------------------------------------------------------

const THUMB_CACHE = 'thumbnails';
const THUMB_PREFIX = '/thumb/client/';

/** 生成视频缩略图，返回 Blob */
export function generateVideoThumbnail(
    videoUrl: string,
    seekTime = 2,
): Promise<Blob | null> {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.src = videoUrl;
        video.muted = true;
        video.preload = 'metadata';

        // 如果 seek 时间超过时长，取中间位置
        video.onloadedmetadata = () => {
            const time = video.duration > seekTime ? seekTime : video.duration / 2;
            video.currentTime = time;
        };

        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            const maxW = 320;
            const scale = Math.min(1, maxW / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                video.remove();
                resolve(blob);
            }, 'image/webp', 0.7);
        };

        video.onerror = () => {
            video.remove();
            resolve(null);
        };
    });
}

// ── 缓存操作 ──

/** 缓存键：/thumb/client/<mediaId> */
function cacheKey(mediaId: string): string {
    return `${THUMB_PREFIX}${mediaId}`;
}

/** 将缩略图存入 SW 缓存 */
export async function cacheThumbnail(mediaId: string, blob: Blob): Promise<void> {
    try {
        const cache = await caches.open(THUMB_CACHE);
        const response = new Response(blob, {
            headers: {
                'Content-Type': blob.type || 'image/webp',
                'Cache-Control': 'public, max-age=31536000',
            },
        });
        await cache.put(cacheKey(mediaId), response);
    } catch {
        // 静默失败（如无 SW 支持）
    }
}

/** 从缓存中获取缩略图，返回对象 URL（调用者需在适当时机 revoke） */
export async function getCachedThumbnailUrl(mediaId: string): Promise<string | null> {
    try {
        const cache = await caches.open(THUMB_CACHE);
        const response = await cache.match(cacheKey(mediaId));
        if (!response) return null;
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch {
        return null;
    }
}

/**
 * 一键：获取已缓存的缩略图，若不存在则生成并缓存
 * @returns 对象 URL 或 null
 */
export async function obtainThumbnailUrl(
    mediaId: string,
    videoUrl: string,
): Promise<string | null> {
    // 1. 尝试缓存
    const cached = await getCachedThumbnailUrl(mediaId);
    if (cached) return cached;

    // 2. 生成
    const blob = await generateVideoThumbnail(videoUrl);
    if (!blob) return null;

    // 3. 缓存
    await cacheThumbnail(mediaId, blob);

    return URL.createObjectURL(blob);
}
