// Files and images shared in Teams chats: which attachments a message has, and turning a file's bytes into
// text an assistant can read. Web APIs only (Node 18+ and Cloudflare Workers), no dependencies.
//
// Where things live (Teams personal):
//   - files:  the sender's OneDrive, shared with the chat; read through Microsoft Graph with the reader's own sign-in
//   - images: pasted pictures live in Skype's media service (*.asm.skype.com), read with the reader's skypetoken

export const LIMITS = {
  imageBytes: 5 * 1024 * 1024, // what an assistant can take as an image
  readBytes: 15 * 1024 * 1024, // largest file read as text
  downloadBytes: 100 * 1024 * 1024, // largest file the local server saves to disk
  unzippedBytes: 40 * 1024 * 1024, // total inflated size per Office file (zip-bomb guard)
  textChars: 40_000, // ~10k tokens of text back to the assistant
};

const TEXT_TYPES = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'log', 'yaml', 'yml', 'ini', 'toml',
  'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'go', 'rb', 'php', 'rs', 'swift', 'sql', 'css', 'scss', 'sh', 'ps1', 'bat', 'srt', 'vtt']);
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
// Never written to disk by the download tool.
const RISKY_TYPES = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'jar', 'apk', 'appx',
  'dll', 'sys', 'lnk', 'reg', 'iso', 'img', 'dmg', 'app', 'msix', 'cpl']);

// Hosts a downloaded file or image may come from. The skypetoken only ever goes to Skype's media service.
const MEDIA_HOST = /(^|\.)asm\.skype\.com$/i;
const FILE_HOSTS = /(^|\.)(microsoftpersonalcontent\.com|1drv\.com|livefilestore\.com|onedrive\.com|sharepoint\.com|files\.1drv\.com)$/i;

export const extOf = (name) => {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : '';
};
export const isRiskyType = (ext) => RISKY_TYPES.has(ext);
export const imageMime = (ext) => IMAGE_TYPES[ext] || null;
export const isMediaUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && MEDIA_HOST.test(x.hostname); } catch { return false; } };
export const isFileDownloadUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && FILE_HOSTS.test(x.hostname); } catch { return false; } };

/** What a file can be turned into: 'text', 'office', 'notebook', 'image', 'pdf' or null (not readable). */
export function readableAs(ext) {
  if (TEXT_TYPES.has(ext)) return 'text';
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return 'office';
  if (ext === 'ipynb') return 'notebook';
  if (IMAGE_TYPES[ext]) return 'image';
  if (ext === 'pdf') return 'pdf';
  return null;
}

