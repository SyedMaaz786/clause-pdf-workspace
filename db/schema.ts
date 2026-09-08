import { sqliteTable, text, integer, index, uniqueIndex, blob, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(), createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('users_email_idx').on(t.email)]);
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('sessions_user_idx').on(t.userId)]);
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(), objectKey: text('object_key').notNull(), size: integer('size').notNull(),
  pageCount: integer('page_count').notNull(), createdAt: integer('created_at').notNull(),
  status: text('status').notNull().default('pending'), summary: text('summary'), category: text('category'),
  insights: text('insights'), embedding: text('embedding'), error: text('error'),
  notes: text('notes').notNull().default('[]'), processIndex: integer('process_index').notNull().default(0),
  leaseUntil: integer('lease_until').notNull().default(0), segmentCount: integer('segment_count').notNull(),
}, t => [index('documents_owner_date_idx').on(t.ownerId, t.createdAt)]);
export const chunks = sqliteTable('chunks', {
  id: text('id').primaryKey(), documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  page: integer('page').notNull(), ordinal: integer('ordinal').notNull(), text: text('text').notNull(),
}, t => [index('chunks_document_ordinal_idx').on(t.documentId, t.ordinal)]);
export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(), documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(), label: text('label').notNull(), createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(), revokedAt: integer('revoked_at'),
}, t => [uniqueIndex('shares_token_idx').on(t.tokenHash), index('shares_document_idx').on(t.documentId)]);
export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(), documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  body: text('body').notNull(), page: integer('page').notNull(), createdAt: integer('created_at').notNull(),
  resolved: integer('resolved').notNull().default(0),
}, t => [index('comments_document_date_idx').on(t.documentId, t.createdAt)]);
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(), role: text('role').notNull(), content: text('content').notNull(),
  sources: text('sources').notNull().default('[]'), createdAt: integer('created_at').notNull(),
}, t => [index('messages_conversation_idx').on(t.documentId, t.actorId, t.createdAt)]);
export const passwordResets = sqliteTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: integer('expires_at').notNull(),
});
// PDF bytes when no R2 bucket is bound; split across rows to stay under D1's 2 MB value cap.
export const blobs = sqliteTable('blobs', {
  key: text('key').notNull(), ordinal: integer('ordinal').notNull(), bytes: blob('bytes', { mode: 'buffer' }).notNull(),
}, t => [primaryKey({ columns: [t.key, t.ordinal] })]);
