import { pgTable, text, integer, doublePrecision, timestamp, uuid, uniqueIndex, index, bigint } from 'drizzle-orm/pg-core';

// ===== users 表 =====
export const users = pgTable(
    'users',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        username: text('username').notNull().unique(),
        passwordHash: text('password_hash').notNull(),
        role: text('role').notNull().default('user'),
        banned: integer('banned').notNull().default(0),
        createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow()
    },
    (table) => [uniqueIndex('users_username_idx').on(table.username)]
);

// ===== media 表 =====
export const media = pgTable(
    'media',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        title: text('title').notNull(),
        description: text('description').notNull().default(''),
        fileName: text('file_name').notNull(),
        filePath: text('file_path').notNull(),
        fileHash: text('file_hash'),
        fileSize: bigint('file_size', { mode: 'number' }).notNull().default(0),
        mimeType: text('mime_type').notNull().default('application/octet-stream'),
        minRole: text('min_role').notNull().default('guest'),
        duration: doublePrecision('duration'),
        thumbPath: text('thumb_path'),
        mediaInfo: text('media_info'),
        source: text('source'),
        authorId: uuid('author_id').references(() => authors.id, { onDelete: 'set null' }),
        uploaderId: uuid('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        deletedAt: timestamp('deleted_at', { mode: 'string', withTimezone: true }),
        createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow()
    },
    (table) => [
        index('media_uploader_idx').on(table.uploaderId),
        index('media_mime_type_idx').on(table.mimeType),
        index('media_title_idx').on(table.title),
        index('media_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops')),
        index('media_desc_trgm_idx').using('gin', table.description.op('gin_trgm_ops')),
        index('media_created_at_idx').on(table.createdAt),
        index('media_file_hash_idx').on(table.fileHash)
    ]
);

// ===== refresh_tokens 表 =====
export const refreshTokens = pgTable(
    'refresh_tokens',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        token: text('token').notNull().unique(),
        expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow()
    },
    (table) => [uniqueIndex('refresh_tokens_token_idx').on(table.token), index('refresh_tokens_user_idx').on(table.userId)]
);

// ===== tags 表 =====
export const tags = pgTable(
    'tags',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        name: text('name').notNull().unique(),
        altNames: text('alt_names').array().notNull().default([]),
        createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow()
    },
    (table) => [
        uniqueIndex('tags_name_idx').on(table.name),
        index('tags_alt_names_gin_idx').using('gin', table.altNames)
    ]
);

// ===== media_tags 关联表（多对多） =====
export const mediaTags = pgTable(
    'media_tags',
    {
        mediaId: uuid('media_id')
            .notNull()
            .references(() => media.id, { onDelete: 'cascade' }),
        tagId: uuid('tag_id')
            .notNull()
            .references(() => tags.id, { onDelete: 'cascade' })
    },
    (table) => [uniqueIndex('media_tags_pk_idx').on(table.mediaId, table.tagId), index('media_tags_media_idx').on(table.mediaId), index('media_tags_tag_idx').on(table.tagId)]
);

// ===== authors 表 =====
export const authors = pgTable(
    'authors',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        name: text('name').notNull().unique(),
        altNames: text('alt_names').array().notNull().default([]),
        urls: text('urls').array().notNull().default([])
    },
    (table) => [
        uniqueIndex('authors_name_idx').on(table.name),
        index('authors_alt_names_gin_idx').using('gin', table.altNames)
    ]
);

// ===== 类型导出 =====
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type MediaTag = typeof mediaTags.$inferSelect;
export type NewMediaTag = typeof mediaTags.$inferInsert;
export type Author = typeof authors.$inferSelect;
export type NewAuthor = typeof authors.$inferInsert;
