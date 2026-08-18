import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import type { Media } from '../../types';
import { getTagGroupMap } from '../../utils';
import PlayerMeta from './PlayerMeta';
import Modal from '../../components/feedback/Modal';

function isTrustedImageUrl(src: string): boolean {
    try {
        const url = new URL(src, window.location.origin);
        // 仅本站（同源）图片直接加载；外部图片一律由用户点击确认后加载，不做第三方白名单
        return url.origin === window.location.origin;
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

/** 仅允许安全协议：http/https/mailto 或站内协议（相对路径）；拒绝 javascript:/data:/vbscript:/file: 等危险协议（防 XSS） */
function isSafeLinkHref(href: string): boolean {
    try {
        const url = new URL(href, window.location.origin);
        const p = url.protocol;
        return p === 'http:' || p === 'https:' || p === 'mailto:' || p === window.location.protocol;
    } catch {
        return false;
    }
}

function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
    const { t } = useTranslation();
    const [showWarning, setShowWarning] = useState(false);
    const pendingHref = useRef('');

    // 危险协议（javascript:/data:/vbscript:/file: 等）或无法解析：渲染为纯文本，不产生可点击链接
    if (!href || !isSafeLinkHref(href)) {
        return <span className="markdown-plain-link">{children}</span>;
    }
    if (!isExternalLink(href)) {
        return <a href={href}>{children}</a>;
    }

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        pendingHref.current = href;
        setShowWarning(true);
    };

    const handleConfirm = () => {
        const target = pendingHref.current;
        // 二次校验：仅打开安全协议（防 window.open 执行 javascript:/data:）
        if (isSafeLinkHref(target)) {
            window.open(target, '_blank', 'noopener,noreferrer');
        }
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
                    {t('view.externalLinkWarning', { url: href })}
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
                    <span className="untrusted-placeholder-text">{alt || t('view.untrustedImageNoAlt')}</span>
                    <span className="untrusted-placeholder-hint">{t('view.untrustedImageHint')}</span>
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
                            {descExpanded ? t('common.collapse') : t('common.expand')}
                        </button>
                    )}
                </>
            )}
            {media.tags && media.tags.length > 0 && (() => {
                const tagGroupMap = getTagGroupMap(new URLSearchParams(window.location.search).get('tags') || '');
                return (
                    <div className="player-tags">
                        {media.tags.map((t) => {
                            const gi = tagGroupMap[t.name];
                            const cls = gi !== undefined ? 'tag-badge tag-clickable tag-group-highlight' : 'tag-badge tag-clickable';
                            const hue = gi !== undefined ? (gi * 137.5) % 360 : undefined;
                            return (
                                <span
                                    key={t.id}
                                    className={cls}
                                    style={hue !== undefined ? { '--tag-hue': hue } as React.CSSProperties : undefined}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate('/library?tags=' + encodeURIComponent(t.name));
                                    }}
                                >
                                    {t.name}
                                </span>
                            );
                        })}
                    </div>
                );
            })()}
        </div>
    );
}
