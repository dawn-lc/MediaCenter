// ---------------------------------------------------------------------------
// 轻量 MP4 原子解析器
//
// 只实现我们需要的两个功能：
//   1. findAtom(buf, name) → 在任意位置搜索指定 atom（递归进入容器 atom）
//   2. parseFirstVideoFrame(moov) → 从 moov 中提取首个视频帧的字节偏移+大小
//
// 完整覆盖 ISO 14496-12 中常见 box 格式，含 extended size (64-bit)、
// co64、stsc、version/flags 等边界情况。
// ---------------------------------------------------------------------------

import { createLogger } from './log';

// ── 原子层 ──

/** 读取 atom 头部，返回 { type, dataStart, dataEnd }，无匹配时返回 null */
export function readAtomHeader(
    buf: ArrayBuffer, offset: number,
): { type: string; dataStart: number; dataEnd: number } | null {
    const dv = new DataView(buf);
    if (offset + 8 > buf.byteLength) return null;
    let size = dv.getUint32(offset);
    const type = String.fromCharCode(dv.getUint8(offset + 4), dv.getUint8(offset + 5), dv.getUint8(offset + 6), dv.getUint8(offset + 7));
    if (size === 0) {
        // size=0 表示延伸到文件末尾
        size = buf.byteLength - offset;
    } else if (size === 1) {
        // extended size: 后跟 8 字节真正的 size
        if (offset + 16 > buf.byteLength) return null;
        size = Number(dv.getBigUint64(offset + 8));
        return { type, dataStart: offset + 16, dataEnd: offset + size };
    }
    if (size < 8) return null;
    return { type, dataStart: offset + 8, dataEnd: offset + size };
}

/**
 * 从已知的原子数据顶层递归搜索指定名称的 atom。
 *
 * 适用于在已知结构的数据（如 trak、stbl、moov 等）中按原子树结构精确查找，
 * 不会将二进制数据中的随机 4 字节误认为 atom。
 */
export function findAtomIn(
    buf: ArrayBuffer, target: string,
): ArrayBuffer | null {
    const containerTypes = new Set([
        'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'meta',
        'dinf', 'mvex', 'moof', 'traf',
    ]);
    function walk(start: number, end: number): ArrayBuffer | null {
        let pos = start;
        while (pos < end) {
            const h = readAtomHeader(buf, pos);
            if (!h || h.dataEnd > end) break;
            if (h.type === target) return buf.slice(pos, h.dataEnd);
            if (containerTypes.has(h.type)) {
                const found = walk(h.dataStart, h.dataEnd);
                if (found) return found;
            }
            pos = h.dataEnd;
        }
        return null;
    }
    return walk(0, buf.byteLength);
}

/**
 * 在任意二进制数据中扫描 4 字节签名查找 atom。
 *
 * 适用于在文件头部/尾部切片中搜索 moov、ftyp 等可能跨片段的 atom。
 * 不依赖原子边界对齐，但可能因随机数据中的相同签名产生假阳性。
 */
export function findAtomScan(
    buf: ArrayBuffer, target: string,
): ArrayBuffer | null {
    const dv = new DataView(buf);
    const targetCode = target.charCodeAt(0) << 24 |
        target.charCodeAt(1) << 16 |
        target.charCodeAt(2) << 8 |
        target.charCodeAt(3);
    const len = buf.byteLength;

    for (let pos = 0; pos <= len - 4; pos++) {
        const code = dv.getUint32(pos);
        if (code !== targetCode) continue;
        if (pos < 4) continue;
        const size = dv.getUint32(pos - 4);
        if (size < 8 || size > len + 8) continue;
        const start = pos - 4;
        const end = start + size;
        if (end > len + 4) continue;
        return buf.slice(start, Math.min(end, len));
    }
    return null;
}

/** 兼容别名：findAtom 默认用精确原子树查找 */
export const findAtom = findAtomIn;

/** 收集指定名称的所有同级 atom（已在同一层级遍历，不递归） */
function collectSiblings(
    buf: ArrayBuffer, start: number, end: number,
): { type: string; dataStart: number; dataEnd: number }[] {
    const result: { type: string; dataStart: number; dataEnd: number }[] = [];
    let pos = start;
    while (pos < end) {
        const h = readAtomHeader(buf, pos);
        if (!h || h.dataEnd > end) break;
        result.push(h);
        pos = h.dataEnd;
    }
    return result;
}

