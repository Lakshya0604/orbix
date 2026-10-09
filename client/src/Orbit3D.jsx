import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
// A glowing core with small "servers" orbiting it. Kept light: low DPR, few meshes, pauses when hidden.
export default function Orbit3D({ count = 7, dark }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const small = window.matchMedia('(max-width: 700px)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: !small, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100); cam.position.set(0, 1.2, 8);
    scene.add(new THREE.AmbientLight(0xffffff, dark ? 0.55 : 0.9));
    const key = new THREE.PointLight(0xff6a3d, 40, 30); key.position.set(4, 4, 5); scene.add(key);
    const fill = new THREE.PointLight(0x6d3bff, 36, 30); fill.position.set(-5, -2, 4); scene.add(fill);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, small ? 3 : 4), new THREE.MeshStandardMaterial({ color: 0x6d3bff, roughness: 0.25, metalness: 0.35, emissive: 0x2a0f8f, emissiveIntensity: 0.6 }));
    scene.add(core);
    const ringGeo = new THREE.TorusGeometry(2.6, 0.012, 8, 160);
    const rings = [];
    const sats = [];
    const cols = [0xff6a3d, 0xffb23d, 0xff3d8b, 0x3dd5ff, 0x8cff3d, 0xffffff, 0xb08cff];
    for (let i = 0; i < count; i++) {
      const pivot = new THREE.Object3D(); pivot.rotation.set((i * 0.7) % 3, (i * 1.3) % 3, 0); scene.add(pivot);
      const r = 2.4 + (i % 3) * 0.55;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: dark ? 0xffffff : 0x6d3bff, transparent: true, opacity: dark ? 0.12 : 0.18 })); ring.scale.setScalar(r / 2.6); pivot.add(ring); rings.push(ring);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.17 + (i % 2) * 0.07, 20, 20), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.3, emissive: cols[i % cols.length], emissiveIntensity: 0.35 }));
      s.userData = { r, speed: 0.25 + i * 0.07, a: i * 1.1 }; pivot.add(s); sats.push(s);
    }
    const resize = () => { const w = el.clientWidth || 300, h = el.clientHeight || 300; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    resize(); sats.forEach(s => { const { r, a } = s.userData; s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); }); renderer.render(scene, cam); // first frame always paints, even in a hidden tab
    const ro = new ResizeObserver(resize); ro.observe(el);
    let raf, visible = true, t = 0, mx = 0, my = 0;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(el);
    const move = e => { const b = el.getBoundingClientRect(); mx = ((e.clientX - b.left) / b.width - 0.5) * 2; my = ((e.clientY - b.top) / b.height - 0.5) * 2; };
    window.addEventListener('pointermove', move, { passive: true });
    const loop = () => {
      raf = requestAnimationFrame(loop); if (!visible || document.hidden) return;
      t += 0.016; core.rotation.y = t * 0.3; core.rotation.x = t * 0.12;
      core.scale.setScalar(1 + Math.sin(t * 1.6) * 0.025);
      sats.forEach(s => { const { r, speed, a } = s.userData; s.position.set(Math.cos(a + t * speed) * r, 0, Math.sin(a + t * speed) * r); });
      cam.position.x += (mx * 0.8 - cam.position.x) * 0.04; cam.position.y += (1.2 - my * 0.6 - cam.position.y) * 0.04; cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
    };
    if (reduce) { sats.forEach(s => { const { r, a } = s.userData; s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); }); renderer.render(scene, cam); } else loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener('pointermove', move); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [count, dark]);
  return <div ref={ref} className="orbit3d" aria-hidden="true" />;
}
