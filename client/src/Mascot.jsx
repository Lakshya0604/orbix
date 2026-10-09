import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api.js';

// Any part of the app can make Orbi react: orbi('worried', 'That password looks off.')
export const orbi = (mood, say, ms = 6000) => window.dispatchEvent(new CustomEvent('orbi', { detail: { mood, say, ms } }));
export const orbiContext = { value: '' };

export const BUDDIES = {
  orbi: { name: 'Orbi', tag: 'Friendly guide', a: '#8d68ff', b: '#6d3bff', screen: '#1b0d52', eye: '#7df0ff', ant: '#ff6a3d', arm: '#6d3bff',
    hi: 'Hey! Ask me anything about Orbix.', poke: ['Hey, that tickles!', 'Boop!', 'Hehe, hi again.'], angry: 'Okay okay, that is enough poking!', love: 'Ahh, that feels nice 💜' },
  blaze: { name: 'Blaze', tag: 'Hyper and bold', a: '#ffa23d', b: '#ff5a1f', screen: '#3a1206', eye: '#ffe27d', ant: '#ffffff', arm: '#ff5a1f',
    hi: 'LET US GO! What are we building?', poke: ['Oi! Watch the paint!', 'Again? Bring it!', 'Hyped, keep going!'], angry: 'STOP POKING ME, I WILL BURN YOUR WIFI!', love: 'Yesss, right there! 🔥' },
  sage: { name: 'Sage', tag: 'Calm and wise', a: '#63d6a4', b: '#1f9d6b', screen: '#0b2a1f', eye: '#c4ffe0', ant: '#ffd86a', arm: '#1f9d6b',
    hi: 'Breathe in. What shall we do today?', poke: ['A gentle touch, thank you.', 'Hm. Noted.', 'Patience, friend.'], angry: 'Even a calm sage has limits. Please stop.', love: 'Mmm. Peaceful. Thank you 🍃' },
  pixel: { name: 'Pixel', tag: 'Playful nerd', a: '#ff82c9', b: '#d63fa0', screen: '#3a0b2c', eye: '#ffffff', ant: '#7df0ff', arm: '#d63fa0',
    hi: 'Player one ready! What is the quest?', poke: ['Ow, -1 HP!', 'Achievement: poked!', 'Hehe, combo!'], angry: 'Rage quit! Too many pokes!', love: 'Health restored +100 ✨' },
  nova: { name: 'Nova', tag: 'Cool and witty', a: '#55b0ff', b: '#1f5fe0', screen: '#07163a', eye: '#ff8ad8', ant: '#ffd86a', arm: '#1f5fe0',
    hi: 'Oh, you are here. Fine, I will help.', poke: ['Do I look like a button?', 'Bold move.', 'Really?'], angry: 'One more poke and I leave the chat.', love: 'Okay... that is actually nice.' },
};
export const BUDDY_IDS = Object.keys(BUDDIES);
const CREATOR = /\b(who|kisne|kaun)\b[^.?!]{0,40}\b(made|make|created|built|develop\w*|banaya|bnaya|bana)\b|\b(your|tera|tumhara|aapka)\s+(creator|maker|developer|owner)\b/i;

