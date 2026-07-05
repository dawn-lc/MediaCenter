import i18n from './i18n';
import { TAG_EXPR_MAX_LENGTH, TAG_EXPR_MAX_DEPTH, BYTE_BASE, BYTE_UNITS, JUST_NOW_THRESHOLD_MS } from './config';

export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(BYTE_BASE));
    return parseFloat((bytes / Math.pow(BYTE_BASE, i)).toFixed(1)) + ' ' + BYTE_UNITS[i];
}

export function formatDate(dateStr: string, t: (key: string, params?: Record<string, unknown>) => string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const locale = i18n.language || 'zh-CN';

    if (isNaN(diff)) return t('time.justNow');
    if (diff < 0) {
        // 未来时间：如果偏差很小（< 1 分钟），可能是时钟抖动，显示刚刚
        if (diff > -JUST_NOW_THRESHOLD_MS) return t('time.justNow');
        // 否则用绝对日期
        return new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(d);
    }
    if (diff < JUST_NOW_THRESHOLD_MS) return t('time.justNow');

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' });

    // 从大到小选择最合适的单位
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31_536_000_000],
        ['month', 2_592_000_000],
        ['week', 604_800_000],
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000]
    ];

    for (const [unit, ms] of units) {
        const value = Math.floor(diff / ms);
        if (value >= 1) {
            // 超过 10 年用绝对日期
            if (unit === 'year' && value >= 10) break;
            return rtf.format(-value, unit);
        }
    }

    // 兜底：绝对日期
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(d);
}

export function getMediaIcon(mimeType: string): string {
    if (!mimeType) return '📁';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.startsWith('image/')) return '🖼️';
    return '📁';
}

export function getMediaType(mimeType: string): 'video' | 'audio' | 'image' | 'other' {
    if (!mimeType) return 'other';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('image/')) return 'image';
    return 'other';
}

export function getMediaTypeLabel(mimeType: string): string {
    const map: Record<string, string> = {
        'video/mp4': 'MP4',
        'video/webm': 'WebM',
        'video/ogg': 'OGG',
        'video/x-matroska': 'MKV',
        'video/quicktime': 'MOV',
        'audio/mpeg': 'MP3',
        'audio/ogg': 'OGG',
        'audio/wav': 'WAV',
        'audio/flac': 'FLAC',
        'audio/webm': 'WebM',
        'image/jpeg': 'JPEG',
        'image/png': 'PNG',
        'image/webp': 'WebP',
        'image/gif': 'GIF'
    };
    return map[mimeType] || (mimeType ? mimeType.split('/')[1]?.toUpperCase() : '未知');
}

/**
 * 标准化 MIME 类型，某些格式需映射为浏览器可识别的类型
 * 例：video/quicktime → video/mp4（MOV 使用 H.264，浏览器支持度更高）
 */
export function normalizeMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'video/quicktime':
            return 'video/mp4';
        case 'video/x-matroska':
            return 'video/webm';
        default:
            return mimeType;
    }
}


export function formatDuration(seconds: number): string {
    if (seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 防抖：延迟执行 fn，如果在等待期内再次调用则重新计时
 */
export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            fn(...args);
            timer = null;
        }, delay);
    };
}

/**
 * 验证 URL 是否为安全的 HTTP/HTTPS 链接
 */
export function isValidHttpUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * ===== 标签表达式 AST 解析器（与后端 tagParser.ts 一致） =====
 * 支持括号、& (AND)、| (OR)
 * 语法:
 *   expr     → or_expr
 *   or_expr  → and_expr ('|' and_expr)*
 *   and_expr → primary ('&' primary)*
 *   primary  → '(' expr ')' | tag_name
 */

type AstNode = { type: 'tag'; name: string } | { type: 'and'; left: AstNode; right: AstNode } | { type: 'or'; left: AstNode; right: AstNode };

function tokenize(expr: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (ch === ' ' || ch === '\t') {
            i++;
            continue;
        }
        if ('()&|'.includes(ch)) {
            tokens.push(ch);
            i++;
        } else {
            let name = '';
            while (i < expr.length && !'()&| \t'.includes(expr[i])) {
                name += expr[i];
                i++;
            }
            if (name) tokens.push(name);
        }
    }
    return tokens;
}

