// FACTS SHORT mode (GyanDose-style): topic -> verified facts script (Groq) -> per-scene AI illustration
// (Gemini image first, free FLUX fallback) -> Gemini TTS voice (Orus, excited) -> ffmpeg render:
// yellow top strip, keyword boxes (red + yellow), numbered badge, emoji, word-by-word captions,
// synth bed + cut whooshes. All visuals AI-generated, all audio synthesized - no stock, no copyrighted music.
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { chatCompletion } from '../llm.js';
import { generateImage, generateImageGemini, generateSpeech } from '../media.js';
import { geminiTTS } from './providers.js';
import { assertPublicUrl } from '../ssrf.js';

const run = promisify(execFile);
const FW = 1080, FH = 1920, FPS = 24;
const IMG_STYLE = 'vivid dramatic digital illustration, rich saturated colors, high detail, vertical composition, cinematic lighting, no text, no letters, no watermark, no people, no humans, no faces, no characters';

const jsonOf = t => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const assTime = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = (t % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${sec}`; };
const escAss = s => String(s || '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
const hasDev = s => /[\u0900-\u097F]/.test(s || '');
const fontFor = s => (hasDev(s) ? 'Noto Sans Devanagari' : 'Noto Sans');

const SCRIPT_SYS = `You write a Hindi YouTube Shorts FACTS video script (48-60 seconds spoken). Reply ONLY valid JSON, no double quotes inside values.
Shape: {"strip":"...","fiction":false,"scenes":[{"say":"...","kw":"...","emoji":"...","visual":"...","badge":"1","claim":"...","url":"...","evidence":"..."}]}
Rules:
- Exactly 14 scenes. Scene 1 = hook (badge empty, no claim/url). Scenes 2-13 = TWELVE candidate numbered facts (badge "1".."12"); only the 5 that verify will be used, so make all 12 strong. Scene 14 = ending: ask viewers to comment their favourite fact number and follow (badge empty, no claim/url).
- "strip" = short Hindi top-bar title, e.g. "अंतरिक्ष के 5 चौंकाने वाले सच (strip ka number final kept facts se badal diya jayega)". If the topic is fiction, set fiction true and start the strip with "(काल्पनिक)".
- "say" = spoken Hindi in Devanagari. LENGTH MATTERS: hook 12-18 words and must grab instantly; each fact scene 2-3 full sentences of 24-32 words total (state the fact with its number, then why it is amazing); ending 12-18 words. Each fact scene must be 24-32 spoken words; hook 12-18; ending 12-18 (about 45-58 seconds). NEVER speak fact numbers (no "नंबर एक/दो/तीन" etc.) - an on-screen badge already shows the number; state each fact directly. Simple words, energetic.
- "kw" = keyword box, TWO lines separated by \\n: line 1 = the headline number/word in Hindi (max 3 words, MUST contain a number in digits taken FROM THE FACT ITSELF, e.g. "243 दिन"), line 2 = short kicker in Hindi (max 3 words, e.g. "साल 225 दिन"). For hook and ending scenes kw can be empty. NEVER use the fact list position (1,2,3,4,5) as that number - the badge already shows the position.
- "emoji" = exactly one unicode emoji matching the scene.
- "visual" = ONE English sentence describing a vivid illustration of THIS line (objects/places/phenomena only - never any person, human, face or character; no text in image).
- For the 4 fact scenes: "claim" = the key checkable statement, "url" = a primary or authoritative source page (NASA, Britannica, Smithsonian, NIH/NCBI, NCERT, official museum or government sites). Prefer stable en.wikipedia.org article URLs you are highly confident exist (most reliable for verification), then deep stable primary article pages (e.g. britannica.com/place/Venus-planet, science.nasa.gov/venus/venus-facts), never homepages or search pages, and only URLs you are highly confident exist, "evidence" = the exact number as digits then | then 2-3 English keywords that must appear on that page (e.g. "243|Venus|rotation|day"). Facts must be real, current, non-political, non-religious. Comparisons must be TRUE TODAY, not from old data: for Jupiter's Great Red Spot say only "पृथ्वी से बड़ा" (it is about 1.3 Earths wide now), never 2 Earths. Same care for any shrinking/changing record.
- FIDELITY: "say" must keep the exact numeric relationship AND its base from the fact. If the fact is "the Sun holds 99.86% of the solar system's total mass", say "सौर मंडल के कुल द्रव्यमान का 99.86%" - never flip it into "बाकी सभी ग्रहों से 99.86% अधिक". A percentage without its true base is a FAIL.
- NEVER invent causes, mechanisms or explanations not in the claim: for "अंतरिक्ष में ध्वनि नहीं होती" do NOT add wave-conversion or particle theories. State the fact, then only widely-known true context.`;

async function fetchPage(u) {
  const UAS = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Mozilla/5.0 (compatible; OrbixFacts/1.0)'];
  let last = null;
  for (const ua of UAS) {
    try {
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html,application/xhtml+xml' } });
      if (r.ok) return r;
      last = `http ${r.status}`;
      if (r.status !== 403 && r.status !== 429) return r;
    } catch (e) { last = String(e.message).slice(0, 60); }
  }
  throw new Error(last || 'fetch failed');
}

const PRIMARY_HOSTS = ['nasa.gov', 'britannica.com', 'si.edu', 'smithsonian', 'nih.gov', 'ncbi.nlm.nih.gov', 'nist.gov', 'noaa.gov', 'usgs.gov', 'esa.int', 'isro.gov.in', 'ncert.nic.in', 'indiapost.gov.in', 'etymonline.com'];
const numMatch = (flat, num) => { const nf = String(num || '').replace(/,/g, '').toLowerCase(); if (!nf) return true; if (flat.includes(nf)) return true; const ni = nf.split('.')[0]; return ni.length >= 2 && flat.includes(ni); };
const textOf = html => String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
async function wikiVerify(f) {
  // Search Wikipedia for the claim, verify in the extract, then prefer a primary source from the page's external links.
  const kws = String(f.evidence || '').split('|').map(x => x.trim()).filter(Boolean);
  const query = [f.claim, ...kws.slice(1)].filter(Boolean).join(' ').slice(0, 220);
  const api = 'https://en.wikipedia.org/w/api.php';
  const hdr = { 'user-agent': 'OrbixFacts/1.0 (fact-check; contact: site owner)' };
  let hits = [];
  for (const q2 of [query, kws.slice(1).join(' ')].filter(Boolean)) {
    let sr = null;
    for (let a = 0; a < 3; a++) {
      sr = await fetch(`${api}?action=query&list=search&srsearch=${encodeURIComponent(q2)}&format=json&srlimit=3`, { headers: hdr, signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (sr && sr.status === 429) { await new Promise(r => setTimeout(r, 4000 * (a + 1))); continue; }
      break;
    }
    if (sr && sr.ok) { hits = (await sr.json())?.query?.search || []; if (hits.length) break; }
    await new Promise(r => setTimeout(r, 800));
  }
  if (!hits.length) return { ok: false, why: 'wiki search empty' };
  for (const h of hits.slice(0, 3)) {
    const title = h.title;
    await new Promise(r => setTimeout(r, 700));
    const er = await fetch(`${api}?action=query&prop=extracts%7Cextlinks&explaintext=1&exlimit=1&ellimit=200&titles=${encodeURIComponent(title)}&format=json`, { headers: hdr, signal: AbortSignal.timeout(25000) });
    if (er.status === 429) { await new Promise(r => setTimeout(r, 5000)); continue; }
    if (!er.ok) continue;
    const ej = await er.json();
    const page = Object.values(ej?.query?.pages || {})[0] || {};
    const flat = String(page.extract || '').toLowerCase().replace(/[,\u00a0]/g, '');
    const low = String(page.extract || '').toLowerCase();
    const numOk = numMatch(flat, kws[0]);
    const kwOk = kws.slice(1).filter(k => k.length > 2).filter(k => low.includes(k.toLowerCase())).length >= Math.min(1, kws.slice(1).filter(k => k.length > 2).length || 1);
    if (!(numOk && kwOk)) continue;
    // fact verified on Wikipedia; try to upgrade the citation to a primary external link on the page
    const links = (page.extlinks || []).map(x => String(x['*'] || ''));
    const prim = links.filter(u2 => { try { const ho = new URL(u2).hostname.toLowerCase(); return PRIMARY_HOSTS.some(ph => ho === ph || ho.endsWith('.' + ph)); } catch { return false; } }).slice(0, 3);
    for (const pu of prim) {
      try {
        const u = await assertPublicUrl(pu);
        const rr = await fetchPage(u);
        if (!rr.ok) continue;
        const t = textOf(await rr.text());
        const f2 = t.replace(/[,\u00a0]/g, '');
        if (numMatch(f2, kws[0]) && kws.slice(1).filter(k => k.length > 2).some(k => t.includes(k.toLowerCase()))) return { ok: true, url: pu };
      } catch { /* next link */ }
    }
    return { ok: true, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` };
  }
  return { ok: false, why: 'no wiki match' };
}

