// Background "make a Short" jobs: topic -> LLM script -> one clip per scene -> ffmpeg stitch -> mp4 stored in Mongo.
import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { chatCompletion } from './llm.js';
import { generateClip } from './media.js';
const { Schema, model } = mongoose; const run = promisify(execFile);

export const VideoJob = model('VideoJob', new Schema({
  userId: { type: Schema.Types.ObjectId, index: true }, topic: String, title: { type: String, default: '' },
  status: { type: String, default: 'queued', index: true }, // queued, scripting, clips, stitching, done, failed
  scenes: [{ prompt: String, state: { type: String, default: 'wait' } }], error: String, note: String,
  lockUntil: { type: Date, default: null }, bytes: { type: Number, default: 0 },
}, { timestamps: true }));
export const VideoBlob = model('VideoBlob', new Schema({ jobId: { type: Schema.Types.ObjectId, index: true }, kind: String, idx: Number, data: Buffer }, { timestamps: true }));

export const MAX_ACTIVE = 1, MAX_PER_DAY = 4, SCENES = 4;
export async function startJob(userId, topic) {
  const t = String(topic || '').trim().slice(0, 200);
  if (t.length < 3) throw Object.assign(new Error('Tell me what the video is about.'), { status: 400 });
  if (await VideoJob.countDocuments({ userId, status: { $nin: ['done', 'failed'] } }) >= MAX_ACTIVE) throw Object.assign(new Error('One video is already being made. Wait for it to finish.'), { status: 429 });
  if (await VideoJob.countDocuments({ userId, createdAt: { $gt: new Date(Date.now() - 86400000) } }) >= MAX_PER_DAY) throw Object.assign(new Error(`Free limit: ${MAX_PER_DAY} videos per day.`), { status: 429 });
  return VideoJob.create({ userId, topic: t });
}

async function script(job) {
  const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: `You write ultra short vertical video scripts. Reply with ONLY JSON: {"title":"...","scenes":["...","...","...","..."]}. Exactly ${SCENES} scenes. Each scene is ONE visual shot description in English, 20 to 40 words, concrete (subject, setting, light, camera move), no text overlays, no real people or brands.` }, { role: 'user', content: `Topic: ${job.topic}` }] });
  const j = JSON.parse(String(m.content || '').match(/\{[\s\S]*\}/)?.[0] || '{}');
  const scenes = (Array.isArray(j.scenes) ? j.scenes : []).map(s => String(s).slice(0, 400)).filter(Boolean).slice(0, SCENES);
  if (scenes.length < 2) throw new Error('The script came back empty. Try another topic.');
  job.title = String(j.title || job.topic).slice(0, 80); job.scenes = scenes.map(prompt => ({ prompt })); job.status = 'clips'; await job.save();
}
async function stitch(job) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-v-'));
  try {
    const clips = await VideoBlob.find({ jobId: job._id, kind: 'clip' }).sort('idx');
    if (!clips.length) throw new Error('No clips to stitch.');
    const list = [];
    for (const c of clips) { const f = path.join(dir, `c${c.idx}.mp4`); await fs.writeFile(f, c.data); list.push(`file '${f}'`); }
    await fs.writeFile(path.join(dir, 'l.txt'), list.join('\n'));
    const out = path.join(dir, 'out.mp4');
    // re-encode so clips with slightly different encodings always join cleanly; small and fast at this size
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'l.txt'), '-vf', 'scale=704:512:force_original_aspect_ratio=decrease,pad=704:512:(ow-iw)/2:(oh-ih)/2,fps=24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { timeout: 120000 });
    const data = await fs.readFile(out);
    await VideoBlob.deleteMany({ jobId: job._id, kind: 'final' }); await VideoBlob.create({ jobId: job._id, kind: 'final', idx: 0, data });
    job.bytes = data.length; job.status = 'done'; job.note = `${clips.length} clips stitched`; await job.save();
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function step(job) {
  if (job.status === 'queued' || job.status === 'scripting') { job.status = 'scripting'; await job.save(); return script(job); }
  if (job.status === 'clips') {
    const i = job.scenes.findIndex(s => s.state !== 'ok'); if (i < 0) { job.status = 'stitching'; return job.save(); }
    try {
      const url = await generateClip({ prompt: job.scenes[i].prompt, seconds: 3 });
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Could not download the clip.');
      await VideoBlob.deleteMany({ jobId: job._id, kind: 'clip', idx: i }); await VideoBlob.create({ jobId: job._id, kind: 'clip', idx: i, data: Buffer.from(await r.arrayBuffer()) });
      job.scenes[i].state = 'ok'; await job.save();
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
