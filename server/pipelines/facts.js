// FACTS SHORT mode (GyanDose-style): topic -> verified facts script (Groq) -> per-scene AI illustration
// (Gemini image first, free FLUX fallback) -> Gemini TTS voice (Orus, excited) -> ffmpeg render:
// yellow top strip, keyword boxes (red + yellow), numbered badge, emoji, word-by-word captions,
// synth bed + cut whooshes. All visuals AI-generated, all audio synthesized - no stock, no copyrighted music.
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { chatCompletion } from '../llm.js';
import { generateImage, generateImageGemini, generateSpeech } from '../media.js';
import { geminiTTS } from './providers.js';
import { assertPublicUrl } from '../ssrf.js';

const run = promisify(execFile);
const FW = 1080, FH = 1920, FPS = 24;
const IMG_STYLE = 'vivid dramatic digital illustration, rich saturated colors, high detail, vertical composition, cinematic lighting, no text, no letters, no watermark';

const jsonOf = t => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const assTime = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = (t % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${sec}`; };
const escAss = s => String(s || '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
const hasDev = s => /[\u0900-\u097F]/.test(s || '');
const fontFor = s => (hasDev(s) ? 'Noto Sans Devanagari' : 'Noto Sans');

const SCRIPT_SYS = `You write a Hindi YouTube Shorts FACTS video script (45-58 seconds spoken). Reply ONLY valid JSON, no double quotes inside values.
Shape: {"strip":"...","fiction":false,"scenes":[{"say":"...","kw":"...","emoji":"...","visual":"...","badge":"1","claim":"...","url":"...","evidence":"..."}]}
Rules:
- Exactly 6 scenes. Scene 1 = hook (badge empty, no claim/url). Scenes 2-5 = four numbered facts (badge "1".."4"). Scene 6 = ending: ask viewers to comment their favourite fact number and follow (badge empty, no claim/url).
- "strip" = short Hindi top-bar title, e.g. "अंतरिक्ष के 4 चौंकाने वाले सच". If the topic is fiction, set fiction true and start the strip with "(काल्पनिक)".
- "say" = 1-2 short spoken Hindi sentences in Devanagari. Hook must grab instantly. Number facts with "नंबर एक/दो/तीन/चार". Simple words, energetic.
- "kw" = keyword box, TWO lines separated by \\n: line 1 = the headline number/word in Hindi (max 3 words, e.g. "243 दिन"), line 2 = short kicker in Hindi (max 3 words, e.g. "साल 225 दिन").
- "emoji" = exactly one unicode emoji matching the scene.
- "visual" = ONE English sentence describing a vivid illustration of THIS line (what is visible, no text in image).
- For the 4 fact scenes: "claim" = the key checkable statement, "url" = a primary or authoritative source page (NASA, Britannica, Smithsonian, NIH/NCBI, NCERT, official museum or government sites), "evidence" = the exact number as digits then | then 2-3 English keywords that must appear on that page (e.g. "243|Venus|rotation|day"). Facts must be real, current, non-political, non-religious.`;

async function verifyFact(f) {
  try {
    const u = await assertPublicUrl(String(f.url || ''));
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; OrbixFacts/1.0)' } });
    if (!r.ok) return { ok: false, why: `http ${r.status}` };
    const html = await r.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    const parts = String(f.evidence || '').split('|').map(s => s.trim()).filter(Boolean);
    const num = parts[0] || '';
    const kws = parts.slice(1);
    const numOk = num ? text.includes(num.toLowerCase()) : true;
    const kwOk = kws.filter(k => text.includes(k.toLowerCase())).length >= Math.min(2, kws.length);
    return { ok: numOk && kwOk, why: numOk ? (kwOk ? '' : 'keywords missing') : 'number missing' };
  } catch (e) { return { ok: false, why: String(e.message).slice(0, 80) }; }
}

export async function factsScript(job, VideoJob) {
  let spec = null;
  for (let a = 0; a < 3 && !spec; a++) {
    try {
      const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: SCRIPT_SYS }, { role: 'user', content: `Topic: ${job.topic}` }] });
      const j = jsonOf(m.content);
      if (j && Array.isArray(j.scenes) && j.scenes.length >= 5) spec = j;
    } catch (e) { await new Promise(r => setTimeout(r, 6000 * (a + 1))); }
  }
  if (!spec) throw new Error('Could not write the facts script. Please try again.');
  spec.scenes = spec.scenes.slice(0, 6);
  // Verify the numbered facts against their sources; one LLM replacement round for failures.
  const factIdx = spec.scenes.map((s, i) => ({ s, i })).filter(x => x.s.url && x.s.claim);
  const failed = [];
  for (const x of factIdx) { const v = await verifyFact(x.s); x.s._verified = v.ok; if (!v.ok) failed.push({ ...x, why: v.why }); }
  if (failed.length) {
    try {
      const ask = failed.map(f => `Scene said: ${f.s.say} (source check failed: ${f.why})`).join('\n');
      const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: SCRIPT_SYS + '\nReturn ONLY the replacement fact scenes array: {"scenes":[...]} with the same keys, one per failed fact, on the SAME topic. Every url must be a page you are confident contains the number.' }, { role: 'user', content: `Topic: ${job.topic}\nFailed facts:\n${ask}` }] });
      const j = jsonOf(m.content);
      const reps = (j && Array.isArray(j.scenes) ? j.scenes : []).slice(0, failed.length);
      for (let k = 0; k < reps.length; k++) { const v = await verifyFact(reps[k]); if (v.ok) Object.assign(failed[k].s, reps[k], { _verified: true }); }
    } catch { /* keep originals dropped below */ }
  }
  const keptFacts = factIdx.filter(x => x.s._verified);
  if (keptFacts.length < 3) throw new Error('Could not verify at least 3 facts against their sources. Try a different topic.');
  const keepIdx = new Set([0, spec.scenes.length - 1, ...keptFacts.map(x => x.i)]);
  const scenes = spec.scenes.filter((s, i) => keepIdx.has(i));
  // Renumber badges 1..N in kept order.
  let b = 1;
  job.scenes = scenes.map(s => ({
    act: s.badge ? 'fact' : 'frame', prompt: String(s.visual || '').slice(0, 380), say: String(s.say || '').slice(0, 300),
    kw: String(s.kw || '').replace(/\\n/g, '\n').slice(0, 60), state: 'wait', tries: 0, t0: 0, t1: 0,
    badge: s.badge ? String(b++) : '',
  }));
  job.factsMeta = JSON.stringify({ strip: String(spec.strip || job.topic).slice(0, 60), fiction: !!spec.fiction, emojis: scenes.map(s => String(s.emoji || '').slice(0, 8)), sources: keptFacts.map(x => String(x.s.url).slice(0, 200)) });
  job.status = 'clips'; job.stage = 'Drawing scene 1'; await job.save();
}

const STORY_VOICE = process.env.FACTS_VOICE || 'Orus';
const VOICE_STYLE = 'Say this like a fast, excited young Indian YouTube Shorts storyteller with a strong hook:';

function wavWrap(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function makeFactsScene(job, i, VideoJob, VideoBlob, blobBytes) {
  const tag = `Scene ${i + 1} of ${job.scenes.length}`;
  // One voice track for the whole Short, made on the first scene pass.
  if (i === 0) {
    const have = await VideoBlob.findOne({ jobId: job._id, kind: 'factvoice' });
    if (!have) {
      job.stage = `${tag}: recording the voice`; await job.save().catch(() => {});
      const full = job.scenes.map(s => s.say).join(' ');
      let made = false;
      if (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2) {
        for (let a = 0; a < 2 && !made; a++) {
          try { const pcm = await geminiTTS({ text: full, voiceName: STORY_VOICE, style: VOICE_STYLE }); if (pcm?.length > 500) { await VideoBlob.create({ jobId: job._id, kind: 'factvoice', idx: 0, data: wavWrap(pcm) }); job.voiceVia = 'gemini-tts (Orus)'; made = true; } } catch (e) { console.error('facts voice', String(e.message).slice(0, 120)); await new Promise(r => setTimeout(r, 5000)); }
        }
      }
      if (!made) {
        for (const [k, sc] of job.scenes.entries()) {
          try { const au = await generateSpeech({ text: sc.say, hindi: true }); if (au?.data?.length > 200) { await VideoBlob.deleteMany({ jobId: job._id, kind: 'audio', idx: k }); await VideoBlob.create({ jobId: job._id, kind: 'audio', idx: k, data: au.data }); job.voiceVia = job.voiceVia && job.voiceVia !== au.via ? 'mixed' : au.via; } } catch (e) { console.error('facts voice fallback', String(e.message).slice(0, 100)); }
        }
      }
      await job.save().catch(() => {});
    }
  }
  job.stage = `${tag}: drawing`; await job.save().catch(() => {});
  const prompt = `${job.scenes[i].prompt}. ${IMG_STYLE}.`;
  let img = null, via = '';
  if (process.env.GEMINI_API_KEY) {
    for (let a = 0; a < 2 && !img; a++) { try { img = await generateImageGemini({ prompt, aspect: '9:16' }); via = 'Google AI Studio'; } catch (e) { console.error('facts gemini img', String(e.message).slice(0, 120)); await new Promise(r => setTimeout(r, 3000)); } }
  }
  if (!img) {
    for (let a = 0; a < 2 && !img; a++) {
      try {
        const url = await generateImage({ prompt, width: 768, height: 1024 });
        const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 5000) { img = b; via = 'FLUX (free GPU)'; } }
      } catch (e) { console.error('facts flux img', String(e.message).slice(0, 120)); await new Promise(r => setTimeout(r, 4000)); }
    }
  }
  if (!img) throw new Error('Free GPU quota is used up - could not draw this scene');
  await VideoBlob.deleteMany({ jobId: job._id, kind: 'factimg', idx: i });
  await VideoBlob.create({ jobId: job._id, kind: 'factimg', idx: i, data: img });
  job.panelStats = (job.panelStats || '') + (via === 'Google AI Studio' ? 'G' : 'F');
  job.note = `Facts Short (${via})`; await job.save().catch(() => {});
  const sc = job.scenes[i]; sc.state = 'ok'; await job.save();
}

// ---- timing helpers (ported from the GyanDose renderer) ----
export const wWeight = w => w.length + (/[,.!?]$/.test(w) ? 4 : 0);
export function sceneWordTimes(say, a, b) {
  const words = String(say).split(/\s+/).filter(Boolean);
  const ws = words.map(wWeight); const tot = ws.reduce((x, y) => x + y, 0) || 1;
  const span = Math.max(0.3, b - a - 0.15); let c = 0; const out = [];
  for (let k = 0; k < words.length; k++) { out.push([a + (c / tot) * span, a + ((c + ws[k] * 0.85) / tot) * span, words[k].replace(/[,.!?]+$/, '')]); c += ws[k]; }
  return out;
}

const emojiCp = e => [...String(e || '')].map(c => c.codePointAt(0).toString(16)).filter(x => x !== 'fe0f').join('-');

export function buildAss({ meta, scenes, total }) {
  const strip = escAss(meta.strip || 'Facts');
  const S = [];
  S.push(`[Script Info]\nScriptType: v4.00+\nPlayResX: ${FW}\nPlayResY: ${FH}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n`);
  S.push(`[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding`);
  S.push(`Style: Strip,${fontFor(strip)},46,&H00000000,&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,30,30,42,1`);
  S.push(`Style: KwR,Noto Sans Devanagari,100,&H00FFFFFF,&H00FFFFFF,&H001E14DC,&H00000000,-1,0,0,0,100,100,0,0,3,14,8,5,60,60,0,1`);
  S.push(`Style: KwY,Noto Sans Devanagari,92,&H00000000,&H00000000,&H0000D6FF,&H00000000,-1,0,0,0,100,100,0,0,3,12,8,5,60,60,0,1`);
  S.push(`Style: Badge,Noto Sans,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`);
  S.push(`Style: Circ,Noto Sans,10,&H001E14DC,&H001E14DC,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`);
  S.push(`Style: Cap,Noto Sans Devanagari,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,40,40,470,1`);
  S.push(`Style: Wm,Noto Sans,34,&H14FFFFFF,&H14FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,1,3,40,40,22,1`);
  S.push(`\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`);
  const ev = (layer, a, b, style, text) => S.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},${style},,0,0,0,,${text}`);
  ev(4, 0, total, 'Strip', strip);
  ev(1, 0, total, 'Wm', 'GyanDose');
  for (const sc of scenes) {
    const a = sc.t0, b = sc.t1;
    if (sc.badge) {
      ev(2, a, b, 'Circ', '{\\pos(120,272)\\p1}m 0 -78 b 43 -78 78 -43 78 0 b 78 43 43 78 0 78 b -43 78 -78 43 -78 0 b -78 -43 -43 -78 0 -78');
      ev(3, a, b, 'Badge', `{\\pos(120,272)}${sc.badge}`);
    }
    const kwLines = String(sc.kw || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 2);
    if (kwLines[0]) ev(3, a, b, 'KwR', `{\\pos(540,530)}${escAss(kwLines[0])}`);
    if (kwLines[1]) ev(3, a, b, 'KwY', `{\\pos(540,662)}${escAss(kwLines[1])}`);
    // word-by-word captions: chunk of 2 words (3 if remainder 3); one event per word position, current word yellow.
    const ws = sc.words || [];
    const chunks = []; let ci = 0;
    while (ci < ws.length) { let n = 2; if (ws.length - ci === 3) n = 3; if (ws[ci][2].length > 7 && ci + 1 < ws.length && ws[ci + 1][2].length > 7) n = 1; chunks.push(ws.slice(ci, ci + n)); ci += n; }
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const ch = chunks[cIdx];
      const nextStart = cIdx + 1 < chunks.length ? chunks[cIdx + 1][0][0] - 0.02 : Infinity;
      for (let k = 0; k < ch.length; k++) {
        const wa = ch[k][0] - 0.03, wb = Math.min(k + 1 < ch.length ? ch[k + 1][0] - 0.02 : ch[k][1] + 0.18, nextStart);
        const text = ch.map((w, j) => (j === k ? `{\\c&H00E6FF&}${escAss(w[2])}{\\c&HFFFFFF&}` : escAss(w[2]))).join(' ');
        if (text.trim()) ev(3, Math.max(a, wa), Math.min(b + 0.3, wb), 'Cap', text);
      }
    }
  }
  return S.join('\n');
}