async function verifyFact(f) {
  try {
    const u = await assertPublicUrl(String(f.url || ''));
    const r = await fetchPage(u);
    if (!r.ok) return { ok: false, why: `http ${r.status}` };
    const html = await r.text();
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    const parts = String(f.evidence || '').split('|').map(s => s.trim()).filter(Boolean);
    const num = parts[0] || '';
    const kws = parts.slice(1).filter(k => k.length > 2);
    const flat = text.replace(/[,\u00a0]/g, '');
    const numFlat = num.replace(/,/g, '').toLowerCase();
    const numInt = numFlat.split('.')[0];
    const numOk = !num || flat.includes(numFlat) || (numInt.length >= 2 && flat.includes(numInt));
    const kwOk = kws.filter(k => text.includes(k.toLowerCase())).length >= Math.min(2, kws.length);
    return { ok: numOk && kwOk, why: numOk ? (kwOk ? '' : 'keywords missing') : 'number missing' };
  } catch (e) { return { ok: false, why: String(e.message).slice(0, 80) }; }
}


async function semanticVerify(kept) {
  const WAPI = 'https://en.wikipedia.org/w/api.php';
  const hdr = { 'user-agent': 'OrbixFacts/1.0 (fact-check; contact: site owner)' };
  const items = [];
  for (const [k, x] of kept.entries()) {
    let txt = '';
    try {
      const u = new URL(String(x.s.url || ''));
      if (u.hostname.endsWith('wikipedia.org')) {
        const title = decodeURIComponent((u.pathname.split('/wiki/')[1] || '').replace(/_/g, ' '));
        const er = await fetch(`${WAPI}?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(title)}&format=json`, { headers: hdr, signal: AbortSignal.timeout(25000) });
        if (er.ok) { const ej = await er.json(); txt = String(Object.values(ej?.query?.pages || {})[0]?.extract || ''); }
      } else {
        const u2 = await assertPublicUrl(String(x.s.url || ''));
        const r = await fetchPage(u2);
        if (r.ok) txt = String(await r.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      }
    } catch { /* skip */ }
    if (txt && txt.length > 200) items.push({ i: k + 1, claim: String(x.s.claim || ''), say: String(x.s.say || ''), source: txt.slice(0, 3500) });
    await new Promise(r => setTimeout(r, 400));
  }
  if (!items.length) return new Set();
  try {
    const m = await chatCompletion({ tools: [], messages: [
      { role: 'system', content: 'You are a strict fact checker for a Hindi facts video. For each item decide whether the SOURCE explicitly supports the CLAIM: the exact number with the exact unit AND the exact subject must match (58 minutes vs 243 days is a FAIL; a number that appears about a different planet is a FAIL; unit mismatches like hours vs days are a FAIL). ALSO fail the item when the SAY (spoken Hindi) distorts the fact: a different number, a flipped comparison (e.g. 99.86 percent of total mass spoken as 99.86 percent MORE than the other planets), a missing percentage base, or an invented cause/mechanism the source does not state. Return ONLY {"verdicts":[{"i":1,"ok":true}]}; include every item.' },
      { role: 'user', content: JSON.stringify(items) }] });
    const j = jsonOf(m.content);
    const okSet = new Set((j && Array.isArray(j.verdicts) ? j.verdicts : []).filter(v => v && v.ok).map(v => v.i | 0));
    const bad = new Set();
    for (const it of items) if (!okSet.has(it.i)) bad.add(it.i - 1);
    return bad;
  } catch { return new Set(); }
}

export async function factsScript(job, VideoJob) {
  let spec = null;
  for (let a = 0; a < 3 && !spec; a++) {
    try {
      const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: SCRIPT_SYS }, { role: 'user', content: `Topic: ${job.topic}` }] });
      const j = jsonOf(m.content);
      if (j && Array.isArray(j.scenes) && j.scenes.length >= 8) spec = j;
    } catch (e) { await new Promise(r => setTimeout(r, 6000 * (a + 1))); }
  }
  if (!spec) throw new Error('Could not write the facts script. Please try again.');
  spec.scenes = spec.scenes.slice(0, 14);
  // Too-short scripts make a 15-second video; ask once for a fuller cut.
  const wc = () => { const sc = spec.scenes; const pick = [sc[0], ...sc.slice(1, 6), sc[sc.length - 1]].filter(Boolean); return pick.reduce((n, x) => n + String(x.say || '').split(/\s+/).filter(Boolean).length, 0); };
  for (let a = 0; a < 2 && wc() < 100; a++) {
    try {
      const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: SCRIPT_SYS }, { role: 'user', content: `Topic: ${job.topic}\nYour previous draft was only ${wc()} spoken words - far too short. Rewrite the FULL script (hook + 12 candidate facts + ending); every fact scene needs 2-3 full sentences of 24-32 words. Keep the same facts and sources.` }] });
      const j = jsonOf(m.content);
      if (j && Array.isArray(j.scenes) && j.scenes.length >= 8) {
        const oldWc = wc(); const cand = j; cand.scenes = cand.scenes.slice(0, 14);
        const candWc = cand.scenes.reduce((n, x) => n + String(x.say || '').split(/\s+/).filter(Boolean).length, 0);
        if (candWc > oldWc) spec = cand;
      }
    } catch { /* keep best draft */ }
  }
  // Verify the numbered facts against their sources; one LLM replacement round for failures.
  const factIdx = spec.scenes.map((s, i) => ({ s, i })).filter(x => x.s.url && x.s.claim);
  const failed = [];
  for (const x of factIdx) { let v = await verifyFact(x.s); if (!v.ok) { const w = await wikiVerify(x.s).catch(() => ({ ok: false, why: 'wiki err' })); if (w.ok) { x.s.url = w.url; v = { ok: true, why: '' }; } else v.why += ` / ${w.why}`; } x.s._verified = v.ok; if (!v.ok) failed.push({ ...x, why: v.why }); }
  if (failed.length) {
    try {
      const ask = failed.map(f => `Scene said: ${f.s.say} (source check failed: ${f.why})`).join('\n');
      const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: SCRIPT_SYS + '\nReturn ONLY the replacement fact scenes array: {"scenes":[...]} with the same keys, one per failed fact, on the SAME topic. Every url must be a page you are confident contains the number.' }, { role: 'user', content: `Topic: ${job.topic}\nFailed facts:\n${ask}` }] });
      const j = jsonOf(m.content);
      const reps = (j && Array.isArray(j.scenes) ? j.scenes : []).slice(0, failed.length);
      for (let k = 0; k < reps.length; k++) { let v = await verifyFact(reps[k]); if (!v.ok) { const w = await wikiVerify(reps[k]).catch(() => ({ ok: false })); if (w.ok) { reps[k].url = w.url; v = { ok: true }; } } if (v.ok) Object.assign(failed[k].s, reps[k], { _verified: true }); }
    } catch { /* keep originals dropped below */ }
  }
  let keptFacts = factIdx.filter(x => x.s._verified).slice(0, 5);
  // semantic pass: source text must support the exact claim (subject + number + unit) - substring checks pass hallucinations like "Venus day = 58 minutes"
  try { const badSem = await semanticVerify(keptFacts); if (badSem.size) keptFacts = keptFacts.filter((x, k) => !badSem.has(k)); } catch { /* keep */ }
  // kw accuracy pass: the box must match the fact exactly (units, numbers) - a wrong unit on screen is worse than no box.
  try {
    const askKw = keptFacts.map((x, k) => `${k + 1}. claim: ${x.s.claim}
   kw: ${String(x.s.kw || '').replace(/\n/g, ' / ')}`).join('\n');
    const mk = await chatCompletion({ tools: [], messages: [{ role: 'system', content: 'You fact-check the on-screen keyword box of a Hindi facts Short against the verified claim. For EACH item return {"fixes":[{"i":1,"kw":"line1\nline2"}]} - only for items where the kw text is inaccurate (wrong number, wrong unit like घंटे vs दिन, wrong object) or uses the list position as its number. line1 = the headline number+unit FROM THE CLAIM (max 3 words, digits), line2 = short kicker (max 3 words). If an item is already accurate, omit it. Never invent a number not in the claim.' }, { role: 'user', content: askKw }] });
    const jk = jsonOf(mk.content);
    for (const f of (jk && Array.isArray(jk.fixes) ? jk.fixes : [])) { const idx = (f.i | 0) - 1; if (idx >= 0 && idx < keptFacts.length && f.kw) keptFacts[idx].s.kw = String(f.kw).slice(0, 60); }
  } catch { /* keep original kw */ }
  if (keptFacts.length < 4) { job.note = 'verify failed: ' + failed.map(f => `${(f.s.url || '').slice(0, 60)}=${f.why}`).join(' | ').slice(0, 480); await job.save().catch(() => {}); throw new Error('Could not verify at least 4 facts against their sources. Try a different topic.'); }
  const keepIdx = new Set([0, spec.scenes.length - 1, ...keptFacts.map(x => x.i)]);
  const scenes = spec.scenes.filter((s, i) => keepIdx.has(i));
  // Renumber badges 1..N in kept order.
  let b = 1;
  const PERSON_RX = /\b(person|people|man|woman|men|women|girl|boy|child|kid|teen|human|face|portrait|silhouette|astronaut|scientist|crowd|viewer|lady|guy|character|figure)\b/i;
  job.scenes = scenes.map(s => ({
    act: s.badge ? 'fact' : 'frame', prompt: (v => { const clean = String(v || '').split(/(?<=[.!?])\s+/).filter(x => x && !PERSON_RX.test(x)).join(' ').trim(); return (clean || 'dramatic cosmic vista of stars and nebula, topic concept art').slice(0, 380); })(s.visual), say: String(s.say || '').slice(0, 300),
    kw: String(s.kw || '').replace(/\\n/g, '\n').slice(0, 60), state: 'wait', tries: 0, t0: 0, t1: 0,
    badge: s.badge ? String(b++) : '',
  }));
  const stripTxt = String(spec.strip || job.topic).replace(/(के\s+|की\s+)(\d+|एक|दो|तीन|चार|पाँच|पांच|छह)(\s+)/, `$1${keptFacts.length}$3`).slice(0, 60);
  job.factsMeta = JSON.stringify({ strip: stripTxt, fiction: !!spec.fiction, emojis: scenes.map(s => String(s.emoji || '').slice(0, 8)), sources: keptFacts.map(x => String(x.s.url).slice(0, 200)) });
  job.status = 'clips'; job.stage = 'Drawing scene 1'; await job.save();
}

