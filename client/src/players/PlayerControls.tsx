import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePlaylistStore } from '../stores/playlist';
import { usePlayerSettings } from '../stores/playerSettings';
import { useAuthStore } from '../stores/auth';
import { Api } from '../api';
import type { LoopMode, PlayOrder } from '../stores/playlist';
import type { Media } from '../types';
import { getMediaType } from '../utils';
import { notify } from '../utils/notify';
import Modal from '../components/Modal';

interface Props {
    media: Media;
    countdown?: number;
}

export default function PlayerControls({ media, countdown = 0 }: Props) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const playlist = usePlaylistStore();
    const playerSettings = usePlayerSettings();
    const { queue } = playlist;
    const total = queue.length;
    const [showDuration, setShowDuration] = useState(false);
    const [durationInput, setDurationInput] = useState('');

    const goPrev = () => {
        const state = usePlaylistStore.getState();
        if (state.queue.length <= 1) return;
        let prevIdx = state.currentIndex - 1;
        // 列表循环/随机/手动模式在首项时回绕到末项
        if (prevIdx < 0 && (state.loopMode === 'repeatAll' || state.playOrder === 'shuffle' || state.playOrder === 'manual')) {
            prevIdx = state.queue.length - 1;
        }
        if (prevIdx >= 0) {
            usePlaylistStore.setState({ currentIndex: prevIdx });
        }
    };

    const goNext = () => {
        const state = usePlaylistStore.getState();
        if (state.queue.length <= 1) return;
        let nextIdx: number;
        // 手动模式：始终环形推进到下一项（播放完仍不自动推进，由 ended 逻辑保持）
        if (state.playOrder === 'manual') {
            nextIdx = (state.currentIndex + 1) % state.queue.length;
        } else {
            // 从播放模式获取下一个索引
            nextIdx = state.getNextIndex();
            // 单曲循环：手动切歌不重复自身，改为线性下一项
            if (nextIdx === state.currentIndex && state.loopMode === 'repeatOne') {
                nextIdx = state.currentIndex < state.queue.length - 1 ? state.currentIndex + 1 : -1;
            }
            // 播放模式无下一项时，回退到线性下一项
            if (nextIdx < 0 && state.currentIndex < state.queue.length - 1) {
                nextIdx = state.currentIndex + 1;
            }
        }
        if (nextIdx >= 0) {
            usePlaylistStore.setState({ currentIndex: nextIdx });
        }
    };

    // 循环控制：不循环 → 单曲循环 → 列表循环（独立于播放列表推进方式）
    const cycleLoop = () => {
        const { loopMode } = usePlaylistStore.getState();
        const modes: LoopMode[] = ['off', 'repeatOne', 'repeatAll'];
        const next = modes[(modes.indexOf(loopMode) + 1) % modes.length];
        playlist.setLoopMode(next);
    };

    // 播放列表推进：顺序 → 随机 → 手动（独立于循环控制）
    const cycleOrder = () => {
        const { playOrder } = usePlaylistStore.getState();
        const orders: PlayOrder[] = ['sequential', 'shuffle', 'manual'];
        const next = orders[(orders.indexOf(playOrder) + 1) % orders.length];
        playlist.setPlayOrder(next);
    };

    const openDurationEdit = () => {
        setDurationInput(String(usePlayerSettings.getState().staticImageDuration || ''));
        setShowDuration(true);
    };

    const saveDuration = () => {
        const val = durationInput === '' ? 0 : Number(durationInput);
        if (isNaN(val) || val < 0) {
            notify.error(t('view.durationError'));
            return;
        }
        usePlayerSettings.getState().setStaticImageDuration(val);
        notify.success(t('view.durationSaved'));
        setShowDuration(false);
    };

    // 实时计算 hasNext/hasPrev，绕过 Zustand getter 固化问题
    const state = usePlaylistStore.getState();
    const settings = usePlayerSettings.getState();
    const loopMode = state.loopMode;
    const playOrder = state.playOrder;
    // 仅一个项目时锁定前后切换
    const multi = state.queue.length > 1;
    // 列表循环/随机/手动模式在首项时可回绕到末项
    const hasPrev = multi && (state.currentIndex > 0 || (state.currentIndex === 0 && (loopMode === 'repeatAll' || playOrder === 'shuffle' || playOrder === 'manual') && state.queue.length > 0));
    // 根据播放模式判断是否有下一项
    let nextIdx = multi ? state.getNextIndex() : -1;
    if (playOrder === 'manual') {
        // 手动模式：始终可环形推进到下一项
        nextIdx = multi ? (state.currentIndex + 1) % state.queue.length : -1;
    } else {
        if (nextIdx === state.currentIndex && loopMode === 'repeatOne') {
            nextIdx = state.currentIndex < state.queue.length - 1 ? state.currentIndex + 1 : -1;
        }
        // 播放模式无下一项但队列中还有后续项时仍可手动导航
        if (nextIdx < 0 && state.currentIndex < state.queue.length - 1) {
            nextIdx = state.currentIndex + 1;
        }
    }
    const hasNext = multi && nextIdx >= 0;

    // 键盘快捷键（Ctrl 前缀：播单切换）
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!e.ctrlKey || e.metaKey) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    goPrev();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    goNext();
                    break;
                case 'l':
                case 'L':
                    e.preventDefault();
                    cycleLoop();
                    break;
                case 'Delete':
                    if (useAuthStore.getState().isAdmin) {
                        e.preventDefault();
                        notify.promise(Api.deleteMedia(media.id), {
                            loading: t('view.deleting'),
                            success: t('view.deleteSuccess'),
                            onSuccess: () => {
                                const removed = usePlaylistStore.getState().removeById(media.id);
                                // removeById 已自动将 currentIndex 更新到下一项，无需再 goNext
                                if (removed === null) {
                                    navigate('/');
                                }
                            }
                        });
                    }
                    break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    return (
        <>
            <div className="player-controls">
                <div className="player-controls-left">
                    <button className="btn btn-secondary btn-sm" disabled={!hasPrev} onClick={goPrev}>
                        ⏮ {t('view.prev')}
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={!hasNext} onClick={goNext}>
                        {t('view.next')} ⏭
                    </button>
                    {getMediaType(media.mimeType) === 'image' && (
                        <button className="btn btn-secondary btn-sm" onClick={openDurationEdit} title={t('view.setPlayDuration')}>
                            {countdown > 0
                                ? t('view.timerSeconds', { n: countdown })
                                : playerSettings.staticImageDuration > 0
                                    ? t('view.timerSeconds', {
                                        n: playerSettings.staticImageDuration
                                    })
                                    : t('view.timing')}
                        </button>
                    )}
                </div>
                <div className="player-controls-right">
                    <button className="btn btn-secondary btn-sm" onClick={cycleOrder} title={t('view.orderLabel')}>
                        {t(`view.order${playOrder.charAt(0).toUpperCase()}${playOrder.slice(1)}`)}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={cycleLoop} title={t('view.loopLabel')}>
                        {t(`view.loop${loopMode.charAt(0).toUpperCase()}${loopMode.slice(1)}`)}
                    </button>
                </div>
            </div>

            <Modal
                open={showDuration}
                title={t('view.setPlayDuration')}
                onClose={() => setShowDuration(false)}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setShowDuration(false)}>
                            {t('common.cancel')}
                        </button>
                        <button className="btn btn-primary" onClick={saveDuration}>
                            {t('common.save')}
                        </button>
                    </>
                }
            >
                <p className="text-sm text-secondary mb-16">{t('view.staticImageDurationHint')}</p>
                <input
                    className="form-input"
                    type="number"
                    min="0"
                    value={durationInput}
                    onChange={(e) => setDurationInput(e.target.value)}
                    placeholder={t('view.timing')}
                    autoFocus
                />
            </Modal>
        </>
    );
}
