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

// Google's own "G", as their sign-in branding asks for.
const G_MARK = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

// The only page the public ever sees. The artwork is by Hit's own artist (Tara, 2026-10-29),
// framed as a camera viewfinder: they are being recorded. The picture is still; only the
// video noise moves (grain, a rolling band, a faint flicker), and it stops for reduced motion.
const PAGE = (msg, c, retry) => `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loc Prod Planner</title>
<style>
 @font-face{font-family:"Inter";font-weight:400;font-display:swap;src:url("/fonts/Inter-Regular.woff2") format("woff2")}
 @font-face{font-family:"Inter";font-weight:700;font-display:swap;src:url("/fonts/Inter-Bold.woff2") format("woff2")}
 :root{--red:#EF4123;--ink:#000;--grey:#646667;--paper:#fff;--vf:rgba(255,255,255,.92)}
 *{box-sizing:border-box;border-radius:0}
 html,body{height:100%}
 body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
   display:grid;grid-template-columns:minmax(0,1.35fr) minmax(340px,1fr);min-height:100vh}
 .art{position:relative;overflow:hidden;background:var(--ink)}
 .art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:64% 40%;display:block}
 /* The viewfinder. Darkened edges and scan lines, video noise over them, then the camera's
    own readouts. */
 .art::before{content:"";position:absolute;inset:0;z-index:1;
   background:radial-gradient(ellipse at 50% 45%,transparent 55%,rgba(0,0,0,.45) 100%),
              repeating-linear-gradient(to bottom,rgba(0,0,0,.08) 0 1px,transparent 1px 3px);
   animation:flicker 4s steps(1) infinite}
 .grain{position:absolute;inset:-50%;z-index:1;opacity:.16;pointer-events:none;
   background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
   animation:grain .6s steps(6) infinite}
 .roll{position:absolute;left:0;right:0;top:0;height:22%;z-index:1;pointer-events:none;
   background:linear-gradient(to bottom,transparent,rgba(255,255,255,.07) 45%,rgba(255,255,255,.1) 50%,transparent);
   animation:roll 6.5s linear infinite}
 @keyframes grain{0%{transform:translate(0,0)}17%{transform:translate(-6%,4%)}33%{transform:translate(5%,-7%)}
   50%{transform:translate(-3%,8%)}67%{transform:translate(7%,2%)}83%{transform:translate(-8%,-4%)}100%{transform:translate(2%,6%)}}
 @keyframes roll{from{transform:translateY(-100%)}to{transform:translateY(560%)}}
 @keyframes flicker{0%,100%{opacity:1}31%{opacity:.82}33%{opacity:1}72%{opacity:.9}73%{opacity:1}}
 .vf{position:absolute;inset:20px;z-index:2;color:var(--vf);
   font:700 12px/1 "SF Mono",Menlo,Consolas,monospace;letter-spacing:.06em;text-shadow:0 1px 2px rgba(0,0,0,.6)}
 .cn{position:absolute;width:34px;height:34px;border:0 solid var(--vf)}
 .cn.tl{top:0;left:0;border-width:2px 0 0 2px} .cn.tr{top:0;right:0;border-width:2px 2px 0 0}
 .cn.bl{bottom:0;left:0;border-width:0 0 2px 2px} .cn.br{bottom:0;right:0;border-width:0 2px 2px 0}
 .top,.bot{position:absolute;left:48px;right:48px;display:flex;justify-content:space-between;align-items:center;gap:16px}
 .top{top:10px} .bot{bottom:10px;align-items:flex-end}
 .rec{display:flex;align-items:center;gap:8px}
 .rec i{width:11px;height:11px;border-radius:50% !important;background:var(--red);box-shadow:0 0 0 2px rgba(239,65,35,.3)}
 .rec b{color:#fff}
 .grp{display:flex;align-items:center;gap:14px}
 .bat{position:relative;width:26px;height:12px;border:2px solid var(--vf);padding:1px}
 .bat::after{content:"";position:absolute;right:-5px;top:2px;width:3px;height:4px;background:var(--vf)}
 .bat span{display:block;height:100%;width:72%;background:var(--vf)}
 .focus{position:absolute;left:50%;top:53%;width:92px;height:92px;transform:translate(-50%,-50%)}
 .focus::before,.focus::after{content:"";position:absolute;background:var(--vf)}
 .focus::before{left:50%;top:50%;width:14px;height:2px;transform:translate(-50%,-50%)}
 .focus::after{left:50%;top:50%;width:2px;height:14px;transform:translate(-50%,-50%)}
 .focus i{position:absolute;width:14px;height:14px;border:0 solid var(--vf)}
 .focus i:nth-child(1){top:0;left:0;border-width:2px 0 0 2px} .focus i:nth-child(2){top:0;right:0;border-width:2px 2px 0 0}
 .focus i:nth-child(3){bottom:0;left:0;border-width:0 0 2px 2px} .focus i:nth-child(4){bottom:0;right:0;border-width:0 2px 2px 0}
 /* Audio levels: it is a sound studio. */
 .lv{display:grid;grid-template-columns:auto 1fr;gap:5px 8px;align-items:center;width:min(220px,40%)}
 .lv .m{height:7px;background:linear-gradient(to right,#3CB371 0 62%,#FFC000 62% 82%,var(--red) 82% 100%);
   -webkit-mask:linear-gradient(to right,#000 var(--l),rgba(0,0,0,.18) var(--l));mask:linear-gradient(to right,#000 var(--l),rgba(0,0,0,.18) var(--l))}
 main{display:flex;flex-direction:column;justify-content:center;padding:56px clamp(28px,6vw,80px)}
 .logo{height:34px;width:auto;align-self:flex-start;margin-bottom:56px}
 h1{font-size:34px;line-height:1.1;letter-spacing:-.02em;margin:0 0 10px}
 p{color:var(--grey);margin:0 0 32px;max-width:30ch}
 .err{color:var(--red);font-weight:700;margin:0 0 18px;max-width:34ch}
 a.btn{display:flex;align-items:center;gap:14px;width:100%;max-width:340px;padding:6px 18px 6px 6px;
   background:var(--ink);color:#fff;font-weight:700;text-decoration:none;border:1px solid var(--ink)}
 a.btn .g{display:grid;place-items:center;width:40px;height:40px;background:#fff}
 a.btn svg{width:20px;height:20px}
 a.btn:hover{background:var(--red);border-color:var(--red)}
 a.btn:focus-visible{outline:3px solid var(--red);outline-offset:3px}
 small{display:block;color:var(--grey);margin-top:16px;font-size:13px}
 footer{margin-top:auto;padding-top:56px;color:var(--grey);font-size:12px}
 @media (max-width:820px){
   body{grid-template-columns:1fr;grid-template-rows:auto 1fr}
   .art{height:46vh;min-height:260px}
   .vf{inset:12px;font-size:10px}
   .cn{width:22px;height:22px}
   .top,.bot{left:30px;right:30px}
   .focus{width:64px;height:64px}
   .hide-s{display:none}
   main{padding:32px 16px 24px}
   .logo{height:28px;margin-bottom:28px}
   h1{font-size:28px}
   footer{padding-top:32px}
 }
 @media (prefers-reduced-motion:reduce){ .art::before,.grain,.roll{animation:none} .roll{display:none} }
</style>
<body>
<div class="art" aria-hidden="true">
  <img src="/login/trio.webp" alt="" width="900" height="649">
  <div class="grain"></div><div class="roll"></div>
  <div class="vf">
    <span class="cn tl"></span><span class="cn tr"></span><span class="cn bl"></span><span class="cn br"></span>
    <div class="top">
      <span class="rec"><i></i><b>REC</b>&nbsp;00:42:17:08</span>
      <span class="grp"><span class="hide-s">4K&nbsp;24P</span><span class="bat"><span></span></span></span>
    </div>
    <div class="focus"><i></i><i></i><i></i><i></i></div>
    <div class="bot">
      <div class="lv"><span>L</span><span class="m" style="--l:71%"></span><span>R</span><span class="m" style="--l:64%"></span></div>
      <span class="hide-s">F2.8&nbsp;&nbsp;1/50&nbsp;&nbsp;ISO&nbsp;800</span>
    </div>
  </div>
</div>
<main>
  <img class="logo" src="/login/hit-logo.svg" alt="Hit Productions" width="232" height="31">
  <h1>Loc Prod Planner</h1>
  <p>Sign in to see who’s booked, and what’s next.</p>
  ${msg ? `<div class="err" role="alert">${msg}</div>` : ''}
  <a class="btn" href="/auth/google"><span class="g">${G_MARK}</span>${retry ? 'Try another account' : 'Sign in with Google'}</a>
  <small>Use your @${c.domain} account.</small>
  <footer>Hit Productions · Internal</footer>
</main>
</body></html>`;

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

  // The sign-in page's own artwork and font are public; nothing else is.
  if (req.method === 'GET' && (/^\/login\/[\w.-]+\.(svg|webp)$/.test(url.pathname) ||
                               /^\/fonts\/Inter-(Regular|Bold)\.woff2$/.test(url.pathname))) return true;

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
