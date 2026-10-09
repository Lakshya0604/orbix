// Background "make a Short" jobs: topic -> LLM script -> one clip per scene -> ffmpeg stitch -> mp4 stored in Mongo.
import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { chatCompletion } from './llm.js';
import { generateClip, generateSpeech, generateAgnesClip } from './media.js';
const { Schema, model } = mongoose; const run = promisify(execFile);

export const VideoJob = model('VideoJob', new Schema({
  userId: { type: Schema.Types.ObjectId, index: true }, topic: String, title: { type: String, default: '' },
  status: { type: String, default: 'queued', index: true }, // queued, scripting, clips, stitching, done, failed
  scenes: [{ act: { type: String, default: '' }, prompt: String, kw: { type: String, default: '' }, say: { type: String, default: '' }, state: { type: String, default: 'wait' }, tries: { type: Number, default: 0 } }], error: String, note: String, mode: { type: String, default: 'ai' }, long: { type: Boolean, default: false }, stage: { type: String, default: '' }, startedAt: Date,
  lockUntil: { type: Date, default: null }, bytes: { type: Number, default: 0 },
}, { timestamps: true }));
export const VideoBlob = model('VideoBlob', new Schema({ jobId: { type: Schema.Types.ObjectId, index: true }, kind: String, idx: Number, data: Buffer }, { timestamps: true }));

export const MAX_ACTIVE = 1, MAX_PER_DAY = 4, SCENES = 4, LONG_SCENES = 14;
export async function startJob(userId, topic, long = false) {
  const t = String(topic || '').trim().slice(0, 200);
  if (t.length < 3) throw Object.assign(new Error('Tell me what the video is about.'), { status: 400 });
  await VideoJob.updateMany({ userId, status: { $nin: ['done', 'failed'] }, updatedAt: { $lt: new Date(Date.now() - 20 * 60000) } }, { status: 'failed', error: 'This one got stuck (the server restarted). Please start it again.' });
  if (await VideoJob.countDocuments({ userId, status: { $nin: ['done', 'failed'] } }) >= MAX_ACTIVE) throw Object.assign(new Error('One video is already being made. Wait for it to finish.'), { status: 429 });
  if (await VideoJob.countDocuments({ userId, createdAt: { $gt: new Date(Date.now() - 86400000) } }) >= MAX_PER_DAY) throw Object.assign(new Error(`Free limit: ${MAX_PER_DAY} videos per day.`), { status: 429 });
  return VideoJob.create({ userId, topic: t, long: !!long, startedAt: new Date() });
}

