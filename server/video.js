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
  scenes: [{ prompt: String, kw: { type: String, default: '' }, say: { type: String, default: '' }, state: { type: String, default: 'wait' } }], error: String, note: String, mode: { type: String, default: 'ai' },
  lockUntil: { type: Date, default: null }, bytes: { type: Number, default: 0 },
}, { timestamps: true }));
export const VideoBlob = model('VideoBlob', new Schema({ jobId: { type: Schema.Types.ObjectId, index: true }, kind: String, idx: Number, data: Buffer }, { timestamps: true }));

export const MAX_ACTIVE = 1, MAX_PER_DAY = 4, SCENES = 4;
export async function startJob(userId, topic) {
  const t = String(topic || '').trim().slice(0, 200);
  if (t.length < 3) throw Object.assign(new Error('Tell me what the video is about.'), { status: 400 });
  await VideoJob.updateMany({ userId, status: { $nin: ['done', 'failed'] }, updatedAt: { $lt: new Date(Date.now() - 20 * 60000) } }, { status: 'failed', error: 'This one got stuck (the server restarted). Please start it again.' });
  if (await VideoJob.countDocuments({ userId, status: { $nin: ['done', 'failed'] } }) >= MAX_ACTIVE) throw Object.assign(new Error('One video is already being made. Wait for it to finish.'), { status: 429 });
  if (await VideoJob.countDocuments({ userId, createdAt: { $gt: new Date(Date.now() - 86400000) } }) >= MAX_PER_DAY) throw Object.assign(new Error(`Free limit: ${MAX_PER_DAY} videos per day.`), { status: 429 });
  return VideoJob.create({ userId, topic: t });
}

