// ---------------------------------------------------------------------------
// 持久化存储申请 —— 确保缩略图缓存不被浏览器清理
// ---------------------------------------------------------------------------

/** 申请持久化存储权限，仅在需要时调用一次 */
export async function requestPersistentStorage(): Promise<boolean> {
    // 不支持 persist API 的环境直接返回
    if (!navigator.storage?.persist) return false;

    try {
        // 先检查是否已经持久化
        const alreadyPersisted = await navigator.storage.persisted();
        if (alreadyPersisted) return true;

        // 申请持久化
        const granted = await navigator.storage.persist();
        return granted;
    } catch {
        return false;
    }
}
