import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { token } from './api.js';

const URL_RE = /(https:\/\/[^\s"'<>)\]]+)/g;
const isVideo = u => /\.(mp4|webm|mov)(\?|$)/i.test(u);
const isImage = u => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u);
const nameOf = u => decodeURIComponent((u.split('?')[0].split('/').pop() || 'orbix-file'));

export async function download(url) {
  const r = await fetch(`/api/download?url=${encodeURIComponent(url)}`, { headers: { authorization: `Bearer ${token()}` } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Download failed'); }
  const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nameOf(url); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function saveText(text, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

function Media({ url, onError, shared }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await download(url); } catch (e) { onError(e.message); } setBusy(false); };
  return (
    <motion.div className="media" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
      {isVideo(url) && <video src={url} controls playsInline preload="metadata" />}
      {isImage(url) && <img src={url} alt="" loading="lazy" />}
      <div className="media-bar"><span title={url}>{nameOf(url)}</span>{shared ? <a className="btn primary sm" href={url} target="_blank" rel="noreferrer noopener" download>⬇ Open file</a> : <button className="btn primary sm" onClick={go} disabled={busy}>{busy ? 'Downloading…' : '⬇ Download'}</button>}</div>
    </motion.div>
  );
}
export function Answer({ text, onError, shared }) {
  const parts = text.split(URL_RE);
  const media = [...new Set((text.match(URL_RE) || []).filter(u => isVideo(u) || isImage(u) || /\.(mp3|wav|pdf|zip|csv)(\?|$)/i.test(u) || /\/file=/.test(u)))];
  return (<>
    <div className="answer">{parts.map((p, i) => i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p.length > 60 ? p.slice(0, 57) + '…' : p}</a> : <span key={i}>{p}</span>)}</div>
    {media.map(u => <Media key={u} url={u} onError={onError} shared={shared} />)}
  </>);
}
export function Steps({ steps, live }) {
  const [open, setOpen] = useState(!!live);
  if (!steps?.length) return null;
  return (
    <div className="steps">
      <button className="steps-toggle" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {steps.length} tool {steps.length === 1 ? 'call' : 'calls'}{live ? ' · working…' : ''}</button>
      {open && steps.map(s => (
        <div key={s.id} className={`step ${s.status}`}>
          <div className="step-h"><span className="dot" /><b>{s.server}</b><span className="tn">{s.tool}</span>{s.ms != null && <span className="ms">{s.ms} ms</span>}<span className="st">{s.status}</span></div>
          {s.preview && <pre>{s.preview.slice(0, 500)}{s.preview.length > 500 ? '…' : ''}</pre>}
        </div>
      ))}
    </div>
  );
}

