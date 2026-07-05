import type { Request, Response } from 'express';
import { eq, and, count, isNull, like, or, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index';
import { isString, isArray, isUndefined } from '../utils/env';

/**
 * 获取作者列表（支持分页和搜索）
 * GET /api/authors?page=1&limit=20&search=xxx
 */
export async function listAuthors(req: Request, res: Response): Promise<void> {
    try {
        const db = getDatabase();
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
        const offset = (page - 1) * limit;
        const search = (req.query.search as string)?.trim();

        // 构建 WHERE 条件：搜索名称、别名或链接
        const where = search
            ? or(
                like(schema.authors.name, `%${search}%`),
                sql`EXISTS (SELECT 1 FROM unnest(${schema.authors.altNames}) AS alt WHERE alt ILIKE ${`%${search}%`})`,
                sql`EXISTS (SELECT 1 FROM unnest(${schema.authors.urls}) AS url WHERE url ILIKE ${`%${search}%`})`
            )
            : undefined;

        // 查总数
        const [countResult] = await db
            .select({ total: count() })
            .from(schema.authors)
            .where(where)
            .execute();
        const total = countResult?.total ?? 0;

        const result = await db
            .select({
                id: schema.authors.id,
                name: schema.authors.name,
                altNames: schema.authors.altNames,
                urls: schema.authors.urls,
                mediaCount: count(schema.media.id)
            })
            .from(schema.authors)
            .leftJoin(schema.media, and(eq(schema.media.authorId, schema.authors.id), isNull(schema.media.deletedAt)))
            .where(where)
            .groupBy(schema.authors.id, schema.authors.name, schema.authors.altNames, schema.authors.urls)
            .orderBy(schema.authors.name)
            .limit(limit)
            .offset(offset)
            .execute();

        res.json({
            authors: result,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('[Authors] 获取列表失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 创建作者
 * POST /api/authors
 * Body: { name: string; altNames?: string[]; urls?: string[] }
 */
export async function createAuthor(req: Request, res: Response): Promise<void> {
    try {
        const { name, altNames, urls }: { name?: string; altNames?: string[]; urls?: string[] } = req.body;
        if (!isString(name)) {
            res.status(400).json({ error: 'author.nameEmpty' });
            return;
        }

        const trimmed = name.trim();
        const db = getDatabase();

        // 检查是否已存在
        const existing = await db.select({ id: schema.authors.id }).from(schema.authors).where(eq(schema.authors.name, trimmed)).limit(1).execute();

        if (existing[0]) {
            res.status(409).json({ error: 'author.exists' });
            return;
        }

        const [author] = await db
            .insert(schema.authors)
            .values({
                name: trimmed,
                altNames: isArray(altNames) ? altNames : [],
                urls: isArray(urls) ? urls : []
            })
            .returning()
            .execute();

        res.status(201).json({ author });
    } catch (err) {
        console.error('[Authors] 创建失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 更新作者
 * PUT /api/authors/:id
 * Body: { name?: string; altNames?: string[]; urls?: string[] }
 */
export async function updateAuthor(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id)) {
            res.status(400).json({ error: 'author.invalidParam' });
            return;
        }
        const { name, altNames, urls }: { name?: string; altNames?: string[]; urls?: string[] } = req.body;
        const db = getDatabase();

        const existing = await db.select({ id: schema.authors.id }).from(schema.authors).where(eq(schema.authors.id, id)).limit(1).execute();

        if (!existing[0]) {
            res.status(404).json({ error: 'author.notFound' });
            return;
        }

        const updates: Record<string, unknown> = {};
        if (isString(name)) {
            updates.name = name.trim();
        }
        if (!isUndefined(altNames)) {
            updates.altNames = isArray(altNames) ? altNames : [];
        }
        if (!isUndefined(urls)) {
            updates.urls = isArray(urls) ? urls : [];
        }

        if (Object.keys(updates).length === 0) {
            res.status(400).json({ error: 'author.noUpdate' });
            return;
        }

        await db.update(schema.authors).set(updates).where(eq(schema.authors.id, id)).execute();

        const [author] = await db.select().from(schema.authors).where(eq(schema.authors.id, id)).limit(1).execute();

        res.json({ author });
    } catch (err) {
        console.error('[Authors] 更新失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 删除作者
 * DELETE /api/authors/:id
 */
export async function deleteAuthor(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id)) {
            res.status(400).json({ error: 'author.invalidParam' });
            return;
        }
        const db = getDatabase();

        const existing = await db.select({ id: schema.authors.id }).from(schema.authors).where(eq(schema.authors.id, id)).limit(1).execute();

        if (!existing[0]) {
            res.status(404).json({ error: 'author.notFound' });
            return;
        }

        await db.delete(schema.authors).where(eq(schema.authors.id, id)).execute();

        res.json({ message: 'admin.authorDeleted' });
    } catch (err) {
        console.error('[Authors] 删除失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}
