// Free generation through Hugging Face Spaces (ZeroGPU). Tries the owner's token first, then anonymous (per-IP free quota) if that fails.
const reason = body => { const m = body.match(/event: error\s+data: (.*)/); const t = (m?.[1] || body).replace(/\s+/g, ' ').slice(0, 160); return /quota|exceeded|GPU|too many|rate/i.test(body) ? `free GPU quota used up (${t})` : t || 'no details'; };
export async function callSpace(space, endpoint, data, { startMs = 20000, waitMs = 90000 } = {}) {
  const attempts = [process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : null, {}].filter(Boolean); const errs = [];
  for (const [n, auth] of attempts.entries()) {
    const who = n === 0 && process.env.HF_TOKEN ? 'token' : 'anon';
    try {
      const start = await fetch(`${space}/gradio_api/call/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(startMs) });
      if (!start.ok) { errs.push(`${who}: HTTP ${start.status} ${(await start.text()).replace(/\s+/g, ' ').slice(0, 120)}`); continue; }
      const { event_id } = await start.json(); if (!event_id) { errs.push(`${who}: no job id`); continue; }
      const res = await fetch(`${space}/gradio_api/call/${endpoint}/${event_id}`, { headers: auth, signal: AbortSignal.timeout(waitMs) });
      const body = await res.text(); const m = body.match(/event: complete\s+data: (.+)/);
      if (m) return JSON.parse(m[1]);
      errs.push(`${who}: ${reason(body)}`);
    } catch (e) { errs.push(`${who}: ${String(e.message).slice(0, 100)}`); }
  }
  console.error('space call failed', endpoint, errs.join(' | '));
  throw new Error(`The free GPU for AI video and pictures is used up for today (Hugging Face gives free accounts about 5 minutes of GPU a day, shared by every video and picture). It refills about 24 hours after the first use. Details: ${errs.join(' | ')}`);
}
const SPACE = 'https://black-forest-labs-flux-1-schnell.hf.space';
const snap = (n, d) => Math.min(1344, Math.max(256, Math.round((Number(n) || d) / 64) * 64));
export const imageEnabled = () => true;
export async function generateImage({ prompt, width, height }) {
  const text = String(prompt || '').trim().slice(0, 600);
  if (!text) throw new Error('No prompt given.');
  const out = await callSpace(SPACE, 'infer', [text, 0, true, snap(width, 1024), snap(height, 1024), 4]);
  const url = out?.[0]?.url;
  if (!/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) throw new Error('The image service returned no picture.');
  return url;
}

// Short text-to-video clips through the LTX-Video distilled Space (free ZeroGPU quota of the owner's HF account).
const VSPACE = 'https://lightricks-ltx-video-distilled.hf.space';
export async function generateClip({ prompt, seconds = 2, width = 704, height = 512, waitMs = 240000 }) {
  const text = String(prompt || '').trim().slice(0, 500);
  if (!text) throw new Error('No prompt given.');
  const dur = Math.min(4, Math.max(1, Number(seconds) || 2));
  const data = [text, 'worst quality, inconsistent motion, blurry, jittery, distorted', null, null, height, width, 'text-to-video', dur, 9, 42, true, 1, true];
  const out = await callSpace(VSPACE, 'text_to_video', data, { waitMs });
  const url = out?.[0]?.video?.url || out?.[0]?.url;
  if (!/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) throw new Error('The video service returned no clip.');
  return url;
}

// Cloudflare Workers AI: free FLUX.1 [schnell] (~10k neurons/day free tier, ~150+ images/day). Fast (~2-5s), no watermark. 1024x1024 output.
export async function generateImageCF({ prompt }) {
  const tok = process.env.CF_TOKEN, acc = process.env.CF_ACCOUNT_ID;
  if (!tok || !acc) throw new Error('No Cloudflare credentials set.');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/black-forest-labs/flux-1-schnell`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: String(prompt || '').trim().slice(0, 600), steps: 4 }), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`Cloudflare AI HTTP ${r.status}: ${JSON.stringify(j.errors || j).slice(0, 120)}`);
  const b = Buffer.from(j.result.image, 'base64'); if (b.length < 5000) throw new Error('Cloudflare AI returned an empty image.');
  return b;
}

