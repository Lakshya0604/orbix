import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api.js';
import Orbit3D from './Orbit3D.jsx';
import { orbi } from './Mascot.jsx';

const copy = {
  login: ['Welcome back', 'Sign in to see your servers and pick up where you left off.'],
  signup: ['Create your account', 'Connect MCP servers once. Use them from one chat.'],
  forgot: ['Forgot your password?', 'Enter your email and we will send a reset link.'],
  reset: ['Choose a new password', 'At least 8 characters.'],
};
export default function Auth({ mode, q, dark, setDark, onDone }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [err, setErr] = useState(q.get('error') === 'google' ? 'Google sign-in did not finish. Try again.' : ''); const [info, setInfo] = useState(''); const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState({ google: false });
  useEffect(() => { api('/api/config').then(setCfg).catch(() => {}); }, []);
  useEffect(() => { setErr(''); setInfo(''); orbi('wave', { login: 'Welcome back! Sign in, or try the demo from the home page.', signup: 'Nice, let us set you up. Use 8+ characters for the password.', forgot: 'No stress. Enter your email and I will send a link.', reset: 'Pick a strong new password.' }[mode], 5000); }, [mode]);
  useEffect(() => { if (mode === 'signup' && password && password.length < 8) orbi('worried', 'Password needs at least 8 characters.', 2500); }, [password, mode]);
  async function submit(e) {
    e.preventDefault(); setErr(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'login') onDone(await api('/api/auth/login', { method: 'POST', body: { email, password } }));
      else if (mode === 'signup') onDone(await api('/api/auth/signup', { method: 'POST', body: { email, password, name } }));
      else if (mode === 'forgot') { await api('/api/auth/forgot', { method: 'POST', body: { email } }); orbi('happy', 'Reset link sent. Check your inbox (and spam).'); setInfo('If that email has an account, a reset link is on its way. It works for 30 minutes.'); }
      else onDone(await api('/api/auth/reset', { method: 'POST', body: { token: q.get('token'), password } }));
    } catch (x) { setErr(x.message); orbi('worried', x.message.includes('Wrong') ? 'Hmm, that did not match. Check the email and password, or use Forgot password.' : x.message); } finally { setBusy(false); }
  }
  const [title, sub] = copy[mode];
  return (
    <div className="auth">
      <aside className="auth-art">
        <div className="brand"><span className="logo-dot" />Orbix</div>
        <Orbit3D dark={dark} />
        <div className="art-copy">
          <h2>Every MCP server.<br /><em>One conversation.</em></h2>
          <p>Connect docs, search, code and video servers. Watch each one live. Ask for anything and download what comes back.</p>
        </div>
      </aside>
      <main className="auth-main">
        <button className="theme-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? '☀' : '☾'}</button>
        <motion.form className="auth-card" onSubmit={submit} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <div className="brand mobile-brand"><span className="logo-dot" />Orbix</div>
          <h1>{title}</h1><p className="sub">{sub}</p>
          {mode === 'signup' && <label>Name<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Your name" /></label>}
          {mode !== 'reset' && <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></label>}
          {mode !== 'forgot' && <label>{mode === 'reset' ? 'New password' : 'Password'}<input type="password" required minLength={mode === 'login' ? 1 : 8} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" /></label>}
          <AnimatePresence>{err && <motion.div role="alert" className="msg err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }}>{err}</motion.div>}</AnimatePresence>
          {info && <div className="msg ok">{info}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'One moment…' : { login: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Save password' }[mode]}</button>
          {mode === 'login' && <a className="link small" href="#/forgot">Forgot password?</a>}
          {(mode === 'login' || mode === 'signup') && cfg.google && <>
            <div className="or"><span>or</span></div>
            <a className="btn ghost big gbtn" href="/api/auth/google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.4-4.8 7.1l7.6 5.9c4.4-4.1 7-10.1 7-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>Continue with Google</a>
          </>}
          {(mode === 'login' || mode === 'signup') && <a className="link small" href="#/">← Back to home</a>}
          <p className="switch">
            {mode === 'login' && <>New here? <a href="#/signup">Create an account</a></>}
            {mode === 'signup' && <>Already have an account? <a href="#/login">Sign in</a></>}
            {(mode === 'forgot' || mode === 'reset') && <a href="#/login">Back to sign in</a>}
          </p>
        </motion.form>
      </main>
    </div>
  );
}
