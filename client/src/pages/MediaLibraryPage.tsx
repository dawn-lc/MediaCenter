import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import type { Media } from '../types';
import { notify } from '../utils/notify';
import { useQuery } from '@tanstack/react-query';
import { getTagGroupMap } from '../utils';
import { useAuthStore } from '../stores/auth';
import { usePlaylistStore } from '../stores/playlist';
import TagList from '../components/list/TagList';
import MediaCard from '../components/list/MediaCard';
import Pagination from '../components/list/Pagination';
import LoadingState from '../components/feedback/LoadingState';
import EmptyState from '../components/feedback/EmptyState';

import { HOME_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_ORDER, STORAGE_PREFIX, TAG_EXPR_MAX_LENGTH } from '../config';

/** 文本输入防抖自动搜索延迟（毫秒） */
const SEARCH_DEBOUNCE_MS = 500;

/** 全部筛选/搜索/排序/分页参数（URL 为唯一数据源，输入框值即 URL 参数值） */
interface QueryState {
    search: string;
    tagExpr: string;
    authorExpr: string;
    uploaderId: string;
    typeFilter: string;
    sortBy: string;
    sortOrder: string;
    page: number;
}

/** 从 URLSearchParams 解析所有参数（纯函数：缺失即默认值，不回退 localStorage） */
function parseUrlParams(params: URLSearchParams): QueryState {
    const raw = params.get('sort') || '';
    const [sortField, sortDir] = raw ? raw.split(':') : [];
    return {
        tagExpr: params.get('tags') || '',
        authorExpr: params.get('authorExpr') || '',
        uploaderId: params.get('uploaderId') || '',
        search: params.get('search') || '',
        typeFilter: params.get('type') || '',
        page: parseInt(params.get('page') || '1', 10) || 1,
        sortBy: sortField || DEFAULT_SORT_FIELD,
        sortOrder: sortDir || DEFAULT_SORT_ORDER,
    };
}

/** 将状态写入 URL 参数：空值/默认值自动删除，保持 URL 干净 */
function applyParamsToSearchParams(base: URLSearchParams, q: QueryState): URLSearchParams {
    const next = new URLSearchParams(base);
    const setOrDel = (k: string, v: string) => v ? next.set(k, v) : next.delete(k);
    setOrDel('tags', q.tagExpr);
    setOrDel('authorExpr', q.authorExpr);
    setOrDel('uploaderId', q.uploaderId);
    setOrDel('search', q.search);
    setOrDel('type', q.typeFilter);
    setOrDel('sort', q.sortBy !== DEFAULT_SORT_FIELD || q.sortOrder !== DEFAULT_SORT_ORDER ? `${q.sortBy}:${q.sortOrder}` : '');
    setOrDel('page', q.page > 1 ? String(q.page) : '');
    return next;
}

const STORAGE_KEY = STORAGE_PREFIX + 'home_state';

interface HomeState {
    search: string;
    typeFilter: string;
    tagExpr: string;
    authorExpr: string;
    uploaderId: string;
    sortBy: string;
    sortOrder: string;
    page: number;
}

function loadState(): Partial<HomeState> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {
        /* ignore */
    }
    return {};
}

function saveState(state: Partial<HomeState>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        /* ignore */
    }
}

