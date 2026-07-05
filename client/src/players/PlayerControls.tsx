import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlaylistStore } from '../stores/playlist';
import { usePlayerSettings } from '../stores/playerSettings';
import { useAuthStore } from '../stores/auth';
import { Api } from '../api';
import type { PlayMode } from '../stores/playlist';
import type { Media } from '../types';
import { getMediaType } from '../utils';
import { toast } from 'sonner';
import Modal from '../components/Modal';
import { TOAST_DURATION } from '../config';

interface Props {
    media: Media;
    countdown?: number;
}

export default function PlayerControls({ media, countdown = 0 }: Props) {
    const { t } = useTranslation();
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
        // loop/shuffle 模式在首项时回绕到末项
        if (prevIdx < 0 && (state.playMode === 'loop' || state.playMode === 'shuffle')) {
            prevIdx = state.queue.length - 1;
        }
        if (prevIdx >= 0) {
            usePlaylistStore.setState({ currentIndex: prevIdx });
        }
    };

    const goNext = () => {
        const state = usePlaylistStore.getState();
        if (state.queue.length <= 1) return;
        // 从播放模式获取下一个索引
        let nextIdx = state.getNextIndex();
        // repeatOne：不重复自身，改为线性下一项
        if (nextIdx === state.currentIndex && state.playMode === 'repeatOne') {
            nextIdx = state.currentIndex < state.queue.length - 1 ? state.currentIndex + 1 : -1;
        }
        // 播放模式无下一项时，回退到线性下一项（如 manual 模式）
        if (nextIdx < 0 && state.currentIndex < state.queue.length - 1) {
            nextIdx = state.currentIndex + 1;
        }
        if (nextIdx >= 0) {
            usePlaylistStore.setState({ currentIndex: nextIdx });
        }
    };

    const cycleMode = () => {
        const { playMode } = usePlaylistStore.getState();
        const modes: PlayMode[] = ['list', 'loop', 'shuffle', 'repeatOne', 'manual'];
        const next = modes[(modes.indexOf(playMode) + 1) % modes.length];
        playlist.setPlayMode(next);
    };

    const openDurationEdit = () => {
        setDurationInput(String(usePlayerSettings.getState().staticImageDuration || ''));
        setShowDuration(true);
    };

    const saveDuration = () => {
        const val = durationInput === '' ? 0 : Number(durationInput);
        if (isNaN(val) || val < 0) {
            toast.error(t('player.durationError'));
            return;
        }
        usePlayerSettings.getState().setStaticImageDuration(val);
        toast.success(t('player.durationSaved'));
        setShowDuration(false);
    };

    // 实时计算 hasNext/hasPrev，绕过 Zustand getter 固化问题
    const state = usePlaylistStore.getState();
    const settings = usePlayerSettings.getState();
    const playMode = state.playMode;
    // 仅一个项目时锁定前后切换
    const multi = state.queue.length > 1;
    // loop/shuffle 模式在首项时可回绕到末项
    const hasPrev = multi && (state.currentIndex > 0 || (state.currentIndex === 0 && (playMode === 'loop' || playMode === 'shuffle') && state.queue.length > 0));
    // 根据播放模式判断是否有下一项
    let nextIdx = multi ? state.getNextIndex() : -1;
    if (nextIdx === state.currentIndex && playMode === 'repeatOne') {
        nextIdx = state.currentIndex < state.queue.length - 1 ? state.currentIndex + 1 : -1;
    }
    // 播放模式无下一项但队列中还有后续项时仍可手动导航（如 manual 模式）
    if (nextIdx < 0 && state.currentIndex < state.queue.length - 1) {
        nextIdx = state.currentIndex + 1;
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
                    cycleMode();
                    break;
                case 'Delete':
                    if (useAuthStore.getState().isAdmin) {
                        e.preventDefault();
                        Api.deleteMedia(media.id)
                            .then(() => {
                                toast.success(t('player.deleteSuccess'));
                                const removed = usePlaylistStore.getState().removeById(media.id);
                                // removeById 已自动将 currentIndex 更新到下一项，无需再 goNext
                                if (removed === null) {
                                    window.location.href = '/';
                                }
                            })
                            .catch((err: Error) => {
                                toast.error(err.message || t('player.deleteFailed'), { duration: TOAST_DURATION });
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
                        ⏮ {t('player.prev')}
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={!hasNext} onClick={goNext}>
                        {t('player.next')} ⏭
                    </button>
                    {getMediaType(media.mimeType) === 'image' && (
                        <button className="btn btn-secondary btn-sm" onClick={openDurationEdit} title={t('player.setPlayDuration')}>
                            {countdown > 0
                                ? t('player.timerSeconds', { n: countdown })
                                : playerSettings.staticImageDuration > 0
                                    ? t('player.timerSeconds', {
                                        n: playerSettings.staticImageDuration
                                    })
                                    : t('player.timing')}
                        </button>
                    )}
                </div>
                <div className="player-controls-right">
                    <button className="btn btn-secondary btn-sm" onClick={cycleMode}>
                        {t(`player.mode${playMode.charAt(0).toUpperCase()}${playMode.slice(1)}`)}
                    </button>
                </div>
            </div>

            <Modal
                open={showDuration}
                title={t('player.setPlayDuration')}
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
                <p className="text-sm text-secondary mb-16">{t('player.staticImageDurationHint')}</p>
                <input
                    className="form-input"
                    type="number"
                    min="0"
                    value={durationInput}
                    onChange={(e) => setDurationInput(e.target.value)}
                    placeholder={t('player.timing')}
                    autoFocus
                />
            </Modal>
        </>
    );
}
