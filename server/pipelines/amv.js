// AMV mode: song + anime source -> Hindi AMV (word-by-word Devanagari lyric reveal).
// Ported from the proven local Musime pipeline (2026-10-15: 4 shipped AMVs).
// Style lock: one anime per video, no repeated clips, word-by-word lyric reveal bottom-center,
// full song covered (video length == song length), 1080p lanczos, no baked text/watermark shots.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
const run = promisify(execFile);
const FONT_DIR = process.env.AMV_FONT_DIR || '/usr/share/fonts/truetype/noto';
const SLICE_PRESET = process.env.AMV_SLICE_PRESET || 'veryfast'; // Render free 512MB: x264 RAM scales with preset
const RENDER_PRESET = process.env.AMV_RENDER_PRESET || 'veryfast';

const LYRIC_FONT = 'Noto Sans Devanagari';
const HEAD_FONT = 'Noto Sans';

// ASS timestamp h:mm:ss.cc
const fmt = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = (t % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${s}`; };

// lines: [{start, end, text}] (song-timeline seconds, Devanagari).
// Word-by-word reveal: one ASS dialogue event per word; word i appears at its reveal time,
// stays until line end, whole line fades out over 0.3s. Reveal spreads across 78% of line span
// weighted by word length (same pacing as the proven drawtext build).
export function buildLyricsAss(lines) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyric,${LYRIC_FONT},46,&H00FFFFFF,&HFF000000,&HD8000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,2,60,60,120,1
Style: Header,${HEAD_FONT},34,&HD8FFFFFF,&HD8FFFFFF,&H99000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,60,60,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  for (const ln of lines) {
    const ss = ln.start + 0.08, se = ln.end - 0.08;
    const words = ln.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const span = se - ss;
    const revealEnd = ss + 0.1 + (span - 0.6) * 0.78;
    const chars = words.map(w => Math.max(1, [...w].length));
    const ctot = chars.reduce((a, b) => a + b, 0);
    let cum = 0;
    const ws = words.map((w, i) => { const t0 = ss + 0.1 + (cum / ctot) * (revealEnd - ss - 0.1); cum += chars[i]; return t0; });
    // karaoke \kf sweep: each word flips from Secondary (transparent) to Primary at its reveal time,
    // paced by the same length-weighted curve as the proven drawtext build.
    let kf = '';
    words.forEach((w, i) => {
      const durCs = Math.max(1, Math.round((ws[i] - (i ? ws[i - 1] : ss)) * 100));
      kf += `{\\kf${durCs}}${w}${i < words.length - 1 ? ' ' : ''}`;
    });
    ev.push(`Dialogue: 0,${fmt(ss)},${fmt(se)},Lyric,,0,0,0,,{\\fad(100,300)}${kf}`);
  }
  return header + ev.join('\n') + '\n';
}

// Header card (song - artist) shown t=1..7 top-left.
export function headerEvent(text) {
  return `Dialogue: 0,${fmt(1)},${fmt(7)},Header,,0,0,0,,{\\fad(400,400)}${text}`;
}

export async function probeDuration(file) {
  try { await run(ffmpegPath, ['-i', file]); } catch (e) {
    const m = String(e.stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return 0;
}

// cuts: [{start, end, src}] (song seconds + source seconds). One ffmpeg per slice -> concat.
export function sliceArgs(src, mt, dur, out, crop = null) {
  const vf = `${crop ? crop + ',' : ''}scale=1920:1080:flags=lanczos,fps=24,eq=saturation=1.06:contrast=1.02,setsar=1`;
  return ['-y', '-loglevel', 'error', '-ss', String(mt), '-t', String(dur + 0.5), '-i', src,
    '-vf', vf, '-t', String(dur), '-an', '-c:v', 'libx264', '-preset', SLICE_PRESET, '-crf', '17', '-threads', '2', '-pix_fmt', 'yuv420p', out];
}

export async function buildTrack(srcFile, cuts, dir, crop = null, onProgress = null) {
  const segs = [];
  for (let i = 0; i < cuts.length; i++) {
    const out = path.join(dir, `f${String(i).padStart(2, '0')}.mp4`);
    await run(ffmpegPath, sliceArgs(srcFile, cuts[i].src, cuts[i].end - cuts[i].start, out, crop), { timeout: 120000 });
    segs.push(out);
    onProgress?.(i + 1, cuts.length);
  }
  const lst = path.join(dir, 'flist.txt');
  await fs.writeFile(lst, segs.map(s => `file '${s}'`).join('\n'));
  const cat = path.join(dir, 'track.mp4');
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', cat], { timeout: 120000 });
  return cat;
}

// Final mux: track + song + ASS lyrics + audio fade. fadeOut at (dur-2.4).
export function renderArgs(track, song, assFile, out, dur, fontsDir = FONT_DIR) {
  const af = `[1:a]afade=t=out:st=${(dur - 2.5).toFixed(2)}:d=2.5[aout]`;
  const vf = `fade=t=in:st=0:d=1,fade=t=out:st=${(dur - 2.4).toFixed(2)}:d=2.4,subtitles=${assFile}:fontsdir=${fontsDir}`;
  return ['-y', '-loglevel', 'error', '-i', track, '-i', song,
    '-vf', vf, '-filter_complex', af, '-map', '0:v', '-map', '[aout]',
    '-t', String(dur), '-c:v', 'libx264', '-preset', RENDER_PRESET, '-crf', '19', '-threads', '2', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
}

// ---- Timing map: Groq whisper segments -> lyric lines + instrumental windows ----
// Reuses media.js transcribeSong (whisper-large-v3, verbose_json). Caller passes language 'hi'.
// Lesson from 2026-10-15: released songs drop stanzas / have long instrumental interludes and
// whisper hallucinates on them - so gaps >8s are marked instrumental (no lyric events there),
// and head/tail segments are flagged for a manual speech check (baked ads/intros happen).
export function mapTiming(segments, songDur, { gapMin = 8, headWin = 10, tailWin = 12 } = {}) {
  const segs = (segments || []).map(s => ({ start: +s.start, end: +s.end, text: String(s.text || '').trim() }))
    .filter(s => s.text && s.end > s.start).sort((a, b) => a.start - b.start);
  const lines = segs.map(s => ({ start: s.start, end: s.end, text: s.text }));
  const instrumentals = [];
  let prevEnd = 0;
  for (const s of segs) {
    if (s.start - prevEnd >= gapMin) instrumentals.push({ start: prevEnd, end: s.start });
    prevEnd = Math.max(prevEnd, s.end);
  }
  if (songDur - prevEnd >= gapMin) instrumentals.push({ start: prevEnd, end: songDur });
  const flags = [];
  if (segs.length && segs[0].start < headWin) flags.push({ kind: 'head-speech', at: segs[0].start, text: segs[0].text.slice(0, 60) });
  if (segs.length && songDur - segs[segs.length - 1].end < tailWin) flags.push({ kind: 'tail-speech', at: segs[segs.length - 1].end, text: segs[segs.length - 1].text.slice(0, 60) });
  return { lines, instrumentals, flags };
}

// ---- Scene scout: frame grids over the anime (one 5x5 grid per 750s, 30s spacing) ----
export async function buildGrids(srcFile, dir, { gridSpan = 750, step = 30, cols = 5, rows = 5, width = 320 } = {}) {
  const dur = await probeDuration(srcFile);
  const grids = [];
  for (let ss = 0; ss < dur; ss += gridSpan) {
    const out = path.join(dir, `g${grids.length}.jpg`);
    let effStep = step;
    for (let attempt = 0; attempt < 3; attempt++) {
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-ss', String(ss), '-t', String(gridSpan), '-i', srcFile,
        '-vf', `fps=1/${effStep},scale=${width}:-2,tile=${cols}x${rows}`, '-frames:v', '1', out], { timeout: 180000 });
      try { const st = await fs.stat(out); if (st.size > 0) break; } catch { /* missing: retry tighter */ }
      effStep = Math.max(1, Math.round(effStep / 4)); // short clip: tighter sampling so tile fills
      if (attempt === 2) throw new Error(`buildGrids: no frames at ${ss}s of ${srcFile}`);
    }
    grids.push({ file: out, t0: ss, step: effStep });
  }
  return grids;
}

// Deterministic scene spread for unattended mode: n cuts evenly across the source,
// skipping head/tail (fan-upload logos, credit tails). Agent-assisted picking comes later.
export function pickCuts(srcDur, total, { n = 24, head = 45, tail = 45 } = {}) {
  const lo = Math.min(head, srcDur * 0.05), hi = Math.max(lo + 1, srcDur - Math.min(tail, srcDur * 0.05));
  const span = hi - lo, seg = total / n, cuts = [];
  for (let i = 0; i < n; i++) {
    const src = lo + ((i + 0.5) / n) * span - seg / 2;
    cuts.push({ start: i * seg, end: (i + 1) * seg, src: Math.max(lo, Math.min(hi - seg, src)) });
  }
  return cuts;
}

// ---- Thumbnail (ffmpeg-only; ffmpeg-static has libass but no drawtext) ----
// One bright-ish frame + dark band + Devanagari title (libass shaping) + orange EN subtitle.
export function buildThumbAss(title, sub) {
  const clean = t => String(t || '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: T,${LYRIC_FONT},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,2,2,40,40,205,1
Style: S,${HEAD_FONT},30,&H0000A5FF,&H0000A5FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,1,2,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,T,,0,0,0,,${clean(title)}
Dialogue: 0,0:00:00.00,0:00:02.00,S,,0,0,0,,${clean(sub)}
`;
}

