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
