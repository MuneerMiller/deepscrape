'use strict';
/*
 * Reads the text out of things that are not web pages:
 * PDF, Word, Excel, PowerPoint, OpenDocument, RTF, plain text formats - and, on request, images (OCR).
 */
const path = require('path');
const MAX_TEXT = 8_000_000;
const untag = (xml) => xml.replace(/<[^>]+>/g, '');
const unent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

async function pdfText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '';
    for (const it of tc.items) { line += it.str; if (it.hasEOL) line += '\n'; else if (it.str && !/\s$/.test(it.str)) line += ' '; }
    parts.push(`--- Page ${i} ---\n${line.replace(/[ \t]+\n/g, '\n').trim()}`);
    page.cleanup();
  }
  let info = {}; try { info = (await doc.getMetadata()).info || {}; } catch { /* none */ }
  const meta = { pages: doc.numPages, title: info.Title || undefined, author: info.Author || undefined, created: info.CreationDate || undefined, producer: info.Producer || undefined };
  await doc.destroy();
  const text = parts.join('\n\n');
  return { text, meta, scanned: text.replace(/--- Page \d+ ---/g, '').trim().length < 20 * doc.numPages ? true : undefined };
}

async function zipXml(buf) { const JSZip = require('jszip'); return JSZip.loadAsync(buf); }
const numOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true });

async function xlsxText(buf) {
  const zip = await zipXml(buf);
  const read = async (n) => (zip.file(n) ? zip.file(n).async('string') : '');
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unent([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const names = [...(await read('xl/workbook.xml')).matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => unent(m[1]));
  const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(numOrder);
  const out = [];
  for (let i = 0; i < sheets.length; i++) {
    const xml = await read(sheets[i]); const rows = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = (c[1].match(/\bt="([^"]*)"/) || [])[1]; const body = c[2] || '';
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const col = ((c[1].match(/\br="([A-Z]+)\d+"/) || [])[1] || '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const val = type === 's' ? shared[+v] ?? '' : type === 'inlineStr' ? unent(untag(body)) : v != null ? unent(v) : '';
        if (col >= 0) { while (cells.length < col) cells.push(''); cells[col] = val; } else cells.push(val);
      }
      rows.push(cells.join('\t'));
    }
    out.push(`--- Sheet: ${names[i] || i + 1} ---\n${rows.join('\n')}`);
  }
  return { text: out.join('\n\n'), meta: { sheets: sheets.length } };
}
async function pptxText(buf) {
  const zip = await zipXml(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(numOrder);
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    const xml = await zip.file(slides[i]).async('string');
    const paras = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((p) => unent([...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join(''))).filter(Boolean);
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`);
    const notes = notesFile ? unent([...(await notesFile.async('string')).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join(' ')) : '';
    out.push(`--- Slide ${i + 1} ---\n${paras.join('\n')}${notes ? '\n[Notes] ' + notes : ''}`);
  }
  return { text: out.join('\n\n'), meta: { slides: slides.length } };
}
async function odfText(buf) {
  const zip = await zipXml(buf); const f = zip.file('content.xml'); if (!f) return { text: '' };
  const xml = await f.async('string');
  return { text: unent(untag(xml.replace(/<\/(text:p|text:h|table:table-row)>/g, '\n').replace(/<\/table:table-cell>/g, '\t'))).replace(/\n{3,}/g, '\n\n').trim() };
}
const rtfText = (buf) => ({ text: buf.toString('latin1').replace(/\\par[d]?\b/g, '\n').replace(/\\'[0-9a-f]{2}/gi, '').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').trim() });

const KIND = { '.pdf': 'PDF', '.docx': 'Word', '.xlsx': 'Excel', '.xlsm': 'Excel', '.pptx': 'PowerPoint', '.odt': 'OpenDocument text', '.ods': 'OpenDocument sheet', '.odp': 'OpenDocument slides', '.rtf': 'RTF', '.txt': 'Text', '.csv': 'CSV', '.tsv': 'TSV', '.json': 'JSON', '.xml': 'XML', '.md': 'Markdown', '.ics': 'Calendar', '.vcf': 'Contact card', '.srt': 'Subtitles', '.vtt': 'Subtitles', '.log': 'Text', '.yaml': 'YAML', '.yml': 'YAML', '.webmanifest': 'Manifest' };
const MIME_KIND = [[/pdf/, '.pdf'], [/wordprocessingml/, '.docx'], [/spreadsheetml/, '.xlsx'], [/presentationml/, '.pptx'], [/opendocument\.text/, '.odt'], [/opendocument\.spreadsheet/, '.ods'], [/opendocument\.presentation/, '.odp'], [/rtf/, '.rtf'], [/json/, '.json'], [/csv/, '.csv'], [/xml/, '.xml'], [/^text\//, '.txt']];

/** Returns { kind, text, meta } or null when the format holds no readable text. Never throws. */
async function extractDocText(buf, fileName, mime = '') {
  let ext = path.extname(fileName || '').toLowerCase();
  if (!KIND[ext]) { const hit = MIME_KIND.find(([re]) => re.test(mime)); ext = hit ? hit[1] : ext; }
  if (buf.slice(0, 5).toString() === '%PDF-') ext = '.pdf';
  if (!KIND[ext]) return null;
  try {
    let r;
    if (ext === '.pdf') r = await pdfText(buf);
    else if (ext === '.docx') { const mammoth = require('mammoth'); r = { text: (await mammoth.extractRawText({ buffer: buf })).value }; }
    else if (ext === '.xlsx' || ext === '.xlsm') r = await xlsxText(buf);
    else if (ext === '.pptx') r = await pptxText(buf);
    else if (/^\.od[tsp]$/.test(ext)) r = await odfText(buf);
    else if (ext === '.rtf') r = rtfText(buf);
    else r = { text: buf.toString('utf8') };
    const text = (r.text || '').slice(0, MAX_TEXT);
    return { kind: KIND[ext], text, meta: r.meta || {}, scanned: r.scanned, words: (text.match(/\S+/g) || []).length };
  } catch (e) { return { kind: KIND[ext], text: '', meta: {}, error: e.message.split('\n')[0], words: 0 }; }
}

// ── text inside images (OCR). One shared engine, images read one at a time. ──
let workerPromise = null, chain = Promise.resolve();
function ocrImage(file) {
  const job = chain.then(async () => {
    if (!workerPromise) {
      workerPromise = (async () => {
        const { createWorker } = require('tesseract.js');
        const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0');
        return createWorker('eng', 1, { langPath, cachePath: langPath, cacheMethod: 'none', gzip: true });
      })();
    }
    const worker = await workerPromise;
    const { data } = await worker.recognize(file);
    const text = (data.text || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    return data.confidence >= 55 && /[A-Za-z0-9]{3}/.test(text) ? { text, confidence: Math.round(data.confidence) } : null;
  }).catch(() => null);
  chain = job;
  return job;
}
async function stopOcr() { if (workerPromise) { try { (await workerPromise).terminate(); } catch { /* gone */ } workerPromise = null; } }

module.exports = { extractDocText, ocrImage, stopOcr };
