'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, CheckCheck, ChevronDown, ChevronUp, CornerDownRight, FileText, Link2, Loader2, LockKeyhole, MessageSquare, MoreHorizontal, RefreshCw, ShieldCheck, Sparkles, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api, date, fileSize, initials, post } from '@/lib/client';
import type { CommentRecord, DocumentRecord, Message, User } from '@/lib/contracts';
import { Brand } from './brand';
import { Markdown } from './markdown';
import { PdfViewer } from './pdf-viewer';
import { ShareDialog } from './share-dialog';

const suggestions = ['What are the key takeaways?', 'What dates and deadlines should I know?', 'What are the main obligations?'];
export function Viewer({ documentId, user, onBack }: { documentId: string; user: User | null; onBack: () => void }) {
  const [document, setDocument] = useState<DocumentRecord | null>(null), [error, setError] = useState(''), [page, setPage] = useState(1), [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState<Message[]>([]), [question, setQuestion] = useState(''), [streaming, setStreaming] = useState(false), [chatError, setChatError] = useState('');
  const [comments, setComments] = useState<CommentRecord[]>([]), [commentText, setCommentText] = useState(''), [guestName, setGuestName] = useState(''), [replyTo, setReplyTo] = useState<CommentRecord | null>(null), [commentBusy, setCommentBusy] = useState(false), [commentError, setCommentError] = useState('');
  const [shareOpen, setShareOpen] = useState(false), [deleteOpen, setDeleteOpen] = useState(false), [deleting, setDeleting] = useState(false), [summaryOpen, setSummaryOpen] = useState(true), [retrying, setRetrying] = useState(false);
  const [mobilePane, setMobilePane] = useState('document');
  const chatEnd = useRef<HTMLDivElement>(null), commentInput = useRef<HTMLTextAreaElement>(null), aliveRef = useRef(true), abortRef = useRef<AbortController | null>(null);
  const refreshDocument = useCallback(async () => { const data = await api<{ document: DocumentRecord }>(`/api/documents/${documentId}`); setDocument(data.document); return data.document; }, [documentId]);
  const refreshComments = useCallback(async () => { const data = await api<{ comments: CommentRecord[] }>(`/api/documents/${documentId}/comments`); setComments(data.comments); setCommentError(''); }, [documentId]);
  useEffect(() => {
    aliveRef.current = true;
    void Promise.resolve().then(() => Promise.all([refreshDocument(), api<{ messages: Message[] }>(`/api/documents/${documentId}/chat`).then(d => setMessages(d.messages)), refreshComments()])).catch(e => setError(e.message));
    const timer = setInterval(() => { if (globalThis.document.visibilityState === 'visible') void refreshComments().catch(e => setCommentError(e.message)); }, 5000);
    return () => { aliveRef.current = false; clearInterval(timer); abortRef.current?.abort(); };
  }, [documentId, refreshDocument, refreshComments]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: streaming ? 'instant' : 'smooth', block: 'end' }); }, [messages, streaming]);
  useEffect(() => {
    if (!document || !['pending', 'processing'].includes(document.status)) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        if (document.isOwner) await post(`/api/documents/${documentId}/process`);
        if (active) await refreshDocument();
      } catch { if (active) await refreshDocument().catch(() => {}); }
    }, 1500);
    return () => { active = false; clearTimeout(timer); };
  }, [document, documentId, refreshDocument]);
  function jump(next: number) { if (document && next >= 1 && next <= document.page_count) { setPage(next); setMobilePane('document'); } }
  async function ask(text = question) {
    if (!text.trim() || streaming) return;
    setQuestion(''); setChatError(''); setStreaming(true);
    const questionText = text.trim(), responseId = crypto.randomUUID();
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', content: questionText, sources: [] }, { id: responseId, role: 'assistant', content: '', sources: [] }]);
    const controller = new AbortController(); abortRef.current = controller;
    let completed = false;
    try {
      const response = await fetch(`/api/documents/${documentId}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: questionText }), signal: controller.signal });
      if (!response.ok) { const data = await response.json() as { error: string }; throw new Error(data.error); }
      if (!response.body) throw new Error('The response could not be opened.');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read(); buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.message);
            if (event.type === 'token') setMessages(current => current.map(m => m.id === responseId ? { ...m, content: m.content + event.text } : m));
            if (event.type === 'sources') setMessages(current => current.map(m => m.id === responseId ? { ...m, sources: event.sources } : m));
            if (event.type === 'done') { completed = true; setMessages(current => current.map(m => m.id === responseId ? { ...m, sources: event.sources } : m)); if (event.citationWarning) toast.warning('One or more citations could not be verified. Check the original document.'); }
          }
          if (done) break;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!completed) throw new Error('The response was interrupted. Please retry your question.');
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && aliveRef.current) { setChatError((e as Error).message); setQuestion(questionText); }
    } finally { if (aliveRef.current) setStreaming(false); abortRef.current = null; }
  }
  async function addComment(event: FormEvent) {
    event.preventDefault(); if (!commentText.trim()) return; setCommentBusy(true); setCommentError('');
    try {
      await post(`/api/documents/${documentId}/comments`, { body: commentText, page: replyTo?.page || page, name: guestName || undefined, parentId: replyTo?.id || null });
      setCommentText(''); setReplyTo(null); await refreshComments(); toast.success('Comment added');
    } catch (e) { setCommentError((e as Error).message); } finally { setCommentBusy(false); }
  }
  function format(before: string, after = '') {
    const el = commentInput.current; if (!el) return;
    const start = el.selectionStart, end = el.selectionEnd;
    setCommentText(text => text.slice(0, start) + before + (text.slice(start, end) || 'text') + after + text.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, end + before.length || start + before.length + 4); });
  }
  async function resolve(comment: CommentRecord) { try { await api(`/api/documents/${documentId}/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ resolved: !comment.resolved }) }); await refreshComments(); } catch (e) { setCommentError((e as Error).message); } }
  async function retry() { setRetrying(true); try { await post(`/api/documents/${documentId}/process`); await refreshDocument(); } catch (e) { toast.error((e as Error).message); } finally { setRetrying(false); } }
  if (error) return <div className="app-loading"><Brand /><LockKeyhole size={30} /><h1>This document is unavailable.</h1><p>{error}</p><Button onClick={onBack}>Back to workspace</Button></div>;
  if (!document) return <div className="app-loading"><Brand /><Loader2 className="spin" /><p>Bringing your document into focus…</p></div>;
  const insights: { label: string; value: string; page: number }[] = document.insights ? JSON.parse(document.insights) : [];
  const topComments = comments.filter(c => !c.parent_id);
  return <div className="viewer-shell"><header className="viewer-topbar"><div className="viewer-brand"><Brand /><span className="vertical-rule" /><button className="viewer-back" onClick={onBack}><ArrowLeft size={16} /><span>{document.isOwner ? 'Workspace' : 'Clause'}</span></button></div><div className="viewer-file-name"><FileText size={16} /><span>{document.filename}</span></div><div className="viewer-actions">{document.isOwner ? <><span className="private-indicator"><LockKeyhole size={13} /> Private</span><Button className="primary-button share-button" onClick={() => setShareOpen(true)}><Users size={16} /> Share document</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Document actions"><MoreHorizontal size={19} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive"><Trash2 size={16} /> Delete document</DropdownMenuItem></DropdownMenuContent></DropdownMenu></> : <span className="guest-badge"><Link2 size={14} /> Guest access</span>}</div></header>
    <section className="document-overview"><div className="overview-title"><div><span className="eyebrow">DOCUMENT INTELLIGENCE</span><h1>{document.filename.replace(/\.pdf$/i, '')}</h1><p>{document.page_count} pages <span>·</span> {fileSize(document.size)} <span>·</span> Uploaded {date(document.created_at)}</p></div><button className="summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen(!summaryOpen)}>{summaryOpen ? 'Less detail' : 'Show summary'}{summaryOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button></div>
      {summaryOpen && <div className="summary-region"><div className="overview-summary"><div className="summary-label"><Sparkles size={16} /><h2>The document, in a nutshell.</h2>{document.summary && <span>AI SUMMARY</span>}</div>{document.summary ? <Markdown text={document.summary} onPage={jump} pages={Array.from({ length: document.page_count }, (_, i) => i + 1)} /> : <div className="summary-pending">{document.status === 'error' ? <p>{document.error}</p> : <p><Loader2 className="spin" size={16} /> Reading the details{document.segment_count > 1 ? ` — section ${Math.min(document.process_index + 1, document.segment_count)} of ${document.segment_count}` : ''}… You can read and comment while we work.</p>}{document.isOwner && document.status === 'error' && <button disabled={retrying} onClick={() => void retry()}><RefreshCw size={14} className={retrying ? 'spin' : ''} /> Retry analysis</button>}</div>}</div>{insights.length > 0 && <div className="key-facts">{insights.map((fact, i) => <button key={i} onClick={() => jump(fact.page)}><span>{fact.label}</span><strong>{fact.value}</strong><small>Page {fact.page} <ArrowRight size={11} /></small></button>)}</div>}</div>}
    </section>
    <div className="mobile-pane-switch"><button className={mobilePane === 'document' ? 'active' : ''} onClick={() => setMobilePane('document')}><BookOpen size={16} /> Document</button><button className={mobilePane === 'conversation' ? 'active' : ''} onClick={() => setMobilePane('conversation')}><Sparkles size={16} /> Chat & comments</button></div>
    <main className="review-workspace" data-mobile-pane={mobilePane}><div className="reader-column"><PdfViewer documentId={documentId} page={page} setPage={setPage} pageCount={document.page_count} filename={document.filename} /></div>
      <aside className="conversation-column"><Tabs value={tab} onValueChange={setTab} className="review-tabs"><TabsList className="review-tab-list"><TabsTrigger value="chat"><Sparkles size={16} /> Ask Clause</TabsTrigger><TabsTrigger value="comments"><MessageSquare size={16} /> Comments <span>{comments.length}</span></TabsTrigger></TabsList>
        <TabsContent value="chat" className="chat-tab"><div className="chat-privacy"><ShieldCheck size={13} /><span>Grounded in this document · Private to you</span></div><div className="chat-messages" role="log" aria-label="Document conversation">{messages.length === 0 ? <div className="chat-empty"><span className="assistant-symbol"><Sparkles size={25} /></span><h2>There’s more between<br />the lines.</h2><p>Ask a question. Get a clear answer, with a path back to the source.</p><div className="suggested-questions">{suggestions.map(s => <button key={s} onClick={() => void ask(s)}>{s}<ArrowUp size={15} /></button>)}</div><div className="chat-tip"><BookOpen size={14} /><span>Click any page citation to check the original.</span></div></div> : messages.map(m => <div key={m.id} className={`chat-message ${m.role}`}><div className="message-heading"><span className={m.role === 'assistant' ? 'message-ai-avatar' : 'message-user-avatar'}>{m.role === 'assistant' ? <Sparkles size={13} /> : initials(user?.name || guestName || 'You')}</span><strong>{m.role === 'assistant' ? 'Clause' : 'You'}</strong>{m.role === 'assistant' && <small>DOCUMENT ASSISTANT</small>}</div>{m.content ? <Markdown text={m.content} onPage={jump} pages={m.sources.map(s => s.page)} /> : streaming ? <span className="thinking"><i /><i /><i /> Reading the relevant passages</span> : <p className="muted-text">No answer received.</p>}{m.role === 'assistant' && m.content && m.sources.length > 0 && <div className="source-chips">{m.sources.map(s => <button key={s.page} title={s.excerpt} onClick={() => jump(s.page)}><FileText size={12} /> Page {s.page}<ArrowRight size={11} /></button>)}</div>}</div>)}<div ref={chatEnd} /></div>{chatError && <div className="chat-error" role="alert">{chatError}</div>}<form className="chat-composer" onSubmit={e => { e.preventDefault(); void ask(); }}><div><Textarea aria-label="Ask a question about this PDF" placeholder="Ask anything about this document…" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }} /><Button type="submit" size="icon" className="send-button" disabled={streaming || question.trim().length < 2} aria-label="Send question">{streaming ? <Loader2 size={16} className="spin" /> : <ArrowUp size={18} />}</Button></div><small>AI can make mistakes. Follow citations to verify details.</small></form></TabsContent>
        <TabsContent value="comments" className="comments-tab"><div className="comment-intro"><span><Users size={14} /> Shared discussion</span><small>Syncs every 5 seconds</small></div><div className="comments-scroll">{topComments.length ? topComments.map(c => <div className={`comment-thread ${c.resolved ? 'resolved' : ''}`} key={c.id}><Comment comment={c} onPage={jump} />{comments.filter(r => r.parent_id === c.id).map(r => <div className="comment-reply" key={r.id}><Comment comment={r} onPage={jump} /></div>)}<div className="comment-actions"><button onClick={() => { setReplyTo(c); commentInput.current?.focus(); }}><CornerDownRight size={13} /> Reply</button>{document.isOwner && <button onClick={() => void resolve(c)}><CheckCheck size={14} />{c.resolved ? 'Reopen' : 'Resolve'}</button>}{!!c.resolved && <span><Check size={12} /> Resolved</span>}</div></div>) : <div className="comments-empty"><MessageSquare size={29} /><h3>Start a useful conversation.</h3><p>Leave a thought on page {page}, flag a question, or bring a detail to everyone’s attention.</p></div>}</div>{commentError && <div className="chat-error" role="alert">{commentError}</div>}<form className="comment-composer" onSubmit={addComment}>{replyTo && <div className="replying-to"><CornerDownRight size={13} /><span>Replying to {replyTo.author_name}</span><button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={14} /></button></div>}{!user && <Input aria-label="Your name for comments" placeholder="Your name" value={guestName} onChange={e => setGuestName(e.target.value)} minLength={2} maxLength={80} required />}<div className="comment-editor"><Textarea ref={commentInput} aria-label="Write a comment" placeholder={replyTo ? 'Write a reply…' : 'Add a thought, ask a question…'} value={commentText} onChange={e => setCommentText(e.target.value)} maxLength={4000} required /><div className="format-toolbar"><button type="button" aria-label="Bold" onClick={() => format('**', '**')}><strong>B</strong></button><button type="button" aria-label="Italic" onClick={() => format('*', '*')}><em>I</em></button><button type="button" aria-label="Bullet list" onClick={() => format('\n- ')}>☷</button><span>Page {replyTo?.page || page}</span><Button type="submit" className="primary-button" disabled={commentBusy || !commentText.trim()}>{commentBusy ? <Loader2 size={14} className="spin" /> : <ArrowUp size={15} />}Post</Button></div></div><small>Visible to everyone with access to this document.</small></form></TabsContent>
      </Tabs></aside>
    </main>
    {document.isOwner && <ShareDialog open={shareOpen} setOpen={setShareOpen} documentId={documentId} filename={document.filename} />}
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this document?</AlertDialogTitle><AlertDialogDescription>This permanently deletes the PDF, comments, and chat history. All shared links will stop working.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Keep document</AlertDialogCancel><AlertDialogAction disabled={deleting} className="danger-button" onClick={async e => { e.preventDefault(); setDeleting(true); try { await api(`/api/documents/${documentId}`, { method: 'DELETE' }); toast.success('Document deleted'); onBack(); } catch (err) { toast.error((err as Error).message); setDeleting(false); } }}>{deleting ? 'Deleting…' : 'Delete document'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
function Comment({ comment, onPage }: { comment: CommentRecord; onPage: (n: number) => void }) {
  return <div className="comment"><div className="comment-heading"><span className="comment-avatar">{initials(comment.author_name.replace(' (guest)', ''))}</span><div><strong>{comment.author_name}</strong><small>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(comment.created_at)}</small></div><button onClick={() => onPage(comment.page)}>p. {comment.page}</button></div><Markdown text={comment.body} /></div>;
}
