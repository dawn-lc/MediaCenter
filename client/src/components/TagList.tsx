import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTagGroupMap } from '../utils';

interface Props {
    tags: { id: string; name: string }[];
    tagExpr?: string;
    onTagClick?: (tagName: string) => void;
    collapsed?: boolean;
}

/**
 * 通用标签列表组件，支持溢出折叠
 */
export default function TagList({ tags, tagExpr = '', onTagClick, collapsed: defaultCollapsed = true }: Props) {
    const { t } = useTranslation();
    const rowRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [overflow, setOverflow] = useState(false);
    const tagGroupMap = getTagGroupMap(tagExpr);

    useEffect(() => {
        const el = rowRef.current;
        if (!el || tags.length === 0) return;
        const check = () => {
            if (!open) setOverflow(el.scrollHeight > el.clientHeight);
        };
        const ro = new ResizeObserver(check);
        ro.observe(el);
        if (!open) check();
        return () => ro.disconnect();
    }, [tags, open]);

    if (tags.length === 0) return null;

    return (
        <div className="tags-row">
            <div className={`tags-row-inner${defaultCollapsed && !open ? ' collapsed' : ''}`} ref={rowRef}>
                {tags.map((tag) => {
                    const gi = tagGroupMap[tag.name];
                    const cls = gi !== undefined
                        ? `media-card-tag tag-clickable tag-group-${gi}`
                        : 'media-card-tag tag-clickable';
                    return (
                        <span
                            key={tag.id}
                            className={cls}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTagClick?.(tag.name);
                            }}
                        >
                            {tag.name}
                        </span>
                    );
                })}
            </div>
            {defaultCollapsed && overflow && (
                <span
                    className="media-card-tag tag-expand-toggle"
                    onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                >
                    {open ? t('player.collapse') : t('player.expand')}
                </span>
            )}
        </div>
    );
}
