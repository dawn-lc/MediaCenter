import { create } from 'zustand';
import type { Media } from '../types';
import { DEBOUNCE_MS, STORAGE_PREFIX } from '../config';

const STORAGE_KEY = STORAGE_PREFIX + 'playlist';

export type PlayMode = 'list' | 'loop' | 'shuffle' | 'repeatOne' | 'manual';

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
        const { queue, currentIndex, playMode } = usePlaylistStore.getState();
        const lightQueue = queue.map(sanitizeForStorage);
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ queue: lightQueue, index: currentIndex, playMode })
        );
    } catch {
        /* */
    }
}

function load(): {
    queue: Media[];
    index: number;
    playMode: PlayMode;
} | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

const saved = load();

interface PlaylistState {
    queue: Media[];
    currentIndex: number;
    playMode: PlayMode;
    total: number;
    position: number;
    hasNext: boolean;
    hasPrev: boolean;
    current: Media | null;
    playAll(list: Media[], startIndex?: number): void;
    append(list: Media[]): void;
    removeById(id: string): string | null;
    clear(): void;
    setPlayMode(mode: PlayMode): void;
    getNextIndex(): number;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
    queue: saved?.queue ?? [],
    currentIndex: saved?.index ?? -1,
    playMode: saved?.playMode ?? 'list',

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
        const { queue, currentIndex, playMode } = get();
        if (queue.length === 0) return false;
        if (playMode === 'loop' || playMode === 'repeatOne' || playMode === 'shuffle' || playMode === 'manual') return true;
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

    setPlayMode: (mode) => {
        set({ playMode: mode });
        scheduleSave();
    },

    getNextIndex: () => {
        const { queue, currentIndex, playMode } = get();
        if (queue.length === 0) return -1;
        if (playMode === 'manual') return -1;
        if (playMode === 'repeatOne') return currentIndex;
        if (playMode === 'shuffle') {
            if (queue.length === 1) return currentIndex;
            let next: number;
            do {
                next = Math.floor(Math.random() * queue.length);
            } while (next === currentIndex);
            return next;
        }
        if (playMode === 'loop') {
            return (currentIndex + 1) % queue.length;
        }
        // list 模式
        if (currentIndex < queue.length - 1) return currentIndex + 1;
        return -1;
    }
}));
