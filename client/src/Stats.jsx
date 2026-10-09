import React, { useEffect, useState } from 'react';
import { api } from './api.js';

const Bars = ({ rows, empty }) => rows.length ? <div className="st-bars">{rows.map(r => <div key={r.name} className="st-row"><span className="st-name">{r.name}</span><span className="st-bar"><i style={{ width: `${Math.max(6, (r.count / rows[0].count) * 100)}%` }} /></span><b>{r.count}</b></div>)}</div> : <p className="hint">{empty}</p>;

export default function Stats({ dark, setDark }) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/api/stats').then(setD).catch(e => setErr(e.message)); }, []);
  const max = d ? Math.max(1, ...d.days.map(x => x.views)) : 1;
  return (
    <div className="sharepage">
      <header className="topbar"><a className="brand" href="#/" style={{ textDecoration: 'none', color: 'inherit' }}><span className="logo-dot" />Orbix</a><div className="grow" /><button className="icon-btn" onClick={() => setDark(!dark)}>{dark ? '☀' : '☾'}</button><a className="btn primary sm" href="#/">Back to app</a></header>
      <main className="thread">
        <h2 className="share-title">Visitors</h2>
        {err && <div className="hero"><h1>{err === 'Not allowed.' ? 'Only the Orbix owner can see this page' : err}</h1></div>}
        {d && <>
          <div className="st-cards">
            <div className="st-card"><small>Today</small><b>{d.todayVisitors}</b><span>{d.todayViews} page views</span></div>
            <div className="st-card"><small>Last 30 days</small><b>{d.visitors30d}</b><span>{d.totalViews} page views</span></div>
            <div className="st-card"><small>Signed-up users</small><b>{d.users}</b><span>real accounts</span></div>
          </div>
          <h3>Page views, last 30 days</h3>
          <div className="st-chart">{d.days.map(x => <div key={x.day} title={`${x.day}: ${x.views} views, ${x.visitors} visitors`} className="st-col"><i style={{ height: `${(x.views / max) * 100}%` }} /></div>)}</div>
          <h3>Top pages</h3><Bars rows={d.pages} empty="No visits yet." />
          <h3>Where visitors came from</h3><Bars rows={d.referrers} empty="No outside referrers yet (direct visits only)." />
          <h3>Devices</h3><Bars rows={d.devices} empty="No data yet." />
          <p className="hint">Counts are anonymous: no cookies, no IP addresses stored, bots and uptime monitors are ignored. Visitors are counted per day.</p>
        </>}
      </main>
    </div>
  );
}
