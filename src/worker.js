// Remote, multi-user MCP server for Microsoft Teams personal — Cloudflare Worker + D1.
//
// Routes
//   GET  /                         sign-in page (device code -> personal MCP URL)
//   POST /api/login/start          start a device-code sign-in
//   POST /api/login/poll           check it; on approval returns the access key + MCP URL, or (OAuth) where to redirect
//   POST /mcp                      MCP Streamable HTTP endpoint, "Authorization: Bearer <access token>" (OAuth clients)
//   POST /mcp/<accessKey>          same, with the key in the path (personal URLs; works with every client)
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 metadata
//   GET  /.well-known/oauth-authorization-server       RFC 8414 metadata
//   POST /register  GET /authorize  POST /token  POST /revoke  POST /oauth/deny   OAuth 2.1 (see remote/oauth-server.js)
//   GET  /health                   liveness
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { requestDeviceCode, pollDeviceCode, exchangeForSkypeToken } from './core/oauth.js';
import { createTeamsClient } from './core/teams.js';
import { registerTeamsTools, registerTeamsPrompts, wrap } from './core/tools.js';
import { newSecret, sha256Hex, sealJson, openJson } from './remote/crypto.js';
import { renderPage } from './remote/page.js';
import { renderAuthorizePage, renderAuthorizeError } from './remote/authorize-page.js';
import {
  CORS_HEADERS, wwwAuthenticate, protectedResourceMetadata, authorizationServerMetadata,
  register, startAuthorization, completeAuthorization, denyAuthorization, requestExists, token, revoke,
} from './remote/oauth-server.js';

const VERSION = '0.6.0';
const USER_INFO = 'user-data-v1';
const LOGIN_INFO = 'login-data-v1';

// Per-isolate cache of skypetokens, keyed by user row id. Saves a D1 read + decrypt per request.
const skypeCache = new Map();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const salt = (env) => env.KEY_SALT || 'msteams-personal-mcp';

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://api.fontshare.com; " +
    "font-src https://cdn.fontshare.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
};
const html = (body, status = 200) => new Response(body, { status, headers: PAGE_HEADERS });

// ---------------------------------------------------------------- sign-in API

async function loginStart(env) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM logins WHERE expires_at < ?').bind(now).run();
  const dc = await requestDeviceCode();
  const loginId = newSecret('login');
  await env.DB.prepare('INSERT INTO logins (id, data, interval_s, next_poll_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(loginId), await sealJson(loginId, salt(env), LOGIN_INFO, { deviceCode: dc.deviceCode }),
      dc.interval, now + dc.interval * 1000, dc.expiresAt)
    .run();
  return json({ loginId, userCode: dc.userCode, verificationUrl: dc.verificationUrl, interval: dc.interval, expiresAt: dc.expiresAt });
}

