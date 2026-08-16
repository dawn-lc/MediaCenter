import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql, eq, type SQL } from 'drizzle-orm';
import { uuidv4 } from '../utils/uuid';
import { randomBytes } from 'node:crypto';
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
        max: config.dbPoolSize,
        // 闲置 30s 断开，防止连接堆积
        idleTimeoutMillis: 30_000,
        // 连接最大存活时间，避免长时间连接被 PGBouncer 等中间件断开
        maxLifetimeSeconds: 60 * 30,
    });

    db = drizzle({ client: pool });

    try {
        // 启用 pg_trgm 扩展（trigram 索引依赖此扩展）
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
        console.log('[DB] pg_trgm 扩展已就绪');
        // 启用 vector 扩展（语义搜索 HNSW 索引依赖；未安装时失败不影响启动，搜索自动回退 trgm）
        try {
            await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
            console.log('[DB] vector 扩展已就绪');
        } catch (e) {
            console.warn('[DB] vector 扩展启用失败(语义搜索将回退 pg_trgm):', e instanceof Error ? e.message : e);
        }
    } catch (err) {
        console.warn('[DB] pg_trgm 扩展启用失败（可能无权限）:', err instanceof Error ? err.message : err);
    }

    // 根据 schema.ts 自动同步表结构
    await syncSchemaInternal(db);

    // 外键删除策略对齐（pushSchema 不比较 ON DELETE 动作，需运行时校验并重建）
    await ensureForeignKeyPolicies();

    // refresh token 过期自动清理（数据库触发器 + 启动清理）
    await ensureRefreshTokenCleanup();

    return db;
}

/**
 * 外键删除策略对齐：确保 media.uploader_id → users.id 为 ON DELETE RESTRICT
 * drizzle-kit pushSchema 不比较 FK 的 ON DELETE 动作，若历史库中为 CASCADE 需在此重建。
 * PostgreSQL DDL 支持事务：重建失败会回滚，旧约束保持原状，下次启动重试。
 */
async function ensureForeignKeyPolicies(): Promise<void> {
    try {
        // media.uploader_id → users.id：要求 ON DELETE RESTRICT（删除用户前必须先转移其媒体）
        const res = await pool!.query(`
            SELECT conname, confdeltype
            FROM pg_constraint
            WHERE conrelid = 'media'::regclass AND contype = 'f' AND confrelid = 'users'::regclass
        `);
        const fk = res.rows[0] as { conname: string; confdeltype: string } | undefined;
        if (!fk) return; // 约束尚不存在（新库），由 pushSchema 按 schema.ts 直接创建为 RESTRICT
        if (fk.confdeltype !== 'r') {
            const client = await pool!.connect();
            try {
                await client.query('BEGIN');
                await client.query(`ALTER TABLE media DROP CONSTRAINT "${fk.conname}"`);
                await client.query(`
                    ALTER TABLE media ADD CONSTRAINT "${fk.conname}" FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE RESTRICT
                `);
                await client.query('COMMIT');
            } catch (rebuildErr) {
                await client.query('ROLLBACK');
                throw rebuildErr; // 回滚后旧约束保持原状，交由外层 catch 记录
            } finally {
                client.release();
            }

            // 重建后复核：确认约束策略已实际生效（防止异常静默通过）
            const verify = await pool!.query(`
                SELECT confdeltype FROM pg_constraint
                WHERE conrelid = 'media'::regclass AND contype = 'f' AND confrelid = 'users'::regclass
            `);
            const now = verify.rows[0] as { confdeltype: string } | undefined;
            if (!now || now.confdeltype !== 'r') {
                console.warn(`[DB] 外键重建后复核异常：当前策略=${now?.confdeltype ?? '无约束'}`);
            } else {
                console.warn('[DB] media.uploader_id 外键已自动重建为 ON DELETE RESTRICT（已复核）');
            }
        }
    } catch (err) {
        console.warn('[DB] 外键策略对齐失败（约束未变更，下次启动将重试）:', err instanceof Error ? err.message : err);
    }
}

/**
 * refresh token 过期自动清理：
 * - 数据库内置：BEFORE INSERT 触发器，每次插入新 token 时顺带删除已过期记录（自维护，无需应用定时任务）
 * - 启动时再清理一次，覆盖长期无活动、触发器未触发的场景
 */
