// Sign in with Google, for when the app is reachable from the internet.
//
// Replaces the shared password (gate.js) wherever it is configured: everyone signs in with their
// own Google account, so the app knows WHO is using it and History can say who changed what.
//
// Who may come in: any account at PLANNER_GOOGLE_DOMAIN (default hitproductions.net), plus any
// address listed in PLANNER_GOOGLE_ALLOW. Google's own answer is checked, not the browser's.
//
// Off unless PLANNER_GOOGLE_CLIENT_ID is set, so local runs and a LAN box are unaffected. Set
// it without the client secret and the app refuses everything rather than falling open.
//
// No dependencies: the authorisation-code flow is three redirects and one HTTPS call.
const crypto = require('crypto');
const https = require('https');

const SESSION = 'planner_google';
const STATE = 'planner_oauth';
const MAX_AGE = 7 * 24 * 3600;            // a week; a Workspace sign-in again is one click
const STATE_AGE = 10 * 60;

const cfg = () => ({
  id: process.env.PLANNER_GOOGLE_CLIENT_ID || '',
  secret: process.env.PLANNER_GOOGLE_CLIENT_SECRET || '',
  domain: String(process.env.PLANNER_GOOGLE_DOMAIN || 'hitproductions.net').trim().toLowerCase(),
  allow: String(process.env.PLANNER_GOOGLE_ALLOW || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  base: String(process.env.PLANNER_PUBLIC_URL || '').replace(/\/+$/, ''),
});
const enabled = () => !!process.env.PLANNER_GOOGLE_CLIENT_ID;

// Signed with a key derived from the client secret, so there is nothing else to configure.
// Rotating the secret signs everyone out, which is the right behaviour for a rotation.
const key = c => crypto.createHmac('sha256', c.secret).update('planner-session-v1').digest();
const b64 = buf => Buffer.from(buf).toString('base64url');
const mac = (c, body) => b64(crypto.createHmac('sha256', key(c)).update(body).digest());

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookie(header, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(header || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return null; }
}

function makeSession(c, user, now) {
  const body = b64(JSON.stringify({ e: user.email, n: user.name || '',
    exp: (now || Math.floor(Date.now() / 1000)) + MAX_AGE }));
  return body + '.' + mac(c, body);
}

// The signed-in person, or null. Checked against the CURRENT allow rules, so removing an address
// from the list (or changing the domain) takes effect on the next request, not in a week.
function readSession(header, c, now) {
  const raw = cookie(header, SESSION);
  if (!raw || !c.secret) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig || !same(sig, mac(c, body))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || typeof p.e !== 'string' || !Number.isInteger(p.exp)) return null;
  if (p.exp <= (now || Math.floor(Date.now() / 1000))) return null;
  if (!allowed(c, { email: p.e, hd: c.domain, verified: true })) return null;
  return { email: p.e, name: String(p.n || '') };
}

// The rule. `hd` is the Workspace domain Google vouches for; a look-alike address typed into a
// personal account has no hd, so the domain alone is not trusted from the email text.
function allowed(c, who) {
  const email = String(who.email || '').toLowerCase();
  if (!who.verified || !/^[^@\s]+@[^@\s]+$/.test(email)) return false;
  if (c.allow.includes(email)) return true;
  return !!c.domain && email.endsWith('@' + c.domain) && String(who.hd || '').toLowerCase() === c.domain;
}

// What Google sent back in the id_token. It arrived straight from Google over TLS in answer to
// our own request, so the signature need not be re-checked (OpenID Connect core, 3.1.3.7);
// who it is FOR, who issued it and when it expires are.
function readIdToken(token, c, now) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  let p;
  try { p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || p.aud !== c.id) return null;
  if (p.iss !== 'https://accounts.google.com' && p.iss !== 'accounts.google.com') return null;
  if (!Number.isInteger(p.exp) || p.exp <= (now || Math.floor(Date.now() / 1000))) return null;
  // Lower-cased once, here, so the cookie, the allow rule and History's "by" all agree.
  return { email: String(p.email || '').trim().toLowerCase(), name: p.name || '', hd: p.hd || '',
           verified: p.email_verified === true || p.email_verified === 'true' };
}

// One HTTPS call: trade the one-time code for the id_token. Injectable for tests.
function exchangeCode(c, code, redirect) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({ code, client_id: c.id, client_secret: c.secret,
      redirect_uri: redirect, grant_type: 'authorization_code' }).toString();
    const req = https.request('https://oauth2.googleapis.com/token', { method: 'POST', timeout: 10000,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } },
      res => {
        const parts = [];
        res.on('data', d => parts.push(d));
        res.on('end', () => {
          try { const j = JSON.parse(Buffer.concat(parts).toString('utf8'));
                res.statusCode === 200 && j.id_token ? resolve(j.id_token) : reject(new Error('Google refused the code')); }
          catch (e) { reject(new Error('Google answered with something unreadable')); }
        });
      });
    req.on('timeout', () => req.destroy(new Error('Google did not answer')));
    req.on('error', reject);
    req.end(data);
  });
}

