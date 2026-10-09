import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api.js';

// Any part of the app can make Orbi react: orbi('worried', 'That password looks off.')
export const orbi = (mood, say, ms = 6000) => window.dispatchEvent(new CustomEvent('orbi', { detail: { mood, say, ms } }));
export const orbiContext = { value: '' };

function Face({ mood }) {
  // SVG only: transforms and opacity animate, so it stays smooth on phones.
  const eyes = {
    happy: <><path d="M38 52 q6 -9 12 0" className="eyeline" /><path d="M70 52 q6 -9 12 0" className="eyeline" /></>,
    worried: <><circle cx="44" cy="53" r="5.5" className="eye" /><circle cx="76" cy="53" r="5.5" className="eye" /><path d="M36 42 l14 4 M84 42 l-14 4" className="eyeline" /></>,
    sleepy: <><path d="M38 54 h12 M70 54 h12" className="eyeline" /></>,
  }[mood] || <><circle cx="44" cy="52" r="6" className="eye blink" /><circle cx="76" cy="52" r="6" className="eye blink" /><circle cx="46" cy="50" r="1.8" fill="#fff" /><circle cx="78" cy="50" r="1.8" fill="#fff" /></>;
  const mouth = { happy: 'M48 68 q12 14 24 0', worried: 'M50 74 q10 -8 20 0', thinking: 'M52 70 h16', sleepy: 'M54 70 q6 4 12 0', wave: 'M48 66 q12 14 24 0' }[mood] || 'M50 68 q10 8 20 0';
  return (
    <svg viewBox="0 0 120 120" className={`orbi-svg m-${mood}`} aria-hidden="true">
      <defs><linearGradient id="ob" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8d68ff" /><stop offset="1" stopColor="#6d3bff" /></linearGradient></defs>
      <line x1="60" y1="14" x2="60" y2="26" stroke="#6d3bff" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="11" r="6" className="ant" fill="#ff6a3d" />
      <g className="body"><rect x="20" y="26" width="80" height="70" rx="30" fill="url(#ob)" />
        <rect x="28" y="36" width="64" height="46" rx="22" fill="#1b0d52" />
        {eyes}<path d={mouth} className="mouth" />
        <circle cx="32" cy="70" r="5" fill="#ff6a3d" opacity=".5" /><circle cx="88" cy="70" r="5" fill="#ff6a3d" opacity=".5" />
      </g>
      <g className="arm armL"><rect x="6" y="58" width="16" height="9" rx="4.5" fill="#6d3bff" /></g>
      <g className="arm armR"><rect x="98" y="58" width="16" height="9" rx="4.5" fill="#6d3bff" /></g>
      <ellipse cx="60" cy="108" rx="24" ry="5" className="shadow" />
    </svg>
  );
}

export default function Mascot({ canChat, hidden }) {
  const [mood, setMood] = useState('wave'); const [say, setSay] = useState(''); const [open, setOpen] = useState(false);
  const [log, setLog] = useState([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const timer = useRef(null); const idle = useRef(null); const endRef = useRef(null);
  const react = (m, s, ms = 6000) => { setMood(m); if (s) setSay(s); clearTimeout(timer.current); timer.current = setTimeout(() => { setMood('idle'); setSay(''); }, ms); };
  useEffect(() => { const f = e => react(e.detail.mood, e.detail.say, e.detail.ms); window.addEventListener('orbi', f); return () => window.removeEventListener('orbi', f); }, []);
  // goes sleepy after a quiet minute, wakes on any pointer move
  useEffect(() => {
    const poke = () => { clearTimeout(idle.current); setMood(m => (m === 'sleepy' ? 'idle' : m)); idle.current = setTimeout(() => setMood(m => (m === 'idle' ? 'sleepy' : m)), 60000); };
    poke(); window.addEventListener('pointerdown', poke); window.addEventListener('keydown', poke);
    return () => { clearTimeout(idle.current); window.removeEventListener('pointerdown', poke); window.removeEventListener('keydown', poke); };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [log, open]);
  async function ask(e) {
    e.preventDefault(); const message = text.trim(); if (!message || busy) return;
    setText(''); setLog(l => [...l, { role: 'user', content: message }]); setBusy(true); setMood('thinking');
    try { const r = await api('/api/mascot', { method: 'POST', body: { message, context: orbiContext.value, history: log } }); setLog(l => [...l, { role: 'assistant', content: r.reply }]); setMood('happy'); }
    catch (x) { setLog(l => [...l, { role: 'assistant', content: x.message }]); setMood('worried'); }
    setBusy(false); setTimeout(() => setMood('idle'), 3000);
  }
  if (hidden) return null;
  return (
    <div className="orbi">
      <AnimatePresence>
        {open && canChat && (
          <motion.div className="orbi-panel" initial={{ opacity: 0, y: 14, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .96 }} transition={{ duration: .22 }}>
            <div className="orbi-head"><b>Orbi</b><span>your guide</span><button onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            <div className="orbi-log">
              {!log.length && <p className="orbi-hello">Ask me anything about Orbix. How do I connect a server? What can I try?</p>}
              {log.map((m, i) => <div key={i} className={`ob-${m.role}`}>{m.content}</div>)}
              {busy && <div className="ob-assistant typing"><span /><span /><span /></div>}
              <div ref={endRef} />
            </div>
            <form onSubmit={ask}><input value={text} onChange={e => setText(e.target.value)} placeholder="Talk to Orbi…" maxLength={500} /><button className="btn primary sm" disabled={busy || !text.trim()}>Send</button></form>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {say && !open && <motion.div key={say} className="orbi-bubble" initial={{ opacity: 0, y: 8, scale: .92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>{say}</motion.div>}
      </AnimatePresence>
      <button className="orbi-btn" onClick={() => (canChat ? setOpen(!open) : react('wave', 'Create an account to chat with me!'))} aria-label="Talk to Orbi"><Face mood={mood} /></button>
    </div>
  );
}
