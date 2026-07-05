import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import type { Tag } from '../types';
import { useClickOutside } from '../hooks/useClickOutside';

interface Props {
    selected: string[];
    onChange: (tags: string[]) => void;
    placeholder?: string;
}

export default function TagSelector({ selected, onChange, placeholder }: Props) {
    const { t } = useTranslation();
    const [allTags, setAllTags] = useState<Tag[]>([]);
    const [input, setInput] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useClickOutside(wrapperRef, () => setShowDropdown(false));

    useEffect(() => {
        Api.listTags()
            .then((data) => setAllTags(data.tags || []))
            .catch(() => { });
    }, []);

    // 按相关性排序：前缀匹配优先，包含匹配次之，支持别名搜索
    const filteredTags = (() => {
        if (!input) return [];
        const q = input.toLowerCase();
        const matched = allTags.filter((t) => {
            if (selected.includes(t.name)) return false;
            if (t.name.toLowerCase().includes(q)) return true;
            // 别名搜索
            if (t.altNames && t.altNames.some((a) => a.toLowerCase().includes(q))) return true;
            return false;
        });
        matched.sort((a, b) => {
            const aStarts = a.name.toLowerCase().startsWith(q) ? 1 : 0;
            const aAlt = a.altNames?.some((n) => n.toLowerCase().startsWith(q)) ? 0.5 : 0;
            const bStarts = b.name.toLowerCase().startsWith(q) ? 1 : 0;
            const bAlt = b.altNames?.some((n) => n.toLowerCase().startsWith(q)) ? 0.5 : 0;
            return bStarts + bAlt - (aStarts + aAlt);
        });
        return matched;
    })();

    const addTag = (name: string) => {
        if (!name.trim()) return;
        if (!selected.includes(name.trim())) {
            onChange([...selected, name.trim()]);
        }
        setInput('');
        setShowDropdown(false);
    };

    const removeTag = (name: string) => {
        onChange(selected.filter((t) => t !== name));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showDropdown && filteredTags.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIdx((prev) => (prev < filteredTags.length - 1 ? prev + 1 : 0));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx((prev) => (prev > 0 ? prev - 1 : filteredTags.length - 1));
                return;
            }
            if (e.key === 'Enter' && highlightIdx >= 0) {
                e.preventDefault();
                addTag(filteredTags[highlightIdx].name);
                return;
            }
            if (e.key === 'Escape') {
                setShowDropdown(false);
                return;
            }
        }
        if (e.key === 'Enter' && input.trim()) {
            e.preventDefault();
            addTag(input.trim());
        } else if (e.key === 'Backspace' && !input && selected.length > 0) {
            removeTag(selected[selected.length - 1]);
        }
    };

    return (
        <div className="tag-selector-wrapper" ref={wrapperRef}>
            {selected.length > 0 && (
                <div className="tag-selector-tags">
                    {selected.map((name) => (
                        <span key={name} className="tag-badge">
                            {name}
                            <button type="button" className="tag-remove" onClick={() => removeTag(name)}>
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className="pos-relative">
                <input
                    className="form-input tag-selector-input"
                    type="text"
                    value={input}
                    onChange={(e) => {
                        setInput(e.target.value);
                        setShowDropdown(true);
                        setHighlightIdx(-1);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder || t('common.tagsPlaceholder')}
                />
                {showDropdown && filteredTags.length > 0 && (
                    <div className="tag-selector-dropdown">
                        {filteredTags.map((t, i) => (
                            <div
                                key={t.id}
                                className={`tag-dropdown-item${i === highlightIdx ? ' tag-dropdown-active' : ''}`}
                                onMouseDown={() => addTag(t.name)}
                                onMouseEnter={() => setHighlightIdx(i)}
                            >
                                {t.name}
                                {t.altNames && t.altNames.length > 0 && (
                                    <span className="tag-dropdown-alt"
                                    >
                                        {t.altNames.join(', ')}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
