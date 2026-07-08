import { readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { inArray } from 'drizzle-orm';
import mime from 'mime-types';
import { getDatabase, schema } from '../db/index';
import config from '../config';

const SUPPORTED_EXTS = new Set(['.mp4', '.webm', '.ogv', '.mkv', '.mov', '.avi', '.wmv', '.flv', '.mp3', '.wav', '.flac', '.aac', '.wma', '.m4a', '.jpg', '.jpeg', '.png', '.webp', '.gif']);

export interface ScanResult {
    total: number;
    imported: number;
    skipped: number;
    errors: number;
    files: string[];
    errorDetails: string[];
}

export interface ScanOptions {
    recursive?: boolean;
    uploaderId: string;
}

/**
 * 扫描目录并导入媒体文件
 */
export async function scanDirectory(dirPath: string, options: ScanOptions): Promise<ScanResult> {
    const { uploaderId, recursive = true } = options;
    const result: ScanResult = {
        total: 0,
        imported: 0,
        skipped: 0,
        errors: 0,
        files: [],
        errorDetails: []
    };

    console.log('[Scan] 开始扫描目录: %s', dirPath);

    // 1. 收集所有媒体文件（异步，不阻塞）
    const mediaFiles = await collectMediaFiles(dirPath, recursive);
    result.total = mediaFiles.length;
    console.log(`[Scan] 找到 ${mediaFiles.length} 个媒体文件`);

    if (mediaFiles.length === 0) return result;

    // 2. 查询数据库中已有的路径（分批查询）
    const db = getDatabase();
    const BATCH_SIZE = 500;
    const existingPaths = new Set<string>();
    const allPaths = mediaFiles.map((f) => f.fullPath);
    for (let i = 0; i < allPaths.length; i += BATCH_SIZE) {
        const batch = allPaths.slice(i, i + BATCH_SIZE);
        const records = await db.select({ filePath: schema.media.filePath }).from(schema.media).where(inArray(schema.media.filePath, batch)).execute();
        for (const r of records) existingPaths.add(r.filePath);
    }

    // 3. 筛选新文件（路径已存在则跳过，不计算哈希）
    let toInsert = mediaFiles.filter((f) => !existingPaths.has(f.fullPath));
    result.skipped = mediaFiles.length - toInsert.length;
    console.log(`[Scan] 待导入 ${toInsert.length}, 已存在跳过 ${result.skipped}`);

    // 4. 并发导入（限制并发数）
    const CONCURRENCY = 4;
    let index = 0;

    async function processNext(): Promise<void> {
        while (index < toInsert.length) {
            const i = index++;
            const file = toInsert[i];
            console.log(`[Scan] 导入 [${i + 1}/${toInsert.length}] ${file.name}`);
            try {
                await db
                    .insert(schema.media)
                    .values({
                        id: uuidv4(),
                        title: basename(file.name, file.ext).slice(0, config.maxTitleLength),
                        description: `从 ${dirPath} 扫描导入`,
                        fileName: file.name,
                        filePath: file.fullPath,
                        fileSize: file.size,
                        mimeType: file.mimeType,
                        minRole: 'admin',
                        uploaderId
                    })
                    .execute();

                result.imported++;
                result.files.push(file.fullPath);
            } catch (err) {
                result.errors++;
                const errMsg = err instanceof Error ? err.message : String(err);
                result.errorDetails.push(`[${file.name}] ${errMsg}`);
                console.error(`[Scan] 导入失败: ${file.name}`, err);
            }
        }
    }

    // 启动并发 worker
    const workers = Array.from({ length: CONCURRENCY }, () => processNext());
    await Promise.all(workers);
    console.log(`[Scan] 完成: 导入 ${result.imported}, 跳过 ${result.skipped}, 错误 ${result.errors}`);
    return result;
}

interface MediaFileInfo {
    name: string;
    fullPath: string;
    ext: string;
    size: number;
    mimeType: string;
}

/**
 * 递归收集目录中的媒体文件（异步，不阻塞事件循环）
 */
async function collectMediaFiles(dirPath: string, recursive: boolean): Promise<MediaFileInfo[]> {
    const results: MediaFileInfo[] = [];

    try {
        const entries = await readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);

            if (entry.isDirectory()) {
                if (recursive) {
                    // 处理子目录时主动让出事件循环
                    await new Promise((r) => setImmediate(r));
                    results.push(...(await collectMediaFiles(fullPath, true)));
                }
            } else if (entry.isFile()) {
                const ext = extname(entry.name).toLowerCase();
                if (SUPPORTED_EXTS.has(ext)) {
                    try {
                        const st = await stat(fullPath);
                        results.push({
                            name: entry.name,
                            fullPath,
                            ext,
                            size: st.size,
                            mimeType: mime.lookup(ext) || 'application/octet-stream'
                        });
                    } catch {
                        // 跳过无法 stat 的文件
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Scan] 读取目录失败: %s', dirPath, err instanceof Error ? err.message : err);
    }

    return results;
}