const STORY_VOICE = process.env.FACTS_VOICE || 'Orus';
const VOICE_STYLE = 'Say this like a fast, excited young Indian YouTube Shorts storyteller with a strong hook:';

function wavWrap(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function makeFactsScene(job, i, VideoJob, VideoBlob, blobBytes) {
  const tag = `Scene ${i + 1} of ${job.scenes.length}`;
  // One voice track for the whole Short, made on the first scene pass.
  if (i === 0) {
    const have = await VideoBlob.findOne({ jobId: job._id, kind: 'factvoice' });
    if (!have) {
      job.stage = `${tag}: recording the voice`; await job.save().catch(() => {});
      const full = job.scenes.map(s => s.say).join(' ');
      let made = false;
      if (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2) {
        for (let a = 0; a < 2 && !made; a++) {
          try { const pcm = await geminiTTS({ text: full, voiceName: STORY_VOICE, style: VOICE_STYLE }); if (pcm?.length > 500) { await VideoBlob.create({ jobId: job._id, kind: 'factvoice', idx: 0, data: wavWrap(pcm) }); job.voiceVia = 'gemini-tts (Orus)'; made = true; } } catch (e) { console.error('facts voice', String(e.message).slice(0, 120)); await new Promise(r => setTimeout(r, 5000)); }
        }
      }
      if (!made) {
        for (const [k, sc] of job.scenes.entries()) {
          try { const au = await generateSpeech({ text: sc.say, hindi: true }); if (au?.data?.length > 200) { await VideoBlob.deleteMany({ jobId: job._id, kind: 'audio', idx: k }); await VideoBlob.create({ jobId: job._id, kind: 'audio', idx: k, data: au.data }); job.voiceVia = job.voiceVia && job.voiceVia !== au.via ? 'mixed' : au.via; } } catch (e) { console.error('facts voice fallback', String(e.message).slice(0, 100)); }
        }
      }
      await job.save().catch(() => {});
    }
  }
  job.stage = `${tag}: drawing`; await job.save().catch(() => {});
  const prompt = `${job.scenes[i].prompt}. ${IMG_STYLE}.`;
  let img = null, via = '', gemErr = '', fluxErr = '', polErr = '';
  if (process.env.GEMINI_API_KEY) {
    for (let a = 0; a < 3 && !img; a++) { try { img = await generateImageGemini({ prompt, aspect: '9:16' }); via = 'Google AI Studio'; } catch (e) { gemErr = String(e.message).slice(0, 90); console.error('facts gemini img', gemErr); await new Promise(r => setTimeout(r, 8000)); } }
  }
  if (!img) {
    for (let a = 0; a < 2 && !img; a++) {
      try {
        const url = await generateImage({ prompt, width: 768, height: 1024 });
        const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 5000) { img = b; via = 'FLUX (free GPU)'; } }
      } catch (e) { fluxErr = String(e.message).slice(0, 60); console.error('facts flux img', fluxErr); await new Promise(r => setTimeout(r, 4000)); }
    }
  }
  if (!img) { // keyless Pollinations still (no quota)
    for (let a = 0; a < 3 && !img; a++) {
      try {
        const q = encodeURIComponent(String(prompt).slice(0, 350));
        const r = await fetch(`https://image.pollinations.ai/prompt/${q}?width=720&height=1280&nologo=true&seed=${Date.now() % 100000 + i}`, { signal: AbortSignal.timeout(90000) });
        const b = Buffer.from(await r.arrayBuffer());
        if (r.ok && /image/.test(r.headers.get('content-type') || '') && b.length > 5000) { img = b; via = 'Pollinations (keyless)'; } else polErr = `HTTP ${r.status}`;
      } catch (e) { polErr = String(e.message).slice(0, 60); }
      if (!img) await new Promise(r => setTimeout(r, 5000));
    }
  }
  if (!img) { job.note = `scene img failed: gemini=${gemErr || 'n/a'} | flux=${fluxErr || 'n/a'} | pol=${polErr || 'n/a'}`; await job.save().catch(() => {}); throw new Error('Free GPU quota is used up - could not draw this scene'); }
  if (via !== 'Google AI Studio' && gemErr) { job.note = `gemini img fallback (${via}): ${gemErr}`.slice(0, 200); await job.save().catch(() => {}); }
  await VideoBlob.deleteMany({ jobId: job._id, kind: 'factimg', idx: i });
  await VideoBlob.create({ jobId: job._id, kind: 'factimg', idx: i, data: img });
  job.panelStats = (job.panelStats || '') + (via === 'Google AI Studio' ? 'G' : 'F');
  job.note = `Facts Short (${via})`; await job.save().catch(() => {});
  const sc = job.scenes[i]; sc.state = 'ok'; await job.save();
}

