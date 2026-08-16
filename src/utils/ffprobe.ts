import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';

const execFileAsync = promisify(execFile);

/** ffprobe 提取的容器级信息 */
export interface ProbeContainer {
    format: string | null;        // e.g., "matroska", "mov"
    duration: number | null;      // seconds
    bitrate: number | null;       // overall bitrate (bps)
}

/** ffprobe 提取的流级信息 */
export interface ProbeStream {
    codec: string | null;         // e.g., "h264", "hevc", "aac", "mp3"
    width: number | null;         // video only
    height: number | null;        // video only
}

/** 完整的媒体探测结果 */
export interface MediaInfo {
    duration: number | null;
    /** 视频编码短名，如 "h264", "hevc", "vp9" */
    videoCodec: string | null;
    /** H.264 level (如 41=4.1, 50=5.0)，仅 H.264 有 */
    videoLevel: number | null;
    /** 音频编码短名，如 "aac", "mp3", "opus" */
    audioCodec: string | null;
    width: number | null;
    height: number | null;
    bitrate: number | null;
    /** 容器格式名，如 "matroska", "mov,mp4,m4a,3gp,3g2,mj2" */
    container: string | null;
}

/**
 * 调用 ffprobe 提取媒体元数据
 * @param filePath - 文件绝对路径
 * @returns 解析后的媒体信息，失败返回 null
 */
export async function probeMedia(filePath: string): Promise<MediaInfo | undefined> {
    try {
        // 注意：不能加多个 -select_streams（后一个会覆盖前一个，只生效最后一个），
        // 故全量返回 -show_streams，由下方代码分别取首个视频流与首个音频流
        const { stdout } = await execFileAsync(
            'ffprobe',
            [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filePath
            ],
            { timeout: 30_000, maxBuffer: 1024 * 1024 }  // 30s timeout, 1MB buffer
        );

        const data = JSON.parse(stdout);

        const format = data.format || {};
        const streams: Array<Record<string, unknown>> = data.streams || [];

        // 容器信息
        const container: ProbeContainer = {
            format: format.format_name || null,
            duration: format.duration ? parseFloat(format.duration) : null,
            bitrate: format.bit_rate ? parseInt(format.bit_rate, 10) : null,
        };

        // 流信息
        const videoStream = streams.find((s) => s.codec_type === 'video');
        const audioStream = streams.find((s) => s.codec_type === 'audio');

        const video: ProbeStream = {
            codec: (videoStream?.codec_name as string) || null,
            width: videoStream?.width ? parseInt(String(videoStream.width), 10) : null,
            height: videoStream?.height ? parseInt(String(videoStream.height), 10) : null,
        };

        // H.264 level：ffprobe 返回整数（如 41=4.1, 50=5.0）
        const rawLevel = videoStream?.level ? parseInt(String(videoStream.level), 10) : NaN;
        const videoLevel = !isNaN(rawLevel) && rawLevel > 0 ? rawLevel : null;

        const audio: ProbeStream = {
            codec: (audioStream?.codec_name as string) || null,
            width: null,
            height: null,
        };

        return {
            duration: container.duration,
            videoCodec: video.codec,
            videoLevel,
            audioCodec: audio.codec,
            width: video.width,
            height: video.height,
            bitrate: container.bitrate,
            container: container.format,
        };
    } catch (err) {
        console.warn('[ffprobe] 探测失败:', filePath, err instanceof Error ? err.message : String(err));
    }
}

/**
 * 将 MediaInfo 序列化为 JSON 字符串（存入 media_info 列）
 */
export function serializeMediaInfo(info: MediaInfo | null): string | null {
    if (!info) return null;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(info)) {
        if (v !== null) cleaned[k] = v;
    }
    return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

/**
 * 从 media_info 列反序列化 probe 数据
 */
export function deserializeMediaInfo(json: string | null): MediaInfo | null {
    if (!json) return null;
    try {
        return JSON.parse(json) as MediaInfo;
    } catch {
        return null;
    }
}
