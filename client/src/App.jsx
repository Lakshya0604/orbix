import React, { useEffect, useState, lazy, Suspense } from 'react';
import { api, setToken, token } from './api.js';
import Auth from './Auth.jsx';
import Landing from './Landing.jsx';
import Share from './Share.jsx';
import Mascot from './Mascot.jsx';
import Loader from './Loader.jsx';
const Hub = lazy(() => import('./Hub.jsx'));

const parse = () => { const h = window.location.hash.replace(/^#/, '') || '/'; const [path, qs] = h.split('?'); return { path, q: new URLSearchParams(qs || '') }; };
function Inner({ setUserOut }) {
  const [route, setRoute] = useState(parse());
  const [user, setUser0] = useState(null); const setUser = u => { setUser0(u); setUserOut(u); };
  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('orbix_theme') ? localStorage.getItem('orbix_theme') === 'dark' : false);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('orbix_theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { const f = () => setRoute(parse()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { const f = () => { setUser(null); location.hash = '#/login'; }; window.addEventListener('orbix-logout', f); return () => window.removeEventListener('orbix-logout', f); }, []);
  // Google callback hands the session token over in the URL fragment
  useEffect(() => { if (route.path === '/auth' && route.q.get('token')) { setToken(route.q.get('token')); history.replaceState(null, '', '#/'); setRoute(parse()); } }, [route]);
  useEffect(() => { (async () => { if (token()) { try { setUser((await api('/api/auth/me')).user); } catch { setToken(null); } } setReady(true); })(); }, [route.path === '/auth']);
  const signedIn = (res) => { setToken(res.token); setUser(res.user); location.hash = '#/'; };
  const logout = () => { setToken(null); setUser(null); location.hash = '#/login'; };
  const [gbusy, setGbusy] = useState(false); const [gerr, setGerr] = useState('');
  const guest = async () => { setGbusy(true); setGerr(''); try { signedIn(await api('/api/auth/guest', { method: 'POST' })); } catch (e) { setGerr(e.message); } setGbusy(false); };
  if (!ready) return <Loader />;
  if (route.path.startsWith('/s/')) return <Share id={route.path.slice(3)} dark={dark} setDark={setDark} />;
  const inApp = user && !['/login', '/signup', '/forgot', '/reset'].includes(route.path);
  if (inApp) return <Suspense fallback={<Loader label="Opening your workspace…" />}><Hub user={user} dark={dark} setDark={setDark} logout={logout} /></Suspense>;
  if (!user && ['/', '', '/auth'].includes(route.path)) return <><Landing dark={dark} setDark={setDark} onGuest={guest} busy={gbusy} err={gerr} />{gbusy && <Loader label="Setting up your demo and connecting servers…" />}</>;
  const mode = ['/signup', '/forgot', '/reset'].includes(route.path) ? route.path.slice(1) : 'login';
  return <Auth mode={mode} q={route.q} dark={dark} setDark={setDark} onDone={signedIn} />;
}

export default function App() {
  const [u, setU] = useState(null);
  const shared = location.hash.startsWith('#/s/');
  return <><Inner setUserOut={setU} /><Mascot canChat={!!u} hidden={shared} /></>;
}