async function loginPoll(request, env) {
  const { loginId, req } = await request.json().catch(() => ({}));
  if (typeof loginId !== 'string' || !loginId.startsWith('login_')) return json({ status: 'error', error: 'Missing loginId.' }, 400);
  if (req !== undefined && !(await requestExists(env, req))) {
    return json({ status: 'error', error: 'This sign-in request expired. Start again from your app.' }, 410);
  }

  const id = await sha256Hex(loginId);
  const row = await env.DB.prepare('SELECT * FROM logins WHERE id = ?').bind(id).first();
  const now = Date.now();
  if (!row || row.expires_at < now) return json({ status: 'error', error: 'Sign-in code expired.' }, 410);
  // Respect Microsoft's polling interval no matter how often the browser asks.
  if (now < row.next_poll_at) return json({ status: 'pending', interval: row.interval_s });

  const { deviceCode } = await openJson(loginId, salt(env), LOGIN_INFO, row.data);
  let result;
  try {
    result = await pollDeviceCode(deviceCode);
  } catch (e) {
    await env.DB.prepare('DELETE FROM logins WHERE id = ?').bind(id).run();
    return json({ status: 'error', error: e.message }, 400);
  }
  if (result.status !== 'approved') {
    const interval = row.interval_s + (result.status === 'slow_down' ? 5 : 0);
    await env.DB.prepare('UPDATE logins SET interval_s = ?, next_poll_at = ? WHERE id = ?').bind(interval, now + interval * 1000, id).run();
    return json({ status: 'pending', interval });
  }

  // Approved: verify the whole chain works before handing out a key.
  const skype = await exchangeForSkypeToken(result.refreshToken);
  const accessKey = newSecret('tpm');
  const userId = await sha256Hex(accessKey);
  const data = await sealJson(accessKey, salt(env), USER_INFO, {
    refreshToken: skype.refreshToken,
    skype: { token: skype.token, expiresAt: skype.expiresAt, region: skype.region },
  });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(userId, data, now, now),
    env.DB.prepare('DELETE FROM logins WHERE id = ?').bind(id),
  ]);
  const origin = new URL(request.url).origin;
  if (req !== undefined) {
    // OAuth: the key goes to the app through the authorization code, never to this page.
    return json({ status: 'approved', redirect: await completeAuthorization(env, req, accessKey, origin) });
  }
  return json({ status: 'approved', accessKey, mcpUrl: `${origin}/mcp/${accessKey}` });
}

// ---------------------------------------------------------------- per-user token source

function userTokenSource(env, accessKey, userId) {
  return async function getSkypeToken() {
    const cached = skypeCache.get(userId);
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached;

    const row = await env.DB.prepare('SELECT data FROM users WHERE id = ?').bind(userId).first();
    if (!row) throw new Error('This connection has been revoked. Sign in again.');
    const data = await openJson(accessKey, salt(env), USER_INFO, row.data);
    if (data.skype && Date.now() < data.skype.expiresAt - 60_000) {
      skypeCache.set(userId, data.skype);
      return data.skype;
    }

    const s = await exchangeForSkypeToken(data.refreshToken);
    const skype = { token: s.token, expiresAt: s.expiresAt, region: s.region };
    await env.DB.prepare('UPDATE users SET data = ?, updated_at = ? WHERE id = ?')
      .bind(await sealJson(accessKey, salt(env), USER_INFO, { refreshToken: s.refreshToken, skype }), Date.now(), userId)
      .run();
    skypeCache.set(userId, skype);
    return skype;
  };
}

// ---------------------------------------------------------------- MCP endpoint

function accessKeyFrom(request, url) {
  const m = url.pathname.match(/^\/mcp\/(tpm_[A-Za-z0-9_-]{20,})\/?$/);
  if (m) return { key: m[1], via: 'path' };
  const auth = request.headers.get('Authorization') || '';
  const b = auth.match(/^Bearer\s+(\S+)$/i);
  return b ? { key: b[1], via: 'header' } : null;
}

const withCors = (res) => {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
  return out;
};

function unauthorized(url, message, error) {
  return json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }, 401, {
    ...CORS_HEADERS,
    'WWW-Authenticate': wwwAuthenticate(url.origin, error),
  });
}

