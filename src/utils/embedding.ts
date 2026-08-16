/**
 * 向量嵌入工具 —— 多语言向量语义搜索支持
 *
 * 通用 OpenAI 兼容接口 (POST {embeddingBaseUrl}/embeddings):
 * 任意兼容服务皆可 —— Ollama(/v1)、OpenAI、vLLM、LM Studio、硅基流动 等
 *
 * - 查询需带 Qwen3 检索指令前缀; 文档(标题)不加前缀 (Qwen3-Embedding 系模型约定)
 * - 标题嵌入前做"选择性清洗": 只删视频 ID, 保留括号内系列名/作者名(跨语言桥接词)
 * - 全部调用优雅降级: 失败返回 null, 由调用方回退 pg_trgm
 */
import { sql } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index';
import config from '../config';
import { matchDictAliases } from './entityDict';

// Qwen3-Embedding 官方检索格式: 查询需指令前缀
const QUERY_INSTRUCTION =
    'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ';

/**
 * 标题选择性清洗:
 * - 删除视频ID(方括号内 ≥6 位字母数字串, 如 [qx8yciszFiGrZd])
 * - 打开其余括号但保留内容(【原神】[MMD原神]【azurlane】是跨语言桥接词, 不能删)
 * - 去除符号/折叠空白
 */
export function cleanTitleForEmbedding(title: string): string {
    return title
        .replace(/[\[【][a-z0-9_-]{6,}[\]】]/gi, ' ')
        .replace(/[\[\]【】]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function embed(inputs: string[]): Promise<number[][]> {
    // 显式开关：未配置 EMBEDDING_BASE_URL 时不发起请求, 直接视为不可用(调用方回退 trgm)
    if (!config.embeddingBaseUrl) {
        throw new Error('EMBEDDING_BASE_URL 未配置, 语义搜索已禁用(回退 pg_trgm)');
    }
    const res = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(config.embeddingApiKey ? { Authorization: `Bearer ${config.embeddingApiKey}` } : {}),
        },
        body: JSON.stringify({ model: config.embeddingModel, input: inputs }),
    });
    if (!res.ok) throw new Error(`Embedding API HTTP ${res.status}`);
    // OpenAI 兼容响应: { data: [{ embedding: number[], index: number }] }
    const data = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] };
    if (!Array.isArray(data.data) || data.data.length === 0) {
        throw new Error('Embedding API 返回格式异常');
    }
    // 按 index 排序保证与输入顺序一致(接口不保证顺序)
    const embeddings = [...data.data]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((d) => d.embedding);
    const valid = embeddings.filter((v): v is number[] => !!v && v.length > 0);
    if (valid.length === 0) {
        throw new Error('Embedding API 返回空向量');
    }
    // Matryoshka(MRL) 截断: 模型输出维度 > 配置维度时, 截取前 N 维。
    // Qwen3-Embedding-4B/8B 原生输出 2560/4096 维, 截断后仍保持检索质量, 兼容 vector(1024)。
    const dim = config.embeddingDim;
    return (dim > 0
        ? valid.map((v) => (v.length > dim ? v.slice(0, dim) : v))
        : valid) as number[][];
}

/**
 * 生成查询向量(带指令前缀, 本地词典多语言扩展); 失败返回 null(调用方回退 trgm)。
 * 查询侧多语言扩展: 用本地领域词典把查询词扩展到其他语言(如 甘雨→Ganyu),
 * 查询词在文本层面拼接(如 "宵宫 Yoimiya"), 指令前缀只加一次 —— 避免"每变体各带指令再
 * 平均向量"导致指令 token 主导、查询词多语言差异被稀释。词典未命中时 queryText=原查询。
 */
export async function getQueryEmbedding(query: string): Promise<number[] | null> {
    try {
        const queryText = [query, ...matchDictAliases(query)].join(' ');
        const [vec] = await embed([QUERY_INSTRUCTION + queryText]);
        return vec;
    } catch (e) {
        console.warn('[embedding] 查询向量生成失败, 回退 trgm:', e instanceof Error ? e.message : e);
        return null;
    }
}

// 查询向量缓存: 同一查询文本的向量是确定性的, 翻页/重复搜索时避免重复调用外部嵌入 API
const queryVecCache = new Map<string, number[][]>();
const QUERY_VEC_CACHE_MAX = 200;

