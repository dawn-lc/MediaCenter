import type { Request, Response } from 'express';
import { existsSync } from 'fs';
import { scanDirectory } from '../utils/scanner';
import { isString } from '../utils/env';

/**
 * 扫描指定路径的媒体文件并导入数据库
 * POST /api/admin/scan
 * Body: { path: string }
 */
export async function scanMediaFiles(req: Request, res: Response): Promise<void> {
    try {
        const { path: scanPath } = req.body;
        if (!isString(scanPath)) {
            res.status(400).json({ error: 'admin.pathRequired' });
            return;
        }

        if (!existsSync(scanPath)) {
            res.status(400).json({ error: 'admin.pathNotFound' });
            return;
        }

        const result = await scanDirectory(scanPath, {
            uploaderId: req.user!.id!
        });

        res.json({
            message: 'admin.scanComplete',
            scan: result
        });
    } catch (err) {
        console.error('[Scan] 扫描失败:', err);
        res.status(500).json({ error: 'admin.scanError' });
    }
}
