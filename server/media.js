// Free image generation through a Hugging Face Space (FLUX.1-schnell on ZeroGPU), billed to the owner's free HF quota.
const SPACE = 'https://black-forest-labs-flux-1-schnell.hf.space';
const snap = (n, d) => Math.min(1344, Math.max(256, Math.round((Number(n) || d) / 64) * 64));
export const imageEnabled = () => !!process.env.HF_TOKEN;
export async function generateImage({ prompt, width, height }) {
  const text = String(prompt || '').trim().slice(0, 600);
  if (!text) throw new Error('No prompt given.');
  if (!process.env.HF_TOKEN) throw new Error('Image generation is not configured.');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${process.env.HF_TOKEN}` };
  const start = await fetch(`${SPACE}/gradio_api/call/infer`, { method: 'POST', headers, body: JSON.stringify({ data: [text, 0, true, snap(width, 1024), snap(height, 1024), 4] }), signal: AbortSignal.timeout(20000) });
  if (!start.ok) throw new Error(`The image service refused the request (HTTP ${start.status}).`);
  const { event_id } = await start.json();
  if (!event_id) throw new Error('The image service gave no job id.');
  const res = await fetch(`${SPACE}/gradio_api/call/infer/${event_id}`, { headers: { authorization: headers.authorization }, signal: AbortSignal.timeout(90000) });
  const body = await res.text();
  const m = body.match(/event: complete\s+data: (.+)/);
  if (!m) throw new Error(/quota|exceeded|GPU/i.test(body) ? 'The free GPU quota for today is used up. Try again later.' : 'The image service failed to draw this one. Try again.');
  const url = JSON.parse(m[1])?.[0]?.url;
  if (!/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) throw new Error('The image service returned no picture.');
  return url;
}

// Short text-to-video clips through the LTX-Video distilled Space (free ZeroGPU quota of the owner's HF account).
const VSPACE = 'https://lightricks-ltx-video-distilled.hf.space';
export async function generateClip({ prompt, seconds = 2, width = 704, height = 512 }) {
  const text = String(prompt || '').trim().slice(0, 500);
  if (!text) throw new Error('No prompt given.');
  if (!process.env.HF_TOKEN) throw new Error('Video generation is not configured.');
  const auth = { authorization: `Bearer ${process.env.HF_TOKEN}` };
  const dur = Math.min(4, Math.max(1, Number(seconds) || 2));
  const data = [text, 'worst quality, inconsistent motion, blurry, jittery, distorted', null, null, height, width, 'text-to-video', dur, 9, 42, true, 1, true];
  const start = await fetch(`${VSPACE}/gradio_api/call/text_to_video`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ data }), signal: AbortSignal.timeout(20000) });
  if (!start.ok) throw new Error(`The video service refused the request (HTTP ${start.status}).`);
  const { event_id } = await start.json();
  const res = await fetch(`${VSPACE}/gradio_api/call/text_to_video/${event_id}`, { headers: auth, signal: AbortSignal.timeout(240000) });
  const body = await res.text();
  const m = body.match(/event: complete\s+data: (.+)/);
  if (!m) throw new Error(/quota|exceeded|GPU/i.test(body) ? 'The free GPU quota is used up for now.' : 'The video service failed to make this clip.');
  const url = JSON.parse(m[1])?.[0]?.video?.url || JSON.parse(m[1])?.[0]?.url;
  if (!/^https:\/\/[a-z0-9.-]+\.hf\.space\//.test(url || '')) throw new Error('The video service returned no clip.');
  return url;
}
