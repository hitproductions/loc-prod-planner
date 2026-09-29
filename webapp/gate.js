// A shared-password gate, for when the app is reachable from the internet.
//
// The app itself authenticates nobody — that is fine behind Cloudflare Access or on a
// LAN, and not fine on a public Cloud Run URL. This is the minimum that makes a public
// URL safe: one shared password, a signed cookie, everything else refused.
//
// It is deliberately NOT an identity system. Everyone shares one password, so it cannot
// tell you who did what, and it does not replace Access — it composes with it. Enable it
// by setting PLANNER_PASSWORD; leave that unset and the gate is off, which is what local
// runs and a LAN deployment want.
const crypto = require('crypto');

const COOKIE = 'planner_auth';
const MAX_AGE = 30 * 24 * 3600;          // 30 days

const sign = (secret, exp) =>
  crypto.createHmac('sha256', secret).update(`v1|${exp}`).digest('hex');

// Constant-time, and length-safe: timingSafeEqual throws on a length mismatch, which
// would itself leak length through a 500.
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function valid(cookieHeader, secret) {
  const m = /(?:^|;\s*)planner_auth=([^;]+)/.exec(cookieHeader || '');
  if (!m) return false;
  const [exp, mac] = decodeURIComponent(m[1]).split('.');
  if (!exp || !mac) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return same(mac, sign(secret, exp));
}

const PAGE = (msg) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loc Prod Planner</title>
<style>
 *{box-sizing:border-box;border-radius:0}
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
   background:#fff;color:#000;font:14px/1.5 "Avenir Next",Avenir,-apple-system,sans-serif}
 form{width:300px}
 h1{font-size:19px;letter-spacing:-.01em;margin:0 0 4px}
 p{color:#646667;margin:0 0 22px}
 input{width:100%;padding:10px;border:1px solid #D0D0CE;font:inherit;margin-bottom:10px}
 input:focus{outline:none;border-color:#000}
 button{width:100%;padding:10px;border:1px solid #000;background:#000;color:#fff;
   font:inherit;font-weight:700;cursor:pointer}
 .err{color:#EF4123;font-weight:700;margin-bottom:10px}
</style>
<form method="POST" action="/login">
  <h1>Loc Prod Planner</h1>
  <p>Internal — Hit Productions</p>
  ${msg ? `<div class="err">${msg}</div>` : ''}
  <input type="password" name="password" placeholder="Password" autofocus
         autocomplete="current-password">
  <button type="submit">Open</button>
</form>`;

// Returns true when the request may proceed. Otherwise it has already answered.
async function gate(req, res, url, readBody) {
  const secret = process.env.PLANNER_PASSWORD;
  if (!secret) return true;                        // gate disabled

  if (url.pathname === '/login' && req.method === 'POST') {
    let given = '';
    try {
      const raw = await readBody(req, true);
      given = new URLSearchParams(raw).get('password') || '';
    } catch (e) { given = ''; }

    if (!same(given, secret)) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE('Wrong password.')), false;
    }
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
    // Secure is set whenever the request arrived over HTTPS — Cloud Run terminates TLS
    // and says so in x-forwarded-proto. On plain http (a LAN box) it must be omitted or
    // the browser silently drops the cookie.
    const https = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.writeHead(302, {
      'set-cookie': `${COOKIE}=${encodeURIComponent(exp + '.' + sign(secret, exp))}` +
        `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}` + (https ? '; Secure' : ''),
      location: '/',
    });
    return res.end(), false;
  }

  if (valid(req.headers.cookie, secret)) return true;

  // Everything else, including /api/*, is refused. An API that answered without a cookie
  // would make the gate decorative.
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end('{"ok":false,"error":"Not signed in."}'), false;
  }
  res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
  return res.end(PAGE('')), false;
}

module.exports = { gate, sign, valid };
