// The page an MCP app (Claude, Cursor, VS Code, ...) opens when you click "Connect".
// Same art direction as the home page: the sign-in code is the word inside the sentence,
// "Your Teams, [code] in Claude."

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
:root { --bg:#ffffff; --surface:#f2f2f2; --ink:#0a0a0a; --muted:#5c5c5c; --accent:#d92b21; --accent-press:#b8231b; --accent-ink:#ffffff;
  --step-small: clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem); --step-body: clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem);
  --step-head: clamp(2rem, 1.3rem + 3.2vw, 4rem); --step-display: clamp(2.5rem, 0.8rem + 5vw, 5.25rem);
  --margin: clamp(16px, 2.2vw, 32px); --radius: 4px; --ease: cubic-bezier(.2,.7,.2,1);
  --font: "Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 var(--step-body)/1.5 var(--font); letter-spacing: -0.005em; min-height: 100svh; display: flex; flex-direction: column; }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.nav { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px var(--margin); }
.nav .word { font-weight: 600; letter-spacing: -0.03em; text-decoration: none; }
.nav .note { font-size: var(--step-small); color: var(--muted); text-align: right; }
main { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 24px var(--margin) 48px; gap: clamp(28px, 4vw, 56px); }
.sentence { display: grid; grid-template-columns: 1fr minmax(0, 34vw) 1fr; align-items: center; column-gap: clamp(16px, 2vw, 32px); }
.half { font-size: var(--step-display); font-weight: 600; letter-spacing: -0.045em; line-height: .95; margin: 0; }
.half.l { grid-column: 1; grid-row: 1; }
.half.r { grid-column: 3; grid-row: 1; justify-self: end; text-align: right; }
.frame { grid-column: 2; grid-row: 1; aspect-ratio: 16 / 9; background: var(--surface); border-radius: var(--radius); display: flex; flex-direction: column;
  justify-content: center; gap: 6px; padding: clamp(14px, 1.6vw, 24px); }
.frame .lbl { font-size: var(--step-small); color: var(--muted); }
.frame { container-type: inline-size; }
/* The sign-in code: one line, no spaces, sized to the frame, selected whole on click, so copy-paste is exact. */
.frame .code { font-weight: 600; letter-spacing: .06em; font-size: min(var(--step-head), 13cqi); line-height: 1; font-variant-numeric: tabular-nums;
  white-space: nowrap; user-select: all; cursor: text; }
.frame .copycode { align-self: flex-start; font-size: var(--step-small); padding: .7em 1em; }
.frame .code.live { color: var(--accent); }
.frame .code.done { letter-spacing: -0.03em; }
.foot { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; row-gap: 20px; align-items: end; }
.foot .about { grid-column: 1 / 7; max-width: 46ch; margin: 0; }
.foot .about b { font-weight: 600; }
.foot .act { grid-column: 8 / 13; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; text-align: right; }
.row { display: flex; gap: 18px; align-items: center; }
.btn { display: inline-flex; align-items: center; font: 500 var(--step-body)/1 var(--font); background: var(--accent); color: var(--accent-ink); border: 0;
  border-radius: var(--radius); padding: .9em 1.25em; cursor: pointer; transition: transform .18s var(--ease), background-color .18s var(--ease); }
.btn:hover { background: var(--accent-press); }
.btn:active { transform: scale(.97); }
.btn[disabled] { opacity: .7; cursor: progress; }
.cancel { font: inherit; background: none; border: 0; padding: .4em 0; cursor: pointer; text-decoration: underline; text-underline-offset: .2em;
  text-decoration-thickness: 1px; color: var(--muted); transition: color .18s; }
.cancel:hover { color: var(--ink); }
.status { font-size: var(--step-small); color: var(--muted); max-width: 40ch; min-height: 1.5em; margin: 0; }
.access { display: grid; gap: 6px; justify-items: inherit; }
.access label { font-size: var(--step-small); color: var(--muted); }
.access input { font: 500 var(--step-body)/1.2 var(--font); padding: .7em .9em; border: 0; border-radius: var(--radius); background: var(--surface); color: var(--ink); width: min(260px, 100%); }
.access input:focus { outline: 3px solid var(--accent); outline-offset: 2px; }

.status.err { color: var(--accent); }
.pulse { animation: pulse 1.6s var(--ease) infinite; }
@keyframes pulse { 50% { opacity: .55; } }
.rise { animation: rise .7s var(--ease) both; animation-delay: calc(var(--i, 0) * 80ms); }
@keyframes rise { from { opacity: 0; transform: translateY(20px); } }
@media (max-width: 760px) {
  .sentence { display: flex; flex-direction: column; align-items: stretch; gap: 16px; }
  .half { font-size: 12.5vw; }
  .half.r { align-self: flex-end; }
  .frame { aspect-ratio: 4 / 3; }
  .foot { display: flex; flex-direction: column; align-items: stretch; }
  .foot .act { align-items: stretch; text-align: left; }
  .row { flex-direction: column-reverse; align-items: stretch; }
  .btn { justify-content: center; min-height: 52px; }
}
@media (prefers-reduced-motion: reduce) { .pulse, .rise { animation: none; } }
`;

function shell(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${body}</body></html>`;
}

