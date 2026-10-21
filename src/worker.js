// Remote, multi-user MCP server for Microsoft Teams personal — Cloudflare Worker + D1.
//
// Routes
//   GET  /                         home page (address to add; personal URL fallback)
//   GET  /changelog                what changed in each release (from CHANGELOG.md)
//   POST /api/login/start          start a device-code sign-in
//   POST /api/login/poll           check it; on approval returns the access key + MCP URL, or (OAuth) where to redirect
//   POST /mcp                      MCP Streamable HTTP endpoint, "Authorization: Bearer <access token>" (OAuth clients)
//   POST /mcp/<accessKey>          same, with the key in the path (personal URLs; can be switched off)
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 metadata
//   GET  /.well-known/oauth-authorization-server       RFC 8414 metadata
//   POST /register  GET /authorize  POST /token  POST /revoke  POST /oauth/deny   OAuth 2.1 (see remote/oauth-server.js)
//   GET  /admin                    admin sign-in + usage dashboard (ADMIN_USERNAME / ADMIN_PASSWORD)
//   GET  /admin/api/overview       dashboard data (admin session cookie, or Bearer ADMIN_TOKEN)
//   GET  /admin/stats              same data for scripts (Bearer ADMIN_TOKEN)
//   GET  /health                   liveness
//
// Optional settings (wrangler vars or secrets):
//   ACCESS_CODE            team access code required to sign in (secret)
//   ALLOWED_ACCOUNTS       comma-separated Teams ids (8:live:.cid.…) allowed to sign in
//   DISABLE_PERSONAL_URLS  "true" = connectors only; /mcp/<key> URLs and new personal URLs are refused
//   NEW_CONNECTION_ALERTS  "false" = don't post a note to the user's Teams Notes on each new connection
//   ADMIN_USERNAME, ADMIN_PASSWORD   admin sign-in for /admin (secrets; password at least 12 characters)
//   ADMIN_TOKEN            bearer token for /admin/stats and /admin/api/* (secret, for scripts)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { z } from 'zod';
import { requestDeviceCode, pollDeviceCode, exchangeForSkypeToken, selfMri } from './core/oauth.js';
import { createTeamsClient } from './core/teams.js';
import { registerTeamsTools, registerTeamsPrompts, wrap } from './core/tools.js';
import { newSecret, sha256Hex, sha256B64, hmacHex, sealJson, openJson, safeEqual } from './remote/crypto.js';
import { renderPage } from './remote/page.js';
import { renderAuthorizePage, renderAuthorizeError } from './remote/authorize-page.js';
import { renderChangelogPage } from './remote/changelog.js';
import { limit, toolGuard } from './remote/limits.js';
import { adminConfigured, isAdmin, login as adminLogin, logout as adminLogout, overview as adminOverview, endConnection, renderAdminPage } from './remote/admin.js';
import CHANGELOG from '../CHANGELOG.md';
import pkg from '../package.json';
import {
  CORS_HEADERS, wwwAuthenticate, protectedResourceMetadata, authorizationServerMetadata,
  register, startAuthorization, completeAuthorization, denyAuthorization, requestExists, requestInfo, token, revoke,
} from './remote/oauth-server.js';

const VERSION = pkg.version;
const USER_INFO = 'user-data-v1';
const LOGIN_INFO = 'login-data-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 90;

// Per-isolate cache of skypetokens, keyed by user row id. Saves a D1 read + decrypt per request.
const skypeCache = new Map();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const salt = (env) => env.KEY_SALT || 'msteams-personal-mcp';
const today = () => new Date().toISOString().slice(0, 10);
const flag = (v) => String(v || '').toLowerCase() === 'true';
const settings = (env) => ({
  accessCodeRequired: Boolean(env.ACCESS_CODE),
  allowList: String(env.ALLOWED_ACCOUNTS || '').split(/[\s,]+/).filter(Boolean),
  personalUrls: !flag(env.DISABLE_PERSONAL_URLS),
  alerts: String(env.NEW_CONNECTION_ALERTS || '').toLowerCase() !== 'false',
});

/** Anonymous daily counter (no ids, names or content). Never blocks or fails the request. */
function stat(env, ctx, metric) {
  const p = env.DB.prepare('INSERT INTO stats (day, metric, count) VALUES (?, ?, 1) ON CONFLICT(day, metric) DO UPDATE SET count = count + 1')
    .bind(today(), metric).run().catch(() => {});
  ctx?.waitUntil?.(p);
}

// ---------------------------------------------------------------- pages (CSP with script hashes)

const scriptHashes = new Map();
async function html(body, status = 200) {
  const hashes = [];
  for (const m of body.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    if (!scriptHashes.has(m[1])) scriptHashes.set(m[1], await sha256B64(m[1]));
    hashes.push(`'sha256-${scriptHashes.get(m[1])}'`);
  }
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': 'max-age=31536000',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline' https://api.fontshare.com; ` +
        "font-src https://cdn.fontshare.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
    },
  });
}

