// Home page served at "/". Self-contained HTML, CSS and JS (only the Switzer font is external).
// Art direction: "The sentence is the layout" (taste skill, seed 520265479): the frame inside
// "Your Teams, [frame] in Claude." holds the one thing you need: the address to add, or your sign-in code.
// Kept deliberately short: one screen to connect, three lines of how-to, three notes.

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderPage({ repoUrl = 'https://github.com/', version = '', accessCodeRequired = false, personalUrls = true, restricted = false } = {}) {
  const repo = escapeAttr(repoUrl);
  const access = accessCodeRequired
    ? '<div class="access"><label for="accessCode">Team access code</label><input id="accessCode" autocomplete="off" spellcheck="false"></div>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Teams Personal MCP</title>
<meta name="description" content="Connect Claude, Cursor or VS Code to your personal Microsoft Teams.">
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #ffffff; --surface: #f2f2f2; --ink: #0a0a0a; --muted: #5c5c5c;
  --accent: #d92b21; --accent-press: #b8231b; --accent-ink: #ffffff;
  --step-small: clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem);
  --step-body: clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem);
  --step-statement: clamp(1.375rem, 1rem + 1.1vw, 2rem);
  --step-head: clamp(2rem, 1.3rem + 3.2vw, 4rem);
  --step-display: clamp(2.75rem, 1rem + 5.4vw, 5.75rem);
  --margin: clamp(16px, 2.2vw, 32px);
  --radius: 4px;
  --ease: cubic-bezier(.2,.7,.2,1);
  --font: "Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 var(--step-body)/1.5 var(--font); letter-spacing: -0.005em; }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
