import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, gt } from 'drizzle-orm';
import config from '../config';
import { getDatabase, schema, currentTimestamp, intervalDays } from '../db/index';
import { hashPassword, verifyPassword } from '../utils/hash';
import { isString } from '../utils/env';

// ===== 辅助函数 =====

function generateAccessToken(payload: { id: string; username: string; role: string }): string {
    return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

async function generateRefreshToken(userId: string): Promise<string> {
    const db = getDatabase();
    const id = uuidv4();
    const token = `${uuidv4()}-${uuidv4()}`;

    await db
        .insert(schema.refreshTokens)
        .values({
            id,
            userId,
            token,
            expiresAt: intervalDays(30)
        })
        .execute();

    return token;
}

// ===== 控制器 =====

/**
 * 用户注册
 */
export async function register(req: Request, res: Response): Promise<void> {
    try {
        const { username, password } = req.body;

        if (!isString(username) || !isString(password)) {
            res.status(400).json({ error: 'auth.emptyCredentials' });
            return;
        }

        if (username.length < 3 || username.length > 32) {
            res.status(400).json({ error: 'auth.usernameLength' });
            return;
        }

        if (password.length < 6) {
            res.status(400).json({ error: 'auth.passwordLength' });
            return;
        }

        const db = getDatabase();

        // 检查用户名是否已存在
        const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username)).limit(1).execute();

        if (existing.length > 0) {
            res.status(409).json({ error: 'auth.usernameExists' });
            return;
        }

        const id = uuidv4();
        const hash = hashPassword(password);

        await db.insert(schema.users).values({ id, username, passwordHash: hash, role: 'user' }).execute();

        const token = generateAccessToken({ id, username, role: 'user' });
        const refreshToken = await generateRefreshToken(id);

        res.status(201).json({
            message: 'auth.registerSuccess',
            user: { id, username, role: 'user' },
            token,
            refreshToken
        });
    } catch (err) {
        console.error('[Auth] 注册失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 用户登录
 */
export async function login(req: Request, res: Response): Promise<void> {
    try {
        const { username, password } = req.body;

        if (!isString(username) || !isString(password)) {
            res.status(400).json({ error: 'auth.emptyCredentials' });
            return;
        }

        const db = getDatabase();
        const users = await db
            .select({
                id: schema.users.id,
                username: schema.users.username,
                role: schema.users.role,
                banned: schema.users.banned,
                passwordHash: schema.users.passwordHash
            })
            .from(schema.users)
            .where(eq(schema.users.username, username))
            .limit(1)
            .execute();

        const user = users[0];
        if (!user) {
            res.status(401).json({ error: 'auth.invalidCredentials' });
            return;
        }

        const valid = verifyPassword(password, user.passwordHash);
        if (!valid) {
            res.status(401).json({ error: 'auth.invalidCredentials' });
            return;
        }

        // 检查是否被封禁
        if (user.banned) {
            res.status(403).json({ error: 'auth.banned' });
            return;
        }

        const token = generateAccessToken({
            id: user.id,
            username: user.username,
            role: user.role
        });
        const refreshToken = await generateRefreshToken(user.id);

        res.json({
            message: 'auth.loginSuccess',
            user: { id: user.id, username: user.username, role: user.role },
            token,
            refreshToken
        });
    } catch (err) {
        console.error('[Auth] 登录失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 刷新令牌
 */
export async function refreshToken(req: Request, res: Response): Promise<void> {
    try {
        const { refreshToken: token } = req.body;

        if (!isString(token)) {
            res.status(400).json({ error: 'auth.refreshTokenEmpty' });
            return;
        }

        const db = getDatabase();

        // 查找未过期的 refresh token
        const tokens = await db
            .select({ id: schema.refreshTokens.id, userId: schema.refreshTokens.userId })
            .from(schema.refreshTokens)
            .where(and(eq(schema.refreshTokens.token, token), gt(schema.refreshTokens.expiresAt, currentTimestamp())))
            .limit(1)
            .execute();

        const stored = tokens[0];
        if (!stored) {
            res.status(401).json({ error: 'auth.refreshTokenInvalid' });
            return;
        }

        const users = await db
            .select({
                id: schema.users.id,
                username: schema.users.username,
                role: schema.users.role
            })
            .from(schema.users)
            .where(eq(schema.users.id, stored.userId))
            .limit(1)
            .execute();

        const user = users[0];
        if (!user) {
            res.status(401).json({ error: 'auth.userNotFound' });
            return;
        }

        // 删除旧的 refreshToken
        await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.id, stored.id)).execute();

        const newToken = generateAccessToken({
            id: user.id,
            username: user.username,
            role: user.role
        });
        const newRefreshToken = await generateRefreshToken(user.id);

        res.json({ token: newToken, refreshToken: newRefreshToken });
    } catch (err) {
        console.error('[Auth] 刷新令牌失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 获取当前用户信息
 */
export async function getProfile(req: Request, res: Response): Promise<void> {
    try {
        const db = getDatabase();
        const users = await db
            .select({
                id: schema.users.id,
                username: schema.users.username,
                role: schema.users.role,
                createdAt: schema.users.createdAt
            })
            .from(schema.users)
            .where(eq(schema.users.id, req.user!.id!))
            .limit(1)
            .execute();

        const user = users[0];
        if (!user) {
            res.status(404).json({ error: 'auth.userNotFound' });
            return;
        }

        res.json({ user });
    } catch (err) {
        console.error('[Auth] 获取用户信息失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}
