// Sign-in page served at "/". Plain HTML + a little JS; no external assets.
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderPage({ repoUrl = 'https://github.com/' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Teams Personal MCP</title>
<style>
  :root { --bg:#f7f7f9; --card:#fff; --text:#1c1c24; --muted:#5d5d6e; --line:#e3e3ea; --accent:#4f52b2; --accent-text:#fff; --code:#f0f0f5; --ok:#1d7a46; --err:#b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14141a; --card:#1d1d26; --text:#ececf2; --muted:#a3a3b5; --line:#2e2e3a; --accent:#7f85f5; --accent-text:#0e0e14; --code:#262632; --ok:#5fd394; --err:#ff8a80; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:720px; margin:0 auto; padding:40px 16px 64px; }
  h1 { font-size:1.6rem; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 28px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:22px; margin-bottom:18px; }
  h2 { font-size:1.05rem; margin:0 0 10px; }
  ol { padding-left:20px; margin:8px 0 0; }
  button { font:inherit; font-weight:600; background:var(--accent); color:var(--accent-text); border:0; border-radius:8px; padding:10px 18px; cursor:pointer; }
  button.secondary { background:transparent; color:var(--accent); border:1px solid var(--line); padding:6px 12px; font-weight:500; }
  button:disabled { opacity:.6; cursor:default; }
  .code { font:600 1.9rem/1.2 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.12em; margin:10px 0; }
  pre { background:var(--code); border:1px solid var(--line); border-radius:8px; padding:12px; overflow-x:auto; font:13px/1.5 ui-monospace,Consolas,monospace; margin:8px 0; white-space:pre-wrap; word-break:break-all; }
  .muted { color:var(--muted); font-size:.92rem; }
  .ok { color:var(--ok); font-weight:600; }
  .err { color:var(--err); font-weight:600; }
  .row { display:flex; gap:8px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  a { color:var(--accent); }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>Teams Personal MCP</h1>
  <p class="sub">Connect Claude and other MCP clients to your <strong>personal</strong> Microsoft Teams (teams.live.com).</p>

  <section class="card" id="start">
    <h2>1. Sign in with your personal Microsoft account</h2>
    <p class="muted">You approve sign-in on Microsoft's own page. This server never sees your password.</p>
    <button id="startBtn">Get sign-in code</button>
    <p id="startErr" class="err" hidden></p>
  </section>

  <section class="card" id="code" hidden>
    <h2>2. Enter this code at Microsoft</h2>
    <div class="code" id="userCode"></div>
    <ol>
      <li>Open <a id="verifyLink" target="_blank" rel="noopener">microsoft.com/devicelogin</a></li>
      <li>Enter the code above and sign in with the account you use on <strong>teams.live.com</strong></li>
      <li>Approve, then come back here. This page updates automatically.</li>
    </ol>
    <p class="muted" id="pollStatus">Waiting for approval…</p>
  </section>

  <section class="card" id="done" hidden>
    <h2 class="ok">3. You're connected</h2>
    <p>Your personal MCP URL. <strong>Treat it like a password</strong>: anyone with it can read and send your Teams messages. It is shown only once.</p>
    <div class="row"><strong>MCP URL</strong><button class="secondary" data-copy="mcpUrl">Copy</button></div>
    <pre id="mcpUrl"></pre>

    <h2 style="margin-top:18px">Add it to your client</h2>
    <div class="row"><strong>Claude Code</strong><button class="secondary" data-copy="cc">Copy</button></div>
    <pre id="cc"></pre>
    <p class="muted"><strong>Claude (web / desktop):</strong> Settings → Connectors → Add custom connector → paste the MCP URL.</p>
    <div class="row"><strong>Cursor / VS Code / other clients (JSON)</strong><button class="secondary" data-copy="json">Copy</button></div>
    <pre id="json"></pre>
    <p class="muted">To revoke access later, ask your assistant to run <code>teams_logout</code>. That deletes your sign-in from this server and the URL stops working.</p>
  </section>

  <p class="muted">Open source · uses undocumented Teams personal APIs that may change · <a href="${escapeAttr(repoUrl)}">source on GitHub</a></p>
</main>
<script>
const $ = (id) => document.getElementById(id);
let loginId = null, timer = null;

$('startBtn').onclick = async () => {
  $('startBtn').disabled = true; $('startErr').hidden = true;
  try {
    const r = await fetch('/api/login/start', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Could not start sign-in');
    loginId = j.loginId;
    $('userCode').textContent = j.userCode;
    $('verifyLink').href = j.verificationUrl;
    $('verifyLink').textContent = j.verificationUrl.replace(/^https?:\\/\\//, '');
    $('code').hidden = false;
    schedule(j.interval);
  } catch (e) {
    $('startErr').textContent = e.message; $('startErr').hidden = false; $('startBtn').disabled = false;
  }
};

function schedule(sec) { clearTimeout(timer); timer = setTimeout(poll, Math.max(3, sec) * 1000); }

async function poll() {
  try {
    const r = await fetch('/api/login/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId }) });
    const j = await r.json();
    if (j.status === 'approved') return showDone(j);
    if (j.status === 'pending') return schedule(j.interval || 5);
    throw new Error(j.error || 'Sign-in failed');
  } catch (e) {
    $('pollStatus').textContent = e.message + ' Reload the page to try again.';
    $('pollStatus').className = 'err';
  }
}

function showDone(j) {
  $('start').hidden = true; $('code').hidden = true; $('done').hidden = false;
  $('mcpUrl').textContent = j.mcpUrl;
  $('cc').textContent = 'claude mcp add --transport http teams-personal ' + j.mcpUrl;
  $('json').textContent = JSON.stringify({ mcpServers: { 'teams-personal': { type: 'http', url: j.mcpUrl } } }, null, 2);
}

document.addEventListener('click', (e) => {
  const id = e.target.getAttribute && e.target.getAttribute('data-copy');
  if (!id) return;
  navigator.clipboard.writeText($(id).textContent).then(() => {
    e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1500);
  });
});
</script>
</body>
</html>`;
}
