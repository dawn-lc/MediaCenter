/**
 * 语义搜索排名缓存
 *
 * 关联性排序的昂贵计算（外部嵌入 API + 全库向量扫描 + RRF 融合）与翻页无关：
 * 同一查询翻页只差 offset 切片。缓存全量排名结果，翻页直接切片复用。
 *
 * - 键：查询 + 全部筛选参数 + 用户可见性（role/id）
 * - 失效：任何媒体写操作调用 invalidateSearchCache() 整体清空（搜索口径/候选集变化）
 * - TTL 兜底：保证极端情况下最终一致
 */
const store = new Map<string, { at: number; data: unknown }>();
const TTL_MS = 5 * 60_000; // 5 分钟
const MAX_ENTRIES = 200;

export function searchCacheGet<T>(key: string): T | null {
    const hit = store.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > TTL_MS) {
        store.delete(key);
        return null;
    }
    return hit.data as T;
}

export function searchCacheSet(key: string, data: unknown): void {
    if (store.size >= MAX_ENTRIES) {
        // 简单淘汰：删除最旧的 1/4，避免无限增长
        const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
        const toRemove = Math.ceil(MAX_ENTRIES / 4);
        for (let i = 0; i < toRemove && i < oldest.length; i++) store.delete(oldest[i][0]);
    }
    store.set(key, { at: Date.now(), data });
}

/** 媒体数据变化时整体失效（任何写入都会改变搜索候选集/排名） */
export function invalidateSearchCache(): void {
    store.clear();
}
