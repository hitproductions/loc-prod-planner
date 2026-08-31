// Service-account auth for the Sheets API. No dependencies: Node signs the JWT with
// its own crypto, and fetch is built in.
//
// The flow is: sign a short-lived assertion with the service account's private key,
// swap it at Google's token endpoint for an access token, reuse that token until it
// is nearly expired. Nothing here ever logs or returns the private key.
const crypto = require('crypto');
const fs = require('fs');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function loadKey(keyPath) {
  const p = keyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!p) {
    throw new Error('No service-account key. Set GOOGLE_APPLICATION_CREDENTIALS to the ' +
      'path of the downloaded JSON key.');
  }
  if (!fs.existsSync(p)) throw new Error(`Service-account key not found at ${p}`);
  let key;
  try { key = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`${p} is not valid JSON — is it the key file Google gave you?`); }
  if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
    throw new Error(`${p} does not look like a service-account key (needs type, ` +
      'client_email and private_key). An OAuth client secret is a different file.');
  }
  return key;
}

function createAuth(keyPath, scope) {
  const key = loadKey(keyPath);
  const scopes = scope || 'https://www.googleapis.com/auth/spreadsheets';
  let token = null, expiresAt = 0;

  async function accessToken() {
    // 60s of slack, so a token never expires mid-request.
    if (token && Date.now() < expiresAt - 60000) return token;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({
      iss: key.client_email, scope: scopes, aud: TOKEN_URL,
      iat: now, exp: now + 3600,
    }));
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const jwt = `${header}.${claim}.${b64url(signer.sign(key.private_key))}`;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Google refused the service account (${res.status} ${body.error || ''}` +
        `${body.error_description ? ': ' + body.error_description : ''}). ` +
        'Usually this means the Sheets API is not enabled on the project.');
    }
    token = body.access_token;
    expiresAt = Date.now() + (body.expires_in || 3600) * 1000;
    return token;
  }

  // Every Sheets call goes through here so auth, errors and retries live in one place.
  async function api(path, init) {
    const t = await accessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
      ...init,
      headers: { ...(init && init.headers), authorization: `Bearer ${t}`,
                 'content-type': 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body.error && body.error.message) || res.statusText;
      if (res.status === 403) {
        throw new Error(`Google said no (403): ${msg}\n` +
          `  → share the spreadsheet with ${key.client_email} as an Editor.`);
      }
      if (res.status === 404) {
        throw new Error(`Spreadsheet not found (404): ${msg}\n` +
          '  → check PLANNER_SHEET_ID is the long id from the sheet URL.');
      }
      // The status is attached, not just spelled into the message, so a caller can
      // branch on it without matching English. readEvents needs exactly this to tell
      // "that tab does not exist yet" from a real failure.
      const err = new Error(`Sheets API ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return { email: key.client_email, projectId: key.project_id, accessToken, api };
}

module.exports = { createAuth, loadKey };
