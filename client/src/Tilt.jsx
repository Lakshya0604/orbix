import React, { useRef } from 'react';
// Pointer-driven 3D tilt. Only transform is animated, so it stays smooth on phones. No-op for touch and reduced motion.
export default function Tilt({ children, className = '', max = 8, as: Tag = 'div', ...rest }) {
  const ref = useRef(null);
  const ok = typeof window !== 'undefined' && window.matchMedia('(hover:hover)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const move = e => { if (!ok) return; const el = ref.current, b = el.getBoundingClientRect(); const x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5; el.style.transform = `perspective(800px) rotateY(${x * max}deg) rotateX(${-y * max}deg) translateZ(0)`; el.style.setProperty('--gx', `${(x + .5) * 100}%`); el.style.setProperty('--gy', `${(y + .5) * 100}%`); };
  const leave = () => { if (ref.current) ref.current.style.transform = ''; };
  return <Tag ref={ref} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave} {...rest}>{children}</Tag>;
}
