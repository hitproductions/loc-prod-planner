'use strict';

const crypto = require('crypto');

const EXPECTED_ORIGIN = 'https://lokal.hitpromanila.net';

function makeCsrfToken(user, secret) {
  if (
    !secret ||
    !user ||
    !Number.isSafeInteger(user.uid) ||
    !Number.isSafeInteger(user.exp) ||
    typeof user.nonce !== 'string' ||
    !user.nonce
  ) {
    return '';
  }

  const context = [
    'lokal-planner-csrf-v1',
    user.uid,
    user.nonce,
    user.exp
  ].join('\0');

  return crypto
    .createHmac('sha256', secret)
    .update(context)
    .digest('base64url');
}

function reject(res, status, message) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });

  res.end(JSON.stringify({
    ok: false,
    error: message
  }));

  return false;
}

function writeGate(req, res) {
  const secret = process.env.PLANNER_SSO_SECRET;

  // Standalone development mode remains supported.
  // Production with required SSO must fail closed.
  if (!secret) {
    if (process.env.PLANNER_REQUIRE_SSO === '1') {
      return reject(res, 503, 'Planner authentication unavailable.');
    }

    return true;
  }

  if (!req.plannerUser) {
    return reject(res, 401, 'Authentication required.');
  }

  // Reject missing, foreign and sibling-subdomain origins.
  if (req.headers.origin !== EXPECTED_ORIGIN) {
    return reject(res, 403, 'Request origin not allowed.');
  }

  const contentType = req.headers['content-type'];

  const mimeType = typeof contentType === 'string'
    ? contentType.split(';')[0].trim().toLowerCase()
    : '';

  if (mimeType !== 'application/json') {
    return reject(res, 415, 'JSON content type required.');
  }

  const supplied = req.headers['x-planner-csrf'];

  const expected = makeCsrfToken(
    req.plannerUser,
    secret
  );

  if (
    !expected ||
    typeof supplied !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(supplied)
  ) {
    return reject(res, 403, 'Invalid CSRF token.');
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return reject(res, 403, 'Invalid CSRF token.');
  }

  return true;
}

module.exports = {
  makeCsrfToken,
  writeGate
};