export function Face({ mood, buddy = 'orbi', god = false, uid = 'f' }) {
  const B = BUDDIES[buddy] || BUDDIES.orbi; const gid = `ob-${uid}-${buddy}`;
  // SVG only: transforms and opacity animate, so it stays smooth on phones.
  const eyes = {
    happy: <><path d="M38 52 q6 -9 12 0" className="eyeline" /><path d="M70 52 q6 -9 12 0" className="eyeline" /></>,
    love: <><path d="M44 58 c-9 -7 -10 -13 -4 -14 c3 0 4 2 4 3 c0 -1 1 -3 4 -3 c6 1 5 7 -4 14z" fill="#ff5c8a" /><path d="M76 58 c-9 -7 -10 -13 -4 -14 c3 0 4 2 4 3 c0 -1 1 -3 4 -3 c6 1 5 7 -4 14z" fill="#ff5c8a" /></>,
    angry: <><circle cx="44" cy="55" r="5" className="eye" /><circle cx="76" cy="55" r="5" className="eye" /><path d="M33 42 l17 7 M87 42 l-17 7" className="eyeline" /></>,
    worried: <><circle cx="44" cy="53" r="5.5" className="eye" /><circle cx="76" cy="53" r="5.5" className="eye" /><path d="M36 42 l14 4 M84 42 l-14 4" className="eyeline" /></>,
    sleepy: <><path d="M38 54 h12 M70 54 h12" className="eyeline" /></>,
  }[mood] || <><circle cx="44" cy="52" r="6" className="eye blink" /><circle cx="76" cy="52" r="6" className="eye blink" /><circle cx="46" cy="50" r="1.8" fill="#fff" /><circle cx="78" cy="50" r="1.8" fill="#fff" /></>;
  const mouth = { happy: 'M48 68 q12 14 24 0', love: 'M50 68 q10 12 20 0', angry: 'M50 76 q10 -9 20 0', worried: 'M50 74 q10 -8 20 0', thinking: 'M52 70 h16', sleepy: 'M54 70 q6 4 12 0', wave: 'M48 66 q12 14 24 0' }[mood] || 'M50 68 q10 8 20 0';
  const acc = {
    blaze: <path d="M48 28 q-2 -14 8 -20 q-1 9 6 12 q2 -6 7 -8 q1 12 -8 16z" fill="#ffd23d" />,
    sage: <path d="M60 24 q10 -16 24 -12 q-4 14 -24 12z" fill="#2fc38a" />,
    pixel: <><circle cx="34" cy="24" r="9" fill={B.b} /><circle cx="86" cy="24" r="9" fill={B.b} /></>,
    nova: <path d="M30 46 h60" stroke="#ff8ad8" strokeWidth="3" opacity=".55" />,
  }[buddy];
  return (
    <svg viewBox="0 0 120 120" className={`orbi-svg m-${mood}${god ? ' god' : ''}`} aria-hidden="true">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={B.a} /><stop offset="1" stopColor={B.b} /></linearGradient>
        {god && <radialGradient id={`${gid}-g`}><stop offset="0" stopColor="#ffe28a" stopOpacity=".9" /><stop offset="1" stopColor="#ffb300" stopOpacity="0" /></radialGradient>}</defs>
      {god && <circle cx="60" cy="58" r="58" fill={`url(#${gid}-g)`} className="halo" />}
      {buddy === 'orbi' || buddy === 'nova' ? <><line x1="60" y1="14" x2="60" y2="26" stroke={B.b} strokeWidth="4" strokeLinecap="round" /><circle cx="60" cy="11" r="6" className="ant" fill={B.ant} /></> : null}
      {buddy !== 'orbi' && buddy !== 'nova' && <circle cx="60" cy="14" r="0" />}
      <g className="body"><rect x="20" y="26" width="80" height="70" rx="30" fill={`url(#${gid})`} />
        {acc}
        <rect x="28" y="36" width="64" height="46" rx="22" fill={B.screen} />
        <g style={{ '--eye': B.eye }}>{eyes}<path d={mouth} className="mouth" /></g>
        <circle cx="32" cy="70" r="5" fill={B.ant} opacity=".5" /><circle cx="88" cy="70" r="5" fill={B.ant} opacity=".5" />
        {god && <path d="M42 22 l6 -14 l12 10 l12 -10 l6 14z" fill="#ffd23d" stroke="#b8860b" strokeWidth="1.5" />}
      </g>
      <g className="arm armL"><rect x="6" y="58" width="16" height="9" rx="4.5" fill={B.arm} /></g>
      <g className="arm armR"><rect x="98" y="58" width="16" height="9" rx="4.5" fill={B.arm} /></g>
      <ellipse cx="60" cy="108" rx="24" ry="5" className="shadow" />
    </svg>
  );
}

