/**
 * MIME 类型浏览器兼容策略
 *
 * 浏览器对 MKV/MOV 容器的原生支持有限，但底层解码器可以处理其中的编码流。
 * 本模块根据 ffprobe 提取的真实编解码器信息，将数据库 mimeType 归一化为
 * 浏览器可直接识别的值，供 stream 响应 Content-Type 头使用。
 *
 * 同时包含 H.264 Level 违规检测——Chrome 严格校验 SPS 中声明的 level
 * 是否与分辨率匹配，不匹配则直接拒绝解码。
 */

/** WebM 编解码器族：VP8 / VP9 / AV1 */
export const WEBM_VIDEO_CODECS = new Set(['vp8', 'vp9', 'av1']);

/** 需要归一化的容器 MIME 类型（浏览器原生支持差） */
export const NORMALIZE_CONTAINERS = new Set(['video/x-matroska', 'video/quicktime']);

/**
 * 根据 ffprobe 真实编解码器，将 MKV/MOV 的 mimeType 更新为浏览器兼容值。
 */
export function resolveBestMimeType(originalMimeType: string, videoCodec: string | null): string {
    if (!NORMALIZE_CONTAINERS.has(originalMimeType)) {
        return originalMimeType;
    }
    if (videoCodec && WEBM_VIDEO_CODECS.has(videoCodec)) {
        return 'video/webm';
    }
    return 'video/mp4';
}

// ── H.264 Level 违规检测 ──

/**
 * H.264 Level → 最大宏块/帧 对照表
 * 来源：ITU-T H.264 Annex A, Table A-1
 */
const H264_LEVEL_MAX_MB: Record<number, number> = {
    10: 99, 11: 396, 12: 396, 13: 396,        // Level 1.x (QCIF/CIF)
    20: 396, 21: 792, 22: 1620,                 // Level 2.x
    30: 1620, 31: 3600, 32: 5120,              // Level 3.x (SD)
    40: 8192, 41: 8192, 42: 8704,              // Level 4.x (1080p)
    50: 22080, 51: 36864, 52: 36864,           // Level 5.x (4K)
    60: 69632, 61: 139264, 62: 139264,         // Level 6.x (8K)
};

/** 根据分辨率计算需要的 H.264 level（最低满足的 level × 10） */
export function calcRequiredLevel(width: number, height: number): number {
    const mbW = Math.ceil(width / 16);
    const mbH = Math.ceil(height / 16);
    const mbPerFrame = mbW * mbH;
    for (const [lv, maxMb] of Object.entries(H264_LEVEL_MAX_MB).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
        if (maxMb >= mbPerFrame) return parseInt(lv);
    }
    return 62; // 超出所有 level，回退到最高
}

/**
 * 检测 H.264 level 是否低于分辨率要求
 * @returns 需要的 level × 10，无需修正时返回 null
 */
export function needsLevelFix(videoCodec: string | null, width: number | null, height: number | null, declaredLevel: number | null): number | null {
    if (videoCodec !== 'h264' || !width || !height || !declaredLevel) return null;
    const required = calcRequiredLevel(width, height);
    return required > declaredLevel ? required : null;
}

