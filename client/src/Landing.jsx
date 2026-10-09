import React, { useEffect, useState, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { api } from './api.js';
const Orbit3D = lazy(() => import('./Orbit3D.jsx')); // three.js loads after first paint so the page shows up fast
import Tilt from './Tilt.jsx';

const FEATURES = [
  ['01', 'Connect in one tap', 'Every server in the catalog passed a real connection test. Add it, watch the dot turn green.'],
  ['02', 'One chat, every tool', 'Ask in plain words. Orbix picks the tools, runs them in order and shows each step.'],
  ['03', 'Download anything', 'Videos, images, files. Whatever a tool makes is one tap away, and shareable by link.'],
];
const rise = (i = 0) => ({ initial: { opacity: 0, y: 26 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: .65, delay: i * .08, ease: [.22, 1, .36, 1] } });

export default function Landing({ dark, setDark, onGuest, busy, err }) {
  const [servers, setServers] = useState([]);
  useEffect(() => { api('/api/catalog').then(c => setServers(c.servers)).catch(() => {}); }, []);
  const names = servers.map(s => s.name);
  return (
    <div className="land">
      <div className="mesh" aria-hidden="true"><i /><i /><i /></div><div className="grid-bg" aria-hidden="true" />
      <nav className="lnav">
        <div className="brand"><span className="logo-dot" />Orbix</div>
        <div className="grow" />
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? '☀' : '☾'}</button>
        <a className="lnk" href="#/login">Log in</a>
        <a className="btn primary sm" href="#/signup">Get started</a>
      </nav>
      <header className="lhero">
        <div className="lcopy">
          <motion.span className="pill" {...rise(0)}><span className="pulse connected" />{servers.length} servers tested live today</motion.span>
          <motion.h1 {...rise(1)}>Every MCP server.<br /><span className="grad">One conversation.</span></motion.h1>
          <motion.p {...rise(2)}>Connect free MCP servers, watch each one live, and ask for anything. Orbix chains the right tools and hands you the result to download.</motion.p>
          <motion.div className="cta" {...rise(3)}>
            <a className="btn primary big-cta" href="#/signup">Create free account <span>→</span></a>
            <a className="btn ghost big-cta" href="#/signup">Create free account</a>
          </motion.div>
          <p className="fine">Free to use. Sign up takes a few seconds.</p>
          {err && <div className="msg err">{err}</div>}
        </div>
        <motion.div className="lart" initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, ease: [.22, 1, .36, 1] }}>
          <Suspense fallback={null}><Orbit3D dark={dark} count={8} /></Suspense>
          <Tilt className="float-card fc1" max={14}><span className="pulse connected" /> DeepWiki <em>connected</em></Tilt>
          <Tilt className="float-card fc2" max={14}>▶ text-to-video <em>2.1s</em></Tilt>
          <Tilt className="float-card fc3" max={14}>⬇ balloon.mp4 <em>ready</em></Tilt>
        </motion.div>
      </header>
      {!!names.length && <div className="marquee" aria-label="Available servers"><div className="track">{[...names, ...names, ...names].map((n, i) => <span key={i}>{n}</span>)}</div></div>}
      <section className="feats">
        {FEATURES.map(([n, t, d], i) => <motion.div key={n} {...rise(i)}><Tilt className="feat"><span className="num">{n}</span><h3>{t}</h3><p>{d}</p></Tilt></motion.div>)}
      </section>
      <motion.section className="closing" {...rise(0)}>
        <h2>Connect your first MCP server in a minute.</h2>
        <a className="btn primary big-cta" href="#/signup">Create free account →</a>
      </motion.section>
      <footer className="lfoot">Orbix · built by Lakshya Yadav · <a href="https://github.com/Lakshya0604/orbix" target="_blank" rel="noreferrer noopener">source on GitHub</a></footer>
    </div>
  );
}
