// Sign-in page served at "/". Self-contained HTML, CSS and JS (only the Switzer font is external).
// Art direction: "The sentence is the layout" (taste skill, seed 520265479). The device code you type at
// Microsoft is the word inside the headline: "Your Teams, [code], in Claude."
// Example conversations use invented names; nothing on this page is anyone's real data.

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderPage({ repoUrl = 'https://github.com/', version = '' } = {}) {
  const repo = escapeAttr(repoUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Teams Personal MCP</title>
<meta name="description" content="Connect Claude to your personal Microsoft Teams. Sign in with a code, get your private MCP URL.">
<link rel="preconnect" href="https://api.fontshare.com">
<link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #ffffff; --surface: #f2f2f2; --surface-2: #e8e8e8; --ink: #0a0a0a; --muted: #5c5c5c;
  --accent: #d92b21; --accent-press: #b8231b; --accent-ink: #ffffff;
  --field: #0a0a0a; --field-ink: #ffffff; --field-muted: #b5b5b5;
  --step-small: clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem);
  --step-body: clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem);
  --step-lead: clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem);
  --step-head: clamp(2rem, 1.3rem + 3.2vw, 4rem);
  --step-statement: clamp(1.375rem, 1rem + 1.1vw, 2rem);
  --step-display: clamp(2.75rem, 1rem + 5.4vw, 5.75rem);
  --step-poster: clamp(2.75rem, 0.5rem + 7.4vw, 8.25rem);
  --margin: clamp(16px, 2.2vw, 32px);
  --gap: clamp(120px, 14vw, 200px);
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
h1, h2, h3 { font-weight: 600; letter-spacing: -0.04em; line-height: 0.95; margin: 0; }
p { margin: 0; }
code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.86em; }
.wrap { padding-inline: var(--margin); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* buttons: one shape, square, flat */
.btn { display: inline-flex; align-items: center; gap: .5em; font: 500 var(--step-body)/1 var(--font); letter-spacing: -0.01em;
  background: var(--accent); color: var(--accent-ink); border: 0; border-radius: var(--radius); padding: .9em 1.25em; cursor: pointer; text-decoration: none;
  transition: transform .18s var(--ease), background-color .18s var(--ease); }
.btn:hover { background: var(--accent-press); }
.btn:active { transform: scale(.97); }
.btn[disabled] { cursor: progress; opacity: .7; }
.link { font: 500 var(--step-small)/1 var(--font); text-decoration: none; padding: .4em 0; transition: opacity .18s; }
.link:hover { opacity: .6; }
.textbtn { font: inherit; background: none; border: 0; padding: .3em 0; color: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: .2em;
  text-decoration-thickness: 1px; transition: color .18s; }
.textbtn:hover { color: var(--accent); }

/* nav */
.nav { position: fixed; inset: 0 0 auto 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; padding: 18px var(--margin);
  background: var(--bg); }
.nav .word { font-weight: 600; letter-spacing: -0.03em; text-decoration: none; font-size: var(--step-body); }
.nav .links { display: flex; align-items: center; gap: clamp(14px, 2vw, 28px); }
.nav .btn { font-size: var(--step-small); padding: .75em 1em; }

/* ---------- hero: sentence split by a frame, reel pinned while you scroll ---------- */
.hero { position: relative; height: 250svh; }
.stage { position: sticky; top: 0; height: 100svh; overflow: hidden; display: grid; grid-template-columns: 1fr minmax(0, 35vw) 1fr;
  align-items: center; column-gap: clamp(16px, 2vw, 32px); padding-inline: var(--margin); }
.half.l { grid-column: 1; grid-row: 1; }
.reel { grid-column: 2; grid-row: 1; }
.half.r { grid-column: 3; grid-row: 1; }
.half { font-size: var(--step-display); font-weight: 600; letter-spacing: -0.045em; line-height: .95; white-space: nowrap; }
.half.l { justify-self: start; }
.half.r { justify-self: end; text-align: right; }
.reel { position: relative; height: 100svh; }
.reel-track { position: absolute; left: 0; right: 0; top: 50%; display: flex; flex-direction: column; gap: 24px;
  transform: translateY(calc(-50% * 0)); transition: transform .7s var(--ease); }
.frame { aspect-ratio: 16 / 9; border-radius: var(--radius); background: var(--surface); overflow: hidden; position: relative; flex: none; }
.hero-foot { position: absolute; left: var(--margin); right: var(--margin); bottom: 32px; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.hero-foot p { max-width: 34ch; font-size: var(--step-body); }
.hero-foot .act { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; text-align: right; }
.status { font-size: var(--step-small); color: var(--muted); max-width: 36ch; min-height: 1.5em; }
.status.err { color: var(--accent); }

/* interface fragments (data-ui): the product's own screens, at true size */
.ui { position: absolute; inset: 0; padding: clamp(14px, 1.6vw, 24px); display: flex; flex-direction: column; font-size: var(--step-small); line-height: 1.45; letter-spacing: 0; }
.ui .bar { display: flex; align-items: center; justify-content: space-between; font-size: inherit; color: var(--muted); margin-bottom: 10px; }
.ui .who { font-weight: 600; color: var(--ink); }
.ui .bubble { background: var(--bg); border-radius: var(--radius); padding: 10px 12px; }
.ui .me { align-self: flex-end; background: var(--ink); color: var(--field-ink); max-width: 80%; }
.ui .rows { display: grid; gap: 8px; }
.ui .row { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; background: var(--bg); padding: 8px 10px; border-radius: var(--radius); }
.ui .row b { font-weight: 600; }
.ui .row span { color: var(--muted); }
.ui .tool { font-size: inherit; color: var(--muted); }
.ui .tool b { color: var(--ink); font-weight: 500; }
.ui .react { display: inline-flex; gap: 6px; margin-top: 6px; }
.ui .react i { font-style: normal; background: var(--surface-2); border-radius: 999px; padding: 1px 8px; font-size: inherit; }
.ui .react i.mine { background: var(--ink); color: var(--field-ink); }
.ui .quote { background: var(--surface-2); padding: 6px 10px; border-radius: var(--radius); font-size: inherit; color: var(--muted); margin-bottom: 6px; }
.codeview { align-items: flex-start; justify-content: center; gap: 6px; }
.codeview .lbl { font-size: var(--step-small); color: var(--muted); }
.codeview .code { font-weight: 600; letter-spacing: .06em; font-size: var(--step-head); line-height: 1; font-variant-numeric: tabular-nums; }
.codeview .code.live { color: var(--accent); }
.codeview a { font-weight: 500; }
.cfg pre { margin: 0; background: var(--bg); border-radius: var(--radius); padding: 12px; white-space: pre-wrap; word-break: break-all; font-size: var(--step-small); line-height: 1.5; }

/* ---------- connected: your URL ---------- */
.connected { background: var(--field); color: var(--field-ink); padding-block: clamp(72px, 9vw, 140px); }
.connected[hidden] { display: none; }
.connected .grid { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; row-gap: 40px; }
.connected h2 { grid-column: 1 / 7; font-size: var(--step-head); }
.connected .intro { grid-column: 1 / 7; font-size: var(--step-body); color: var(--field-ink); max-width: 44ch; }
.connected .urlbox { grid-column: 7 / 13; grid-row: 1 / 3; align-self: start; }
.connected pre { background: #1d1d1d; color: var(--field-ink); border-radius: var(--radius); padding: 16px; margin: 8px 0 20px; white-space: pre-wrap; word-break: break-all; }
.connected .rowhead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-weight: 500; }
.connected .copy { font: 500 var(--step-small)/1 var(--font); background: var(--field-ink); color: var(--field); border: 0; border-radius: var(--radius); padding: .6em .9em; cursor: pointer; transition: transform .15s; }
.connected .copy:active { transform: scale(.96); }
.connected .note { color: var(--field-muted); font-size: var(--step-small); }

/* ---------- section rhythm ---------- */
section.s { padding-top: var(--gap); }
.grid12 { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; }

/* showcase: the headline you can type */
.ask { min-height: 88svh; display: flex; flex-direction: column; }
.ask h2 { font-size: var(--step-head); margin-bottom: clamp(20px, 3vw, 40px); }
.ask .line { display: flex; align-items: baseline; }
.ask input { flex: 1; min-width: 0; font: 600 var(--step-poster)/1 var(--font); letter-spacing: -0.045em; border: 0; background: none; color: var(--ink);
  padding: 0; caret-color: var(--accent); }
.ask input:focus { outline: none; }
.ask .line { border-bottom: 4px solid transparent; transition: border-color .2s; }
.ask .line:focus-within { border-bottom-color: var(--accent); }
.ask .answer { margin-top: 48px; max-width: 560px; position: relative; min-height: 260px; background: var(--surface); border-radius: var(--radius); }
.ask .answer .ui { position: relative; inset: auto; }
.ask .examples { margin-top: auto; padding-top: 40px; display: flex; flex-wrap: wrap; gap: 8px 28px; }
.ask .examples span { color: var(--muted); }

/* how it works: drag through the stages */
.how { display: grid; grid-template-columns: 1fr 1fr; min-height: 88svh; position: relative; }
.how .clause { background: var(--surface); padding: clamp(28px, 4vw, 56px) var(--margin) 140px; }
.how .clause h2 { font-size: var(--step-head); max-width: 11ch; transition: opacity .2s; }
.how .clause p { margin-top: 28px; max-width: 38ch; transition: opacity .2s; }
.how .shot { background: var(--field); display: grid; place-items: center; padding: 40px var(--margin) 140px; }
.how .device { width: min(440px, 100%); aspect-ratio: 4 / 3; background: var(--surface); border-radius: var(--radius); position: relative; transition: opacity .2s; }
.how .control { position: absolute; left: var(--margin); right: var(--margin); bottom: 28px; }
.how input[type=range] { width: 100%; appearance: none; -webkit-appearance: none; background: transparent; height: 32px; margin: 0; cursor: pointer; }
.how .track { position: relative; }
.how .track::before, .how .track::after { content: ''; position: absolute; left: 0; top: 12px; height: 8px; pointer-events: none; }
.how .track::before { right: 0; background: var(--surface-2); }
.how .track::after { width: var(--fill, 0%); background: var(--ink); transition: width .2s var(--ease); }
.how input[type=range] { position: relative; z-index: 1; }
.how input[type=range]::-webkit-slider-runnable-track { height: 8px; background: transparent; }
.how input[type=range]::-moz-range-track { height: 8px; background: transparent; }
.how input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 32px; height: 32px; margin-top: -12px; background: var(--accent); border: 0; border-radius: 0; transition: transform .15s; }
.how input[type=range]::-moz-range-thumb { width: 32px; height: 32px; background: var(--accent); border: 0; border-radius: 0; }
.how input[type=range]:active::-webkit-slider-thumb { transform: scale(1.12); }
.how .stops { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 8px; }
.how .stops button { font: inherit; text-align: left; background: none; border: 0; padding: 4px 0; color: var(--muted); cursor: pointer; transition: color .18s; }
.how .stops button[aria-current="true"] { color: var(--ink); font-weight: 500; }
.how .stops button:nth-child(n+3) { color: var(--field-muted); }
.how .stops button:nth-child(n+3)[aria-current="true"] { color: var(--field-ink); }

/* proof: the clients it works in, as one sentence */
.names { padding-block: 120px; }
.names p { font-size: var(--step-statement); line-height: 1.12; font-weight: 600; letter-spacing: -0.03em; max-width: 30em; }
.names .n { color: #858585; transition: color .4s; }
.names .n.on { color: var(--ink); }

/* faq: large questions, answers beside */
.faq .row { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; padding-bottom: 80px; }
.faq h2, .faq h3 { grid-column: 1 / 7; font-size: var(--step-statement); font-weight: 500; line-height: 1.1; letter-spacing: -0.03em; }
.faq h2 { color: var(--muted); }
.faq .a { grid-column: 8 / 13; line-height: 1.55; max-width: 42ch; }

/* footer: this server's address as the headline */
.foot { background: var(--accent); color: var(--accent-ink); min-height: 72svh; display: flex; flex-direction: column; padding: 40px var(--margin) 28px; margin-top: 120px; }
.foot .top { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; font-size: var(--step-small); }
.foot .top .notes { grid-column: 1 / 8; display: grid; gap: 6px; }
.foot .top .totop { grid-column: 12 / 13; justify-self: end; }
.foot .big { margin-top: auto; display: block; font-weight: 600; letter-spacing: -0.05em; line-height: .92; text-decoration: none;
  font-size: clamp(2.5rem, 0.5rem + 7vw, 9rem); overflow-wrap: anywhere; transition: opacity .2s; }
.foot .big:hover { opacity: .85; }
.foot .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; font-size: var(--step-small); margin-top: 28px; }
.foot .meta > :nth-child(2) { text-align: center; }
.foot .meta > :nth-child(3) { text-align: right; }

/* entrances */
.rise { opacity: 0; transform: translateY(24px); transition: opacity .7s var(--ease), transform .7s var(--ease); transition-delay: calc(var(--i, 0) * 80ms); }
.rise.in { opacity: 1; transform: none; }
.blink { display: inline-block; width: .08em; height: .82em; background: var(--accent); margin-left: .04em; vertical-align: -.04em; animation: blink 1.06s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.pulse { animation: pulse 1.6s var(--ease) infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }

/* ---------- phone ---------- */
@media (max-width: 1024px) {
  .foot { min-height: 0; }
  .foot .big { margin-top: clamp(96px, 16vw, 160px); }
}
@media (max-width: 760px) {
  .nav .links .link:not(:last-of-type) { display: none; }
  .hero { height: auto; }
  .stage { position: relative; height: auto; display: block; padding-top: 88px; padding-bottom: 32px; }
  .stage { display: flex; flex-direction: column; align-items: stretch; }
  .reel { width: 100%; }
  .half.l { order: 1; }
  .reel { order: 2; }
  .half.r { order: 3; align-self: flex-end; }
  .hero-foot { order: 4; }
  .half { font-size: 13vw; white-space: normal; }
  .reel { height: auto; margin: 20px 0; }
  .reel-track { position: relative; top: auto; transform: none !important; }
  .reel .frame { display: none; aspect-ratio: 4 / 3; }
  .reel .frame.current { display: block; }
  .hero-foot { position: static; flex-direction: column; align-items: stretch; margin-top: 24px; }
  .hero-foot .act { align-items: stretch; text-align: left; }
  .hero-foot .btn { justify-content: center; min-height: 52px; }
  .connected .grid > * { grid-column: 1 / -1 !important; grid-row: auto !important; }
  .ask input { font-size: 11vw; }
  .ask .examples { gap: 8px; }
  .ask .examples span { width: 100%; }
  .ask .examples .textbtn { background: var(--surface); text-decoration: none; padding: 12px 14px; border-radius: var(--radius); min-height: 44px; }
  .how { grid-template-columns: 1fr; }
  .how .shot { order: -1; min-height: 46svh; padding: 24px var(--margin); }
  .how .clause { padding-bottom: 32px; }
  .how .clause h2 { font-size: 9vw; }
  .how .control { position: static; padding: 20px var(--margin); background: var(--surface); }
  .how .stops { grid-template-columns: 1fr 1fr; gap: 4px; }
  .how .stops button:nth-child(n+3) { color: var(--muted); }
  .how .stops button:nth-child(n+3)[aria-current="true"] { color: var(--ink); }
  .how input[type=range]::-webkit-slider-thumb { width: 40px; height: 40px; margin-top: -16px; }
  .names p { font-size: 1.375rem; }
  .names .n { color: #6b6b6b; }
  .faq .row { padding-bottom: 56px; row-gap: 12px; }
  .faq h2, .faq h3, .faq .a { grid-column: 1 / -1; }
  .faq h2, .faq h3 { font-size: 1.5rem; }
  .foot .top .notes, .foot .top .totop { grid-column: 1 / -1; justify-self: start; }
  .foot .big { font-size: 12vw; }
  .foot .meta { grid-template-columns: 1fr; }
  .foot .meta > * { text-align: left !important; }
}
@media (prefers-reduced-motion: reduce) {
  .rise { opacity: 1; transform: none; transition: none; }
  .reel-track { transition: none; }
  .blink, .pulse { animation: none; }
  .names .n { transition: none; }
}
</style>
</head>
<body>
<nav class="nav" aria-label="Main">
  <a class="word" href="/">Teams Personal MCP</a>
  <div class="links">
    <a class="link" href="#ask">What it does</a>
    <a class="link" href="#how">How it works</a>
    <a class="link" href="#faq">Questions</a>
    <a class="link" href="${repo}">Source</a>
    <button class="btn" type="button" data-start>Get sign-in code</button>
  </div>
</nav>

<main>
<section class="hero" aria-labelledby="title">
  <div class="stage">
    <h1 id="title" class="half l">Your Teams,<span class="sr"> in Claude</span></h1>
    <div class="reel" aria-live="polite">
      <div class="reel-track" id="reel">
        <div class="frame" data-ui aria-label="Example: Claude catching you up on Teams">
          <div class="ui">
            <div class="bar"><span class="who">Claude</span><span>teams_get_unread · teams_get_mentions</span></div>
            <div class="bubble me">Catch me up on Teams</div>
            <div class="rows" style="margin-top:10px">
              <div class="row"><b>Design crew</b><span>Meera needs the banner sizes by 4 pm. Needs your reply.</span></div>
              <div class="row"><b>Arjun</b><span>Mentioned you: "can you review PR 214?"</span></div>
              <div class="row"><b>Family</b><span>3 new photos, nothing to answer.</span></div>
            </div>
          </div>
        </div>
        <div class="frame" data-ui aria-label="Your sign-in code">
          <div class="ui codeview" id="codeview">
            <span class="lbl" id="codeLbl">Your sign-in code appears here</span>
            <span class="code" id="code">R7KQ 2MXP</span>
            <span class="lbl" id="codeHint">Press <b>Get sign-in code</b> to start.</span>
          </div>
        </div>
        <div class="frame" data-ui aria-label="Example: a Teams chat with a reply and reactions">
          <div class="ui">
            <div class="bar"><span class="who">Design crew</span><span>teams_reply_to_message</span></div>
            <div class="bubble"><b>Meera</b> · 11:42<br>Banner sizes by 4 pm please, 1200 × 628 and square.</div>
            <div class="react"><i>Like 2</i><i class="mine">Celebrate 1</i></div>
            <div class="bubble me" style="margin-top:10px"><div class="quote">Meera: Banner sizes by 4 pm please…</div>On it, both sizes by 3:30.</div>
          </div>
        </div>
        <div class="frame" data-ui aria-label="Example: adding the MCP URL to Claude Code">
          <div class="ui cfg">
            <div class="bar"><span class="who">Terminal</span><span>Claude Code</span></div>
            <pre><code>claude mcp add --transport http teams-personal \\
  https://<span class="host">your-server</span>/mcp/tpm_…</code></pre>
            <div class="bar" style="margin-top:12px"><span>Then ask: “Do I have unread Teams messages?”</span></div>
          </div>
        </div>
      </div>
    </div>
    <span class="half r" aria-hidden="true">in Claude.</span>
    <div class="hero-foot">
      <p>Connect Claude, Cursor or VS Code to your personal Microsoft Teams. Sign in with a code at Microsoft and get your own private MCP URL.</p>
      <div class="act">
        <button class="btn" type="button" data-start>Get sign-in code</button>
        <p class="status" id="status" role="status">Personal accounts only (teams.live.com). Your password stays with Microsoft.</p>
      </div>
    </div>
  </div>
</section>

<section class="connected" id="connected" hidden aria-labelledby="connectedTitle">
  <div class="wrap grid">
    <h2 id="connectedTitle">You're connected.</h2>
    <p class="intro">This URL is yours alone. Treat it like a password: anyone with it can read and send your Teams messages. It is shown once; if you lose it, sign in again for a new one.</p>
    <div class="urlbox">
      <div class="rowhead"><span>MCP URL</span><button class="copy" data-copy="mcpUrl">Copy</button></div>
      <pre id="mcpUrl"></pre>
      <div class="rowhead"><span>Claude Code</span><button class="copy" data-copy="cc">Copy</button></div>
      <pre id="cc"></pre>
      <div class="rowhead"><span>Cursor, VS Code and other clients</span><button class="copy" data-copy="json">Copy</button></div>
      <pre id="json"></pre>
      <p class="note">Claude desktop and claude.ai: Settings, Connectors, Add custom connector, paste the MCP URL. To revoke it later, ask your assistant to run teams_logout.</p>
    </div>
  </div>
</section>

<section class="s wrap ask" id="ask" aria-labelledby="askTitle">
  <h2 id="askTitle" class="rise">Ask about your chats in plain words.</h2>
  <label class="sr" for="q">Try a request</label>
  <div class="line rise" style="--i:1" data-ui><input id="q" value="catch me up on teams" autocomplete="off" spellcheck="false"></div>
  <div class="answer rise" style="--i:2" data-ui aria-live="polite"><div class="ui" id="answer"></div></div>
  <div class="examples rise" style="--i:3"><span>Or try one of these:</span></div>
</section>

<section class="s how-wrap" id="how" aria-labelledby="howTitle">
  <div class="how">
    <div class="clause"><h2 id="howTitle" class="rise">First, get a code here.</h2><p id="howText" class="rise" style="--i:1"></p></div>
    <div class="shot"><div class="device" data-ui id="howShot"></div></div>
    <div class="control">
      <label class="sr" for="stage">Stage</label>
      <div class="track" id="track"><input type="range" id="stage" min="0" max="3" step="1" value="0"></div>
      <div class="stops" id="stops"></div>
    </div>
  </div>
</section>

<section class="names wrap" aria-labelledby="namesTitle">
  <p><span id="namesTitle">Works in</span> <span class="n">Claude Code</span>, <span class="n">Claude desktop</span>, <span class="n">claude.ai</span>, <span class="n">Cursor</span>, <span class="n">VS Code</span>, <span class="n">Windsurf</span>, <span class="n">Cline</span> and <span class="n">any other MCP client</span>.</p>
</section>

<section class="s wrap faq" id="faq" aria-label="Questions">
  <div class="row"><h2 class="rise">Questions, answered</h2></div>
  <div class="row rise"><h3>Does it work with my work Teams?</h3><p class="a">No. It is built for personal Teams, the free version at teams.live.com that you use with a personal Microsoft account. Work and school Teams has official tools for that.</p></div>
  <div class="row rise"><h3>Does this server see my password?</h3><p class="a">Never. You type the code on Microsoft's own sign-in page and approve access there. The server only receives a sign-in token from Microsoft.</p></div>
  <div class="row rise"><h3>What does the server keep?</h3><p class="a">Your Microsoft sign-in token, encrypted with a key that only your MCP URL holds. Without your URL nobody, including whoever runs the server, can decrypt it. Your messages are read live from Teams and never stored.</p></div>
  <div class="row rise"><h3>Can it send messages for me?</h3><p class="a">Only when you ask. Sending, replying, reacting, editing and deleting are separate tools, and your assistant asks before it uses them. It can edit or delete only your own messages.</p></div>
  <div class="row rise"><h3>How do I switch it off?</h3><p class="a">Ask your assistant to run teams_logout. Your sign-in is deleted and your URL stops working at once. You can also remove access at account.live.com.</p></div>
  <div class="row rise"><h3>Will it keep working?</h3><p class="a">It uses the same service the Teams web app uses, which Microsoft does not document. If Microsoft changes it, a tool can break until the code is updated.</p></div>
</section>
</main>

<footer class="foot" aria-labelledby="footTitle">
  <div class="top">
    <div class="notes">
      <span>Teams Personal MCP${version ? ' ' + escapeAttr(version) : ''} · open source, MIT licence</span>
      <span>An MCP server for personal Microsoft Teams. Not affiliated with Microsoft.</span>
    </div>
    <a class="totop link" href="#title">Back to top</a>
  </div>
  <h2 id="footTitle" class="sr">This server</h2>
  <a class="big" id="hostLine" href="/">this server</a>
  <div class="meta">
    <a href="${repo}">Source on GitHub</a>
    <span>Type: Switzer by the Indian Type Foundry</span>
    <span>Runs on Cloudflare Workers</span>
  </div>
</footer>

<noscript><p class="wrap" style="padding-block:24px">Sign-in needs JavaScript. Or run the server locally: see the source on GitHub.</p></noscript>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var host = location.host;
  // The server's own address is the footer's headline, sized so its longest line fills the width.
  // On narrow screens it breaks after the first dot (teams-mcp. / example.com).
  function fitHost() {
    var el = $('hostLine'), dot = host.indexOf('.');
    var narrow = innerWidth <= 760 && dot > 0 && dot < host.length - 1;
    el.innerHTML = '';
    el.appendChild(document.createTextNode(narrow ? host.slice(0, dot + 1) : host));
    if (narrow) { el.appendChild(document.createElement('br')); el.appendChild(document.createTextNode(host.slice(dot + 1))); }
    el.style.fontSize = '100px';
    var cs = getComputedStyle(el.parentNode);
    var w = el.parentNode.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    el.style.fontSize = Math.max(18, Math.min(260, 100 * (w * 0.96) / el.scrollWidth)) + 'px';
  }
  $('hostLine').style.display = 'inline-block'; $('hostLine').style.whiteSpace = 'nowrap'; $('hostLine').style.maxWidth = '100%';
  fitHost(); addEventListener('resize', fitHost);
  if (document.fonts) document.fonts.ready.then(fitHost);
  Array.prototype.forEach.call(document.querySelectorAll('.host'), function (n) { n.textContent = host; });
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- hero reel: pinned while the page scrolls ---------- */
  var hero = document.querySelector('.hero');
  var track = $('reel');
  var frames = track.querySelectorAll('.frame');
  var current = -1, locked = false;
  function show(i) {
    if (i === current) return;
    current = i;
    Array.prototype.forEach.call(frames, function (f, k) { f.classList.toggle('current', k === i); });
    var f = frames[i];
    track.style.transform = 'translateY(' + (-(f.offsetTop + f.offsetHeight / 2)) + 'px)';
  }
  function onScroll() {
    if (locked) return;
    var r = hero.getBoundingClientRect();
    var p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
    show(Math.min(frames.length - 1, Math.floor(p * frames.length)));
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', function () { var c = current; current = -1; show(c < 0 ? 0 : c); });
  show(0);

  /* ---------- sign-in: the code becomes the word inside the headline ---------- */
  var loginId = null, timer = null;
  function status(msg, err) { var s = $('status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }
  function lockCode() {
    locked = true; show(1);
    var target = innerWidth > 760 ? hero : frames[1];
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: innerWidth > 760 ? 'start' : 'center' });
  }
  function setBusy(b) { Array.prototype.forEach.call(document.querySelectorAll('[data-start]'), function (x) { x.disabled = b; }); }
  async function start() {
    setBusy(true); lockCode(); status('Asking Microsoft for a code…');
    try {
      var r = await fetch('/api/login/start', { method: 'POST' });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start sign-in.');
      loginId = j.loginId;
      var code = String(j.userCode);
      $('code').textContent = code.length === 9 ? code.slice(0, 4) + ' ' + code.slice(4) : code;
      $('code').classList.add('live');
      $('codeLbl').textContent = 'Your sign-in code';
      $('codeHint').innerHTML = 'Enter it at <a href="' + j.verificationUrl + '" target="_blank" rel="noopener">' + j.verificationUrl.replace(/^https?:\\/\\//, '') + '</a>';
      status('Waiting for you to approve at Microsoft. This page updates by itself.');
      $('status').classList.add('pulse');
      schedule(j.interval);
    } catch (e) { status(e.message + ' Try again.', true); setBusy(false); locked = false; }
  }
  function schedule(sec) { clearTimeout(timer); timer = setTimeout(poll, Math.max(3, sec) * 1000); }
  async function poll() {
    try {
      var r = await fetch('/api/login/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: loginId }) });
      var j = await r.json();
      if (j.status === 'approved') return done(j);
      if (j.status === 'pending') return schedule(j.interval || 5);
      throw new Error(j.error || 'Sign-in failed.');
    } catch (e) { $('status').classList.remove('pulse'); status(e.message + ' Press the button to try again.', true); setBusy(false); locked = false; }
  }
  function done(j) {
    $('status').classList.remove('pulse');
    $('code').textContent = 'Connected';
    $('codeLbl').textContent = 'Signed in';
    $('codeHint').textContent = 'Your private MCP URL is below.';
    status('Signed in. Copy your MCP URL below.');
    $('mcpUrl').textContent = j.mcpUrl;
    $('cc').textContent = 'claude mcp add --scope user --transport http teams-personal ' + j.mcpUrl;
    $('json').textContent = JSON.stringify({ mcpServers: { 'teams-personal': { type: 'http', url: j.mcpUrl } } }, null, 2);
    var c = $('connected'); c.hidden = false;
    c.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-start]'), function (b) { b.addEventListener('click', start); });
  document.addEventListener('click', function (e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-copy');
    if (!id) return;
    navigator.clipboard.writeText($(id).textContent).then(function () {
      e.target.textContent = 'Copied'; setTimeout(function () { e.target.textContent = 'Copy'; }, 1500);
    });
  });

  /* ---------- showcase: the headline you can type ---------- */
  var EX = [
    { q: 'catch me up on teams', tool: 'teams_get_unread, teams_get_mentions', rows: [['Design crew', 'Meera needs the banner sizes by 4 pm. Needs your reply.'], ['Arjun', 'Mentioned you: can you review PR 214?'], ['Family', '3 new photos. Nothing to answer.']] },
    { q: 'who mentioned me this week', tool: 'teams_get_mentions since 7d', rows: [['Arjun · Tue', 'can you review PR 214?'], ['Kavya · Mon', 'thanks for the quick fix on the login bug'], ['Ravi · Mon', 'are you joining the 5 pm call?']] },
    { q: 'react thumbs up to meera', tool: 'teams_add_reaction · like', rows: [['Design crew', 'Meera: Banner sizes by 4 pm please'], ['Reaction', 'Like added, visible to the chat'], ['Asked first', 'Claude confirms before it reacts or sends']] },
    { q: 'summarise design crew today', tool: 'teams_get_messages since 24h', rows: [['Decided', 'Launch banner goes out Thursday'], ['Waiting on you', 'Banner sizes, 1200 × 628 and square'], ['FYI', 'Meera shared final.fig (2 links)']] }
  ];
  var input = $('q');
  function render(ex) {
    var html = '<div class="tool">Claude uses <b>' + ex.tool + '</b></div><div class="rows" style="margin-top:12px">';
    ex.rows.forEach(function (r) { html += '<div class="row"><b>' + r[0] + '</b><span>' + r[1] + '</span></div>'; });
    $('answer').innerHTML = html + '</div>';
  }
  function match(text) {
    var t = text.toLowerCase(), best = EX[0], score = -1;
    EX.forEach(function (ex) {
      var s = ex.q.split(' ').filter(function (w) { return w.length > 2 && t.indexOf(w) >= 0; }).length;
      if (s > score) { score = s; best = ex; }
    });
    return best;
  }
  input.addEventListener('input', function () { render(match(input.value)); });
  var exBox = document.querySelector('.ask .examples');
  EX.slice(1).forEach(function (ex) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'textbtn'; b.textContent = ex.q;
    b.addEventListener('click', function () { input.value = ex.q; render(ex); input.focus(); });
    exBox.appendChild(b);
  });
  render(EX[0]);

  /* ---------- how it works: drag through the stages ---------- */
  var ST = [
    { name: 'Get a code', clause: 'First, get a code here.', text: 'Press Get sign-in code. Microsoft gives you a nine-letter code that is valid for 15 minutes.',
      ui: '<div class="ui codeview"><span class="lbl">Your sign-in code</span><span class="code live">R7KQ 2MXP</span><span class="lbl">Enter it at microsoft.com/devicelogin</span></div>' },
    { name: 'Approve', clause: 'Then approve it at Microsoft.', text: 'Enter the code at microsoft.com/devicelogin and sign in with the personal account you use on teams.live.com. Your password never reaches this server.',
      ui: '<div class="ui"><div class="bar"><span class="who">Microsoft</span><span>microsoft.com/devicelogin</span></div><div class="bubble" style="margin-top:6px">Enter code</div><div class="bubble" style="margin-top:8px;font-weight:600;letter-spacing:.06em">R7KQ2MXP</div><div class="bubble me" style="margin-top:10px;align-self:flex-start">Next</div></div>' },
    { name: 'Copy your URL', clause: 'Next, copy your MCP URL.', text: 'This page shows your private MCP URL once. Add it to Claude Code, Claude desktop, Cursor or VS Code.',
      ui: '<div class="ui cfg"><div class="bar"><span class="who">Your MCP URL</span><span>shown once</span></div><pre><code>https://' + host + '/mcp/tpm_8Fq…</code></pre><div class="bar" style="margin-top:10px"><span>Treat it like a password.</span></div></div>' },
    { name: 'Ask Claude', clause: 'Now ask Claude about Teams.', text: 'Unread chats, who mentioned you, a summary of today, a reply in your own words. Claude asks before it sends anything.',
      ui: '<div class="ui"><div class="bar"><span class="who">Claude</span><span>teams_get_mentions</span></div><div class="bubble me">Who mentioned me this week?</div><div class="rows" style="margin-top:10px"><div class="row"><b>Arjun</b><span>can you review PR 214?</span></div><div class="row"><b>Ravi</b><span>joining the 5 pm call?</span></div></div></div>' }
  ];
  var range = $('stage'), stops = $('stops');
  ST.forEach(function (s, i) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = s.name;
    b.addEventListener('click', function () { range.value = i; setStage(i); });
    stops.appendChild(b);
  });
  function setStage(i) {
    var s = ST[i];
    [$('howTitle'), $('howText'), $('howShot')].forEach(function (n) { n.style.opacity = reduced ? 1 : 0; });
    setTimeout(function () {
      $('howTitle').textContent = s.clause; $('howText').textContent = s.text; $('howShot').innerHTML = s.ui;
      [$('howTitle'), $('howText'), $('howShot')].forEach(function (n) { n.style.opacity = 1; });
    }, reduced ? 0 : 200);
    Array.prototype.forEach.call(stops.children, function (b, k) { b.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    $('track').style.setProperty('--fill', (i / 3 * 100) + '%');
    range.setAttribute('aria-valuetext', s.name);
  }
  range.addEventListener('input', function () { setStage(Number(range.value)); });
  setStage(0);

  /* ---------- proof: the lit name moves through the sentence ---------- */
  var names = document.querySelectorAll('.names .n'), lit = 0;
  names[0].classList.add('on');
  if (!reduced) setInterval(function () { names[lit].classList.remove('on'); lit = (lit + 1) % names.length; names[lit].classList.add('on'); }, 2000);

  /* ---------- entrances ---------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -10% 0px' }) : null;
  Array.prototype.forEach.call(document.querySelectorAll('.rise'), function (n) { io ? io.observe(n) : n.classList.add('in'); });
})();
</script>
</body>
</html>`;
}
