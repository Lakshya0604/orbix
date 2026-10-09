import React, { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, stream, token } from './api.js';
import Tilt from './Tilt.jsx';
const Orbit3D = lazy(() => import('./Orbit3D.jsx'));
import { orbi, orbiContext } from './Mascot.jsx';
import { Answer, Steps, saveText, copyText, chatToText } from './parts.jsx';

const SUGGEST = [
  'Make a 2 second video of a red balloon floating over a lake at sunrise',
  'Explain how React Server Components work in the facebook/react repo',
  'Search the web for the latest on the Model Context Protocol and summarise it',
  'What is the current price of bitcoin and ethereum?',
];
function ServerCard({ s, onReconnect, onRemove, onToggle, catalog, send, setDrawer }) {
  const [open, setOpen] = useState(false);
  const label = { connected: 'Connected', connecting: 'Connecting…', error: 'Not working', disconnected: 'Offline' }[s.state];
  const ex = (catalog.servers.find(c => c.id === s.catalogId)?.examples || []).slice(0, 3);
  return (
    <motion.div layout className={`srv ${s.state}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
      <div className="srv-row">
        <button className="srv-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`pulse ${s.state}`} />
          <span className="srv-name"><b>{s.name}</b><small>{s.state === 'connected' ? `${s.toolCount} tools · ${s.latencyMs} ms` : (s.error || label)}{s.enabled === false ? ' · paused' : ''}</small></span>
        </button>
        <div className="srv-ic">
          <button title={s.state === 'connected' ? 'Refresh' : 'Reconnect'} aria-label="Refresh" onClick={() => onReconnect(s)}>↻</button>
          <button title={s.enabled ? 'Pause' : 'Resume'} aria-label="Pause" onClick={() => onToggle(s)}>{s.enabled ? '❚❚' : '▶'}</button>
          <button className="danger" title="Remove" aria-label="Remove" onClick={() => onRemove(s)}>✕</button>
        </div>
      </div>
      <AnimatePresence initial={false}>{open && ex.length > 0 && s.state === 'connected' && <motion.div className="srv-ex" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
        {ex.map(x => <button key={x} className="try" onClick={() => { send(x); setDrawer(false); }}>▸ {x}</button>)}
      </motion.div>}</AnimatePresence>
    </motion.div>
  );
}

export default function Hub({ user, dark, setDark, logout }) {
  const [tok, setTok] = useState({}); const [tab, setTab] = useState('servers'); const [q, setQ] = useState(''); const [cat, setCat] = useState('all');
  const [servers, setServers] = useState([]);
  const [catalog, setCatalog] = useState({ servers: [], rejected: [] });
  const [health, setHealth] = useState({});
  const [chats, setChats] = useState([]); const [docs, setDocs] = useState([]); const [upBusy, setUpBusy] = useState(false); const [attach, setAttach] = useState(false); const [lastDoc, setLastDoc] = useState(null); const [att, setAtt] = useState(null); const picRef = useRef(null); const vidRef = useRef(null); const [mem, setMem] = useState({ memory: '', off: false }); const fileRef = useRef(null);
  const [chatId, setChatId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [live, setLive] = useState(null); // {steps, status}
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState('');
  const [custom, setCustom] = useState({ name: '', url: '', apiKey: '', open: false });
  const [approval, setApproval] = useState(null);
  const [checking, setChecking] = useState(false);
  const [left, setLeft] = useState(user.guestLeft);
  const [shareUrl, setShareUrl] = useState('');
  const bottom = useRef(null); const abort = useRef(null);
  const say = m => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const prevStates = useRef({});
  useEffect(() => {
    const names = servers.filter(s => s.state === 'connected').map(s => s.name);
    orbiContext.value = `User: ${user.guest ? 'guest (demo)' : 'signed in'}. Connected servers: ${names.join(', ') || 'none'}. Not working: ${servers.filter(s => s.state === 'error').map(s => s.name).join(', ') || 'none'}. Busy: ${busy}. Guest tasks left: ${left ?? 'n/a'}.`;
    servers.forEach(s => { const p = prevStates.current[s.id]; if (p && p !== s.state) { if (s.state === 'connected') orbi('happy', `${s.name} is live with ${s.toolCount} tools!`); if (s.state === 'error') orbi('worried', `${s.name} is not responding: ${s.error || 'unknown error'}. Try Reconnect.`, 8000); } prevStates.current[s.id] = s.state; });
  }, [servers, busy, left, user]);
  useEffect(() => { const t = setTimeout(() => orbi('wave', user.guest ? `Hi! This is the demo, you get ${user.guestLeft} free tasks. Tap an example below.` : `Hey ${user.name.split(' ')[0]}! Pick an example or ask for anything.`, 7000), 900); return () => clearTimeout(t); }, []);
  useEffect(() => { if (busy) orbi('thinking', 'Working on it…', 60000); }, [busy]);
  const loadServers = useCallback(async () => setServers(await api('/api/servers')), []);
  const [vids, setVids] = useState({ enabled: false, jobs: [] }); const [vTopic, setVTopic] = useState(''); const [vErr, setVErr] = useState(''); const [vPlay, setVPlay] = useState(null);
  const loadVids = useCallback(async () => { try { setVids(await api('/api/videos')); } catch {} }, []);
  const [vLong, setVLong] = useState(false);
  const [vChar, setVChar] = useState(false);
  const activeVid = vids.jobs.some(j => !['done', 'failed'].includes(j.status));
  useEffect(() => { loadVids(); }, [loadVids]);
  useEffect(() => { if (!activeVid) return; const t = setInterval(loadVids, 4000); return () => clearInterval(t); }, [activeVid, loadVids]);
  const makeVid = async e => { e.preventDefault(); setVErr(''); try { await api('/api/videos', { method: 'POST', body: { topic: vTopic, long: vLong, char: vChar } }); setVTopic(''); loadVids(); } catch (x) { setVErr(x.message); } };
  const fetchVid = async id => { const r = await fetch(`/api/videos/${id}/file`, { headers: { authorization: `Bearer ${token()}` } }); if (!r.ok) throw new Error('Could not load the video.'); return URL.createObjectURL(await r.blob()); };
  const playVid = async id => { try { setVPlay({ id, url: await fetchVid(id) }); } catch (x) { setVErr(x.message); } };
  const saveVid = async (id, name) => { try { const u = await fetchVid(id); const a = document.createElement('a'); a.href = u; a.download = `${(name || 'orbix-short').replace(/[^\w]+/g, '-').slice(0, 40)}.mp4`; a.click(); } catch (x) { setVErr(x.message); } };
  const removeVid = async id => { await api(`/api/videos/${id}`, { method: 'DELETE' }); if (vPlay?.id === id) setVPlay(null); loadVids(); };
  const [hfModel, setHfModel] = useState(''); const [hfInfo, setHfInfo] = useState(null); const [hfIn, setHfIn] = useState(''); const [hfOut, setHfOut] = useState(null); const [hfBusy, setHfBusy] = useState(''); const [hfErr, setHfErr] = useState(''); const [spEp, setSpEp] = useState(0); const [spVals, setSpVals] = useState({});
  const hfInspect = async e => { e?.preventDefault(); setHfErr(''); setHfOut(null); setHfInfo(null); setHfBusy('inspect'); try { const inf = await api('/api/hf/inspect', { method: 'POST', body: { model: hfModel } }); setSpEp(Math.max(0, (inf.endpoints || []).findIndex(e => !e.blocked))); setSpVals({}); setHfInfo(inf); } catch (x) { setHfErr(x.message); } setHfBusy(''); };
  const hfRun = async e => { e.preventDefault(); setHfErr(''); setHfOut(null); setHfBusy('run'); try { setHfOut(await api('/api/hf/run', { method: 'POST', body: hfInfo?.type === 'space' ? { model: hfModel, endpoint: hfInfo.endpoints[spEp].name, values: hfInfo.endpoints[spEp].params.map((_, i) => spVals[`${spEp}-${i}`]) } : { model: hfModel, input: hfIn } })); } catch (x) { setHfErr(x.message); } setHfBusy(''); };
  const loadDocs = useCallback(async () => setDocs(await api('/api/docs').catch(() => [])), []);
  const upload = async e => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    if (f.size > 25 * 1024 * 1024) { say('File is over 25 MB.'); return; }
    if (isMedia(f)) { attachMedia({ target: { files: [f], value: '' } }); return; }
    setUpBusy(true);
    try { const r = await fetch(`/api/docs?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token()}` }, body: f }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Upload failed'); setLastDoc({ name: j.name, chunks: j.chunks }); say(`${j.name} added (${j.chunks} parts)`); loadDocs(); } catch (x) { setLastDoc({ error: x.message }); say(x.message); }
    setUpBusy(false);
  };
  const isVid = f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(f.name);
  const isMedia = f => isVid(f) || /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif|tiff?)$/i.test(f.name);
  const snapFrame = (src, w, h) => { const k = Math.min(1, 896 / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.72); };
  const framesOf = file => new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const done = (v, e) => { URL.revokeObjectURL(url); e ? rej(e) : res(v); };
    if (!isVid(file)) { const im = new Image(); im.onload = () => done([snapFrame(im, im.naturalWidth, im.naturalHeight)]); im.onerror = () => done(null, new Error(/heic|heif/i.test(file.name + file.type) ? 'This browser cannot open HEIC photos. Pick the photo from your gallery (it converts to JPG) or take a screenshot of it.' : 'This picture format cannot be read here. Try JPG, PNG, WEBP or GIF.')); im.src = url; return; }
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; const out = []; let i = 0; const timer = setTimeout(() => done(null, new Error('This video took too long to read. Try a shorter one.')), 25000);
    v.onerror = () => { clearTimeout(timer); done(null, new Error('This video format cannot be read here. Try MP4.')); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.1, v.duration / 2); };
    v.onseeked = () => { out.push(snapFrame(v, v.videoWidth, v.videoHeight)); i++; if (i >= 4 || !isFinite(v.duration)) { clearTimeout(timer); done(out); } else v.currentTime = Math.min(v.duration - 0.1, v.duration * [0.1, 0.35, 0.65, 0.95][i]); };
    v.src = url;
  });
  const attachMedia = async e => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const kind = isVid(f) ? 'video' : 'photo';
    if (f.size > 200 * 1024 * 1024) { say('That file is too big. Use one under 200 MB.'); return; }
    setAtt({ name: f.name, kind, busy: true }); setLastDoc(null);
    try {
      const images = await framesOf(f);
      const r = await fetch('/api/vision', { method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token()}` }, body: JSON.stringify({ images, frames: kind === 'video' }) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not read it');
      setAtt({ name: f.name, kind, summary: j.summary }); orbi('happy', 'Got it, ask me about it!', 3000);
    } catch (x) { setAtt({ name: f.name, kind, error: x.message }); }
  };
  const loadMem = useCallback(async () => setMem(await api('/api/me/memory').catch(() => ({ memory: '', off: false }))), []);
  const soon = what => { setAttach(false); say(`${what} understanding is coming in the next update. Documents work now.`); };
  const removeDoc = async id => { await api(`/api/docs/${id}`, { method: 'DELETE' }); loadDocs(); };
  const loadChats = useCallback(async () => setChats(await api('/api/chats')), []);
  useEffect(() => { loadServers(); loadChats(); loadDocs(); api('/api/catalog').then(setCatalog); api('/api/servers/reconnect-all', { method: 'POST' }).catch(() => {}); }, [loadServers, loadChats, loadDocs]);
  // live status stream for the left panel
  useEffect(() => {
    const ctrl = new AbortController(); let stop = false;
    (async () => { while (!stop) { try { await stream('/api/events', { onEvent: ev => setServers(list => list.map(s => s.id === ev.id ? { ...s, ...ev } : s)), signal: ctrl.signal }); } catch {} if (!stop) await new Promise(r => setTimeout(r, 3000)); } })();
    return () => { stop = true; ctrl.abort(); };
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, live]);

  const addCatalog = async (c, apiKey) => { try { await api('/api/servers', { method: 'POST', body: { catalogId: c.id, apiKey } }); await loadServers(); } catch (e) { say(e.message); } };
  const connectAllFree = async () => { orbi('happy', 'Connecting all the free servers…', 4000); for (const c of catalog.servers.filter(c => c.auth === 'none' && !servers.some(s => s.catalogId === c.id))) await addCatalog(c); };
  const addCustom = async e => { e.preventDefault(); try { await api('/api/servers', { method: 'POST', body: { name: custom.name, url: custom.url, apiKey: custom.apiKey || undefined } }); setCustom({ name: '', url: '', apiKey: '', open: false }); await loadServers(); } catch (x) { say(x.message); } };
  const reconnect = async s => { setServers(l => l.map(x => x.id === s.id ? { ...x, state: 'connecting' } : x)); try { await api(`/api/servers/${s.id}/connect`, { method: 'POST' }); } catch (e) { say(e.message); } loadServers(); };
  const remove = async s => { await api(`/api/servers/${s.id}`, { method: 'DELETE' }); loadServers(); };
  const toggle = async s => { await api(`/api/servers/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }); loadServers(); };
  const checkHealth = async (force) => { setChecking(true); try { const r = await api(`/api/catalog/health${force ? '?force=1' : ''}`); setHealth(Object.fromEntries(r.map(x => [x.id, x]))); } catch (e) { say(e.message); } setChecking(false); };

  const copyChat = async () => { const ok = await copyText(chatToText(msgs.find(m => m.role === 'user')?.content?.slice(0, 80), msgs)); say(ok ? 'Chat copied' : 'Copy blocked - use Save answer'); };
  const share = async () => { try { const r = await api(`/api/chats/${chatId}/share`, { method: 'POST' }); setShareUrl(r.url); try { await navigator.clipboard.writeText(r.url); say('Share link copied'); } catch { say('Share link ready below'); } } catch (e) { say(e.message); } };
  const openChat = async id => { setShareUrl(''); setChatId(id); setDrawer(false); setMsgs((await api(`/api/chats/${id}`)).messages); };
  const newChat = () => { setShareUrl(''); setChatId(null); setMsgs([]); setDrawer(false); };
  const deleteChat = async id => { await api(`/api/chats/${id}`, { method: 'DELETE' }); if (id === chatId) newChat(); loadChats(); };

  async function send(t) {
    const message = (t ?? text).trim(); if (!message || busy) return;
    if (user.guest && left <= 0) { say('Demo finished. Create a free account to keep going.'); return; }
    setText(''); setBusy(true); if (user.guest) setLeft(l => l - 1); setMsgs(m => [...m, { role: 'user', content: message }]); setLive({ steps: [], status: 'Thinking…' });
    const ctrl = new AbortController(); abort.current = ctrl; let steps = [], answer = '', err = '';
    try {
      await stream('/api/chat', { method: 'POST', body: { chatId, message, attached: att?.summary || undefined }, signal: ctrl.signal, onEvent: ev => {
        if (ev.type === 'chat') setChatId(ev.id);
        else if (ev.type === 'thinking') setLive(l => ({ ...l, status: 'Thinking…' }));
        else if (ev.type === 'tool_call') { steps = [...steps, { id: ev.id, server: ev.server, tool: ev.tool, status: 'running' }]; setLive({ steps, status: `Using ${ev.server}…` }); }
        else if (ev.type === 'approval') setApproval(ev);
        else if (ev.type === 'tool_result') { steps = steps.map(s => s.id === ev.id ? { ...s, status: ev.status, ms: ev.ms, preview: ev.preview, media: ev.media } : s); setLive({ steps, status: 'Thinking…' }); }
        else if (ev.type === 'answer') answer = ev.text;
        else if (ev.type === 'error') err = ev.message;
      } });
    } catch (e) { if (e.name !== 'AbortError') err = e.message; }
    setApproval(null); orbi(err ? 'worried' : 'happy', err ? 'That did not work. Try rephrasing, or check the server dots on the left.' : (/\.(mp4|webm|png|jpe?g|webp|gif)/i.test(answer) ? 'Your file is ready. Tap Download under it!' : 'Done! Want me to suggest a follow-up?'), 7000);
    const mediaFromSteps = [...new Set(steps.flatMap(s => s.media || []))].filter(u => !answer.includes(u));
    setMsgs(m => [...m, { role: 'assistant', content: err ? `Something went wrong: ${err}` : answer + (mediaFromSteps.length ? '\n\n' + mediaFromSteps.join('\n') : ''), steps, error: !!err }]);
    setLive(null); setBusy(false); loadChats();
  }
  const decide = async allow => { const a = approval; setApproval(null); await api('/api/approve', { method: 'POST', body: { id: a.id, allow } }); };

  const connectedCount = servers.filter(s => s.state === 'connected').length;
  const cats = [...new Set(catalog.servers.flatMap(c => c.tags || []))].sort();
  const shown = catalog.servers.filter(c => (cat === 'all' || (c.tags || []).includes(cat)) && (!q || (c.name + c.description + (c.tags || []).join(' ')).toLowerCase().includes(q.toLowerCase())));
  const freeLeft = catalog.servers.filter(c => c.auth === 'none' && !servers.some(s => s.catalogId === c.id)).length;

  return (
    <div className="hub">
      <header className="topbar">
        <button className="icon-btn menu" onClick={() => setDrawer(!drawer)} aria-label="Servers and chats">☰</button>
        <div className="brand"><span className="logo-dot" />Orbix</div>
        <div className="grow" />
        <button className="icon-btn" onClick={() => { setTab('chats'); setDrawer(true); loadChats(); }} aria-label="Chat history" title="Chat history">🕘</button><span className="live-pill"><span className="pulse connected" />{connectedCount} live</span>
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? '☀' : '☾'}</button>
        {user.guest && <a className="chip accent" href="#/signup" onClick={logout}>Create account</a>}
        <div className="user"><span>{user.name}</span><button className="chip" onClick={() => window.dispatchEvent(new Event('orbi-pick'))} aria-label="Change buddy" title="Change buddy">🎭 Buddy</button><button className="chip" onClick={logout}>{user.guest ? 'Exit demo' : 'Log out'}</button></div>
      </header>

      <div className="layout">
        <aside className={`side ${drawer ? 'open' : ''}`}>
          <div className="tabs" role="tablist">
            {[['servers', `Servers · ${connectedCount}`], ['catalog', `Catalog · ${catalog.servers.length}`], ['chats', `Chats · ${chats.length}`], ['docs', `Docs · ${docs.length}`], ['videos', `Videos · ${vids.jobs.length}`], ['hf', 'Playground'], ['memory', 'Memory']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); if (k === 'memory') loadMem(); }}>{l}</button>)}
          </div>
          <div className="side-body">
          {tab === 'servers' && <section>
            {freeLeft > 0 && <button className="chip accent block" onClick={connectAllFree}>⚡ Connect all free ({freeLeft})</button>}
            <AnimatePresence initial={false}>{servers.map(s => <ServerCard key={s.id} s={s} onReconnect={reconnect} onRemove={remove} onToggle={toggle} catalog={catalog} send={send} setDrawer={setDrawer} />)}</AnimatePresence>
            {!servers.length && <p className="empty">Nothing connected yet. Open the Catalog tab and tap Connect, or press “Connect all free”.</p>}
          </section>}
          {tab === 'catalog' && <section>
            <input className="search" type="search" placeholder="Search servers…" value={q} onChange={e => setQ(e.target.value)} />
            <div className="cats">{['all', ...cats].map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
            <div className="side-h tight"><p className="hint">Every server here passed a real connection test.</p><button className="chip" onClick={() => checkHealth(true)} disabled={checking}>{checking ? 'Checking…' : 'Check health'}</button></div>
            {shown.map(c => {
              const h = health[c.id]; const added = servers.some(s => s.catalogId === c.id);
              return (
                <div key={c.id} className="cat">
                  <div className="cat-top"><b>{c.name}</b>
                    <span className={`badge ${c.auth === 'none' ? 'free' : 'key'}`}>{c.auth === 'none' ? 'Free' : 'Needs key'}</span></div>
                  <p>{c.description}</p>
                  <div className="cat-foot">
                    <span className={`health ${h ? (h.ok ? 'up' : 'down') : 'unk'}`}>{h && h.ok !== null ? (h.ok ? `Working · ${h.latencyMs} ms` : `Not working`) : (c.toolCount ? `${c.toolCount} tools · tested ${c.testedAt}` : 'Needs your own token')}</span>
                    {added ? <span className="added">✓ Added</span> : <button className="chip primary" onClick={() => c.auth === 'none' ? addCatalog(c) : (tok[c.id] ? addCatalog(c, tok[c.id]) : say('Paste your token first.'))}>Connect</button>}
                  </div>
                  {!added && c.auth !== 'none' && <div className="tokrow"><input type="password" autoComplete="off" placeholder="Paste your own token" value={tok[c.id] || ''} onChange={e => setTok({ ...tok, [c.id]: e.target.value })} /><small>{c.tokenHelp}</small></div>}
                </div>
              );
            })}
            {!shown.length && <p className="empty">No server matches “{q}”.</p>}
            <button className="chip block" onClick={() => setCustom({ ...custom, open: !custom.open })}>{custom.open ? 'Close' : '+ Add any server by URL'}</button>
            {custom.open && <form className="custom" onSubmit={addCustom}>
              <input required placeholder="Name" value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })} />
              <input required placeholder="https://server.example.com/mcp" value={custom.url} onChange={e => setCustom({ ...custom, url: e.target.value })} />
              <input placeholder="Your own API key / token (optional, stored encrypted)" type="password" value={custom.apiKey} onChange={e => setCustom({ ...custom, apiKey: e.target.value })} />
              <button className="btn primary sm">Connect</button>
            </form>}
          </section>}
          {tab === 'videos' && <section>
            <form onSubmit={makeVid} className="vid-form"><input value={vTopic} onChange={e => setVTopic(e.target.value)} placeholder="Topic, e.g. a haunted lighthouse" maxLength={200} disabled={!vids.enabled} /><button className="btn primary sm" disabled={!vids.enabled || vTopic.trim().length < 3 || activeVid}>Make video</button></form>
            <p className="hint">Orbix writes a short script with a voiceover, makes 4 vertical AI clips (9:16) and stitches them with the voice. It runs in the background, so you can leave. Free limits: 1 at a time, 4 a day, about 16 seconds in total.</p>
            {vErr && <div className="msg err" role="alert">{vErr}</div>}
            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}><input type="checkbox" checked={vLong} onChange={e => setVLong(e.target.checked)} disabled={!vids.enabled} /> Long story mode (about 2 minutes, a full story from start to end). Takes about 8 to 10 minutes to make.</label><label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}><input type="checkbox" checked={vLong} onChange={e => setVLong(e.target.checked)} disabled={!vids.enabled} /> Long story mode (about 2 minutes, a full story from start to end). Takes about 8 to 10 minutes to make.</label>
            <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}><input type="checkbox" checked={vChar} onChange={e => setVChar(e.target.checked)} disabled={!vids.enabled} /> Same animated character in every scene (AI pictures, uses the free daily GPU time, so about one short video a day)</label>
            {vids.jobs.map(j => <div key={j.id} className="vid-card">
              <div className="vid-top"><b>{j.title || j.topic}</b><span className={`vid-st st-${j.status}`}>{{ queued: 'Waiting', scripting: 'Writing script', clips: `Clips ${j.scenes.filter(x => x === 'ok').length}/${j.scenes.length || '?'}`, stitching: 'Stitching', done: 'Ready', failed: 'Failed' }[j.status]}</span></div>
              {!['done', 'failed'].includes(j.status) && <><div className="vid-bar"><i style={{ width: `${Math.max(3, j.pct || 0)}%` }} /></div><p className="hint">{j.stage || 'Working'} · {j.pct || 0}%{j.etaSec ? ` · about ${Math.max(1, Math.round(j.etaSec / 60))} min left` : ''}</p></>}
              {j.error && <p className="hint">{j.error}</p>}{j.note && j.status === 'done' && <p className="hint">{j.note}</p>}
              {j.status === 'done' && <div className="vid-act"><button className="btn ghost sm" onClick={() => playVid(j.id)}>Play</button><button className="btn primary sm" onClick={() => saveVid(j.id, j.title)}>Download</button><button className="x" onClick={() => removeVid(j.id)} aria-label="Delete video">×</button></div>}
              {j.status === 'failed' && <div className="vid-act"><button className="x" onClick={() => removeVid(j.id)} aria-label="Delete">×</button></div>}
              {vPlay?.id === j.id && <video src={vPlay.url} controls playsInline className="vid-player" />}
            </div>)}
            {!vids.jobs.length && <p className="empty">{vids.enabled ? 'No videos yet. Type a topic above.' : 'Video is not switched on for this app yet.'}</p>}
          </section>}
          {tab === 'memory' && <section>
            <p className="hint">Orbix keeps a short note about you across chats (your name, goals, preferences) so you do not repeat yourself. It never stores passwords or keys. You can clear it or turn it off.</p>
            <pre className="hf-out">{mem.memory || 'Nothing remembered yet. Chat a bit and it fills in.'}</pre>
            <div className="vid-act"><button className="btn ghost sm" onClick={async () => setMem(await api('/api/me/memory', { method: 'POST', body: { clear: true } }))}>Clear memory</button><button className="btn ghost sm" onClick={async () => setMem(await api('/api/me/memory', { method: 'POST', body: { off: !mem.off } }))}>{mem.off ? 'Turn memory on' : 'Turn memory off'}</button></div>
          </section>}
          {tab === 'hf' && <section>
            <form onSubmit={hfInspect} className="vid-form"><input value={hfModel} onChange={e => setHfModel(e.target.value)} placeholder="Paste a Hugging Face Space or model link" /><button className="btn primary sm" disabled={hfBusy || hfModel.trim().length < 3}>{hfBusy === 'inspect' ? '…' : 'Load'}</button></form>
            <p className="hint">Paste a Space link (best, runs on free GPU) to get a ready form for it. Model links work only if Hugging Face serves them free, and the monthly free credit can run out. Orbix tells you honestly.</p>
            {hfErr && <div className="msg err" role="alert">{hfErr}</div>}
            {hfInfo?.type === 'space' && (() => { const ep = hfInfo.endpoints[spEp]; return <div className="vid-card"><div className="vid-top"><b>{hfInfo.host.replace('.hf.space', '')}</b><span className="vid-st">Space</span></div>
              <select value={spEp} onChange={e => { setSpEp(Number(e.target.value)); setHfOut(null); }} style={{ width: '100%', margin: '6px 0' }}>{hfInfo.endpoints.map((e, i) => <option key={e.name} value={i} disabled={e.blocked}>{e.name}{e.blocked ? ' (needs a file, not supported)' : ''}</option>)}</select>
              <form onSubmit={hfRun}>{ep.params.map((p, i) => /bool/.test(p.type) ? <label key={i} className="sp-f"><input type="checkbox" checked={spVals[`${spEp}-${i}`] ?? !!p.def} onChange={e => setSpVals({ ...spVals, [`${spEp}-${i}`]: e.target.checked })} /> {p.label}</label> : <label key={i} className="sp-f"><small>{p.label}</small><input value={spVals[`${spEp}-${i}`] ?? ''} onChange={e => setSpVals({ ...spVals, [`${spEp}-${i}`]: e.target.value })} placeholder={p.def == null ? 'required' : `default: ${String(p.def).slice(0, 30)}`} inputMode={/int|float/.test(p.type) ? 'decimal' : 'text'} /></label>)}
                <button className="btn primary sm" disabled={!!hfBusy || ep.blocked}>{hfBusy === 'run' ? 'Running… (can take a minute)' : 'Run'}</button></form>
              {hfOut?.kind === 'space' && hfOut.items.map((it, i) => it.kind === 'image' ? <img key={i} src={it.url} alt="Output" style={{ width: '100%', borderRadius: 12, marginTop: 10 }} /> : it.kind === 'video' ? <video key={i} src={it.url} controls playsInline style={{ width: '100%', borderRadius: 12, marginTop: 10 }} /> : it.kind === 'audio' ? <audio key={i} src={it.url} controls style={{ width: '100%', marginTop: 10 }} /> : it.kind === 'file' ? <a key={i} className="chip accent" href={it.url} target="_blank" rel="noreferrer">Open output file</a> : <pre key={i} className="hf-out">{it.text}</pre>)}
            </div>; })()}
            {hfInfo && hfInfo.type !== 'space' && <div className="vid-card"><div className="vid-top"><b>{hfInfo.id}</b><span className="vid-st">{hfInfo.task || 'unknown task'}</span></div>
              <p className="hint">{hfInfo.downloads.toLocaleString()} downloads · {hfInfo.likes} likes{hfInfo.live ? ' · served for free' : ' · not served on the free service (it may fail)'}</p>
              <form onSubmit={hfRun}><textarea rows={3} value={hfIn} onChange={e => setHfIn(e.target.value)} placeholder={/image/.test(hfInfo.task) ? 'Describe the picture' : 'Type your input'} style={{ width: '100%' }} /><button className="btn primary sm" disabled={hfBusy || !hfIn.trim()}>{hfBusy === 'run' ? 'Running…' : 'Run'}</button></form>
              {hfOut?.kind === 'image' && <img src={hfOut.url} alt="Model output" style={{ width: '100%', borderRadius: 12, marginTop: 10 }} />}
              {hfOut && hfOut.kind !== 'image' && <pre className="hf-out">{hfOut.text}</pre>}
            </div>}
          </section>}
          {tab === 'docs' && <section>
            <label className="chip accent block" style={{ cursor: 'pointer', textAlign: 'center' }}>{upBusy ? 'Reading your file…' : '+ Upload a document'}<input type="file" hidden disabled={upBusy} accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.log" onChange={upload} /></label>
            <p className="hint">PDF, DOCX, TXT, MD, CSV or JSON, up to 25 MB. Your chat searches these files when a question needs them, together with your MCP tools. Only you can see them.</p>
            {docs.map(d => <div key={d.id} className="chat-row"><button style={{ cursor: 'default' }}>{d.name} <small>· {d.chunks} parts</small></button><button className="x" onClick={() => removeDoc(d.id)} aria-label="Delete document">×</button></div>)}
            {!docs.length && <p className="empty">No documents yet. Upload one, then ask a question about it in the chat.</p>}
          </section>}
          {tab === 'chats' && <section>
            <button className="chip accent block" onClick={newChat}>+ New chat</button>
            {chats.map(c => <div key={c.id} className={`chat-row ${c.id === chatId ? 'on' : ''}`}><button onClick={() => openChat(c.id)}>{c.title} <small>· {new Date(c.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></button><button className="x" onClick={() => deleteChat(c.id)} aria-label="Delete chat">×</button></div>)}
            {!chats.length && <p className="empty">Your chats will show up here.</p>}
          </section>}
          </div>
        </aside>
        {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

        <main className="center">
          {user.guest && <div className="guestbar">Demo mode · {left} free {left === 1 ? 'task' : 'tasks'} left · <a href="#/signup" onClick={logout}>Create a free account</a> for unlimited chats and your own servers</div>}
          {chatId && !busy && msgs.length > 0 && !user.guest && <div className="sharebar"><button className="chip" onClick={share}>🔗 Share this chat</button><button className="chip" onClick={copyChat}>📋 Copy chat</button>{shareUrl && <input readOnly value={shareUrl} onFocus={e => e.target.select()} />}</div>}
          <div className="thread">
            {!msgs.length && !live && (
              <motion.div className="hero" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                <div className="hero3d"><Suspense fallback={null}><Orbit3D dark={dark} count={6} /></Suspense></div>
                <h1>What should we get done, {user.name.split(' ')[0]}?</h1>
                <p>Orbix picks the right tools from your {connectedCount} connected server{connectedCount === 1 ? '' : 's'} and shows every step. Anything it makes, you can download.</p>
                <div className="sugg">{SUGGEST.map(s => <Tilt as="button" key={s} max={6} onClick={() => send(s)}>{s}</Tilt>)}</div>
              </motion.div>
            )}
            {msgs.map((m, i) => (
              <motion.div key={i} className={`msg ${m.role} ${m.error ? 'bad' : ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                {m.role === 'user' ? <div className="bubble">{m.content}</div> : <>
                  <Steps steps={m.steps} /><Answer text={m.content} onError={say} />
                  {!m.error && <button className="chip" onClick={() => saveText(m.content, `orbix-answer-${i}.md`)}>⬇ Save answer</button>}
                </>}
              </motion.div>
            ))}
            {live && <div className="msg assistant"><Steps steps={live.steps} live /><div className="typing"><span /><span /><span /><em>{live.status}</em></div></div>}
            <div ref={bottom} />
          </div>
          {lastDoc && <div className="doc-chip" style={lastDoc.error ? { borderColor: '#e5484d' } : undefined}><span>{lastDoc.error ? <>⚠️ Upload failed: {lastDoc.error}</> : <>📄 <b>{lastDoc.name}</b> ready · {lastDoc.chunks} parts. Ask a question about it.</>}</span><button type="button" className="x" onClick={() => setLastDoc(null)} aria-label="Dismiss">×</button></div>}
          {att && <div className="doc-chip" style={att.error ? { borderColor: '#e5484d' } : undefined}><span>{att.busy ? <>⏳ Reading {att.name}…</> : att.error ? <>⚠️ {att.error}</> : <>{att.kind === 'video' ? '🎬' : '🖼'} <b>{att.name}</b> understood. Ask about it, or say "make a video like this".</>}</span><button type="button" className="x" onClick={() => setAtt(null)} aria-label="Remove">×</button></div>}
          <input ref={picRef} type="file" hidden accept="image/*,.heic,.heif,.avif" onChange={attachMedia} /><input ref={vidRef} type="file" hidden accept="video/*,.mov,.mp4,.webm,.m4v" onChange={attachMedia} />
          <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.log,image/*,video/*" onChange={upload} />
          <form className="composer" onSubmit={e => { e.preventDefault(); send(); }}>
            <div className="attach">
              <button type="button" className="attach-btn" aria-label="Attach" aria-expanded={attach} disabled={upBusy} onClick={() => setAttach(a => !a)}>{upBusy ? '…' : '+'}</button>
              {attach && <><div className="attach-scrim" onClick={() => setAttach(false)} /><div className="attach-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setAttach(false); fileRef.current?.click(); }}><span>📄</span><b>Document</b><small>PDF, DOCX, TXT, CSV · up to 25 MB</small></button>
                <button type="button" role="menuitem" onClick={() => { setAttach(false); picRef.current?.click(); }}><span>🖼</span><b>Photo</b><small>ask about it, read its text</small></button>
                <button type="button" role="menuitem" onClick={() => { setAttach(false); vidRef.current?.click(); }}><span>🎬</span><b>Video</b><small>ask about it, make one like it</small></button>
              </div></>}
            </div>
            <textarea rows={1} value={text} onChange={e => setText(e.target.value)} placeholder="Ask for anything your servers can do…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            {busy ? <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Stop</button> : <button className="btn primary" disabled={!text.trim()}>Send</button>}
          </form>
        </main>
      </div>

      <AnimatePresence>{approval && <motion.div className="modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="modal" initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}>
          <h3>Allow this action?</h3>
          <p><b>{approval.server}</b> wants to run <code>{approval.tool}</code>, which may change something.</p>
          <pre>{JSON.stringify(approval.args, null, 2).slice(0, 600)}</pre>
          <div className="row"><button className="btn ghost" onClick={() => decide(false)}>Deny</button><button className="btn primary" onClick={() => decide(true)}>Allow once</button></div>
        </motion.div></motion.div>}</AnimatePresence>
      <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast}</motion.div>}</AnimatePresence>
    </div>
  );
}
