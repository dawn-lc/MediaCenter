import { QueryCache, MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiError';
import { notify } from './utils/notify';

/**
 * 全局错误处理：所有 Query / Mutation 的错误统一在此弹 toast。
 * - 会话过期（isAuthExpired）：已由 auth store 全局提示，此处静默
 * - 其余错误：弹错误 toast；可用 meta.silent 关闭（后台静默刷新等）
 */
function handleError(error: unknown, meta?: { silent?: boolean }) {
    if (error instanceof ApiError && error.isAuthExpired) return;
    if (meta?.silent) return;
    notify.error(error);
}

export const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError: (error, query) => handleError(error, query.meta as { silent?: boolean } | undefined)
    }),
    mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) =>
            handleError(error, mutation.meta as { silent?: boolean } | undefined)
    }),
    defaultOptions: {
        queries: {
            // 失败不自动重试：错误已由全局 handler 弹 toast，避免对偶发错误无限重试
            retry: false,
            // 30s 内复用缓存；SSE 推送 / 手动 refetch 不受 staleTime 影响
            staleTime: 30_000,
            refetchOnWindowFocus: false
        }
    }
});
