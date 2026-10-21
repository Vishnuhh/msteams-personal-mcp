#!/usr/bin/env node
// Starts a release: bumps the version and drafts its CHANGELOG.md entry from the commits since the last tag.
//
//   npm run release -- 0.7.0 "One-line summary of the release"
//
// Then edit the drafted bullets into plain language (and sort them under Added / Changed / Fixed /
// Security), remove the TODO line, run `npm test`, commit, and tag: git tag v0.7.0 && git push --tags.
// `npm test` fails while the entry is missing or still contains TODO, so a release can't ship without it.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';

const [version, ...summaryWords] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: npm run release -- <x.y.z> "One-line summary"');
  process.exit(1);
}
const root = new URL('../', import.meta.url);
const pkgPath = new URL('package.json', root);
const clPath = new URL('CHANGELOG.md', root);

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const changelog = readFileSync(clPath, 'utf8');
if (changelog.includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md already has ${version}.`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', cwd: root }).trim();
let since = '';
try { since = git('describe', '--tags', '--abbrev=0'); } catch { /* no tags yet */ }
const subjects = git('log', '--no-merges', '--format=%s', ...(since ? [`${since}..HEAD`] : []))
  .split('\n').filter(Boolean)
  .filter((s) => !/^(Merge|Sync package-lock|Release )/i.test(s));

const today = new Date().toISOString().slice(0, 10);
const summary = summaryWords.join(' ').trim() || 'TODO: one-line summary';
const entry = [
  `## [${version}] - ${today}`,
  '',
  summary,
  '',
  '### Changed',
  ...(subjects.length ? subjects.map((s) => `- ${s}`) : ['- TODO: describe the changes']),
  '',
  'TODO: rewrite the bullets above in plain language, sort them under Added / Changed / Fixed / Security, then delete this line.',
  '',
  '',
].join('\n');

const at = changelog.indexOf('\n## [');
writeFileSync(clPath, at === -1 ? `${changelog.trimEnd()}\n\n${entry}` : changelog.slice(0, at + 1) + entry + changelog.slice(at + 1));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
try { execSync('npm install --package-lock-only --silent', { cwd: root, stdio: 'ignore' }); } catch { /* lockfile sync is best effort */ }

console.log(`Drafted ${version} in CHANGELOG.md from ${subjects.length} commit(s)${since ? ` since ${since}` : ''}.`);
console.log('Next: edit the entry, remove the TODO line, npm test, commit, then: git tag v' + version + ' && git push --tags');
