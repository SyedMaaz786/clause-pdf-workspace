export type User = { id: string; name: string; email: string };
export type DocumentRecord = {
  id: string; filename: string; size: number; page_count: number; created_at: number;
  status: 'pending' | 'processing' | 'ready' | 'error'; summary: string | null; category: string | null;
  insights: string | null; error: string | null; process_index: number; segment_count: number;
  share_count: number; comment_count: number; isOwner?: boolean;
};
export type Chunk = { id: string; page: number; ordinal: number; text: string };
export type Source = { page: number; excerpt: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; sources: Source[]; created_at?: number };
export type CommentRecord = { id: string; parent_id: string | null; author_name: string; body: string; page: number; created_at: number; resolved: number };
export type Share = { id: string; label: string; created_at: number; expires_at: number; revoked_at: number | null };
