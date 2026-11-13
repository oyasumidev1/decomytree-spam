// 用法：
//   chrome.exe --remote-debugging-port=9225 --user-data-dir=<全新目录>
//   node wish-batch.mjs --port 9225 --slug W73FkC --count 5 --text "圣诞快乐" --from "小明"
//
// 参数：--public 公开 | --ornament red-bauble | --gap 800 | --retry 3

import https from 'node:https';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  args[k] = v;
}

const PORT = args.port || '9225';
const SLUG = args.slug || 'W73FkC';
const COUNT = Number(args.count || 1);
const TEXT = args.text || '圣诞快乐！';
const FROM = typeof args.from === 'string' ? args.from : '';
const ORNAMENT = args.ornament || 'red-bauble';
const IS_PUBLIC = !!args.public;
const GAP = Number(args.gap || 800);
const RETRY = Number(args.retry || 3);
const SITE = 'decomytree.net';
const PID = '606f1m54';
const CDP = 'http://127.0.0.1:' + PORT;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(36)).join('').slice(0, n).padEnd(n, 'x');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const H = {
  'user-agent': UA,
  'content-type': 'application/json',
  'accept': '*/*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'origin': 'https://' + SITE,
  'referer': `https://${SITE}/zh-cn/t/${SLUG}/wish`,
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'sec-ch-ua': '"Chromium";v="157", "Google Chrome";v="157", "Not(A:Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      host: SITE, path, method, family: 4, servername: SITE,
      headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) }
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function newGuest() {
  const r = await request('POST', '/api/wish/guest', H, '{}');
  const cookies = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  return cookies;
}

async function sendWish(cookies, clientToken, token) {
  const body = JSON.stringify({
    slug: SLUG, client_token: clientToken, content: TEXT, from: FROM,
    anonymous: !FROM, public: IS_PUBLIC, ornament: ORNAMENT, turnstile_token: token
  });
  const r = await request('POST', '/api/wish/send', { ...H, cookie: cookies }, body);
  let j = null; try { j = JSON.parse(r.body); } catch {}
  return { status: r.status, code: j?.code, msg: j?.msg, err: j?.error, id: j?.data?.wish_id, raw: r.body.slice(0, 200) };
}

let ws, msgId = 0;
const pending = new Map();
async function connect() {
  const v = await (await fetch(CDP + '/json/version')).json();
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    }
  };
}
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const mid = ++msgId;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (S, expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, S);
  return r.result?.value;
};

async function harvestToken(timeoutSec = 25) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, S);
  await send('Runtime.enable', {}, S);
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__wt=[];addEventListener('message',e=>{try{window.__wt.push(e.data)}catch{}})`
  }, S);
  await send('Page.navigate', {
    url: `https://appbox.uk/turnstile?nonce=${crypto.randomUUID()}&pid=${PID}&theme=dark&background=%23173c34`
  }, S);

  try { await send('Page.bringToFront', {}, S); } catch {}
  try { await send('Emulation.setFocusEmulationEnabled', { enabled: true }, S); } catch {}
  try { await send('Page.setWebLifecycleState', { state: 'active' }, S); } catch {}

  for (let k = 0; k < 4; k++) {
    await sleep(150 + Math.random() * 250);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: 40 + Math.random() * 260, y: 40 + Math.random() * 160
    }, S).catch(() => {});
  }

  let token = null;
  for (let i = 0; i < timeoutSec; i++) {
    await sleep(1000);
    let arr = [];
    try { arr = JSON.parse(await evaluate(S, 'JSON.stringify(window.__wt||[])') || '[]'); } catch {}
    const hit = arr.find(d => d && d.type === 'turnstile:success' && d.token);
    if (hit) { token = hit.token; break; }
    if (arr.some(d => d && d.type === 'turnstile:error')) break;
  }
  await send('Target.closeTarget', { targetId });
  return token;
}

// ---------------- main ----------------
await connect();
const cookies = await newGuest();
console.log(`[init] guest=${cookies.slice(0, 22)}…  slug=${SLUG}  目标=${COUNT} 条`);

let ok = 0, fail = 0, tokenFail = 0;
const t0 = Date.now();
const records = [];

for (let i = 1; i <= COUNT; i++) {
  const token = await harvestToken();
  if (!token) {
    tokenFail++; fail++;
    console.log(`[${i}] token 采集失败 —— 该 profile 已被 Turnstile 静默挂起（只会重复 "food" 心跳）。换 --user-data-dir 重开 Chrome。`);
    continue;
  }
  const ct = 'WB' + rnd(22);
  const r = await sendWish(cookies, ct, token);
  const good = r.status === 201 || r.msg === 'sent' || r.msg === 'duplicate';
  if (good) ok++; else fail++;
  console.log(`[${i}] ${r.status} ${r.err || r.msg} ${r.id || ''}`);
  records.push({ i, status: r.status, err: r.err, msg: r.msg, id: r.id });
  await sleep(GAP);
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n[done] 成功 ${ok} / 失败 ${fail}（token 失败 ${tokenFail}）, 用时 ${secs}s, 吞吐 ≈ ${(ok / (secs / 60)).toFixed(1)} 条/分钟`);
process.exit(ok > 0 ? 0 : 1);
