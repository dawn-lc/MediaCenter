import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface AdminTableStateOptions {
    /** 默认排序列 */
    defaultSortBy: string;
    /** 默认排序方向 */
    defaultSortOrder: 'asc' | 'desc';
    /** 新排序列默认降序的键（如 mediaCount），其余新列默认升序 */
    newColumnDescKeys?: string[];
}

export interface AdminTableState {
    page: number;
    search: string;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
}

interface AdminTableStateApi extends AdminTableState {
    /** 搜索词变化（自动重置到第一页） */
    setSearch(value: string): void;
    /** 表头排序：同列切换方向，新列按配置默认方向，自动重置到第一页 */
    setSort(key: string): void;
    /** 翻页 */
    setPage(p: number): void;
}

/** 解析 URL 参数 → 状态（缺失回退默认值） */
function parseParams(params: URLSearchParams, o: AdminTableStateOptions): AdminTableState {
    const raw = params.get('sort') || '';
    const [field, dir] = raw.split(':');
    return {
        search: params.get('search') || '',
        page: Math.max(1, parseInt(params.get('page') || '1', 10) || 1),
        sortBy: field || o.defaultSortBy,
        sortOrder: dir === 'asc' || dir === 'desc' ? (dir as 'asc' | 'desc') : o.defaultSortOrder
    };
}

/** 状态 → URL 参数（空值/默认值自动删除，保持 URL 干净） */
function buildParams(base: URLSearchParams, s: AdminTableState, o: AdminTableStateOptions): URLSearchParams {
    const next = new URLSearchParams(base);
    const setOrDel = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
    setOrDel('search', s.search);
    setOrDel('page', s.page > 1 ? String(s.page) : '');
    const sortChanged = s.sortBy !== o.defaultSortBy || s.sortOrder !== o.defaultSortOrder;
    setOrDel('sort', sortChanged ? `${s.sortBy}:${s.sortOrder}` : '');
    return next;
}

/**
 * 管理表格的 URL 同步状态（搜索/排序/分页）
 * - 状态以 URL query 参数持久化（?search=&sort=&page=），跳转出去再返回 / 刷新 / 分享链接时从 URL 恢复
 * - 状态变化用 replace 写回 URL（不产生额外历史记录，管理页内部无需前进/后退）
 * - 同时监听 URL 反向同步 state（浏览器后退/前进、地址栏修改时保持一致）
 */
export function useAdminTableState(o: AdminTableStateOptions): AdminTableStateApi {
    const [searchParams, setSearchParams] = useSearchParams();
    // 默认值固定引用（挂载时固化，避免 options 对象每次渲染变化）
    const optsRef = useRef(o);

    // 仅首次挂载解析 URL 作为初始状态（后退返回 / 刷新时恢复）
    const [state, setState] = useState<AdminTableState>(() => parseParams(searchParams, optsRef.current));

    // 状态变化 → 写回 URL（replace，不产生历史）
    useEffect(() => {
        const next = buildParams(searchParams, state, optsRef.current);
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    // URL 变化 → 反向同步 state（浏览器前进/后退、地址栏修改且组件复用等场景）
    const skipUrlSync = useRef(true);
    useEffect(() => {
        if (skipUrlSync.current) {
            skipUrlSync.current = false;
            return;
        }
        const parsed = parseParams(searchParams, optsRef.current);
        setState((prev) =>
            prev.page === parsed.page &&
                prev.search === parsed.search &&
                prev.sortBy === parsed.sortBy &&
                prev.sortOrder === parsed.sortOrder
                ? prev
                : parsed
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const setSearch = (value: string) => setState((prev) => ({ ...prev, search: value, page: 1 }));

    const setSort = (key: string) =>
        setState((prev) => {
            const descOnNew = (optsRef.current.newColumnDescKeys || []).includes(key);
            const sortOrder: 'asc' | 'desc' =
                prev.sortBy === key ? (prev.sortOrder === 'asc' ? 'desc' : 'asc') : descOnNew ? 'desc' : 'asc';
            return { ...prev, sortBy: key, sortOrder, page: 1 };
        });

    const setPage = (p: number) => setState((prev) => ({ ...prev, page: p }));

    return { ...state, setSearch, setSort, setPage };
}
