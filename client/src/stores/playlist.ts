import { create } from 'zustand';
import type { Media } from '../types';
import { DEBOUNCE_MS, STORAGE_PREFIX } from '../config';

const STORAGE_KEY = STORAGE_PREFIX + 'playlist';

/** 旧版单一切换模式（兼容 localStorage 迁移用） */
type LegacyPlayMode = 'list' | 'loop' | 'shuffle' | 'repeatOne' | 'manual';
/** 循环控制（与播放列表推进方式独立） */
export type LoopMode = 'off' | 'repeatOne' | 'repeatAll';
/** 播放列表推进方式（与循环控制独立） */
export type PlayOrder = 'sequential' | 'shuffle' | 'manual';

// 不限制播单最大条数（由虚拟滚动保证渲染性能）

/**
 * 保存前过滤掉 Media 中的大字段，避免 localStorage 超限导致浏览器卡死。
 * 只保留播单侧边栏渲染所需的最小字段集。
 */
function sanitizeForStorage(media: Media): Media {
    return {
        id: media.id,
        title: media.title,
        duration: media.duration,
        mimeType: media.mimeType
    } as Media;
}

// 节流保存，避免频繁序列化大数组
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        doSave();
    }, DEBOUNCE_MS);
}

function doSave() {
    try {
        const { queue, currentIndex, loopMode, playOrder } = usePlaylistStore.getState();
        const lightQueue = queue.map(sanitizeForStorage);
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ queue: lightQueue, index: currentIndex, loopMode, playOrder })
        );
    } catch {
        /* */
    }
}

interface SavedPlaylist {
    queue: Media[];
    index: number;
    loopMode: LoopMode;
    playOrder: PlayOrder;
}

/** 旧版单一 playMode → 新双配置的迁移映射 */
const LEGACY_MODE_MAP: Record<LegacyPlayMode, Pick<SavedPlaylist, 'loopMode' | 'playOrder'>> = {
    list: { loopMode: 'off', playOrder: 'sequential' },
    loop: { loopMode: 'repeatAll', playOrder: 'sequential' },
    shuffle: { loopMode: 'off', playOrder: 'shuffle' },
    repeatOne: { loopMode: 'repeatOne', playOrder: 'sequential' },
    manual: { loopMode: 'off', playOrder: 'manual' }
};

function load(): SavedPlaylist | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // 兼容旧版本：单一 playMode 字段迁移到独立的 loopMode + playOrder
        if (typeof parsed.playMode === 'string' && parsed.playMode in LEGACY_MODE_MAP) {
            return {
                queue: parsed.queue ?? [],
                index: parsed.index ?? -1,
                ...LEGACY_MODE_MAP[parsed.playMode as LegacyPlayMode]
            };
        }
        return {
            queue: parsed.queue ?? [],
            index: parsed.index ?? -1,
            loopMode: parsed.loopMode ?? 'off',
            playOrder: parsed.playOrder ?? 'sequential'
        };
    } catch {
        return null;
    }
}

const saved = load();