// ---------------------------------------------------------------- sign-in API

async function loginStart(request, env, ctx) {
  const cfg = settings(env);
  const body = await request.json().catch(() => ({}));
  if (cfg.accessCodeRequired && !safeEqual(String(body.accessCode || '').trim(), String(env.ACCESS_CODE))) {
    stat(env, ctx, 'signin_bad_access_code');
    return json({ error: body.accessCode ? 'That access code is not right.' : 'Enter the team access code.', needAccessCode: true }, 403);
  }
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

const accountHash = (env, mri) => hmacHex(salt(env), `account|${mri}`);

/** Posts a short note to the user's own Teams Notes so an unexpected connection gets noticed. */
async function newConnectionAlert(skype, { appName, host, country }) {
  const client = createTeamsClient(async () => skype);
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const text = `New Teams MCP connection: ${appName} on ${host}, ${when}${country ? `, from ${country}` : ''}.\n\n` +
    'Not you? Ask your assistant to run teams_logout with everywhere=true, and remove access at account.live.com/consent/Manage.';
  await client.sendMessage('48:notes', text).catch(() => {});
}

async function loginPoll(request, env, ctx) {
  const cfg = settings(env);
  const { loginId, req } = await request.json().catch(() => ({}));
  if (typeof loginId !== 'string' || !loginId.startsWith('login_')) return json({ status: 'error', error: 'Missing loginId.' }, 400);
  if (req === undefined && !cfg.personalUrls) {
    return json({ status: 'error', error: 'Personal URLs are turned off on this server. Add the /mcp address to your app as a connector instead.' }, 403);
  }
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

  // Approved: verify the whole chain works, and that this account may use this server.
  const skype = await exchangeForSkypeToken(result.refreshToken);
  const mri = selfMri(skype.token);
  if (cfg.allowList.length && !cfg.allowList.some((a) => a === mri || `8:${a}` === mri)) {
    await env.DB.prepare('DELETE FROM logins WHERE id = ?').bind(id).run();
    stat(env, ctx, 'signin_not_allowed');
    return json({ status: 'error', error: `This server is limited to its team. Ask the admin to add your account: ${mri}` }, 403);
  }

  const accessKey = newSecret('tpm');
  const userId = await sha256Hex(accessKey);
  const data = await sealJson(accessKey, salt(env), USER_INFO, {
    refreshToken: skype.refreshToken,
    skype: { token: skype.token, expiresAt: skype.expiresAt, region: skype.region },
  });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, data, created_at, updated_at, last_used_at, account_hash, app_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userId, data, now, now, now, mri ? await accountHash(env, mri) : null, req !== undefined ? ((await requestInfo(env, req))?.clientName || 'MCP app') : 'Personal URL'),
    env.DB.prepare('DELETE FROM logins WHERE id = ?').bind(id),
  ]);
  stat(env, ctx, 'signin');

  const origin = new URL(request.url).origin;
  ctx.waitUntil(createTeamsClient(async () => skype).displayName()
    .then((name) => name && env.DB.prepare('UPDATE users SET account_name = ? WHERE id = ?').bind(name, userId).run())
    .catch(() => {}));
  if (cfg.alerts) {
    const info = req !== undefined ? await requestInfo(env, req) : null;
    ctx.waitUntil(newConnectionAlert(skype, {
      appName: info ? `${info.clientName}${info.redirectHost ? ` (${info.redirectHost})` : ''}` : 'a personal URL',
      host: new URL(origin).host,
      country: request.cf?.country || null,
    }));
  }
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

