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

interface PlaylistState {
    queue: Media[];
    currentIndex: number;
    loopMode: LoopMode;
    playOrder: PlayOrder;
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
    getNextIndex(): number;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
    queue: saved?.queue ?? [],
    currentIndex: saved?.index ?? -1,
    loopMode: saved?.loopMode ?? 'off',
    playOrder: saved?.playOrder ?? 'sequential',

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
        if (queue.length === 0) return false;
        if (playOrder === 'manual') return true;              // 手动：可手动切歌
        if (loopMode === 'repeatOne') return true;            // 单曲循环
        if (playOrder === 'shuffle') return queue.length > 1 || loopMode === 'repeatAll';
        if (loopMode === 'repeatAll') return true;            // 列表循环
        return currentIndex < queue.length - 1;
    },
    get hasPrev() {
        return get().currentIndex > 0;
    },

    playAll: (list, startIndex = 0) => {
        set({ queue: list, currentIndex: startIndex });
        scheduleSave();
    },

    append: (list) => {
        const { queue } = get();
        const newQueue = [...queue, ...list];
        set({ queue: newQueue });
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
        set({ queue: newQueue, currentIndex: newIndex });
        scheduleSave();
        return newQueue[newIndex]?.id ?? null;
    },

    clear: () => {
        set({ queue: [], currentIndex: -1 });
        doSave(); // 同步保存，避免 navigate 页面卸载后 debounce 未触发
    },

    setLoopMode: (mode) => {
        set({ loopMode: mode });
        scheduleSave();
    },

    setPlayOrder: (order) => {
        set({ playOrder: order });
        scheduleSave();
    },

    getNextIndex: () => {
        const { queue, currentIndex, loopMode, playOrder } = get();
        if (queue.length === 0) return -1;
        // 手动：不自动推进（循环控制也不生效）
        if (playOrder === 'manual') return -1;
        // 单曲循环：始终重播当前
        if (loopMode === 'repeatOne') return currentIndex;
        // 随机推进
        if (playOrder === 'shuffle') {
            if (queue.length === 1) {
                return loopMode === 'repeatAll' ? currentIndex : -1;
            }
            let next: number;
            do {
                next = Math.floor(Math.random() * queue.length);
            } while (next === currentIndex);
            return next;
        }
        // 顺序推进
        if (currentIndex < queue.length - 1) return currentIndex + 1;
        return loopMode === 'repeatAll' ? 0 : -1;
    }
}));