const https_ = req => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const origin = (req, c) => c.base ||
  `${https_(req) ? 'https' : 'http'}://${(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()}`;

const cookieOut = (req, name, value, age) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}` + (https_(req) ? '; Secure' : '');

const PAGE = (msg, c, retry) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loc Prod Planner</title>
<style>
 *{box-sizing:border-box;border-radius:0}
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
   background:#fff;color:#000;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
 main{width:300px}
 h1{font-size:19px;letter-spacing:-.01em;margin:0 0 4px}
 p{color:#646667;margin:0 0 22px}
 a.btn{display:block;width:100%;padding:10px;border:1px solid #000;background:#000;color:#fff;
   font:inherit;font-weight:700;text-align:center;text-decoration:none}
 .err{color:#EF4123;font-weight:700;margin-bottom:14px}
</style>
<main>
  <h1>Loc Prod Planner</h1>
  <p>Internal — Hit Productions</p>
  ${msg ? `<div class="err">${msg}</div>` : ''}
  <a class="btn" href="/auth/google">${retry ? 'Try another account' : 'Sign in with Google'}</a>
</main>`;

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
  return false;
}

// Returns true when the request may proceed (and sets req.googleUser). Otherwise it has
// already answered.
// `hooks.exchange` is the one call out to Google; the tests replace it.
const hooks = { exchange: exchangeCode };

async function googleGate(req, res, url) {
  if (!enabled()) return true;
  const c = cfg();
  if (!c.secret) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end('Google sign-in is not configured.'), false;
  }
  const redirect = origin(req, c) + '/auth/google/callback';

  if (url.pathname === '/auth/google' && req.method === 'GET') {
    const state = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirect, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account', ...(c.domain ? { hd: c.domain } : {}) });
    res.writeHead(302, { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q,
      'set-cookie': cookieOut(req, STATE, state, STATE_AGE), 'cache-control': 'no-store' });
    return res.end(), false;
  }

  if (url.pathname === '/auth/google/callback' && req.method === 'GET') {
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
    const mine = cookie(req.headers.cookie, STATE) || '';
    const clear = cookieOut(req, STATE, '', 0);
    if (!state || !mine || !same(state, mine) || !code)
      return res.setHeader('set-cookie', clear), html(res, 400, PAGE('That sign-in did not complete. Please try again.', c));
    let who;
    try { who = readIdToken(await hooks.exchange(c, code, redirect), c); }
    catch (e) { who = null; }
    if (!who) return res.setHeader('set-cookie', clear), html(res, 401, PAGE('Google did not confirm that sign-in. Please try again.', c));
    if (!allowed(c, who)) {
      console.log('sign-in refused for ' + who.email);
      return res.setHeader('set-cookie', clear), html(res, 403,
        PAGE(`${String(who.email).replace(/[<>&"]/g, '')} cannot use this. Sign in with your @${c.domain} account.`, c, true));
    }
    res.writeHead(302, { location: '/', 'cache-control': 'no-store',
      'set-cookie': [clear, cookieOut(req, SESSION, makeSession(c, who), MAX_AGE)] });
    return res.end(), false;
  }

  if (url.pathname === '/auth/logout') {
    res.writeHead(302, { location: '/', 'cache-control': 'no-store',
      'set-cookie': cookieOut(req, SESSION, '', 0) });
    return res.end(), false;
  }

  const user = readSession(req.headers.cookie, c);
  if (user) { req.googleUser = user; return true; }

  // Everything else, including /api/*, is refused. An API that answered without a session
  // would make the gate decorative.
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end('{"ok":false,"error":"Not signed in."}'), false;
  }
  return html(res, 401, PAGE('', c));
}

// A change must come from this site, as JSON. The session cookie is SameSite=Lax, which
// already stops another site posting with it; this refuses what slips past anyway.
function writeCheck(req, res) {
  if (!enabled()) return true;
  const deny = (status, msg) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: false, error: msg })), false;
  };
  if (!req.googleUser) return deny(401, 'Not signed in.');
  const o = req.headers.origin;
  if (o) {
    let host = '';
    try { host = new URL(o).host; } catch (e) { host = ''; }
    const want = cfg().base ? new URL(cfg().base).host
      : String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host !== want) return deny(403, 'Request origin not allowed.');
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return deny(415, 'JSON content type required.');
  return true;
}

module.exports = { googleGate, writeCheck, enabled, allowed, readSession, readIdToken, makeSession,
                   cfg, hooks, SESSION, STATE };
