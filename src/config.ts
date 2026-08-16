import { resolve } from 'path';
import 'dotenv/config';

// ---------------------------------------------------------------------------
// 启动前校验：必需的环境变量未设置时拒绝启动
// ---------------------------------------------------------------------------
const requiredVars: { key: string; hint: string }[] = [];

if (!process.env.JWT_SECRET) {
    requiredVars.push({
        key: 'JWT_SECRET',
        hint: '生成一个随机字符串作为 JWT 签名密钥，例：openssl rand -hex 32'
    });
}

if (!process.env.DATABASE_URL) {
    requiredVars.push({
        key: 'DATABASE_URL',
        hint: 'PostgreSQL 连接字符串，例：postgres://user:password@localhost:5432/mediacenter'
    });
}

if (!process.env.ADMIN_USERNAME) {
    requiredVars.push({
        key: 'ADMIN_USERNAME',
        hint: '管理员用户名'
    });
}

if (!process.env.ADMIN_PASSWORD) {
    requiredVars.push({
        key: 'ADMIN_PASSWORD',
        hint: '管理员密码'
    });
}

if (!process.env.UPLOAD_DIR) {
    requiredVars.push({
        key: 'UPLOAD_DIR',
        hint: '媒体文件上传目录，例：./uploads'
    });
}

if (requiredVars.length > 0) {
    console.error('[Config] 启动失败：缺少必需的环境变量');
    console.error('[Config] 请创建 .env 文件并配置以下变量：');
    for (const v of requiredVars) {
        console.error(`  ${v.key}=${v.hint}`);
    }
    process.exit(1);
}

// 是否启用 HTTPS（当 SSL_CERT 和 SSL_KEY 同时设置时）
const sslEnabled = !!(process.env.SSL_CERT && process.env.SSL_KEY);

const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    sslCert: process.env.SSL_CERT,          // SSL 证书路径，可选
    sslKey: process.env.SSL_KEY,            // SSL 私钥路径，可选
    sslEnabled,                             // 是否启用 HTTPS

    jwtSecret: process.env.JWT_SECRET!,
    jwtExpiresIn: '7d' as const,
    apiToken: process.env.API_TOKEN, // 静态 API 令牌，不设置则禁用
    databaseUrl: process.env.DATABASE_URL!,
    /** 数据库连接池上限（默认 16，单容器实例建议 8~16） */
    dbPoolSize: parseInt(process.env.DB_POOL_SIZE || '16', 10),
    /**
     * 语义搜索开关：通用 OpenAI 兼容嵌入接口（POST {base}/embeddings）。
     * 仅当配置 EMBEDDING_BASE_URL 后才启用向量语义搜索；未配置为 null → relevance 排序回退 pg_trgm 原实现。
     * 兼容任意 OpenAI 兼容服务：Ollama(http://host:11434/v1)、OpenAI、vLLM、LM Studio 等。
     */
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || null,
    /** 嵌入模型名 */
    embeddingModel: process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b',
    /**
     * 嵌入输出维度(默认 1024, 与 media.embedding vector(1024) 一致)。
     * 当模型输出维度 > 该值时按 Matryoshka(MRL) 规则截断前 N 维 —— Qwen3-Embedding-4B/8B
     * 原生输出 2560/4096 维但支持 MRL 任意维度, 截断后仍保持检索质量且兼容现有 schema。
     * 设为 0 则不做截断(全维度), 需自行保证与 schema 维度一致。
     */
    embeddingDim: parseInt(process.env.EMBEDDING_DIM || '1024', 10),
    /** 可选 API Key（OpenAI 等需要鉴权的服务） */
    embeddingApiKey: process.env.EMBEDDING_API_KEY || null,
    /** 语义搜索动态阈值下限保护(默认 0.3): 实际阈值 = max(mean+σ*k, 该值), 统计规律自适应 */
    semanticMinRelevance: parseFloat(process.env.SEMANTIC_MIN_RELEVANCE || '0.3'),
    /** 语义搜索动态阈值 σ 倍数 k(默认 2.5): 实际阈值 = mean + σ*k, 夹在 [下限, 0.9*max]。
     *  分层采样实测: 2σ 对实体词过松(total 虚高、深层次污染), 3σ 对泛词(如 MMD, σ 大)过度收敛,
     *  2.5σ 为全类型净改善折中(8/8 查询无关率下降, 无 MMD 误伤)。 */
    semanticSigmaMultiplier: parseFloat(process.env.SEMANTIC_SIGMA_MULTIPLIER || '2.5'),
    /**
     * RRF 混合检索的常数 k(默认 60, 标准值): 融合分 = Σ 1/(k+rank)。
     * 关键词(trgm) + 向量(语义) 双通道, 保证字面命中与语义相关互补。
     */
    rrfK: parseInt(process.env.RRF_K || '60', 10),
    uploadDir: resolve(process.cwd(), process.env.UPLOAD_DIR!),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '34359738368', 10), // 32GB
    /** 服务端缩略图生成开关（默认关闭；开启后 updateMedia 时用 ffmpeg 生成，前端生成兜底） */
    serverThumbnails: process.env.SERVER_THUMBNAILS === 'true',
    /** 缩略图存储子目录（相对 UPLOAD_DIR） */
    thumbSubdir: '.thumbnails',
    /** 缩略图宽度（与前端客户端生成的 380 一致） */
    thumbWidth: 380,
    /** ffmpeg 生成缩略图超时（毫秒） */
    thumbTimeoutMs: 30_000,

    // 支持的媒体类型
    supportedMimeTypes: {
        video: ['video/mp4', 'video/webm', 'video/ogg', 'video/x-matroska', 'video/quicktime'] as string[],
        audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/flac'] as string[],
        image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as string[]
    },

    // 角色定义
    roles: {
        guest: 0,
        user: 1,
        admin: 2
    } as const,

    // 默认用户（程序启动时自动创建）
    defaultUsers: {
        admin: {
            username: process.env.ADMIN_USERNAME!,
            password: process.env.ADMIN_PASSWORD!
        }
    } as const,

    // ── 注册与账号安全 ──

    /** 是否开放自助注册（默认关闭；需显式设置 ALLOW_REGISTRATION=true） */
    allowRegistration: process.env.ALLOW_REGISTRATION === 'true',
    /** 注册密码最小长度（默认 8） */
    minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH || '8', 10),

    // ── 业务常量 ──

    /** 标题最大长度（常见文件系统最大文件名 255 字节） */
    maxTitleLength: 255,
    /** 描述最大长度 */
    maxDescLength: 16 * 1024 * 1024,

    /** 签名 URL 默认过期秒数 */
    defaultExpiresSeconds: 3 * 60,

    /** 标签表达式最大长度 */
    maxExprLength: 512,
    /** 标签表达式最大递归深度 */
    maxDepth: 32,

} as const;

export default config;
