// ---------------------------------------------------------------------------
// 客户端缩略图生成与缓存
// 用于服务端未提供缩略图的视频/音频文件，在浏览器端生成缩略图并存入
// Service Worker 的 thumbnails 缓存中供后续复用。
// ---------------------------------------------------------------------------

import { findAtom, findAtomScan, parseFirstVideoFrame, getVideoStbl, buildSampleIndex, getSampleByteOffset, getByteRangeForSamples } from './mp4';
import { createLogger } from './log';

const THUMB_CACHE = 'thumbnails';
const THUMB_PREFIX = '/thumb?id=';
const HEAD_SIZE = 1_048_576;  // 拉取文件头部 1MB（覆盖 ~90% 的头部位 moov）
const TAIL_SIZE = 1_048_576;  // moov 在尾部时拉取尾部 1MB

/** 确保获取完整的 moov atom（头部不完整时精确重拉，头部无则尾部搜索） */
async function getFullMoov(
    videoUrl: string, headBuf: ArrayBuffer,
): Promise<ArrayBuffer | null> {
    const log = createLogger('thumb');
    const MOOV_SIG = 0x6D6F6F76;

    // 先在头部扫描 moov
    const headDv = new DataView(headBuf);
    for (let i = 4; i <= headBuf.byteLength - 4; i++) {
        if (headDv.getUint32(i) !== MOOV_SIG) continue;
        const sz = headDv.getUint32(i - 4);
        if (sz < 8) continue;
        const moovOffset = i - 4;
        const slicedLen = Math.min(sz, headBuf.byteLength - moovOffset);
        if (slicedLen >= sz) {
            log(`头部 moov 完整 @ ${moovOffset}`);
            return headBuf.slice(moovOffset, moovOffset + sz);
        }
        // 不完整，重新精确拉取
        log(`头部 moov 不完整 (需 ${(sz / 1024).toFixed(0)}KB，仅 ${(slicedLen / 1024).toFixed(0)}KB)，重拉…`);
        const exact = await rangeFetch(videoUrl, moovOffset, moovOffset + sz - 1);
        if (exact) { log('moov 重拉完成'); return exact; }
        break;
    }

    // 头部未找到 → 尾部搜索
    log('头部未找到完整 moov，尝试尾部搜索…');
    for (const tailSize of [TAIL_SIZE, TAIL_SIZE * 2, TAIL_SIZE * 4]) {
        const fs = await getFileSize(videoUrl);
        if (!fs) { log('获取文件大小失败'); return null; }
        log(`文件总大小: ${(fs / 1024 / 1024).toFixed(1)}MB`);
        const tailStart = Math.max(Math.floor(fs / 2), fs - tailSize);
        if (tailStart >= fs) { log('文件太小'); break; }
        log(`拉取尾部 ${tailStart}-${fs - 1}`);
        const tailBuf = await rangeFetch(videoUrl, tailStart, fs - 1);
        if (!tailBuf) { log('尾部拉取失败'); break; }

        const tailDv = new DataView(tailBuf);
        for (let i = 4; i <= tailBuf.byteLength - 4; i++) {
            if (tailDv.getUint32(i) !== MOOV_SIG) continue;
            const sz = tailDv.getUint32(i - 4);
            if (sz < 8 || sz > fs) continue;
            const moovFileOffset = tailStart + i - 4;
            log(`moov: offset=${moovFileOffset}, size=${(sz / 1024 / 1024).toFixed(1)}MB`);
            const exact = await rangeFetch(videoUrl, moovFileOffset, Math.min(moovFileOffset + sz, fs) - 1);
            if (exact) { log('moov 拉取完成'); return exact; }
            break;
        }
    }

    log('头尾均未找到完整 moov');
    return null;
}