async function script(job) {
  let j = null, lastErr = '';
  for (let tryN = 0; tryN < 3 && !j; tryN++) {
  const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: `You write ultra short vertical YouTube Shorts scripts with a voiceover. Reply with ONLY valid JSON (never use double quote characters inside the text values): {"title":"...","scenes":[{"shot":"...","kw":"...","say":"..."}]}. Exactly ${SCENES} scenes that tell one story with a hook first and a punchy end. "shot" is ONE visual description in English, 20 to 40 words, concrete (subject, setting, light, camera move), no text overlays, no real people or brands. "kw" is 2 or 3 plain English words to search a stock video site for this shot (for example "lighthouse storm sea"). "say" is the narration for that shot: ONE sentence of 8 to 12 words, spoken in the same language as the user's topic (English if unsure; Hindi in Devanagari script if the topic is Hindi or Hinglish).` }, { role: 'user', content: `Topic: ${job.topic}` }] });
  try { j = JSON.parse(String(m.content || '').match(/\{[\s\S]*\}/)?.[0] || '{}'); if (!Array.isArray(j.scenes)) j = null; } catch (e) { lastErr = e.message; j = null; }
  }
  if (!j) throw new Error('The script came back broken. Try again.');
  const scenes = (Array.isArray(j.scenes) ? j.scenes : []).map(x => typeof x === 'string' ? { shot: x, kw: '', say: '' } : { shot: String(x?.shot || ''), kw: String(x?.kw || ''), say: String(x?.say || '') }).filter(x => x.shot).slice(0, SCENES).map(x => ({ prompt: x.shot.slice(0, 400), kw: x.kw.replace(/[^\w ]/g, ' ').slice(0, 60).trim(), say: x.say.slice(0, 200) }));
  if (scenes.length < 2) throw new Error('The script came back empty. Try another topic.');
  job.title = String(j.title || job.topic).slice(0, 80); job.scenes = scenes; job.status = 'clips'; await job.save();
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
      const cf = path.join(dir, `c${c.idx}.mp4`); await fs.writeFile(cf, c.data); const cd = (await dur(cf)) || 4;
      const ab = await VideoBlob.findOne({ jobId: job._id, kind: 'audio', idx: c.idx }); let af = null, ad = 0;
      if (ab) { af = path.join(dir, `a${c.idx}.mp3`); await fs.writeFile(af, ab.data); ad = await dur(af); if (ad) voiced++; else af = null; }
      const D = Math.max(cd, ad + 0.25); const seg = path.join(dir, `s${c.idx}.mp4`);
      const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,tpad=stop_mode=clone:stop_duration=${Math.max(0, D - cd).toFixed(2)}`;
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', cf, ...(af ? ['-i', af] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']), '-vf', vf, '-af', 'aresample=44100,apad', '-t', D.toFixed(2), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', '-movflags', '+faststart', seg], { timeout: 120000 });
      segs.push(`file '${seg}'`);
    }
    await fs.writeFile(path.join(dir, 'l.txt'), segs.join('\n'));
    const out = path.join(dir, 'out.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'l.txt'), '-c', 'copy', '-movflags', '+faststart', out], { timeout: 120000 });
    const data = await fs.readFile(out);
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
async function step(job) {
  if (job.status === 'queued' || job.status === 'scripting') { job.status = 'scripting'; await job.save(); return script(job); }
  if (job.status === 'clips') {
    const i = job.scenes.findIndex(s => s.state !== 'ok'); if (i < 0) { job.status = 'stitching'; return job.save(); }
    try {
      let data;
      if (job.mode === 'ai' && Date.now() - gpuDownAt < 1800000 && fallbackMode() !== 'still') { job.mode = fallbackMode(); job.note = NOTE[job.mode]; await job.save(); }
      if (job.mode === 'ai' || !job.mode) {
        try {
          const url = await generateClip({ prompt: job.scenes[i].prompt, seconds: 4, width: W, height: H });
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
      if (job.mode === 'stock') { data = await stockClip(job, i); job.note = NOTE.stock; }
      if (job.mode === 'still') data = await stillClip(job.scenes[i].prompt, i);
      await VideoBlob.deleteMany({ jobId: job._id, kind: 'clip', idx: i }); await VideoBlob.create({ jobId: job._id, kind: 'clip', idx: i, data });
      job.scenes[i].state = 'ok'; await job.save();
      if (job.scenes[i].say) { try { const au = await generateSpeech({ text: job.scenes[i].say, hindi: /[\u0900-\u097F]/.test(job.scenes[i].say) }); const ar = await fetch(au, { signal: AbortSignal.timeout(30000) }); if (ar.ok) await VideoBlob.create({ jobId: job._id, kind: 'audio', idx: i, data: Buffer.from(await ar.arrayBuffer()) }); } catch (e) { console.error('voice', e.message.slice(0, 120)); } }
    } catch (e) {
      // keep the clips that worked: stitch what we have if at least 2, otherwise fail with the honest reason
      const have = job.scenes.filter(s => s.state === 'ok').length;
      if (have >= 2) { job.note = `Only ${have} of ${job.scenes.length} clips could be made (${String(e.message).slice(0, 80)})`; job.status = 'stitching'; return job.save(); }
      throw e;
    }
    return;
  }
  if (job.status === 'stitching') return stitch(job);
}
let busy = false;
async function tick() {
  if (busy || mongoose.connection.readyState !== 1) return; busy = true;
  try {
    const job = await VideoJob.findOneAndUpdate({ status: { $nin: ['done', 'failed'] }, $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }] }, { lockUntil: new Date(Date.now() + 10 * 60000) }, { new: true, sort: 'createdAt' });
    if (!job) return;
    try { await step(job); } catch (e) { console.error('video job', String(job._id), e.message); job.status = 'failed'; job.error = String(e.message).slice(0, 200); await job.save(); }
    await VideoJob.updateOne({ _id: job._id }, { lockUntil: null });
  } catch (e) { console.error('video tick', e.message); } finally { busy = false; }
}
export const startWorker = () => { setInterval(tick, 4000).unref?.(); };
export const publicJob = j => ({ id: String(j._id), topic: j.topic, title: j.title, status: j.status, scenes: (j.scenes || []).map(s => s.state), error: j.error || null, note: j.note || null, bytes: j.bytes, at: j.createdAt });
