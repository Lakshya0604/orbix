// Background "make a Short" jobs: topic -> LLM script -> one clip per scene -> ffmpeg stitch -> mp4 stored in Mongo.
import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { chatCompletion } from './llm.js';
import { generateClip, generateSpeech } from './media.js';
const { Schema, model } = mongoose; const run = promisify(execFile);

export const VideoJob = model('VideoJob', new Schema({
  userId: { type: Schema.Types.ObjectId, index: true }, topic: String, title: { type: String, default: '' },
  status: { type: String, default: 'queued', index: true }, // queued, scripting, clips, stitching, done, failed
  scenes: [{ prompt: String, say: { type: String, default: '' }, state: { type: String, default: 'wait' } }], error: String, note: String,
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
  const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: `You write ultra short vertical YouTube Shorts scripts with a voiceover. Reply with ONLY JSON: {"title":"...","scenes":[{"shot":"...","say":"..."}]}. Exactly ${SCENES} scenes that tell one story with a hook first and a punchy end. "shot" is ONE visual description in English, 20 to 40 words, concrete (subject, setting, light, camera move), no text overlays, no real people or brands. "say" is the narration for that shot: ONE sentence of 8 to 12 words, spoken in the same language as the user's topic (English if unsure; Hindi in Devanagari script if the topic is Hindi or Hinglish).` }, { role: 'user', content: `Topic: ${job.topic}` }] });
  const j = JSON.parse(String(m.content || '').match(/\{[\s\S]*\}/)?.[0] || '{}');
  const scenes = (Array.isArray(j.scenes) ? j.scenes : []).map(x => typeof x === 'string' ? { shot: x, say: '' } : { shot: String(x?.shot || ''), say: String(x?.say || '') }).filter(x => x.shot).slice(0, SCENES).map(x => ({ prompt: x.shot.slice(0, 400), say: x.say.slice(0, 200) }));
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
async function step(job) {
  if (job.status === 'queued' || job.status === 'scripting') { job.status = 'scripting'; await job.save(); return script(job); }
  if (job.status === 'clips') {
    const i = job.scenes.findIndex(s => s.state !== 'ok'); if (i < 0) { job.status = 'stitching'; return job.save(); }
    try {
      const url = await generateClip({ prompt: job.scenes[i].prompt, seconds: 4, width: W, height: H });
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Could not download the clip.');
      await VideoBlob.deleteMany({ jobId: job._id, kind: 'clip', idx: i }); await VideoBlob.create({ jobId: job._id, kind: 'clip', idx: i, data: Buffer.from(await r.arrayBuffer()) });
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
    const job = await VideoJob.findOneAndUpdate({ status: { $nin: ['done', 'failed'] }, $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }] }, { lockUntil: new Date(Date.now() + 5 * 60000) }, { new: true, sort: 'createdAt' });
    if (!job) return;
    try { await step(job); } catch (e) { console.error('video job', String(job._id), e.message); job.status = 'failed'; job.error = String(e.message).slice(0, 200); await job.save(); }
    await VideoJob.updateOne({ _id: job._id }, { lockUntil: null });
  } catch (e) { console.error('video tick', e.message); } finally { busy = false; }
}
export const startWorker = () => { setInterval(tick, 4000).unref?.(); };
export const publicJob = j => ({ id: String(j._id), topic: j.topic, title: j.title, status: j.status, scenes: (j.scenes || []).map(s => s.state), error: j.error || null, note: j.note || null, bytes: j.bytes, at: j.createdAt });
