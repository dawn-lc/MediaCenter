import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import type { Author } from '../types';
import { useClickOutside } from '../hooks/useClickOutside';

interface Props {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export default function AuthorSelector({ value, onChange, placeholder }: Props) {
    const { t } = useTranslation();
    const [allAuthors, setAllAuthors] = useState<Author[]>([]);
    const [input, setInput] = useState(value);
    const [showDropdown, setShowDropdown] = useState(false);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const prevValueRef = useRef(value);

    useClickOutside(wrapperRef, () => setShowDropdown(false));

    // 同步外部 value 变化（如编辑弹窗切换媒体时）
    useEffect(() => {
        if (value !== prevValueRef.current) {
            setInput(value);
            prevValueRef.current = value;
        }
    }, [value]);

    useEffect(() => {
        Api.listAuthors()
            .then((data) => setAllAuthors(data.authors || []))
            .catch(() => { });
    }, []);

    // 按相关性排序：前缀匹配优先，包含匹配次之，同时搜索 name 和 altNames
    const filtered = (() => {
        if (!input) return [];
        const q = input.toLowerCase();
        const matched = allAuthors.filter((a) => {
            if (a.name.toLowerCase().includes(q)) return true;
            return a.altNames?.some((alt) => alt.toLowerCase().includes(q)) ?? false;
        });
        matched.sort((a, b) => {
            const aNameStarts = a.name.toLowerCase().startsWith(q) ? 2 : 0;
            const aAltStarts = a.altNames?.some((alt) => alt.toLowerCase().startsWith(q)) ? 1 : 0;
            const bNameStarts = b.name.toLowerCase().startsWith(q) ? 2 : 0;
            const bAltStarts = b.altNames?.some((alt) => alt.toLowerCase().startsWith(q)) ? 1 : 0;
            return bNameStarts + bAltStarts - (aNameStarts + aAltStarts);
        });
        return matched;
    })();

    // 当前下拉中实际展示的列表（用于键盘导航和渲染）
    const displayList = input ? filtered : allAuthors;

    const selectAuthor = (name: string) => {
        setInput(name);
        onChange(name);
        setShowDropdown(false);
        setHighlightIdx(-1);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setInput(v);
        onChange(v);
        setShowDropdown(true);
        setHighlightIdx(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showDropdown && displayList.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIdx((prev) => (prev < displayList.length - 1 ? prev + 1 : 0));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx((prev) => (prev > 0 ? prev - 1 : displayList.length - 1));
                return;
            }
            if (e.key === 'Enter' && highlightIdx >= 0) {
                e.preventDefault();
                selectAuthor(displayList[highlightIdx].name);
                return;
            }
            if (e.key === 'Escape') {
                setShowDropdown(false);
                return;
            }
        }
        if (e.key === 'Enter') {
            setShowDropdown(false);
        }
    };

    return (
        <div className="tag-selector-wrapper" ref={wrapperRef}>
            <div className="pos-relative">
                <input
                    className="form-input"
                    value={input}
                    onChange={handleInputChange}
                    onFocus={() => setShowDropdown(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    autoComplete="off"
                />
                {showDropdown && displayList.length > 0 && (
                    <div className="tag-selector-dropdown">
                        {displayList.map((a, i) => (
                            <div
                                key={a.id}
                                className={`tag-dropdown-item${i === highlightIdx ? ' tag-dropdown-active' : ''}`}
                                onMouseDown={() => selectAuthor(a.name)}
                                onMouseEnter={() => setHighlightIdx(i)}
                            >
                                <span>{a.name}</span>
                                <span className="tag-dropdown-count">{a.mediaCount ?? 0}</span>
                            </div>
                        ))}
                    </div>
                )}
                {showDropdown && input && filtered.length === 0 && allAuthors.length > 0 && (
                    <div className="tag-selector-dropdown">
                        <div className="tag-dropdown-empty">{t('admin.authors.noMatch')}</div>
                    </div>
                )}
            </div>
        </div>
    );
}
