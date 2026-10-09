// Background "make a Short" jobs: topic -> LLM script -> one clip per scene -> ffmpeg stitch -> mp4 stored in Mongo.
import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { chatCompletion } from './llm.js';
import { generateClip, generateSpeech, generateAgnesClip, generateImage, generateWithReference, transcribeSong } from './media.js';
const { Schema, model } = mongoose; const run = promisify(execFile);

export const VideoJob = model('VideoJob', new Schema({
  userId: { type: Schema.Types.ObjectId, index: true }, topic: String, title: { type: String, default: '' },
  status: { type: String, default: 'queued', index: true }, // queued, scripting, clips, stitching, done, failed
  scenes: [{ act: { type: String, default: '' }, prompt: String, kw: { type: String, default: '' }, say: { type: String, default: '' }, state: { type: String, default: 'wait' }, tries: { type: Number, default: 0 }, t0: { type: Number, default: 0 }, t1: { type: Number, default: 0 } }], error: String, note: String, mode: { type: String, default: 'ai' }, long: { type: Boolean, default: false }, char: { type: Boolean, default: false }, subject: { type: String, default: '' }, lyric: { type: Boolean, default: false }, songDur: { type: Number, default: 0 }, charDesc: { type: String, default: '' }, stage: { type: String, default: '' }, startedAt: Date,
  lockUntil: { type: Date, default: null }, bytes: { type: Number, default: 0 },
}, { timestamps: true }));
export const VideoBlob = model('VideoBlob', new Schema({ jobId: { type: Schema.Types.ObjectId, index: true }, kind: String, idx: Number, data: Buffer }, { timestamps: true }));

export const MAX_ACTIVE = 1, MAX_PER_DAY = 4, SCENES = 4, LONG_SCENES = 14;
export async function startJob(userId, topic, long = false, char = false) {
  const t = String(topic || '').trim().slice(0, 200);
  if (t.length < 3) throw Object.assign(new Error('Tell me what the video is about.'), { status: 400 });
  await VideoJob.updateMany({ userId, status: { $nin: ['done', 'failed'] }, updatedAt: { $lt: new Date(Date.now() - 20 * 60000) } }, { status: 'failed', error: 'This one got stuck (the server restarted). Please start it again.' });
  if (await VideoJob.countDocuments({ userId, status: { $nin: ['done', 'failed'] } }) >= MAX_ACTIVE) throw Object.assign(new Error('One video is already being made. Wait for it to finish.'), { status: 429 });
  if (await VideoJob.countDocuments({ userId, createdAt: { $gt: new Date(Date.now() - 86400000) } }) >= MAX_PER_DAY) throw Object.assign(new Error(`Free limit: ${MAX_PER_DAY} videos per day.`), { status: 429 });
  return VideoJob.create({ userId, topic: t, long: !!long, char: !!char, startedAt: new Date() });
}

export async function startLyricJob(userId, title, buf) {
  if (!buf?.length || buf.length < 20000) throw Object.assign(new Error('Send a song file (mp3, m4a or wav).'), { status: 400 });
  if (buf.length > 14e6) throw Object.assign(new Error('Song file is too big. Use one under 14 MB.'), { status: 413 });
  const job = await startJob(userId, String(title || 'Lyric video').slice(0, 120) || 'Lyric video', false);
  job.lyric = true; await job.save(); await VideoBlob.create({ jobId: job._id, kind: 'song', idx: 0, data: buf }); return job;
}
export async function startLyricSelftest(userId) {
  const r = await fetch('https://archive.org/download/HighlandBaptistChurchChoirAmazingGrace/Amazing_Grace_Acapella_vbr.mp3', { redirect: 'follow', signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Test song not reachable.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-t-')); try { const a = path.join(dir, 'a.mp3'), b = path.join(dir, 'b.mp3'); await fs.writeFile(a, Buffer.from(await r.arrayBuffer())); await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', a, '-t', '36', '-b:a', '96k', b], { timeout: 60000 }); return await startLyricJob(userId, 'Amazing Grace (Highland Baptist Church Choir, CC BY 2.5)', await fs.readFile(b)); } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const FONTS = { dev: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf', lat: 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf' };
