// /admin and /admin/* routing. Every change needs a signed-in admin session (ADMIN_TOKEN is read-only), the
// X-Admin header (other sites cannot send it), and is written to the audit log.
import {
  adminConfigured, login, logout, adminFrom, listSessions, endSessions, audit, auditLog,
  twoFactorStatus, startTwoFactor, confirmTwoFactor, disableTwoFactor,
} from './admin-auth.js';
import {
  overview, peopleList, connectionsList, person, setPersonMeta, personCsvResponse, endPerson, setPersonLimit, endConnection, paging, renderAdminPage,
} from './admin.js';
import {
  setMode, accessCounts, accessPeople, accessGroups, groupDetail, renameGroup, accessInvites, editInvite, bulkAccess,
  addGroup, removeGroup, createInvite, revokeInvite, personAccess,
} from './access.js';
import { adminTeamsInfo, teamsStatus, startLink, pollLink, unlink, myGroups, adminMembership } from './admin-teams.js';
import { issuesReport } from './diagnostics.js';
import { serverSettings, settingsView, updateSettings, resetSetting } from './settings.js';
import { sendTestEmail } from './alert-mail.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const ok = (r) => r.status < 400;
const GROUP_RE = /^19:[A-Za-z0-9_.-]+@thread\.(v2|skype)$/;

/**
 * @param deps { version, html, stat, recordEvent, forgetTokens(userIdOrAll), modeOf }
 */
