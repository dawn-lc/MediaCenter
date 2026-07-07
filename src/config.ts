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
    uploadDir: resolve(process.cwd(), process.env.UPLOAD_DIR!),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '34359738368', 10), // 32GB

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

    // ── 业务常量 ──

    /** 标题最大长度（常见文件系统最大文件名 255 字节） */
    maxTitleLength: 255,
    /** 描述最大长度 */
    maxDescLength: 16 * 1024 * 1024,

    /** 签名 URL 默认过期秒数 */
    defaultExpiresSeconds: 3 * 60,

    /** 标签表达式最大长度 */
    maxExprLength: 200,
    /** 标签表达式最大递归深度 */
    maxDepth: 20
} as const;

export default config;