const ARC = 'The scenes must be ONE connected story with a clear arc: a hook/intro that sets the character and place, a buildup that raises the stakes, a turn or twist, a climax, and a closing ending that pays off the start. Each scene continues directly from the previous one (same characters, same place, cause and effect), never a list of unrelated facts.';
const jsonOf = t => { try { return JSON.parse(String(t || '').match(/\{[\s\S]*\}/)?.[0] || ''); } catch { return null; } };
async function script(job) {
  const N = job.long ? LONG_SCENES : SCENES; let outline = '';
  if (job.long) {
    let o = null;
    for (let k = 0; k < 3 && !o; k++) { const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: `You plan a short story for a narrated video. Reply with ONLY valid JSON (no double quote characters inside text): {"title":"...","acts":[{"act":"intro","beat":"..."},{"act":"buildup","beat":"..."},{"act":"twist","beat":"..."},{"act":"climax","beat":"..."},{"act":"ending","beat":"..."}]}. Each beat is 1 or 2 sentences. Same language as the user's topic (Hindi in Devanagari if the topic is Hindi or Hinglish). One coherent story with named or clearly described characters.` }, { role: 'user', content: `Topic: ${job.topic}` }] }); const j = jsonOf(m.content); if (j && Array.isArray(j.acts) && j.acts.length >= 4) o = j; }
    if (!o) throw new Error('Could not plan the story. Try again.');
    outline = `Story title: ${o.title}\n` + o.acts.map((x, i) => `${i + 1}. ${x.act}: ${x.beat}`).join('\n'); job.title = String(o.title || job.topic).slice(0, 80);
  }
  let j = null;
  const sysFor = (n, extra) => `You write vertical YouTube Shorts style narrated stories. Reply with ONLY valid JSON (never use double quote characters inside the text values): {"title":"...","scenes":[{"act":"intro","shot":"...","kw":"...","say":"..."}]}. Exactly ${n} scenes. ${ARC} "act" is one of intro, buildup, twist, climax, ending. "shot" is ONE visual description in English, 20 to 40 words, concrete (subject, setting, light, camera move), no text overlays, no real people or brands. "kw" is 2 or 3 plain English words to search a stock video site for this shot (for example "lighthouse storm sea"). "say" is the narration for that shot, spoken in the same language as the user's topic (English if unsure; Hindi in Devanagari script if the topic is Hindi or Hinglish): ${job.long ? '1 or 2 sentences of 12 to 22 words' : 'ONE sentence of 8 to 12 words'}.${extra || ''}`;
  if (job.long) {
    const plan = [['intro', 3], ['buildup', 3], ['twist', 2], ['climax', 3], ['ending', 3]]; const acc = [];
    for (const [act, n] of plan) {
      let got = null;
      for (let t = 0; t < 3 && !got; t++) {
        job.stage = `Writing the story: ${act}`; await job.save().catch(() => {});
        const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: sysFor(n, `\nStory plan:\n${outline}\nWrite ONLY the "${act}" part now: exactly ${n} scenes, all with act "${act}".${acc.length ? `\nNarration so far (continue straight from it):\n${acc.map(x => x.say).join(' ')}` : ''}`) }, { role: 'user', content: `Topic: ${job.topic}` }] });
        const x = jsonOf(m.content); if (x && Array.isArray(x.scenes) && x.scenes.length >= 2) got = x.scenes.slice(0, n);
      }
      if (!got) throw new Error('The script came back broken. Try again.');
      got.forEach(x => { if (x && typeof x === 'object') x.act = act; }); acc.push(...got);
    }
    j = { title: job.title, scenes: acc };
  } else for (let tryN = 0; tryN < 3 && !j; tryN++) {
    const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: sysFor(N, ` The scenes follow that order.`) }, { role: 'user', content: `Topic: ${job.topic}` }] });
    const x = jsonOf(m.content); if (x && Array.isArray(x.scenes) && x.scenes.length >= Math.min(N, 4)) j = x;
  }
  if (!j) throw new Error('The script came back broken. Try again.');
  const scenes = j.scenes.map(x => typeof x === 'string' ? { act: '', shot: x, kw: '', say: '' } : { act: String(x?.act || ''), shot: String(x?.shot || ''), kw: String(x?.kw || ''), say: String(x?.say || '') }).filter(x => x.shot).slice(0, N).map(x => ({ act: x.act.slice(0, 12), prompt: x.shot.slice(0, 400), kw: x.kw.replace(/[^\w ]/g, ' ').slice(0, 60).trim(), say: x.say.slice(0, 320) }));
  if (scenes.length < 2) throw new Error('The script came back empty. Try another topic.');
  job.title = String(job.title || j.title || job.topic).slice(0, 80); job.scenes = scenes; job.status = 'clips'; job.stage = `Story ready: ${scenes.length} scenes`; await job.save();
}
const W = 512, H = 704;
const dur = async f => { try { await run(ffmpegPath, ['-i', f]); } catch (e) { const m = String(e.stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/); if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); } return 0; };
async function stitch(job) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-v-'));
  try {
    const clips = await VideoBlob.find({ jobId: job._id, kind: 'clip' }).sort('idx');
    if (!clips.length) throw new Error('No clips to stitch.');
    const segs = []; let voiced = 0;
    for (const c of clips) {
      job.stage = `Joining clip ${segs.length + 1} of ${clips.length}`; await job.save().catch(() => {});
      const cf = path.join(dir, `c${c.idx}.mp4`); await fs.writeFile(cf, c.data); const cd = (await dur(cf)) || 4;
      const ab = await VideoBlob.findOne({ jobId: job._id, kind: 'audio', idx: c.idx }); let af = null, ad = 0;
      if (ab) { af = path.join(dir, `a${c.idx}.mp3`); await fs.writeFile(af, ab.data); ad = await dur(af); if (ad) voiced++; else af = null; }
      const D = Math.max(cd, ad + 0.25); const seg = path.join(dir, `s${c.idx}.mp4`);
      const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,tpad=stop_mode=clone:stop_duration=${Math.max(0, D - cd).toFixed(2)}`;
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', cf, ...(af ? ['-i', af] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']), '-vf', vf, '-af', 'aresample=44100,apad', '-t', D.toFixed(2), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', job.long ? '30' : '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', '-movflags', '+faststart', seg], { timeout: 120000 });
      segs.push(`file '${seg}'`);
    }
    await fs.writeFile(path.join(dir, 'l.txt'), segs.join('\n'));
    const out = path.join(dir, 'out.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'l.txt'), '-c', 'copy', '-movflags', '+faststart', out], { timeout: 120000 });
    let data = await fs.readFile(out);
    if (data.length > 15.5e6) throw new Error('This video is too long to save on the free plan yet. Try a shorter story.');
    await VideoBlob.deleteMany({ jobId: job._id, kind: 'final' }); await VideoBlob.create({ jobId: job._id, kind: 'final', idx: 0, data });
    job.bytes = data.length; job.status = 'done'; job.note = `${clips.length} clips, ${voiced ? `${voiced} with voiceover` : 'no voiceover (voice service was busy)'}, vertical 9:16${job.note ? ' · ' + job.note : ''}`; await job.save();
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// Fallback when the free GPU quota is out: a free keyless AI picture (Pollinations) + slow Ken Burns pan/zoom -> 4 s clip.
async function stillClip(prompt, i) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-k-'));
  try {
    const q = encodeURIComponent(`${String(prompt).slice(0, 350)}, vertical cinematic photo, vivid light`);
    let buf = null, err = '';
    for (let a = 0; a < 3 && !buf; a++) {
      try { const r = await fetch(`https://image.pollinations.ai/prompt/${q}?width=576&height=1024&nologo=true&seed=${Date.now() % 100000 + i}`, { signal: AbortSignal.timeout(60000) }); const b = Buffer.from(await r.arrayBuffer()); if (r.ok && /image/.test(r.headers.get('content-type') || '') && b.length > 5000) buf = b; else err = `HTTP ${r.status}`; } catch (e) { err = e.message; }
      if (!buf) await new Promise(r => setTimeout(r, 4000));
    }
    if (!buf) throw new Error(`The free picture service did not answer (${String(err).slice(0, 60)}).`);
    const img = path.join(dir, 'i.jpg'), out = path.join(dir, 'k.mp4'); await fs.writeFile(img, buf);
    const z = i % 2 ? "'1.28-0.0020*on'" : "'1+0.0020*on'";
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-loop', '1', '-i', img, '-vf', `scale=1080:-2,zoompan=z=${z}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=96:s=${W}x${H}:fps=24,format=yuv420p`, '-t', '4', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-movflags', '+faststart', out], { timeout: 90000 });
    return await fs.readFile(out);
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// Stock fallback (free Pixabay API key): real stock footage for the scene keywords, cropped to 9:16 and trimmed to 4.5 s.
async function stockClip(job, i) {
  const key = process.env.PIXABAY_KEY; if (!key) throw new Error('No stock key set.');
  const sc = job.scenes[i]; const mark = async t => { job.note = `stock ${i}: ${t}`; await job.save().catch(() => {}); }; await mark('search'); const base = String(sc.kw || sc.prompt).split(/\s+/).slice(0, 4).join(' ');
  let hit = null;
  for (const q of [base, base.split(' ').slice(0, 2).join(' '), String(job.topic).split(/\s+/).slice(0, 3).join(' '), 'nature']) {
    const r = await fetch(`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Stock service said HTTP ${r.status}.`);
    const hits = ((await r.json()).hits || []).filter(h => (h.duration || 0) >= 3 && h.videos?.medium?.url);
    if (hits.length) { hit = hits[(i * 3 + Date.now()) % Math.min(hits.length, 8)]; break; }
  }
  await mark('download'); if (!hit) throw new Error('No stock footage found for this topic.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-s-'));
  try {
    const r = await fetch((hit.videos.small?.url || hit.videos.medium.url), { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Could not download stock footage.');
    const src = path.join(dir, 's.mp4'), out = path.join(dir, 'o.mp4'); await fs.writeFile(src, Buffer.from(await r.arrayBuffer())); await mark('encode');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', src, '-t', '4.5', '-an', '-threads', '1', '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,format=yuv420p`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-movflags', '+faststart', out], { timeout: 90000 });
    return await fs.readFile(out);
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const NOTE = { agnes: 'Free AI-video GPU was used up today, so this one uses Agnes AI video', stock: 'Free AI-video GPU was used up today, so this one uses free stock footage (Pixabay)', still: 'Free AI-video GPU was used up today, so this one uses AI pictures with slow motion' };
let agnesOffUntil = 0;
const fallbackMode = () => process.env.AGNES_API_KEY && Date.now() > agnesOffUntil ? 'agnes' : process.env.PIXABAY_KEY ? 'stock' : 'still';
let agnesAt = 0;
let gpuDownAt = 0; // last time the free GPU quota failed; skip the slow AI attempt for 30 min after
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), ms))]);
const stage = async (job, t) => { job.stage = t; await job.save().catch(() => {}); };
async function makeScene(job, i) {
  const tag = `Clip ${i + 1} of ${job.scenes.length}`;
  let data;
  if (job.mode === 'ai' && Date.now() - gpuDownAt < 1800000 && fallbackMode() !== 'still') { job.mode = fallbackMode(); job.note = NOTE[job.mode]; await job.save(); }
  if (job.mode === 'ai' || !job.mode) {
    try {
      await stage(job, `${tag}: AI video`);
      const url = await generateClip({ prompt: job.scenes[i].prompt, seconds: 4, width: W, height: H, waitMs: 80000 });
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Could not download the clip.');
      data = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (!/used up|quota|GPU/i.test(e.message)) throw e;
      gpuDownAt = Date.now();
      const done = job.scenes.filter(s => s.state === 'ok').length;
      if (done) { await VideoBlob.deleteMany({ jobId: job._id, kind: { $in: ['clip', 'audio'] } }); job.scenes.forEach(s => { s.state = 'wait'; }); }
      job.mode = fallbackMode(); job.note = NOTE[job.mode]; await job.save();
    }
  }
  if (job.mode === 'agnes') {
    try {
      const wait = agnesAt + 62000 - Date.now(); if (wait > 0) await new Promise(x => setTimeout(x, wait));
      agnesAt = Date.now(); const t0 = Date.now(); const out = await generateAgnesClip({ prompt: job.scenes[i].prompt });
      const r = await fetch(out.url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Could not download the Agnes clip.');
      data = Buffer.from(await r.arrayBuffer()); job.note = `${NOTE.agnes} (${out.size || '?'}, ${Math.round((Date.now() - t0) / 1000)}s/clip)`;
    } catch (e) {
      console.error('agnes', e.message.slice(0, 160)); if (/model_not_found|No available channel|HTTP 40[13]/.test(e.message)) agnesOffUntil = Date.now() + 6 * 3600000;
      if (!process.env.PIXABAY_KEY) throw e;
      data = await stockClip(job, i); job.note = `${NOTE.agnes} + Pixabay stock for some scenes (${e.message.slice(0, 60)})`;
    }
  }
  if (job.mode === 'stock') { await stage(job, `${tag}: finding footage`); data = await stockClip(job, i); job.note = NOTE.stock; }
  if (job.mode === 'still') data = await stillClip(job.scenes[i].prompt, i);
  await VideoBlob.deleteMany({ jobId: job._id, kind: 'clip', idx: i }); await VideoBlob.create({ jobId: job._id, kind: 'clip', idx: i, data });
  if (job.scenes[i].say) {
    await stage(job, `${tag}: voiceover`);
    try { const au = await generateSpeech({ text: job.scenes[i].say, hindi: /[\u0900-\u097F]/.test(job.scenes[i].say) }); const ar = await fetch(au, { signal: AbortSignal.timeout(30000) }); if (ar.ok) { await VideoBlob.deleteMany({ jobId: job._id, kind: 'audio', idx: i }); await VideoBlob.create({ jobId: job._id, kind: 'audio', idx: i, data: Buffer.from(await ar.arrayBuffer()) }); } } catch (e) { console.error('voice', e.message.slice(0, 120)); }
  }
  job.scenes[i].state = 'ok'; await job.save();
}
async function step(job) {
  if (job.status === 'queued' || job.status === 'scripting') { job.status = 'scripting'; job.stage = job.long ? 'Planning the story' : 'Writing the script'; await job.save(); return script(job); }
  if (job.status === 'clips') {
    const i = job.scenes.findIndex(s => s.state === 'wait');
    if (i < 0) { const ok = job.scenes.filter(s => s.state === 'ok').length; if (ok < 2) throw new Error('Not enough clips could be made. Please try again.'); job.status = 'stitching'; job.stage = 'Joining clips with the voice'; return job.save(); }
    try { await withTimeout(makeScene(job, i), 170000, `Clip ${i + 1}`); }
    catch (e) {
      console.error('scene', i, e.message.slice(0, 140)); job = await VideoJob.findById(job._id); if (!job) return;
      const sc = job.scenes[i];
      if (sc.state === 'ok') return;
      sc.tries = (sc.tries || 0) + 1; if (sc.tries >= 2) { sc.state = 'skip'; job.note = `Some clips were skipped (${String(e.message).slice(0, 70)})`; }
      job.stage = sc.state === 'skip' ? `Clip ${i + 1} skipped, moving on` : `Clip ${i + 1} stalled, retrying`; await job.save();
    }
    return;
  }
  if (job.status === 'stitching') return stitch(job);
}
let busy = false;
async function tick() {
  if (busy || mongoose.connection.readyState !== 1) return; busy = true;
  try {
    const job = await VideoJob.findOneAndUpdate({ status: { $nin: ['done', 'failed'] }, $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }] }, { lockUntil: new Date(Date.now() + 4 * 60000) }, { new: true, sort: 'createdAt' });
    if (!job) return;
    try { await step(job); } catch (e) { console.error('video job', String(job._id), e.message); job.status = 'failed'; job.error = String(e.message).slice(0, 200); await job.save(); }
    await VideoJob.updateOne({ _id: job._id }, { lockUntil: null });
  } catch (e) { console.error('video tick', e.message); } finally { busy = false; }
}
export const startWorker = () => { setInterval(tick, 4000).unref?.(); };
const progress = j => {
  const n = (j.scenes || []).length, done = (j.scenes || []).filter(s => s.state !== 'wait').length;
  const pct = { queued: 3, scripting: 8, clips: Math.round(12 + 76 * done / Math.max(1, n)), stitching: 92, done: 100, failed: 0 }[j.status] ?? 0;
  const left = j.status === 'clips' ? (n - done) * 30 + 60 : j.status === 'stitching' ? 60 : j.status === 'scripting' ? 90 + (n || (j.long ? 14 : 4)) * 30 : 0;
  return { pct, etaSec: ['done', 'failed'].includes(j.status) ? 0 : left };
};
export const publicJob = j => ({ ...progress(j), long: !!j.long, stage: j.stage || '', id: String(j._id), topic: j.topic, title: j.title, status: j.status, scenes: (j.scenes || []).map(s => s.state), error: j.error || null, note: j.note || null, bytes: j.bytes, at: j.createdAt });