async function handleMcp(request, env, url, ctx) {
  if (request.method !== 'POST') {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }, 405, { Allow: 'POST', ...CORS_HEADERS });
  }
  const cfg = settings(env);
  const signInUrl = `${url.origin}/`;
  const found = accessKeyFrom(request, url);
  if (!found) return unauthorized(url, `Sign in to connect: your app should open the sign-in page automatically, or see ${signInUrl}`);
  if (found.via === 'path' && !cfg.personalUrls) {
    return unauthorized(url, `Personal URLs are turned off on this server. Add ${url.origin}/mcp to your app as a connector and sign in.`, 'invalid_token');
  }
  const accessKey = found.key;
  if (!/^tpm_[A-Za-z0-9_-]{20,}$/.test(accessKey)) return unauthorized(url, 'Invalid access token. Sign in again.', 'invalid_token');
  const userId = await sha256Hex(accessKey);
  const row = await env.DB.prepare('SELECT created_at, last_used_at, account_hash, account_name FROM users WHERE id = ?').bind(userId).first();
  if (!row) return unauthorized(url, `This connection was revoked or has expired. Sign in again${found.via === 'path' ? ` at ${signInUrl}` : ''}.`, 'invalid_token');

  const now = Date.now();
  const lastUsed = row.last_used_at || row.created_at;
  if (now - lastUsed > INACTIVE_DAYS * DAY_MS) {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    skypeCache.delete(userId);
    stat(env, ctx, 'expired');
    return unauthorized(url, `This connection expired after ${INACTIVE_DAYS} days without use. Sign in again.`, 'invalid_token');
  }
  if (!(await limit(env, 'USER_LIMITER', userId))) {
    stat(env, ctx, 'rate_limited_user');
    return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests from this connection. Slow down and retry in a minute.' }, id: null }, 429, { 'Retry-After': '60', ...CORS_HEADERS });
  }

  const getSkypeToken = userTokenSource(env, accessKey, userId);
  const client = createTeamsClient(getSkypeToken);
  // Date-level last use, written at most once a day; backfill the account hash for older connections.
  stat(env, ctx, 'mcp_request');
  if (new Date(lastUsed).toISOString().slice(0, 10) !== today() || !row.account_hash || !row.account_name) {
    ctx.waitUntil((async () => {
      const hash = row.account_hash || (await getSkypeToken().then((s) => selfMri(s.token)).then((m) => (m ? accountHash(env, m) : null)).catch(() => null));
      const name = row.account_name || (await client.displayName().catch(() => null));
      await env.DB.prepare('UPDATE users SET last_used_at = ?, account_hash = ?, account_name = ? WHERE id = ?').bind(now, hash, name, userId).run();
    })().catch(() => {}));
  }

  const server = new McpServer(
    { name: 'teams-personal', version: VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool('teams_status', {
    description: 'Show the signed-in Teams personal account for this connection.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, wrap(async () => ({ signedIn: true, ...(await client.whoAmI()), server: VERSION })));

  server.registerTool('teams_logout', {
    description: 'Disconnect: deletes the stored Teams sign-in from the server, so this connection stops working immediately. ' +
      'everywhere=true ends every connection of this Teams account on this server (all apps and personal URLs).',
    inputSchema: { everywhere: z.boolean().optional().describe('End all connections of this account, not just this one') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, wrap(async ({ everywhere }) => {
    let ended = 1;
    if (everywhere) {
      const hash = row.account_hash || (await getSkypeToken().then((s) => accountHash(env, selfMri(s.token))));
      const r = await env.DB.prepare('DELETE FROM users WHERE account_hash = ? OR id = ?').bind(hash, userId).run();
      ended = r.meta?.changes ?? 1;
    } else {
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    }
    skypeCache.delete(userId);
    stat(env, ctx, 'signout');
    return { signedOut: true, connectionsEnded: ended, signInAgainAt: signInUrl };
  }));

  const guard = toolGuard(env, userId, { onLimited: (m) => stat(env, ctx, m) });
  registerTeamsTools(server, client, {
    beforeCall: async (name, kind) => { stat(env, ctx, `tool:${name}`); await guard(name, kind); },
  });
  registerTeamsPrompts(server);

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return withCors(await transport.handleRequest(request));
}

// ---------------------------------------------------------------- admin + housekeeping

/** Daily cron: remove what is no longer needed. */
async function cleanup(env) {
  const now = Date.now();
  const stale = now - INACTIVE_DAYS * DAY_MS;
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM users WHERE COALESCE(last_used_at, created_at) < ?').bind(stale),
    env.DB.prepare('DELETE FROM oauth_clients WHERE COALESCE(last_used_at, created_at) < ?').bind(stale),
    env.DB.prepare('DELETE FROM logins WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM usage WHERE day < ?').bind(new Date(now - 3 * DAY_MS).toISOString().slice(0, 10)),
    env.DB.prepare('DELETE FROM stats WHERE day < ?').bind(new Date(now - 90 * DAY_MS).toISOString().slice(0, 10)),
  ]);
  const expired = results[0]?.meta?.changes || 0;
  await env.DB.prepare("INSERT INTO stats (day, metric, count) VALUES (?, 'cleanup_run', 1) ON CONFLICT(day, metric) DO UPDATE SET count = count + 1").bind(today()).run();
  if (expired) {
    await env.DB.prepare('INSERT INTO stats (day, metric, count) VALUES (?, ?, ?) ON CONFLICT(day, metric) DO UPDATE SET count = count + excluded.count')
      .bind(today(), 'expired', expired).run();
  }
}

// ---------------------------------------------------------------- rate limiting (per IP)

// Cloudflare rate-limit bindings (see wrangler.toml). Missing bindings mean "no limit".
const LIMITS = [
  { match: (p, m) => m === 'POST' && p === '/api/login/start', binding: 'LOGIN_START_LIMITER', message: 'Too many sign-in attempts. Wait a minute and try again.' },
  { match: (p, m) => m === 'POST' && p === '/api/login/poll', binding: 'LOGIN_POLL_LIMITER', message: 'Checking too often. Wait a few seconds.' },
  { match: (p, m) => m === 'POST' && (p === '/mcp' || p.startsWith('/mcp/')), binding: 'MCP_LIMITER', message: 'Too many requests. Slow down and retry shortly.' },
  { match: (p) => ['/register', '/authorize', '/token', '/revoke', '/oauth/deny'].includes(p), binding: 'OAUTH_LIMITER', message: 'Too many requests. Wait a minute and try again.' },
  { match: (p) => p.startsWith('/admin/'), binding: 'ADMIN_LIMITER', message: 'Too many admin requests or sign-in attempts. Wait a minute and try again.' },
];

async function rateLimited(request, env, url, ctx) {
  const rule = LIMITS.find((r) => r.match(url.pathname, request.method));
  if (!rule) return null;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await limit(env, rule.binding, ip)) return null;
  stat(env, ctx, 'rate_limited_ip');
  return json({ error: rule.message, jsonrpc: url.pathname.startsWith('/mcp') ? '2.0' : undefined }, 429, { 'Retry-After': '60', ...CORS_HEADERS });
}

// ---------------------------------------------------------------- router

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cfg = settings(env);
    try {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      const limited = await rateLimited(request, env, url, ctx);
      if (limited) return limited;

      if (path === '/' && method === 'GET') {
        return html(renderPage({ repoUrl: env.REPO_URL, version: 'v' + VERSION, accessCodeRequired: cfg.accessCodeRequired, personalUrls: cfg.personalUrls }));
      }
      if ((path === '/changelog' || path === '/changelog/') && method === 'GET') {
        return html(renderChangelogPage({ markdown: CHANGELOG, liveVersion: VERSION, repoUrl: env.REPO_URL }));
      }
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
        return html(renderAuthorizePage({ reqId: r.request.id, clientName: r.request.clientName, redirectHost: r.request.redirectHost, accessCodeRequired: cfg.accessCodeRequired }));
      }
      if (path === '/token' && method === 'POST') return await token(request, env, url.origin);
      if (path === '/revoke' && method === 'POST') {
        stat(env, ctx, 'signout');
        return await revoke(request, env, (userId) => skypeCache.delete(userId));
      }
      if (path === '/oauth/deny' && method === 'POST') {
        const { req } = await request.json().catch(() => ({}));
        const redirect = await denyAuthorization(env, req, url.origin);
        return json(redirect ? { redirect } : { error: 'Request not found.' }, redirect ? 200 : 404);
      }

      // Sign-in API used by the pages
      if (path === '/api/login/start' && method === 'POST') return await loginStart(request, env, ctx);
      if (path === '/api/login/poll' && method === 'POST') return await loginPoll(request, env, ctx);

      // Admin area
      if ((path === '/admin' || path === '/admin/') && method === 'GET') return html(renderAdminPage({ configured: adminConfigured(env) }));
      if (path === '/admin/login' && method === 'POST') return await adminLogin(request, env, () => stat(env, ctx, 'admin_signin_failed'));
      if (path.startsWith('/admin/')) {
        // Cookie-authenticated changes need a custom header, which other sites cannot send (no CORS for /admin).
        if (method === 'POST' && request.headers.get('X-Admin') !== '1') return json({ error: 'Missing X-Admin header.' }, 400);
        if (path === '/admin/logout' && method === 'POST') return adminLogout();
        if (!(await isAdmin(request, env))) return json({ error: 'Sign in at /admin.' }, 401);
        const s = settings(env);
        const settingsView = { accessCodeRequired: s.accessCodeRequired, allowListSize: s.allowList.length, personalUrls: s.personalUrls, alerts: s.alerts };
        if ((path === '/admin/api/overview' || path === '/admin/stats') && method === 'GET') {
          return json(await adminOverview(env, { version: VERSION, settings: settingsView, inactiveDays: INACTIVE_DAYS }));
        }
        const end = path.match(/^\/admin\/api\/connections\/([0-9a-f]{64})\/end$/);
        if (end && method === 'POST') {
          skypeCache.delete(end[1]);
          stat(env, ctx, 'admin_ended_connection');
          return await endConnection(env, end[1]);
        }
        return json({ error: 'Not found' }, 404);
      }
      if (path === '/mcp' || path.startsWith('/mcp/')) return await handleMcp(request, env, url, ctx);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      stat(env, ctx, 'error');
      return json({ error: e instanceof Error ? e.message : String(e) }, 500, CORS_HEADERS);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
};
