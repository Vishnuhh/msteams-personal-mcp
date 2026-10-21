// OAuth 2.1 server tests against an in-memory stand-in for D1 (only the statements oauth-server.js uses).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  register, startAuthorization, completeAuthorization, denyAuthorization, token, revoke,
  protectedResourceMetadata, authorizationServerMetadata, validRedirectUri, wwwAuthenticate,
} from '../src/remote/oauth-server.js';
import { sha256B64url, newSecret, sha256Hex } from '../src/remote/crypto.js';

const ORIGIN = 'https://teams.example.test';

function fakeD1() {
  const t = { oauth_clients: new Map(), oauth_requests: new Map(), oauth_codes: new Map(), users: new Map() };
  const key = { oauth_clients: 'client_id', oauth_requests: 'id', oauth_codes: 'id', users: 'id' };
  function stmt(sql) {
    let args = [];
    const s = {
      bind: (...a) => { args = a; return s; },
      async first() {
        const m = sql.match(/FROM (\w+) WHERE (\w+) = \?/);
        return t[m[1]].get(args[0]) || null;
      },
      async run() {
        let m;
        if ((m = sql.match(/^INSERT INTO (\w+) \(([^)]+)\)/))) {
          const cols = m[2].split(',').map((c) => c.trim());
          const row = Object.fromEntries(cols.map((c, i) => [c, args[i]]));
          t[m[1]].set(row[key[m[1]]], row);
        } else if ((m = sql.match(/^DELETE FROM (\w+) WHERE expires_at < \?/))) {
          for (const [k, r] of t[m[1]]) if (r.expires_at < args[0]) t[m[1]].delete(k);
        } else if ((m = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/))) {
          t[m[1]].delete(args[0]);
        } else throw new Error('fake D1: unsupported SQL ' + sql);
        return {};
      },
    };
    return s;
  }
  return { tables: t, prepare: stmt, batch: async (list) => { for (const s of list) await s.run(); return []; } };
}

const env = () => ({ DB: fakeD1(), KEY_SALT: 'test-salt' });
const post = (body, type = 'application/json') => new Request(`${ORIGIN}/x`, {
  method: 'POST', headers: { 'Content-Type': type }, body: type.includes('json') ? JSON.stringify(body) : new URLSearchParams(body).toString(),
});
const verifier = 'v'.repeat(20) + '-._~' + 'A1b2C3d4E5f6G7h8I9j0K1'; // 46 chars, PKCE alphabet

async function registeredClient(e, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  const r = await register(post({ client_name: 'Claude', redirect_uris: [redirect] }), e);
  assert.equal(r.status, 201);
  return (await r.json()).client_id;
}

async function authorizeUrl(clientId, { challenge, redirect = 'https://claude.ai/api/mcp/auth_callback', extra = {} } = {}) {
  const u = new URL(`${ORIGIN}/authorize`);
  const params = { response_type: 'code', client_id: clientId, redirect_uri: redirect, state: 'st4te', code_challenge: challenge, code_challenge_method: 'S256', resource: `${ORIGIN}/mcp`, ...extra };
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u;
}

/** Full happy path up to an authorization code. */
async function issueCode(e) {
  const clientId = await registeredClient(e);
  const challenge = await sha256B64url(verifier);
  const start = await startAuthorization(await authorizeUrl(clientId, { challenge }), e);
  assert.ok(start.request, 'authorization request created');
  const accessKey = newSecret('tpm');
  const redirect = new URL(await completeAuthorization(e, start.request.id, accessKey, ORIGIN));
  return { clientId, accessKey, redirect, code: redirect.searchParams.get('code') };
}

test('metadata documents point at each other and require PKCE', async () => {
  const prm = await protectedResourceMetadata(ORIGIN).json();
  assert.equal(prm.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(prm.authorization_servers, [ORIGIN]);
  const asm = await authorizationServerMetadata(ORIGIN).json();
  assert.equal(asm.issuer, ORIGIN);
  assert.deepEqual(asm.code_challenge_methods_supported, ['S256']);
  assert.equal(asm.registration_endpoint, `${ORIGIN}/register`);
  assert.match(wwwAuthenticate(ORIGIN, 'invalid_token'), /resource_metadata="https:\/\/teams\.example\.test\/\.well-known\/oauth-protected-resource\/mcp", error="invalid_token"/);
});

test('redirect URI rules: https, loopback http, app schemes; nothing dangerous', () => {
  for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:33418/callback', 'http://localhost:6274/oauth/callback', 'cursor://anysphere.cursor-retrieval/oauth/callback', 'vscode://vscode.github-authentication/did-authenticate']) {
    assert.ok(validRedirectUri(ok), ok);
  }
  for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,x', 'https://claude.ai/cb#frag', 'not a url', 'file:///etc/passwd']) {
    assert.equal(validRedirectUri(bad), false, bad);
  }
});