export default function MediaLibraryPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { t } = useTranslation();
    const auth = useAuthStore();
    const playlist = usePlaylistStore();

    const [items, setItems] = useState<Media[]>([]);
    const saved = loadState();
    const urlParsed = parseUrlParams(searchParams);
    // 初始值：URL 参数优先，缺失时回退 localStorage 草稿（仅初始化用，之后 URL 为唯一数据源）
    const [page, setPage] = useState(urlParsed.page || saved.page || 1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState(urlParsed.search || saved.search || '');
    const [typeFilter, setTypeFilter] = useState(urlParsed.typeFilter || saved.typeFilter || '');
    const [tagExpr, setTagExpr] = useState(urlParsed.tagExpr || saved.tagExpr || '');
    const [authorExpr, setAuthorExpr] = useState(urlParsed.authorExpr || saved.authorExpr || '');
    const [uploaderId, setUploaderId] = useState(urlParsed.uploaderId || saved.uploaderId || '');
    const [sortBy, setSortBy] = useState(urlParsed.sortBy !== DEFAULT_SORT_FIELD ? urlParsed.sortBy : (saved.sortBy || DEFAULT_SORT_FIELD));
    const [sortOrder, setSortOrder] = useState(urlParsed.sortOrder !== DEFAULT_SORT_ORDER ? urlParsed.sortOrder : (saved.sortOrder || DEFAULT_SORT_ORDER));

    // 解析标签表达式分组，用于高亮不同筛选项
    const tagGroupMap = getTagGroupMap(tagExpr);

    const { data, isFetching, refetch } = useQuery({
        queryKey: ['media', page, typeFilter, sortBy, sortOrder, uploaderId, auth.isLoggedIn],
        // 立即重取依赖：分页/类型/排序/上传者；search/tagExpr/authorExpr 走下方防抖手动 refetch()
        // 登录态变化时媒体可见范围会变（guest 仅公开 / 登录可见 user+owner），需重取
        queryFn: () =>
            Api.listMedia({
                page,
                limit: HOME_PAGE_SIZE,
                type: typeFilter || undefined,
                search: search || undefined,
                tags: tagExpr || undefined,
                authorExpr: authorExpr || undefined,
                uploaderId: uploaderId || undefined,
                sortBy,
                sortOrder
            })
    });

    // 取数结果同步到页面状态
    useEffect(() => {
        if (!data) return;
        setItems(data.items || []);
        setTotalPages(data.pagination?.totalPages || 1);
    }, [data]);

    // 媒体变更推送（SSE）→ 自动刷新列表（防抖合并突发推送，如扫描/批量操作）
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onMediaUpdated = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { timer = null; void refetch(); }, 400);
        };
        window.addEventListener('mediacenter:media-updated', onMediaUpdated);
        return () => {
            window.removeEventListener('mediacenter:media-updated', onMediaUpdated);
            if (timer) clearTimeout(timer);
        };
    }, [refetch]);

    // 保存最新 page 引用，供防抖回调与立即搜索使用
    const pageRef = useRef(page);
    useEffect(() => { pageRef.current = page; }, [page]);

    // 用户操作 → URL（参照 iwara：直接写 URL 产生历史，由下方的 URL→state effect 回填状态，天然无回环竞态）
    const updateQuery = useCallback((patch: Partial<QueryState>) => {
        const merged: QueryState = { ...parseUrlParams(searchParams), ...patch };
        const next = applyParamsToSearchParams(searchParams, merged);
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: false });
        }
    }, [searchParams, setSearchParams]);

    // 挂载时一次性补全 URL：若 URL 缺参数而 localStorage 有草稿，replace 写回（不产生历史）
    const urlInitialized = useRef(false);
    useEffect(() => {
        if (urlInitialized.current) return;
        urlInitialized.current = true;
        const next = applyParamsToSearchParams(searchParams, {
            search, tagExpr, authorExpr, uploaderId, typeFilter, sortBy, sortOrder, page
        });
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 唯一反向同步：URL → state（前进后退、手动改地址栏、外部链接时响应；纯解析 URL，不回退 localStorage）
    const skipUrlSync = useRef(true);
    useEffect(() => {
        if (skipUrlSync.current) { skipUrlSync.current = false; return; }
        const p = parseUrlParams(searchParams);
        setSearch(p.search);
        setTypeFilter(p.typeFilter);
        setTagExpr(p.tagExpr);
        setAuthorExpr(p.authorExpr);
        setUploaderId(p.uploaderId);
        setSortBy(p.sortBy);
        setSortOrder(p.sortOrder);
        setPage(p.page);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // 分页/类型/排序/上传者变化由 useQuery 自动重取（含挂载首载）
    // 文本输入防抖自动搜索：search/tags/authorExpr 变化后延迟加载
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const firstTextRun = useRef(true);
    useEffect(() => {
        if (firstTextRun.current) { firstTextRun.current = false; return; }
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            searchTimerRef.current = null;
            if (pageRef.current !== 1) setPage(1);
            else void refetch();
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            if (searchTimerRef.current) { clearTimeout(searchTimerRef.current); searchTimerRef.current = null; }
        };
    }, [search, tagExpr, authorExpr]);

    // 立即搜索（Enter / 搜索按钮）：取消防抖计时器并马上加载
    const doSearch = useCallback(() => {
        if (searchTimerRef.current) { clearTimeout(searchTimerRef.current); searchTimerRef.current = null; }
        if (pageRef.current !== 1) setPage(1);
        else void refetch();
    }, [refetch]);

    // 持久化搜索/筛选/排序状态到 localStorage（草稿，仅在 URL 缺参数时恢复）
    useEffect(() => {
        saveState({
            search,
            typeFilter,
            tagExpr,
            authorExpr,
            uploaderId,
            sortBy,
            sortOrder,
            page
        });
    }, [search, typeFilter, tagExpr, authorExpr, uploaderId, sortBy, sortOrder, page]);

    const goPage = (p: number) => {
        setPage(p);
        updateQuery({ page: p });
    };

    const changeSort = (field: string) => {
        const newOrder = sortBy === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc';
        setSortBy(field);
        setSortOrder(newOrder);
        setPage(1);
        updateQuery({ sortBy: field, sortOrder: newOrder, page: 1 });
    };

    const sortLabel = (field: string) => (sortBy !== field ? '' : sortOrder === 'asc' ? t('library.sortAsc') : t('library.sortDesc'));

    const playAll = async () => {
        const data = await notify.run(() =>
            Api.listMedia({
                limit: 0,
                type: typeFilter || undefined,
                search: search || undefined,
                tags: tagExpr || undefined,
                authorExpr: authorExpr || undefined,
                sortBy,
                sortOrder
            })
        );
        if (!data) return;
        const allItems = data.items || [];
        if (allItems.length === 0) return;
        playlist.playAll(allItems, 0);
        navigate('/view/' + allItems[0].id);
    };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>{t('library.title')}</h1>
                    <p>{t('library.browseHint')}</p>
                </div>
                <div className="flex-gap-8">
                    {items.length > 0 && (
                        <button className="btn btn-primary" onClick={playAll}>
                            {t('library.playAll')}
                        </button>
                    )}
                </div>
            </div>

            <div className="card section-card">
                <div className="search-bar">
                    <div className="search-bar-group">
                        <input
                            className="form-input"
                            placeholder={t('library.searchPlaceholder')}
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                updateQuery({ search: e.target.value });
                            }}
                            onKeyUp={(e) => {
                                if (e.key === 'Enter') doSearch();
                            }}
                        />
                        <select
                            className="form-input form-select"
                            value={typeFilter}
                            onChange={(e) => {
                                setTypeFilter(e.target.value);
                                setPage(1);
                                updateQuery({ typeFilter: e.target.value, page: 1 });
                            }}
                        >
                            <option value="">{t('library.allTypes')}</option>
                            <option value="video">{t('library.video')}</option>
                            <option value="audio">{t('library.audio')}</option>
                            <option value="image">{t('library.image')}</option>
                        </select>
                        <button
                            className="btn btn-primary"
                            onClick={doSearch}
                        >
                            {t('common.search')}
                        </button>
                    </div>
                    <div className="search-bar-group">
                        <span className="sort-label">{t('library.sortLabel')}</span>
                        <div className="sort-group">
                            {[
                                { key: 'createdAt' as const, label: t('library.sortByDate') },
                                { key: 'title' as const, label: t('library.sortByTitle') },
                                { key: 'fileSize' as const, label: t('library.sortBySize') },
                                { key: 'mimeType' as const, label: t('library.sortByType') },
                                { key: 'relevance' as const, label: t('library.sortByRelevance') }
                            ].map((s) => (
                                <button key={s.key} className={`btn btn-ghost ${sortBy === s.key ? 'active' : ''}`} onClick={() => changeSort(s.key)}>
                                    {s.label}
                                    {sortLabel(s.key)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                {/* 标签表达式输入 */}
                <div className="tag-expr-row">
                    <input
                        className="form-input flex-1 min-w-200"
                        placeholder={t('library.tagExprPlaceholder')}
                        maxLength={TAG_EXPR_MAX_LENGTH}
                        value={tagExpr}
                        onChange={(e) => {
                            setTagExpr(e.target.value);
                            updateQuery({ tagExpr: e.target.value });
                        }}
                        onKeyUp={(e) => {
                            if (e.key === 'Enter') doSearch();
                        }}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={doSearch}
                    >
                        {t('common.filter')}
                    </button>
                    {tagExpr && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => {
                                setTagExpr('');
                                updateQuery({ tagExpr: '' });
                                doSearch();
                            }}
                        >
                            {t('common.clear')}
                        </button>
                    )}
                </div>
                {/* 作者表达式筛选（语法同标签） */}
                <div className="tag-expr-row">
                    <input
                        className="form-input flex-1 min-w-200"
                        placeholder={t('library.authorExprPlaceholder')}
                        maxLength={TAG_EXPR_MAX_LENGTH}
                        value={authorExpr}
                        onChange={(e) => {
                            setAuthorExpr(e.target.value);
                            updateQuery({ authorExpr: e.target.value });
                        }}
                        onKeyUp={(e) => {
                            if (e.key === 'Enter') doSearch();
                        }}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={doSearch}
                    >
                        {t('common.filter')}
                    </button>
                    {authorExpr && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => {
                                setAuthorExpr('');
                                updateQuery({ authorExpr: '' });
                                doSearch();
                            }}
                        >
                            {t('common.clear')}
                        </button>
                    )}
                </div>
            </div>

            {isFetching && items.length === 0 ? (
                <LoadingState />
            ) : items.length === 0 ? (
                <EmptyState
                    title={t('library.noMedia')}
                    description={t('library.noMediaHint')}
                />
            ) : (
                <>
                    <div className={`grid grid-2${isFetching ? ' grid-loading' : ''}`}>
                        {items.map((item) => (
                            <MediaCard key={item.id} media={item}>
                                <TagList
                                    tags={item.tags || []}
                                    tagExpr={tagExpr}
                                    onTagClick={(name) => {
                                        const next = applyParamsToSearchParams(
                                            searchParams,
                                            { ...parseUrlParams(searchParams), tagExpr: name, page: 1 }
                                        );
                                        navigate({ pathname: '/library', search: next.toString() });
                                    }}
                                />
                            </MediaCard>
                        ))}
                    </div>

                    <Pagination page={page} totalPages={totalPages} onPageChange={goPage} />
                </>
            )}
        </div>
    );
}
