// ---------------------------------------------------------------------------
// 调试日志工具 —— 只在开发环境下输出
// ---------------------------------------------------------------------------

const isDev = import.meta.env.DEV;

/** 按 namespace 输出调试日志，生产构建中无调用痕迹 */
export function createLogger(namespace: string) {
    if (!isDev) return () => { };

    return (msg: string, ...args: unknown[]) => {
        console.log(`[${namespace}] ${msg}`, ...args);
    };
}
