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
    const log = (msg: string) => console.log(`[thumb] ${msg}`);
    const shortUrl = videoUrl.length > 80 ? videoUrl.slice(0, 80) + '...' : videoUrl;
    log(`开始: ${shortUrl}`);

    // ── ① 拉取文件头部 ──
    log(`拉取头部 0-${HEAD_SIZE - 1}`);
    const headBuf = await rangeFetch(videoUrl, 0, HEAD_SIZE - 1);
    if (!headBuf) { log('头部拉取失败'); return null; }
    log(`头部拉取成功: ${(headBuf.byteLength / 1024).toFixed(1)}KB`);

    let moovBuf: ArrayBuffer | null = findAtom(headBuf, 'moov');
    let fileSize = 0;
    let moovAtTail = false;

    // ── ② 若头部无 moov，拉尾部 ──
    if (!moovBuf) {
        log('头部未找到 moov，尝试尾部');
        const fs = await getFileSize(videoUrl);
        if (!fs) { log('获取文件大小失败'); return null; }
        fileSize = fs;
        log(`文件总大小: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

        const tailStart = Math.max(0, fileSize - TAIL_SIZE);
        log(`拉取尾部 ${tailStart}-${fileSize - 1}`);
        const tailBuf = await rangeFetch(videoUrl, tailStart, fileSize - 1);
        if (!tailBuf) { log('尾部拉取失败'); return null; }

        moovBuf = findAtom(tailBuf, 'moov');
        if (!moovBuf) { log('尾部也未找到 moov，放弃'); return null; }
        moovAtTail = true;
        log('尾部找到 moov');
    } else {
        log('头部找到 moov');
    }

    // ── ③ 解析首帧偏移 ──
    log('解析首帧偏移...');
    const frameInfo = parseFirstVideoFrame(moovBuf);
    if (!frameInfo) { log('解析首帧偏移失败'); return null; }
    log(`首帧: offset=${frameInfo.offset}, size=${(frameInfo.size / 1024).toFixed(1)}KB`);

    // 若首帧已在头部的范围中，直接取；否则单独下载
    let frameBuf: ArrayBuffer;
    if (!moovAtTail && (frameInfo.offset + frameInfo.size <= HEAD_SIZE)) {
        log('首帧已在头部数据中，直接截取');
        frameBuf = headBuf.slice(frameInfo.offset, frameInfo.offset + frameInfo.size);
    } else {
        const end = frameInfo.offset + frameInfo.size - 1;
        log(`单独拉取首帧: ${frameInfo.offset}-${end}`);
        const f = await rangeFetch(videoUrl, frameInfo.offset, end);
        if (!f) { log('首帧拉取失败'); return null; }
        frameBuf = f;
    }
    log(`首帧数据: ${(frameBuf.byteLength / 1024).toFixed(1)}KB`);

    // ── ④ 拼装微型 MP4 ──
    log('拼装微型 MP4...');
    const mp4Blob = buildMiniMp4(headBuf, moovBuf, frameBuf, frameInfo.offset);
    if (!mp4Blob) { log('拼装失败'); return null; }
    log(`微型 MP4: ${(mp4Blob.size / 1024).toFixed(1)}KB`);

    // ── ⑤ 喂给 <video> 解码 ──
    log('喂给 <video> 解码...');
    const result = await decodeFrame(mp4Blob);
    log(result ? '缩略图生成成功' : '解码失败');
    return result;
}

// ── 辅助函数 ──

/** 带 Range 的 fetch，只接受 206 Partial Content，否则返回 null */
async function rangeFetch(
    url: string, start: number, end: number,
): Promise<ArrayBuffer | null> {
    try {
        const resp = await fetch(url, {
            headers: { Range: `bytes=${start}-${end}` },
        });
        // 服务器必须返回 206 Partial Content，否则说明不支持 Range 请求
        if (resp.status !== 206) return null;
        return await resp.arrayBuffer();
    } catch {
        return null;
    }
}

/** HEAD 请求获取文件总大小 */
async function getFileSize(url: string): Promise<number | null> {
    try {
        // 先尝试 Range 请求一个字节，从 Content-Range 拿到总大小
        const resp = await fetch(url, {
            headers: { Range: 'bytes=0-0' },
        });
        if (resp.status === 206) {
            const cr = resp.headers.get('Content-Range');
            if (cr) {
                const size = parseInt(cr.split('/')[1], 10);
                if (!isNaN(size)) return size;
            }
        }
        // fallback: Content-Length
        const cl = parseInt(resp.headers.get('Content-Length') || '', 10);
        return isNaN(cl) ? null : cl;
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
    if (!ftyp) { console.log('[thumb] 未找到 ftyp'); return null; }

    // 修正 moov 中的 stco/co64 偏移
    // 新偏移 = ftyp大小 + 修后的moov大小 + mdat头大小(8)
    const newOffset = ftyp.byteLength + moovBuf.byteLength + 8;
    const fixedMoov = fixStco(new DataView(moovBuf.slice(0)), originalFrameOffset, newOffset);
    console.log(`[thumb] 修正偏移: ${originalFrameOffset} → ${newOffset}`);

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
        const timer = setTimeout(() => {
            console.log('[thumb] <video> 解码超时');
            cleanup(); resolve(null);
        }, 10_000);

        video.onloadedmetadata = () => {
            console.log('[thumb] <video> 元数据就绪，currentTime=0');
            video.currentTime = 0;
        };

        video.onseeked = () => {
            console.log(`[thumb] seek 完成: ${video.videoWidth}x${video.videoHeight}`);
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
                console.log('[thumb] canvas 绘制完成');
                cleanup();
                resolve(blob);
            }, 'image/webp', 0.5);
        };

        video.onerror = (e) => {
            console.log('[thumb] <video> 解码错误:', e);
            cleanup(); resolve(null);
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
