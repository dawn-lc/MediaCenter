import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Api, resolveApiUrl } from '../api';
import type { Media } from '../types';
import { formatFileSize, formatDate, getMediaIcon, getMediaTypeLabel, getTagGroupMap } from '../utils';
import { obtainThumbnailUrl } from '../utils/thumbnails';
import { useAuthStore } from '../stores/auth';
import { usePlaylistStore } from '../stores/playlist';
import { toast } from 'sonner';
import TagList from '../components/TagList';
import Pagination from '../components/Pagination';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';

import { HOME_PAGE_SIZE, TOAST_DURATION, DEFAULT_SORT_FIELD, DEFAULT_SORT_ORDER, STORAGE_PREFIX } from '../config';

const STORAGE_KEY = STORAGE_PREFIX + 'home_state';

interface HomeState {
    search: string;
    committedSearch: string;
    typeFilter: string;
    tagExpr: string;
    tagInput: string;
    authorExpr: string;
    authorInput: string;
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

export default function HomePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useTranslation();
    const auth = useAuthStore();
    const playlist = usePlaylistStore();

    const [items, setItems] = useState<Media[]>([]);
    const [loading, setLoading] = useState(true);
    const [generatedThumbs, setGeneratedThumbs] = useState<Record<string, string>>({});
    const generatedRef = useRef<Set<string>>(new Set());
    const thumbUrlsRef = useRef<string[]>([]);
    const saved = loadState();
    const [page, setPage] = useState(saved.page || 1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState(saved.search || '');
    const [committedSearch, setCommittedSearch] = useState(saved.committedSearch || '');
    const [typeFilter, setTypeFilter] = useState(saved.typeFilter || '');
    const initExpr = new URLSearchParams(location.search).get('tags') || saved.tagExpr || '';
    const [tagExpr, setTagExpr] = useState(initExpr);
    const [tagInput, setTagInput] = useState(saved.tagInput || initExpr);
    const initAuthorExpr = new URLSearchParams(location.search).get('authorExpr') || saved.authorExpr || '';
    const [authorExpr, setAuthorExpr] = useState(initAuthorExpr);
    const [authorInput, setAuthorInput] = useState(saved.authorInput || initAuthorExpr);
    const initUploaderId = new URLSearchParams(location.search).get('uploaderId') || saved.uploaderId || '';
    const [uploaderId, setUploaderId] = useState(initUploaderId);
    const [sortBy, setSortBy] = useState(saved.sortBy || DEFAULT_SORT_FIELD);
    const [sortOrder, setSortOrder] = useState(saved.sortOrder || DEFAULT_SORT_ORDER);
    const [sortExplicit, setSortExplicit] = useState(false); // 用户是否主动点过排序

    // 解析标签表达式分组，用于高亮不同筛选项
    const tagGroupMap = getTagGroupMap(tagExpr);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await Api.listMedia({
                page,
                limit: HOME_PAGE_SIZE,
                type: typeFilter || undefined,
                search: committedSearch || undefined,
                tags: tagExpr || undefined,
                authorExpr: authorExpr || undefined,
                uploaderId: uploaderId || undefined,
                sortBy,
                sortOrder
            });
            setItems(data.items || []);
            setTotalPages(data.pagination?.totalPages || 1);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.loadFailed'), {
                duration: TOAST_DURATION
            });
        } finally {
            setLoading(false);
        }
    }, [page, typeFilter, committedSearch, tagExpr, authorExpr, sortBy, sortOrder]);

    useEffect(() => {
        load();
    }, [load]);

    // 为无缩略图的视频生成客户端缩略图（串行执行，避免同时下载大量视频数据）
    useEffect(() => {
        const todo = items.filter(
            (item) => !item.thumbUrl && item.mimeType.startsWith('video/') && !generatedRef.current.has(item.id)
        );
        for (const item of todo) generatedRef.current.add(item.id);

        let cancelled = false;
        const urls: string[] = [];
        (async () => {
            for (const item of todo) {
                if (cancelled) break;
                const url = await obtainThumbnailUrl(item.id, resolveApiUrl(item.streamUrl));
                if (cancelled) { if (url) URL.revokeObjectURL(url); break; }
                if (url) {
                    urls.push(url);
                    thumbUrlsRef.current.push(url);
                    setGeneratedThumbs((prev) => ({ ...prev, [item.id]: url }));
                }
            }
        })();

        return () => {
            cancelled = true;
            for (const url of urls) URL.revokeObjectURL(url);
        };
    }, [items]);

    // 持久化搜索/筛选/排序状态到 localStorage
    useEffect(() => {
        saveState({
            search,
            committedSearch,
            typeFilter,
            tagExpr,
            tagInput,
            authorExpr,
            authorInput,
            uploaderId,
            sortBy,
            sortOrder,
            page
        });
    }, [search, committedSearch, typeFilter, tagExpr, tagInput, authorExpr, authorInput, uploaderId, sortBy, sortOrder, page]);

    // 同步筛选条件到 URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (tagExpr) params.set('tags', tagExpr);
        else params.delete('tags');
        if (authorExpr) params.set('authorExpr', authorExpr);
        else params.delete('authorExpr');
        if (uploaderId) params.set('uploaderId', uploaderId);
        else params.delete('uploaderId');
        const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState(null, '', newUrl);
    }, [tagExpr, authorExpr, uploaderId]);

    // 从 URL 同步筛选条件（当从卡片/播放器点击跳转时）
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const urlTags = params.get('tags') || '';
        const urlAuthorExpr = params.get('authorExpr') || '';
        const urlUploaderId = params.get('uploaderId') || '';
        if (urlTags !== tagExpr) {
            setTagExpr(urlTags);
            setTagInput(urlTags);
        }
        if (urlAuthorExpr !== authorExpr) {
            setAuthorExpr(urlAuthorExpr);
            setAuthorInput(urlAuthorExpr);
        }
        if (urlUploaderId !== uploaderId) {
            setUploaderId(urlUploaderId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search]);

    const doSearch = () => {
        setPage(1);
        load();
    };
    const goPage = (p: number) => {
        setPage(p);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const changeSort = (field: string) => {
        setSortExplicit(true);
        if (sortBy === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        else {
            setSortBy(field);
            setSortOrder('desc');
        }
        setPage(1);
    };

    const sortLabel = (field: string) => (sortBy !== field ? '' : sortOrder === 'asc' ? t('home.sortAsc') : t('home.sortDesc'));

    const playAll = async () => {
        try {
            const data = await Api.listMedia({
                limit: 0,
                type: typeFilter || undefined,
                search: committedSearch || undefined,
                tags: tagExpr || undefined,
                authorExpr: authorExpr || undefined,
                sortBy,
                sortOrder
            });
            const allItems = data.items || [];
            if (allItems.length === 0) return;
            playlist.playAll(allItems, 0);
            navigate('/player/' + allItems[0].id);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.loadFailed'), {
                duration: 8000
            });
        }
    };

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>{t('home.title')}</h1>
                    <p>{t('home.browseHint')}</p>
                </div>
                <div className="flex-gap-8">
                    {items.length > 0 && (
                        <button className="btn btn-primary" onClick={playAll}>
                            {t('home.playAll')}
                        </button>
                    )}
                    {auth.isLoggedIn && (
                        <button className="btn btn-secondary" onClick={() => navigate('/upload')}>
                            {t('common.upload')}
                        </button>
                    )}
                </div>
            </div>

            <div className="card section-card">
                <div className="search-bar">
                    <div className="search-bar-group">
                        <input
                            className="form-input"
                            placeholder={t('home.searchPlaceholder')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyUp={(e) => {
                                if (e.key === 'Enter') {
                                    setCommittedSearch(search);
                                    setPage(1);
                                }
                            }}
                        />
                        <select
                            className="form-input form-select"
                            value={typeFilter}
                            onChange={(e) => {
                                setTypeFilter(e.target.value);
                                setPage(1);
                            }}
                        >
                            <option value="">{t('home.allTypes')}</option>
                            <option value="video">{t('home.video')}</option>
                            <option value="audio">{t('home.audio')}</option>
                            <option value="image">{t('home.image')}</option>
                        </select>
                        <button
                            className="btn btn-primary"
                            onClick={() => {
                                setCommittedSearch(search);
                                setPage(1);
                            }}
                        >
                            {t('common.search')}
                        </button>
                    </div>
                    <div className="search-bar-group">
                        <span className="sort-label">{t('home.sortLabel')}</span>
                        <div className="sort-group">
                            {[
                                { key: 'createdAt' as const, label: t('home.sortByDate') },
                                { key: 'title' as const, label: t('home.sortByTitle') },
                                { key: 'fileSize' as const, label: t('home.sortBySize') },
                                { key: 'mimeType' as const, label: t('home.sortByType') },
                                { key: 'relevance' as const, label: t('home.sortByRelevance') }
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
                        placeholder={t('home.tagExprPlaceholder')}
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyUp={(e) => {
                            if (e.key === 'Enter') {
                                setTagExpr(tagInput);
                                setPage(1);
                            }
                        }}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            setTagExpr(tagInput);
                            setPage(1);
                        }}
                    >
                        {t('common.filter')}
                    </button>
                    {(tagExpr || tagInput) && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => {
                                setTagExpr('');
                                setTagInput('');
                                setPage(1);
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
                        placeholder={t('home.authorExprPlaceholder')}
                        value={authorInput}
                        onChange={(e) => setAuthorInput(e.target.value)}
                        onKeyUp={(e) => {
                            if (e.key === 'Enter') {
                                setAuthorExpr(authorInput);
                                setPage(1);
                            }
                        }}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            setAuthorExpr(authorInput);
                            setPage(1);
                        }}
                    >
                        {t('common.filter')}
                    </button>
                    {(authorExpr || authorInput) && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => { setAuthorExpr(''); setAuthorInput(''); setPage(1); }}
                        >
                            {t('common.clear')}
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <LoadingState />
            ) : items.length === 0 ? (
                <EmptyState
                    title={t('home.noMedia')}
                    description={t('home.noMediaHint')}
                />
            ) : (
                <>
                    <div className="grid grid-2">
                        {items.map((item) => (
                            <div key={item.id} className="media-card" onClick={() => navigate('/player/' + item.id)}>
                                <div className="media-card-thumb">
                                    {item.thumbUrl || generatedThumbs[item.id] ? (
                                        <img
                                            src={item.thumbUrl ? resolveApiUrl(item.thumbUrl) : generatedThumbs[item.id]}
                                            alt={item.title}
                                            className="img-cover"
                                            loading="lazy"
                                        />
                                    ) : item.mimeType.startsWith('image/') ? (
                                        <img
                                            src={generatedThumbs[item.id]}
                                            alt={item.title}
                                            className="img-cover"
                                            loading="lazy"
                                        />
                                    ) : item.mimeType.startsWith('image/') ? (
                                        <img
                                            src={resolveApiUrl(item.streamUrl)}
                                            alt={item.title}
                                            className="img-cover"
                                            loading="lazy"
                                        />
                                    ) : (
                                        getMediaIcon(item.mimeType)
                                    )}
                                    {item.deletedAt && <span className="media-card-deleted-badge">{t('common.deleted')}</span>}
                                </div>
                                <div className="media-card-body">
                                    <h3>{item.title}</h3>
                                    <div className="media-meta">
                                        <span>{getMediaTypeLabel(item.mimeType)}</span>
                                        <span>{formatFileSize(item.fileSize)}</span>
                                        <span>{formatDate(item.createdAt, t)}</span>
                                    </div>
                                    <TagList
                                        tags={item.tags || []}
                                        tagExpr={tagExpr}
                                        onTagClick={(name) => navigate('/?tags=' + encodeURIComponent(name))}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <Pagination page={page} totalPages={totalPages} onPageChange={goPage} />
                </>
            )}
        </div>
    );
}
