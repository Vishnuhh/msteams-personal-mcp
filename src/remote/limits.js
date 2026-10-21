// Per-person limits for MCP tool calls on the remote server.
//   heavy (fans out across many chats): HEAVY_LIMITER per minute
//   write / destructive (changes Teams): WRITE_LIMITER per minute + a daily cap counted in D1

export const DAILY_WRITE_CAP = 200;

export async function limit(env, binding, key) {
  const limiter = env[binding];
  if (!limiter) return true;
  const { success } = await limiter.limit({ key: `${binding}:${key}` });
  return success;
}

/** Returns beforeCall(name, kind) for registerTeamsTools; throws a friendly error to refuse a call. */
export function toolGuard(env, userId, { onLimited = () => {}, today = () => new Date().toISOString().slice(0, 10), cap = DAILY_WRITE_CAP } = {}) {
  return async (name, kind) => {
    if (kind === 'heavy' && !(await limit(env, 'HEAVY_LIMITER', userId))) {
      onLimited('rate_limited_heavy');
      throw new Error('That kind of search runs across many chats; you have used it a lot this minute. Wait a minute and try again.');
    }
    if (kind === 'write' || kind === 'destructive') {
      if (!(await limit(env, 'WRITE_LIMITER', userId))) {
        onLimited('rate_limited_write');
        throw new Error('Too many changes in a minute (sends, reactions, edits). Wait a minute and try again.');
      }
      const row = await env.DB.prepare('INSERT INTO usage (user_id, day, writes) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET writes = writes + 1 RETURNING writes')
        .bind(userId, today()).first();
      if (row && row.writes > cap) {
        onLimited('daily_write_cap');
        throw new Error(`Daily limit of ${cap} changes reached for this connection. It resets at midnight UTC.`);
      }
    }
  };
}