/** Fisher-Yates 洗牌：返回 0..n-1 的随机排列（随机播放的打乱序列） */
function makeShuffleOrder(n: number): number[] {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

interface PlaylistState {
    queue: Media[];
    currentIndex: number;
    loopMode: LoopMode;
    playOrder: PlayOrder;
    /** 随机模式下的打乱序列：原始 queue 索引的随机排列（仅内存，不持久化，避免 localStorage 膨胀） */
    shuffleOrder: number[];
    total: number;
    position: number;
    hasNext: boolean;
    hasPrev: boolean;
    current: Media | null;
    playAll(list: Media[], startIndex?: number): void;
    append(list: Media[]): void;
    removeById(id: string): string | null;
    clear(): void;
    setLoopMode(mode: LoopMode): void;
    setPlayOrder(order: PlayOrder): void;
    /** 内部：重新洗牌（一轮走完时调用），确保新序列首位 ≠ 当前项，返回新序列 */
    _reshuffle(): number[];
    /** 自动推进（播放结束）的下一项索引 */
    getNextIndex(): number;
    /** 按钮「下一个」专用：手动环形 / 单曲循环取序列下一项不重复自身 / 其余同 getNextIndex */
    getManualNext(): number;
    /** 按钮「上一个」：手动/随机取打乱序列上一项 / 顺序线性（repeatAll 首项回绕到末项） */
    getPrevIndex(): number;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
    queue: saved?.queue ?? [],
    currentIndex: saved?.index ?? -1,
    loopMode: saved?.loopMode ?? 'off',
    playOrder: saved?.playOrder ?? 'sequential',
    // 初始即生成打乱序列（切到随机时可直接使用）
    shuffleOrder: makeShuffleOrder(saved?.queue?.length ?? 0),

    get current() {
        const { queue, currentIndex } = get();
        return currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
    },
    get total() {
        return get().queue.length;
    },
    get position() {
        const i = get().currentIndex;
        return i >= 0 ? i + 1 : 0;
    },
    get hasNext() {
        const { queue, currentIndex, loopMode, playOrder } = get();
        if (queue.length <= 1) return false;
        // 手动：可手动切歌
        if (playOrder === 'manual') return true;
        // 随机：序列内推进或一轮走完重洗，总有下一项
        if (playOrder === 'shuffle') return true;
        // 顺序：单曲循环末位无下一项；列表循环总有；off 末位无
        if (loopMode === 'repeatOne') return currentIndex < queue.length - 1;
        if (loopMode === 'repeatAll') return true;
        return currentIndex < queue.length - 1;
    },
    get hasPrev() {
        const { queue, currentIndex, loopMode, playOrder, shuffleOrder } = get();
        if (queue.length <= 1) return false;
        // 手动：环形
        if (playOrder === 'manual') return true;
        // 随机：序列前一项；序列首位仅 repeatAll 回绕
        if (playOrder === 'shuffle') {
            const pos = shuffleOrder.indexOf(currentIndex);
            return pos > 0 || (pos === 0 && loopMode === 'repeatAll');
        }
        // 顺序：非首项有上一项；首项仅 repeatAll 回绕
        return currentIndex > 0 || loopMode === 'repeatAll';
    },

    playAll: (list, startIndex = 0) => {
        set({ queue: list, currentIndex: startIndex, shuffleOrder: makeShuffleOrder(list.length) });
        scheduleSave();
    },

    append: (list) => {
        const { queue, shuffleOrder } = get();
        const newQueue = [...queue, ...list];
        const start = queue.length;
        // 已有打乱顺序保持稳定，新索引追加到末尾
        const newOrder = [...shuffleOrder, ...Array.from({ length: list.length }, (_, i) => start + i)];
        set({ queue: newQueue, shuffleOrder: newOrder });
        scheduleSave();
    },

    removeById: (id) => {
        const { queue, currentIndex } = get();
        const idx = queue.findIndex((m) => m.id === id);
        if (idx === -1) return null;
        const newQueue = queue.filter((_, i) => i !== idx);
        let newIndex = currentIndex;
        if (idx < currentIndex) newIndex--;
        else if (idx === currentIndex) {
            newIndex = idx < newQueue.length ? idx : newQueue.length - 1;
        }
        // 移除后重建打乱序列，避免索引漂移
        set({ queue: newQueue, currentIndex: newIndex, shuffleOrder: makeShuffleOrder(newQueue.length) });
        scheduleSave();
        return newQueue[newIndex]?.id ?? null;
    },

    clear: () => {
        set({ queue: [], currentIndex: -1, shuffleOrder: [] });
        doSave(); // 同步保存，避免 navigate 页面卸载后 debounce 未触发
    },

    setLoopMode: (mode) => {
        set({ loopMode: mode });
        scheduleSave();
    },

    setPlayOrder: (order) => {
        const { queue, shuffleOrder } = get();
        // 切到随机时确保打乱序列与队列长度匹配（队列变更后可能已失效）
        const nextOrder = order === 'shuffle' && shuffleOrder.length !== queue.length
            ? makeShuffleOrder(queue.length)
            : shuffleOrder;
        set({ playOrder: order, shuffleOrder: nextOrder });
        scheduleSave();
    },

    _reshuffle: () => {
        const { queue, currentIndex } = get();
        const n = queue.length;
        if (n <= 1) return [];
        let order = makeShuffleOrder(n);
        // 新序列首位 ≠ 当前项（避免刚播完立即重播）
        if (order[0] === currentIndex) {
            [order[0], order[1]] = [order[1], order[0]];
        }
        set({ shuffleOrder: order });
        return order;
    },

    getNextIndex: () => {
        const { queue, currentIndex, loopMode, playOrder, shuffleOrder } = get();
        if (queue.length === 0) return -1;
        // 单曲循环：始终重播当前（含手动模式——重播当前不违反"不自动切歌"）
        if (loopMode === 'repeatOne') return currentIndex;
        // 手动：不自动切歌（repeatAll/off 均不推进）
        if (playOrder === 'manual') return -1;
        // 随机：按打乱序列推进；一轮走完（序列末位）→ 重新洗牌 → 新序列第一项
        if (playOrder === 'shuffle') {
            if (queue.length === 1) {
                return loopMode === 'repeatAll' ? currentIndex : -1;
            }
            const pos = shuffleOrder.indexOf(currentIndex);
            if (pos >= 0 && pos + 1 < shuffleOrder.length) return shuffleOrder[pos + 1];
            // 序列末位：一轮走完 → 重新洗牌（off / repeatAll 都重洗继续）
            const order = get()._reshuffle();
            return order[0];
        }
        // 顺序推进
        if (currentIndex < queue.length - 1) return currentIndex + 1;
        return loopMode === 'repeatAll' ? 0 : -1;
    },

    getManualNext: () => {
        const { queue, currentIndex, loopMode, playOrder, shuffleOrder } = get();
        if (queue.length === 0) return -1;
        // 手动：始终环形推进到下一项
        if (playOrder === 'manual') return (currentIndex + 1) % queue.length;
        // 单曲循环：按钮「下一个」不重复自身 → 打乱/线性序列的下一项
        if (loopMode === 'repeatOne') {
            if (playOrder === 'shuffle') {
                const pos = shuffleOrder.indexOf(currentIndex);
                if (pos >= 0 && pos + 1 < shuffleOrder.length) return shuffleOrder[pos + 1];
                // 单曲队列：无下一项（不重洗）
                if (queue.length <= 1) return -1;
                // 序列末位 + 单曲循环：重洗继续
                const order = get()._reshuffle();
                return order[0];
            }
            return currentIndex < queue.length - 1 ? currentIndex + 1 : -1;
        }
        // 其余（off/repeatAll × sequential/shuffle）：与自动推进一致
        return get().getNextIndex();
    },

    getPrevIndex: () => {
        const { queue, currentIndex, loopMode, playOrder, shuffleOrder } = get();
        if (queue.length === 0) return -1;
        // 手动：始终环形回退到上一项
        if (playOrder === 'manual') return currentIndex === 0 ? queue.length - 1 : currentIndex - 1;
        // 随机：打乱序列的上一项（真正回到上一个；序列首位仅 repeatAll 回绕到末位）
        if (playOrder === 'shuffle') {
            if (queue.length === 1) return -1;
            const pos = shuffleOrder.indexOf(currentIndex);
            if (pos > 0) return shuffleOrder[pos - 1];
            if (pos === 0) return loopMode === 'repeatAll' ? shuffleOrder[shuffleOrder.length - 1] : -1;
            return -1;
        }
        // 顺序：线性上一项，首项 repeatAll 回绕到末项
        if (currentIndex > 0) return currentIndex - 1;
        return loopMode === 'repeatAll' ? queue.length - 1 : -1;
    }
}));
