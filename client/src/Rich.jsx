import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PALETTE = ['#6d5efc', '#18c5a3', '#ff7a59', '#f5b82e', '#3aa0ff', '#e0509b', '#8ac926'];
let mid = 0;

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  return <button className="copy" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? 'Copied' : 'Copy'}</button>;
}

function Mermaid({ code }) {
  const ref = useRef(null); const [err, setErr] = useState(false); const [svg, setSvg] = useState('');
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const m = (await import('mermaid')).default;
        const dark = document.documentElement.dataset.theme === 'dark';
        m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'base', themeVariables: dark ? undefined : { primaryColor: '#efe9ff', primaryBorderColor: '#6d3bff', lineColor: '#7a6fa8', primaryTextColor: '#1d1830', fontSize: '14px' }, fontFamily: 'inherit' });
        const { svg } = await m.render(`mmd${++mid}`, code);
        if (!dead) setSvg(svg);
      } catch { if (!dead) setErr(true); }
    })();
    return () => { dead = true; };
  }, [code]);
  if (err) return <div className="rich-card"><div className="rich-h">Diagram (could not draw, source below)</div><pre><code>{code}</code></pre></div>;
  return <div className="rich-card diagram">{svg ? <div className="svgwrap" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="skel">Drawing diagram…</div>}</div>;
}

function Chart({ raw }) {
  let d; try { d = JSON.parse(raw); } catch { return <pre><code>{raw}</code></pre>; }
  const labels = (d.labels || []).map(String); const vals = (d.values || d.data || []).map(Number).filter(v => Number.isFinite(v));
  if (!labels.length || labels.length !== vals.length) return <pre><code>{raw}</code></pre>;
  const type = ['bar', 'line', 'pie'].includes(d.type) ? d.type : 'bar';
  const W = 520, H = 240, pad = 36, max = Math.max(...vals, 1), n = vals.length;
  const fmt = v => Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(Math.round(v * 100) / 100);
  let body;
  if (type === 'pie') {
    const tot = vals.reduce((a, b) => a + b, 0) || 1; let a0 = -Math.PI / 2; const R = 90, r = 52, cx = 120, cy = 120;
    body = <svg viewBox="0 0 400 240" role="img">{vals.map((v, i) => {
      const a1 = a0 + (v / tot) * Math.PI * 2 - 0.0001, big = a1 - a0 > Math.PI ? 1 : 0;
      const p = [cx + R * Math.cos(a0), cy + R * Math.sin(a0), cx + R * Math.cos(a1), cy + R * Math.sin(a1), cx + r * Math.cos(a1), cy + r * Math.sin(a1), cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      const path = `M${p[0]} ${p[1]}A${R} ${R} 0 ${big} 1 ${p[2]} ${p[3]}L${p[4]} ${p[5]}A${r} ${r} 0 ${big} 0 ${p[6]} ${p[7]}Z`; a0 = a1 + 0.0001;
      return <path key={i} d={path} fill={PALETTE[i % PALETTE.length]} className="ch-in" style={{ animationDelay: i * 70 + 'ms' }} />;
    })}{labels.map((l, i) => <g key={i} transform={`translate(250 ${30 + i * 22})`}><rect width="12" height="12" rx="3" fill={PALETTE[i % PALETTE.length]} /><text x="18" y="10" className="ch-t">{l.slice(0, 18)} · {Math.round(vals[i] / tot * 100)}%</text></g>)}</svg>;
  } else {
    const bw = (W - pad * 2) / n, y = v => H - pad - (v / max) * (H - pad * 2);
    body = <svg viewBox={`0 0 ${W} ${H}`} role="img">
      {[0, .5, 1].map(t => <g key={t}><line x1={pad} x2={W - pad} y1={y(max * t)} y2={y(max * t)} className="ch-grid" /><text x={pad - 6} y={y(max * t) + 4} textAnchor="end" className="ch-t">{fmt(max * t)}</text></g>)}
      {type === 'bar' ? vals.map((v, i) => <rect key={i} x={pad + i * bw + bw * .18} width={bw * .64} y={y(v)} height={H - pad - y(v)} rx="5" fill={PALETTE[i % PALETTE.length]} className="ch-bar" style={{ animationDelay: i * 60 + 'ms' }} />)
        : <><polyline fill="none" stroke={PALETTE[0]} strokeWidth="3" strokeLinejoin="round" className="ch-line" points={vals.map((v, i) => `${pad + i * bw + bw / 2},${y(v)}`).join(' ')} />{vals.map((v, i) => <circle key={i} cx={pad + i * bw + bw / 2} cy={y(v)} r="4" fill={PALETTE[0]} />)}</>}
      {labels.map((l, i) => <text key={i} x={pad + i * bw + bw / 2} y={H - 12} textAnchor="middle" className="ch-t">{l.length > 9 ? l.slice(0, 8) + '…' : l}</text>)}
    </svg>;
  }
  return <div className="rich-card">{d.title && <div className="rich-h">{d.title}</div>}{body}</div>;
}

export function Rich({ text }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
        table: ({ children }) => <div className="tbl"><table>{children}</table></div>,
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          const src = String(children).replace(/\n$/, ''); const lang = /language-(\w+)/.exec(className || '')?.[1];
          if (lang === 'mermaid') return <Mermaid code={src} />;
          if (lang === 'chart') return <Chart raw={src} />;
          if (!lang && !src.includes('\n')) return <code className="inl">{children}</code>;
          return <div className="codeblk"><div className="codebar"><span>{lang || 'text'}</span><CopyBtn text={src} /></div><pre><code>{src}</code></pre></div>;
        },
      }}>{text}</ReactMarkdown>
    </div>
  );
}
