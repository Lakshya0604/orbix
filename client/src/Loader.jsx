import React, { useEffect, useState } from 'react';

export function Bot({ size = 96 }) {
  return (
    <svg className="lbot" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <ellipse className="lb-shadow" cx="60" cy="112" rx="26" ry="5" />
      <g className="lb-body">
        <line x1="60" y1="18" x2="60" y2="30" stroke="#6d3bff" strokeWidth="4" strokeLinecap="round" />
        <circle className="lb-ant" cx="60" cy="14" r="6" fill="#ff6a3d" />
        <rect x="24" y="30" width="72" height="62" rx="26" fill="url(#lbg)" />
        <rect x="34" y="42" width="52" height="38" rx="18" fill="#150f2e" />
        <g className="lb-eyes"><ellipse cx="49" cy="61" rx="6" ry="8" fill="#8bf3ff" /><ellipse cx="71" cy="61" rx="6" ry="8" fill="#8bf3ff" /></g>
        <path d="M52 74 Q60 79 68 74" stroke="#8bf3ff" strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle className="lb-arm l" cx="20" cy="62" r="7" fill="#8d68ff" /><circle className="lb-arm r" cx="100" cy="62" r="7" fill="#8d68ff" />
      </g>
      <defs><linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8d68ff" /><stop offset="1" stopColor="#6d3bff" /></linearGradient></defs>
    </svg>
  );
}

const STAGES = [[0, 'Loading Orbix…'], [4, 'Warming up the servers…'], [12, 'Free hosting wakes up slowly. Almost there…'], [30, 'Still waking up. The first load can take about a minute.']];
export default function Loader({ label, full = true }) {
  const [t, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT(x => x + 1), 1000); return () => clearInterval(i); }, []);
  const text = label || [...STAGES].reverse().find(([s]) => t >= s)[1];
  return (
    <div className={full ? 'loader full' : 'loader'} role="status" aria-live="polite">
      <Bot />
      <div className="lbar"><i /></div>
      <p>{text}</p>
    </div>
  );
}
