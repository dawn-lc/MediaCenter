/**
 * 通用表达式解析器
 * 支持括号、& (AND)、| (OR)、! (NOT/排除)
 *
 * 语法:
 *   expr     → or_expr
 *   or_expr  → and_expr ('|' and_expr)*
 *   and_expr → primary ('&' primary)*
 *   primary  → '!' primary | '(' expr ')' | leaf_name
 *
 * 示例:
 *   "A&B|C"       → OR(AND(A, B), C)
 *   "A&(B|C)"     → AND(A, OR(B, C))
 *   "A&!B"        → AND(A, NOT(B))         —— 排除 B
 *   "A&!(B|C)"    → AND(A, NOT(OR(B, C)))  —— 排除 B 或 C
 */

import config from '../config';

// ========== AST 类型 ==========

export type ExprNode =
    | { type: 'leaf'; name: string }
    | { type: 'not'; child: ExprNode }
    | { type: 'and'; left: ExprNode; right: ExprNode }
    | { type: 'or'; left: ExprNode; right: ExprNode };

// ========== 词法分析 ==========

/**
 * 将原始表达式字符串拆分为 token 数组
 */
export function tokenize(expr: string): string[] {
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
            // 引号字符串：内部支持转义 \\  \"  \'
            const quote = ch;
            let name = '';
            i++; // 跳过开引号
            while (i < expr.length && expr[i] !== quote) {
                if (expr[i] === '\\' && i + 1 < expr.length) {
                    i++; // 跳过反斜杠
                    name += expr[i]; // 转义后的字符（含 \" \' \\）
                } else {
                    name += expr[i];
                }
                i++;
            }
            if (i >= expr.length) {
                throw new Error(`缺少闭合引号: ${quote}`);
            }
            i++; // 跳过闭引号
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

// ========== 语法分析（递归下降）==========

function parseOr(tokens: string[], i: number, depth: number): { node: ExprNode; i: number } {
    if (depth > config.maxDepth) throw new Error('表达式嵌套过深');
    let { node, i: next } = parseAnd(tokens, i, depth + 1);
    while (next < tokens.length && tokens[next] === '|') {
        const { node: right, i: n } = parseAnd(tokens, next + 1, depth + 1);
        node = { type: 'or', left: node, right };
        next = n;
    }
    return { node, i: next };
}

function parseAnd(tokens: string[], i: number, depth: number): { node: ExprNode; i: number } {
    if (depth > config.maxDepth) throw new Error('表达式嵌套过深');
    let { node, i: next } = parsePrimary(tokens, i, depth + 1);
    while (next < tokens.length && tokens[next] === '&') {
        const { node: right, i: n } = parsePrimary(tokens, next + 1, depth + 1);
        node = { type: 'and', left: node, right };
        next = n;
    }
    return { node, i: next };
}

function parsePrimary(tokens: string[], i: number, depth: number): { node: ExprNode; i: number } {
    if (depth > config.maxDepth) throw new Error('表达式嵌套过深');
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

// ========== 公开 API ==========

/**
 * 将表达式字符串解析为 AST
 */
export function parseExpr(expr: string): ExprNode | null {
    if (expr.length > config.maxExprLength) {
        throw new Error(`表达式过长（上限 ${config.maxExprLength} 字符）`);
    }
    const tokens = tokenize(expr);
    if (tokens.length === 0) return null;
    const { node, i } = parseOr(tokens, 0, 0);
    if (i < tokens.length) {
        throw new Error(`多余的字符: '${tokens[i]}'（位置 ${i}）`);
    }
    return node;
}

/**
 * 从 AST 中提取所有叶子节点名称（去重）
 * NOT 节点不影响叶子提取，仍包含被排除的名称
 */
export function extractLeafNames(node: ExprNode): string[] {
    const names: string[] = [];
    function walk(n: ExprNode) {
        if (n.type === 'leaf') { names.push(n.name); }
        else if (n.type === 'not') { walk(n.child); }
        else { walk(n.left); walk(n.right); }
    }
    walk(node);
    return [...new Set(names)];
}

/**
 * 遍历 AST 的所有叶子节点，执行回调
 */
export function walkLeaves(node: ExprNode, fn: (name: string) => void): void {
    if (node.type === 'leaf') {
        fn(node.name);
    } else if (node.type === 'not') {
        walkLeaves(node.child, fn);
    } else {
        walkLeaves(node.left, fn);
        walkLeaves(node.right, fn);
    }
}

/**
 * 对 AST 进行归约求值
 * - 叶子节点: 调用 leafFn(name) 获取集合
 * - NOT:       从 universe 中减去 child 的结果（需要提供 universe）
 * - AND:       交集
 * - OR:        并集
 *
 * @param node     AST 根节点
 * @param leafFn   叶子求值函数：(name) => Promise<Set<T>>
 * @param universe 全集（NOT 运算必需）。可以是 Set<T> 或 () => Promise<Set<T>>
 */
export async function evaluateExpr<T>(
    node: ExprNode,
    leafFn: (name: string) => Promise<Set<T>>,
    universe?: Set<T> | (() => Promise<Set<T>>)
): Promise<Set<T>> {
    if (node.type === 'leaf') {
        return leafFn(node.name);
    }

    if (node.type === 'not') {
        const inner = await evaluateExpr(node.child, leafFn, universe);
        if (!universe) {
            throw new Error('排除语法（!）需要提供全集（universe）参数');
        }
        const u = typeof universe === 'function' ? await universe() : universe;
        return new Set([...u].filter((id) => !inner.has(id)));
    }

    if (node.type === 'and') {
        const [left, right] = await Promise.all([
            evaluateExpr(node.left, leafFn, universe),
            evaluateExpr(node.right, leafFn, universe),
        ]);
        // 短路：先遍历较小的集合
        const smaller = left.size <= right.size ? left : right;
        const larger = left.size <= right.size ? right : left;
        return new Set([...smaller].filter((id) => larger.has(id)));
    }

    // OR
    const [left, right] = await Promise.all([
        evaluateExpr(node.left, leafFn, universe),
        evaluateExpr(node.right, leafFn, universe),
    ]);
    const union = new Set(left);
    for (const id of right) union.add(id);
    return union;
}