function parseJsonish(v) {
  if (typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
}

/**
 * Attachments of one raw chat message, in a stable order: files first, then pasted images.
 * [{ index, kind: 'file'|'image', name, ext, shareUrl?, driveId?, itemId?, src? }]
 */
export function attachmentsOf(m) {
  const out = [];
  const files = parseJsonish(m.properties?.files);
  for (const f of Array.isArray(files) ? files : []) {
    const name = f.fileName || f.title || 'file';
    out.push({
      kind: 'file', name, ext: extOf(name),
      shareUrl: f.fileInfo?.shareUrl || null,
      driveId: (f.fileInfo?.siteUrl || '').match(/personal\/([^/?#]+)/)?.[1] || null,
      itemId: f.fileInfo?.itemId || null,
    });
  }
  let n = 0;
  for (const tag of String(m.content || '').match(/<img\b[^>]*>/gi) || []) {
    if (!/itemtype="http:\/\/schema\.skype\.com\/AMSImage"/i.test(tag)) continue; // skip emoji and external images
    const src = tag.match(/\bsrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');
    if (!src || !isMediaUrl(src)) continue;
    n++;
    out.push({ kind: 'image', name: `image-${n}`, ext: 'image', src });
  }
  return out.map((a, index) => ({ index, ...a }));
}

/** Reads a response body, refusing more than `max` bytes. */
export async function readCapped(res, max, what = 'file') {
  const declared = Number(res.headers.get('content-length'));
  if (declared && declared > max) throw new Error(`The ${what} is too large (${mb(declared)}; the limit is ${mb(max)}).`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new Error(`The ${what} is too large (over ${mb(max)}).`); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

export const mb = (n) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------- text extraction

const decoder = new TextDecoder('utf-8');
const decode = (bytes) => decoder.decode(bytes).replace(/^﻿/, '');

function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  });
}

function htmlToText(html) {
  return decodeXml(html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]{1,2000}>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Inflates raw-deflate data, stopping once the running total passes `budget.left` bytes. */
async function inflate(data, budget) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    budget.left -= value.byteLength;
    if (budget.left < 0) { await reader.cancel(); throw new Error('The file expands to more data than can be read.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** Minimal ZIP reader (Office files): returns Map(name -> bytes) for entries `wanted(name)` accepts. */
export async function unzip(bytes, wanted) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is damaged or not really an Office file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const budget = { left: LIMITS.unzippedBytes };
  const out = new Map();
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!wanted(name) || off + 30 > bytes.length) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (method === 0) {
      budget.left -= data.byteLength;
      if (budget.left < 0) throw new Error('The file expands to more data than can be read.');
      out.set(name, data);
    } else if (method === 8) {
      out.set(name, await inflate(data, budget));
    }
  }
  return out;
}

const byNumber = (a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/)?.[1] || 0);

async function docxText(bytes) {
  const files = await unzip(bytes, (n) => n === 'word/document.xml');
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('No document text found in this Word file.');
  return decode(xml).split(/<\/w:p>/).map((para) => decodeXml(para
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<[^>]+>/g, (_, t) => t ?? ''))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pptxText(bytes) {
  const files = await unzip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return [...files.keys()].sort(byNumber).map((name, i) => {
    const text = decode(files.get(name)).split(/<\/a:p>/)
      .map((para) => decodeXml([...para.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join('')))
      .filter((s) => s.trim()).join('\n');
    return `--- Slide ${i + 1} ---\n${text}`;
  }).join('\n\n');
}

async function xlsxText(bytes) {
  const files = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = files.has('xl/sharedStrings.xml')
    ? decode(files.get('xl/sharedStrings.xml')).split(/<\/si>/).map((si) => decodeXml([...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join('')))
    : [];
  const names = files.has('xl/workbook.xml') ? [...decode(files.get('xl/workbook.xml')).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((x) => decodeXml(x[1])) : [];
  const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [...files.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort(byNumber).map((name, i) => {
    const rows = decode(files.get(name)).split(/<\/row>/).map((row) => [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, inner = '']) => {
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = inner.match(/<v>([^<]*)<\/v>/)?.[1];
      if (type === 's') return csvCell(shared[Number(v)] ?? '');
      if (type === 'inlineStr') return csvCell(decodeXml([...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join('')));
      if (type === 'b') return v === '1' ? 'TRUE' : 'FALSE';
      return csvCell(decodeXml(v ?? ''));
    }).join(',')).filter((line) => line.replace(/,/g, '').trim());
    return `--- Sheet: ${names[i] || `Sheet ${i + 1}`} (${rows.length} rows) ---\n${rows.join('\n')}`;
  }).join('\n\n');
}

function notebookText(bytes) {
  const nb = JSON.parse(decode(bytes));
  return (nb.cells || []).map((c, i) => {
    const src = Array.isArray(c.source) ? c.source.join('') : String(c.source || '');
    if (c.cell_type === 'markdown') return src;
    const outputs = (c.outputs || []).map((o) => (Array.isArray(o.text) ? o.text.join('') : o.text || (o.data?.['text/plain'] ? [].concat(o.data['text/plain']).join('') : ''))).filter(Boolean).join('\n');
    return `[cell ${i + 1}, ${c.cell_type}]\n${src}${outputs ? `\n[output]\n${outputs.slice(0, 2000)}` : ''}`;
  }).join('\n\n');
}

/**
 * Turns file bytes into text. Returns { text, truncated, chars } or throws a short, readable error.
 * `extractPdf(bytes)` is optional (the local server provides one; the free Cloudflare plan cannot afford PDF parsing).
 */
export async function fileToText(bytes, ext, { extractPdf } = {}) {
  const kind = readableAs(ext);
  let text;
  if (kind === 'text') text = ext === 'html' || ext === 'htm' ? htmlToText(decode(bytes)) : decode(bytes);
  else if (ext === 'docx') text = await docxText(bytes);
  else if (ext === 'pptx') text = await pptxText(bytes);
  else if (ext === 'xlsx') text = await xlsxText(bytes);
  else if (kind === 'notebook') text = notebookText(bytes);
  else if (kind === 'pdf') {
    if (!extractPdf) throw Object.assign(new Error('PDF text can only be read by the local server.'), { unsupported: true });
    text = await extractPdf(bytes);
  } else throw Object.assign(new Error(`.${ext || '?'} files can't be read as text.`), { unsupported: true });
  text = String(text || '').replace(/\u0000/g, '');
  const truncated = text.length > LIMITS.textChars;
  return { text: truncated ? text.slice(0, LIMITS.textChars) : text, truncated, chars: text.length };
}
