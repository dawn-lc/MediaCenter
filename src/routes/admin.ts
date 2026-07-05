import { Router } from 'express';
import { listUsers, updateUserRole } from '../controllers/mediaController';
import { scanMediaFiles } from '../controllers/scanController';
import { resetDatabase, deleteUser, toggleBan } from '../controllers/adminController';
import { authenticate, requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// 所有管理接口都需要管理员权限
router.use(authenticate, requireAuth, requireAdmin);

// 获取用户列表
router.get('/users', listUsers);

// 更新用户角色
router.put('/users/:id/role', updateUserRole);

// 删除用户
router.delete('/users/:id', deleteUser);

// 切换封禁状态
router.post('/users/:id/toggle-ban', toggleBan);

// 扫描目录导入媒体文件
router.post('/scan', scanMediaFiles);

// 重置数据库（清空 + 重建 + 初始化）
router.post('/reset-db', resetDatabase);

export default router;
