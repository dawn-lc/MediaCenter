/**
 * 标签表达式解析器
 * 支持括号、& (AND)、| (OR)
 *
 * 语法:
 *   expr     → or_expr
 *   or_expr  → and_expr ('|' and_expr)*
 *   and_expr → primary ('&' primary)*
 *   primary  → '(' expr ')' | tag_name
 *
 * 示例:
 *   "A&B|C"       → OR(AND(A, B), C)
 *   "A&(B|C)"     → AND(A, OR(B, C))
 *   "A&(B|C)|D&(E|F)" → OR(AND(A, OR(B, C)), AND(D, OR(E, F)))
 */

import config from '../config';

export type AstNode = { type: 'tag'; name: string } | { type: 'and'; left: AstNode; right: AstNode } | { type: 'or'; left: AstNode; right: AstNode };

/**
 * 将标签表达式解析为 AST
 */
export function parseTagExpr(expr: string): AstNode | null {
    if (expr.length > config.maxExprLength) {
        throw new Error(`标签表达式过长（上限 ${config.maxExprLength} 字符）`);
    }
    const tokens = tokenize(expr);
    if (tokens.length === 0) return null;
    const { node } = parseOr(tokens, 0, 0);
    return node;
}

/**
 * 从 AST 中提取所有标签名（去重）
 */
export function extractTagNames(node: AstNode): string[] {
    const names: string[] = [];
    function walk(n: AstNode) {
        if (n.type === 'tag') names.push(n.name);
        else {
            walk(n.left);
            walk(n.right);
        }
    }
    walk(node);
    return names.unique();
}

// ========== 词法分析 ==========

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

// ========== 语法分析（递归下降）==========

function parseOr(tokens: string[], i: number, depth: number): { node: AstNode; i: number } {
    if (depth > config.maxDepth) throw new Error('标签表达式嵌套过深');
    let { node, i: next } = parseAnd(tokens, i, depth + 1);
    while (next < tokens.length && tokens[next] === '|') {
        const { node: right, i: n } = parseAnd(tokens, next + 1, depth + 1);
        node = { type: 'or', left: node, right };
        next = n;
    }
    return { node, i: next };
}

function parseAnd(tokens: string[], i: number, depth: number): { node: AstNode; i: number } {
    if (depth > config.maxDepth) throw new Error('标签表达式嵌套过深');
    let { node, i: next } = parsePrimary(tokens, i, depth + 1);
    while (next < tokens.length && tokens[next] === '&') {
        const { node: right, i: n } = parsePrimary(tokens, next + 1, depth + 1);
        node = { type: 'and', left: node, right };
        next = n;
    }
    return { node, i: next };
}

function parsePrimary(tokens: string[], i: number, depth: number): { node: AstNode; i: number } {
    if (depth > config.maxDepth) throw new Error('标签表达式嵌套过深');
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

// ========== AST 求值（用于后端数据库查询）==========

import { eq, or, sql, inArray } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index';

/**
 * 对 AST 进行数据库求值，返回匹配的媒体 ID 集合
 * 每遇到叶子节点执行一次 DB 查询，AND/OR 在内存中做集合交/并
 */
export async function evaluateTagAst(node: AstNode): Promise<Set<string>> {
    const db = getDatabase();

    if (node.type === 'tag') {
        const rows = await db
            .select({ mediaId: schema.mediaTags.mediaId })
            .from(schema.mediaTags)
            .innerJoin(schema.tags, eq(schema.mediaTags.tagId, schema.tags.id))
            .where(
                or(
                    eq(schema.tags.name, node.name),
                    sql`${node.name} = ANY(${schema.tags.altNames})`
                )
            )
            .execute();
        return new Set(rows.map((r) => r.mediaId));
    }

    if (node.type === 'and') {
        // 短路优化：先算数据量较小的一边
        const [left, right] = await Promise.all([evaluateTagAst(node.left), evaluateTagAst(node.right)]);
        const smaller = left.size <= right.size ? left : right;
        const larger = left.size <= right.size ? right : left;
        return new Set([...smaller].filter((id) => larger.has(id))); // 交集
    }

    // OR
    const [left, right] = await Promise.all([evaluateTagAst(node.left), evaluateTagAst(node.right)]);
    const union = new Set(left);
    for (const id of right) union.add(id);
    return union; // 并集
}

/**
 * 对 AST 进行作者维度求值，返回匹配的媒体 ID 集合
 * 叶子节点：匹配 authors.name 或 authors.altNames，再反查 media
 */
export async function evaluateAuthorAst(node: AstNode): Promise<Set<string>> {
    const db = getDatabase();

    if (node.type === 'tag') {
        const authorRows = await db
            .select({ id: schema.authors.id })
            .from(schema.authors)
            .where(
                or(
                    eq(schema.authors.name, node.name),
                    sql`${node.name} = ANY(${schema.authors.altNames})`
                )
            )
            .execute();
        const authorIds = authorRows.map((a) => a.id);
        if (authorIds.length === 0) return new Set();

        const mediaRows = await db
            .select({ id: schema.media.id })
            .from(schema.media)
            .where(inArray(schema.media.authorId, authorIds))
            .execute();
        return new Set(mediaRows.map((r) => r.id));
    }

    if (node.type === 'and') {
        const [left, right] = await Promise.all([evaluateAuthorAst(node.left), evaluateAuthorAst(node.right)]);
        const smaller = left.size <= right.size ? left : right;
        const larger = left.size <= right.size ? right : left;
        return new Set([...smaller].filter((id) => larger.has(id)));
    }

    // OR
    const [left, right] = await Promise.all([evaluateAuthorAst(node.left), evaluateAuthorAst(node.right)]);
    const union = new Set(left);
    for (const id of right) union.add(id);
    return union;
}
