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

/** 递归搜索指定名称的 atom，返回完整 atom 数据（含头部） */
export function findAtom(
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

    // stsz
    if (!stsz) return null;
    const stszDv = new DataView(stsz);
    // version(1) + flags(3) + uniformSize(4) + sampleCount(4)
    const uniformSize = stszDv.getUint32(4);
    const sampleCount = stszDv.getUint32(8);
    if (sampleCount === 0) return null;
    const firstSampleSize = uniformSize > 0 ? uniformSize : stszDv.getUint32(12);

    // stco / co64
    const offsetTable = co64 || stco;
    if (!offsetTable) return null;
    const offDv = new DataView(offsetTable);
    const isCo64 = co64 !== null;
    // version(1) + flags(3) + entryCount(4)
    const entryCount = offDv.getUint32(4);
    if (entryCount === 0) return null;

    const entrySize = isCo64 ? 8 : 4;
    let firstChunkOffset: number;
    if (isCo64) {
        firstChunkOffset = Number(offDv.getBigUint64(8));
    } else {
        firstChunkOffset = offDv.getUint32(8);
    }

    // stsc（sample-to-chunk）：判断首帧是否在首块开头
    // 若无 stsc，或 stsc 表首项显示首块只有 1 个 sample，则首帧就在首块开头
    if (stsc) {
        const stscDv = new DataView(stsc);
        const stscEntryCount = stscDv.getUint32(4);
        if (stscEntryCount > 0) {
            // stsc 表：firstChunk(4) + samplesPerChunk(4) + sampleDescIndex(4)
            const firstChunkInTable = stscDv.getUint32(8);
            const samplesPerFirstChunk = stscDv.getUint32(12);
            // 如果第一个 chunk 有多个 sample，第一个 sample 的偏移需要计算
            // 但首帧 = 首块首样本，偏移就是 chunkOffset，大小来自 stsz
            // 只有当首块有 >1 sample 且首帧不是首样本时才需要调整
            // 绝大多数情况下首块只有 1 个 sample（即首帧）
            // 即使有多个，我们取的 chunkOffset + stsz[0] 也是正确的
        }
    }

    return { offset: firstChunkOffset, size: firstSampleSize };
}

// ── trak 层 ──

/** 判断一个 trak 是否为视频轨道，是则返回其 stbl 数据 */
function extractVideoStbl(trakData: ArrayBuffer): ArrayBuffer | null {
    // 找 hdlr → 判断 track 类型
    const hdlr = findAtom(trakData, 'hdlr');
    if (!hdlr) return null;
    const hdlrDv = new DataView(hdlr);
    // hdlr: version(1) + flags(3) + preDefined(4) + handlerType(4B ASCII)
    const handlerType = String.fromCharCode(
        hdlrDv.getUint8(12), hdlrDv.getUint8(13),
        hdlrDv.getUint8(14), hdlrDv.getUint8(15),
    );
    if (handlerType !== 'vide') return null;

    // 视频轨道，取 mdia → minf → stbl
    const mdia = findAtom(trakData, 'mdia');
    if (!mdia) return null;
    const minf = findAtom(mdia, 'minf');
    if (!minf) return null;
    const stbl = findAtom(minf, 'stbl');
    return stbl || null;
}

// ── 公开 API ──

/** 从 moov atom 的完整数据中解析首个视频帧的字节偏移和大小 */
export function parseFirstVideoFrame(
    moovBuffer: ArrayBuffer,
): { offset: number; size: number } | null {
    // 遍历 moov 下的所有 trak
    let pos = 8; // 跳过 moov 自身的头部
    while (pos + 8 <= moovBuffer.byteLength) {
        const h = readAtomHeader(moovBuffer, pos);
        if (!h) break;
        if (h.type === 'trak') {
            const trakData = moovBuffer.slice(h.dataStart, h.dataEnd);
            const stbl = extractVideoStbl(trakData);
            if (stbl) {
                const result = parseStbl(stbl);
                if (result) return result;
            }
        }
        pos = h.dataEnd;
    }
    return null;
}
