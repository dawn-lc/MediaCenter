/**
 * API 请求错误（由 api.ts 的 request() 抛出，notify 模块据此区分静默与文案）
 * 单独成文件：避免 notify.ts 与 api.ts 互相引用形成循环依赖
 */
export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        /** 会话已过期（令牌失效），已由全局统一提示，调用方应静默 */
        public isAuthExpired = false
    ) {
        super(message);
        this.name = 'ApiError';
    }
}
