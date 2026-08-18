import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePlaylistStore } from '../../stores/playlist';
import { usePlayerSettings } from '../../stores/playerSettings';
import { useAuthStore } from '../../stores/auth';
import { Api } from '../../api';
import type { LoopMode, PlayOrder } from '../../stores/playlist';
import type { Media } from '../../types';
import { getMediaType } from '../../utils';
import { notify } from '../../utils/notify';
import Modal from '../../components/feedback/Modal';

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
        // 随机模式按打乱序列取真正的上一项；手动环形；顺序线性（repeatAll 首项回绕）
        const prevIdx = state.getPrevIndex();
        if (prevIdx >= 0) {
            usePlaylistStore.setState({ currentIndex: prevIdx });
        }
    };

    const goNext = () => {
        const state = usePlaylistStore.getState();
        if (state.queue.length <= 1) return;
        // 手动环形 / 单曲循环取序列下一项不重复自身 / 其余按播放模式推进
        const nextIdx = state.getManualNext();
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
    // 用 store 纯查询 getter（getNextIndex/getManualNext 含重洗副作用，不能在渲染期调用）
    const hasPrev = state.hasPrev;
    const hasNext = state.hasNext;

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
