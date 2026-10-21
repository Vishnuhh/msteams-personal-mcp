// /changelog: renders CHANGELOG.md (bundled into the Worker at build time) as a page.
// Parses only the small format CHANGELOG.md uses: "## [x.y.z] - YYYY-MM-DD", a summary line,
// "### Section" headings and "- " bullets with `code`, **bold** and [links](https://...).

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** @returns {{version: string, date: string, summary: string, sections: {title: string, items: string[]}[]}[]} */
export function parseChangelog(md) {
  const releases = [];
  let current = null, section = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = line.match(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/);
    if (head) {
      current = { version: head[1], date: head[2], summary: '', sections: [] };
      section = null;
      releases.push(current);
      continue;
    }
    if (!current) continue;
    const sub = line.match(/^### (.+)$/);
    if (sub) { section = { title: sub[1].trim(), items: [] }; current.sections.push(section); continue; }
    const item = line.match(/^- (.+)$/);
    if (item && section) { section.items.push(item[1]); continue; }
    if (item && !section) { section = { title: 'Changed', items: [item[1]] }; current.sections.push(section); continue; }
    if (line && !section && !current.summary) current.summary = line.trim();
  }
  return releases;
}

const CSS = `
:root { --bg:#ffffff; --surface:#f2f2f2; --ink:#0a0a0a; --muted:#5c5c5c; --accent:#d92b21; --accent-ink:#ffffff;
  --step-small: clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem); --step-body: clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem);
  --step-statement: clamp(1.375rem, 1rem + 1.1vw, 2rem); --step-display: clamp(2.75rem, 1rem + 5.4vw, 5.75rem);
  --margin: clamp(16px, 2.2vw, 32px); --radius: 4px; --ease: cubic-bezier(.2,.7,.2,1);
  --font: "Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 var(--step-body)/1.5 var(--font); letter-spacing: -0.005em; }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.9em; }
.nav { display: flex; justify-content: space-between; align-items: center; padding: 18px var(--margin); }
.nav .word { font-weight: 600; letter-spacing: -0.03em; text-decoration: none; }
.nav .link { font-size: var(--step-small); font-weight: 500; text-decoration: none; }
header { padding: clamp(48px, 8vw, 120px) var(--margin) clamp(40px, 6vw, 80px); display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; row-gap: 16px; align-items: end; }
h1 { grid-column: 1 / 8; margin: 0; font-size: var(--step-display); font-weight: 600; letter-spacing: -0.045em; line-height: .95; }
header p { grid-column: 9 / 13; margin: 0; color: var(--muted); }
.release { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 24px; row-gap: 12px; padding: clamp(36px, 5vw, 64px) var(--margin); }
.release:nth-child(odd) { background: var(--surface); }
.release .v { grid-column: 1 / 5; }
.release h2 { margin: 0; font-size: var(--step-statement); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
.release .date { color: var(--muted); font-size: var(--step-small); }
.release .live { display: inline-block; margin-left: 10px; vertical-align: middle; background: var(--accent); color: var(--accent-ink); font-size: var(--step-small); font-weight: 500; padding: 2px 8px; border-radius: var(--radius); }
.release .body { grid-column: 5 / 13; display: grid; gap: 16px; }
.release .summary { font-weight: 500; }
.release h3 { margin: 0 0 6px; font-size: var(--step-small); font-weight: 600; color: var(--muted); }
.release ul { margin: 0; padding-left: 1.1em; display: grid; gap: 6px; }
footer { padding: 32px var(--margin); font-size: var(--step-small); display: flex; justify-content: space-between; gap: 16px; }
@media (max-width: 760px) {
  header > *, .release .v, .release .body { grid-column: 1 / -1; }
  footer { flex-direction: column; }
}`;

export function renderChangelogPage({ markdown, liveVersion, repoUrl = 'https://github.com/' }) {
  const releases = parseChangelog(markdown);
  const rows = releases.map((r) => `
<section class="release" id="v${esc(r.version)}" aria-labelledby="h${esc(r.version)}">
  <div class="v">
    <h2 id="h${esc(r.version)}">v${esc(r.version)}${r.version === liveVersion ? '<span class="live">Live</span>' : ''}</h2>
    <span class="date"><time datetime="${esc(r.date)}">${esc(new Date(r.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</time></span>
  </div>
  <div class="body">
    ${r.summary ? `<p class="summary">${inline(r.summary)}</p>` : ''}
    ${r.sections.map((s) => `<div><h3>${esc(s.title)}</h3><ul>${s.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul></div>`).join('\n    ')}
  </div>
</section>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Changelog · Teams Personal MCP</title>
<meta name="description" content="What changed in each release of Teams Personal MCP.">
<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body>
<nav class="nav" aria-label="Main"><a class="word" href="/">Teams Personal MCP</a><a class="link" href="/">Connect</a></nav>
<main>
<header><h1>Changelog</h1><p>Every release, newest first. This server runs v${esc(liveVersion)}.</p></header>
${rows}
</main>
<footer><a href="${esc(repoUrl)}">Source on GitHub</a><span>Generated from CHANGELOG.md at deploy time</span></footer>
</body></html>`;
}
