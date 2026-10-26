import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPdfLite, looksReadable, markdownPdfBody } from '../src/core/pdf.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('the small PDF reader finds the text layer of each page', async () => {
  const r = await readPdfLite(fixture('text.pdf'));
  assert.equal(r.pages, 2);
  assert.match(r.text, /--- Page 1 of 2 ---\nQuarterly plan for the Demo Team[\s\S]*Budget: 1200 for laptops/);
  assert.match(r.text, /--- Page 2 of 2 ---\nSecond page: next steps\./);
  assert.equal(looksReadable(r.text), true);
  assert.equal(r.images.length, 0, 'no page pictures when there is text');
});

test('a scanned PDF gives its page pictures instead of text', async () => {
  const r = await readPdfLite(fixture('scan.pdf'));
  assert.equal(looksReadable(r.text), false);
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].mimeType, 'image/jpeg');
  assert.deepEqual([...r.images[0].bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a real JPEG');
});

test("Cloudflare's converter output: page text is kept, metadata and empty pages are not", () => {
  const md = '# file.pdf\n## Metadata\n- Author=Someone\n- Creator=Word\n## Contents\n### Page 1\nHello team, here is the plan for the quarter and the budget.\n### Page 2\nNext steps.\n';
  assert.equal(markdownPdfBody(md), '--- Page 1 of 2 ---\nHello team, here is the plan for the quarter and the budget.\n\n--- Page 2 of 2 ---\nNext steps.');
  assert.equal(looksReadable(markdownPdfBody('# file.pdf\n## Metadata\n- Author=A\n## Contents\n### Page 1\n\n\n### Page 2\n\n')), false);
  assert.equal(looksReadable('\u0001\u0002'.repeat(100) + 'abc'), false, 'undecoded glyph codes are not text');
});
