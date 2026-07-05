import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql, eq, type SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import * as schema from './schema';
import config from '../config';
import { hashPassword } from '../utils/hash';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

/**
 * 从 DATABASE_URL 中提取数据库名
 */
function parseDatabaseName(url: string): string {
    try {
        const u = new URL(url);
        const name = u.pathname.slice(1);
        return name || 'mediacenter';
    } catch {
        return 'mediacenter';
    }
}

/**
 * 替换 DATABASE_URL 中的数据库名
 */
function replaceDatabaseName(url: string, newDb: string): string {
    try {
        const u = new URL(url);
        u.pathname = `/${newDb}`;
        return u.href;
    } catch {
        return url;
    }
}

/**
 * 确保数据库已存在，不存在则自动创建
 */
async function ensureDatabaseExists(): Promise<void> {
    const targetDb = parseDatabaseName(config.databaseUrl);
    const adminUrl = replaceDatabaseName(config.databaseUrl, 'postgres');

    const tempPool = new Pool({ connectionString: adminUrl, max: 1 });
    try {
        const result = await tempPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [targetDb]);
        if (result.rowCount === 0) {
            await tempPool.query(`CREATE DATABASE "${targetDb}"`);
            console.log(`[DB] 数据库 "${targetDb}" 已创建`);
        }
    } finally {
        await tempPool.end();
    }
}

/**
 * 初始化数据库连接池并自动运行迁移
 */
export async function initDatabase(): Promise<ReturnType<typeof drizzle>> {
    if (db) return db;

    console.log('[DB] 初始化');

    // 自动创建数据库（如不存在）
    await ensureDatabaseExists();

    pool = new Pool({
        connectionString: (() => {
            const u = new URL(config.databaseUrl);
            u.searchParams.set('options', '-c timezone=UTC');
            return u.href;
        })(),
        max: 10
    });

    db = drizzle(pool, { schema });

    try {
        // 启用 pg_trgm 扩展（trigram 索引依赖此扩展）
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
        console.log('[DB] pg_trgm 扩展已就绪');
    } catch (err) {
        console.warn('[DB] pg_trgm 扩展启用失败（可能无权限）:', err instanceof Error ? err.message : err);
    }

    // 根据 schema.ts 自动同步表结构
    await syncSchemaInternal(db);

    return db;
}

/**
 * 内部同步表结构（根据 schema.ts 自动执行 drizzle-kit pushSchema）
 */
export async function syncSchemaInternal(dbInstance: ReturnType<typeof drizzle>): Promise<void> {
    try {
        const { pushSchema } = await import('drizzle-kit/api');
        const result = await pushSchema(schema as any, dbInstance as any, ['public'], [], []);
        for (const warning of result.warnings || []) {
            console.warn('[DB] ' + warning);
        }
        if (result.statementsToExecute?.length) {
            await result.apply();
        }
        if (result.hasDataLoss) {
            console.warn('[DB] 存在可能数据丢失的变更，请手动确认');
        }
    } catch (err: unknown) {
        console.warn('[DB] 同步失败:', err instanceof Error ? err.message : err);
    }
}

/**
 * 获取数据库实例
 */
export function getDatabase(): ReturnType<typeof drizzle> {
    if (!db) {
        throw new Error('数据库尚未初始化，请先调用 initDatabase()');
    }
    return db;
}

/**
 * 根据环境变量配置创建/更新管理员账户
 * 每次启动都会用最新的 ADMIN_USERNAME / ADMIN_PASSWORD 覆盖
 */
export async function ensureDefaultUsers(): Promise<void> {
    const db = getDatabase();
    const { admin } = config.defaultUsers;
    const hash = hashPassword(admin.password);

    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, admin.username)).limit(1).execute();

    if (existing.length > 0) {
        await db.update(schema.users).set({ passwordHash: hash, role: 'admin' }).where(eq(schema.users.id, existing[0].id)).execute();
        console.log(`[DB] 管理员 ${admin.username} 已更新`);
        return;
    }

    await db
        .insert(schema.users)
        .values({
            id: uuidv4(),
            username: admin.username,
            passwordHash: hash,
            role: 'admin'
        })
        .execute();
    console.log(`[DB] 管理员账号已创建: ${admin.username}`);
}

/** pg_trgm 相似度函数：similarity(column, 'keyword') */
export function similarity(column: any, value: string): SQL {
    return sql`similarity(${column}, ${value})`;
}

/** PostgreSQL 当前时间戳（SQL 标准，时区感知） */
export function currentTimestamp(): SQL {
    return sql`CURRENT_TIMESTAMP`;
}

/** PostgreSQL 时区间隔：CURRENT_TIMESTAMP + N * INTERVAL '1 day' */
export function intervalDays(days: number): SQL {
    return sql`CURRENT_TIMESTAMP + ${days} * INTERVAL '1 day'`;
}
/**
 * 关闭数据库连接池
 */
export async function closeDatabase(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
        db = null;
        console.log('[DB] 数据库连接池已关闭');
    }
}

export { schema };
