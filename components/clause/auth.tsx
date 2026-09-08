'use client';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Eye, EyeOff, FileText, LockKeyhole, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Brand } from './brand';
import { post } from '@/lib/client';
import type { User } from '@/lib/contracts';

export function Auth({ onSuccess, resetToken }: { onSuccess: (user: User) => void; resetToken?: string }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>(resetToken ? 'reset' : 'register');
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await post<{ user?: User; message?: string }>(`/api/auth/${mode}`, { name: form.get('name'), email: form.get('email'), password: form.get('password'), token: resetToken });
      if (data.user) onSuccess(data.user);
      else if (mode === 'reset') { setNotice('Your password was updated. Sign in to continue.'); setMode('login'); window.history.replaceState(null, '', '/'); }
      else setNotice(data.message || 'Check your email for the next step.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function switchMode(next: typeof mode) { setMode(next); setError(''); setNotice(''); }
  return <div className="auth-page">
    <section className="auth-story">
      <Brand light />
      <div className="story-main"><span className="eyebrow light-eyebrow"><span /> A LITTLE CLARITY GOES A LONG WAY</span>
        <h1>Less reading.<br />More <em>understanding.</em></h1>
        <p>A thoughtful workspace for your PDFs.<br />Find the answers. Bring everyone onto the same page.</p>
        <div className="story-document" aria-label="Example of a cited document answer">
          <div className="story-file"><span className="pdf-icon small"><FileText size={20} /></span><div><strong>Service agreement.pdf</strong><small>Document preview</small></div><span className="example-pill">Example</span></div>
          <div className="story-question">What happens when the agreement ends?</div>
          <div className="story-answer"><Sparkles size={18} /><p>Either party can end the agreement with 30 days’ written notice. Confidentiality obligations continue for two years.<span className="example-cite">p. 3</span></p></div>
          <div className="story-answer-footer"><Check size={13} /> Clear answers, connected to their source</div>
        </div>
      </div>
      <div className="story-footer"><LockKeyhole size={14} /> Private by default. Shared on your terms.<span>PDF INTELLIGENCE</span></div>
    </section>
    <main className="auth-main">
      <div className="auth-top"><span>{mode === 'register' ? 'Already have a workspace?' : 'New to Clause?'}</span><button onClick={() => switchMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Sign in' : 'Create an account'} <ArrowRight size={14} /></button></div>
      <div className="auth-form-wrap"><div className="mobile-brand"><Brand /></div><span className="eyebrow">YOUR DOCUMENTS, CONNECTED</span>
        <h2>{mode === 'register' ? 'Make room for clarity.' : mode === 'login' ? 'Welcome back.' : mode === 'forgot' ? 'Let’s get you back in.' : 'A fresh start.'}</h2>
        <p>{mode === 'register' ? 'Create your private document workspace.' : mode === 'login' ? 'Pick up where the conversation left off.' : mode === 'forgot' ? 'We’ll email you a link to reset your password.' : 'Choose a new password for your account.'}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <div className="field"><Label htmlFor="name">Full name</Label><Input id="name" name="name" autoComplete="name" placeholder="Alex Morgan" minLength={2} maxLength={80} required /></div>}
          {mode !== 'reset' && <div className="field"><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></div>}
          {mode !== 'forgot' && <div className="field"><div className="field-label"><Label htmlFor="password">Password</Label>{mode === 'login' && <button type="button" onClick={() => switchMode('forgot')}>Forgot password?</button>}</div><div className="password-input"><Input id="password" name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Your password' : 'At least 10 characters'} minLength={mode === 'login' ? 1 : 10} required /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>}
          {error && <div className="error-message" role="alert">{error}</div>}{notice && <div className="success-message" role="status">{notice}</div>}
          <Button type="submit" className="primary-button auth-submit" disabled={busy}>{busy ? 'One moment…' : mode === 'register' ? 'Create workspace' : mode === 'login' ? 'Sign in to your workspace' : mode === 'forgot' ? 'Send reset link' : 'Update password'}{!busy && <ArrowRight size={17} />}</Button>
          {mode === 'forgot' && <button type="button" className="back-signin" onClick={() => switchMode('login')}>Back to sign in</button>}
        </form>
        <div className="auth-assurance"><span><Check size={14} /> Private PDFs</span><span><Check size={14} /> Source-grounded AI</span><span><Check size={14} /> No-account guest links</span></div>
      </div>
      <footer className="auth-bottom"><span>Built for a clearer point of view.</span><span>Clause © {new Date().getFullYear()}</span></footer>
    </main>
  </div>;
}
