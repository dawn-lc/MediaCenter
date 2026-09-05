/**
 * 播放列表持久化（分级存储）
 * - 元数据（index/loopMode/playOrder）：localStorage —— 轻量小字段，同步读取、首帧即可恢复播放模式
 * - 队列 queue：按长度灵活选择 —— 小队列（≤ LS_QUEUE_LIMIT 项）存 localStorage（简单同步、无 IndexedDB 依赖）；
 *   大队列存 IndexedDB（容量远超 localStorage 5MB，12 万+ 项无压力）
 * 结构：mediacenter 数据库 / playlist 存储 / 'state' 键（仅大队列队列）
 */
import type { LoopMode, PlayOrder } from '../stores/playlist';
import { STORAGE_PREFIX } from '../config';

const DB_NAME = 'mediacenter';
const DB_VERSION = 1;
const STORE_NAME = 'playlist';
const KEY = 'state';

// localStorage 键
const META_KEY = STORAGE_PREFIX + 'playlist_meta';
const QUEUE_LS_KEY = STORAGE_PREFIX + 'playlist_queue';

/** 队列长度阈值：超过则用 IndexedDB 存储（localStorage 5MB 上限的安全余量） */
const LS_QUEUE_LIMIT = 4096;

/** 持久化的播放列表元数据（小字段走 localStorage） */
export interface IdbPlaylistMeta {
    index: number;
    loopMode: LoopMode;
    playOrder: PlayOrder;
}

/** 持久化的播放列表状态（queue 仅存侧边栏渲染最小字段） */
export interface IdbPlaylistState {
    queue: { id: string; title: string; duration: number | null; mimeType: string }[];
    index: number;
    loopMode: LoopMode;
    playOrder: PlayOrder;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            dbPromise = null;
            reject(new Error('IndexedDB 不可用'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            dbPromise = null;
            reject(req.error);
        };
    });
    return dbPromise;
}

// ---------- 元数据：localStorage ----------

/** 同步读取播放列表元数据（小字段，供首帧恢复播放模式） */
export function idbLoadPlaylistMeta(): IdbPlaylistMeta | null {
    try {
        const raw = localStorage.getItem(META_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.index !== 'number') return null;
        return {
            index: parsed.index,
            loopMode: parsed.loopMode ?? 'off',
            playOrder: parsed.playOrder ?? 'sequential'
        };
    } catch {
        return null;
    }
}

function saveMeta(meta: IdbPlaylistMeta): void {
    try {
        localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
        /* 静默 */
    }
}

function clearMeta(): void {
    try { localStorage.removeItem(META_KEY); } catch { /* */ }
}

// ---------- 队列：localStorage（小队列） ----------

function loadQueueFromLS(): IdbPlaylistState['queue'] | null {
    try {
        const raw = localStorage.getItem(QUEUE_LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** 同步读取 localStorage 里的小队列（≤ LS_QUEUE_LIMIT 项），供 store 首帧恢复（避免异步竞态） */
export function idbLoadPlaylistQueueSync(): IdbPlaylistState['queue'] | null {
    return loadQueueFromLS();
}

function saveQueueToLS(queue: IdbPlaylistState['queue']): void {
    try {
        localStorage.setItem(QUEUE_LS_KEY, JSON.stringify(queue));
    } catch {
        /* 静默 */
    }
}

function clearQueueFromLS(): void {
    try { localStorage.removeItem(QUEUE_LS_KEY); } catch { /* */ }
}

// ---------- 队列：IndexedDB（大队列） ----------

async function loadQueueFromIDB(): Promise<IdbPlaylistState | null> {
    try {
        const db = await openDB();
        return await new Promise<IdbPlaylistState | null>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(KEY);
            req.onsuccess = () => resolve((req.result as IdbPlaylistState) ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function saveQueueToIDB(state: IdbPlaylistState): Promise<void> {
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(state, KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        /* 静默 */
    }
}

async function clearQueueFromIDB(): Promise<void> {
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        /* 静默 */
    }
}

// ---------- 对外接口 ----------

/**
 * 读取持久化的播放列表，无数据返回 null。
 * 小队列从 localStorage 读；大队列 / 旧格式数据从 IndexedDB 读，并迁移到分级存储。
 */
export async function idbLoadPlaylist(): Promise<IdbPlaylistState | null> {
    const meta = idbLoadPlaylistMeta();
    const lsQueue = loadQueueFromLS();
    if (meta && lsQueue) {
        return { queue: lsQueue, index: meta.index, loopMode: meta.loopMode, playOrder: meta.playOrder };
    }
    // 大队列 / 旧格式（完整 state 存 IndexedDB）
    const idb = await loadQueueFromIDB();
    if (!idb) return null;
    const effectiveMeta = meta ?? { index: idb.index, loopMode: idb.loopMode, playOrder: idb.playOrder };
    if (!meta) saveMeta(effectiveMeta); // 回填元数据到 localStorage
    if (idb.queue.length <= LS_QUEUE_LIMIT) {
        // 旧数据里的小队列 → 迁移到 localStorage
        saveQueueToLS(idb.queue);
        await clearQueueFromIDB();
    }
    return { queue: idb.queue, index: effectiveMeta.index, loopMode: effectiveMeta.loopMode, playOrder: effectiveMeta.playOrder };
}

/** 保存播放列表状态：元数据走 localStorage，队列按长度灵活选择存储；不可用时静默 */
export async function idbSavePlaylist(state: IdbPlaylistState): Promise<void> {
    // 元数据（小字段）总是走 localStorage
    saveMeta({ index: state.index, loopMode: state.loopMode, playOrder: state.playOrder });
    if (state.queue.length <= LS_QUEUE_LIMIT) {
        // 小队列：localStorage，并清理旧的大队列 IDB 数据
        saveQueueToLS(state.queue);
        await clearQueueFromIDB();
    } else {
        // 大队列：IndexedDB，并清理旧的 localStorage 队列
        clearQueueFromLS();
        await saveQueueToIDB(state);
    }
}

/** 清空播放列表持久化数据 */
export async function idbClearPlaylist(): Promise<void> {
    clearMeta();
    clearQueueFromLS();
    await clearQueueFromIDB();
}
