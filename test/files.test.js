import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { attachmentsOf, fileToText, readCapped, isFileDownloadUrl, isMediaUrl, isRiskyType, LIMITS } from '../src/core/files.js';
import { createTeamsClient } from '../src/core/teams.js';

/** Builds a small ZIP (deflated entries), enough to stand in for an Office file. */
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(local, n, data); central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

test('attachments: files first, then pasted pictures; emoji and outside images are ignored', () => {
  const m = {
    properties: { files: JSON.stringify([{ fileName: 'Plan.docx', fileInfo: { shareUrl: 'https://1drv.ms/w/x', siteUrl: 'https://my.microsoftpersonalcontent.com/personal/abc123/', itemId: 'ABC!1' } }]) },
    content: '<p>see <img itemtype="http://schema.skype.com/Emoji" src="https://statics.teams.cdn.live.net/e.png">' +
      '<img itemtype="http://schema.skype.com/AMSImage" src="https://us-api.asm.skype.com/v1/objects/0-1/views/imgo">' +
      '<img itemtype="http://schema.skype.com/AMSImage" src="https://evil.example/x.png"></p>',
  };
  const list = attachmentsOf(m);
  assert.deepEqual(list.map((a) => [a.index, a.kind, a.name]), [[0, 'file', 'Plan.docx'], [1, 'image', 'image-1']]);
  assert.equal(list[0].driveId, 'abc123');
  assert.equal(list[0].ext, 'docx');
});

test('Word, PowerPoint and Excel files become text', async () => {
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> team &amp; co</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal((await fileToText(docx, 'docx')).text, 'Hello team & co\nLine two');

  const pptx = zip({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>' });
  assert.equal((await fileToText(pptx, 'pptx')).text, '--- Slide 1 ---\nFirst\n\n--- Slide 2 ---\nSecond');

  const xlsx = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Cost, total</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Laptop</t></is></c><c r="B2"><v>1200</v></c></row></sheetData></worksheet>',
  });
  assert.equal((await fileToText(xlsx, 'xlsx')).text, '--- Sheet: Budget (2 rows) ---\nItem,"Cost, total"\nLaptop,1200');
});

test('notebooks, text and HTML; PDFs need the local server; long text is cut', async () => {
  const nb = new TextEncoder().encode(JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# Title'] }, { cell_type: 'code', source: ['print(1)'], outputs: [{ text: ['1\n'] }] }] }));
  assert.match((await fileToText(nb, 'ipynb')).text, /# Title[\s\S]*print\(1\)[\s\S]*\[output\]\n1/);
  assert.equal((await fileToText(new TextEncoder().encode('<p>Hi<br>there</p><script>x()</script>'), 'html')).text, 'Hi\nthere');
  await assert.rejects(fileToText(new Uint8Array(4), 'pdf'), (e) => e.unsupported === true);
  assert.equal((await fileToText(new Uint8Array(4), 'pdf', { extractPdf: async () => 'page text' })).text, 'page text');
  const long = await fileToText(new TextEncoder().encode('x'.repeat(LIMITS.textChars + 10)), 'txt');
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, LIMITS.textChars);
});

test('downloads stop at the size limit; hosts and risky types are checked', async () => {
  await assert.rejects(readCapped(new Response(new Uint8Array(2048)), 1024), /too large/);
  assert.equal((await readCapped(new Response(new Uint8Array(512)), 1024)).length, 512);
  assert.equal(isMediaUrl('https://us-api.asm.skype.com/v1/objects/1'), true);
  assert.equal(isMediaUrl('https://asm.skype.com.evil.example/x'), false);
  assert.equal(isFileDownloadUrl('https://my.microsoftpersonalcontent.com/personal/x/_layouts/download'), true);
  assert.equal(isFileDownloadUrl('http://my.microsoftpersonalcontent.com/x'), false, 'https only');
  assert.equal(isFileDownloadUrl('https://evil.example/x'), false);
  assert.equal(isRiskyType('exe'), true);
  assert.equal(isRiskyType('pdf'), false);
});

test('tokens go only where they belong: skypetoken to the media service, Graph token to Graph, nothing to the download link', async () => {
  const seen = [];
  const message = {
    id: '1', properties: { files: JSON.stringify([{ fileName: 'a.txt', fileInfo: { shareUrl: 'https://1drv.ms/t/x' } }]) },
    content: '<img itemtype="http://schema.skype.com/AMSImage" src="https://us-api.asm.skype.com/v1/objects/0-9/views/imgo">',
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const h = init.headers || {};
    seen.push({ host: new URL(url).host, auth: h.Authorization || h.Authentication || null });
    if (url.includes('/messages/')) return Response.json(message);
    if (url.includes('asm.skype.com')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    if (url.includes('graph.microsoft.com')) return Response.json({ name: 'a.txt', size: 5, webUrl: 'https://onedrive.live.com/x', '@microsoft.graph.downloadUrl': 'https://my.microsoftpersonalcontent.com/dl/a' });
    if (url.includes('microsoftpersonalcontent')) return new Response('hello');
    return new Response('{}', { status: 404 });
  };
  try {
    const client = createTeamsClient(async () => ({ token: 'skype-tok', expiresAt: Date.now() + 3600e3 }), { getGraphToken: async () => 'graph-tok' });
    const file = await client.readAttachment('19:x@thread.v2', '1', 0);
    assert.equal(new TextDecoder().decode(file.bytes), 'hello');
    const pic = await client.readAttachment('19:x@thread.v2', '1', 1);
    assert.equal(pic.mimeType, 'image/png');
  } finally {
    globalThis.fetch = realFetch;
  }
  const auth = Object.fromEntries(seen.map((s) => [s.host, s.auth]));
  assert.equal(auth['graph.microsoft.com'], 'Bearer graph-tok');
  assert.equal(auth['my.microsoftpersonalcontent.com'], null, 'no token on the pre-authorised download link');
  assert.equal(auth['us-api.asm.skype.com'], 'skype_token skype-tok');
});
