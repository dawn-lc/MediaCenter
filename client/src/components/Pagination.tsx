import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

/** 移动端断点：与 responsive.css 保持一致 */
const COMPACT_MQ = '(max-width: 768px)';

/**
 * 通用分页组件
 * - 桌面：完整分页（首末页 + 省略号 + 页码窗口）
 * - 移动端：极简分页「‹ 当前页/总页数 ›」，避免窄屏溢出与换行
 */
export default function Pagination({ page, totalPages, onPageChange }: Props) {
    const { t } = useTranslation();
    const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_MQ).matches);

    useEffect(() => {
        const mq = window.matchMedia(COMPACT_MQ);
        const handler = (e: MediaQueryListEvent) => setCompact(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const pages = useMemo(() => {
        const result: (number | '...')[] = [];
        if (totalPages <= 1) return result;
        const cur = page;
        if (cur > 3) {
            result.push(1);
            if (cur > 4) result.push('...');
        }
        for (let i = Math.max(1, cur - 2); i <= Math.min(totalPages, cur + 2); i++) result.push(i);
        if (cur < totalPages - 2) {
            if (cur < totalPages - 3) result.push('...');
            result.push(totalPages);
        }
        return result;
    }, [page, totalPages]);

    if (totalPages <= 1) return null;

    // 移动端极简分页：固定 3 个元素，任何页码宽度都不会溢出
    if (compact) {
        return (
            <div className="pagination">
                <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label={t('library.prevPage')}>
                    ‹
                </button>
                <span className="pagination-info">
                    {page} / {totalPages}
                </span>
                <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label={t('library.nextPage')}>
                    ›
                </button>
            </div>
        );
    }

    return (
        <div className="pagination">
            <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                {t('library.prevPage')}
            </button>
            {pages.map((p, i) =>
                p === '...' ? (
                    <span key={`e${i}`} className="page-info">...</span>
                ) : (
                    <button key={p} className={p === page ? 'active' : ''} onClick={() => onPageChange(p)}>
                        {p}
                    </button>
                )
            )}
            <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                {t('library.nextPage')}
            </button>
        </div>
    );
}