async function ensureRefreshTokenCleanup(): Promise<void> {
    try {
        await db!.execute(sql`
            CREATE OR REPLACE FUNCTION cleanup_expired_refresh_tokens() RETURNS trigger AS $$
            BEGIN
                DELETE FROM refresh_tokens WHERE expires_at < now();
                RETURN NEW;
            EXCEPTION WHEN OTHERS THEN
                RETURN NEW; -- 清理失败不影响正常插入
            END;
            $$ LANGUAGE plpgsql;
        `);
        await db!.execute(sql`
            DROP TRIGGER IF EXISTS trg_refresh_tokens_cleanup ON refresh_tokens;
            CREATE TRIGGER trg_refresh_tokens_cleanup BEFORE INSERT ON refresh_tokens
                FOR EACH ROW EXECUTE FUNCTION cleanup_expired_refresh_tokens();
        `);
        // 启动时清理一次
        await db!.execute(sql`DELETE FROM refresh_tokens WHERE expires_at < now()`);
        console.log('[DB] refresh token 过期清理触发器已就绪');
    } catch (err) {
        console.warn('[DB] refresh token 清理触发器创建失败（不影响正常使用）:', err instanceof Error ? err.message : err);
    }
}

/**
 * 内部同步表结构（根据 schema.ts 自动执行 drizzle-kit pushSchema）
 */
export async function syncSchemaInternal(dbInstance: ReturnType<typeof drizzle>): Promise<void> {
    try {
        const { pushSchema } = await import('drizzle-kit/api-postgres');
        const result = await pushSchema(
            schema,
            dbInstance,
            { schemas: ['public'], tables: [], entities: undefined, extensions: [] },
        );
        for (const hint of result.hints || []) {
            console.warn('[DB] ' + hint.hint);
        }
        if (result.sqlStatements?.length) {
            // 过滤破坏性语句(DROP VIEW/DROP TABLE 等): pushSchema 会把库中共享对象
            // (如 pg_stat_statements 扩展视图)当成"schema 中不存在"而生成 DROP,
            // apply 按序执行时会因 DROP 失败中断, 导致后续 ADD COLUMN 等变更未执行。
            // 只执行非破坏性语句(ADD COLUMN / CREATE TABLE / CREATE INDEX 等), 保守安全。
            const dropped = result.sqlStatements.filter((s) => /^\s*DROP\b/i.test(s));
            const safe = result.sqlStatements.filter((s) => !/^\s*DROP\b/i.test(s));
            if (dropped.length) {
                console.warn('[DB] 跳过破坏性语句(不执行):', dropped);
            }
            for (const stmt of safe) {
                await dbInstance.execute(sql.raw(stmt));
            }
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

/** API 服务账户的保留用户名（静态 API 令牌对应的系统账号，不可密码登录） */
export const API_USERNAME = 'api';
/** API 服务账户的用户 id（启动时创建/解析后填充，供 auth 中间件映射） */
export let apiUserId: string | null = null;

/**
 * 确保 API 服务账户存在（仅当配置了 API_TOKEN 时调用），返回其 id。
 * - 该账户对应静态 API 令牌，授予管理员权限
 * - 密码为随机不可知哈希 → 无法通过用户名密码登录
 * - 用户名保留，防止被注册占用
 */
export async function ensureApiUser(): Promise<string> {
    const db = getDatabase();
    const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, API_USERNAME)).limit(1).execute();
    if (existing) {
        // 服务账户始终为管理员（防止被降权）
        await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, existing.id)).execute();
        apiUserId = existing.id;
        return existing.id;
    }
    const id = uuidv4();
    await db
        .insert(schema.users)
        .values({
            id,
            username: API_USERNAME,
            passwordHash: hashPassword(randomBytes(32).toString('hex')),
            role: 'admin'
        })
        .execute();
    apiUserId = id;
    console.log(`[DB] API 服务账户已创建: ${API_USERNAME}`);
    return id;
}

/** pg_trgm 相似度函数：similarity(column, 'keyword') */
export function similarity(column: any, value: string): SQL {
    return sql`similarity(${column}, ${value})`;
}

/** pg_bigm 2-gram 相似度函数(东亚文字友好, 2 字词优于 trgm)：bigm_similarity(column, 'keyword') */
export function bigmSimilarity(column: any, value: string): SQL {
    return sql`bigm_similarity(${column}, ${value})`;
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
