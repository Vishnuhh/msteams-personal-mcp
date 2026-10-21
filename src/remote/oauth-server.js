// OAuth 2.1 authorization for MCP clients (MCP spec "Authorization", 2025-06-18):
//   - Protected Resource Metadata (RFC 9728) and Authorization Server Metadata (RFC 8414)
//   - Dynamic Client Registration (RFC 7591), public clients with PKCE S256 (RFC 7636)
//   - Resource Indicators (RFC 8707), issuer in the redirect (RFC 9207), token revocation (RFC 7009)
//
// The user proves who they are with the same Microsoft device-code sign-in as the home page. On approval
// a new per-user access key is created; the authorization code carries it (sealed under the code) to the
// token endpoint, which hands it to the client as the bearer access token. That key is what /mcp already
// accepts, so encryption, isolation and teams_logout work exactly as for personal URLs.
import { newSecret, sha256Hex, sha256B64url, sealJson, openJson, safeEqual } from './crypto.js';

const REQUEST_TTL_MS = 15 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_INFO = 'oauth-code-v1';
const SCOPE = 'teams';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache', ...CORS_HEADERS, ...headers } });

const oauthError = (error, description, status = 400) => json({ error, error_description: description }, status);

export const resourceUrl = (origin) => `${origin}/mcp`;
export const resourceMetadataUrl = (origin) => `${origin}/.well-known/oauth-protected-resource/mcp`;

/** WWW-Authenticate value for 401s from /mcp, so clients can discover how to sign in. */
export function wwwAuthenticate(origin, error) {
  return `Bearer realm="teams-personal", resource_metadata="${resourceMetadataUrl(origin)}"${error ? `, error="${error}"` : ''}, scope="${SCOPE}"`;
}

// ---------------------------------------------------------------- metadata