// Voiceover with a free fallback chain, so a busy service never blocks a video:
//   1) Edge neural voices (hi-IN Swara / en-US Andrew) through the public HF Space - best quality, needs no key.
//   2) Google Translate voice (keyless, no quota) - robotic but always on. Returns { data: Buffer, via }.
const TSPACE = 'https://innoai-edge-tts-text-to-speech.hf.space';
export async function generateSpeech({ text, hindi = false }) {
  const t = String(text || '').trim().slice(0, 400); if (!t) throw new Error('No narration text.');
  const voice = hindi ? (process.env.TTS_VOICE_HI || 'hi-IN-MadhurNeural - hi-IN (Male)') : (process.env.TTS_VOICE_EN || 'en-US-AndrewNeural - en-US (Male)');
  const rate = Number(process.env.TTS_RATE ?? -10), pitch = Number(process.env.TTS_PITCH ?? -5);
  try {
    const out = await callSpace(TSPACE, 'tts_interface', [t, voice, rate, pitch], { waitMs: 45000 });
    const url = out?.[0]?.url;
    if (/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) { const data = Buffer.from(await r.arrayBuffer()); if (data.length > 200) return { data, via: 'edge-neural' }; }
    }
    throw new Error('The neural voice service returned no audio.');
  } catch (e) { console.error('voice neural:', String(e.message).slice(0, 100)); }
  // Keyless fallback: Google Translate voice. ~180 chars per request, split on sentence ends; mp3 parts concatenate.
  const lang = hindi ? 'hi' : 'en'; const parts = []; let cur = '';
  for (const piece of t.split(/(?<=[.!?\u0964\u0965])\s+|(?<=,\s)/)) {
    if (cur && (cur + ' ' + piece).length > 170) { parts.push(cur); cur = piece; } else cur = cur ? cur + ' ' + piece : piece;
  }
  if (cur) parts.push(cur);
  const bufs = [];
  for (const p of parts) for (let k = 0; k < p.length; k += 170) {
    const u = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(p.slice(k, k + 170))}`;
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`The fallback voice service said HTTP ${r.status}.`);
    const b = Buffer.from(await r.arrayBuffer()); if (b.length < 200) throw new Error('The fallback voice service returned no audio.');
    bufs.push(b);
  }
  return { data: Buffer.concat(bufs), via: 'google-voice' };
}

// Agnes AI video API (free "$0 / second" tier, 1 request per minute for free keys). Async: create a task, poll until completed.
export async function generateAgnesClip({ prompt, frames = 97, fps = 24, width = 576, height = 1024 }) {
  const key = process.env.AGNES_API_KEY; if (!key) throw new Error('No Agnes key set.');
  const H = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const r = await fetch('https://apihub.agnes-ai.com/v1/videos', { method: 'POST', headers: H, body: JSON.stringify({ model: 'agnes-video-v2.0', prompt: String(prompt).slice(0, 500), width, height, num_frames: frames, frame_rate: fps }), signal: AbortSignal.timeout(30000) });
  const t = await r.text(); if (!r.ok) throw new Error(`Agnes HTTP ${r.status} ${t.replace(/\s+/g, ' ').slice(0, 120)}`);
  const j = JSON.parse(t); const id = j.video_id || j.task_id || j.id; if (!id) throw new Error('Agnes returned no task id.');
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    await new Promise(x => setTimeout(x, 6000));
    const g = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(id)}`, { headers: H, signal: AbortSignal.timeout(20000) }); const gj = await g.json().catch(() => ({}));
    if (gj.status === 'completed' && gj.metadata?.url) return { url: gj.metadata.url, seconds: gj.seconds, size: gj.size };
    if (['failed', 'error', 'cancelled'].includes(gj.status)) throw new Error(`Agnes task ${gj.status}: ${JSON.stringify(gj.error || '').slice(0, 100)}`);
  }
  throw new Error('Agnes took too long.');
}