export async function factsStitch(job, { VideoJob, VideoBlob, blobBytes, fontsDir, durOf }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-f-'));
  try {
    const meta = JSON.parse(job.factsMeta || '{}');
    const scenes = job.scenes.map((s, i) => ({ ...s.toObject?.() || s, i }));
    const okScenes = scenes.filter(s => s.state === 'ok');
    if (okScenes.length < 3) throw new Error('Not enough scenes could be drawn. Please try again.');
    // ---- audio ----
    job.stage = 'Mixing the voice'; await job.save().catch(() => {});
    let voiceFile = null, total = 0;
    const vb = await VideoBlob.findOne({ jobId: job._id, kind: 'factvoice' });
    if (vb) {
      const raw = path.join(dir, 'voice0.wav'); await fs.writeFile(raw, await blobBytes(vb));
      voiceFile = path.join(dir, 'voice.wav');
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,aresample=44100,atempo=1.15', '-ac', '1', voiceFile], { timeout: 120000 });
    } else {
      const parts = [];
      for (const s of okScenes) { const ab = await VideoBlob.findOne({ jobId: job._id, kind: 'audio', idx: s.i }); if (!ab) continue; const f = path.join(dir, `va${s.i}.wav`); await fs.writeFile(f, await blobBytes(ab)); parts.push(f); }
      if (!parts.length) throw new Error('The voice could not be made. Please try again.');
      const sil = path.join(dir, 'sil.wav'); await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.12', sil], { timeout: 30000 });
      const list = []; for (const p of parts) { list.push(p, sil); }
      voiceFile = path.join(dir, 'voice.wav');
      await fs.writeFile(path.join(dir, 'vl.txt'), list.map(f => `file '${f}'`).join('\n'));
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'vl.txt'), '-af', 'aresample=44100,atempo=1.15', '-ac', '1', voiceFile], { timeout: 120000 });
    }
    total = await durOf(voiceFile);
    if (!total) throw new Error('The voice track is empty.');
    // scene boundaries: weight by spoken words, snap to silences
    const sd = await run(ffmpegPath, ['-i', voiceFile, '-af', 'silencedetect=noise=-33dB:d=0.12', '-f', 'null', '-'], { timeout: 60000 }).catch(e => ({ stderr: e.stderr || '' }));
    const st = [...String(sd.stderr || '').matchAll(/silence_start: ([\d.]+)/g)].map(x => +x[1]);
    const en = [...String(sd.stderr || '').matchAll(/silence_end: ([\d.]+)/g)].map(x => +x[1]);
    const mids = st.map((a, k) => (a + (en[k] ?? a)) / 2);
    const wts = t => [...String(t)].reduce((n, ch) => n + (ch.trim() ? 1 + (/[,.!?]/.test(ch) ? 6 : 0) : 0), 0);
    const sw = okScenes.map(s => wts(s.say)); const tot = sw.reduce((a, b) => a + b, 0) || 1;
    const bounds = [0]; let cum = 0;
    for (let k = 0; k < okScenes.length - 1; k++) {
      cum += sw[k]; const est = (cum / tot) * total;
      const near = mids.filter(m => Math.abs(m - est) < 1.2);
      bounds.push(near.length ? near.reduce((x, y) => (Math.abs(x - est) < Math.abs(y - est) ? x : y)) : est);
    }
    bounds.push(total);
    okScenes.forEach((s, k) => { s.t0 = bounds[k]; s.t1 = bounds[k + 1]; s.words = sceneWordTimes(s.say, bounds[k], bounds[k + 1]); });
    // ---- video: zoompan cuts ----
    const segFiles = []; let cutTimes = [];
    for (const s of okScenes) {
      job.stage = `Animating scene ${okScenes.indexOf(s) + 1} of ${okScenes.length}`; await job.save().catch(() => {});
      const ib = await VideoBlob.findOne({ jobId: job._id, kind: 'factimg', idx: s.i });
      if (!ib) continue;
      const img = path.join(dir, `img${s.i}.png`); await fs.writeFile(img, await blobBytes(ib));
      const dur = Math.max(0.8, s.t1 - s.t0);
      const n = Math.max(1, Math.round(dur / 1.7));
      for (let j = 0; j < n; j++) {
        const cd = dur / n, frames = Math.max(1, Math.round(cd * FPS));
        const zin = (s.i + j) % 2 === 0;
        const z0 = zin ? 1.05 : 1.27, z1 = zin ? 1.27 : 1.05;
        const fx = 0.25 + (((s.i * 7 + j * 13) % 50) / 100), fy = 0.2 + (((s.i * 11 + j * 17) % 55) / 100);
        const seg = path.join(dir, `seg${s.i}_${j}.mp4`);
        await run(ffmpegPath, ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-i', img,
          '-vf', `scale=1620:2880,zoompan=z='${z0}+(${z1 - z0})*on/${frames}':x='(iw-iw/zoom)*${fx.toFixed(2)}':y='(ih-ih/zoom)*${fy.toFixed(2)}':d=${frames}:s=${FW}x${FH}:fps=${FPS}`,
          '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', seg], { timeout: 180000 });
        segFiles.push(seg);
      }
      for (let j = 1; j < n; j++) cutTimes.push(s.t0 + (dur / n) * j);
    }
    if (!segFiles.length) throw new Error('No scene images to render.');
    await fs.writeFile(path.join(dir, 'cl.txt'), segFiles.map(f => `file '${f}'`).join('\n'));
    const base = path.join(dir, 'base.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'cl.txt'), '-c', 'copy', '-movflags', '+faststart', base], { timeout: 120000 });
    // ---- overlays + final mix ----
    job.stage = 'Adding captions and music'; await job.save().catch(() => {});
    const fd = await fontsDir();
    const assPath = path.join(dir, 'facts.ass');
    await fs.writeFile(assPath, buildAss({ meta, scenes: okScenes, total }));
    // emoji inputs
    const emoFiles = [];
    for (const [k, s] of okScenes.entries()) {
      const cp = emojiCp((meta.emojis || [])[okScenes.indexOf(s)]);
      if (!cp) continue;
      try {
        const r = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${cp}.png`, { signal: AbortSignal.timeout(30000) });
        if (r.ok) { const f = path.join(dir, `em${k}.png`); await fs.writeFile(f, Buffer.from(await r.arrayBuffer())); emoFiles.push({ f, a: s.t0, b: s.t1 }); }
      } catch { /* emoji optional */ }
    }
    const inputs = ['-i', base, '-i', voiceFile];
    for (const e of emoFiles) inputs.push('-i', e.f);
    // audio chain: bed (sines) + kick + whooshes
    const bed = 'sine=frequency=110:sample_rate=44100[s1];sine=frequency=164.8:sample_rate=44100[s2];sine=frequency=220:sample_rate=44100[s3];[s1]volume=0.025[b1];[s2]volume=0.018[b2];[s3]volume=0.015[b3];[b1][b2][b3]amix=inputs=3:duration=first[bed]';
    const kick = `aevalsrc='sin(6.2831*65*mod(t,0.5085))*exp(-mod(t,0.5085)/0.03)':s=44100:d=${total.toFixed(2)},volume=0.09[kick]`;
    let whoosh = '', wlabels = [];
    cutTimes.slice(0, 40).forEach((t, k) => {
      whoosh += `anoisesrc=color=white:sample_rate=44100:duration=0.22[w${k}];[w${k}]lowpass=f=2600,volume=0.08,afade=t=in:st=0:d=0.05,afade=t=out:st=0.05:d=0.17,adelay=${Math.round(t * 1000)}:all=1[wh${k}];`;
      wlabels.push(`[wh${k}]`);
    });
    const mixIns = ['[1:a]', '[bed]', '[kick]', ...wlabels].join('');
    const fc = [
      `[0:v]drawbox=x=0:y=0:w=iw:h=150:color=0xFFC400:t=fill,subtitles=${assPath}:fontsdir=${fd}[b0]`,
      ...emoFiles.map((e, k) => { const src = `[b${k === 0 ? 0 : 'x' + (k - 1)}]`; const pre = `[${k + 2}:v]scale=420:420[em${k}]`; const ov = k === 0 ? `${pre};[b0][em${k}]overlay=620:200:enable='between(t,${e.a.toFixed(2)},${e.b.toFixed(2)})'[bx0]` : `${pre};[bx${k - 1}][em${k}]overlay=620:200:enable='between(t,${e.a.toFixed(2)},${e.b.toFixed(2)})'[bx${k}]`; return ov; }),
      bed + ';' + kick + ';' + whoosh + mixIns + `amix=inputs=${3 + wlabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`,
    ];
    const vOut = emoFiles.length ? `[bx${emoFiles.length - 1}]` : '[b0]';
    const out = path.join(dir, 'out.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', fc.join(';'), '-map', vOut, '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { timeout: 900000 });
    const data = await fs.readFile(out);
    if (data.length > 60e6) throw new Error('The video came out too large to save on the free plan.');
    await VideoBlob.deleteMany({ jobId: job._id, kind: 'final' });
    for (let p = 0; p * 7e6 < data.length; p++) await VideoBlob.create({ jobId: job._id, kind: 'final', idx: p, data: data.subarray(p * 7e6, (p + 1) * 7e6) });
    try {
      const tf = path.join(dir, 'thumb.jpg');
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-ss', (total * 0.4).toFixed(1), '-i', out, '-frames:v', '1', '-q:v', '4', tf], { timeout: 60000 });
      await VideoBlob.deleteMany({ jobId: job._id, kind: 'thumb' }); await VideoBlob.create({ jobId: job._id, kind: 'thumb', idx: 0, data: await fs.readFile(tf) });
    } catch (e) { console.error('facts thumb', String(e.message).slice(0, 100)); }
    const srcNote = (meta.sources || []).length ? ` · sources: ${(meta.sources || []).slice(0, 4).join(', ')}` : '';
    job.bytes = data.length; job.status = 'done';
    job.note = `Facts Short (${okScenes.filter(s => s.badge).length} verified facts, ${(job.voiceVia || 'ai voice')}, images ${job.panelStats || ''}) · Twemoji CC-BY 4.0${srcNote}`;
    await job.save();
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
