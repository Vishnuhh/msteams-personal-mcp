// A small PDF reader for the free Cloudflare plan, where a full PDF engine needs more CPU than a request gets.
// It pulls the text layer out of content streams (with each font's ToUnicode map) and, for scanned PDFs,
// lifts out the page pictures (JPEG streams) so the assistant can read them itself. Web APIs only.
// Not a renderer: layout is approximate, and exotic encodings may come out empty (the caller then falls back).

// One character per byte, exactly. (TextDecoder('latin1') is really windows-1252 in Workers and remaps 0x80-0x9F.)
const latin1 = {
  decode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  },
};

/** True when extracted text is real text, not empty pages or undecoded glyph codes. */
export function looksReadable(text) {
  const s = String(text || '').replace(/--- Page \d+ of \d+ ---/g, '');
  const letters = (s.match(/\p{L}/gu) || []).length;
  const junk = (s.match(/[\u0000-\u0008\u000e-\u001f�]/g) || []).length;
  return letters >= 40 && junk / Math.max(1, s.length) < 0.02;
}

/** The page text from Cloudflare's toMarkdown output ("## Metadata", then "## Contents" with "### Page N"). */
export function markdownPdfBody(data) {
  const s = String(data || '');
  const i = s.indexOf('## Contents');
  if (i < 0) return '';
  const pages = s.slice(i + '## Contents'.length).split(/^### Page \d+\s*$/m).map((p) => p.trim()).slice(1);
  return pages.map((p, n) => `--- Page ${n + 1} of ${pages.length} ---\n${p}`).join('\n\n');
}

/** zlib inflate that keeps what it decoded when a stream has padding after its end (common in PDFs; Workers reject it). */
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch (e) {
    if (!size) throw e;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

const dictValue = (dict, key) => dict.match(new RegExp(`/${key}\\s*(\\d+\\s+\\d+\\s+R|\\[[^\\]]*\\]|<<[\\s\\S]*?>>|/[^\\s/<>\\[\\]()]+|\\d+)`))?.[1] ?? null;
const refNum = (v) => (v ? Number(v.match(/^(\d+)\s+\d+\s+R$/)?.[1]) || null : null);
const refsIn = (v) => [...String(v || '').matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));

/** Parses top-level objects and the objects packed into object streams: Map(num -> { dict, raw?, stream? }). */
async function readObjects(bytes) {
  const text = latin1.decode(bytes);
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const s = body.search(/\bstream\r?\n/);
    if (s >= 0) {
      const dict = body.slice(0, s);
      const dataStart = start + s + body.slice(s).match(/^stream\r?\n/)[0].length;
      const len = Number(dictValue(dict, 'Length'));
      let dataEnd = Number.isFinite(len) && len > 0 && /\/Length\s+\d+(?!\s+\d+\s+R)/.test(dict) ? dataStart + len : text.indexOf('endstream', dataStart);
      if (dataEnd < 0 || dataEnd > bytes.length) dataEnd = text.indexOf('endstream', dataStart);
      objs.set(Number(m[1]), { dict, stream: bytes.subarray(dataStart, dataEnd) });
    } else {
      objs.set(Number(m[1]), { dict: body, raw: body });
    }
    re.lastIndex = end;
  }
  // Object streams (/Type /ObjStm): many small objects compressed together.
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !/FlateDecode/.test(o.dict)) continue;
    let data;
    try { data = latin1.decode(await inflate(o.stream)); } catch { continue; }
    const n = Number(dictValue(o.dict, 'N')), first = Number(dictValue(o.dict, 'First'));
    const header = data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2], off = first + header[i * 2 + 1];
      const next = i + 1 < n ? first + header[(i + 1) * 2 + 1] : data.length;
      if (!objs.has(num)) objs.set(num, { dict: data.slice(off, next), raw: data.slice(off, next) });
    }
  }
  return objs;
}

function ascii85(bytes) {
  const s = latin1.decode(bytes).replace(/\s+/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
    const group = s.slice(i, i + 5);
    i += 5;
    const pad = 5 - group.length;
    let n = 0;
    for (const ch of group.padEnd(5, 'u')) n = n * 85 + (ch.charCodeAt(0) - 33);
    const four = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...four.slice(0, 4 - pad));
  }
  return new Uint8Array(out);
}

function asciiHex(bytes) {
  const h = latin1.decode(bytes).replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.ceil(h.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2).padEnd(2, '0'), 16);
  return out;
}

/** A stream's decoded bytes, applying its filters in order (Flate, ASCII85, ASCIIHex); null for anything else. */
async function streamData(o) {
  if (!o?.stream) return null;
  const filters = [...(dictValue(o.dict, 'Filter') || '').matchAll(/\/(\w+)/g)].map((m) => m[1]);
  let data = o.stream;
  for (const f of filters) {
    try {
      if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
      else return null;
    } catch {
      return null;
    }
  }
  return data;
}

/** ToUnicode CMap -> { map: Map(code -> text), bytes: 1|2 }. */
function parseCMap(cmap) {
  const map = new Map();
  const hex = (h) => parseInt(h, 16);
  const utf16 = (h) => {
    let s = '';
    for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4)));
    return s || String.fromCharCode(hex(h));
  };
  const width = cmap.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/)?.[1].length === 2 ? 1 : 2;
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(src), utf16(dst));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, a, b, rest] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const lo = hex(a), hi = Math.min(hex(b), lo + 0xffff);
      if (rest.startsWith('[')) {
        [...rest.matchAll(/<([0-9a-fA-F]+)>/g)].forEach((d, i) => map.set(lo + i, utf16(d[1])));
      } else {
        const base = rest.slice(1, -1);
        const start = hex(base.slice(-4));
        const prefix = utf16(base.slice(0, -4));
        for (let c = lo; c <= hi; c++) map.set(c, prefix + String.fromCharCode(start + c - lo));
      }
    }
  }
  return { map, bytes: width };
}

function literalBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '\\') { out.push(ch.charCodeAt(0) & 0xff); continue; }
    const n = s[++i];
    if (n === 'n') out.push(10); else if (n === 'r') out.push(13); else if (n === 't') out.push(9);
    else if (n === 'b') out.push(8); else if (n === 'f') out.push(12);
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out.push(parseInt(oct, 8) & 0xff);
    } else if (n === '\r' || n === '\n') { if (n === '\r' && s[i + 1] === '\n') i++; } else out.push(n.charCodeAt(0) & 0xff);
  }
  return out;
}

function decodeString(bytes, font) {
  if (!font) return String.fromCharCode(...bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += font.bytes) {
    const code = font.bytes === 2 ? (bytes[i] << 8) | (bytes[i + 1] ?? 0) : bytes[i];
    s += font.map.get(code) ?? (font.bytes === 1 ? String.fromCharCode(code) : '');
  }
  return s;
}

/** Text of one content stream, with fonts = Map(resourceName -> cmap). */
function contentText(content, fonts) {
  let out = '', font = null;
  const tok = /\/([^\s/<>\[\]()]+)\s+[-\d.]+\s+Tf|\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|(-?\d*\.?\d+)|\b(Tj|TJ|'|"|Td|TD|T\*|Tm|ET|BT)\b/g;
  let m, last = null, inArray = false, lastY = null;
  while ((m = tok.exec(content))) {
    const t = m[0];
    if (m[1]) { font = fonts.get(m[1]) || null; continue; }
    if (t === '[') { inArray = true; continue; }
    if (t === ']') { inArray = false; continue; }
    if (t[0] === '(' || t[0] === '<') {
      const bytes = t[0] === '(' ? literalBytes(t.slice(1, -1)) : (t.slice(1, -1).replace(/\s+/g, '').match(/../g) || []).map((h) => parseInt(h, 16));
      out += decodeString(bytes, font);
      continue;
    }
    if (m[2] !== undefined) { if (inArray && Number(m[2]) < -200) out += ' '; last = Number(m[2]); continue; }
    const op = m[3];
    if (op === 'T*' || op === "'" || op === '"') out += '\n';
    else if (op === 'Td' || op === 'TD') { if (last !== null && Math.abs(last) > 0.5) out += '\n'; else out += ' '; }
    else if (op === 'Tm') { if (lastY !== null && last !== lastY) out += '\n'; lastY = last; }
    else if (op === 'ET') out += '\n';
  }
  return out;
}

/**
 * Reads a PDF on a tight CPU budget. Returns { text, pages, images: [{ mimeType, bytes }] }.
 * images holds the page pictures (JPEG) when the PDF looks scanned (little or no text).
 */
export async function readPdfLite(bytes, { maxImages = 5, maxImageBytes = 4 * 1024 * 1024 } = {}) {
  const objs = await readObjects(bytes);
  const cmaps = new Map();
  const fontCMap = async (num) => {
    if (cmaps.has(num)) return cmaps.get(num);
    const f = objs.get(num);
    const tu = refNum(dictValue(f?.dict || '', 'ToUnicode'));
    let c = null;
    if (tu) { const d = await streamData(objs.get(tu)); if (d) c = parseCMap(latin1.decode(d)); }
    cmaps.set(num, c);
    return c;
  };
  const resolveDict = (v) => (refNum(v) ? objs.get(refNum(v))?.dict || '' : v || '');
  const pages = [...objs.values()].filter((o) => /\/Type\s*\/Page\b(?!s)/.test(o.dict));
  const texts = [];
  for (const p of pages) {
    const resources = resolveDict(dictValue(p.dict, 'Resources'));
    const fontDict = resolveDict(dictValue(resources, 'Font'));
    const fonts = new Map();
    for (const [, name, num] of fontDict.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts.set(name, await fontCMap(Number(num)));
    let content = '';
    for (const num of refsIn(dictValue(p.dict, 'Contents'))) {
      const o = objs.get(num);
      // A Contents ref may point to an array of streams.
      const parts = o?.stream ? [num] : refsIn(o?.raw);
      for (const part of parts) { const d = await streamData(objs.get(part)); if (d) content += latin1.decode(d) + '\n'; }
    }
    texts.push(contentText(content, fonts).replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  const text = texts.map((t, i) => `--- Page ${i + 1} of ${texts.length} ---\n${t}`).join('\n\n');
  const letters = texts.join('').replace(/\s/g, '').length;
  const images = [];
  if (letters < 40 * Math.max(1, pages.length)) {
    let total = 0;
    for (const o of objs.values()) {
      if (images.length >= maxImages) break;
      if (!o.stream || !/\/Subtype\s*\/Image/.test(o.dict) || !/\/DCTDecode/.test(o.dict) || /\/FlateDecode/.test(o.dict)) continue;
      if (Number(dictValue(o.dict, 'Width')) < 500) continue; // logos and icons, not pages
      if (total + o.stream.byteLength > maxImageBytes) break;
      total += o.stream.byteLength;
      images.push({ mimeType: 'image/jpeg', bytes: o.stream });
    }
  }
  return { text: letters ? text : '', pages: pages.length, images };
}
