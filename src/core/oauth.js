// Stateless Microsoft sign-in calls for Teams personal (teams.live.com).
// Runs on Node 18+ and Cloudflare Workers (fetch + Web APIs only).
//
// Flow (mirrors the open-source purple-teams "personal" build):
//   1. POST login.microsoftonline.com/common/oauth2/devicecode  -> user enters code at microsoft.com/devicelogin
//   2. Poll /common/oauth2/token until approved                 -> refresh token
//   3. Refresh at /consumers/oauth2/v2.0/token for the MBI_SSL skype scope
//   4. POST teams.live.com/api/auth/v1.0/authz/consumer (Bearer) -> skypetoken + region

export const CLIENT_ID = '8ec6bc83-69c8-4392-8f08-b3c986009232'; // Teams personal client
const RESOURCE = 'https://api.spaces.skype.com';
const SKYPE_SCOPE = 'service::api.fl.spaces.skype.com::MBI_SSL openid profile offline_access';
const GRAPH_SCOPE = 'https://graph.microsoft.com/Files.ReadWrite';
const AUTHZ_URL = 'https://teams.live.com/api/auth/v1.0/authz/consumer';
const LOGIN_HOST = 'https://login.microsoftonline.com';
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

async function postForm(url, params, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      ...extraHeaders,
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: 'non_json', error_description: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, json };
}

// Some Teams client IDs are registered as SPAs and need an Origin header (AADSTS9002327).
async function postToken(url, params) {
  let r = await postForm(url, params);
  if (!r.ok && /AADSTS9002327/.test(r.json.error_description || '')) {
    r = await postForm(url, params, { Origin: 'https://teams.live.com' });
  }
  return r;
}

function describe(json) {
  return `${json.error || 'error'}: ${(json.error_description || '').split('\r\n')[0]}`;
}

/** Step 1: ask Microsoft for a device code the user approves at microsoft.com/devicelogin. */
export async function requestDeviceCode() {
  const r = await postForm(`${LOGIN_HOST}/common/oauth2/devicecode`, { client_id: CLIENT_ID, resource: RESOURCE });
  if (!r.ok || !r.json.device_code) throw new Error(`Device code request failed (${r.status}) ${describe(r.json)}`);
  const { device_code, user_code, verification_url, verification_uri, interval = 5, expires_in = 900 } = r.json;
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUrl: verification_url || verification_uri || 'https://microsoft.com/devicelogin',
    interval: Number(interval),
    expiresAt: Date.now() + Number(expires_in) * 1000,
  };
}

/**
 * Step 2: check once whether the user approved the device code.
 * Returns { status: 'pending' | 'slow_down' | 'approved', refreshToken? }; throws on a final error.
 */
export async function pollDeviceCode(deviceCode) {
  const p = await postToken(`${LOGIN_HOST}/common/oauth2/token`, {
    client_id: CLIENT_ID,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    code: deviceCode,
  });
  if (p.ok && p.json.refresh_token) return { status: 'approved', refreshToken: p.json.refresh_token };
  if (p.json.error === 'authorization_pending') return { status: 'pending' };
  if (p.json.error === 'slow_down') return { status: 'slow_down' };
  throw new Error(`Sign-in failed: ${describe(p.json)}`);
}

/**
 * Steps 3-4: exchange a refresh token for a Teams skypetoken.
 * Returns { token, expiresAt, region, refreshToken } where refreshToken is the rotated one (if any).
 */
export async function exchangeForSkypeToken(refreshToken) {
  const r = await postToken(`${LOGIN_HOST}/consumers/oauth2/v2.0/token`, {
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SKYPE_SCOPE,
  });
  if (!r.ok || !r.json.access_token) {
    const err = new Error(`Token refresh failed (${r.status}) ${describe(r.json)}. Sign in again.`);
    err.authExpired = r.json.error === 'invalid_grant';
    throw err;
  }

  const a = await fetch(AUTHZ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${r.json.access_token}`,
      Accept: 'application/json; ver=1.0',
      'User-Agent': USER_AGENT,
      Origin: 'https://teams.live.com',
    },
  });
  const text = await a.text();
  if (!a.ok) throw new Error(`Teams authz failed (${a.status}): ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  const st = body.tokens?.skypeToken ?? body.skypeToken;
  const token = typeof st === 'string' ? st : st?.skypetoken;
  const expiresIn = Number(body.tokens?.expiresIn ?? st?.expiresIn ?? body.expiresIn ?? 3600);
  if (!token) throw new Error('Teams authz response did not contain a skypetoken.');

  return {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
    region: body.region ?? null,
    refreshToken: r.json.refresh_token || refreshToken,
  };
}

/**
 * A Microsoft Graph token for reading files shared in chats (they live in the sender's OneDrive).
 * Microsoft pre-authorises the Teams personal client for Files.ReadWrite only (Files.Read alone is refused),
 * so the token is broader than reading needs: the tools only ever use it for files posted in the user's chats.
 * Returns { token, expiresAt }. The refresh token is not rotated here (the skypetoken refresh keeps it fresh).
 */
export async function exchangeForGraphToken(refreshToken) {
  const r = await postToken(`${LOGIN_HOST}/consumers/oauth2/v2.0/token`, {
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: GRAPH_SCOPE,
  });
  if (!r.ok || !r.json.access_token) throw new Error(`Could not get access to shared files (${r.status}) ${describe(r.json)}.`);
  return { token: r.json.access_token, expiresAt: Date.now() + Number(r.json.expires_in || 3600) * 1000 };
}

/** Decodes the signed-in user's own id from the skypetoken (a JWT). */
export function selfMri(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      [...atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))]
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    const payload = JSON.parse(json);
    return payload.skypeid ? `8:${payload.skypeid}` : null;
  } catch {
    return null;
  }
}