export async function handleAdmin(request, env, url, ctx, deps) {
  const path = url.pathname;
  const method = request.method;
  const country = request.cf?.country || null;

  if ((path === '/admin' || path === '/admin/') && method === 'GET') return deps.html(renderAdminPage({ configured: adminConfigured(env) }), 200, { fonts: false });

  if (path === '/admin/login' && method === 'POST') {
    const r = await login(request, env, {
      country, agent: request.headers.get('User-Agent'),
      onFail: (why) => {
        deps.stat(env, ctx, 'admin_signin_failed');
        deps.recordEvent(env, ctx, { kind: 'admin_signin_failed', detail: `${why === 'code' ? 'Wrong two-factor code' : 'Wrong username or password'}, from ${country || 'an unknown country'}` });
      },
    });
    if (r.ok) audit(env, ctx, { action: 'signed in', sessionId: r.sessionId, country });
    return r.response;
  }

  // Changes need a custom header, which other sites cannot send (the admin API answers no CORS preflight with it).
  if (method === 'POST' && request.headers.get('X-Admin') !== '1') return json({ error: 'Missing X-Admin header.' }, 400);
  const who = await adminFrom(request, env);
  if (path === '/admin/logout' && method === 'POST') {
    if (who.ok && who.sessionId) audit(env, ctx, { action: 'signed out', sessionId: who.sessionId, country });
    return logout(request, env);
  }
  if (!who.ok) {
    if (who.readOnly) return json({ error: 'ADMIN_TOKEN can only read. Sign in at /admin to make changes.' }, 403);
    return json({ error: who.expired ? 'Your session ended.' : 'Sign in at /admin.' }, 401);
  }
  const log = (action, target = null, detail = null) => audit(env, ctx, { action, target, detail, sessionId: who.sessionId, country });
  const s = await serverSettings(env);
  const mode = await deps.modeOf(env);
  const adminKey = async () => (await adminTeamsInfo(env)).key;
  const pg = paging(url);
  const body = async () => request.clone().json().catch(() => ({}));

  // ---------------------------------------------------------------- reading
  if (method === 'GET') {
    if (path === '/admin/api/overview' || path === '/admin/stats') {
      const counts = await accessCounts(env, mode);
      return json(await overview(env, {
        version: deps.version,
        settings: { ...settingsView(s), restricted: mode.restricted, dailyCap: s.dailyCap, inactiveDays: s.inactiveDays },
        access: { restricted: mode.restricted, waiting: counts.requests + counts.review },
      }));
    }
    if (path === '/admin/api/people') return peopleList(env, url, { settings: s });
    if (path === '/admin/api/connections') return connectionsList(env, url, { settings: s });
    if (path === '/admin/api/issues') {
      const q = url.searchParams;
      const pick = (k, re) => (re.test(q.get(k) || '') ? q.get(k) : null);
      return json(await issuesReport(env, {
        kind: pick('kind', /^[a-z_]{3,30}$/), key: pick('key', /^[0-9a-f]{64}$/), tool: pick('tool', /^teams_[a-z_]{2,40}$/), day: pick('day', /^\d{4}-\d{2}-\d{2}$/),
        page: pg.page, size: Math.min(50, Number(q.get('size')) || 25),
      }));
    }
    if (path === '/admin/api/access/summary') {
      const [counts, teams] = await Promise.all([accessCounts(env, mode), adminTeamsInfo(env)]);
      return json({ restricted: mode.restricted, restrictedSince: mode.since ? new Date(mode.since).toISOString() : null, counts, teams });
    }
    if (path === '/admin/api/access/people') return accessPeople(env, { ...pg, status: url.searchParams.get('status') }, { adminKey: await adminKey() });
    if (path === '/admin/api/access/groups') return accessGroups(env, pg);
    if (path === '/admin/api/access/group') return groupDetail(env, url.searchParams.get('id'), pg);
    if (path === '/admin/api/access/invites') return accessInvites(env, pg, url.searchParams.get('state'));
    if (path === '/admin/api/access/my-groups') return myGroups(env, pg, { refresh: url.searchParams.get('refresh') === '1' });
    if (path === '/admin/api/teams') return teamsStatus(env);
    if (path === '/admin/api/settings') return json({ settings: settingsView(s), twoFactor: await twoFactorStatus(env) });
    if (path === '/admin/api/security/sessions') return json({ items: await listSessions(env, who.sessionId) });
    if (path === '/admin/api/audit') return json(await auditLog(env, { ...pg, size: Math.min(50, Number(url.searchParams.get('size')) || 20) }));
    const p = path.match(/^\/admin\/api\/person\/([^/]+)(?:\/(csv))?$/);
    if (p) {
      const key = decodeURIComponent(p[1]);
      return p[2] === 'csv' ? personCsvResponse(env, key) : person(env, key, { settings: s });
    }
    return json({ error: 'Not found' }, 404);
  }

  // ---------------------------------------------------------------- changes (session only, all audited)
  if (method !== 'POST' || who.via !== 'session') return json({ error: 'Not found' }, 404);

  if (path === '/admin/api/access/mode') {
    const b = await body(); const r = await setMode(request, env, mode);
    if (ok(r)) log(`access ${b.mode === 'open' ? 'opened to everyone' : 'restricted'}`);
    return r;
  }
  if (path === '/admin/api/access/groups') {
    const b = await body();
    if (GROUP_RE.test(String(b.conversationId || '')) && !b.force) {
      const m = await adminMembership(env, b.conversationId);
      if (m.linked && m.member === false) return json({ error: 'Your linked Teams account is not in that group chat, so its members could not be checked by you. Add it anyway?', notMember: true }, 409);
    }
    const r = await addGroup(request, env);
    if (ok(r)) log('group added', b.name || b.conversationId);
    return r;
  }
  if (path === '/admin/api/access/groups/remove') { const b = await body(); const r = await removeGroup(request, env); if (ok(r)) log('group removed', b.conversationId); return r; }
  if (path === '/admin/api/access/groups/rename') { const b = await body(); const r = await renameGroup(request, env); if (ok(r)) log('group renamed', b.conversationId, b.name); return r; }
  if (path === '/admin/api/access/invites') { const b = await body(); const r = await createInvite(request, env, url.origin); if (ok(r)) log('invite created', b.label || 'no label', `${b.uses ?? 1} uses, ${b.days ?? 7} days`); return r; }
  const inv = path.match(/^\/admin\/api\/access\/invites\/([0-9a-f]{64})\/(revoke|edit)$/);
  if (inv) {
    if (inv[2] === 'revoke') { const r = await revokeInvite(env, inv[1]); if (ok(r)) log('invite revoked', inv[1].slice(0, 12)); return r; }
    const r = await editInvite(request, env, inv[1]);
    if (ok(r)) { const j = await r.clone().json(); log('invite edited', inv[1].slice(0, 12), j.changes?.join(', ')); }
    return r;
  }
  if (path === '/admin/api/access/bulk') {
    const b = await body();
    const r = await bulkAccess(request, env, { adminKey: await adminKey() });
    if (ok(r)) { if (b.action === 'block' || b.action === 'remove') deps.forgetTokens(); const j = await r.clone().json(); log(`bulk ${b.action}`, `${j.done} people`); }
    return r;
  }
  const acc = path.match(/^\/admin\/api\/access\/people\/([0-9a-f]{64})\/(approve|block|remove|unblock)$/);
  if (acc) {
    if (acc[2] === 'block' || acc[2] === 'remove') deps.forgetTokens();
    const r = await personAccess(env, acc[1], acc[2], { adminKey: await adminKey() });
    if (ok(r)) log(`person ${acc[2] === 'approve' ? 'approved' : acc[2] === 'block' ? 'blocked' : acc[2] === 'remove' ? 'removed' : 'unblocked'}`, acc[1].slice(0, 12));
    return r;
  }
  if (path === '/admin/api/teams/link/start') return startLink(env);
  if (path === '/admin/api/teams/link/poll') { const r = await pollLink(env); if (ok(r)) { const j = await r.clone().json(); if (j.status === 'linked') log('Teams account linked', j.name); } return r; }
  if (path === '/admin/api/teams/unlink') { const r = await unlink(env); log('Teams account unlinked'); return r; }
  const end = path.match(/^\/admin\/api\/connections\/([0-9a-f]{64})\/end$/);
  if (end) {
    deps.forgetTokens(end[1]);
    deps.stat(env, ctx, 'admin_ended_connection');
    const r = await endConnection(env, end[1]);
    log('connection ended', end[1].slice(0, 12));
    return r;
  }
  const p = path.match(/^\/admin\/api\/person\/([^/]+)\/(end|limit|meta)$/);
  if (p) {
    const key = decodeURIComponent(p[1]);
    if (p[2] === 'end') { deps.forgetTokens(); deps.stat(env, ctx, 'admin_ended_connection'); const r = await endPerson(env, key); log('all connections ended', key.slice(0, 12)); return r; }
    if (p[2] === 'limit') { const b = await body(); const r = await setPersonLimit(request, env, key); if (ok(r)) log('daily change cap set', key.slice(0, 12), b.dailyWrites === null ? 'default' : String(b.dailyWrites)); return r; }
    if (p[2] === 'meta') { const r = await setPersonMeta(request, env, key); if (ok(r)) log('person details edited', key.slice(0, 12)); return r; }
  }
  if (path === '/admin/api/settings') {
    const r = await updateSettings(request, env);
    if (ok(r.response)) log('settings changed', null, r.changes.join(', '));
    return r.response;
  }
  if (path === '/admin/api/settings/test-email') {
    const r = await sendTestEmail(env);
    if (r.ok) log('test email sent', env.ALERT_EMAIL_TO);
    return json(r.ok ? { ok: true, to: env.ALERT_EMAIL_TO } : { error: r.error }, r.ok ? 200 : 400);
  }
  if (path === '/admin/api/settings/reset') { const b = await body(); const r = await resetSetting(env, b.key); if (ok(r)) log('setting reset to default', b.key); return r; }
  if (path === '/admin/api/security/2fa/start') return startTwoFactor(env);
  if (path === '/admin/api/security/2fa/confirm') { const r = await confirmTwoFactor(request, env); if (ok(r)) log('two-factor turned on'); return r; }
  if (path === '/admin/api/security/2fa/disable') { const r = await disableTwoFactor(request, env); if (ok(r)) log('two-factor turned off'); return r; }
  if (path === '/admin/api/security/sessions/end') {
    const b = await body();
    const r = await endSessions(env, b.all ? { allExcept: who.sessionId } : { id: b.id });
    if (ok(r)) log(b.all ? 'signed out all other sessions' : 'ended a session', b.all ? null : b.id);
    return r;
  }
  return json({ error: 'Not found' }, 404);
}
