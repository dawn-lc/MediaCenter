import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import type { Media } from '../types';
import { getTagGroupMap } from '../utils';
import PlayerMeta from './PlayerMeta';
import Modal from '../components/Modal';
import { TRUSTED_IMAGE_HOSTS } from '../config';

function isTrustedImageUrl(src: string): boolean {
    try {
        const url = new URL(src, window.location.origin);
        // 本站图片直接放行
        if (url.origin === window.location.origin) return true;
        // 检查可信任图床
        return TRUSTED_IMAGE_HOSTS.includes(url.hostname);
    } catch {
        return false;
    }
}

function isExternalLink(href: string): boolean {
    try {
        const url = new URL(href, window.location.origin);
        return url.origin !== window.location.origin;
    } catch {
        return false;
    }
}

function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
    const { t } = useTranslation();
    const [showWarning, setShowWarning] = useState(false);
    const pendingHref = useRef('');

    if (!href) return <a>{children}</a>;
    if (!isExternalLink(href)) {
        return <a href={href}>{children}</a>;
    }

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        pendingHref.current = href;
        setShowWarning(true);
    };

    const handleConfirm = () => {
        window.open(pendingHref.current, '_blank', 'noopener,noreferrer');
        setShowWarning(false);
    };

    return (
        <>
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
                {children}
            </a>
            <Modal
                open={showWarning}
                title={t('common.warning')}
                onClose={() => setShowWarning(false)}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setShowWarning(false)}>
                            {t('common.cancel')}
                        </button>
                        <button className="btn btn-primary" onClick={handleConfirm}>
                            {t('common.confirm')}
                        </button>
                    </>
                }
            >
                <p className="text-sm" style={{ lineHeight: 1.6 }}>
                    {t('player.externalLinkWarning', { url: href })}
                </p>
            </Modal>
        </>
    );
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
    const { t } = useTranslation();
    const [loaded, setLoaded] = useState(false);
    if (!src) return null;
    if (isTrustedImageUrl(src)) {
        return <img src={src} alt={alt || ''} loading="lazy" />;
    }
    // 非信任图片：用户点击后加载
    return (
        <span className="untrusted-image untrusted-trigger" onClick={() => setLoaded(true)}>
            {loaded ? (
                <img src={src} alt={alt || ''} loading="lazy" />
            ) : (
                <>
                    <span className="untrusted-placeholder-icon">🖼️</span>
                    <span className="untrusted-placeholder-text">{alt || t('player.untrustedImageNoAlt')}</span>
                    <span className="untrusted-placeholder-hint">{t('player.untrustedImageHint')}</span>
                </>
            )}
        </span>
    );
}

interface PlayerInfoProps {
    media: Media;
    /** 额外的 meta 项，渲染在权限标签之后、上传者之前 */
    metaExtra?: React.ReactNode;
}

export default function PlayerInfo({ media, metaExtra }: PlayerInfoProps) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const descRef = useRef<HTMLDivElement>(null);
    const [descExpanded, setDescExpanded] = useState(false);
    const [descOverflows, setDescOverflows] = useState(false);

    const checkOverflow = useCallback(() => {
        const el = descRef.current;
        if (!el) return;
        // 只在 clamped 状态下检测
        if (!descExpanded) {
            setDescOverflows(el.scrollHeight > el.clientHeight + 2);
        }
    }, [descExpanded]);

    useEffect(() => {
        checkOverflow();
        const ro = new ResizeObserver(checkOverflow);
        if (descRef.current) ro.observe(descRef.current);
        return () => ro.disconnect();
    }, [checkOverflow, media.description]);

    return (
        <div className="card player-info">
            <h1>{media.title}</h1>
            <PlayerMeta media={media}>{metaExtra}</PlayerMeta>
            {media.description && (
                <>
                    <div ref={descRef} className={`player-desc${descExpanded ? '' : ' clamped'}`}>
                        <ReactMarkdown
                            components={{
                                img: MarkdownImage,
                                a: MarkdownLink
                            }}
                        >
                            {media.description}
                        </ReactMarkdown>
                    </div>
                    {descOverflows && (
                        <button className="desc-expand-btn" onClick={() => setDescExpanded((v) => !v)}>
                            {descExpanded ? t('player.collapse') : t('player.expand')}
                        </button>
                    )}
                </>
            )}
            {media.tags && media.tags.length > 0 && (
                <div className="player-tags">
                    {media.tags.map((t) => {
                        const tagGroupMap = getTagGroupMap(new URLSearchParams(window.location.search).get('tags') || '');
                        const gi = tagGroupMap[t.name];
                        const cls = gi !== undefined ? `tag-badge tag-clickable tag-group-${gi}` : 'tag-badge tag-clickable';
                        return (
                            <span
                                key={t.id}
                                className={cls}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigate('/?tags=' + encodeURIComponent(t.name));
                                }}
                            >
                                {t.name}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
