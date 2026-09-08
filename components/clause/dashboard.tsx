'use client';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowRight, ArrowUpRight, Clock3, FilePlus2, FileText, FolderClosed, Grid2X2, LayoutList, Loader2, LockKeyhole, LogOut, MessageSquare, Plus, Search, ShieldCheck, Sparkles, UploadCloud, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, date, fileSize, initials, post } from '@/lib/client';
import type { DocumentRecord, User } from '@/lib/contracts';
import { Brand } from './brand';

type Props = { user: User; aiConfigured: boolean; onOpen: (id: string) => void; onLogout: () => void };
export function Dashboard({ user, aiConfigured, onOpen, onLogout }: Props) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]), [results, setResults] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''), [semantic, setSemantic] = useState(false), [filter, setFilter] = useState('all'), [view, setView] = useState<'grid' | 'list'>('grid');
  const [uploadOpen, setUploadOpen] = useState(false), [uploading, setUploading] = useState(false), [progress, setProgress] = useState(0), [uploadError, setUploadError] = useState('');
  const [file, setFile] = useState<File | null>(null), [dragging, setDragging] = useState(false), [guideOpen, setGuideOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null), processingRef = useRef(new Set<string>());
  const reload = useCallback(async () => {
    const data = await api<{ documents: DocumentRecord[] }>('/api/documents'); setDocuments(data.documents); return data.documents;
  }, []);
  useEffect(() => { void Promise.resolve().then(reload).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [reload]);
  useEffect(() => {
    if (!search) return;
    let alive = true;
    const timer = setTimeout(() => {
      api<{ documents: DocumentRecord[]; searchNotice?: string }>(`/api/documents?q=${encodeURIComponent(search)}&mode=${semantic ? 'semantic' : 'filename'}`).then(data => { if (alive) { setResults(data.documents); setNotice(data.searchNotice || ''); setError(''); } }).catch(e => { if (alive) setError(e.message); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [search, semantic, documents]);
  useEffect(() => {
    for (const document of documents) {
      if (!['pending', 'processing'].includes(document.status) || processingRef.current.has(document.id)) continue;
      processingRef.current.add(document.id);
      void (async () => {
        try {
          let status = document.status;
          while (status === 'pending' || status === 'processing') {
            const result = await post<{ document: DocumentRecord }>(`/api/documents/${document.id}/process`);
            status = result.document.status;
            setDocuments(current => current.map(d => d.id === document.id ? result.document : d));
            if (status === 'processing') await new Promise(r => setTimeout(r, 1500));
          }
          if (status === 'ready') toast.success(`${document.filename} is ready to explore`);
        } catch { await reload().catch(() => {}); }
        finally { processingRef.current.delete(document.id); }
      })();
    }
  }, [documents, reload]);
  function chooseFile(next: File | undefined) {
    setUploadError(''); if (!next) return;
    if (!next.name.toLowerCase().endsWith('.pdf')) { setUploadError('Choose a PDF file. Other file formats are not supported.'); return; }
    if (next.size > 10 * 1024 * 1024) { setUploadError('This file is larger than 10 MB. Choose a smaller PDF.'); return; }
    setFile(next);
  }
  function uploadFile(next: File): Promise<void> {
    setUploading(true); setProgress(0); setUploadError('');
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest(), form = new FormData(); form.append('file', next);
      xhr.open('POST', '/api/documents'); xhr.withCredentials = true;
      xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 90)); };
      xhr.onload = () => {
        setUploading(false);
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || 'Upload failed. Please retry.');
          setProgress(100); setDocuments(d => [data.document, ...d]); setUploadOpen(false); setFile(null);
          toast.success('PDF uploaded', { description: data.document.status === 'error' ? data.document.error : 'Clause is preparing your summary.' });
        } catch (e) { setUploadError((e as Error).message); }
        resolve();
      };
      xhr.onerror = () => { setUploading(false); setUploadError('The connection was interrupted. Your file is still selected; try again.'); resolve(); };
      xhr.send(form);
    });
  }
  async function sample() {
    try {
      setUploadOpen(true); setUploadError('');
      const response = await fetch('/samples/service-agreement.pdf'); if (!response.ok) throw new Error('The sample could not be loaded.');
      const sampleFile = new File([await response.blob()], 'Northstar — Service Agreement.pdf', { type: 'application/pdf' });
      setFile(sampleFile); await uploadFile(sampleFile);
    } catch (e) { setUploadError((e as Error).message); }
  }
  async function retry(document: DocumentRecord, event: React.MouseEvent) {
    event.stopPropagation();
    try { const data = await post<{ document: DocumentRecord }>(`/api/documents/${document.id}/process`); setDocuments(current => current.map(d => d.id === document.id ? data.document : d)); }
    catch (e) { toast.error((e as Error).message); }
  }
  const displayed = (search ? results : documents).filter(d => filter !== 'shared' || d.share_count > 0);
  const sharedCount = documents.filter(d => d.share_count > 0).length;
  return <SidebarProvider className="workspace" style={{ '--sidebar-width': '240px' } as React.CSSProperties}>
    <Sidebar className="clause-sidebar"><SidebarHeader className="sidebar-brand"><Brand light /><div className="workspace-switch"><span className="workspace-avatar">{initials(user.name)}</span><div><strong>Personal workspace</strong><small>Private workspace</small></div><LockKeyhole size={13} /></div></SidebarHeader>
      <SidebarContent className="side-content"><span className="side-label">WORKSPACE</span><SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton isActive={filter === 'all'} onClick={() => setFilter('all')} className="side-link"><FolderClosed /><span>All documents</span><span className="nav-count">{documents.length}</span></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton isActive={filter === 'shared'} onClick={() => setFilter('shared')} className="side-link"><Users /><span>Shared by you</span>{sharedCount > 0 && <span className="nav-count">{sharedCount}</span>}</SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu><div className="side-divider" /><span className="side-label">GOOD TO KNOW</span><SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={() => setGuideOpen(true)} className="side-link"><Sparkles /><span>A clearer workflow</span><ArrowUpRight size={14} /></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
        <div className="sidebar-note"><span className="note-icon"><ShieldCheck size={19} /></span><strong>Yours. Until you share.</strong><p>Your documents are private. You decide who gets a closer look.</p><button onClick={() => setGuideOpen(true)}>How sharing works <ArrowRight size={13} /></button></div>
      </SidebarContent>
      <SidebarFooter className="side-footer"><span className="user-avatar">{initials(user.name)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div><Tooltip><TooltipTrigger asChild><button aria-label="Sign out" onClick={async () => { try { await post('/api/auth/logout'); onLogout(); } catch (e) { toast.error((e as Error).message); } }}><LogOut size={17} /></button></TooltipTrigger><TooltipContent>Sign out</TooltipContent></Tooltip></SidebarFooter>
    </Sidebar>
    <SidebarInset className="workspace-main"><header className="workspace-topbar"><div className="breadcrumb"><SidebarTrigger className="mobile-trigger" /><span>Workspace</span><span>/</span><strong>{filter === 'shared' ? 'Shared by you' : 'All documents'}</strong></div><div className="topbar-right"><LockKeyhole size={13} /><span>Private workspace</span><span className="user-avatar small-avatar">{initials(user.name)}</span></div></header>
      <main className="dashboard"><div className="dashboard-heading"><div><span className="eyebrow">A CLEARER POINT OF VIEW</span><h1>{filter === 'shared' ? 'Better, together.' : 'Your document workspace.'}</h1><p>{filter === 'shared' ? 'The documents you’ve opened up for collaboration.' : 'Everything you need to turn information into understanding.'}</p></div><Button className="primary-button" onClick={() => { setUploadError(''); setUploadOpen(true); }}><Plus size={18} /> Upload PDF</Button></div>
        {!aiConfigured && <div className="setup-banner"><Sparkles size={18} /><div><strong>AI is waiting for a connection.</strong> Uploads, sharing and comments work now. Add a server API key to enable summaries and chat.</div></div>}
        <div className="workspace-stats"><div><span className="stat-icon violet"><FileText size={20} /></span><div><strong>{documents.length.toString().padStart(2, '0')}</strong><span>Total documents</span></div></div><div><span className="stat-icon green"><Sparkles size={20} /></span><div><strong>{documents.filter(d => d.status === 'ready').length.toString().padStart(2, '0')}</strong><span>Ready to explore</span></div></div><div><span className="stat-icon blue"><Users size={20} /></span><div><strong>{sharedCount.toString().padStart(2, '0')}</strong><span>Shared documents</span></div></div><div><span className="stat-icon amber"><MessageSquare size={20} /></span><div><strong>{documents.reduce((n, d) => n + d.comment_count, 0).toString().padStart(2, '0')}</strong><span>Conversations started</span></div></div></div>
        <section className="document-section"><div className="document-section-header"><h2>{filter === 'shared' ? 'Shared documents' : 'All documents'} <span>{displayed.length}</span></h2><span className="sort-label"><Clock3 size={14} /> Most recent first</span></div>
          <div className="document-controls"><div className="search-input"><Search size={18} /><Input aria-label="Search documents" placeholder={semantic ? 'Search by meaning, e.g. employment terms…' : 'Search by filename…'} value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</div><label className="semantic-toggle"><Sparkles size={15} /><span>Search by meaning</span><Switch checked={semantic} onCheckedChange={setSemantic} aria-label="Search by meaning" /></label><div className="view-toggle"><button aria-label="Grid view" aria-pressed={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><Grid2X2 size={17} /></button><button aria-label="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><LayoutList size={18} /></button></div></div>
          {error && <div className="error-message" role="alert">{error}<button onClick={() => { setError(''); void reload().catch(e => setError(e.message)); }}>Retry</button></div>}{notice && <p className="search-notice">{notice}</p>}
          {loading ? <div className="document-grid">{[0, 1, 2].map(n => <Skeleton key={n} className="card-skeleton" />)}</div> : displayed.length ? <div className={`document-grid ${view === 'list' ? 'document-list' : ''}`}>{displayed.map((d, i) => <article className="document-card" key={d.id} style={{ animationDelay: `${i * 45}ms` }}>
            <button className="document-open" onClick={() => onOpen(d.id)} aria-label={`Open ${d.filename}`}><div className="card-top"><span className={`pdf-icon tone-${i % 3}`}><FileText size={24} /><small>PDF</small></span><span className={`document-status ${d.status === 'ready' ? 'ready' : d.status === 'error' ? 'needs-attention' : 'processing'}`}>{d.status === 'ready' ? <><Sparkles size={12} /> AI ready</> : d.status === 'error' ? 'Needs attention' : <><Loader2 size={12} className="spin" /> Analyzing</>}</span></div><h3>{d.filename}</h3><div className="card-meta"><span>{d.page_count} pages</span><span>·</span><span>{fileSize(d.size)}</span><span>·</span><span>{date(d.created_at)}</span></div><div className="card-summary"><div><Sparkles size={13} /> AT A GLANCE</div><p>{d.summary || (d.status === 'error' ? d.error : `Reading your document and connecting the important details. ${d.segment_count > 1 ? `Section ${Math.min(d.process_index + 1, d.segment_count)} of ${d.segment_count}.` : ''}`)}</p></div></button>
            <div className="card-footer"><span className="category-tag">{d.category || 'Document'}</span><div>{d.status === 'error' && <button className="retry-link" onClick={e => void retry(d, e)}>Retry AI</button>}{d.share_count > 0 ? <span><Users size={14} /> {d.share_count}</span> : <LockKeyhole size={13} />}{d.comment_count > 0 && <span><MessageSquare size={14} /> {d.comment_count}</span>}<button aria-label={`Read ${d.filename}`} onClick={() => onOpen(d.id)}><ArrowUpRight size={17} /></button></div></div>
          </article>)}<button className="upload-card" onClick={() => setUploadOpen(true)}><span><Plus size={23} /></span><strong>A new document.<br />A new perspective.</strong><small>Upload a PDF <ArrowRight size={13} /></small></button></div> : search || filter === 'shared' ? <div className="empty-results"><Search size={30} /><h3>{search ? 'No documents found.' : 'Good work deserves company.'}</h3><p>{search ? 'Try another filename or switch to search by meaning.' : 'Open a document and create an invitation to start collaborating.'}</p>{filter === 'shared' && <Button variant="outline" onClick={() => setFilter('all')}>Browse your documents</Button>}</div> : <div className="empty-workspace"><div className="empty-upload" onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files[0]); setUploadOpen(true); }} data-dragging={dragging}><span className="empty-file-icon"><FilePlus2 size={31} /></span><span className="eyebrow">GREAT QUESTIONS START HERE</span><h3>Your next insight is in there.</h3><p>Drop in a PDF. We’ll help you find what matters.</p><Button className="primary-button" onClick={() => setUploadOpen(true)}><Plus size={17} /> Upload your first PDF</Button><small>PDF only · Up to 10 MB · 200 pages</small></div><div className="sample-strip"><span className="sample-icon"><FileText size={23} /></span><div><strong>Take a closer look.</strong><p>Explore a sample service agreement to see the full workflow.</p></div><Button variant="outline" onClick={() => void sample()} disabled={uploading}>Try a sample <ArrowUpRight size={15} /></Button></div></div>}
        </section><footer className="dashboard-footer"><span><ShieldCheck size={14} /> Private by default. Purposeful by design.</span><span>Made for the details that matter.</span></footer>
      </main>
    </SidebarInset>
    <Dialog open={uploadOpen} onOpenChange={open => { if (!uploading) setUploadOpen(open); }}><DialogContent className="clause-dialog"><DialogHeader><span className="dialog-icon"><UploadCloud size={24} /></span><DialogTitle>Bring a document into focus.</DialogTitle><DialogDescription>Upload a PDF to read, understand, and review together.</DialogDescription></DialogHeader><input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => chooseFile(e.target.files?.[0])} disabled={uploading} /><button disabled={uploading} className="dropzone" data-dragging={dragging} onClick={() => inputRef.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); if (!uploading) chooseFile(e.dataTransfer.files[0]); }}>{file ? <><FileText size={33} /><strong>{file.name}</strong><span>{fileSize(file.size)} · Click to choose a different PDF</span></> : <><UploadCloud size={32} /><strong>Drop your PDF here, or browse</strong><span>Up to 10 MB · 200 pages</span></>}</button>{uploading && <div className="upload-progress"><Progress value={progress} /><span>{progress < 90 ? `Uploading… ${progress}%` : 'Extracting text and saving your PDF…'}</span></div>}{uploadError && <div className="error-message" role="alert">{uploadError}</div>}<div className="upload-privacy"><LockKeyhole size={15} /><p>Only you can access this PDF until you share it. Extracted text is sent to the configured AI provider for analysis.</p></div><Button className="primary-button full-width" disabled={!file || uploading} onClick={() => file && void uploadFile(file)}>{uploading ? <><Loader2 className="spin" /> Preparing your document…</> : <><Sparkles size={17} /> Upload & understand</>}</Button></DialogContent></Dialog>
    <Dialog open={guideOpen} onOpenChange={setGuideOpen}><DialogContent className="clause-dialog"><DialogHeader><DialogTitle>A clearer workflow.</DialogTitle><DialogDescription>From your first PDF to your team’s next decision.</DialogDescription></DialogHeader><div className="guide-steps">{[['01', 'Bring it in', 'Upload a text-based PDF. Clause extracts every page and prepares a concise summary.'], ['02', 'Get to the point', 'Ask questions in AI chat. Follow page citations to check answers against the original.'], ['03', 'Open the conversation', 'Create an expiring guest link. Guests can read, ask questions, and leave threaded comments without an account.'], ['04', 'Stay in control', 'Revoke a link at any time. Chat histories stay private to each reviewer.']].map(([n, title, text]) => <div key={n}><span>{n}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div></DialogContent></Dialog>
  </SidebarProvider>;
}
