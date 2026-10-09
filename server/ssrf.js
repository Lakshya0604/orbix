import dns from 'node:dns/promises';
import net from 'node:net';
const priv = ip => {
  if (net.isIPv6(ip)) return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80') || ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:192.168.');
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};
export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a valid URL.'); }
  if (u.protocol !== 'https:' && !(process.env.ALLOW_HTTP === '1' && u.protocol === 'http:')) throw new Error('Only https:// MCP servers can be added.');
  if (u.username || u.password) throw new Error('Do not put credentials in the URL. Use the key field instead.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private addresses are not allowed.');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(r => r.address);
  if (!ips.length || ips.some(priv)) throw new Error('Private addresses are not allowed.');
  return u;
}