// ── FullBox 工具（含 version + flags 的 atom） ──

function readVersion(buf: ArrayBuffer, start: number): number {
    return new DataView(buf).getUint8(start);
}
function readFlags(buf: ArrayBuffer, start: number): number {
    return new DataView(buf).getUint32(start) & 0x00FFFFFF;
}

// ── stbl 层解析 ──

/** 从视频轨道的 stbl 中提取首帧信息 */
function parseStbl(stblData: ArrayBuffer): { offset: number; size: number } | null {
    const log = createLogger('mp4');
    let stco: ArrayBuffer | null = null;
    let co64: ArrayBuffer | null = null;
    let stsz: ArrayBuffer | null = null;
    let stsc: ArrayBuffer | null = null;

    let pos = 0;
    while (pos + 8 <= stblData.byteLength) {
        const h = readAtomHeader(stblData, pos);
        if (!h) break;
        if (h.type === 'stco') stco = stblData.slice(pos, h.dataEnd);
        else if (h.type === 'co64') co64 = stblData.slice(pos, h.dataEnd);
        else if (h.type === 'stsz') stsz = stblData.slice(pos, h.dataEnd);
        else if (h.type === 'stsc') stsc = stblData.slice(pos, h.dataEnd);
        pos = h.dataEnd;
    }

    // stsz（原子含 8B header + 4B version/flags，数据偏移 12）
    if (!stsz) { log('stsz 未找到'); return null; }
    const stszDv = new DataView(stsz);
    const uniformSize = stszDv.getUint32(12);
    const sampleCount = stszDv.getUint32(16);
    if (sampleCount === 0) { log('stsz sampleCount=0'); return null; }
    const firstSampleSize = uniformSize > 0 ? uniformSize : stszDv.getUint32(20);
    log(`stsz: uniform=${uniformSize}, count=${sampleCount}, firstSize=${firstSampleSize}`);

    // stco / co64（原子含 8B header + 4B version/flags，entry 偏移 12）
    const offsetTable = co64 || stco;
    if (!offsetTable) { log('stco/co64 未找到'); return null; }
    const offDv = new DataView(offsetTable);
    const isCo64 = co64 !== null;
    const entryCount = offDv.getUint32(12);
    log(`stco/co64: isCo64=${isCo64}, entryCount=${entryCount}`);
    if (entryCount === 0) { log('stco entryCount=0'); return null; }

    const entrySize = isCo64 ? 8 : 4;
    const entryOffset = 16; // 跳过 8B header + 4B version/flags + 4B entryCount
    let firstChunkOffset: number;
    if (isCo64) {
        firstChunkOffset = Number(offDv.getBigUint64(entryOffset));
    } else {
        firstChunkOffset = offDv.getUint32(entryOffset);
    }

    // stsc（sample-to-chunk）
    // 原子含 8B header + 4B version/flags，表数据偏移 12
    if (stsc) {
        const stscDv = new DataView(stsc);
        const stscEntryCount = stscDv.getUint32(12);
        if (stscEntryCount > 0) {
            // stsc 表项：firstChunk(4) + samplesPerChunk(4) + sampleDescIndex(4)
            // 首个表项在偏移 16 处
            // 第一块通常只有一个 sample，无需调整
        }
    }

    return { offset: firstChunkOffset, size: firstSampleSize };
}

// ── trak 层 ──

/** 判断一个 trak 是否为视频轨道，是则返回其 stbl 数据 */
function extractVideoStbl(trakData: ArrayBuffer): ArrayBuffer | null {
    const log = createLogger('mp4');
    // 找 hdlr → 判断 track 类型
    const hdlr = findAtom(trakData, 'hdlr');
    if (!hdlr) { log('hdlr 未找到'); return null; }
    const hdlrDv = new DataView(hdlr);
    // hdlr atom 结构（含头部 8B）:
    //   0-3: size, 4-7: 'hdlr', 8: version, 9-11: flags
    //   12-15: preDefined, 16-19: handlerType
    const handlerType = String.fromCharCode(
        hdlrDv.getUint8(16), hdlrDv.getUint8(17),
        hdlrDv.getUint8(18), hdlrDv.getUint8(19),
    );
    log(`hdlr handlerType=${handlerType}`);
    if (handlerType !== 'vide') { log('非视频轨道，跳过'); return null; }

    // 视频轨道，取 mdia → minf → stbl
    const mdia = findAtom(trakData, 'mdia');
    if (!mdia) { log('mdia 未找到'); return null; }
    const minf = findAtom(mdia, 'minf');
    if (!minf) { log('minf 未找到'); return null; }
    const stbl = findAtom(minf, 'stbl');
    if (!stbl) { log('stbl 未找到'); return null; }
    // findAtom 返回含头部的完整 atom，stbl 头部 8B 后才是子 atom
    return trimAtomHeader(stbl);
}

