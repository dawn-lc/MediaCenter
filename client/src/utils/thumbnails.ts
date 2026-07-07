// ---------------------------------------------------------------------------
// 客户端缩略图生成与缓存
// 用于服务端未提供缩略图的视频/音频文件，在浏览器端生成缩略图并存入
// Service Worker 的 thumbnails 缓存中供后续复用。
// ---------------------------------------------------------------------------

import { findAtom, parseFirstVideoFrame } from './mp4';

const THUMB_CACHE = 'thumbnails';
const THUMB_PREFIX = '/thumb/client/';
const HEAD_SIZE = 2_097_152;  // 拉取文件头部 2MB（覆盖 >95% 的 moov）
const TAIL_SIZE = 1_048_576;  // moov 在尾部时拉取尾部 1MB

/**
 * 生成视频缩略图，返回 Blob
 *
 * 策略：
 * ① 先拉文件头部 HEAD_SIZE → 若含 moov，从中解析首帧偏移 → 只拉首帧
 * ② 若 moov 不在头部 → HEAD 获取文件总大小 → 拉尾部 TAIL_SIZE → 找到 moov
 *     → 解析首帧偏移 → 只拉首帧
 * ③ 将 ftyp + moov（修正偏移）+ 首帧数据 + mdat 外壳拼装为合法微型 MP4
 * ④ 喂给 <video> 解码绘制
 */
export async function generateVideoThumbnail(
    videoUrl: string,
    _seekTime = 0.3,
): Promise<Blob | null> {

    // ── ① 拉取文件头部 ──
    const headBuf = await rangeFetch(videoUrl, 0, HEAD_SIZE - 1);
    if (!headBuf) return null;

    let moovBuf: ArrayBuffer | null = findAtom(headBuf, 'moov');
    let fileSize = 0;
    let moovAtTail = false;

    // ── ② 若头部无 moov，拉尾部 ──
    if (!moovBuf) {
        const fs = await getFileSize(videoUrl);
        if (!fs) return null;
        fileSize = fs;

        const tailStart = Math.max(0, fileSize - TAIL_SIZE);
        const tailBuf = await rangeFetch(videoUrl, tailStart, fileSize - 1);
        if (!tailBuf) return null;

        moovBuf = findAtom(tailBuf, 'moov');
        if (!moovBuf) return null; // 无 moov，非标准 MP4
        moovAtTail = true;
    }

    // ── ③ 解析首帧偏移 ──
    const frameInfo = parseFirstVideoFrame(moovBuf);
    if (!frameInfo) return null;

    // 若首帧已在头部的范围中，直接取；否则单独下载
    let frameBuf: ArrayBuffer;
    const frameEnd = moovAtTail ? frameInfo.offset + frameInfo.size : frameInfo.offset + frameInfo.size;
    if (!moovAtTail && frameEnd <= HEAD_SIZE) {
        frameBuf = headBuf.slice(frameInfo.offset, frameInfo.offset + frameInfo.size);
    } else {
        const f = await rangeFetch(videoUrl, frameInfo.offset, frameInfo.offset + frameInfo.size - 1);
        if (!f) return null;
        frameBuf = f;
    }

    // ── ④ 拼装微型 MP4 ──
    const mp4Blob = buildMiniMp4(headBuf, moovBuf, frameBuf, frameInfo.offset);
    if (!mp4Blob) return null;

    // ── ⑤ 喂给 <video> 解码 ──
    return decodeFrame(mp4Blob);
}

// ── 辅助函数 ──

/** 带 Range 的 fetch，返回 ArrayBuffer */
async function rangeFetch(
    url: string, start: number, end: number,
): Promise<ArrayBuffer | null> {
    try {
        const resp = await fetch(url, {
            headers: { Range: `bytes=${start}-${end}` },
        });
        if (!resp.ok && resp.status !== 206) return null;
        return await resp.arrayBuffer();
    } catch {
        return null;
    }
}

/** HEAD 请求获取文件总大小 */
async function getFileSize(url: string): Promise<number | null> {
    try {
        const resp = await fetch(url, { method: 'HEAD' });
        const size = parseInt(resp.headers.get('Content-Range')?.split('/')[1] || resp.headers.get('Content-Length') || '', 10);
        return isNaN(size) ? null : size;
    } catch {
        return null;
    }
}

