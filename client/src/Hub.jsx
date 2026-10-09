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
  const [chats, setChats] = useState([]); const [docs, setDocs] = useState([]); const [upBusy, setUpBusy] = useState(false); const [attach, setAttach] = useState(false);
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
  const loadDocs = useCallback(async () => setDocs(await api('/api/docs').catch(() => [])), []);
  const upload = async e => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    if (f.size > 6 * 1024 * 1024) { say('File is over 6 MB.'); return; }
    setUpBusy(true);
    try { const r = await fetch(`/api/docs?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token()}` }, body: f }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Upload failed'); say(`${j.name} added (${j.chunks} parts)`); loadDocs(); } catch (x) { say(x.message); }
    setUpBusy(false);
  };
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
      await stream('/api/chat', { method: 'POST', body: { chatId, message }, signal: ctrl.signal, onEvent: ev => {
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
        <span className="live-pill"><span className="pulse connected" />{connectedCount} live</span>
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? '☀' : '☾'}</button>
        {user.guest && <a className="chip accent" href="#/signup" onClick={logout}>Create account</a>}
        <div className="user"><span>{user.name}</span><button className="chip" onClick={logout}>{user.guest ? 'Exit demo' : 'Log out'}</button></div>
      </header>

      <div className="layout">
        <aside className={`side ${drawer ? 'open' : ''}`}>
          <div className="tabs" role="tablist">
            {[['servers', `Servers · ${connectedCount}`], ['catalog', `Catalog · ${catalog.servers.length}`], ['chats', `Chats · ${chats.length}`], ['docs', `Docs · ${docs.length}`]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
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
          {tab === 'docs' && <section>
            <label className="chip accent block" style={{ cursor: 'pointer', textAlign: 'center' }}>{upBusy ? 'Reading your file…' : '+ Upload a document'}<input type="file" hidden disabled={upBusy} accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.log" onChange={upload} /></label>
            <p className="hint">PDF, DOCX, TXT, MD, CSV or JSON, up to 6 MB. Your chat searches these files when a question needs them, together with your MCP tools. Only you can see them.</p>
            {docs.map(d => <div key={d.id} className="chat-row"><button style={{ cursor: 'default' }}>{d.name} <small>· {d.chunks} parts</small></button><button className="x" onClick={() => removeDoc(d.id)} aria-label="Delete document">×</button></div>)}
            {!docs.length && <p className="empty">No documents yet. Upload one, then ask a question about it in the chat.</p>}
          </section>}
          {tab === 'chats' && <section>
            <button className="chip accent block" onClick={newChat}>+ New chat</button>
            {chats.map(c => <div key={c.id} className={`chat-row ${c.id === chatId ? 'on' : ''}`}><button onClick={() => openChat(c.id)}>{c.title}</button><button className="x" onClick={() => deleteChat(c.id)} aria-label="Delete chat">×</button></div>)}
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
          <form className="composer" onSubmit={e => { e.preventDefault(); send(); }}>
            <div className="attach">
              <button type="button" className="attach-btn" aria-label="Attach" aria-expanded={attach} disabled={upBusy} onClick={() => setAttach(a => !a)}>{upBusy ? '…' : '+'}</button>
              {attach && <><div className="attach-scrim" onClick={() => setAttach(false)} /><div className="attach-menu" role="menu">
                <label role="menuitem"><span>📄</span><b>Document</b><small>PDF, DOCX, TXT, CSV</small><input type="file" hidden accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.log" onChange={e => { setAttach(false); upload(e); }} /></label>
                <button type="button" role="menuitem" onClick={() => soon('Photo')}><span>🖼</span><b>Photo</b><small>coming soon</small></button>
                <button type="button" role="menuitem" onClick={() => soon('Video')}><span>🎬</span><b>Video</b><small>coming soon</small></button>
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
