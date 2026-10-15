// AMV YouTube upload (optional, env-gated). OFF unless AMV_UPLOAD=1.
// Env: AMV_YT_TOKEN_JSON = {"client_id","client_secret","refresh_token"} (never logged, gitignored).
import { URLSearchParams } from 'node:url';

const cid = () => JSON.parse(process.env.AMV_YT_TOKEN_JSON || '{}');
async function accessToken() {
  const c = cid(); if (!c.refresh_token) throw new Error('AMV YouTube token not configured.');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); if (!j.access_token) throw new Error('YouTube token refresh failed.');
  return j.access_token;
}

export async function amvYoutubeUpload(data, job) {
  if (process.env.AMV_UPLOAD !== '1') return null;
  const tok = await accessToken();
  const title = `${job.topic} | ${job.subject || 'Anime'} AMV`.slice(0, 100);
  const description = `${job.topic} - ${job.subject || 'Anime'} AMV\n\nSong: ${job.topic}\nAnime: ${job.subject || ''}\n\nMade with Orbix AMV mode.\n#AMV #HindiSong #Anime`;
  const meta = { snippet: { title, description, tags: ['AMV', 'Hindi', 'Anime', 'Musime'], categoryId: '10' }, status: { privacyStatus: process.env.AMV_YT_PRIVACY || 'public', selfDeclaredMadeForKids: false } };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/*', 'X-Upload-Content-Length': String(data.length) }, body: JSON.stringify(meta), signal: AbortSignal.timeout(30000) });
  if (!init.ok) throw new Error(`upload init failed (${init.status})`);
  const loc = init.headers.get('location');
  const up = await fetch(loc, { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'video/*' }, body: data, signal: AbortSignal.timeout(600000) });
  if (!up.ok) throw new Error(`upload failed (${up.status})`);
  const j = await up.json();
  return `https://youtu.be/${j.id}`;
}
