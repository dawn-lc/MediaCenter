import type { ReactNode } from 'react';

interface Props {
    label: string;
    /** 排序字段标识（与后端 sortBy 对应） */
    sortKey: string;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    onSort: (key: string) => void;
    className?: string;
    children?: ReactNode;
}

/** 可点击排序的表头（点击同列切换方向，点击新列切换字段） */
export default function SortableTh({ label, sortKey, sortBy, sortOrder, onSort, className, children }: Props) {
    const active = sortBy === sortKey;
    return (
        <th
            className={`col-sortable${active ? ' col-sortable-active' : ''}${className ? ' ' + className : ''}`}
            onClick={() => onSort(sortKey)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSort(sortKey);
                }
            }}
            aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            {label}
            {active && <span className="sort-indicator">{sortOrder === 'asc' ? ' ↑' : ' ↓'}</span>}
            {children}
        </th>
    );
}
