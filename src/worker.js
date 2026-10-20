// Remote, multi-user MCP server for Microsoft Teams personal — Cloudflare Worker + D1.
//
// Routes
//   GET  /                  sign-in page (device code -> personal MCP URL)
//   POST /api/login/start   start a device-code sign-in
//   POST /api/login/poll    check it; on approval returns the user's access key + MCP URL
//   POST /mcp/<accessKey>   MCP Streamable HTTP endpoint (key in path; works with every client)
//   POST /mcp               same, with "Authorization: Bearer <accessKey>"
//   GET  /health            liveness
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { requestDeviceCode, pollDeviceCode, exchangeForSkypeToken } from './core/oauth.js';
import { createTeamsClient } from './core/teams.js';
import { registerTeamsTools, registerTeamsPrompts, wrap } from './core/tools.js';
import { newSecret, sha256Hex, sealJson, openJson } from './remote/crypto.js';
import { renderPage } from './remote/page.js';

const VERSION = '0.4.0';
const USER_INFO = 'user-data-v1';
const LOGIN_INFO = 'login-data-v1';

// Per-isolate cache of skypetokens, keyed by user row id. Saves a D1 read + decrypt per request.
const skypeCache = new Map();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const salt = (env) => env.KEY_SALT || 'msteams-personal-mcp';

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
  const { loginId } = await request.json().catch(() => ({}));
  if (typeof loginId !== 'string' || !loginId.startsWith('login_')) return json({ status: 'error', error: 'Missing loginId.' }, 400);

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
  return json({ status: 'approved', accessKey, mcpUrl: `${origin}/mcp/${accessKey}` });
}

// ---------------------------------------------------------------- per-user token source

function userTokenSource(env, accessKey, userId) {
  return async function getSkypeToken() {
    const cached = skypeCache.get(userId);
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached;

    const row = await env.DB.prepare('SELECT data FROM users WHERE id = ?').bind(userId).first();
    if (!row) throw new Error('This MCP URL has been revoked. Sign in again on the server home page.');
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
  if (m) return m[1];
  const auth = request.headers.get('Authorization') || '';
  const b = auth.match(/^Bearer\s+(tpm_[A-Za-z0-9_-]{20,})$/);
  return b ? b[1] : null;
}

async function handleMcp(request, env, url) {
  if (request.method !== 'POST') {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }, 405, { Allow: 'POST' });
  }
  const accessKey = accessKeyFrom(request, url);
  const signInUrl = `${url.origin}/`;
  if (!accessKey) {
    return json({ jsonrpc: '2.0', error: { code: -32001, message: `Missing access key. Get your personal MCP URL at ${signInUrl}` }, id: null }, 401);
  }
  const userId = await sha256Hex(accessKey);
  const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(userId).first();
  if (!exists) {
    return json({ jsonrpc: '2.0', error: { code: -32001, message: `Unknown or revoked access key. Sign in again at ${signInUrl}` }, id: null }, 401);
  }

  const client = createTeamsClient(userTokenSource(env, accessKey, userId));
  const server = new McpServer(
    { name: 'teams-personal', version: VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool('teams_status', {
    description: 'Show the signed-in Teams personal account for this MCP URL.',
    inputSchema: {},
  }, wrap(async () => ({ signedIn: true, ...(await client.whoAmI()), server: VERSION })));

  server.registerTool('teams_logout', {
    description: 'Revoke this MCP URL: deletes the stored Teams sign-in from the server. The URL stops working immediately.',
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
  return transport.handleRequest(request);
}

// ---------------------------------------------------------------- router

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(renderPage({ repoUrl: env.REPO_URL }), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' },
        });
      }
      if (url.pathname === '/health') return json({ ok: true, version: VERSION });
      if (url.pathname === '/api/login/start' && request.method === 'POST') return await loginStart(env);
      if (url.pathname === '/api/login/poll' && request.method === 'POST') return await loginPoll(request, env);
      if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return await handleMcp(request, env, url);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
};
