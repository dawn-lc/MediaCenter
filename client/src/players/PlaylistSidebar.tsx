import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Media } from '../types';
import { getMediaIcon, formatDuration } from '../utils';
import { usePlaylistStore } from '../stores/playlist';
import { LIST_ITEM_HEIGHT as ITEM_HEIGHT, VIRTUAL_SCROLL_OVERSCAN as OVERSCAN, SCROLLBAR_WIDTH, WHEEL_STEP } from '../config';

interface Props {
    media: Media;
}

export default function PlaylistSidebar({ media }: Props) {
    const { t } = useTranslation();

    const queue = usePlaylistStore((s) => s.queue);
    const currentIndex = usePlaylistStore((s) => s.currentIndex);
    const clear = usePlaylistStore((s) => s.clear);
    const total = queue.length;

    const listRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [listHeight, setListHeight] = useState(0);

    const visibleCount = Math.max(1, Math.floor(Math.max(listHeight, ITEM_HEIGHT) / ITEM_HEIGHT));
    const maxStartIdx = Math.max(0, total - visibleCount);
    const [startIdx, setStartIdx] = useState(0);

    const visibleItems = useMemo(() => {
        if (total === 0) return [] as Media[];
        const begin = Math.max(0, startIdx - OVERSCAN);
        const end = Math.min(total, startIdx + visibleCount + OVERSCAN);
        return queue.slice(begin, end);
    }, [queue, startIdx, visibleCount, total]);

    const windowBeginIdx = Math.max(0, startIdx - OVERSCAN);
    const overscanOffset = (startIdx - windowBeginIdx) * ITEM_HEIGHT;

    const thumbRatio = total > 0 ? Math.max(0.005, visibleCount / total) : 1;
    const thumbPct = total > 1 ? (startIdx / maxStartIdx) * (1 - thumbRatio) * 100 : 0;

    // 首次有高度时定位到当前项
    const positionedRef = useRef(false);
    useEffect(() => {
        if (positionedRef.current || listHeight <= 0 || total === 0) return;
        positionedRef.current = true;
        const newStart = Math.max(0, Math.min(maxStartIdx, currentIndex - Math.floor(visibleCount / 2)));
        setStartIdx(newStart);
    }, [listHeight, currentIndex, maxStartIdx, visibleCount, total]);

    // 后续 currentIndex 变化时定位（不依赖 scrollToInclude，避免闭环）
    useEffect(() => {
        if (!positionedRef.current) return;
        if (total === 0 || visibleCount <= 0) return;
        const halfView = Math.floor(visibleCount / 3);
        if (currentIndex < startIdx + halfView || currentIndex > startIdx + visibleCount - halfView) {
            const newStart = Math.max(0, Math.min(maxStartIdx, currentIndex - Math.floor(visibleCount / 2)));
            setStartIdx(newStart);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex]);

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) setListHeight(entry.contentRect.height);
        });
        ro.observe(el);
        setListHeight(el.clientHeight);
        return () => ro.disconnect();
    }, []);

    const getTrackRatio = useCallback(
        (clientY: number): number => {
            const track = trackRef.current;
            if (!track || total <= 1) return 0;
            const rect = track.getBoundingClientRect();
            return Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        },
        [total]
    );

    const handleTrackClick = useCallback(
        (e: React.MouseEvent | React.TouchEvent) => {
            const ratio = getTrackRatio('touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY);
            setStartIdx(Math.round(ratio * maxStartIdx));
        },
        [maxStartIdx, getTrackRatio]
    );

    const draggingRef = useRef(false);
    const dragStartY = useRef(0);
    const dragStartIdx = useRef(0);

    const startDrag = useCallback(
        (clientY: number) => {
            draggingRef.current = true;
            dragStartY.current = clientY;
            dragStartIdx.current = startIdx;
        },
        [startIdx]
    );

    const moveDrag = useCallback(
        (clientY: number) => {
            if (!draggingRef.current || !trackRef.current) return;
            const trackH = trackRef.current.getBoundingClientRect().height;
            const dy = clientY - dragStartY.current;
            setStartIdx(Math.min(maxStartIdx, Math.max(0, dragStartIdx.current + Math.round((dy / trackH) * maxStartIdx))));
        },
        [maxStartIdx]
    );

    const endDrag = useCallback(() => {
        draggingRef.current = false;
    }, []);

    const handleThumbPointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            startDrag(e.clientY);
        },
        [startDrag]
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!draggingRef.current) return;
            e.preventDefault();
            moveDrag(e.clientY);
        },
        [moveDrag]
    );

    const handlePointerUp = useCallback(() => {
        endDrag();
    }, [endDrag]);

    // 用原生 addEventListener 绑定 wheel & touch drag
    const startIdxRef = useRef(startIdx);
    startIdxRef.current = startIdx;

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;

        let touchStartY = 0;
        let touchStartIdx = 0;

        const onTouchStart = (e: TouchEvent) => {
            touchStartY = e.touches[0].clientY;
            touchStartIdx = startIdxRef.current;
        };

        const onTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            const dy = touchStartY - e.touches[0].clientY;
            const idxDelta = Math.round(dy / ITEM_HEIGHT);
            if (idxDelta === 0) return;
            setStartIdx(Math.min(maxStartIdx, Math.max(0, touchStartIdx + idxDelta)));
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? WHEEL_STEP : -WHEEL_STEP;
            setStartIdx((prev) => {
                const next = prev + delta;
                return next < 0 ? 0 : next > maxStartIdx ? maxStartIdx : next;
            });
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('wheel', onWheel);
        };
    }, [maxStartIdx]);

    const goToItem = useCallback(
        (id: string) => {
            const idx = queue.findIndex((m) => m.id === id);
            if (idx >= 0) usePlaylistStore.setState({ currentIndex: idx });
        },
        [queue]
    );

    const clearPlaylist = useCallback(() => {
        clear();
        window.location.href = '/';
    }, [clear]);

    const formatItemDuration = useCallback((item: Media) => {
        if (item.duration != null && item.duration > 0) return formatDuration(item.duration);
        return null;
    }, []);

    if (total === 0) return null;

    return (
        <div className="player-sidebar">
            <div className="card sidebar-card">
                <div className="sidebar-title">
                    <span>{t('player.playlist')} <span className="sidebar-count">({total.toLocaleString()})</span></span>
                    <button className="btn btn-secondary btn-sm" onClick={clearPlaylist}>
                        {t('player.clearList')}
                    </button>
                </div>

                <div className="sidebar-body">
                    <div
                        ref={listRef}
                        className="sidebar-list-wrapper"
                    >
                        <div style={{ position: 'absolute', top: -overscanOffset, left: 0, right: 0 }}>
                            {visibleItems.map((item) => {
                                const active = item.id === media.id;
                                const dur = formatItemDuration(item);
                                return (
                                    <div
                                        key={item.id}
                                        className={`playlist-item${active ? ' active' : ''}`}
                                        onClick={() => goToItem(item.id)}
                                        style={{ height: ITEM_HEIGHT }}
                                    >
                                        <span className="playlist-icon">{getMediaIcon(item.mimeType)}</span>
                                        <span className="playlist-title">{item.title}</span>
                                        {dur && <span className="playlist-duration">{dur}</span>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {total > visibleCount && (
                        <div
                            ref={trackRef}
                            className="sidebar-scroll-track"
                            onClick={handleTrackClick}
                            onPointerDown={handleTrackClick}
                            style={{ width: SCROLLBAR_WIDTH }}
                        >
                            <div
                                className="sidebar-scroll-thumb"
                                onPointerDown={handleThumbPointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerCancel={handlePointerUp}
                                style={{
                                    height: `${Math.max(thumbRatio * 100, 2)}%`,
                                    top: `${thumbPct}%`
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