async function fontsDir() {
  const d = path.join(os.tmpdir(), 'orbix-fonts'); await fs.mkdir(d, { recursive: true });
  for (const [k, u] of Object.entries(FONTS)) { const f = path.join(d, `${k}.ttf`); if (await fs.stat(f).then(x => x.size > 50000, () => false)) continue; const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Could not load the caption font.'); await fs.writeFile(f, Buffer.from(await r.arrayBuffer())); }
  return d;
}
const assTime = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = (t % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${sec}`; };
function assFile(text, a, b) {
  const dev = /[\u0900-\u097F]/.test(text); const clean = String(text).replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,${dev ? 'Noto Sans Devanagari' : 'Noto Sans'},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,24,24,110,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,${assTime(a)},${assTime(b)},Default,,0,0,0,,${clean}\n`;
}
async function lyricScript(job) {
  let song = null; for (let k = 0; k < 8 && !song; k++) { song = await VideoBlob.findOne({ jobId: job._id, kind: 'song' }); if (!song) await new Promise(r => setTimeout(r, 2500)); } if (!song) throw new Error('The song file is missing.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-l-'));
  try {
    job.stage = 'Listening to the song'; await job.save();
    const src = path.join(dir, 'song.bin'), small = path.join(dir, 'small.mp3'); await fs.writeFile(src, song.data);
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', src, '-t', '180', '-ac', '1', '-ar', '16000', '-b:a', '48k', small], { timeout: 90000 });
    job.songDur = Math.min(180, await dur(small)); const { segments, language } = await transcribeSong(await fs.readFile(small));
    if (!segments.length) throw new Error('I could not hear any lyrics in this song.');
    const lines = []; for (const g of segments) { const last = lines[lines.length - 1]; if (last && (last.t1 - last.t0 < 3 || g.t1 - g.t0 < 1.5) && g.t0 - last.t1 < 1.5) { last.t1 = g.t1; last.text += ' ' + g.text; } else lines.push({ ...g }); }
    const split = []; for (const l of lines) { const d = l.t1 - l.t0; if (d <= 8) { split.push(l); continue; } const w = l.text.split(/\s+/), n = Math.ceil(d / 6); for (let k = 0; k < n; k++) { const a = Math.round(w.length * k / n), b = Math.round(w.length * (k + 1) / n); if (b > a) split.push({ t0: l.t0 + d * k / n, t1: l.t0 + d * (k + 1) / n, text: w.slice(a, b).join(' ') }); } }
    const L = split.slice(0, 30); job.stage = 'Planning the visuals'; await job.save();
    let vis = [];
    for (let i = 0; i < L.length; i += 10) {
      const part = L.slice(i, i + 10); let got = null;
      for (let t = 0; t < 3 && !got; t++) {
        try { const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: `You are a music video director. For each lyric line (given as a numbered list) choose what the viewer should SEE. Reply with ONLY valid JSON: {"scenes":[{"kw":"phrase one|phrase two","shot":"..."}]} with exactly ${part.length} entries in the same order. "kw" is TWO stock-footage search phrases separated by a pipe, each 2 or 3 plain English words naming a visible real-world subject (never abstract words, never names), always English even if the lyrics are not. "shot" is one English sentence describing the visual. Keep one consistent mood across the whole song. No double quote characters inside values.` }, { role: 'user', content: `Song title: ${job.topic}\n${part.map((l, k) => `${k + 1}. ${l.text}`).join('\n')}` }] }); const x = jsonOf(m.content); if (x && Array.isArray(x.scenes) && x.scenes.length >= part.length) got = x.scenes.slice(0, part.length); } catch { await new Promise(r => setTimeout(r, 5000)); }
      }
      vis.push(...(got || part.map(() => ({ kw: `${job.topic.split(/\s+/).slice(0, 2).join(' ')}|nature sky`, shot: job.topic }))));
    }
    job.scenes = L.map((l, i) => ({ act: '', prompt: String(vis[i]?.shot || job.topic).slice(0, 300), kw: String(vis[i]?.kw || 'nature sky').replace(/[^\w |]/g, ' ').slice(0, 110).trim(), say: l.text.slice(0, 200), state: 'wait', tries: 0, t0: l.t0, t1: l.t1 }));
    job.title = job.topic; job.status = 'clips'; job.stage = `Lyrics ready: ${L.length} lines (${language || 'language auto'})`; await job.save();
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const ARC = 'The scenes must be ONE connected story with a clear arc: a hook/intro that sets the character and place, a buildup that raises the stakes, a turn or twist, a climax, and a closing ending that pays off the start. Each scene continues directly from the previous one (same characters, same place, cause and effect), never a list of unrelated facts.';
const jsonOf = t => { const m = String(t || '').match(/\{[\s\S]*\}/)?.[0] || ''; for (const v of [m, m.replace(/,\s*([}\]])/g, '$1'), m.replace(/[\u201c\u201d]/g, "'").replace(/,\s*([}\]])/g, '$1')]) { try { return JSON.parse(v); } catch {} } return null; };
async function script(job) {
  const N = job.long ? LONG_SCENES : SCENES; let outline = '';
  if (job.char && !job.charDesc) { try { const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: 'Describe the MAIN character of this story in ONE English sentence of 25 to 35 words for an illustrator: age, build, face, hair, clothes with colors, any signature prop. Reply with only that sentence.' }, { role: 'user', content: `Topic: ${job.topic}` }] }); job.charDesc = String(m.content || '').replace(/\s+/g, ' ').slice(0, 400); } catch { job.charDesc = ''; } }
  if (job.long) {
    let o = null;
    for (let k = 0; k < 3 && !o; k++) { const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: `You plan a short story for a narrated video. Reply with ONLY valid JSON (no double quote characters inside text): {"title":"...","acts":[{"act":"intro","beat":"..."},{"act":"buildup","beat":"..."},{"act":"twist","beat":"..."},{"act":"climax","beat":"..."},{"act":"ending","beat":"..."}]}. Each beat is 1 or 2 sentences. The title is in the same language as the narration. Same language as the user's topic (Hindi in Devanagari if the topic is Hindi or Hinglish). One coherent story with named or clearly described characters.` }, { role: 'user', content: `Topic: ${job.topic}` }] }); const j = jsonOf(m.content); if (j && Array.isArray(j.acts) && j.acts.length >= 4) o = j; }
    if (!o) throw new Error('Could not plan the story. Try again.');
    outline = `Story title: ${o.title}\n` + o.acts.map((x, i) => `${i + 1}. ${x.act}: ${x.beat}`).join('\n'); job.title = String(o.title || job.topic).slice(0, 80);
  }
  let j = null;
  const sysFor = (n, extra) => `You write vertical YouTube Shorts style narrated stories. Reply with ONLY valid JSON (never use double quote characters inside the text values): {"title":"...","subject":"...","scenes":[{"act":"intro","shot":"...","kw":"...","say":"..."}]}. Exactly ${n} scenes. ${ARC} "act" is one of intro, buildup, twist, climax, ending. "shot" is ONE visual description in English, 20 to 40 words, concrete (subject, setting, light, camera move), no text overlays, no real people or brands. "kw" is TWO stock-footage search phrases separated by a pipe: the first for what the FIRST half of the narration says, the second for the SECOND half, each 2 or 3 plain English words naming a visible, moving real-world subject that a stock site would have (for example "storm waves crash|old wooden door"). Never abstract words, never names of people, never flags, countries, wars, weapons, religion or politics, always English even when the narration is Hindi. EVERY phrase must contain the concrete main subject of the story (the same noun each time, e.g. astronaut, moon, lighthouse, forest) plus one visible detail, e.g. "astronaut moon surface|earth from space". "subject" is the story's main visible subject in 2 or 3 plain English words (e.g. "astronaut moon"). "say" is the narration for that shot, spoken in the same language as the user's topic (English if unsure; Hindi in Devanagari script if the topic is Hindi or Hinglish): ${job.long ? '1 or 2 sentences of 12 to 22 words' : 'ONE sentence of 8 to 12 words'}.${extra || ''}`;
  if (job.long) {
    const plan = [['intro', 3], ['buildup', 3], ['twist', 2], ['climax', 3], ['ending', 3]]; const acc = [];
    for (const [act, n] of plan) {
      let got = null, why = '';
      for (let t = 0; t < 8 && !got; t++) {
        job.stage = `Writing the story: ${act}`; await job.save().catch(() => {});
        let m; try { m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: sysFor(n, `\nStory plan:\n${outline}\nWrite ONLY the "${act}" part now: exactly ${n} scenes, all with act "${act}".${acc.length ? `\nNarration so far (continue straight from it):\n${acc.map(x => x.say).join(' ')}` : ''}`) }, { role: 'user', content: `Topic: ${job.topic}` }] }); } catch (e) { why = 'llm: ' + String(e.message).slice(0, 120); await new Promise(r => setTimeout(r, 10000 * (t + 1))); continue; }
        const x = jsonOf(m.content); if (x && Array.isArray(x.scenes) && x.scenes.length >= 1) got = x.scenes.slice(0, n); else why = 'parse: ' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 160) + ' ...' + String(m.content || '').replace(/\s+/g, ' ').slice(-60);
      }
      if (!got) throw new Error('The script came back broken. Try again. [' + why + ']');
      got.forEach(x => { if (x && typeof x === 'object') x.act = act; }); acc.push(...got);
    }
    j = { title: job.title, scenes: acc };
  } else { let why = ''; for (let tryN = 0; tryN < 6 && !j; tryN++) {
    let m; try { m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: sysFor(N, ` The scenes follow that order.`) }, { role: 'user', content: `Topic: ${job.topic}` }] }); } catch (e) { why = 'llm: ' + String(e.message).slice(0, 100); await new Promise(r => setTimeout(r, 8000 * (tryN + 1))); continue; }
    const x = jsonOf(m.content); if (x && Array.isArray(x.scenes) && x.scenes.length >= Math.min(N, 4)) j = x; else why = 'parse: ' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 140) + ' ...' + String(m.content || '').replace(/\s+/g, ' ').slice(-50);
  }
  if (!j) throw new Error('The script came back broken. Try again. [' + why + ']'); }
  if (!j) throw new Error('The script came back broken. Try again.');
  job.subject = String(j.subject || '').replace(/[^\w ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  const scenes = j.scenes.map(x => typeof x === 'string' ? { act: '', shot: x, kw: '', say: '' } : { act: String(x?.act || ''), shot: String(x?.shot || ''), kw: String(x?.kw || ''), say: String(x?.say || '') }).filter(x => x.shot).slice(0, N).map(x => ({ act: x.act.slice(0, 12), prompt: x.shot.slice(0, 400), kw: x.kw.replace(/[^\w |]/g, ' ').slice(0, 110).trim(), say: x.say.slice(0, 320) }));
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
      if (ab) { const raw = path.join(dir, `a${c.idx}.mp3`); await fs.writeFile(raw, ab.data); af = path.join(dir, `t${c.idx}.mp3`); try { await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse', af]); } catch { af = raw; } ad = await dur(af); if (!ad && af !== raw) { af = raw; ad = await dur(af); } if (ad) voiced++; else af = null; }
      const D = af ? Math.max(1.5, ad + 0.12) : cd; const seg = path.join(dir, `s${c.idx}.mp4`);
      const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24`;
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-stream_loop', '-1', '-i', cf, ...(af ? ['-i', af] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']), '-vf', vf, '-af', 'aresample=44100,apad', '-t', D.toFixed(2), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', job.long ? '30' : '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', '-movflags', '+faststart', seg], { timeout: 120000 });
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
async function stitchLyric(job) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-v-'));
  try {
    const fd = await fontsDir(); const song = await VideoBlob.findOne({ jobId: job._id, kind: 'song' }); const sf = path.join(dir, 'song.bin'); await fs.writeFile(sf, song.data);
    const clips = await VideoBlob.find({ jobId: job._id, kind: 'clip' }).sort('idx'); if (!clips.length) throw new Error('No clips to stitch.');
    const total = job.songDur || (job.scenes[job.scenes.length - 1].t1 + 1); const segs = [];
    for (let n = 0; n < clips.length; n++) {
      const c = clips[n]; const sc = job.scenes[c.idx]; const nxt = clips[n + 1] ? job.scenes[clips[n + 1].idx].t0 : total; const start = n === 0 ? 0 : sc.t0; const D = Math.max(1.2, nxt - start);
      job.stage = `Joining clip ${n + 1} of ${clips.length}`; await job.save().catch(() => {});
      const cf = path.join(dir, `c${c.idx}.mp4`); await fs.writeFile(cf, c.data); const seg = path.join(dir, `s${c.idx}.mp4`); const ass = path.join(dir, `a${c.idx}.ass`);
      await fs.writeFile(ass, assFile(sc.say, Math.max(0, sc.t0 - start), Math.min(D, sc.t1 - start + 0.25)));
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-stream_loop', '-1', '-i', cf, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,subtitles=a${c.idx}.ass:fontsdir=${fd}`, '-an', '-t', D.toFixed(2), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', seg], { cwd: dir, timeout: 120000 });
      segs.push(`file '${seg}'`);
    }
    await fs.writeFile(path.join(dir, 'l.txt'), segs.join('\n')); const vid = path.join(dir, 'v.mp4'), out = path.join(dir, 'out.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'l.txt'), '-c', 'copy', vid], { timeout: 120000 });
    job.stage = 'Adding the song'; await job.save().catch(() => {});
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', vid, '-i', sf, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-t', String(total.toFixed(2)), '-movflags', '+faststart', out], { timeout: 120000 });
    const data = await fs.readFile(out); if (data.length > 15.5e6) throw new Error('This video is too long to save on the free plan yet. Try a shorter song.');
    await VideoBlob.deleteMany({ jobId: job._id, kind: 'final' }); await VideoBlob.create({ jobId: job._id, kind: 'final', idx: 0, data });
    job.bytes = data.length; job.status = 'done'; job.note = `Lyric video: ${clips.length} lyric lines, original song audio, burned-in captions, vertical 9:16${job.note ? ' · ' + job.note : ''}`; await job.save();
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function stillClip(prompt, i, given) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-k-'));
  try {
    const q = encodeURIComponent(`${String(prompt).slice(0, 350)}, vertical cinematic photo, vivid light`);
    let buf = given || null, err = '';
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
const BANNED = /\b(flags?|banner|war|wars|army|armies|soldiers?|military|weapons?|guns?|rifles?|bombs?|missiles?|tanks?|terror\w*|nazi\w*|isis|religio\w*|church|temple|mosque|cross|crescent|islam\w*|hindu\w*|christian\w*|jewish|jew|judaism|swastika|politic\w*|election|president|protest|nationa\w*|country|countries|israel\w*|palestin\w*|ukrain\w*|russia\w*|america\w*|usa|india\w*|china|chinese|pakistan\w*|trump|modi|biden|putin|blood|corpse|kill\w*|flagpole|patriot\w*|anthem|emblem|star of david)\b/i;
const ANIM = /animat|cartoon|anime|एनिमेट|कार्टून/i;
const staticClip = async f => { try { const { stderr } = await run(ffmpegPath, ['-i', f, '-vf', 'scale=96:-2,freezedetect=n=0.004:d=1.5', '-an', '-f', 'null', '-'], { timeout: 30000 }); return /freeze_start/.test(String(stderr || '')); } catch { return false; } };
async function stockClip(job, i) {
  const key = process.env.PIXABAY_KEY; if (!key) throw new Error('No stock key set.');
  const sc = job.scenes[i]; const mark = async t => { job.note = `stock ${i}: ${t}`; await job.save().catch(() => {}); };
  const subj = String(job.subject || '').split(/\s+/).filter(w => w && !BANNED.test(w)).slice(0, 3).join(' ');
  const parts = String(sc.kw || sc.prompt).split('|').map(x => x.split(/\s+/).filter(w => w && !BANNED.test(w)).join(' ').trim()).filter(Boolean).map(x => subj && !x.toLowerCase().includes(subj.toLowerCase().split(' ')[0]) ? `${subj.split(' ')[0]} ${x}` : x);
  const K = job.lyric ? Math.min(2, Math.max(1, Math.ceil(((sc.t1 || 0) - (sc.t0 || 0) + 0.5) / 4.5))) : job.long ? 2 : 1; const queries = []; for (let k = 0; k < K; k++) queries.push(parts[k] || parts[0] || String(sc.prompt));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-s-')); const used = new Set(); const files = [];
  const search = async q => { const r = await fetch(`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true${ANIM.test(job.topic) ? '&video_type=animation' : ''}`, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`Stock service said HTTP ${r.status}.`); return ((await r.json()).hits || []).filter(h => (h.duration || 0) >= 4 && h.videos?.medium?.url); };
  const encode = async (src, out, flip) => run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', src, '-t', '4.5', '-an', '-threads', '1', '-vf', `${flip ? 'hflip,scale=' + Math.round(W * 1.3) + ':' + Math.round(H * 1.3) + ',crop=' + W + ':' + H + ',' : ''}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24,format=yuv420p`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-movflags', '+faststart', out], { timeout: 90000 });
  try {
    for (let k = 0; k < K; k++) {
      const words = queries[k].split(/\s+/).filter(Boolean); const tries = [queries[k], words.slice(0, 2).join(' '), subj || words[0] || 'nature', 'nature'].filter((q, n, a) => q && a.indexOf(q) === n);
      let ok = false, lastSrc = null, weak = null;
      for (const q of tries) {
        if (ok) break; await mark(`search ${k + 1}/${K}`);
        const hits = (await search(q)).filter(h => !used.has(h.id) && !BANNED.test(String(h.tags || ''))).slice(0, 10); const start = (i * 3 + k) % Math.max(1, Math.min(hits.length, 6));
        for (let t = 0; t < Math.min(hits.length, 3) && !ok; t++) {
          const hit = hits[(start + t) % hits.length]; used.add(hit.id);
          const r = await fetch(hit.videos.small?.url || hit.videos.medium.url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) continue;
          const src = path.join(dir, `s${k}_${t}.mp4`), out = path.join(dir, `o${k}_${t}.mp4`); await fs.writeFile(src, Buffer.from(await r.arrayBuffer())); lastSrc = src; await mark(`encode ${k + 1}/${K}`);
          await encode(src, out, false); if (await staticClip(out)) { weak = weak || out; continue; } files.push(out); ok = true;
        }
      }
      if (!ok && weak) { files.push(weak); ok = true; }
      if (!ok && !files.length) throw new Error('No stock footage found for this topic.');
      if (!ok) { const out = path.join(dir, `v${k}.mp4`); await encode(files[0].replace(/o(\d+_\d+)\.mp4$/, (m, g) => `s${g}.mp4`), out, true); files.push(out); }
    }
    if (files.length === 1) return await fs.readFile(files[0]);
    const list = path.join(dir, 'l.txt'); await fs.writeFile(list, files.map(f => `file '${f}'`).join('\n')); const outF = path.join(dir, 'final.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outF], { timeout: 60000 });
    return await fs.readFile(outF);
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function charClip(job, i) {
  let ref = await VideoBlob.findOne({ jobId: job._id, kind: 'charref' });
  const get = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('Could not download the character picture.'); return Buffer.from(await r.arrayBuffer()); };
  if (!ref) {
    await stage(job, 'Drawing the main character');
    const url = await generateImage({ prompt: `${job.charDesc || job.topic}, full body, standing, plain simple background, 2D cel-shaded animation style, flat colors, clean outlines`, width: 768, height: 1024 });
    ref = await VideoBlob.create({ jobId: job._id, kind: 'charref', idx: 0, data: await get(url) });
  }
  await stage(job, `Clip ${i + 1} of ${job.scenes.length}: drawing scene`);
  const url = await generateWithReference({ image: ref.data, prompt: `The same character with the same face, hair and clothes. ${String(job.scenes[i].prompt).slice(0, 380)}. 2D cel-shaded animated illustration, dark moody lighting, vertical frame.` });
  return stillClip(job.scenes[i].prompt, i, await get(url));
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
  const useChar = !!job.char; if (useChar) { data = await charClip(job, i); job.note = 'AI pictures with one fixed character (FLUX Kontext), slow pan and zoom'; }
  if (!useChar && job.mode === 'ai' && Date.now() - gpuDownAt < 1800000 && fallbackMode() !== 'still') { job.mode = fallbackMode(); job.note = NOTE[job.mode]; await job.save(); }
  if (!useChar && (job.mode === 'ai' || !job.mode)) {
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
  if (!useChar && job.mode === 'agnes') {
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
  if (!useChar && job.mode === 'stock') { await stage(job, `${tag}: finding footage`); data = await stockClip(job, i); job.note = NOTE.stock; }
  if (!useChar && job.mode === 'still') data = await stillClip(job.scenes[i].prompt, i);
  await VideoBlob.deleteMany({ jobId: job._id, kind: 'clip', idx: i }); await VideoBlob.create({ jobId: job._id, kind: 'clip', idx: i, data });
  if (job.scenes[i].say && !job.lyric) {
    await stage(job, `${tag}: voiceover`);
    try { const au = await generateSpeech({ text: job.scenes[i].say, hindi: /[\u0900-\u097F]/.test(job.scenes[i].say) }); const ar = await fetch(au, { signal: AbortSignal.timeout(30000) }); if (ar.ok) { await VideoBlob.deleteMany({ jobId: job._id, kind: 'audio', idx: i }); await VideoBlob.create({ jobId: job._id, kind: 'audio', idx: i, data: Buffer.from(await ar.arrayBuffer()) }); } } catch (e) { console.error('voice', e.message.slice(0, 120)); }
  }
  job.scenes[i].state = 'ok'; await job.save();
}
async function step(job) {
  if (job.lyric && (job.status === 'queued' || job.status === 'scripting')) { job.status = 'scripting'; await job.save(); return lyricScript(job); }
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
  if (job.status === 'stitching') return job.lyric ? stitchLyric(job) : stitch(job);
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
