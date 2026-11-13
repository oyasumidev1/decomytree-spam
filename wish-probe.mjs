// Probe a tree's writability without writing anything.
// Order observed server-side: tree lookup -> captcha verify -> season/accept checks,
// so a dummy token still tells us whether the slug resolves and is writable.
import https from 'node:https';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const SLUGS = process.argv.slice(2);
const SITE = 'decomytree.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(36)).join('').slice(0, n).padEnd(n, 'x');

function req(method, path, headers, body) {
  return new Promise((res, rej) => {
    const r = https.request({ host: SITE, path, method, family: 4, servername: SITE,
      headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, resp => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, body: d }));
    });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

const H = {
  'user-agent': UA, 'content-type': 'application/json', 'accept': '*/*',
  'accept-language': 'zh-CN,zh;q=0.9', 'origin': 'https://' + SITE,
  'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty'
};

const guestRes = await req('POST', '/api/wish/guest', H, '{}');
const cookies = (guestRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

for (const slug of SLUGS) {
  const body = JSON.stringify({ slug, client_token: 'PB' + rnd(22), content: 'probe',
    from: '', anonymous: false, public: false, ornament: 'red-bauble', turnstile_token: 'XXXX.DUMMY' });
  const r = await req('POST', '/api/wish/send', { ...H, referer: `https://${SITE}/zh-cn/t/${slug}/wish`, cookie: cookies }, body);
  let j = {}; try { j = JSON.parse(r.body); } catch {}
  const verdict = j.error === 'captcha_failed' ? 'Writable (slug ok, needs real token)'
    : j.error === 'tree_not_found' ? 'No such tree'
    : j.error === 'not_accepting' ? 'Tree closed for wishes'
    : j.error === 'season_closed' ? 'Season closed'
    : j.error === 'own_tree' ? 'Guest cannot own a tree'
    : j.error || j.msg || '?';
  console.log(`${slug.padEnd(10)} ${r.status}  ${String(j.error || j.msg).padEnd(18)} ${verdict}`);
}
