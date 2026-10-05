'use strict';

const crypto = require('crypto');

const COOKIE = 'lokal_planner_sso';
const AUDIENCE = 'lokal-production-planner';
const MAX_TTL = 15 * 60;
const CLOCK_SKEW = 60;

function base64urlDecode(value) {
  const text = String(value || '');

  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    return null;
  }

  let base64 = text
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const remainder = base64.length % 4;

  if (remainder) {
    base64 += '='.repeat(4 - remainder);
  }

  try {
    return Buffer.from(base64, 'base64');
  } catch (e) {
    return null;
  }
}

function base64urlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));

  if (x.length !== y.length) {
    return false;
  }

  return crypto.timingSafeEqual(x, y);
}

function cookieValue(cookieHeader, name) {
  const escaped = name.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  const match = new RegExp(
    '(?:^|;\\s*)' + escaped + '=([^;]*)'
  ).exec(cookieHeader || '');

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return null;
  }
}

function verifyToken(token, secret, nowSeconds) {
  if (!token || !secret) {
    return null;
  }

  const parts = String(token).split('.');

  if (parts.length !== 2) {
    return null;
  }

  const encodedPayload = parts[0];
  const providedSignature = parts[1];

  const expectedSignature = base64urlEncode(
    crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest()
  );

  if (!same(providedSignature, expectedSignature)) {
    return null;
  }

  const decoded = base64urlDecode(encodedPayload);

  if (!decoded) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(decoded.toString('utf8'));
  } catch (e) {
    return null;
  }

  if (
    !payload ||
    payload.v !== 1 ||
    payload.aud !== AUDIENCE ||
    !Number.isInteger(payload.uid) ||
    payload.uid <= 0 ||
    typeof payload.login !== 'string' ||
    !payload.login ||
    typeof payload.nonce !== 'string' ||
    !payload.nonce ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp)
  ) {
    return null;
  }

  const now = Number.isInteger(nowSeconds)
    ? nowSeconds
    : Math.floor(Date.now() / 1000);

  if (payload.exp <= now) {
    return null;
  }

  if (payload.iat > now + CLOCK_SKEW) {
    return null;
  }

  if (payload.exp <= payload.iat) {
    return null;
  }

  if ((payload.exp - payload.iat) > MAX_TTL) {
    return null;
  }

  return payload;
}

function denyApi(res, loginUrl) {
  res.writeHead(401, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });

  res.end(JSON.stringify({
    ok: false,
    error: 'Production Planner session is missing or expired.',
    login_url: loginUrl,
  }));
}

function redirectToWordPress(res, loginUrl) {
  res.writeHead(302, {
    location: loginUrl,
    'cache-control': 'no-store',
  });

  res.end();
}

async function ssoGate(req, res, url) {
  const secret = process.env.PLANNER_SSO_SECRET;

  /*
   * SSO is opt-in so existing development and Docker deployments
   * remain unchanged when PLANNER_SSO_SECRET is absent.
   */
  if (!secret) {
    return true;
  }

  const loginUrl = process.env.PLANNER_SSO_LOGIN_URL;

  if (!loginUrl) {
    res.writeHead(503, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });

    res.end('Production Planner SSO is not configured.');

    return false;
  }

  const token = cookieValue(
    req.headers.cookie,
    COOKIE
  );

  const payload = verifyToken(
    token,
    secret
  );

  if (payload) {
    /*
     * Preserve the authenticated WordPress identity for future
     * auditing/logging work without trusting any browser-supplied
     * username headers.
     */
    req.plannerUser = payload;

    return true;
  }

  /*
   * API calls receive JSON rather than an HTML redirect.
   * The browser page itself is redirected through WordPress SSO.
   */
  if (url.pathname.startsWith('/api/')) {
    denyApi(res, loginUrl);
    return false;
  }

  redirectToWordPress(
    res,
    loginUrl
  );

  return false;
}

module.exports = {
  ssoGate,
  verifyToken,
  base64urlEncode,
};
