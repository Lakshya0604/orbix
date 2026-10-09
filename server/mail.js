export async function sendMail({ to, subject, html }) {
  const key = process.env.BREVO_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) { console.warn('Mail not configured; skipped'); return false; }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'Orbix', email: from }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!r.ok) console.warn('Brevo send failed', r.status);
  return r.ok;
}