export function thumbArgs(src, atSec, assPath, out, fontsDir = FONT_DIR) {
  const vf = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=black@0.5:t=fill,subtitles=${assPath}:fontsdir=${fontsDir}`;
  return ['-y', '-loglevel', 'error', '-ss', String(atSec), '-t', '2', '-i', src, '-vf', vf, '-frames:v', '1', '-q:v', '3', out];
}

export async function buildThumb(src, atSec, title, sub, out, fontsDir = FONT_DIR) {
  const assPath = out.replace(/\.[^.]+$/, '') + '.ass';
  await fs.writeFile(assPath, buildThumbAss(title, sub));
  await run(ffmpegPath, thumbArgs(src, atSec, assPath, out, fontsDir), { timeout: 120000 });
  const st = await fs.stat(out); if (!st.size) throw new Error('buildThumb: empty output');
  return out;
}

// Download a remote source to disk first: ffmpeg-static segfaults on https inputs (15 Oct test),
// and local slicing is faster than 24 range-seeking reads. Cap guards the free-plan disk.
export async function downloadTo(url, dest, { maxBytes = 2500e6, onProgress = null } = {}) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!r.ok || !r.body) throw new Error(`The anime link could not be fetched (${r.status}). Use a direct mp4/mkv link.`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error(`The anime file is ${(len / 1e9).toFixed(1)} GB - too big for the free plan (max ${(maxBytes / 1e9).toFixed(1)} GB).`);
  let got = 0;
  const { Transform } = await import('node:stream');
  const meter = new Transform({ transform(c, _e, cb) { got += c.length; if (got > maxBytes) { cb(new Error('File grew past the size limit.')); return; } onProgress?.(got); cb(null, c); } });
  await pipeline(r.body, meter, createWriteStream(dest));
  return got;
}
