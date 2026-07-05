import type { ReactNode } from 'react';
import type { Media } from '../types';
import { usePlaylistStore } from '../stores/playlist';
import { usePlayerSettings } from '../stores/playerSettings';
import { useTranslation } from 'react-i18next';
import PlayerControls from './PlayerControls';
import PlayerInfo from './PlayerInfo';
import MediaActions from './MediaActions';
import PlaylistSidebar from './PlaylistSidebar';

interface PlayerLayoutProps {
    media: Media;
    /** 媒体元素（video / audio / image） */
    children: ReactNode;
    /** 给 PlayerControls 的倒计时（仅图片） */
    countdown?: number;
    /** 给 PlayerInfo 的额外 meta 插槽 */
    metaExtra?: React.ReactNode;
    /** 操作卡片底部的额外按钮（设为 null 可隐藏自动播放开关） */
    actionsExtra?: React.ReactNode;
    /** 媒体区域容器 className */
    mediaWrapperClass?: string;
    /** 媒体区域容器额外样式 */
    mediaWrapperStyle?: React.CSSProperties;
}

export default function PlayerLayout({
    media,
    children,
    countdown = 0,
    metaExtra,
    actionsExtra,
    mediaWrapperClass = 'player-wrapper',
    mediaWrapperStyle
}: PlayerLayoutProps) {
    const { t } = useTranslation();
    const playlist = usePlaylistStore();
    const playerSettings = usePlayerSettings();
    const autoPlayVideo = playerSettings.autoPlayVideo;

    return (
        <div className="player-page">
            <div className={mediaWrapperClass} style={mediaWrapperStyle}>
                {children}
            </div>
            <div className="player-below">
                <div className="player-main">
                    <PlayerControls media={media} countdown={countdown} />
                    <PlayerInfo media={media} metaExtra={metaExtra} />
                    <div className="actions-card">
                        <div className="actions-group">
                            <MediaActions media={media} />
                        </div>
                        {actionsExtra !== null && (
                            <div className="actions-group">
                                {actionsExtra}
                                <button
                                    className={`btn btn-sm ${autoPlayVideo ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => usePlayerSettings.getState().setAutoPlayVideo(!autoPlayVideo)}
                                >
                                    {autoPlayVideo ? t('player.autoPlay') : t('player.manualPlay')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                {playlist.queue.length > 1 && <PlaylistSidebar media={media} />}
            </div>
        </div>
    );
}
