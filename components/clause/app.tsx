'use client';
import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { api, post } from '@/lib/client';
import type { User } from '@/lib/contracts';
import { Auth } from './auth';
import { Dashboard } from './dashboard';
import { Viewer } from './viewer';
import { Brand } from './brand';

export default function ClauseApp() {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [documentId, setDocumentId] = useState<string | null>(null), [shared, setShared] = useState(false), [resetToken, setResetToken] = useState<string>();
  const [aiConfigured, setAiConfigured] = useState(true);
  useEffect(() => {
    async function initialize() {
      try {
        const url = new URL(window.location.href);
        if (url.pathname === '/reset') { setResetToken(url.hash.slice(1)); setLoading(false); return; }
        const me = await api<{ user: User | null; aiConfigured: boolean }>('/api/auth/me'); setUser(me.user); setAiConfigured(me.aiConfigured);
        if (url.pathname === '/share') {
          const result = await post<{ documentId: string }>('/api/share/exchange', { token: url.hash.slice(1) });
          setDocumentId(result.documentId); setShared(true); window.history.replaceState(null, '', `/documents/${result.documentId}?guest=1`);
        } else if (url.pathname.startsWith('/documents/')) { setDocumentId(url.pathname.split('/')[2]); setShared(url.searchParams.get('guest') === '1'); }
      } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    }
    void initialize();
    const pop = () => { const url = new URL(location.href); setDocumentId(url.pathname.startsWith('/documents/') ? url.pathname.split('/')[2] : null); setShared(url.searchParams.get('guest') === '1'); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  function open(id: string) { setDocumentId(id); setShared(false); window.history.pushState(null, '', `/documents/${id}`); }
  function home() { setDocumentId(null); setShared(false); window.history.pushState(null, '', '/'); }
  const success = (u: User) => { setUser(u); setResetToken(undefined); window.history.replaceState(null, '', '/'); };
  return <><Toaster position="bottom-right" richColors />{loading ? <div className="app-loading"><Brand /><Loader2 className="spin" /><p>Opening your workspace…</p></div> : error ? <div className="app-loading"><Brand /><ShieldAlert size={36} /><h1>We couldn’t open this workspace.</h1><p>{error}</p><Button onClick={() => { window.location.href = '/'; }}>Back to Clause</Button></div> : resetToken ? <Auth onSuccess={success} resetToken={resetToken} /> : documentId && (user || shared) ? <Viewer documentId={documentId} user={user} onBack={home} /> : user ? <Dashboard user={user} aiConfigured={aiConfigured} onOpen={open} onLogout={() => setUser(null)} /> : <Auth onSuccess={success} />}</>;
}
