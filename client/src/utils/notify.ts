/**
 * notify —— 全前端唯一的 toast 出口
 * 所有成功 / 错误 / loading 提示都经过这里，页面组件不再直接调用 sonner 的 toast.*
 *
 * 分工：
 * - 错误提示：由全局错误处理器（queryClient / notify.promise / notify.run）统一弹出，
 *   此处 error() 是唯一实现；会话过期已由 auth store 全局提示，自动静默
 * - 成功 / loading：通过 promise()（操作三态）与 success() 收敛到这里
 */
import { toast, type ExternalToast } from 'sonner';
import { TOAST_DURATION } from '../config';
import { ApiError } from '../apiError';

export type ToastOptions = ExternalToast;

/** error() 的展示选项：fallback 为兜底文案，其余透传给 toast */
export interface ErrorToastOptions extends ToastOptions {
    /** 兜底文案：err 既不是 Error 也不是字符串时使用 */
    fallback?: string;
}

interface PromiseToastOptions<T> {
    /** loading 提示文案（可省略，省略则无 loading toast） */
    loading?: string;
    /** 成功提示文案，或根据返回数据动态生成 */
    success?: string | ((data: T) => string | void);
    /** 成功后的副作用（导航、刷新列表等），仅在成功时执行 */
    onSuccess?: (data: T) => void;
    toastOptions?: ToastOptions;
}

export const notify = {
    /** 成功提示 */
    success(message: string, opts?: ToastOptions): void {
        toast.success(message, { duration: TOAST_DURATION, ...opts });
    },

    /**
     * 错误提示
     * - 会话过期（isAuthExpired）已由 auth store 全局提示，这里静默
     * - 接受 Error / 字符串 / 兜底文案
     */
    error(err: unknown, opts?: ErrorToastOptions): void {
        if (err instanceof ApiError && err.isAuthExpired) return;
        // 断网时静默：离线横幅已提示，避免与大量网络错误 toast 叠加
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        const { fallback, ...toastOpts } = opts ?? {};
        let message: string;
        if (typeof err === 'string') message = err;
        else if (err instanceof Error) message = err.message;
        else message = fallback ?? '操作失败';
        toast.error(message, { duration: TOAST_DURATION, ...toastOpts });
    },

    /**
     * 异步操作三态封装：loading → success/error 全自动
     * - 失败时自行弹错误 toast（会话过期自动静默）；返回 undefined
     */
    async promise<T>(promise: Promise<T>, opts: PromiseToastOptions<T>): Promise<T | undefined> {
        const id = opts.loading ? toast.loading(opts.loading, opts.toastOptions) : undefined;
        try {
            const data = await promise;
            if (id !== undefined) toast.dismiss(id);
            opts.onSuccess?.(data);
            const msg = typeof opts.success === 'function' ? opts.success(data) : opts.success;
            if (msg) toast.success(msg, opts.toastOptions);
            return data;
        } catch (err) {
            if (id !== undefined) toast.dismiss(id);
            // 传输层不再弹 toast，这里补上错误提示
            notify.error(err, opts.toastOptions);
            return undefined;
        }
    },

    /** 数据加载：失败自动提示（会话过期静默），返回 undefined */
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
        try {
            return await fn();
        } catch (err) {
            notify.error(err);
            return undefined;
        }
    }
};