/**
 * 生成视频缩略图，返回 Blob
 *
 * 策略（流式按需拉取）：
 * ① 拉文件头部 HEAD_SIZE → 确保获取完整 moov atom
 * ② 从 moov 构建样本索引（stco/stsz/stsc）→ 可按帧号定位字节偏移
 * ③ 拉首帧周边数据 → 拼装微型 MP4 → 解码 → 纯色检测
 * ④ 若纯色：用样本索引定位 +30/+60/…帧的字节偏移，按需拉取 2MB 帧数据
 *     → 重新拼装微型 MP4 → 解码 → 再检测，直至找到非纯色帧或耗尽重试
 */
export async function generateVideoThumbnail(
    videoUrl: string,
): Promise<Blob | null> {
    const log = createLogger('thumb');
    log(`开始: ${videoUrl.slice(0, 80)}`);

    // ── ① 获取完整 moov ──
    log(`拉取头部 0-${HEAD_SIZE - 1}`);
    const headBuf = await rangeFetch(videoUrl, 0, HEAD_SIZE - 1);
    if (!headBuf) { log('头部拉取失败'); return null; }
    log(`头部拉取成功: ${(headBuf.byteLength / 1024).toFixed(1)}KB`);

    const moovBuf = await getFullMoov(videoUrl, headBuf);
    if (!moovBuf) { log('无法获取完整 moov'); return null; }
    log(`moov: ${(moovBuf.byteLength / 1024).toFixed(1)}KB`);

    // ── ② 构建样本索引 ──
    const stbl = getVideoStbl(moovBuf);
    if (!stbl) { log('无法获取视频 stbl'); return null; }
    const index = buildSampleIndex(stbl);
    if (!index) { log('无法构建样本索引'); return null; }
    log(`样本索引: ${index.totalSamples} samples, ${index.chunkOffsets.length} chunks`);

    // ── ③ 解析首帧 ──
    const frameInfo = parseFirstVideoFrame(moovBuf);
    if (!frameInfo) { log('解析首帧偏移失败'); return null; }
    log(`首帧: offset=${frameInfo.offset}, size=${(frameInfo.size / 1024).toFixed(1)}KB`);

    // ── ④ 流式重试：纯色 → 用索引定位后续帧 → 按需渐进拉取 ──
    // 关键：始终从首帧偏移起拉，确保关键帧包含在内；
    // 拉取量 = getByteRangeForSamples 精确值 + 解码器安全边际
    //
    // 为什么需要安全边际？
    // getByteRangeForSamples 返回的是涵盖帧0→目标帧所有 chunk 的严格最小范围，
    // 但浏览器 MP4 解码器在 seek 时会预读后续数据、维护内部缓冲，
    // 若后续 chunk 被 fixStco 映射为 FAR（超出数据范围），解码会静默失败（黑帧）。
    // 因此追加约 1 秒码率的数据量作为安全边际——实测 512KB 不够，~1MB 足够。
    const FRAME_RATE = 30;
    const MAX_RETRIES = 5;
    const FIRST_FETCH_SIZE = Math.max(frameInfo.size, 512 * 1024); // 首帧最少 512KB
    const SEEK_MARGIN = 5 * 1024 * 1024; // 解码器 seek 安全边际：确保足够 chunk 不被 FAR

    let firstBlob: Blob | null = null; // 保存首帧，全部纯色时回退用

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const targetFrame = attempt * 30; // 0, 30, 60, 90, 120, 150
        const targetTime = targetFrame / FRAME_RATE;

        // 用索引精确定位所需字节范围
        const exact = getByteRangeForSamples(index, targetFrame);
        if (!exact) {
            log(`样本 ${targetFrame} 超出范围 (共 ${index.totalSamples})`);
            break;
        }

        // 始终从首帧偏移起拉；首帧取最小值，重试加上安全边际
        const byteOffset = exact.offset;
        const fetchSize = attempt === 0
            ? FIRST_FETCH_SIZE
            : Math.max(exact.size, exact.size + SEEK_MARGIN);

        // 按需拉取帧数据
        let frameBuf: ArrayBuffer;
        if (byteOffset + fetchSize <= HEAD_SIZE) {
            log(`帧数据在头部范围内，复用 (${(fetchSize / 1024).toFixed(0)}KB)`);
            frameBuf = headBuf.slice(byteOffset, byteOffset + fetchSize);
        } else {
            const end = byteOffset + fetchSize - 1;
            log(`拉取帧数据: ${byteOffset}-${end} (${(fetchSize / 1024 / 1024).toFixed(1)}MB)`);
            const f = await rangeFetch(videoUrl, byteOffset, end);
            if (!f) { log('帧数据拉取失败'); continue; }
            frameBuf = f;
        }
        log(`帧数据: ${(frameBuf.byteLength / 1024).toFixed(1)}KB`);

        // 拼装微型 MP4
        log('拼装微型 MP4...');
        const mp4Blob = buildMiniMp4(headBuf, moovBuf, frameBuf, byteOffset);
        if (!mp4Blob) { log('拼装失败'); continue; }
        log(`微型 MP4: ${(mp4Blob.size / 1024).toFixed(1)}KB`);

        // 解码（seek 到目标时间）
        log('喂给 <video> 解码...');
        const frameBlob = await decodeFrame(mp4Blob, targetTime);
        if (!frameBlob) continue;

        // 保存首帧供全部纯色时回退
        if (attempt === 0) firstBlob = frameBlob;

        // 纯色检测
        const isSolid = await isNearSolidColor(frameBlob);
        if (!isSolid) {
            log(`非纯色 @ ${targetTime.toFixed(1)}s → 缩略图生成成功`);
            return frameBlob;
        }
        log(attempt === 0
            ? `首帧纯色`
            : `+${targetFrame} 帧 (${targetTime.toFixed(1)}s) 仍纯色`);
    }

    // 全部纯色，回退到首帧
    log('所有位置均为纯色，回退首帧');
    return firstBlob;
}