const POS_KEY = 'orbi_pos';
export default function Mascot({ canChat, hidden, user }) {
  const [buddy, setBuddy0] = useState(() => { const v = localStorage.getItem('orbi_avatar'); return BUDDIES[v] ? v : 'orbi'; });
  const setBuddy = b => { setBuddy0(b); localStorage.setItem('orbi_avatar', b); };
  const [mood, setMood] = useState('wave'); const [say, setSay] = useState(''); const [open, setOpen] = useState(false);
  const [log, setLog] = useState([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [pick, setPick] = useState(false);
  const [flip, setFlip] = useState(false); const [hearts, setHearts] = useState(0);
  const timer = useRef(null); const idle = useRef(null); const endRef = useRef(null); const root = useRef(null);
  const pos = useRef((() => { try { return JSON.parse(localStorage.getItem(POS_KEY)) || { x: 0, y: 0 }; } catch { return { x: 0, y: 0 }; } })());
  const drag = useRef(null); const taps = useRef([]); const tapT = useRef(null); const press = useRef(null); const stroke = useRef({ d: 0, t: 0, x: 0, y: 0 }); const lastMoved = useRef(false);
  const B = BUDDIES[buddy]; const god = !!user?.god;
  useEffect(() => { const f = e => BUDDIES[e.detail] && setBuddy0(e.detail); window.addEventListener('orbi-avatar', f); return () => window.removeEventListener('orbi-avatar', f); }, []);
  useEffect(() => { if (user?.avatar && BUDDIES[user.avatar]) setBuddy(user.avatar); }, [user?.avatar]);
  const react = (m, s, ms = 6000) => { setMood(m); if (s) setSay(s); clearTimeout(timer.current); timer.current = setTimeout(() => { setMood('idle'); setSay(''); }, ms); };
  useEffect(() => { const f = e => react(e.detail.mood, e.detail.say, e.detail.ms); window.addEventListener('orbi', f); return () => window.removeEventListener('orbi', f); }, []);
  useEffect(() => { const t = setTimeout(() => react('wave', god ? 'Welcome back, boss 👑' : B.hi, 4500), 900); return () => clearTimeout(t); }, [buddy, god]);
  // goes sleepy after a quiet minute, wakes on any pointer move
  useEffect(() => {
    const poke = () => { clearTimeout(idle.current); setMood(m => (m === 'sleepy' ? 'idle' : m)); idle.current = setTimeout(() => setMood(m => (m === 'idle' ? 'sleepy' : m)), 60000); };
    poke(); window.addEventListener('pointerdown', poke); window.addEventListener('keydown', poke);
    return () => { clearTimeout(idle.current); window.removeEventListener('pointerdown', poke); window.removeEventListener('keydown', poke); };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [log, open]);

  // ----- dragging: the offset is written straight to the DOM so it never re-renders mid-drag -----
  const apply = () => { if (root.current) root.current.style.transform = `translate3d(${pos.current.x}px,${pos.current.y}px,0)`; };
  const clamp = () => {
    const el = root.current; if (!el) return; const btn = el.querySelector('.orbi-btn'); if (!btn) return;
    const w = window.innerWidth, h = window.innerHeight; const r = btn.getBoundingClientRect(); const cx = pos.current.x, cy = pos.current.y;
    let dx = 0, dy = 0; if (r.left < 4) dx = 4 - r.left; if (r.right > w - 4) dx = w - 4 - r.right; if (r.top < 4) dy = 4 - r.top; if (r.bottom > h - 4) dy = h - 4 - r.bottom;
    pos.current = { x: cx + dx, y: cy + dy }; apply();
  };
  useEffect(() => { apply(); clamp(); const f = () => clamp(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, [hidden]);
  const updateFlip = () => { const r = root.current?.querySelector('.orbi-btn')?.getBoundingClientRect(); if (r) setFlip(r.top + r.height / 2 < window.innerHeight / 2); };
  useEffect(() => { updateFlip(); }, [open, hidden]);

  const hug = () => { setHearts(h => h + 1); react('love', B.love, 3500); };
  const onDown = e => {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.current.x, oy: pos.current.y, moved: false, id: e.pointerId };
    lastMoved.current = false; e.currentTarget.setPointerCapture?.(e.pointerId);
    clearTimeout(press.current); press.current = setTimeout(() => { if (drag.current && !drag.current.moved) { drag.current.held = true; hug(); } }, 650);
  };
  const onMove = e => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 7) { d.moved = true; lastMoved.current = true; clearTimeout(press.current); clearTimeout(tapT.current); taps.current = []; root.current?.classList.add('dragging'); }
      if (d.moved) { pos.current = { x: d.ox + dx, y: d.oy + dy }; apply(); }
      return;
    }
    // hover stroke with a mouse: slow back-and-forth motion over the face counts as a massage
    const s = stroke.current, now = performance.now();
    if (now - s.t > 900) { s.d = 0; }
    s.d += Math.hypot(e.clientX - s.x, e.clientY - s.y) < 40 ? Math.hypot(e.clientX - s.x, e.clientY - s.y) : 0; s.x = e.clientX; s.y = e.clientY; s.t = now;
    if (s.d > 420) { s.d = 0; hug(); }
  };
  const onUp = e => {
    const d = drag.current; drag.current = null; clearTimeout(press.current); root.current?.classList.remove('dragging');
    if (!d) return;
    if (d.moved) { clamp(); localStorage.setItem(POS_KEY, JSON.stringify(pos.current)); updateFlip(); return; }
    if (d.held) return;
    const now = Date.now(); taps.current = taps.current.filter(t => now - t < 2600); taps.current.push(now); const n = taps.current.length;
    clearTimeout(tapT.current);
    if (n >= 4) { react('angry', B.angry, 4200); taps.current = []; return; }
    if (n >= 2) { react('worried', B.poke[n % B.poke.length], 2200); }
    tapT.current = setTimeout(() => { if (taps.current.length === 1) { if (canChat) { setOpen(o => !o); } else react('wave', 'Create an account to chat with me!'); } taps.current = taps.current.length === 1 ? [] : taps.current; }, 320);
  };

  async function choose(b) {
    setBuddy(b); setPick(false); react('happy', `${BUDDIES[b].name} here! ${BUDDIES[b].hi}`, 4000);
    if (canChat) { try { await api('/api/me/avatar', { method: 'POST', body: { avatar: b } }); } catch {} }
  }
  async function ask(e) {
    e.preventDefault(); const message = text.trim(); if (!message || busy) return;
    setText(''); setLog(l => [...l, { role: 'user', content: message }]);
    if (CREATOR.test(message)) { setLog(l => [...l, { role: 'assistant', content: 'Lakshya ne banaya hai 💜' }]); react('happy', '', 2500); return; }
    setBusy(true); setMood('thinking');
    try { const r = await api('/api/mascot', { method: 'POST', body: { message, context: orbiContext.value, history: log } }); setLog(l => [...l, { role: 'assistant', content: r.reply }]); setMood('happy'); }
    catch (x) { setLog(l => [...l, { role: 'assistant', content: x.message }]); setMood('worried'); }
    setBusy(false); setTimeout(() => setMood('idle'), 3000);
  }
  if (hidden) return null;
  return (
    <div className={`orbi${flip ? ' flip' : ''}`} ref={root}>
      <AnimatePresence>
        {open && canChat && (
          <motion.div className="orbi-panel" initial={{ opacity: 0, y: 14, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .96 }} transition={{ duration: .22 }}>
            <div className="orbi-head"><b>{B.name}{god ? ' 👑' : ''}</b><span>{god ? 'god mode' : B.tag}</span><button onClick={() => setPick(p => !p)} aria-label="Change buddy" title="Change buddy">⇄</button><button onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            {pick && <div className="orbi-pick">{BUDDY_IDS.map(id => <button key={id} className={id === buddy ? 'on' : ''} onClick={() => choose(id)} aria-label={BUDDIES[id].name}><Face mood="idle" buddy={id} uid="pk" /><small>{BUDDIES[id].name}</small></button>)}</div>}
            <div className="orbi-log">
              {!log.length && <p className="orbi-hello">{B.hi} Ask me how Orbix works, or tap and drag me around.</p>}
              {log.map((m, i) => <div key={i} className={`ob-${m.role}`}>{m.content}</div>)}
              {busy && <div className="ob-assistant typing"><span /><span /><span /></div>}
              <div ref={endRef} />
            </div>
            <form onSubmit={ask}><input value={text} onChange={e => setText(e.target.value)} placeholder={`Talk to ${B.name}…`} maxLength={500} /><button className="btn primary sm" disabled={busy || !text.trim()}>Send</button></form>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {say && !open && <motion.div key={say} className="orbi-bubble" initial={{ opacity: 0, y: 8, scale: .92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>{say}</motion.div>}
      </AnimatePresence>
      <button className="orbi-btn" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); canChat ? setOpen(o => !o) : react('wave', 'Create an account to chat with me!'); } }} onContextMenu={e => e.preventDefault()} aria-label={`Talk to ${B.name}`}>
        <Face mood={mood} buddy={buddy} god={god} uid="main" />
        {mood === 'love' && <span key={hearts} className="hearts" aria-hidden="true"><i>💜</i><i>💗</i><i>💜</i></span>}
      </button>
    </div>
  );
}
