// Unified-pipeline providers: AI Horde img2img (face-consistent panels) + Gemini TTS (cast voices).
// Ported from the proven sandbox pipelines (gen-p2.py, dub-p2.py). Free tools only.

const HORDE_EP = 'https://stablehorde.net/api/v2';
const HORDE_KEY = process.env.HORDE_KEY || '0000000000'; // anonymous key works, registered key gets priority

// Submit one img2img job with a face-reference image and wait for the PNG. Retries like the proven script.
export async function hordePanel({ prompt, negative, refImage, denoise = 0.66, width = 768, height = 768, model = 'Juggernaut XL', waitMs = 2400000 }) {
  const body = {
    prompt: `${prompt} ### ${negative || ''}`,
    params: { width, height, n: 1, steps: 30, cfg_scale: 7.0, denoising_strength: denoise },
    source_image: Buffer.isBuffer(refImage) ? refImage.toString('base64') : refImage,
    models: [model], r2: false,
  };
  let id = null;
  for (let i = 0; i < 20 && !id; i++) {
    try {
      const r = await fetch(`${HORDE_EP}/generate/async`, { method: 'POST', headers: { apikey: HORDE_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (j.id) id = j.id;
    } catch (e) { console.error('horde submit:', String(e.message).slice(0, 120)); }
    if (!id) await new Promise(r => setTimeout(r, 45000));
  }
  if (!id) throw new Error('Horde would not take the panel job.');
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      const c = await (await fetch(`${HORDE_EP}/generate/check/${id}`, { signal: AbortSignal.timeout(15000) })).json();
      if (c.faulted) throw new Error('Horde panel faulted.');
      if (!c.done) continue;
      const st = await (await fetch(`${HORDE_EP}/generate/status/${id}`, { signal: AbortSignal.timeout(30000) })).json();
      const img = st.generations?.[0]?.img;
      if (!img) throw new Error('Horde returned no image.');
      if (img.startsWith('http')) {
        const r = await fetch(img, { signal: AbortSignal.timeout(60000) });
        return Buffer.from(await r.arrayBuffer());
      }
      return Buffer.from(img, 'base64');
    } catch (e) { if (String(e.message).includes('faulted') || String(e.message).includes('no image')) throw e; console.error('horde poll:', String(e.message).slice(0, 120)); }
  }
  throw new Error('Horde panel timed out.');
}

const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
// One line of dubbed dialogue. voiceName: prebuilt Gemini voice (Gacrux, Puck, Kore...). style: direction prefix.
export async function geminiTTS({ text, voiceName = 'Gacrux', style = '' }) {
  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean);
  if (!keys.length) throw new Error('No Gemini key set.');
  const payload = {
    contents: [{ parts: [{ text: `${style}\n\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
    model: GEMINI_TTS_MODEL,
  };
  let lastErr = null;
  for (let attempt = 0; attempt < 2 * keys.length; attempt++) {
    const key = keys[attempt % keys.length];
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(180000),
      });
      if (r.status === 429) { lastErr = new Error('Gemini TTS quota (429)'); await new Promise(rs => setTimeout(rs, 5000)); continue; }
      const j = await r.json().catch(() => ({}));
      for (const p of j.candidates?.[0]?.content?.parts || []) {
        if (p.inlineData?.data) return Buffer.from(p.inlineData.data, 'base64');
      }
      lastErr = new Error(`Gemini TTS returned no audio: ${JSON.stringify(j).slice(0, 150)}`);
    } catch (e) { lastErr = e; await new Promise(rs => setTimeout(rs, 5000)); }
  }
  throw lastErr || new Error('Gemini TTS failed.');
}