/**
 * 生成多路查询向量(本地词典扩展, 供多路检索 RRF 融合):
 * [原文, ...其他语言别名] 各带指令前缀。如 中文查询"宵宫" → [宵宫, 宵宮, Yoimiya] 三路向量。
 * 每路独立检索, 使中文查询既能召回中文标题也能召回英文/日文标题。失败返回 null。
 */
export async function getQueryEmbeddings(query: string): Promise<number[][] | null> {
    try {
        const cached = queryVecCache.get(query);
        if (cached) return cached;
        const variants = [query, ...matchDictAliases(query)];
        const vecs = await embed(variants.map((v) => QUERY_INSTRUCTION + v));
        if (queryVecCache.size >= QUERY_VEC_CACHE_MAX) queryVecCache.clear();
        queryVecCache.set(query, vecs);
        return vecs;
    } catch (e) {
        console.warn('[embedding] 多路查询向量生成失败, 回退 trgm:', e instanceof Error ? e.message : e);
        return null;
    }
}

/** 批量生成标题向量(已清洗); 失败返回 null */
export async function getTitleEmbeddings(titles: string[]): Promise<number[][] | null> {
    try {
        return await embed(titles.map(cleanTitleForEmbedding));
    } catch (e) {
        console.warn('[embedding] 标题向量生成失败:', e instanceof Error ? e.message : e);
        return null;
    }
}

/**
 * 为媒体生成并写入标题向量(增量嵌入, 写入时调用)。
 * 使用清洗后的原始标题嵌入(查询侧由 getQueryEmbedding 做多语言扩展)。
 * 尽力而为: 未配置 EMBEDDING_BASE_URL / 无 embedding 列 / 生成失败 均静默返回 false,
 * 向量保持 NULL, 留待后续批量回填覆盖。
 */
export async function embedMediaTitle(
    mediaId: string,
    title: string,
    db: ReturnType<typeof getDatabase> = getDatabase()
): Promise<boolean> {
    try {
        if (!config.embeddingBaseUrl) return false;
        if (!(await isEmbeddingColumnAvailable(db))) return false;
        const vec = await getTitleEmbeddings([title]);
        if (!vec?.[0]) return false;
        await db
            .update(schema.media)
            .set({ embedding: vec[0] })
            .where(sql`${schema.media.id} = ${mediaId}`)
            .execute();
        return true;
    } catch (e) {
        console.warn('[embedding] 写入媒体向量失败(保持 NULL):', e instanceof Error ? e.message : e);
        return false;
    }
}

let _checked = false;
let _exists = false;

let _hasChecked = false;
let _hasEmbeddings = false;

/**
 * 检测是否已有回填向量。全 NULL 时 HNSW 索引无条目, 语义搜索会返回空;
 * 此时调用方应回退 trgm。结果缓存。
 */
export async function hasEmbeddings(db: ReturnType<typeof getDatabase> = getDatabase()): Promise<boolean> {
    if (_hasChecked) return _hasEmbeddings;
    try {
        const r = await db.execute(sql`SELECT 1 FROM media WHERE embedding IS NOT NULL LIMIT 1`);
        _hasEmbeddings = (r.rows?.length ?? 0) > 0;
    } catch (e) {
        console.warn('[embedding] 检测回填向量失败:', e instanceof Error ? e.message : e);
        _hasEmbeddings = false;
    }
    _hasChecked = true;
    return _hasEmbeddings;
}

/**
 * 检测 media.embedding 列是否存在(生产迁移后为 true)。
 * 结果缓存, 避免每次搜索都查 information_schema。
 * 用于: 迁移前优雅回退 trgm, 迁移后自动启用语义搜索。
 */
export async function isEmbeddingColumnAvailable(
    db: ReturnType<typeof getDatabase> = getDatabase()
): Promise<boolean> {
    if (_checked) return _exists;
    try {
        const r = await db.execute(
            sql`SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='media' AND column_name='embedding'`
        );
        _exists = (r.rows?.length ?? 0) > 0;
    } catch (e) {
        console.warn('[embedding] 检测 embedding 列失败:', e instanceof Error ? e.message : e);
        _exists = false;
    }
    _checked = true;
    return _exists;
}