const MAX_EXPR_LENGTH = TAG_EXPR_MAX_LENGTH;
const MAX_DEPTH = TAG_EXPR_MAX_DEPTH;

function parseOr(tokens: string[], i: number, depth: number): { node: AstNode; i: number } {
    if (depth > MAX_DEPTH) throw new Error('标签表达式嵌套过深');
    let { node, i: next } = parseAnd(tokens, i, depth + 1);
    while (next < tokens.length && tokens[next] === '|') {
        const { node: right, i: n } = parseAnd(tokens, next + 1, depth + 1);
        node = { type: 'or', left: node, right };
        next = n;
    }
    return { node, i: next };
}

function parseAnd(tokens: string[], i: number, depth: number): { node: AstNode; i: number } {
    if (depth > MAX_DEPTH) throw new Error('标签表达式嵌套过深');
    let { node, i: next } = parsePrimary(tokens, i, depth + 1);
    while (next < tokens.length && tokens[next] === '&') {
        const { node: right, i: n } = parsePrimary(tokens, next + 1, depth + 1);
        node = { type: 'and', left: node, right };
        next = n;
    }
    return { node, i: next };
}

function parsePrimary(tokens: string[], i: number, depth: number): { node: AstNode; i: number } {
    if (depth > MAX_DEPTH) throw new Error('标签表达式嵌套过深');
    if (i >= tokens.length) throw new Error('表达式意外结束');
    if (tokens[i] === '(') {
        const { node, i: next } = parseOr(tokens, i + 1, depth + 1);
        if (next >= tokens.length || tokens[next] !== ')') {
            throw new Error('缺少右括号 )');
        }
        return { node, i: next + 1 };
    }
    if (tokens[i] === ')' || tokens[i] === '&' || tokens[i] === '|') {
        throw new Error(`意外的符号: ${tokens[i]}`);
    }
    return { node: { type: 'tag', name: tokens[i] }, i: i + 1 };
}

function parseTagExpr(expr: string): AstNode | null {
    if (expr.length > MAX_EXPR_LENGTH) throw new Error(`标签表达式过长（上限 ${MAX_EXPR_LENGTH} 字符）`);
    const tokens = tokenize(expr);
    if (tokens.length === 0) return null;
    const { node } = parseOr(tokens, 0, 0);
    return node;
}

/**
 * 遍历 AST 按顶层 OR 分割分组
 * 将 OR 链压平，每个分支独立分组
 * 例如:
 *   "A&B|C"               → OR(AND(A,B), C)       → A:0, B:0, C:1
 *   "(A&B)|C|D"           → OR(OR(AND(A,B),C),D)  → A:0, B:0, C:1, D:2
 *   "A&(B|C)"             → AND(A, OR(B,C))       → A:0, B:0, C:0  (无顶层 OR，全一组)
 *   "A&(B|C)|D"           → OR(AND(A,OR(B,C)),D)  → A:0, B:0, C:0, D:1
 */
function assignGroupIndices(ast: AstNode): Record<string, number> {
    const map: Record<string, number> = {};

    // 压平 OR 链：OR(OR(A,B),C) → [A, B, C]
    function flattenOr(node: AstNode): AstNode[] {
        if (node.type === 'or') {
            return [...flattenOr(node.left), ...flattenOr(node.right)];
        }
        return [node];
    }

    const groups = flattenOr(ast);

    groups.forEach((group, gi) => {
        // 遍历该分支内的所有标签，赋予同一组索引
        function assign(node: AstNode) {
            if (node.type === 'tag') {
                if (map[node.name] === undefined) map[node.name] = gi;
            } else {
                assign(node.left);
                assign(node.right);
            }
        }
        assign(group);
    });

    return map;
}

/**
 * 解析标签表达式，返回每个标签所属的分组索引
 * 基于 AST 实现，与后端 parsing 逻辑完全一致
 * 用于给不同筛选分组分配不同高亮颜色
 */
export function getTagGroupMap(expr: string): Record<string, number> {
    if (!expr) return {};
    try {
        const ast = parseTagExpr(expr);
        if (!ast) return {};
        return assignGroupIndices(ast);
    } catch {
        // 表达式非法时回退到空映射
        return {};
    }
}