::selection { background: var(--accent); color: var(--accent-ink); }
h1, h2 { font-weight: 600; letter-spacing: -0.04em; line-height: 0.95; margin: 0; }
p { margin: 0; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.9em; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.btn { display: inline-flex; align-items: center; justify-content: center; font: 500 var(--step-body)/1 var(--font); letter-spacing: -0.01em;
  background: var(--accent); color: var(--accent-ink); border: 0; border-radius: var(--radius); padding: .9em 1.25em; cursor: pointer;
  transition: transform .18s var(--ease), background-color .18s var(--ease); }
.btn:hover { background: var(--accent-press); }
.btn:active { transform: scale(.97); }
.btn[disabled] { cursor: progress; opacity: .7; }
.textbtn { font: inherit; background: none; border: 0; padding: .3em 0; color: var(--muted); cursor: pointer; text-decoration: underline;
  text-underline-offset: .2em; text-decoration-thickness: 1px; transition: color .18s; }
.textbtn:hover { color: var(--ink); }

/* nav */
.nav { display: flex; align-items: center; justify-content: space-between; padding: 18px var(--margin); }
.nav .word { font-weight: 600; letter-spacing: -0.03em; text-decoration: none; }
.nav .link { font-size: var(--step-small); font-weight: 500; text-decoration: none; transition: opacity .18s; }
.nav .link:hover { opacity: .6; }

/* hero: one screen, the frame inside the sentence */
.hero { min-height: calc(100svh - 64px); display: flex; flex-direction: column; justify-content: center; gap: clamp(36px, 6vw, 72px);
  padding: 8px var(--margin) 40px; }
.sentence { display: grid; grid-template-columns: 1fr minmax(0, 36vw) 1fr; align-items: center; column-gap: clamp(16px, 2vw, 32px); }
.half { font-size: var(--step-display); font-weight: 600; letter-spacing: -0.045em; line-height: .95; white-space: nowrap; }
.half.l { grid-column: 1; grid-row: 1; }
.half.r { grid-column: 3; grid-row: 1; justify-self: end; text-align: right; }
.frame { grid-column: 2; grid-row: 1; aspect-ratio: 16 / 9; background: var(--surface); border-radius: var(--radius);
  display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: clamp(16px, 1.8vw, 28px); min-width: 0; }
.frame .lbl { font-size: var(--step-small); color: var(--muted); }
.frame .addr { font-weight: 600; letter-spacing: -0.02em; font-size: clamp(1.0625rem, 0.75rem + 0.8vw, 1.5rem); line-height: 1.15; overflow-wrap: anywhere; }
.frame { container-type: inline-size; }
/* The sign-in code: one line, no spaces, sized to the frame, selected whole on click, so copy-paste is exact. */
.frame .code { font-weight: 600; letter-spacing: .06em; font-size: min(var(--step-head), 13cqi); line-height: 1; color: var(--accent);
  font-variant-numeric: tabular-nums; white-space: nowrap; user-select: all; cursor: text; }
.frame .code.done { color: var(--ink); letter-spacing: -0.03em; }
.frame .copy { align-self: flex-start; font-size: var(--step-small); padding: .7em 1em; }
.frame .lbl a { font-weight: 500; }
.foot { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; row-gap: 16px; align-items: end; }
.foot .lead { grid-column: 1 / 7; max-width: 40ch; }
.foot .alt { grid-column: 8 / 13; justify-self: end; text-align: right; display: grid; gap: 4px; justify-items: end; }
.status { font-size: var(--step-small); color: var(--muted); max-width: 38ch; min-height: 1.5em; }
.access { display: grid; gap: 6px; justify-items: inherit; }
.access label { font-size: var(--step-small); color: var(--muted); }
.access input { font: 500 var(--step-body)/1.2 var(--font); padding: .7em .9em; border: 0; border-radius: var(--radius); background: var(--surface); color: var(--ink); width: min(260px, 100%); }
.access input:focus { outline: 3px solid var(--accent); outline-offset: 2px; }

.status.err { color: var(--accent); }

/* your personal URL (after sign-in) */
.yours { background: var(--ink); color: #fff; padding: clamp(48px, 7vw, 96px) var(--margin); display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; row-gap: 24px; }
.yours[hidden] { display: none; }
.yours h2 { grid-column: 1 / 6; font-size: var(--step-head); }
.yours .box { grid-column: 7 / 13; display: grid; gap: 12px; }
.yours pre { margin: 0; background: #1d1d1d; border-radius: var(--radius); padding: 16px; white-space: pre-wrap; word-break: break-all; font-size: var(--step-small); }
.yours .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.yours .lightbtn { font: 500 var(--step-small)/1 var(--font); background: #fff; color: var(--ink); border: 0; border-radius: var(--radius); padding: .7em 1em; cursor: pointer; transition: transform .15s; }
.yours .lightbtn:active { transform: scale(.96); }
.yours p { color: #c9c9c9; font-size: var(--step-small); }

/* connect + notes: short rows, heading left, content right */
.rows { padding: clamp(72px, 9vw, 128px) var(--margin) 0; display: grid; gap: clamp(56px, 7vw, 96px); }
.rowblock { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; row-gap: 16px; }
.rowblock h2 { grid-column: 1 / 6; font-size: var(--step-statement); font-weight: 500; letter-spacing: -0.03em; line-height: 1.1; }
.rowblock ul { grid-column: 7 / 13; list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
.rowblock li b { font-weight: 600; }

/* footer: this server's address */
.end { background: var(--accent); color: var(--accent-ink); margin-top: clamp(72px, 9vw, 128px); padding: 32px var(--margin) 24px; display: grid; gap: clamp(40px, 6vw, 72px); }
.end .top { display: flex; justify-content: space-between; gap: 16px; font-size: var(--step-small); }
.end .big { display: inline-block; font-weight: 600; letter-spacing: -0.05em; line-height: .92; text-decoration: none; white-space: nowrap; max-width: 100%; transition: opacity .2s; }
.end .big:hover { opacity: .85; }
.end .meta { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; font-size: var(--step-small); }

.rise { animation: rise .7s var(--ease) both; animation-delay: calc(var(--i, 0) * 80ms); }
@keyframes rise { from { opacity: 0; transform: translateY(20px); } }
.reveal { opacity: 0; transform: translateY(20px); transition: opacity .6s var(--ease), transform .6s var(--ease); transition-delay: calc(var(--i, 0) * 70ms); }
.reveal.in { opacity: 1; transform: none; }
.pulse { animation: pulse 1.6s var(--ease) infinite; }
@keyframes pulse { 50% { opacity: .55; } }

@media (max-width: 760px) {
  .hero { min-height: 0; justify-content: flex-start; padding-top: 24px; }
  .sentence { display: flex; flex-direction: column; align-items: stretch; gap: 16px; }
  .half { font-size: 13vw; white-space: normal; }
  .half.r { align-self: flex-end; }
  .frame { aspect-ratio: auto; min-height: 200px; }
  .foot { display: flex; flex-direction: column; align-items: stretch; }
  .foot .alt { justify-items: start; text-align: left; justify-self: start; }
  .yours h2, .yours .box, .rowblock h2, .rowblock ul { grid-column: 1 / -1; }
  .end .top, .end .meta { flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) { .rise, .pulse { animation: none; } .reveal { opacity: 1; transform: none; transition: none; } }
</style>
</head>
<body>
<nav class="nav" aria-label="Main">
  <a class="word" href="/">Teams Personal MCP</a>
  <span><a class="link" href="/changelog">Changelog</a> &nbsp; <a class="link" href="${repo}">Source on GitHub</a></span>
</nav>

<main>
<section class="hero" aria-labelledby="title">
  <div class="sentence">
    <h1 id="title" class="half l rise">Your Teams,<span class="sr"> in Claude</span></h1>
    <div class="frame rise" style="--i:1" data-ui aria-live="polite" id="frame">
      <span class="lbl" id="lbl">Add this address to your app as an MCP connector</span>
      <span class="addr" id="addr">https://this-server/mcp</span>
      <button class="btn copy" type="button" id="copyAddr">Copy address</button>
    </div>
    <span class="half r rise" style="--i:2" aria-hidden="true">in Claude.</span>
  </div>
  <div class="foot rise" style="--i:3">
    <p class="lead">Use your personal Microsoft Teams (teams.live.com) from Claude, Cursor or VS Code. Your app asks you to sign in with a code at Microsoft. That's it.</p>
    <div class="alt" id="alt">
      ${access}
      <button class="btn" type="button" id="invite" hidden>Accept your invite</button>
      ${personalUrls ? `<button class="textbtn" type="button" id="start">App can't sign in? Get a personal URL</button>` : ''}
      <p class="status" id="status" role="status"></p>
    </div>
  </div>
</section>

<section class="yours" id="yours" hidden aria-labelledby="yoursTitle">
  <h2 id="yoursTitle">Your personal URL</h2>
  <div class="box">
    <pre id="mcpUrl"></pre>
    <div class="row"><p>Treat it like a password. It is shown once.</p><button class="lightbtn" type="button" id="copyUrl">Copy URL</button></div>
  </div>
</section>

<div class="rows">
  <section class="rowblock" aria-labelledby="connectTitle">
    <h2 id="connectTitle">Connect in your app</h2>
    <ul>
      <li><b>Claude</b> · Settings, Connectors, Add custom connector, paste the address, Connect.</li>
      <li><b>Claude Code</b> · <code>claude mcp add --transport http teams-personal <span class="host-mcp">https://this-server/mcp</span></code>, then <code>/mcp</code> and Authenticate.</li>
      <li><b>Cursor, VS Code</b> · Add the address as an HTTP MCP server and sign in when asked.</li>
    </ul>
  </section>
  <section class="rowblock" aria-labelledby="notesTitle">
    <h2 id="notesTitle">Good to know</h2>
    <ul>
      <li>Personal Microsoft accounts only, not work or school Teams.</li>
      ${restricted ? '<li>For invited people only: members of the team\'s Teams groups, or anyone with an invite link. Others are asked to wait for approval.</li>' : ''}
      <li>Your password stays with Microsoft. The server keeps only an encrypted sign-in that your app's key unlocks.</li>
      <li>To disconnect, ask your assistant to run <code>teams_logout</code> or remove the connector.</li>
      <li>Usage is counted per person: which tools are used and how often. Your messages, chats and contacts are never recorded.</li>
    </ul>
  </section>
</div>
</main>

<footer class="end" aria-labelledby="endTitle">
  <div class="top"><span>Teams Personal MCP${version ? ' ' + escapeAttr(version) : ''} · open source · not affiliated with Microsoft</span><a href="#title">Back to top</a></div>
  <h2 id="endTitle" class="sr">This server</h2>
  <a class="big" id="hostLine" href="/">this server</a>
  <div class="meta"><a href="/changelog">Changelog</a><a href="${repo}">Source on GitHub</a><span>Runs on Cloudflare Workers</span></div>
</footer>

<noscript><p style="padding:24px var(--margin)">This page needs JavaScript for the personal URL. Connectors work without it: add <b>/mcp</b> on this server to your app.</p></noscript>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var host = location.host, mcp = location.origin + '/mcp';
  $('addr').textContent = mcp;
  Array.prototype.forEach.call(document.querySelectorAll('.host-mcp'), function (n) { n.textContent = mcp; });
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function copy(text, btn, label) {
    navigator.clipboard.writeText(text).then(function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 1500); });
  }
  $('copyAddr').addEventListener('click', function () { copy(mcp, $('copyAddr'), 'Copy address'); });
  $('copyUrl').addEventListener('click', function () { copy($('mcpUrl').textContent, $('copyUrl'), 'Copy URL'); });

  /* footer: the server's address, sized to fill the width (breaks after the first dot on phones) */
  function fitHost() {
    var el = $('hostLine'), dot = host.indexOf('.');
    var narrow = innerWidth <= 760 && dot > 0 && dot < host.length - 1;
    el.innerHTML = '';
    el.appendChild(document.createTextNode(narrow ? host.slice(0, dot + 1) : host));
    if (narrow) { el.appendChild(document.createElement('br')); el.appendChild(document.createTextNode(host.slice(dot + 1))); }
    el.style.fontSize = '100px';
    var cs = getComputedStyle(el.parentNode);
    var w = el.parentNode.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    el.style.fontSize = Math.max(18, Math.min(220, 100 * (w * 0.96) / el.scrollWidth)) + 'px';
  }
  fitHost(); addEventListener('resize', fitHost);
  if (document.fonts) document.fonts.ready.then(fitHost);

  /* the short sections arrive in turn as they come into view */
  var items = document.querySelectorAll('.rowblock h2, .rowblock li');
  Array.prototype.forEach.call(items, function (n, k) { n.classList.add('reveal'); n.style.setProperty('--i', k % 4); });
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px' }) : null;
  Array.prototype.forEach.call(items, function (n) { io ? io.observe(n) : n.classList.add('in'); });

  /* personal URL: the sign-in code takes the frame's place in the sentence */
  var loginId = null, timer = null;
  function status(msg, err) { var s = $('status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }
  function frame(label, big, cls, hint, copyText, copyLabel) {
    var f = $('frame'); f.innerHTML = '';
    var l = document.createElement('span'); l.className = 'lbl'; l.textContent = label; f.appendChild(l);
    var b = document.createElement('span'); b.className = cls; b.textContent = big; f.appendChild(b);
    if (hint) f.appendChild(hint);
    if (copyText) {
      var cl = copyLabel || 'Copy code';
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn copy'; btn.textContent = cl;
      btn.addEventListener('click', function () { copy(copyText, btn, cl); });
      f.appendChild(btn);
    }
  }
  /* invite link (?invite=…): one sign-in grants access; the code is dropped from the address bar */
  var invite = new URLSearchParams(location.search).get('invite'), btn = null;
  if (invite) {
    history.replaceState(null, '', location.pathname);
    $('invite').hidden = false; if ($('start')) $('start').hidden = true;
    status('You are invited. Sign in once with your personal Microsoft account to get access.');
  } else if (!$('start')) $('alt').hidden = true;
  if ($('start')) $('start').addEventListener('click', function () { begin($('start'), null); });
  $('invite').addEventListener('click', function () { begin($('invite'), invite); });

  async function begin(b, inv) {
    btn = b; btn.disabled = true; status('Asking Microsoft for a code…');
    try {
      var code = $('accessCode') ? $('accessCode').value : '';
      var r = await fetch('/api/login/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode: code, invite: inv }) });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start sign-in.');
      loginId = j.loginId;
      var c = String(j.userCode);
      var hint = document.createElement('span'); hint.className = 'lbl';
      var a = document.createElement('a'); a.href = j.verificationUrl; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = j.verificationUrl.replace(/^https?:\\/\\//, '');
      hint.appendChild(document.createTextNode('Enter it at ')); hint.appendChild(a);
      frame('Your sign-in code', c, 'code', hint, c);
      $('frame').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      status('Waiting for you to approve at Microsoft…');
      $('status').classList.add('pulse');
      schedule(j.interval);
    } catch (e) { status(e.message, true); btn.disabled = false; }
  }
  function schedule(sec) { clearTimeout(timer); timer = setTimeout(poll, Math.max(3, sec) * 1000); }
  async function poll() {
    try {
      var r = await fetch('/api/login/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: loginId }) });
      var j = await r.json();
      if (j.status === 'approved') return done(j);
      if (j.status === 'pending') return schedule(j.interval || 5);
      throw new Error(j.error || 'Sign-in failed.');
    } catch (e) { $('status').classList.remove('pulse'); status(e.message, true); btn.disabled = false; }
  }
  function done(j) {
    $('status').classList.remove('pulse');
    if (j.accessGranted) {
      frame('You have access. Add this address to your app as an MCP connector', mcp, 'addr', null, mcp, 'Copy address');
      $('invite').hidden = true;
      status('Done. Add the address in Claude, Claude Code, Cursor or VS Code and sign in there.');
      return;
    }
    frame('Signed in', 'Connected', 'code done');
    status('Your personal URL is below.');
    $('mcpUrl').textContent = j.mcpUrl;
    var y = $('yours'); y.hidden = false;
    y.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }
})();
</script>
</body>
</html>`;
}
