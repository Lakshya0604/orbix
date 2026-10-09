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
export async function generateClip({ prompt, seconds = 2, width = 704, height = 512 }) {
  const text = String(prompt || '').trim().slice(0, 500);
  if (!text) throw new Error('No prompt given.');
  const dur = Math.min(4, Math.max(1, Number(seconds) || 2));
  const data = [text, 'worst quality, inconsistent motion, blurry, jittery, distorted', null, null, height, width, 'text-to-video', dur, 9, 42, true, 1, true];
  const out = await callSpace(VSPACE, 'text_to_video', data, { waitMs: 240000 });
  const url = out?.[0]?.video?.url || out?.[0]?.url;
  if (!/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) throw new Error('The video service returned no clip.');
  return url;
}

// Voiceover: Edge neural voices through a public free Space (no GPU quota needed).
const TSPACE = 'https://innoai-edge-tts-text-to-speech.hf.space';
export async function generateSpeech({ text, hindi = false }) {
  const t = String(text || '').trim().slice(0, 400); if (!t) throw new Error('No narration text.');
  const voice = hindi ? 'hi-IN-SwaraNeural - hi-IN (Female)' : 'en-US-AndrewNeural - en-US (Male)';
  const out = await callSpace(TSPACE, 'tts_interface', [t, voice, 0, 0], { waitMs: 45000 });
  const url = out?.[0]?.url;
  if (!/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) throw new Error('The voice service returned no audio.');
  return url;
}
