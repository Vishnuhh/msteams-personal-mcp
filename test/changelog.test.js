// The changelog is part of every release: CI (and the deploy workflow) fail without a proper entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChangelog, renderChangelogPage } from '../src/remote/changelog.js';

const md = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releases = parseChangelog(md);
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

test('the current package version is the newest changelog entry', () => {
  assert.ok(releases.length > 0, 'CHANGELOG.md has no releases');
  assert.equal(releases[0].version, version, `Add a "## [${version}] - YYYY-MM-DD" entry at the top of CHANGELOG.md`);
});

test('releases are newest first, with real dates and no duplicates', () => {
  for (let i = 1; i < releases.length; i++) {
    assert.ok(cmp(releases[i - 1].version, releases[i].version) > 0, `${releases[i - 1].version} should be newer than ${releases[i].version}`);
    assert.ok(releases[i - 1].date >= releases[i].date, `dates out of order at ${releases[i].version}`);
  }
  for (const r of releases) assert.ok(!Number.isNaN(Date.parse(r.date)), `bad date for ${r.version}`);
});

test('every release has a summary and at least one change, and no draft markers', () => {
  const allowed = new Set(['Added', 'Changed', 'Fixed', 'Security', 'Removed', 'Deprecated']);
  for (const r of releases) {
    assert.ok(r.summary, `${r.version} needs a one-line summary`);
    assert.ok(r.sections.some((s) => s.items.length), `${r.version} lists no changes`);
    for (const s of r.sections) assert.ok(allowed.has(s.title), `${r.version}: unknown section "${s.title}"`);
  }
  assert.doesNotMatch(md, /TODO|TBD|XXX/, 'CHANGELOG.md still has draft markers (TODO/TBD/XXX)');
});

test('the page shows every release and marks the live one', () => {
  const html = renderChangelogPage({ markdown: md, liveVersion: version });
  for (const r of releases) assert.match(html, new RegExp(`id="v${r.version.replace(/\./g, '\\.')}"`));
  assert.match(html, /<span class="live">Live<\/span>/);
  assert.doesNotMatch(html, /<script/i, 'changelog page needs no scripts');
});

test('inline markup is escaped and limited', () => {
  const [r] = parseChangelog('## [9.9.9] - 2030-01-01\nSum <b>x</b>\n### Added\n- Use `a<b>` and **bold** and [link](https://x.test) and [bad](javascript:alert(1))\n');
  const html = renderChangelogPage({ markdown: '## [9.9.9] - 2030-01-01\nSum\n### Added\n- ' + r.sections[0].items[0], liveVersion: '9.9.9' });
  assert.match(html, /<code>a&lt;b&gt;<\/code>/);
  assert.match(html, /<a href="https:\/\/x\.test">link<\/a>/);
  assert.doesNotMatch(html, /javascript:alert\(1\)"/);
});