/** 拼装微型 MP4：ftyp + moov(修正stco) + mdat */
function buildMiniMp4(
    headBuf: ArrayBuffer,
    moovBuf: ArrayBuffer,
    frameBuf: ArrayBuffer,
    originalFrameOffset: number,
): Blob | null {
    // 取 ftyp（前 8 字节起）
    const ftyp = findAtom(headBuf, 'ftyp');
    if (!ftyp) return null;

    // 修正 moov 中的 stco/co64 偏移
    // 新偏移 = ftyp大小 + 修后的moov大小 + mdat头大小(8)
    const newOffset = ftyp.byteLength + moovBuf.byteLength + 8;
    const fixedMoov = fixStco(new DataView(moovBuf.slice(0)), originalFrameOffset, newOffset);

    // mdat 外壳
    const mdatHeader = new ArrayBuffer(8);
    const mdatDv = new DataView(mdatHeader);
    mdatDv.setUint32(0, frameBuf.byteLength + 8); // mdat size
    mdatDv.setUint32(4, 0x6D646174);              // 'mdat'

    return new Blob([ftyp, fixedMoov, mdatHeader, frameBuf], { type: 'video/mp4' });
}

/** 修正 moov 中 stco/co64 表的偏移值 */
function fixStco(dv: DataView, originalOffset: number, newOffset: number): ArrayBuffer {
    // 递归遍历所有 atom
    function walk(start: number, end: number) {
        let pos = start;
        while (pos + 8 <= end) {
            const size = dv.getUint32(pos);
            const type = String.fromCharCode(
                dv.getUint8(pos + 4), dv.getUint8(pos + 5),
                dv.getUint8(pos + 6), dv.getUint8(pos + 7),
            );
            if (size < 8) break;
            if (type === 'stco' || type === 'co64') {
                // stco/co64 结构: version(1) + flags(3) + entryCount(4) + entries
                const entryCount = dv.getUint32(pos + 8);
                const entrySize = type === 'co64' ? 8 : 4;
                for (let i = 0; i < entryCount; i++) {
                    const entryPos = pos + 12 + i * entrySize;
                    if (entryPos + entrySize > end) break;
                    if (entrySize === 8) {
                        const val = Number(dv.getBigUint64(entryPos));
                        if (val === originalOffset) {
                            dv.setBigUint64(entryPos, BigInt(newOffset));
                        }
                    } else {
                        const val = dv.getUint32(entryPos);
                        if (val === originalOffset) {
                            dv.setUint32(entryPos, newOffset);
                        }
                    }
                }
            } else {
                // 进入子 atom
                walk(pos + 8, pos + size);
            }
            pos += size;
        }
    }
    walk(0, dv.byteLength);
    return dv.buffer as ArrayBuffer;
}

/** 将 MP4 blob 喂给 <video> 解码出第一帧 */
function decodeFrame(blob: Blob): Promise<Blob | null> {
    return new Promise((resolve) => {
        const blobUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.src = blobUrl;
        video.muted = true;
        video.preload = 'auto';

        const cleanup = () => {
            clearTimeout(timer);
            video.remove();
            URL.revokeObjectURL(blobUrl);
        };
        const timer = setTimeout(() => { cleanup(); resolve(null); }, 10_000);

        video.onloadedmetadata = () => { video.currentTime = 0; };

        video.onseeked = () => {
            clearTimeout(timer);
            const canvas = document.createElement('canvas');
            const maxW = 200;
            const scale = Math.min(1, maxW / (video.videoWidth || 1));
            canvas.width = Math.round((video.videoWidth || 1) * scale);
            canvas.height = Math.round((video.videoHeight || 1) * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) { cleanup(); resolve(null); return; }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                cleanup();
                resolve(blob);
            }, 'image/webp', 0.5);
        };

        video.onerror = () => { cleanup(); resolve(null); };
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
    // 1. 尝试缓存（后续直接从 SW 读取，无需网络）
    const cached = await getCachedThumbnailUrl(mediaId);
    if (cached) return cached;

    // 2. 生成缩略图
    const blob = await generateVideoThumbnail(videoUrl);
    if (!blob) return null;

    // 3. 写入 SW 缓存（下次直接由 SW 响应，不经过网络）
    await cacheThumbnail(mediaId, blob);

    // 4. 直接使用生成的 blob 创建 URL，避免从缓存重新读取
    return URL.createObjectURL(blob);
}
