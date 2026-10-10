import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Answer, Steps } from './parts.jsx';

export default function Share({ id, dark, setDark }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api(`/api/share/${id}`).then(setD).catch(e => setErr(e.message)); }, [id]);
  return (
    <div className="sharepage">
      <header className="topbar"><a className="brand" href="#/" style={{ textDecoration: 'none', color: 'inherit' }}><span className="logo-dot" />Orbix</a><div className="grow" /><button className="icon-btn" onClick={() => setDark(!dark)}>{dark ? '☀' : '☾'}</button><a className="btn primary sm" href="#/">Try Orbix</a></header>
      <main className="thread">
        {err && <div className="hero"><h1>Link not available</h1><p>{err}</p></div>}
        {d && <><h2 className="share-title">{d.title}</h2><p className="hint">A conversation shared from Orbix, read only.</p>
          {d.messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.role === 'user' ? <div className="bubble">{m.content}</div> : <><Steps steps={m.steps} model={m.model} /><Answer text={m.content} onError={() => {}} shared /></>}</div>)}</>}
      </main>
    </div>
  );
}