const SCRIPT = `
(function () {
  var req = document.body.getAttribute('data-req');
  var $ = function (id) { return document.getElementById(id); };
  var loginId = null, timer = null;
  function status(m, err) { var s = $('status'); s.textContent = m; s.className = 'status' + (err ? ' err' : ''); }
  $('start').addEventListener('click', async function () {
    $('start').disabled = true; status('Asking Microsoft for a code…');
    try {
      var code = $('accessCode') ? $('accessCode').value : '';
      var r = await fetch('/api/login/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode: code }) });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start sign-in.');
      loginId = j.loginId;
      var c = String(j.userCode);
      $('code').textContent = c;
      $('code').className = 'code live';
      $('copyCode').hidden = false;
      $('copyCode').onclick = function () {
        navigator.clipboard.writeText(c).then(function () { $('copyCode').textContent = 'Copied'; setTimeout(function () { $('copyCode').textContent = 'Copy code'; }, 1500); });
      };
      $('codeLbl').textContent = 'Your sign-in code';
      var a = document.createElement('a');
      a.href = j.verificationUrl; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = j.verificationUrl.replace(/^https?:\\/\\//, '');
      $('codeHint').textContent = 'Enter it at '; $('codeHint').appendChild(a);
      status('Waiting for you to approve at Microsoft. This page updates by itself.');
      $('status').classList.add('pulse');
      schedule(j.interval);
    } catch (e) { status(e.message + ' Try again.', true); $('start').disabled = false; }
  });
  function schedule(s) { clearTimeout(timer); timer = setTimeout(poll, Math.max(3, s) * 1000); }
  async function poll() {
    try {
      var r = await fetch('/api/login/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: loginId, req: req }) });
      var j = await r.json();
      if (j.status === 'approved' && j.redirect) {
        $('status').classList.remove('pulse');
        $('code').textContent = 'Connected'; $('code').className = 'code done'; $('copyCode').hidden = true;
        $('codeLbl').textContent = 'Signed in'; $('codeHint').textContent = 'Returning you to the app…';
        status('Signed in. Returning you to the app…');
        location.assign(j.redirect);
        return;
      }
      if (j.status === 'pending') return schedule(j.interval || 5);
      throw new Error(j.error || 'Sign-in failed.');
    } catch (e) { $('status').classList.remove('pulse'); status(e.message, true); $('start').disabled = false; }
  }
  $('cancel').addEventListener('click', async function () {
    clearTimeout(timer);
    var r = await fetch('/oauth/deny', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ req: req }) });
    var j = await r.json().catch(function () { return {}; });
    if (j.redirect) location.assign(j.redirect); else status('This request has already ended. You can close this tab.', true);
  });
})();`;

export function renderAuthorizePage({ reqId, clientName, redirectHost, accessCodeRequired = false }) {
  const short = clientName.length > 22 ? clientName.slice(0, 21) + '…' : clientName;
  return shell(`Connect ${clientName} to Teams`, `
<nav class="nav" aria-label="Main"><a class="word" href="/">Teams Personal MCP</a><span class="note">Sign-in request from ${esc(redirectHost)}</span></nav>
<main data-req-holder>
  <div class="sentence">
    <h1 class="half l rise">Your Teams,<span class="sr"> in ${esc(short)}</span></h1>
    <div class="frame rise" style="--i:1" aria-live="polite">
      <span class="lbl" id="codeLbl">Your sign-in code appears here</span>
      <span class="code" id="code">Not started</span>
      <button class="btn copycode" type="button" id="copyCode" hidden>Copy code</button>
      <span class="lbl" id="codeHint">Press Get sign-in code to start.</span>
    </div>
    <span class="half r rise" style="--i:2" aria-hidden="true">in ${esc(short)}.</span>
  </div>
  <div class="foot rise" style="--i:3">
    <p class="about"><b>${esc(clientName)}</b> wants to read and send messages, and read files and pictures shared in your chats, in your personal Microsoft Teams (teams.live.com).
      You approve with a code on Microsoft's own page; your password never reaches this server.
      Afterwards you return to <b>${esc(redirectHost)}</b>.</p>
    <div class="act">
      ${accessCodeRequired ? '<div class="access"><label for="accessCode">Team access code</label><input id="accessCode" autocomplete="off" spellcheck="false"></div>' : ''}
      <div class="row"><button class="cancel" type="button" id="cancel">Cancel</button><button class="btn" type="button" id="start">Get sign-in code</button></div>
      <p class="status" id="status" role="status">Personal Microsoft accounts only. Revoke any time with teams_logout.</p>
    </div>
  </div>
</main>
<script>${SCRIPT}</script>`).replace('<body>', `<body data-req="${esc(reqId)}">`);
}

/** Shown when /authorize can't safely send the user back to the app. */
export function renderAuthorizeError(message) {
  return shell('Sign-in problem', `
<nav class="nav" aria-label="Main"><a class="word" href="/">Teams Personal MCP</a></nav>
<main>
  <h1 class="half rise" style="max-width:14ch">This sign-in link isn't valid.</h1>
  <p class="rise" style="--i:1;max-width:48ch;margin:0">${esc(message)} Nothing was shared. Close this tab and start again from your app.</p>
</main>`);
}