export function protectedResourceMetadata(origin) {
  return json({
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Teams Personal MCP',
    resource_documentation: `${origin}/`,
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

export function authorizationServerMetadata(origin) {
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/`,
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

// ---------------------------------------------------------------- registration

const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);

/** https anywhere; http only to loopback; native-app custom schemes (cursor://, vscode://) allowed. */
export function validRedirectUri(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || BLOCKED_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol); // custom scheme
}

export async function register(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return oauthError('invalid_client_metadata', 'Body must be JSON client metadata.');
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must list 1-10 https, loopback http or app-scheme URLs without fragments.');
  }
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') {
    return oauthError('invalid_client_metadata', 'Only public clients are supported (token_endpoint_auth_method "none", PKCE required).');
  }
  const name = String(body.client_name || 'MCP client').replace(/[\u0000-\u001f]/g, '').slice(0, 80);
  const clientId = newSecret('client');
  const now = Date.now();
  await env.DB.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
    .bind(clientId, name, JSON.stringify(uris), now).run();
  return json({
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: SCOPE,
  }, 201);
}

// ---------------------------------------------------------------- authorization

function errorRedirect(redirectUri, error, description, state, origin) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  if (description) u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  u.searchParams.set('iss', origin);
  return Response.redirect(u.toString(), 302);
}

function resourceOk(resource, origin) {
  if (!resource) return true;
  const r = resource.replace(/\/+$/, '');
  return r === resourceUrl(origin) || r === origin;
}

/**
 * Validates GET /authorize. Returns { error: Response } or { request } where request is the
 * public data the sign-in page needs (client name, redirect host) plus its opaque id.
 */
export async function startAuthorization(url, env) {
  const p = url.searchParams;
  const origin = url.origin;
  const clientId = p.get('client_id');
  const client = clientId ? await env.DB.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(clientId).first() : null;
  if (!client) return { error: 'This app is not registered with the server. Remove the connector and add it again.' };

  const registered = JSON.parse(client.redirect_uris);
  const redirectUri = p.get('redirect_uri') || (registered.length === 1 ? registered[0] : null);
  if (!redirectUri || !registered.includes(redirectUri)) return { error: 'The app sent a return address it did not register.' };

  // From here on, errors go back to the app.
  const state = p.get('state') || '';
  if (p.get('response_type') !== 'code') return { response: errorRedirect(redirectUri, 'unsupported_response_type', 'Only response_type=code is supported.', state, origin) };
  const challenge = p.get('code_challenge') || '';
  if (p.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return { response: errorRedirect(redirectUri, 'invalid_request', 'PKCE with code_challenge_method=S256 is required.', state, origin) };
  }
  const resource = p.get('resource') || '';
  if (!resourceOk(resource, origin)) return { response: errorRedirect(redirectUri, 'invalid_target', `resource must be ${resourceUrl(origin)}.`, state, origin) };

  const reqId = newSecret('req');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO oauth_requests (id, data, expires_at) VALUES (?, ?, ?)').bind(
      await sha256Hex(reqId),
      JSON.stringify({ clientId, clientName: client.client_name, redirectUri, state, challenge, resource, scope: SCOPE }),
      now + REQUEST_TTL_MS,
    ),
  ]);
  return { request: { id: reqId, clientName: client.client_name || 'An MCP client', redirectHost: new URL(redirectUri).host || new URL(redirectUri).protocol } };
}

async function loadRequest(env, reqId) {
  if (typeof reqId !== 'string' || !reqId.startsWith('req_')) return null;
  const id = await sha256Hex(reqId);
  const row = await env.DB.prepare('SELECT * FROM oauth_requests WHERE id = ?').bind(id).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id, ...JSON.parse(row.data) };
}

/** Called once the user approved the Microsoft sign-in: issue a code and return where to send the browser. */
export async function completeAuthorization(env, reqId, accessKey, origin) {
  const req = await loadRequest(env, reqId);
  if (!req) throw new Error('This sign-in request expired. Start again from your app.');
  const code = newSecret('code');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO oauth_codes (id, data, expires_at) VALUES (?, ?, ?)').bind(
      await sha256Hex(code),
      await sealJson(code, env.KEY_SALT || 'msteams-personal-mcp', CODE_INFO, {
        accessKey, clientId: req.clientId, redirectUri: req.redirectUri, challenge: req.challenge, resource: req.resource, scope: req.scope,
      }),
      Date.now() + CODE_TTL_MS,
    ),
    env.DB.prepare('DELETE FROM oauth_requests WHERE id = ?').bind(req.id),
  ]);
  const u = new URL(req.redirectUri);
  u.searchParams.set('code', code);
  if (req.state) u.searchParams.set('state', req.state);
  u.searchParams.set('iss', origin);
  return u.toString();
}

/** The user pressed Cancel on the sign-in page. */
export async function denyAuthorization(env, reqId, origin) {
  const req = await loadRequest(env, reqId);
  if (!req) return null;
  await env.DB.prepare('DELETE FROM oauth_requests WHERE id = ?').bind(req.id).run();
  const u = new URL(req.redirectUri);
  u.searchParams.set('error', 'access_denied');
  u.searchParams.set('error_description', 'The user cancelled the sign-in.');
  if (req.state) u.searchParams.set('state', req.state);
  u.searchParams.set('iss', origin);
  return u.toString();
}

export async function requestExists(env, reqId) {
  return Boolean(await loadRequest(env, reqId));
}

/** Public details of a pending request (for the new-connection alert). */
export async function requestInfo(env, reqId) {
  const req = await loadRequest(env, reqId);
  return req ? { clientName: req.clientName || 'An MCP app', redirectHost: new URL(req.redirectUri).host || null } : null;
}

// ---------------------------------------------------------------- token + revocation

async function formOrJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) return (await request.json().catch(() => ({}))) || {};
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

export async function token(request, env, origin) {
  const p = await formOrJson(request);
  if (p.grant_type !== 'authorization_code') return oauthError('unsupported_grant_type', 'Only authorization_code is supported. Sign in again when access ends.');
  const code = p.code;
  if (typeof code !== 'string' || !code.startsWith('code_')) return oauthError('invalid_grant', 'Missing or malformed code.');

  const id = await sha256Hex(code);
  const row = await env.DB.prepare('SELECT * FROM oauth_codes WHERE id = ?').bind(id).first();
  // Single use: delete before checking anything else, so a replayed code can never succeed.
  if (row) await env.DB.prepare('DELETE FROM oauth_codes WHERE id = ?').bind(id).run();
  if (!row || row.expires_at < Date.now()) return oauthError('invalid_grant', 'The code is invalid, used or expired.');

  const data = await openJson(code, env.KEY_SALT || 'msteams-personal-mcp', CODE_INFO, row.data);
  if (!safeEqual(String(p.client_id || ''), data.clientId)) return oauthError('invalid_grant', 'The code was issued to another client.');
  if (p.redirect_uri && p.redirect_uri !== data.redirectUri) return oauthError('invalid_grant', 'redirect_uri does not match the authorization request.');
  if (typeof p.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier)) return oauthError('invalid_grant', 'Missing or malformed code_verifier.');
  if (!safeEqual(await sha256B64url(p.code_verifier), data.challenge)) return oauthError('invalid_grant', 'PKCE verification failed.');
  if (p.resource && !resourceOk(p.resource, origin)) return oauthError('invalid_target', `resource must be ${resourceUrl(origin)}.`);

  await env.DB.prepare('UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?').bind(Date.now(), data.clientId).run();
  return json({ access_token: data.accessKey, token_type: 'Bearer', scope: data.scope || SCOPE });
}

/** RFC 7009: revoking the access token deletes the user's sign-in, like teams_logout. Always 200. */
export async function revoke(request, env, onRevoke) {
  const p = await formOrJson(request);
  if (typeof p.token === 'string' && p.token.startsWith('tpm_')) {
    const userId = await sha256Hex(p.token);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    onRevoke?.(userId);
  }
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}