/** 去掉 atom 的 8 字节头部，返回纯数据区 */
function trimAtomHeader(atom: ArrayBuffer): ArrayBuffer {
    return atom.byteLength > 8 ? atom.slice(8) : atom;
}

// ── 样本索引（用于按时间定位帧数据的字节偏移）──

/** 从完整 moov 中提取视频轨道的 stbl 数据（已去除 stbl 自身头部） */
export function getVideoStbl(moovBuffer: ArrayBuffer): ArrayBuffer | null {
    let pos = 8;
    while (pos + 8 <= moovBuffer.byteLength) {
        const h = readAtomHeader(moovBuffer, pos);
        if (!h) break;
        if (h.type === 'trak') {
            const trakData = moovBuffer.slice(h.dataStart, h.dataEnd);
            const stbl = extractVideoStbl(trakData);
            if (stbl) return stbl;
        }
        pos = h.dataEnd;
    }
    return null;
}

/** 视频样本索引，用于根据样本号定位原始文件中的字节偏移 */
export interface SampleIndex {
    chunkOffsets: number[];    // chunkOffsets[c] = 第 c 个 chunk 的文件字节偏移
    sampleSizes: number[];     // sampleSizes[s] = 第 s 个 sample 的字节大小
    stsc: { firstChunk: number; samplesPerChunk: number }[];
    totalSamples: number;
}

/** 从 stbl 数据构建样本索引 */
export function buildSampleIndex(stblData: ArrayBuffer): SampleIndex | null {
    const log = createLogger('mp4');
    let stco: ArrayBuffer | null = null;
    let co64: ArrayBuffer | null = null;
    let stsz: ArrayBuffer | null = null;
    let stsc: ArrayBuffer | null = null;

    let pos = 0;
    while (pos + 8 <= stblData.byteLength) {
        const h = readAtomHeader(stblData, pos);
        if (!h) break;
        if (h.type === 'stco') stco = stblData.slice(pos, h.dataEnd);
        else if (h.type === 'co64') co64 = stblData.slice(pos, h.dataEnd);
        else if (h.type === 'stsz') stsz = stblData.slice(pos, h.dataEnd);
        else if (h.type === 'stsc') stsc = stblData.slice(pos, h.dataEnd);
        pos = h.dataEnd;
    }

    const offsetTable = co64 || stco;
    if (!offsetTable || !stsz) { log('缺少 stco/co64 或 stsz'); return null; }
    const isCo64 = co64 !== null;

    // 解析 chunk 偏移表
    const offDv = new DataView(offsetTable);
    const chunkCount = offDv.getUint32(12);
    const chunkOffsets: number[] = [];
    const entrySize = isCo64 ? 8 : 4;
    for (let i = 0; i < chunkCount; i++) {
        const off = 16 + i * entrySize;
        chunkOffsets.push(isCo64 ? Number(offDv.getBigUint64(off)) : offDv.getUint32(off));
    }

    // 解析 sample 大小表
    const stszDv = new DataView(stsz);
    const uniformSize = stszDv.getUint32(12);
    const totalSamples = stszDv.getUint32(16);
    const sampleSizes: number[] = [];
    if (uniformSize > 0) {
        for (let i = 0; i < totalSamples; i++) sampleSizes.push(uniformSize);
    } else {
        for (let i = 0; i < totalSamples; i++) sampleSizes.push(stszDv.getUint32(20 + i * 4));
    }

    // 解析 stsc
    const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = [];
    if (stsc) {
        const stscDv = new DataView(stsc);
        const stscCount = stscDv.getUint32(12);
        for (let i = 0; i < stscCount; i++) {
            const off = 16 + i * 12;
            stscEntries.push({
                firstChunk: stscDv.getUint32(off),
                samplesPerChunk: stscDv.getUint32(off + 4),
            });
        }
    } else {
        // 无 stsc 时默认每 chunk 1 个 sample
        stscEntries.push({ firstChunk: 1, samplesPerChunk: 1 });
    }

    return { chunkOffsets, sampleSizes, stsc: stscEntries, totalSamples };
}

