import i18n from '../i18n';
import { TAG_EXPR_MAX_LENGTH, TAG_EXPR_MAX_DEPTH, BYTE_BASE, BYTE_UNITS, JUST_NOW_THRESHOLD_MS } from '../config';

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
 * ===== 标签表达式 AST 解析器（与后端 exprParser.ts 一致） =====
 * 支持括号、& (AND)、| (OR)、! (NOT/排除)、引号包裹
 * 语法:
 *   expr     → or_expr
 *   or_expr  → and_expr ('|' and_expr)*
 *   and_expr → primary ('&' primary)*
 *   primary  → '!' primary | '(' expr ')' | '"'...'"' | "'"..."'" | leaf_name
 */

type AstNode = { type: 'leaf'; name: string } | { type: 'not'; child: AstNode } | { type: 'and'; left: AstNode; right: AstNode } | { type: 'or'; left: AstNode; right: AstNode };

function tokenize(expr: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }
        if ('()&|!\n\r'.includes(ch)) {
            tokens.push(ch);
            i++;
        } else if (ch === '"' || ch === "'") {
            // 引号字符串：支持转义 \\  \"  \'
            const quote = ch;
            let name = '';
            i++;
            while (i < expr.length && expr[i] !== quote) {
                if (expr[i] === '\\' && i + 1 < expr.length) {
                    i++;
                    name += expr[i];
                } else {
                    name += expr[i];
                }
                i++;
            }
            if (i >= expr.length) break;
            i++;
            tokens.push(name);
        } else {
            let name = '';
            while (i < expr.length && !'()&|! \t\n\r"\' '.includes(expr[i])) {
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

    // NOT / 排除: !X
    if (tokens[i] === '!') {
        const { node: child, i: next } = parsePrimary(tokens, i + 1, depth + 1);
        return { node: { type: 'not', child }, i: next };
    }

    if (tokens[i] === '(') {
        const { node, i: next } = parseOr(tokens, i + 1, depth + 1);
        if (next >= tokens.length || tokens[next] !== ')') {
            throw new Error('缺少右括号 )');
        }
        return { node, i: next + 1 };
    }
    if (tokens[i] === ')' || tokens[i] === '&' || tokens[i] === '|' || tokens[i] === '!') {
        throw new Error(`意外的符号: ${tokens[i]}`);
    }
    return { node: { type: 'leaf', name: tokens[i] }, i: i + 1 };
}

function parseTagExpr(expr: string): AstNode | null {
    if (expr.length > MAX_EXPR_LENGTH) throw new Error(`标签表达式过长（上限 ${MAX_EXPR_LENGTH} 字符）`);
    const tokens = tokenize(expr);
    if (tokens.length === 0) return null;
    const { node, i } = parseOr(tokens, 0, 0);
    if (i < tokens.length) throw new Error(`多余的字符: '${tokens[i]}'`);
    return node;
}

/**
 * 遍历 AST 按顶层 OR 分割分组
 * 两趟：先压平顶层 OR 链，再逐组分配叶子
 * 例如:
 *   "A&B|C"               → A:0, B:0, C:1
 *   "A&(B|C)"             → A:0, B:0, C:0  (内层 OR 不裂分)
 */
function assignGroupIndices(ast: AstNode): Record<string, number> {
    const map: Record<string, number> = {};

    // 压平顶层 OR 链到数组（避免中间数组展开，手动 push）
    function flattenOr(node: AstNode, out: AstNode[]) {
        if (node.type === 'or') {
            flattenOr(node.left, out);
            flattenOr(node.right, out);
        } else {
            out.push(node);
        }
    }

    const groups: AstNode[] = [];
    flattenOr(ast, groups);

    for (let gi = 0; gi < groups.length; gi++) {
        function assign(node: AstNode) {
            if (node.type === 'leaf') {
                if (map[node.name] === undefined) map[node.name] = gi;
            } else if (node.type === 'not') {
                assign(node.child);
            } else {
                assign(node.left);
                assign(node.right);
            }
        }
        assign(groups[gi]);
    }

    return map;
}

/**
 * 解析标签表达式，返回每个标签所属的分组索引（用于高亮颜色）
 */
export function getTagGroupMap(expr: string): Record<string, number> {
    if (!expr) return {};
    try {
        const ast = parseTagExpr(expr);
        if (!ast) return {};
        return assignGroupIndices(ast);
    } catch {
        return {};
    }
}