test('registration rejects bad metadata', async () => {
  const e = env();
  assert.equal((await register(post({ redirect_uris: [] }), e)).status, 400);
  assert.equal((await register(post({ redirect_uris: ['http://evil.example/cb'] }), e)).status, 400);
  assert.equal((await register(post({ redirect_uris: ['https://ok.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }), e)).status, 400);
});

test('happy path: code -> token returns the access key, redirect carries state and iss', async () => {
  const e = env();
  const { clientId, accessKey, redirect, code } = await issueCode(e);
  assert.equal(redirect.origin + redirect.pathname, 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(redirect.searchParams.get('state'), 'st4te');
  assert.equal(redirect.searchParams.get('iss'), ORIGIN);
  assert.equal(e.DB.tables.oauth_requests.size, 0, 'request consumed');
  const r = await token(post({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', resource: `${ORIGIN}/mcp` }, 'application/x-www-form-urlencoded'), e, ORIGIN);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.access_token, accessKey);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('codes are single use, even after a failed attempt', async () => {
  const e = env();
  const { clientId, code } = await issueCode(e);
  const ok = { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId };
  assert.equal((await token(post(ok), e, ORIGIN)).status, 200);
  const again = await token(post(ok), e, ORIGIN);
  assert.equal(again.status, 400);
  assert.equal((await again.json()).error, 'invalid_grant');
});

test('token is refused for wrong verifier, wrong client, wrong redirect, wrong resource', async () => {
  const cases = [
    ['wrong verifier', (b) => ({ ...b, code_verifier: 'w'.repeat(50) })],
    ['missing verifier', (b) => ({ ...b, code_verifier: undefined })],
    ['wrong client', (b) => ({ ...b, client_id: 'client_someoneelse' })],
    ['wrong redirect', (b) => ({ ...b, redirect_uri: 'https://claude.ai/other' })],
    ['wrong resource', (b) => ({ ...b, resource: 'https://other.example/mcp' })],
  ];
  for (const [name, mutate] of cases) {
    const e = env();
    const { clientId, code } = await issueCode(e);
    const body = JSON.parse(JSON.stringify(mutate({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId })));
    const r = await token(post(body), e, ORIGIN);
    assert.equal(r.status, 400, name);
    assert.equal(e.DB.tables.oauth_codes.size, 0, `${name}: code burned`);
  }
});

test('authorize: unknown client and unregistered redirect show an error page, never redirect', async () => {
  const e = env();
  const challenge = await sha256B64url(verifier);
  assert.ok((await startAuthorization(await authorizeUrl('client_nope', { challenge }), e)).error);
  const clientId = await registeredClient(e);
  const r = await startAuthorization(await authorizeUrl(clientId, { challenge, redirect: 'https://evil.example/cb' }), e);
  assert.ok(r.error && !r.response);
});

test('authorize: missing PKCE or wrong resource redirects back with an error', async () => {
  const e = env();
  const clientId = await registeredClient(e);
  const noPkce = await startAuthorization(await authorizeUrl(clientId, { challenge: undefined }), e);
  assert.equal(new URL(noPkce.response.headers.get('Location')).searchParams.get('error'), 'invalid_request');
  const plain = await startAuthorization(await authorizeUrl(clientId, { challenge: await sha256B64url(verifier), extra: { code_challenge_method: 'plain' } }), e);
  assert.equal(new URL(plain.response.headers.get('Location')).searchParams.get('error'), 'invalid_request');
  const target = await startAuthorization(await authorizeUrl(clientId, { challenge: await sha256B64url(verifier), extra: { resource: 'https://other.example/mcp' } }), e);
  assert.equal(new URL(target.response.headers.get('Location')).searchParams.get('error'), 'invalid_target');
});

test('cancel returns access_denied to the app and ends the request', async () => {
  const e = env();
  const clientId = await registeredClient(e);
  const start = await startAuthorization(await authorizeUrl(clientId, { challenge: await sha256B64url(verifier) }), e);
  const back = new URL(await denyAuthorization(e, start.request.id, ORIGIN));
  assert.equal(back.searchParams.get('error'), 'access_denied');
  assert.equal(back.searchParams.get('state'), 'st4te');
  assert.equal(await denyAuthorization(e, start.request.id, ORIGIN), null);
});

test('revoking the access token deletes the user', async () => {
  const e = env();
  const key = newSecret('tpm');
  const id = await sha256Hex(key);
  e.DB.tables.users.set(id, { id });
  let revoked = null;
  const r = await revoke(post({ token: key }, 'application/x-www-form-urlencoded'), e, (u) => { revoked = u; });
  assert.equal(r.status, 200);
  assert.equal(e.DB.tables.users.has(id), false);
  assert.equal(revoked, id);
});