/** 根据样本号获取其在原始文件中的字节偏移（若超出范围返回 null） */
export function getSampleByteOffset(index: SampleIndex, sampleNum: number): number | null {
    if (sampleNum < 0 || sampleNum >= index.totalSamples) return null;

    const { stsc, chunkOffsets, sampleSizes } = index;
    let sampleCursor = 0;

    for (let c = 0; c < chunkOffsets.length; c++) {
        const chunkNum = c + 1; // MP4 chunk 编号从 1 开始
        // 查找本 chunk 对应的 samplesPerChunk
        let spc = stsc[0].samplesPerChunk;
        for (const entry of stsc) {
            if (entry.firstChunk <= chunkNum) spc = entry.samplesPerChunk;
        }

        if (sampleNum < sampleCursor + spc) {
            // 目标样本在本 chunk 内
            let intraOffset = 0;
            for (let s = sampleCursor; s < sampleNum; s++) {
                intraOffset += sampleSizes[s] || 0;
            }
            return chunkOffsets[c] + intraOffset;
        }
        sampleCursor += spc;
    }

    return null;
}

/** 计算覆盖样本 0 → targetSample 所需的精确字节范围
 *
 *  遍历所有 chunk 从 0 到包含 targetSample 的 chunk，
 *  取最大 (chunkOffset + chunkDataSize) 作为 requiredEnd，
 *  确保所有中间 chunk 均完整包含在内。 */
export function getByteRangeForSamples(
    index: SampleIndex,
    targetSample: number,
): { offset: number; size: number } | null {
    if (targetSample < 0 || targetSample >= index.totalSamples) return null;

    const { stsc, chunkOffsets, sampleSizes } = index;
    const firstOffset = chunkOffsets[0];
    let sampleCursor = 0;
    let maxEnd = 0;

    for (let c = 0; c < chunkOffsets.length; c++) {
        const chunkNum = c + 1;
        let spc = stsc[0].samplesPerChunk;
        for (const entry of stsc) {
            if (entry.firstChunk <= chunkNum) spc = entry.samplesPerChunk;
        }

        // 统计本 chunk 数据总大小
        let chunkDataSize = 0;
        for (let s = sampleCursor; s < sampleCursor + spc && s < sampleSizes.length; s++) {
            chunkDataSize += sampleSizes[s] || 0;
        }
        const chunkEnd = chunkOffsets[c] + chunkDataSize;
        if (chunkEnd > maxEnd) maxEnd = chunkEnd;

        if (targetSample < sampleCursor + spc) {
            // 已覆盖到目标样本所在 chunk，返回累积的最大范围
            return { offset: firstOffset, size: maxEnd - firstOffset };
        }
        sampleCursor += spc;
    }

    return null;
}

// ── 公开 API ──

/** 从 moov atom 的完整数据中解析首个视频帧的字节偏移和大小 */
export function parseFirstVideoFrame(
    moovBuffer: ArrayBuffer,
): { offset: number; size: number } | null {
    const log = createLogger('mp4');
    // 遍历 moov 下的所有 trak
    let pos = 8; // 跳过 moov 自身的头部
    let trakCount = 0;
    while (pos + 8 <= moovBuffer.byteLength) {
        const h = readAtomHeader(moovBuffer, pos);
        if (!h) break;
        if (h.type === 'trak') {
            trakCount++;
            log(`找到 trak #${trakCount}`);
            const trakData = moovBuffer.slice(h.dataStart, h.dataEnd);
            const stbl = extractVideoStbl(trakData);
            if (stbl) {
                log('找到视频轨道 stbl');
                const result = parseStbl(stbl);
                if (result) {
                    log(`首帧解析成功: offset=${result.offset}, size=${result.size}`);
                    return result;
                }
                log('parseStbl 返回 null');
            }
        }
        pos = h.dataEnd;
    }
    log(`未找到视频轨道 (共 ${trakCount} 个 trak)`);
    return null;
}