async function handleMcp(request, env, url) {
  if (request.method !== 'POST') {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }, 405, { Allow: 'POST', ...CORS_HEADERS });
  }
  const signInUrl = `${url.origin}/`;
  const found = accessKeyFrom(request, url);
  if (!found) return unauthorized(url, `Sign in to connect: your app should open the sign-in page automatically, or get a personal MCP URL at ${signInUrl}`);
  const accessKey = found.key;
  if (!/^tpm_[A-Za-z0-9_-]{20,}$/.test(accessKey)) return unauthorized(url, 'Invalid access token. Sign in again.', 'invalid_token');
  const userId = await sha256Hex(accessKey);
  const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(userId).first();
  if (!exists) return unauthorized(url, `This connection was revoked or has expired. Sign in again${found.via === 'path' ? ` at ${signInUrl}` : ''}.`, 'invalid_token');

  const client = createTeamsClient(userTokenSource(env, accessKey, userId));
  const server = new McpServer(
    { name: 'teams-personal', version: VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool('teams_status', {
    description: 'Show the signed-in Teams personal account for this connection.',
    inputSchema: {},
  }, wrap(async () => ({ signedIn: true, ...(await client.whoAmI()), server: VERSION })));

  server.registerTool('teams_logout', {
    description: 'Disconnect: deletes the stored Teams sign-in from the server. This connection (URL or app sign-in) stops working immediately.',
    inputSchema: {},
  }, wrap(async () => {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    skypeCache.delete(userId);
    return { signedOut: true, signInAgainAt: signInUrl };
  }));

  registerTeamsTools(server, client);
  registerTeamsPrompts(server);

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
}

// ---------------------------------------------------------------- rate limiting

// Cloudflare rate-limit bindings (see wrangler.toml). Missing bindings mean "no limit".
const LIMITS = [
  { match: (p, m) => m === 'POST' && p === '/api/login/start', binding: 'LOGIN_START_LIMITER', message: 'Too many sign-in attempts. Wait a minute and try again.' },
  { match: (p, m) => m === 'POST' && p === '/api/login/poll', binding: 'LOGIN_POLL_LIMITER', message: 'Checking too often. Wait a few seconds.' },
  { match: (p, m) => m === 'POST' && (p === '/mcp' || p.startsWith('/mcp/')), binding: 'MCP_LIMITER', message: 'Too many requests. Slow down and retry shortly.' },
  { match: (p) => ['/register', '/authorize', '/token', '/revoke', '/oauth/deny'].includes(p), binding: 'OAUTH_LIMITER', message: 'Too many sign-in requests. Wait a minute and try again.' },
];

async function rateLimited(request, env, url) {
  const rule = LIMITS.find((r) => r.match(url.pathname, request.method));
  const limiter = rule && env[rule.binding];
  if (!limiter) return null;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await limiter.limit({ key: `${rule.binding}:${ip}` });
  if (success) return null;
  return json({ error: rule.message, jsonrpc: url.pathname.startsWith('/mcp') ? '2.0' : undefined }, 429, { 'Retry-After': '60', ...CORS_HEADERS });
}

// ---------------------------------------------------------------- router

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      const limited = await rateLimited(request, env, url);
      if (limited) return limited;

      if (path === '/' && method === 'GET') return html(renderPage({ repoUrl: env.REPO_URL, version: 'v' + VERSION }));
      if (path === '/health') return json({ ok: true, version: VERSION });

      // OAuth discovery
      if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') return protectedResourceMetadata(url.origin);
      if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp' || path === '/.well-known/openid-configuration') {
        return authorizationServerMetadata(url.origin);
      }
      // OAuth endpoints
      if (path === '/register' && method === 'POST') return await register(request, env);
      if (path === '/authorize' && method === 'GET') {
        const r = await startAuthorization(url, env);
        if (r.response) return r.response;
        if (r.error) return html(renderAuthorizeError(r.error), 400);
        return html(renderAuthorizePage({ reqId: r.request.id, clientName: r.request.clientName, redirectHost: r.request.redirectHost }));
      }
      if (path === '/token' && method === 'POST') return await token(request, env, url.origin);
      if (path === '/revoke' && method === 'POST') return await revoke(request, env, (userId) => skypeCache.delete(userId));
      if (path === '/oauth/deny' && method === 'POST') {
        const { req } = await request.json().catch(() => ({}));
        const redirect = await denyAuthorization(env, req, url.origin);
        return json(redirect ? { redirect } : { error: 'Request not found.' }, redirect ? 200 : 404);
      }

      // Sign-in API used by the pages
      if (path === '/api/login/start' && method === 'POST') return await loginStart(env);
      if (path === '/api/login/poll' && method === 'POST') return await loginPoll(request, env);

      if (path === '/mcp' || path.startsWith('/mcp/')) return await handleMcp(request, env, url);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500, CORS_HEADERS);
    }
  },
};