// ── 辅助函数 ──

/** 带 Range 的 fetch */
async function rangeFetch(
    url: string, start: number, end: number,
): Promise<ArrayBuffer | null> {
    try {
        const expected = end - start + 1;
        const resp = await fetch(url, {
            headers: { Range: `bytes=${start}-${end}` },
        });
        if (resp.status !== 206) return null;
        const buf = await resp.arrayBuffer();
        // 验证返回数据大小符合预期，排除服务器返回 206 但响应体异常的 bug
        if (buf.byteLength < expected) return null;
        return buf;
    } catch {
        return null;
    }
}

/** 获取文件总大小，同时尝试 Range + HEAD 两种方式 */
async function getFileSize(url: string): Promise<number | null> {
    try {
        // 方式 1：Range 请求前 1KB，从 Content-Range 读取总大小
        const r1 = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
        createLogger('thumb')(`Range 响应: status=${r1.status}`);
        if (r1.status === 206) {
            const cr = r1.headers.get('Content-Range');
            const cl1 = r1.headers.get('Content-Length');
            createLogger('thumb')(`  Content-Range: ${cr}, Content-Length: ${cl1}`);
            if (cr) {
                const size = parseInt(cr.split('/')[1], 10);
                if (size > 1024) return size; // 有效大小应远大于 Range 请求量
            }
            // 有 Content-Length 也可作为兜底
            const cl = parseInt(cl1 || '', 10);
            if (cl > 1024) return cl;
        }

        // 方式 2：HEAD 请求获取 Content-Length
        const r2 = await fetch(url, { method: 'HEAD' });
        createLogger('thumb')(`HEAD 响应: status=${r2.status}`);
        if (r2.ok) {
            const cl2 = r2.headers.get('Content-Length');
            createLogger('thumb')(`  Content-Length: ${cl2}`);
            const cl = parseInt(cl2 || '', 10);
            if (cl > 0) return cl;
        }

        createLogger('thumb')(`无法获取文件大小: range=${r1.status} head=${r2.status}`);
        return null;
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
    if (!ftyp) { createLogger('thumb')('未找到 ftyp'); return null; }

    // 修正 moov 中的 stco/co64 偏移
    // 新偏移 = ftyp大小 + 修后的moov大小 + mdat头大小(8)
    const newOffset = ftyp.byteLength + moovBuf.byteLength + 8;
    const fixedMoov = fixStco(new DataView(moovBuf.slice(0)), originalFrameOffset, newOffset, frameBuf.byteLength);
    createLogger('thumb')(`修正偏移: ${originalFrameOffset} → ${newOffset}`);

    // mdat 外壳
    const mdatHeader = new ArrayBuffer(8);
    const mdatDv = new DataView(mdatHeader);
    mdatDv.setUint32(0, frameBuf.byteLength + 8); // mdat size
    mdatDv.setUint32(4, 0x6D646174);              // 'mdat'

    return new Blob([ftyp, fixedMoov, mdatHeader, frameBuf], { type: 'video/mp4' });
}

/** 修正 moov 中 stco/co64 表：
 *
 *  数据范围：originalOffset ~ originalOffset + dataSize
 *  落在范围内的条目 → 映射到微型 MP4 中的对应位置
 *  范围外的条目     → FAR（解码器越界读取会优雅失败） */
function fixStco(
    dv: DataView,
    originalOffset: number,
    newOffset: number,
    dataSize: number,
): ArrayBuffer {
    const FAR32 = 0xFFFFFFFF;
    const FAR64 = BigInt('0xFFFFFFFFFFFFFFFF');
    const dataEnd = originalOffset + dataSize;

    function walk(start: number, end: number) {
        // 防止异常 size 导致递归 end 超出 DataView 边界
        end = Math.min(end, dv.byteLength);
        let pos = start;
        while (pos + 8 <= end) {
            const size = dv.getUint32(pos);
            const type = String.fromCharCode(
                dv.getUint8(pos + 4), dv.getUint8(pos + 5),
                dv.getUint8(pos + 6), dv.getUint8(pos + 7),
            );
            if (size < 8) break;
            if (type === 'stco' || type === 'co64') {
                const entryCount = dv.getUint32(pos + 12);
                const entrySize = type === 'co64' ? 8 : 4;
                for (let i = 0; i < entryCount; i++) {
                    const entryPos = pos + 16 + i * entrySize;
                    if (entryPos + entrySize > end) break;
                    if (entrySize === 8) {
                        const val = Number(dv.getBigUint64(entryPos));
                        const mapped = (val >= originalOffset && val < dataEnd)
                            ? BigInt(newOffset + (val - originalOffset))
                            : FAR64;
                        dv.setBigUint64(entryPos, mapped);
                    } else {
                        const val = dv.getUint32(entryPos);
                        const mapped = (val >= originalOffset && val < dataEnd)
                            ? newOffset + (val - originalOffset)
                            : FAR32;
                        dv.setUint32(entryPos, mapped);
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

/** 检测缩略图是否"不可用"（纯色或近纯色，对用户无意义）
 *
 *  两阶段判断：
 *  1. 亮度预判：10×10 采样均值近全黑（<20）或近全白（>235）
 *     → 无论方差如何，直接视为不可用（黑屏/白屏/黑屏+小水印都算）
 *  2. 方差判断：中间亮度时，若所有采样点颜色相近（maxDev<2000）
 *     → 纯色标题卡等，也视为不可用 */
async function isNearSolidColor(blob: Blob): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const SAMPLE = 10;
            const canvas = document.createElement('canvas');
            canvas.width = SAMPLE;
            canvas.height = SAMPLE;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(false); return; }
            ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
            const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
            const N = data.length / 4;

            // 计算平均颜色
            let sr = 0, sg = 0, sb = 0;
            for (let i = 0; i < data.length; i += 4) {
                sr += data[i];
                sg += data[i + 1];
                sb += data[i + 2];
            }
            const ar = sr / N, ag = sg / N, ab = sb / N;

            // 阶段 1：亮度预判——近全黑/全白直接视为不可用缩略图
            // 覆盖纯黑屏、纯白屏，以及"黑屏+小水印"等 99% 黑暗画面
            const avgBrightness = (ar + ag + ab) / 3;
            if (avgBrightness < 20 || avgBrightness > 235) {
                resolve(true);
                return;
            }

            // 计算任一像素偏离均值的最大平方差
            let maxDev = 0;
            for (let i = 0; i < data.length; i += 4) {
                const dr = data[i] - ar;
                const dg = data[i + 1] - ag;
                const db = data[i + 2] - ab;
                const dev = dr * dr + dg * dg + db * db;
                if (dev > maxDev) maxDev = dev;
            }

            // 阶段 2：中间亮度纯色（如纯色标题卡），阈值 ≈ 45²×3
            resolve(maxDev < 2000);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(false);
        };
        img.src = url;
    });
}

/** 将 MP4 blob 喂给 <video> 解码，可指定 seek 到目标时间（秒）截取 */
function decodeFrame(blob: Blob, seekTime?: number): Promise<Blob | null> {
    return new Promise((resolve) => {
        const blobUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.src = blobUrl;
        video.muted = true;
        video.preload = 'auto';

        const log = createLogger('thumb');
        let resolved = false;

        const finish = (result: Blob | null) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            video.remove();
            URL.revokeObjectURL(blobUrl);
            resolve(result);
        };

        const timer = setTimeout(() => {
            log('<video> 解码超时');
            finish(null);
        }, 10_000);

        const capture = () => {
            const canvas = document.createElement('canvas');
            const maxW = 380;
            const scale = Math.min(1, maxW / (video.videoWidth || 1));
            canvas.width = Math.round((video.videoWidth || 1) * scale);
            canvas.height = Math.round((video.videoHeight || 1) * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) { finish(null); return; }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((b) => {
                log('canvas 绘制完成');
                finish(b);
            }, 'image/webp', 0.5);
        };

        video.onloadeddata = () => {
            if (seekTime && seekTime > 0 && video.duration > seekTime + 0.1) {
                log(`就绪，seek → ${seekTime.toFixed(1)}s`);
                video.currentTime = seekTime;
                video.onseeked = () => {
                    // seeked 触发时 4K 解码可能未完成渲染，延迟一帧再截取
                    setTimeout(capture, 150);
                };
            } else {
                log(`就绪: ${video.videoWidth}x${video.videoHeight}`);
                capture();
            }
        };

        video.onerror = () => {
            log('<video> 解码错误');
            finish(null);
        };
    });
}

// ── 缓存操作 ──

/** 缓存键 & SW 路由：/thumb?client=<mediaId> */
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

/** 从缓存中获取缩略图，返回 SW 缓存路由 URL（由 SW 直接响应，无 blob 生命周期问题） */
export async function getCachedThumbnailUrl(mediaId: string): Promise<string | null> {
    try {
        const cache = await caches.open(THUMB_CACHE);
        const response = await cache.match(cacheKey(mediaId));
        if (!response) return null;
        // 返回 SW 路由 URL——SW 会从 Cache 直接响应，无需 blob
        return cacheKey(mediaId);
    } catch {
        return null;
    }
}

/**
 * 一键：获取已缓存的缩略图，若不存在则生成并缓存
 * @returns SW 缓存路由 URL（/thumb?id=<mediaId>）或 null
 */
export async function obtainThumbnailUrl(
    mediaId: string,
    videoUrl: string,
): Promise<string | null> {
    // 1. 尝试缓存
    const cached = await getCachedThumbnailUrl(mediaId);
    if (cached) return cached;

    // 2. 生成缩略图
    const blob = await generateVideoThumbnail(videoUrl);
    if (!blob) return null;

    // 3. 写入 SW 缓存
    await cacheThumbnail(mediaId, blob);

    // 4. 返回 SW 路由 URL——SW 从缓存响应，URL 永久有效
    return cacheKey(mediaId);
}
