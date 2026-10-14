# Unified Pipelines in Orbix (user ask 2026-10-14: "Orbix m piple jod de. Sare")

One entry: prompt (story) ya song + prompt -> finished video. Orbix (Node, Render, Mongo) is the control plane; heavy free providers do the muscle. Free tools only. No stock footage (his locked rule).

## The four pipelines and where each stage runs

### 1. Story Shorts (Teesri Dastak / Aarav pipeline) -> new mode `story`
Proven: Part 1 FINAL + Part 2 (in production). Stages:
- SCRIPT: Groq LLM -> scene list (locked-word Hindi VO per scene)
- PANELS: AI Horde img2img (Juggernaut XL, 768x768, face-reference image) - FREE, high quota, pure HTTPS from Node. NEW provider `horde` in media.js.
- VOICE: Gemini TTS (multi-voice cast: narrator/creature/etc.) -> chain: ElevenLabs -> edge-neural (existing) -> google-voice (existing). NEW provider `geminiTTS`.
- ASSEMBLE: ffmpeg-static: zoompan motion + Devanagari drawtext subs (bundle NotoSansDevanagari-Bold.ttf in assets/) + procedural SFX (bundle generated wavs) + 1.25x tempo + intro/outro cards. All CPU-light, fits 512MB.
- OUTPUT: 1080x1920 Short mp4 + optional YouTube upload.

### 2. AMV (Musime pipeline) -> new mode `amv`
Proven: 4 live AMVs (latest Finding Her x Suzume). Stages:
- SONG: file upload via dashboard (primary) or URL fetch (yt-dlp; Render IPs often YT-blocked, so upload is the reliable path).
- TIMING: transcribeSong (Groq Whisper, EXISTS) upgraded to word-level verbose_json -> locked lyric TSV.
- ANIME: registry of free HTTP sources (archive.org Hindi dubs). ffmpeg reads REMOTE URLs with range requests (-ss before -i on URL) - no 1.5GB download onto Render's ephemeral disk. Clip registry prevents repeats across AMVs (stored in Mongo).
- BUILD: per-cut slice encode 1920x1080 lanczos + concat (gapless == song length).
- MIX: word-by-word Devanagari drawtext reveal + dialogue duck (song 0.30, movie dialogue 1.8 overlay) + fades. VERIFY: ffmpeg-static has freetype+fribidi for Devanagari - test on Render before claiming.
- THUMB: emotional frame + Devanagari title + channel logo (PIL-equivalent in node: sharp or jimp; else ffmpeg drawtext on frame).
- UPLOAD: YouTube Data API resumable (Musime OAuth refresh token in env, gitignored).

### 3. Long Film (Aarav FULL / haveli) -> existing `long` mode, upgraded
Already works (haveli 10:27 film). Upgrades from proven work: 1.25x narration tempo, procedural SFX layer, Gemini TTS cast voices, per-scene ambience.

### 4. KM puppet animation -> NOT portable to Render free (honest note)
Blender needs >512MB RAM + long CPU renders; cannot run on Render free tier. Stays sandbox-side for now. Later option: 2D layer-puppet approximation via ffmpeg transforms (lower quality) - only if user asks after seeing this note.

## New shared modules (server/)
- pipelines/story.js, pipelines/amv.js, pipelines/long.js (thin orchestrators over queue)
- pipelines/common.js: job state in Mongo (existing VideoJob extended: `pipeline` field), stage progress %, ETA, blob storage (existing storage.js/HF)
- assets/fonts/NotoSansDevanagari-Bold.ttf, assets/sfx/*.wav, assets/brand/intro.mp4,outro.mp4
- Dashboard: "Pipelines" tab -> pick pipeline, prompt/song input, live %, download + upload buttons.

## Env additions (Render dashboard, not in git)
HORDE_KEY (optional; anon works), GEMINI_API_KEY (exists), GROQ_API_KEY (exists), YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN (Musime), YT_CHANNEL_EXPECT (guard: verify channels?mine=true before every upload).

## Verification ladder (his rule: "verified" only after real tests)
1. Unit: horde + geminiTTS provider smoke tests on Render (/api/health/providers).
2. Story mode: 4-scene test Short -> visual QC.
3. AMV mode: 30-sec song slice test -> lyric render + duck check.
4. Full: one real Short + one real AMV end-to-end.

## ETA
Phase 1 story mode: ~1 day. Phase 2 amv mode: ~1 day. Phase 3 long-mode upgrades + dashboard polish: ~half day. KM note delivered with Phase 1.
