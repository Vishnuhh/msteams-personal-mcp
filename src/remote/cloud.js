// Cloud spend: real usage from Cloudflare's GraphQL Analytics API, compared with the free plan's limits,
// plus what the same usage would cost on the paid plan.
// Needs CF_ANALYTICS_TOKEN (a read-only "Account Analytics" token) and CF_ACCOUNT_ID; D1_DATABASE_ID for database numbers.

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (t) => new Date(t).toISOString().slice(0, 10);

// Workers Free plan limits (per day) and D1 free limits.
export const FREE = { requests: 100_000, d1RowsRead: 5_000_000, d1RowsWritten: 100_000, d1StorageBytes: 5 * 1024 ** 3 };

// Paid list prices (USD), for the projection only. Check cloudflare.com/plans for current prices.
export const PAID = {
  base: 5,
  includedRequests: 10_000_000, perMillionRequests: 0.30,
  includedCpuMs: 30_000_000, perMillionCpuMs: 0.02,
  includedRowsRead: 25_000_000_000, perMillionRowsRead: 0.001,
  includedRowsWritten: 50_000_000, perMillionRowsWritten: 1.0,
  includedStorageGb: 5, perGbMonth: 0.75,
};

/** Monthly cost on the paid plan for a month's usage (pure, tested). */
export function estimatePaidMonthly({ requests = 0, cpuMs = 0, rowsRead = 0, rowsWritten = 0, storageBytes = 0 }) {
  const over = (used, included, perMillion) => Math.max(0, used - included) / 1e6 * perMillion;
  const parts = {
    base: PAID.base,
    requests: over(requests, PAID.includedRequests, PAID.perMillionRequests),
    cpu: over(cpuMs, PAID.includedCpuMs, PAID.perMillionCpuMs),
    rowsRead: over(rowsRead, PAID.includedRowsRead, PAID.perMillionRowsRead),
    rowsWritten: over(rowsWritten, PAID.includedRowsWritten, PAID.perMillionRowsWritten),
    storage: Math.max(0, storageBytes / 1024 ** 3 - PAID.includedStorageGb) * PAID.perGbMonth,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total: Math.round(total * 100) / 100, parts };
}

const QUERY = `query ($account: String!, $script: String!, $db: String!, $from: Date!, $to: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workers: workersInvocationsAdaptive(limit: 100, filter: { scriptName: $script, date_geq: $from, date_leq: $to }) {
      sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { date }
    }
    d1: d1AnalyticsAdaptiveGroups(limit: 100, filter: { databaseId: $db, date_geq: $from, date_leq: $to }) {
      sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date }
    }
    storage: d1StorageAdaptiveGroups(limit: 1, filter: { databaseId: $db, date_geq: $from, date_leq: $to }, orderBy: [date_DESC]) {
      max { databaseSizeBytes } dimensions { date }
    }
  } }
}`;

let cache = null; // { at, data } — analytics lag a few minutes anyway; avoid hammering the API

export async function cloudUsage(env, now = Date.now()) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
    return { configured: false, note: 'Add a read-only Cloudflare analytics token (CF_ANALYTICS_TOKEN) to see real cloud usage and cost.' };
  }
  if (cache && now - cache.at < 5 * 60 * 1000) return cache.data;
  const monthStart = day(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: { account: env.CF_ACCOUNT_ID, script: env.CF_SCRIPT_NAME || 'msteams-personal-mcp', db: env.D1_DATABASE_ID || '', from: monthStart, to: day(now) },
    }),
  });
  const body = await res.json().catch(() => ({}));
  const acct = body?.data?.viewer?.accounts?.[0];
  if (!res.ok || body.errors?.length || !acct) {
    return { configured: true, error: (body.errors?.[0]?.message || `Cloudflare analytics returned ${res.status}`).slice(0, 200) };
  }
  const today = day(now);
  const perDay = {};
  const bucket = (d) => (perDay[d] ||= { day: d, requests: 0, errors: 0, subrequests: 0, cpuP50: 0, cpuP99: 0, rowsRead: 0, rowsWritten: 0 });
  for (const w of acct.workers || []) {
    const b = bucket(w.dimensions.date);
    b.requests += w.sum.requests; b.errors += w.sum.errors; b.subrequests += w.sum.subrequests;
    b.cpuP50 = Math.max(b.cpuP50, w.quantiles?.cpuTimeP50 || 0); b.cpuP99 = Math.max(b.cpuP99, w.quantiles?.cpuTimeP99 || 0);
  }
  for (const d of acct.d1 || []) {
    const b = bucket(d.dimensions.date);
    b.rowsRead += d.sum.rowsRead; b.rowsWritten += d.sum.rowsWritten;
  }
  const days = Object.values(perDay).sort((a, b) => a.day.localeCompare(b.day));
  const t = perDay[today] || bucket(today);
  const month = days.reduce((m, d) => ({
    requests: m.requests + d.requests, errors: m.errors + d.errors, rowsRead: m.rowsRead + d.rowsRead, rowsWritten: m.rowsWritten + d.rowsWritten,
    cpuMs: m.cpuMs + d.requests * (d.cpuP50 / 1000), // cpuTime quantiles are in microseconds; p50 × requests ≈ total
  }), { requests: 0, errors: 0, rowsRead: 0, rowsWritten: 0, cpuMs: 0 });
  const storageBytes = acct.storage?.[0]?.max?.databaseSizeBytes || 0;
  const dayOfMonth = new Date(now).getUTCDate();
  const projected = Object.fromEntries(Object.entries(month).map(([k, v]) => [k, Math.round((v / dayOfMonth) * 30)]));
  const pct = (used, limit) => Math.round((used / limit) * 1000) / 10;
  const data = {
    configured: true,
    plan: 'Workers Free',
    costNow: 0,
    today: { requests: t.requests, errors: t.errors, rowsRead: t.rowsRead, rowsWritten: t.rowsWritten, cpuP50Ms: Math.round(t.cpuP50) / 1000, cpuP99Ms: Math.round(t.cpuP99) / 1000 },
    limits: [
      { label: 'Requests today', used: t.requests, limit: FREE.requests, percent: pct(t.requests, FREE.requests) },
      { label: 'Database rows read today', used: t.rowsRead, limit: FREE.d1RowsRead, percent: pct(t.rowsRead, FREE.d1RowsRead) },
      { label: 'Database rows written today', used: t.rowsWritten, limit: FREE.d1RowsWritten, percent: pct(t.rowsWritten, FREE.d1RowsWritten) },
      { label: 'Database storage', used: storageBytes, limit: FREE.d1StorageBytes, percent: pct(storageBytes, FREE.d1StorageBytes) },
    ],
    month,
    projectedMonth: projected,
    paidEstimate: estimatePaidMonthly({ ...projected, storageBytes }),
    days,
    asOf: new Date(now).toISOString(),
  };
  cache = { at: now, data };
  return data;
}

export { DAY_MS };