// ---- timing helpers (ported from the GyanDose renderer) ----
export const wWeight = w => w.length + (/[,.!?]$/.test(w) ? 4 : 0);
export function sceneWordTimes(say, a, b) {
  const words = String(say).split(/\s+/).filter(Boolean);
  const ws = words.map(wWeight); const tot = ws.reduce((x, y) => x + y, 0) || 1;
  const span = Math.max(0.3, b - a - 0.15); let c = 0; const out = [];
  for (let k = 0; k < words.length; k++) { out.push([a + (c / tot) * span, a + ((c + ws[k] * 0.85) / tot) * span, words[k].replace(/[,.!?]+$/, '')]); c += ws[k]; }
  return out;
}

const emojiCp = e => [...String(e || '')].map(c => c.codePointAt(0).toString(16)).filter(x => x !== 'fe0f').join('-');

export function buildAss({ meta, scenes, total }) {
  const strip = escAss(meta.strip || 'Facts');
  const S = [];
  S.push(`[Script Info]\nScriptType: v4.00+\nPlayResX: ${FW}\nPlayResY: ${FH}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n`);
  S.push(`[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding`);
  S.push(`Style: Strip,${fontFor(strip)},54,&H00000000,&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,30,30,42,1`);
  S.push(`Style: KwR,Noto Sans Devanagari,114,&H00FFFFFF,&H00FFFFFF,&H002420ED,&H00000000,-1,0,0,0,100,100,0,0,3,16,8,5,60,60,0,1`);
  S.push(`Style: KwY,Noto Sans Devanagari,104,&H00000000,&H00000000,&H0000D6FF,&H00000000,-1,0,0,0,100,100,0,0,3,14,8,5,60,60,0,1`);
  S.push(`Style: Badge,Noto Sans,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`);
  S.push(`Style: Circ,Noto Sans,10,&H002420ED,&H002420ED,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`);
  S.push(`Style: Cap,Noto Sans Devanagari,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,9,2,2,50,50,480,1`);
  S.push(`Style: Wm,Noto Sans,46,&H14FFFFFF,&H14FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,3,50,50,30,1`);
  S.push(`\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`);
  const ev = (layer, a, b, style, text) => S.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},${style},,0,0,0,,${text}`);
  ev(4, 0, total, 'Strip', strip);
  ev(1, 0, total, 'Wm', 'GyanDose');
  for (const sc of scenes) {
    const a = sc.t0, b = sc.t1;
    if (sc.badge) {
      ev(2, a, b, 'Circ', '{\\pos(120,272)\\p1}m 0 -78 b 43 -78 78 -43 78 0 b 78 43 43 78 0 78 b -43 78 -78 43 -78 0 b -78 -43 -43 -78 0 -78');
      ev(3, a, b, 'Badge', `{\\pos(120,272)}${sc.badge}`);
    }
    const kwLines = String(sc.kw || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 2);
    if (kwLines[0]) ev(3, a, b, 'KwR', `{\\pos(540,660)}${escAss(kwLines[0])}`);
    if (kwLines[1]) ev(3, a, b, 'KwY', `{\\pos(540,795)}${escAss(kwLines[1])}`);
    // word-by-word captions: chunk of 2 words (3 if remainder 3); one event per word position, current word yellow.
    const ws = sc.words || [];
    const chunks = []; let ci = 0;
    while (ci < ws.length) { let n = 2; if (ws.length - ci === 3) n = 3; if (ws[ci][2].length > 7 && ci + 1 < ws.length && ws[ci + 1][2].length > 7) n = 1; chunks.push(ws.slice(ci, ci + n)); ci += n; }
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const ch = chunks[cIdx];
      const nextStart = cIdx + 1 < chunks.length ? chunks[cIdx + 1][0][0] - 0.02 : Infinity;
      for (let k = 0; k < ch.length; k++) {
        const wa = ch[k][0] - 0.03, wb = Math.min(k + 1 < ch.length ? ch[k + 1][0] - 0.02 : ch[k][1] + 0.18, nextStart);
        const text = ch.map((w, j) => (j === k ? `{\\c&H00E6FF&}${escAss(w[2])}{\\c&HFFFFFF&}` : escAss(w[2]))).join(' ');
        if (text.trim()) ev(3, Math.max(a, wa), Math.min(b + 0.3, wb), 'Cap', text);
      }
    }
  }
  return S.join('\n');
}

export async function factsStitch(job, { VideoJob, VideoBlob, blobBytes, fontsDir, durOf }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbix-f-'));
  try {
    const meta = JSON.parse(job.factsMeta || '{}');
    const scenes = job.scenes.map((s, i) => ({ ...s.toObject?.() || s, i }));
    const okScenes = scenes.filter(s => s.state === 'ok');
    if (okScenes.length < 3) throw new Error('Not enough scenes could be drawn. Please try again.');
    // ---- audio ----
    job.stage = 'Mixing the voice'; await job.save().catch(() => {});
    let voiceFile = null, total = 0;
    const vb = await VideoBlob.findOne({ jobId: job._id, kind: 'factvoice' });
    if (vb) {
      const raw = path.join(dir, 'voice0.wav'); await fs.writeFile(raw, await blobBytes(vb));
      voiceFile = path.join(dir, 'voice.wav');
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,aresample=44100', '-ac', '1', voiceFile], { timeout: 120000 });
    } else {
      const parts = [];
      for (const s of okScenes) { const ab = await VideoBlob.findOne({ jobId: job._id, kind: 'audio', idx: s.i }); if (!ab) continue; const f = path.join(dir, `va${s.i}.wav`); await fs.writeFile(f, await blobBytes(ab)); parts.push(f); }
      if (!parts.length) throw new Error('The voice could not be made. Please try again.');
      const sil = path.join(dir, 'sil.wav'); await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.12', sil], { timeout: 30000 });
      const list = []; for (const p of parts) { list.push(p, sil); }
      voiceFile = path.join(dir, 'voice.wav');
      await fs.writeFile(path.join(dir, 'vl.txt'), list.map(f => `file '${f}'`).join('\n'));
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'vl.txt'), '-af', 'aresample=44100', '-ac', '1', voiceFile], { timeout: 120000 });
    }
    total = await durOf(voiceFile);
    if (!total) throw new Error('The voice track is empty.');
    if (total > 58) { const t = Math.min(1.45, total / 51); const sped = path.join(dir, 'voice_fast.wav'); try { await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', voiceFile, '-af', `atempo=${t.toFixed(3)}`, sped], { timeout: 120000 }); const nd = await durOf(sped); if (nd && nd < total) { voiceFile = sped; total = nd; job.note = `voice sped atempo=${t.toFixed(2)}`; } } catch (e) { console.error('facts speedup', String(e.message).slice(0, 100)); } }
    if (total < 45) { const t = Math.max(0.8, total / 46); const stretched = path.join(dir, 'voice_slow.wav'); try { await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', voiceFile, '-af', `atempo=${t.toFixed(3)}`, stretched], { timeout: 120000 }); const nd = await durOf(stretched); if (nd && nd > total) { voiceFile = stretched; total = nd; job.note = `voice stretched atempo=${t.toFixed(2)}`; } } catch (e) { console.error('facts stretch', String(e.message).slice(0, 100)); } }
    // scene boundaries: weight by spoken words, snap to silences
    const sd = await run(ffmpegPath, ['-i', voiceFile, '-af', 'silencedetect=noise=-33dB:d=0.12', '-f', 'null', '-'], { timeout: 60000 }).catch(e => ({ stderr: e.stderr || '' }));
    const st = [...String(sd.stderr || '').matchAll(/silence_start: ([\d.]+)/g)].map(x => +x[1]);
    const en = [...String(sd.stderr || '').matchAll(/silence_end: ([\d.]+)/g)].map(x => +x[1]);
    const mids = st.map((a, k) => (a + (en[k] ?? a)) / 2);
    const wts = t => [...String(t)].reduce((n, ch) => n + (ch.trim() ? 1 + (/[,.!?]/.test(ch) ? 6 : 0) : 0), 0);
    const sw = okScenes.map(s => wts(s.say)); const tot = sw.reduce((a, b) => a + b, 0) || 1;
    const bounds = [0]; let cum = 0;
    for (let k = 0; k < okScenes.length - 1; k++) {
      cum += sw[k]; const est = (cum / tot) * total;
      const near = mids.filter(m => Math.abs(m - est) < 1.2);
      bounds.push(near.length ? near.reduce((x, y) => (Math.abs(x - est) < Math.abs(y - est) ? x : y)) : est);
    }
    bounds.push(total);
    okScenes.forEach((s, k) => { s.t0 = bounds[k]; s.t1 = bounds[k + 1]; s.words = sceneWordTimes(s.say, bounds[k], bounds[k + 1]); });
    // ---- video: zoompan cuts ----
    const segFiles = []; let cutTimes = [];
    for (const s of okScenes) {
      job.stage = `Animating scene ${okScenes.indexOf(s) + 1} of ${okScenes.length}`; await job.save().catch(() => {});
      const ib = await VideoBlob.findOne({ jobId: job._id, kind: 'factimg', idx: s.i });
      if (!ib) continue;
      const img = path.join(dir, `img${s.i}.png`); await fs.writeFile(img, await blobBytes(ib));
      const dur = Math.max(0.8, s.t1 - s.t0);
      const n = Math.max(1, Math.round(dur / 1.7));
      for (let j = 0; j < n; j++) {
        const cd = dur / n, frames = Math.max(1, Math.round(cd * FPS));
        const zin = (s.i + j) % 2 === 0;
        const z0 = zin ? 1.05 : 1.27, z1 = zin ? 1.27 : 1.05;
        const fx = 0.25 + (((s.i * 7 + j * 13) % 50) / 100), fy = 0.2 + (((s.i * 11 + j * 17) % 55) / 100);
        const seg = path.join(dir, `seg${s.i}_${j}.mp4`);
        await run(ffmpegPath, ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-i', img,
          '-vf', `scale=1620:2880,zoompan=z='${z0}+(${z1 - z0})*on/${frames}':x='(iw-iw/zoom)*${fx.toFixed(2)}':y='(ih-ih/zoom)*${fy.toFixed(2)}':d=${frames}:s=${FW}x${FH}:fps=${FPS}`,
          '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '2', seg], { timeout: 180000 });
        segFiles.push(seg);
      }
      for (let j = 1; j < n; j++) cutTimes.push(s.t0 + (dur / n) * j);
    }
    if (!segFiles.length) throw new Error('No scene images to render.');
    await fs.writeFile(path.join(dir, 'cl.txt'), segFiles.map(f => `file '${f}'`).join('\n'));
    const base = path.join(dir, 'base.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'cl.txt'), '-c', 'copy', '-movflags', '+faststart', base], { timeout: 120000 });
    // ---- overlays + final mix ----
    job.stage = 'Adding captions and music'; await job.save().catch(() => {});
    const fd = await fontsDir();
    const assPath = path.join(dir, 'facts.ass');
    await fs.writeFile(assPath, buildAss({ meta, scenes: okScenes, total }));
    // emoji inputs
    const emoFiles = [];
    for (const [k, s] of okScenes.entries()) {
      const cp = emojiCp((meta.emojis || [])[okScenes.indexOf(s)]);
      if (!cp) continue;
      try {
        const r = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${cp}.png`, { signal: AbortSignal.timeout(30000) });
        if (r.ok) { const f = path.join(dir, `em${k}.png`); await fs.writeFile(f, Buffer.from(await r.arrayBuffer())); emoFiles.push({ f, a: s.t0, b: s.t1 }); }
      } catch { /* emoji optional */ }
    }
    const inputs = ['-i', base, '-i', voiceFile];
    for (const e of emoFiles) inputs.push('-i', e.f);
    // audio chain: bed (sines) + kick + whooshes
    const bed = 'sine=frequency=110:sample_rate=44100[s1];sine=frequency=164.8:sample_rate=44100[s2];sine=frequency=220:sample_rate=44100[s3];[s1]volume=0.025[b1];[s2]volume=0.018[b2];[s3]volume=0.015[b3];[b1][b2][b3]amix=inputs=3:duration=first[bed]';
    const kick = `aevalsrc='sin(6.2831*65*mod(t,0.5085))*exp(-mod(t,0.5085)/0.03)':s=44100:d=${total.toFixed(2)},volume=0.09[kick]`;
    let whoosh = '', wlabels = [];
    cutTimes.slice(0, 40).forEach((t, k) => {
      whoosh += `anoisesrc=color=white:sample_rate=44100:duration=0.22[w${k}];[w${k}]lowpass=f=2600,volume=0.08,afade=t=in:st=0:d=0.05,afade=t=out:st=0.05:d=0.17,adelay=${Math.round(t * 1000)}:all=1[wh${k}];`;
      wlabels.push(`[wh${k}]`);
    });
    const mixIns = ['[0:a]', '[bed]', '[kick]', ...wlabels].join('');
    const vOut = emoFiles.length ? `[bx${emoFiles.length - 1}]` : '[b0]';
    const out = path.join(dir, 'out.mp4');
    // Split into light passes so the small free-tier box does not run out of memory:
    // A) video-only overlays, B) audio-only mix, C) copy-mux.
    const fcV = [
      `[0:v]drawbox=x=0:y=0:w=iw:h=150:color=0xFFC400:t=fill,subtitles='${assPath}':fontsdir='${fd}'[b0]`,
      ...emoFiles.map((e, k) => { const pre = `[${k + 1}:v]scale=420:420[em${k}]`; const ov = k === 0 ? `${pre};[b0][em${k}]overlay=620:200:enable='between(t,${e.a.toFixed(2)},${e.b.toFixed(2)})'[bx0]` : `${pre};[bx${k - 1}][em${k}]overlay=620:200:enable='between(t,${e.a.toFixed(2)},${e.b.toFixed(2)})'[bx${k}]`; return ov; }),
    ];
    const vis = path.join(dir, 'vis.mp4');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', base, ...emoFiles.flatMap(e => ['-i', e.f]), '-filter_complex', fcV.join(';'), '-map', vOut, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', vis], { timeout: 900000 });
    const mix = path.join(dir, 'mix.m4a');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', voiceFile, '-filter_complex', bed + ';' + kick + ';' + whoosh + mixIns + `amix=inputs=${3 + wlabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`, '-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), mix], { timeout: 300000 });
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', vis, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', out], { timeout: 300000 });
    const data = await fs.readFile(out);
    if (data.length > 60e6) throw new Error('The video came out too large to save on the free plan.');
    await VideoBlob.deleteMany({ jobId: job._id, kind: 'final' });
    for (let p = 0; p * 7e6 < data.length; p++) await VideoBlob.create({ jobId: job._id, kind: 'final', idx: p, data: data.subarray(p * 7e6, (p + 1) * 7e6) });
    try {
      const tf = path.join(dir, 'thumb.jpg');
      await run(ffmpegPath, ['-y', '-loglevel', 'error', '-ss', (total * 0.4).toFixed(1), '-i', out, '-frames:v', '1', '-q:v', '4', tf], { timeout: 60000 });
      await VideoBlob.deleteMany({ jobId: job._id, kind: 'thumb' }); await VideoBlob.create({ jobId: job._id, kind: 'thumb', idx: 0, data: await fs.readFile(tf) });
    } catch (e) { console.error('facts thumb', String(e.message).slice(0, 100)); }
    const srcNote = (meta.sources || []).length ? ` · sources: ${(meta.sources || []).slice(0, 4).join(', ')}` : '';
    job.bytes = data.length; job.status = 'done';
    job.note = `Facts Short (${okScenes.filter(s => s.badge).length} verified facts, ${(job.voiceVia || 'ai voice')}, images ${job.panelStats || ''}) · Twemoji CC-BY 4.0${srcNote}`;
    await job.save();
  } finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