// Anime in-betweening: ToonCrafter generates the motion BETWEEN two keyframes of the same character (free ZeroGPU Space, shares the daily quota).
// This Space runs the root-path queue API (no /gradio_api prefix): /upload, /queue/join, /queue/data.
const CSPACE = 'https://doubiiu-tooncrafter.hf.space';
async function callQueue(space, fnIndex, data, { waitMs = 300000 } = {}) {
  const auths = [process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}, {}]; const errs = [];
  for (const auth of auths) {
    try {
      const session = Math.random().toString(36).slice(2);
      const j = await fetch(`${space}/queue/join`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ data, event_data: null, fn_index: fnIndex, trigger_id: 13, session_hash: session }), signal: AbortSignal.timeout(30000) });
      if (!j.ok) { errs.push(`join HTTP ${j.status} ${(await j.text()).replace(/\s+/g, ' ').slice(0, 100)}`); continue; }
      const res = await fetch(`${space}/queue/data?session_hash=${session}`, { headers: auth, signal: AbortSignal.timeout(waitMs) });
      const body = await res.text(); let done = null, err = '';
      for (const line of body.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if ((ev.msg === 'process_completed' || ev.msg === 'process_generating') && ev.output?.data) done = ev.output.data;
        if (ev.msg === 'process_error' || ev.msg === 'unexpected_error') err = JSON.stringify(ev).replace(/\s+/g, ' ').slice(0, 150);
      }
      if (done) return done;
      errs.push(err || body.replace(/\s+/g, ' ').slice(0, 150) || 'no result');
    } catch (e) { errs.push(String(e.message).slice(0, 100)); }
  }
  console.error('queue call failed', fnIndex, errs.join(' | '));
  throw new Error(`free GPU quota used up (${errs.join(' | ')})`);
}
export async function generateInbetweens({ imageA, imageB, prompt }) {
  const text = String(prompt || '').trim().slice(0, 300) || 'the scene continues, natural motion';
  if (!imageA || !imageB) throw new Error('Two keyframes needed.');
  const up = async (buf, name) => {
    const auths = [process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}, {}];
    for (const auth of auths) { try { const fd = new FormData(); fd.append('files', new Blob([buf], { type: 'image/jpeg' }), name); const u = await fetch(`${CSPACE}/upload`, { method: 'POST', body: fd, headers: auth, signal: AbortSignal.timeout(30000) }); if (u.ok) { const p = (await u.json())?.[0]; if (p) return p; } } catch { /* try next */ } }
    throw new Error('Could not upload the keyframes to the animation service.');
  };
  const pa = await up(imageA, 'a.jpg'); const pb = await up(imageB, 'b.jpg');
  const file = p => ({ path: p, meta: { _type: 'gradio.FileData' } });
  const out = await callQueue(CSPACE, 2, [file(pa), text, 50, 7.5, 1.0, 10, Math.floor(Math.random() * 1e9), file(pb)], { waitMs: 300000 });
  const o = out?.[0] || {}; const url = o.video?.url || o.url || (o.path ? `${CSPACE}/file=${o.path}` : null);
  if (!url) throw new Error('The animation service returned no clip.');
  return url;
}
// Character consistency: FLUX.1 Kontext [dev] Space edits a reference picture, so the same character appears in every scene.
const KSPACE = 'https://black-forest-labs-flux-1-kontext-dev.hf.space';
export async function generateWithReference({ image, prompt }) {
  const text = String(prompt || '').trim().slice(0, 600); if (!text || !image) throw new Error('Reference picture and prompt needed.');
  const auths = [process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}, {}]; let path = null;
  for (const auth of auths) {
    try { const fd = new FormData(); fd.append('files', new Blob([image], { type: 'image/jpeg' }), 'ref.jpg'); const u = await fetch(`${KSPACE}/gradio_api/upload`, { method: 'POST', body: fd, headers: auth, signal: AbortSignal.timeout(30000) }); if (u.ok) { path = (await u.json())?.[0]; if (path) break; } } catch { /* try next */ }
  }
  if (!path) throw new Error('Could not upload the character picture to the free GPU service.');
  const out = await callSpace(KSPACE, 'infer', [{ path, meta: { _type: 'gradio.FileData' } }, text, 0, true, 2.5, 24], { startMs: 30000, waitMs: 150000 });
  const url = out?.[0]?.url; if (!/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) throw new Error('The character picture service returned no picture.');
  return url;
}

// Lyrics with timestamps: Groq Whisper (same free key as the chat model).
export async function transcribeSong(buf, language) {
  const key = process.env.GROQ_API_KEY; if (!key) throw new Error('Lyrics need the Groq key, which is not set.');
  const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'song.mp3'); fd.append('model', 'whisper-large-v3'); fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'segment'); fd.append('temperature', '0'); if (language) fd.append('language', language);
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(120000) });
  const t = await r.text(); if (!r.ok) throw new Error(`The lyrics service said HTTP ${r.status}: ${t.replace(/\s+/g, ' ').slice(0, 140)}`);
  const j = JSON.parse(t); return { language: j.language || '', segments: (j.segments || []).map(s => ({ t0: Number(s.start) || 0, t1: Number(s.end) || 0, text: String(s.text || '').trim() })).filter(s => s.text) };
}
