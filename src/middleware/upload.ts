import multer, { type Options } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Request } from 'express';
import mime from 'mime-types';
import config from '../config';
import { ensureUploadDir } from '../utils/storage';

// 确保上传目录存在
ensureUploadDir();

// 配置 multer 存储
const storage = multer.diskStorage({
    destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        cb(null, config.uploadDir);
    },
    filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        // 根据 MIME 类型映射安全扩展名，避免信任客户端提供的文件名
        const ext = mime.extension(file.mimetype) || extname(file.originalname).toLowerCase();
        const uniqueName = `${uuidv4()}${ext ? '.' + ext : ''}`;
        cb(null, uniqueName);
    }
});

// 文件过滤器 - 仅允许媒体文件
function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
    const allowedTypes = config.supportedMimeTypes.video.union(config.supportedMimeTypes.audio).union(config.supportedMimeTypes.image);

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`不支持的媒体类型: ${file.mimetype}`));
    }
}

// multer 2.x 类型定义未包含 defParamCharset，但运行时支持
type MulterOptions = Options & { defParamCharset?: string };

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: config.maxFileSize
    },
    defParamCharset: 'utf8'
} as MulterOptions);

export default upload;
