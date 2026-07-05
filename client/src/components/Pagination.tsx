import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

/**
 * 通用分页组件
 */
export default function Pagination({ page, totalPages, onPageChange }: Props) {
    const { t } = useTranslation();

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

    return (
        <div className="pagination">
            <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                {t('home.prevPage')}
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
                {t('home.nextPage')}
            </button>
        </div>
    );
}
