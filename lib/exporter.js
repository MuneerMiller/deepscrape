'use strict';
/*
 * Custom exports. The person chooses:
 *   what    - any mix of data sets (pages, text, links, tables, security findings ...) and file groups (screenshots, documents ...)
 *   which   - all pages, one section of the site, addresses containing some text, or only pages with a given result
 *   format  - Excel, CSV, JSON, Markdown, web page, PDF, Word, or a ZIP folder (the only format that can carry files)
 *
 *   const { buildExport } = require('./lib/exporter');
 *   const { buffer, filename } = await buildExport(dir, { include: ['pages', 'tables'], format: 'xlsx', section: '/blog' });
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');

const GROUPS = ['Content', 'Structure', 'Data', 'Reviews', 'Technical'];
const DATASETS = [
  { id: 'pages', group: 'Content', label: 'Page list', about: 'One row per page: address, title, result, words, counts' },
  { id: 'content', group: 'Content', label: 'Page text', about: 'The readable content of every page' },
  { id: 'metadata', group: 'Content', label: 'Titles and descriptions', about: 'Title, description, canonical address, language, social preview' },
  { id: 'headings', group: 'Content', label: 'Headings', about: 'Every heading on every page, with its level' },
  { id: 'documents', group: 'Content', label: 'Documents', about: 'PDFs and Office files found, with word counts' },
  { id: 'contacts', group: 'Content', label: 'Contact details', about: 'Emails, phone numbers and social profiles, with the page each was on' },
  { id: 'links', group: 'Structure', label: 'Links', about: 'Every link: where it is, where it goes, its text' },
  { id: 'images', group: 'Structure', label: 'Images', about: 'Every image with its description, size and saved copy' },
  { id: 'forms', group: 'Structure', label: 'Forms and fields', about: 'Every form field: name, kind, label, choices' },
  { id: 'tables', group: 'Data', label: 'Tables', about: 'The cells of every table found on the pages' },
  { id: 'hiddenData', group: 'Data', label: 'Hidden data', about: 'Index of the background data the pages loaded' },
  { id: 'structuredData', group: 'Data', label: 'Structured data', about: 'Schema.org, Open Graph and embedded app data per page' },
  { id: 'security', group: 'Reviews', label: 'Security findings', about: 'Graded findings with how to fix each' },
  { id: 'checks', group: 'Reviews', label: 'Content checks', about: 'Broken links, missing titles, duplicates, thin pages' },
  { id: 'accessibility', group: 'Reviews', label: 'Accessibility', about: 'Problems counted per page' },
  { id: 'performance', group: 'Reviews', label: 'Speed', about: 'Size, requests and paint times per page' },
  { id: 'design', group: 'Reviews', label: 'Design', about: 'Colours, fonts, sizes, variables, breakpoints' },
  { id: 'lenses', group: 'Reviews', label: 'Lens review', about: 'Every lens with its facts and any AI verdict' },
  { id: 'aiAnswers', group: 'Reviews', label: 'AI answers', about: 'Questions asked of your AI about this site, with the answers' },
  { id: 'technology', group: 'Technical', label: 'Technology', about: 'What the site is built with' },
  { id: 'cookies', group: 'Technical', label: 'Cookies', about: 'Every cookie and its flags' },
  { id: 'otherHosts', group: 'Technical', label: 'Other hosts contacted', about: 'Third parties and trackers' },
  { id: 'redirects', group: 'Technical', label: 'Redirects and skipped pages', about: 'Redirects, pages behind a sign-in, pages robots.txt excluded' },
];
const FILES = [   // only a ZIP can carry these
  { id: 'screenshots', label: 'Screenshots', about: 'Desktop and phone-width picture of each page' },
  { id: 'html', label: 'Page source', about: 'Original and rendered HTML of each page' },
  { id: 'pageRecords', label: 'Full page records', about: 'Everything extracted per page, plus its network log and accessibility tree' },
  { id: 'hiddenDataFiles', label: 'Hidden data files', about: 'The saved background responses themselves' },
  { id: 'documentFiles', label: 'Document files', about: 'The PDFs and Office files, with their extracted text' },
  { id: 'assets', label: 'Images, styles, scripts, fonts', about: 'Everything the pages loaded' },
];
const FORMATS = [
  { id: 'xlsx', label: 'Excel', about: 'One sheet per data set, ready to sort and filter', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { id: 'zip', label: 'ZIP folder', about: 'Data as CSV and JSON, text as files, plus any files you tick', mime: 'application/zip', files: true },
  { id: 'csv', label: 'CSV', about: 'One file per data set (zipped when there are several)', mime: 'text/csv; charset=utf-8' },
  { id: 'json', label: 'JSON', about: 'Everything chosen in one file, for other tools', mime: 'application/json; charset=utf-8' },
  { id: 'md', label: 'Markdown', about: 'One readable document; good for giving to an AI', mime: 'text/markdown; charset=utf-8' },
  { id: 'docx', label: 'Word', about: 'One document with a section per data set', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'pdf', label: 'PDF', about: 'The same, fixed for sending', mime: 'application/pdf' },
  { id: 'html', label: 'Web page', about: 'Opens in any browser, with a table for each data set', mime: 'text/html; charset=utf-8' },
];
const PRESETS = [
  { id: 'everything', label: 'Everything', about: 'All data and all files', include: DATASETS.map((d) => d.id), files: FILES.map((f) => f.id), format: 'zip' },
  { id: 'spreadsheet', label: 'Everything as a spreadsheet', about: 'All data sets in one Excel workbook', include: DATASETS.map((d) => d.id).filter((d) => d !== 'content'), files: [], format: 'xlsx' },
  { id: 'ai', label: 'Content for an AI', about: 'Page text and documents in one Markdown file', include: ['pages', 'content', 'documents', 'contacts'], files: [], format: 'md' },
  { id: 'data', label: 'Just the data', about: 'Tables, hidden data and structured data', include: ['tables', 'hiddenData', 'structuredData'], files: ['hiddenDataFiles'], format: 'zip' },
  { id: 'seo', label: 'For search and content work', about: 'Pages, titles, headings, links, checks', include: ['pages', 'metadata', 'headings', 'links', 'checks', 'redirects'], files: [], format: 'xlsx' },
  { id: 'security', label: 'For a security review', about: 'Findings, cookies, third parties, technology, forms', include: ['security', 'cookies', 'otherHosts', 'technology', 'forms', 'redirects'], files: [], format: 'xlsx' },
  { id: 'designer', label: 'For a designer', about: 'Design tokens, images, screenshots, fonts', include: ['design', 'images', 'accessibility'], files: ['screenshots', 'assets'], format: 'zip' },
  { id: 'developer', label: 'For a developer', about: 'Source, assets, hidden data, technology, speed', include: ['pages', 'technology', 'performance', 'hiddenData', 'forms', 'structuredData'], files: ['html', 'pageRecords', 'hiddenDataFiles', 'assets'], format: 'zip' },
  { id: 'client', label: 'Summary for a client', about: 'Findings and checks as a Word document', include: ['security', 'checks', 'accessibility', 'performance', 'technology', 'contacts'], files: [], format: 'docx' },
];
const options = () => ({ groups: GROUPS, datasets: DATASETS, files: FILES, formats: FORMATS.map(({ mime, ...f }) => f), presets: PRESETS, topics: TOPICS.map(({ from, skip, ...t }) => t) });

const pathOf = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const sectionOf = (u) => { try { return '/' + (new URL(u).pathname.split('/').filter(Boolean)[0] || ''); } catch { return '/'; } };
function pageFilter({ section, contains, result } = {}) {
  const c = (contains || '').toLowerCase().trim();
  return (p) => (!section || sectionOf(p.url) === section) && (!c || (p.url + ' ' + (p.title || '')).toLowerCase().includes(c))
    && (!result || (result === 'ok' ? !p.error && p.status < 400 : result === 'problems' ? !!p.error || p.status >= 400 : true));
}
async function eachLine(file, fn) {
  if (!fs.existsSync(file)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) { if (!line) continue; let j; try { j = JSON.parse(line); } catch { continue; } fn(j); }
}

/** Collect the chosen data sets as { id, label, columns, rows } for the chosen pages. */
async function gather(dir, summary, include, filter) {
  const want = new Set(include); const P = summary.perspectives || {}; const pages = summary.pages.filter(pageFilter(filter));
  const ids = new Set(pages.map((p) => p.id)); const urlOf = new Map(pages.map((p) => [p.id, p.url])); const urls = new Set(pages.map((p) => p.url));
  const all = pages.length === summary.pages.length; const out = [];
  const add = (id, columns, rows) => { if (want.has(id)) out.push({ id, label: DATASETS.find((d) => d.id === id).label, columns, rows }); };

  add('pages', ['Address', 'Result', 'Title', 'Description', 'Clicks from start', 'Words', 'Links', 'Images', 'Tables', 'Forms', 'Hidden data', 'Load seconds', 'Security risks', 'Found on'],
    pages.map((p) => [p.url, p.error ? 'failed: ' + p.error : p.status, p.title, p.description, p.depth, p.words, p.links, p.images, p.tables, p.forms, p.apiResponses, p.durationMs ? Math.round(p.durationMs / 100) / 10 : '', p.risks, p.foundOn]));
  if (want.has('content')) { const rows = []; for (const p of pages) { let t = ''; try { t = await fsp.readFile(path.join(dir, 'pages', p.id, 'content.md'), 'utf8'); } catch { continue; } rows.push([p.url, p.title, p.words, t]); } add('content', ['Address', 'Title', 'Words', 'Text'], rows); }

  const perPage = ['metadata', 'headings', 'forms', 'tables', 'structuredData', 'accessibility', 'performance'].filter((x) => want.has(x)); const R = Object.fromEntries(perPage.map((k) => [k, []])); const pageContacts = [];
  if (perPage.length || want.has('contacts')) {
    await eachLine(path.join(dir, 'pages.jsonl'), (r) => {
      if (!ids.has(r.id) || r.error || r.kind === 'file') return; const u = r.url;
      if (R.metadata) { const m = (r.meta && r.meta.byName) || {}; R.metadata.push([u, r.title, (r.title || '').length, r.description, (r.description || '').length, r.canonical, r.language, r.robotsMeta, (r.headings || []).filter((h) => h.level === 1).map((h) => h.text).join(' | '), m['og:title'], m['og:description'], m['og:image'], m['twitter:card'], m.keywords, m.author, r.wordCount]); }
      if (R.headings) for (const h of r.headings || []) R.headings.push([u, 'H' + h.level, h.text]);
      if (R.forms) (r.forms || []).forEach((f, fi) => f.fields.forEach((x) => R.forms.push([u, fi + 1, f.action, String(f.method || '').toUpperCase(), x.name || x.id, x.type || x.tag, x.label || x.placeholder, x.required ? 'yes' : '', (x.options || []).map((o) => o.text).join(' | ')])));
      if (R.tables) (r.tables || []).forEach((t, ti) => t.rows.forEach((row, ri) => R.tables.push([u, ti + 1, t.caption, ri + 1, t.headers && ri === 0 ? 'header' : '', ...row])));
      if (R.structuredData) { const sd = r.structuredData || {}; for (const j of sd.jsonLd || []) R.structuredData.push([u, 'Schema.org (JSON-LD)', j && j['@type'] ? [].concat(j['@type']).join(', ') : '', JSON.stringify(j)]); for (const j of sd.microdata || []) R.structuredData.push([u, 'Microdata', j.type, JSON.stringify(j.properties)]); if (r.meta && Object.keys(r.meta.openGraph || {}).length) R.structuredData.push([u, 'Open Graph', r.meta.openGraph['og:type'] || '', JSON.stringify(r.meta.openGraph)]); for (const [k, v] of Object.entries(sd.appState || {})) R.structuredData.push([u, 'App state', k, JSON.stringify(v).slice(0, 30000)]); }
      if (R.accessibility && r.accessibility) { const a = r.accessibility; R.accessibility.push([u, a.lowContrastText, a.imagesWithoutDescription, a.fieldsWithoutLabel, a.linksWithoutText, a.buttonsWithoutName, a.headingLevelsSkipped, a.smallTouchTargets ?? '', a.language || 'not declared', a.landmarks && a.landmarks.main ? 'yes' : 'no', a.zoomBlocked ? 'yes' : 'no', (a.lowContrastExamples || []).map((x) => `${x.text} (${x.ratio}:1)`).join(' | ')]); }
      if (R.performance && r.audit) { const w = r.audit.weight; const v = r.vitals || {}; const pf = r.performance || {}; R.performance.push([u, w.total, w.requests, pf.ttfbMs, v.firstPaintMs, v.largestPaintMs, v.layoutShift, v.domNodes, w.byType.script || 0, w.byType.image || 0, w.byType.stylesheet || 0, w.byType.font || 0, (r.audit.thirdParties || []).length]); }
      if (want.has('contacts') && r.contacts) { for (const e of r.contacts.emails) pageContacts.push(['Email', e, u]); for (const e of r.contacts.phones) pageContacts.push(['Phone', e, u]); for (const e of r.contacts.socials) pageContacts.push(['Social profile', e, u]); }
    });
  }
  add('metadata', ['Address', 'Title', 'Title length', 'Description', 'Description length', 'Canonical address', 'Language', 'Robots', 'Main headings', 'Social title', 'Social description', 'Social image', 'Twitter card', 'Keywords', 'Author', 'Words'], R.metadata || []);
  add('headings', ['Address', 'Level', 'Heading'], R.headings || []);
  add('documents', ['Address', 'Kind', 'Words', 'Pages', 'Bytes', 'Found on', 'Saved as', 'Text file'], (summary.documents || []).filter((d) => all || urls.has(d.foundOn)).map((d) => [d.url, d.kind, d.words, d.pages || d.sheets || d.slides || '', d.bytes, d.foundOn, d.saved, d.text || (d.scanned ? '(scan, no text)' : '')]));
  if (want.has('contacts')) { const seen = new Map(); for (const [k, v, u] of pageContacts) { const key = k + '|' + v; if (!seen.has(key)) seen.set(key, [k, v, u, 0]); seen.get(key)[3]++; } add('contacts', ['Kind', 'Value', 'First seen on', 'Pages'], [...seen.values()]); }
  if (want.has('links')) { const rows = []; await eachLine(path.join(dir, 'links.jsonl'), (l) => { if (ids.has(l.page)) rows.push([l.from, l.href, l.text, l.scope, l.rel]); }); add('links', ['Found on', 'Goes to', 'Link text', 'Kind', 'Rel'], rows); }
  if (want.has('images')) { const rows = []; await eachLine(path.join(dir, 'images.jsonl'), (l) => { if (ids.has(l.page)) rows.push([l.pageUrl, l.src, l.alt, l.width, l.height, l.saved, l.textInImage]); }); add('images', ['Found on', 'Image address', 'Description', 'Width', 'Height', 'Saved as', 'Text inside the image'], rows); }
  add('forms', ['Address', 'Form', 'Sends to', 'Method', 'Field', 'Kind', 'Label', 'Required', 'Choices'], R.forms || []);
  if (R.tables) { const width = Math.max(0, ...R.tables.map((r) => r.length - 5)); add('tables', ['Address', 'Table', 'Caption', 'Row', 'Row kind', ...Array.from({ length: width }, (_, i) => 'Column ' + (i + 1))], R.tables); }
  if (want.has('hiddenData')) { const rows = []; await eachLine(path.join(dir, 'api.jsonl'), (l) => { if (ids.has(l.page)) rows.push([l.pageUrl, l.method, l.url, l.status, l.mime, l.bytes, l.saved]); }); add('hiddenData', ['Loaded by', 'Method', 'Address', 'Result', 'Type', 'Bytes', 'Saved as'], rows); }
  add('structuredData', ['Address', 'Kind', 'Type', 'Data'], R.structuredData || []);
  add('security', ['Severity', 'Finding', 'Pages affected', 'Detail', 'How to fix', 'Example pages'], ((P.security || {}).findings || []).map((f) => [f.severity, f.title, f.pagesAffected, f.details.join(' | '), f.fix, f.pages.filter((u) => all || urls.has(u)).slice(0, 15).join('\n')]).filter((r) => all || r[5] || !r[2]));
  add('checks', ['Check', 'Item', 'Detail'], Object.entries(summary.issues || {}).flatMap(([k, list]) => list.map((x) => [k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), typeof x === 'string' ? x : x.url || x.from || (x.pages || []).join(', '), typeof x === 'string' ? '' : x.to ? `links to ${x.to} (${x.status})` : x.error || x.value || x.count || x.status || x.seconds || ''])).filter((r) => all || [...urls].some((u) => String(r[1]).includes(u))));
  add('accessibility', ['Address', 'Low-contrast text', 'Images without description', 'Fields without label', 'Links without text', 'Buttons without name', 'Heading levels skipped', 'Small tap targets', 'Language', 'Main landmark', 'Zoom blocked', 'Low-contrast examples'], R.accessibility || []);
  add('performance', ['Address', 'Bytes', 'Requests', 'First byte (ms)', 'First paint (ms)', 'Largest paint (ms)', 'Layout shift', 'Elements', 'Script bytes', 'Image bytes', 'Style bytes', 'Font bytes', 'Other hosts'], R.performance || []);
  if (want.has('design')) { const d = P.design || { colors: { text: [], background: [], border: [] }, fonts: [], fontSizes: [], cornerRadii: [], shadows: [], breakpoints: [], cssVariables: {}, fontFiles: [], logos: [] }; const rows = [];
    for (const [k, list] of [['Text colour', d.colors.text], ['Background colour', d.colors.background], ['Border colour', d.colors.border], ['Font and weight', d.fonts], ['Type size', d.fontSizes], ['Corner radius', d.cornerRadii], ['Shadow', d.shadows], ['Breakpoint', d.breakpoints]]) for (const x of list) rows.push([k, x.value, x.count]);
    for (const [k, v] of Object.entries(d.cssVariables)) rows.push(['Design variable', `${k}: ${v}`, '']); for (const f of d.fontFiles) rows.push(['Font file', `${f.family} ${f.weight || ''} ${f.src || ''}`.trim(), '']); for (const l of d.logos) rows.push(['Logo', l, '']);
    for (const [k, v] of Object.entries(d.typography || {})) if (v) rows.push(['Style of ' + k, `${v.fontFamily.split(',')[0]} ${v.fontSize}/${v.lineHeight} weight ${v.fontWeight} ${v.color}`, '']);
    add('design', ['Kind', 'Value', 'Uses'], rows); }
  if (want.has('lenses')) { const { model } = require('./report'); const m = model(summary, { verdicts: require('./ai').readVerdicts(dir) }); add('lenses', ['Family', 'Lens no.', 'Lens', 'Coverage', 'Matched by', 'Facts', 'Note', 'AI rating', 'AI verdict', 'AI: what to do'], m.families.flatMap((f) => f.lenses.map((l) => [`${f.id}. ${f.name}`, l.n, l.name, l.coverage, l.matchedBy, l.evidence.join('\n'), l.note, l.ai ? l.ai.rating : '', l.ai ? l.ai.verdict : '', l.ai ? l.ai.action : '']))); }
  if (want.has('aiAnswers')) add('aiAnswers', ['When', 'AI', 'Question', 'Answer'], require('./ai').readAnswers(dir).map((a) => [a.at, a.ai, a.question, a.answer]));
  add('technology', ['Technology', 'Pages seen on'], (summary.technologies || []).map((t) => [t.name, t.pages]));
  add('cookies', ['Name', 'Set by', 'Lasts (days)', 'Secure', 'Hidden from scripts', 'SameSite', 'From another site'], ((P.privacy || {}).cookies || []).map((c) => [c.name, c.domain, c.lastsDays, c.secure ? 'yes' : 'no', c.httpOnly ? 'yes' : 'no', c.sameSite || 'not set', c.fromAnotherSite ? 'yes' : 'no']));
  add('otherHosts', ['Host', 'Recognised as', 'Pages', 'Requests', 'Loads'], ((P.privacy || {}).thirdParties || []).map((t) => [t.host, t.service || '', t.pages, t.requests, t.kinds.join(', ')]));
  add('redirects', ['Kind', 'Address', 'Detail'], [...(summary.redirects || []).map((r) => ['Redirect', r.from, 'goes to ' + r.to]), ...(summary.needSignIn || []).map((g) => [g.reason === 'challenge' ? 'Behind a human check' : 'Behind a sign-in', g.url, 'at ' + (g.loginHost || '')]), ...((summary.robots || {}).blockedUrls || []).map((u) => ['Excluded by robots.txt', u, '']), ...((summary.skipped || {}).stateChangingLinks || []).map((u) => ['Not followed (changes something)', u, ''])]);
  return { sets: out.sort((a, b) => DATASETS.findIndex((d) => d.id === a.id) - DATASETS.findIndex((d) => d.id === b.id)), pages };
}

// ───────────── writers ─────────────
const cellText = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const toCsv = (set) => '﻿' + [set.columns, ...set.rows].map((r) => r.map((v) => { const t = cellText(v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(',')).join('\r\n');
async function toXlsx(sets, info) {
  const JSZip = require('jszip'); const zip = new JSZip();
  const sheets = [{ label: 'About this export', columns: ['', ''], rows: info, plain: true }, ...sets];
  const x = (v) => cellText(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 32000);
  const col = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const used = new Set(); const names = sheets.map((s) => { let n = s.label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31); for (let i = 2; used.has(n); i++) n = n.slice(0, 28) + ' ' + i; used.add(n); return n; });
  sheets.forEach((s, si) => {
    const rows = s.plain ? s.rows : [s.columns, ...s.rows.slice(0, 1048000)]; let body = '';
    rows.forEach((r, ri) => { body += `<row r="${ri + 1}">` + r.map((v, ci) => { if (v == null || v === '') return ''; const ref = col(ci) + (ri + 1); const st = (!s.plain && ri === 0) || (s.plain && ci === 0) ? 1 : 2; return typeof v === 'number' && isFinite(v) ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`; }).join('') + '</row>'; });
    const widths = (s.plain ? [26, 90] : s.columns.map((c, i) => Math.max(10, Math.min(70, Math.max(String(c).length + 2, ...s.rows.slice(0, 60).map((r) => Math.min(70, cellText(r[i]).split('\n')[0].length + 2)))))));
    const last = col(Math.max(1, s.columns.length) - 1) + rows.length;
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${s.plain ? '' : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${!s.plain && rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`);
  });
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const LIMIT = { md: 400, html: 1500, pdf: 600, docx: 400 };     // rows shown per data set in document formats; spreadsheets carry everything
function toMarkdown(sets, head) {
  const L = [`# ${head.title}`, '', ...head.lines, ''];
  for (const s of sets) {
    L.push(`## ${s.label}`, '');
    if (s.id === 'content') { for (const r of s.rows) L.push(String(r[3]).replace(/^# /m, '### '), '', '---', ''); continue; }
    if (s.id === 'aiAnswers') { for (const r of s.rows) L.push(`**${r[2]}** (${r[1]}, ${r[0]})`, '', String(r[3]), ''); continue; }
    if (!s.rows.length) { L.push('Nothing of this kind was found.', ''); continue; }
    const c = (v) => cellText(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>').slice(0, 400);
    L.push('| ' + s.columns.join(' | ') + ' |', '|' + s.columns.map(() => ' --- ').join('|') + '|', ...s.rows.slice(0, LIMIT.md).map((r) => '| ' + s.columns.map((_, i) => c(r[i])).join(' | ') + ' |'));
    if (s.rows.length > LIMIT.md) L.push('', `*${s.rows.length - LIMIT.md} more rows. Export as Excel or CSV for all ${s.rows.length}.*`);
    L.push('');
  }
  return L.join('\n');
}
function toHtml(sets, head, limit = LIMIT.html) {
  const e = (v) => cellText(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(head.title)}</title><style>
  body{font:13.5px/1.5 "Segoe UI",system-ui,sans-serif;color:#14263B;margin:28px} h1{font-size:26px;margin:0 0 4px} h2{font-size:19px;margin:30px 0 8px;border-bottom:2px solid #0B7A75;padding-bottom:4px;break-after:avoid}
  .meta{color:#5B6B7D} nav a{margin-right:12px;color:#0B7A75} table{border-collapse:collapse;width:100%;font-size:12px;table-layout:auto} th{background:#EEF2F5;text-align:left;position:sticky;top:0} th,td{border:1px solid #D3DCE4;padding:4px 7px;vertical-align:top;word-break:break-word;max-width:420px}
  tr{break-inside:avoid} pre{white-space:pre-wrap;word-break:break-word;font:12.5px/1.5 Consolas,monospace;background:#F4F7F9;padding:10px;border-radius:6px} @media print{body{margin:0} nav{display:none} th{position:static}}</style></head><body>
  <h1>${e(head.title)}</h1><p class="meta">${head.lines.map(e).join('<br>')}</p><nav>${sets.map((s) => `<a href="#${s.id}">${e(s.label)} (${s.rows.length})</a>`).join('')}</nav>
  ${sets.map((s) => `<h2 id="${s.id}">${e(s.label)} <span class="meta">${s.rows.length}</span></h2>` + (s.id === 'content' ? s.rows.slice(0, limit).map((r) => `<h3>${e(r[1] || r[0])}</h3><p class="meta">${e(r[0])}</p><pre>${e(r[3])}</pre>`).join('')
    : s.id === 'aiAnswers' ? s.rows.map((r) => `<h3>${e(r[2])}</h3><p class="meta">${e(r[1])}, ${e(r[0])}</p><pre>${e(r[3])}</pre>`).join('')
    : !s.rows.length ? '<p class="meta">Nothing of this kind was found.</p>'
    : `<table><thead><tr>${s.columns.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.slice(0, limit).map((r) => `<tr>${s.columns.map((_, i) => `<td>${e(cellText(r[i]).slice(0, 1200)).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>${s.rows.length > limit ? `<p class="meta">${s.rows.length - limit} more rows. Export as Excel or CSV for all ${s.rows.length}.</p>` : ''}`)).join('')}
  </body></html>`;
}
async function toDocx(sets, head) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageOrientation } = require('docx');
  const FONT = 'Calibri'; const clean = (t) => cellText(t).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\s*\n\s*/g, ' ; ').slice(0, 700);
  const para = (t, o = {}) => new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: clean(t), font: FONT, size: o.size || 20, color: o.color, bold: o.bold })] });
  const kids = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: clean(head.title), font: FONT })] }), ...head.lines.map((l) => para(l, { color: '5B6B7D' }))];
  const W = 13958; const border = { style: BorderStyle.SINGLE, size: 4, color: 'D3DCE4' }; const borders = { top: border, bottom: border, left: border, right: border };
  for (const s of sets) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `${s.label} (${s.rows.length})`, font: FONT })] }));
    if (s.id === 'content' || s.id === 'aiAnswers') { for (const r of s.rows.slice(0, LIMIT.docx)) { kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: clean(s.id === 'content' ? r[1] || r[0] : r[2]), font: FONT })] }), para(s.id === 'content' ? r[0] : `${r[1]}, ${r[0]}`, { color: '5B6B7D' })); for (const line of String(r[3]).split(/\n+/).filter((x) => x.trim()).slice(0, 400)) kids.push(para(line.replace(/^#+\s*/, ''))); } continue; }
    if (!s.rows.length) { kids.push(para('Nothing of this kind was found.', { color: '5B6B7D' })); continue; }
    const cols = s.columns.slice(0, 8); const cw = cols.map(() => Math.floor(W / cols.length)); cw[cw.length - 1] += W - cw.reduce((a, b) => a + b, 0);
    const cell = (t, i, headRow) => new TableCell({ width: { size: cw[i], type: WidthType.DXA }, borders, margins: { top: 40, bottom: 40, left: 70, right: 70 }, ...(headRow ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2F5' } } : {}), children: [new Paragraph({ children: [new TextRun({ text: clean(t).slice(0, 300), font: FONT, size: 16, bold: !!headRow })] })] });
    kids.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cw, rows: [new TableRow({ tableHeader: true, children: cols.map((c, i) => cell(c, i, true)) }), ...s.rows.slice(0, LIMIT.docx).map((r) => new TableRow({ children: cols.map((_, i) => cell(r[i], i)) }))] }));
    const notes = []; if (s.columns.length > 8) notes.push(`${s.columns.length - 8} more columns`); if (s.rows.length > LIMIT.docx) notes.push(`${s.rows.length - LIMIT.docx} more rows`);
    if (notes.length) kids.push(para(`Not shown here: ${notes.join(' and ')}. Export as Excel for everything.`, { color: '5B6B7D' }));
  }
  const hs = (size, before, color) => ({ run: { font: FONT, size, bold: true, color }, paragraph: { spacing: { before, after: 100 }, keepNext: true } });
  const doc = new Document({ creator: 'DeepScrape', title: head.title, styles: { default: { document: { run: { font: FONT, size: 20 } }, title: { run: { font: FONT, size: 44, bold: true, color: '14263B' }, paragraph: { spacing: { before: 0, after: 120 }, keepNext: true } }, heading1: hs(30, 360, '0B7A75'), heading2: hs(24, 200, '14263B') } },
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 1000, bottom: 1000, left: 1440, right: 1440 } } }, children: kids }] });
  return Packer.toBuffer(doc);
}
const zipBuffer = (fill) => new Promise((resolve, reject) => { const archiver = require('archiver'); const z = archiver('zip', { zlib: { level: 6 } }); const chunks = []; z.on('data', (c) => chunks.push(c)); z.on('end', () => resolve(Buffer.concat(chunks))); z.on('error', reject); Promise.resolve(fill(z)).then(() => z.finalize(), reject); });
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';

async function dirSize(dir) { let n = 0, files = 0; let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return { bytes: 0, files: 0 }; } for (const e of entries) { const f = path.join(dir, e.name); if (e.isDirectory()) { const s = await dirSize(f); n += s.bytes; files += s.files; } else { try { n += (await fsp.stat(f)).size; files++; } catch { /* gone */ } } } return { bytes: n, files }; }
const FILE_GLOBS = { screenshots: ['screenshot.png', 'screenshot-mobile.png'], html: ['raw.html', 'rendered.html', 'page.mhtml'], pageRecords: ['page.json', 'network.json', 'accessibility-tree.yaml', 'content.md', 'text.txt'] };

function readSummary(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8')); } catch { throw new Error('This scrape has no finished results yet. Let it finish, or continue it, first.'); } }
const sections = (summary) => { const m = {}; for (const p of summary.pages) { const s = sectionOf(p.url); m[s] = (m[s] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([section, pages]) => ({ section, pages })); };

/** What an export would contain, before building it: pages matched, rows per data set, size of each file group. */
// ---- exports by topic: "give me the security", "give me the design" -------------------------------------------------
// Each topic gathers everything the scrape learned about one angle: the review's key facts, its lists, the matching data
// sets, and (in a ZIP) the files that go with it. `from` names the reviews in site.json; `skip` are parts already covered
// by a data set.
const TOPICS = [
  { id: 'security', label: 'Security', about: 'Graded findings with fixes, cookies, other hosts contacted, forms, technology', from: ['security'], skip: ['findings', 'summary'], include: ['security', 'cookies', 'otherHosts', 'forms', 'technology', 'redirects'], files: [], best: 'pdf' },
  { id: 'design', label: 'Design', about: 'Colours, fonts, type scale, spacing, variables, logos, screenshots, ready-to-use design tokens', from: ['design'], skip: [], include: ['design', 'images'], files: ['screenshots'], best: 'zip' },
  { id: 'accessibility', label: 'Accessibility', about: 'Problems per page, worst pages, contrast, labels, landmarks', from: ['accessibility'], skip: [], include: ['accessibility', 'images', 'forms', 'headings'], files: [], best: 'pdf' },
  { id: 'speed', label: 'Speed', about: 'Page weight, requests, paint times, heaviest and slowest pages', from: ['performance'], skip: [], include: ['performance', 'otherHosts'], files: [], best: 'xlsx' },
  { id: 'privacy', label: 'Privacy', about: 'Cookies, trackers, third parties, consent banners', from: ['privacy'], skip: ['cookies', 'thirdParties'], include: ['cookies', 'otherHosts', 'forms'], files: [], best: 'pdf' },
  { id: 'search', label: 'Search and content quality', about: 'Titles, descriptions, headings, links, broken links, duplicates, thin pages', from: ['content'], skip: [], include: ['pages', 'metadata', 'headings', 'links', 'checks', 'structuredData', 'redirects'], files: [], best: 'xlsx' },
  { id: 'technology', label: 'Technology and hosting', about: 'What the site is built with, servers, DNS, certificate, email protection', from: ['infrastructure', 'history'], skip: [], include: ['technology', 'otherHosts'], files: [], best: 'pdf' },
  { id: 'legal', label: 'Legal and contacts', about: 'Policies and notices found, contact details, documents', from: ['legal'], skip: [], include: ['contacts', 'documents', 'cookies'], files: [], best: 'pdf' },
  { id: 'content', label: 'All the content', about: 'The text of every page and document, tables and contact details', from: [], skip: [], include: ['pages', 'content', 'documents', 'tables', 'contacts'], files: ['documentFiles'], best: 'md' },
];
const human = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (m, c) => ' ' + c.toLowerCase());
const plain = (v) => v == null || v === '' ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'object' ? JSON.stringify(v) : String(v);
// Turns one review (an object of numbers, notes, nested facts and lists) into a "key facts" table and one table per list.
function reviewSets(topic, summary) {
  const P = summary.perspectives || {}; const facts = []; const lists = [];
  const walk = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const name = prefix ? `${prefix}: ${human(k).toLowerCase()}` : human(k);
      if (!prefix && topic.skip.includes(k)) continue;
      if (v == null || v === '') continue;
      if (Array.isArray(v)) {
        if (!v.length) { facts.push([name, 'none found']); continue; }
        if (v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
          const cols = [...new Set(v.flatMap((x) => Object.keys(x)))];
          lists.push({ id: slug(topic.id + '-' + name), label: name, columns: cols.map(human), rows: v.map((x) => cols.map((c) => Array.isArray(x[c]) ? x[c].map(plain).join('\n') : plain(x[c]))) });
        } else if (v.length <= 6) facts.push([name, v.map(plain).join(', ')]);
        else lists.push({ id: slug(topic.id + '-' + name), label: name, columns: [name], rows: v.map((x) => [plain(x)]) });
      } else if (typeof v === 'object') {
        const scalars = Object.values(v).every((x) => x == null || typeof x !== 'object');
        if (depth < 2) walk(v, name, depth + 1);
        else if (scalars) facts.push([name, Object.entries(v).map(([a, b]) => `${a}: ${plain(b)}`).join(', ')]);
        else facts.push([name, plain(v).slice(0, 600)]);
      } else facts.push([name, plain(v)]);
    }
  };
  for (const key of topic.from) if (P[key]) walk(P[key], topic.from.length > 1 ? human(key) : '', topic.from.length > 1 ? 1 : 0);
  if (topic.id === 'security') { const sm = (P.security || {}).summary || {}; facts.unshift(['Findings', ['high', 'medium', 'low', 'info'].map((k) => `${sm[k] || 0} ${k}`).join(', ')]); }
  if (topic.id === 'search') for (const [k, list] of Object.entries(summary.issues || {})) facts.push([human(k), Array.isArray(list) ? list.length : plain(list)]);
  if (topic.id === 'technology') facts.push(['Technologies recognised', (summary.technologies || []).map((t) => t.name).join(', ') || 'none']);
  if (topic.id === 'content') { const c = P.content || {}; facts.push(['Pages', summary.pages.length], ['Words', c.totalWords ?? ''], ['Documents', (summary.documents || []).length]); }
  const out = [];
  if (facts.length) out.push({ id: topic.id + '-facts', label: 'Key facts', columns: ['Measure', 'Value'], rows: facts });
  return out.concat(lists);
}
// The design as files a designer or developer can drop into their own work.
function designFiles(summary) {
  const d = (summary.perspectives || {}).design; if (!d) return [];
  const css = (v) => { const m = /^(#[0-9a-f]{6}) @(\d+)%$/i.exec(v); if (!m) return v; const n = parseInt(m[1].slice(1), 16); return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${m[2]}%)`; };
  const groups = [['color-text', (d.colors || {}).text], ['color-background', (d.colors || {}).background], ['color-border', (d.colors || {}).border], ['font-size', d.fontSizes], ['radius', d.cornerRadii], ['shadow', d.shadows]];
  const families = [...new Set((d.fonts || []).map((f) => String(f.value).split(' / ')[0]))];
  const L = ['/* Design tokens read from ' + summary.startUrl + ' by DeepScrape. Most-used values first. */', ':root {'];
  for (const [name, list] of groups) { if (!list || !list.length) continue; L.push(`  /* ${name.replace('-', ' ')} */`); list.forEach((x, i) => L.push(`  --${name}-${i + 1}: ${css(x.value)};${x.count ? ` /* used ${x.count} times */` : ''}`)); }
  if (families.length) { L.push('  /* font families */'); families.forEach((f, i) => L.push(`  --font-${i + 1}: ${/[^a-z0-9-]/i.test(f) ? JSON.stringify(f) : f};`)); }
  L.push('}');
  const own = Object.entries(d.cssVariables || {});
  if (own.length) L.push('', "/* The site's own variables, exactly as it declares them */", ':root {', ...own.map(([k, v]) => `  ${k}: ${v};`), '}');
  const tokens = { $description: 'Design tokens read from ' + summary.startUrl, color: Object.fromEntries(['text', 'background', 'border'].map((k) => [k, ((d.colors || {})[k] || []).map((x) => ({ $value: css(x.value), uses: x.count }))])), fontFamily: families, font: (d.fonts || []).map((x) => ({ $value: x.value, uses: x.count })), fontSize: (d.fontSizes || []).map((x) => ({ $value: x.value, uses: x.count })), borderRadius: (d.cornerRadii || []).map((x) => ({ $value: x.value, uses: x.count })), shadow: (d.shadows || []).map((x) => ({ $value: x.value, uses: x.count })), breakpoints: (d.breakpoints || []).map((x) => x.value), typography: d.typography || {}, siteVariables: d.cssVariables || {}, fontFiles: d.fontFiles || [], logos: d.logos || [] };
  const e = (v) => String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const sw = (title, list) => !list || !list.length ? '' : `<h2>${title}</h2><div class="grid">${list.map((x) => `<figure><div class="chip" style="background:${e(css(x.value))}"></div><figcaption><b>${e(x.value)}</b><br>${x.count} uses</figcaption></figure>`).join('')}</div>`;
  const ty = Object.entries(d.typography || {}).filter(([, v]) => v).map(([k, v]) => `<p style="font-family:${e(v.fontFamily)};font-size:${e(v.fontSize)};line-height:${e(v.lineHeight)};font-weight:${e(v.fontWeight)};margin:10px 0">${e(human(k))}: The quick brown fox jumps over the lazy dog <small style="font:12px system-ui;color:#5B6B7D">${e(String(v.fontFamily).split(',')[0])} ${e(v.fontSize)}/${e(v.lineHeight)}, weight ${e(v.fontWeight)}</small></p>`).join('');
  const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Style sheet of ${e(summary.startUrl)}</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#14263B;max-width:1100px}h1{font-size:26px}h2{font-size:17px;margin:28px 0 10px;border-bottom:2px solid #0B7A75;padding-bottom:4px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}figure{margin:0;border:1px solid #D3DCE4;border-radius:8px;overflow:hidden}.chip{height:70px;background-image:none}figcaption{padding:6px 8px;font-size:12px}li{margin:2px 0}</style></head><body><h1>Style sheet</h1><p>Read from ${e(summary.startUrl)}. Fonts show only if they are installed on this computer.</p>${sw('Text colours', (d.colors || {}).text)}${sw('Background colours', (d.colors || {}).background)}${sw('Border colours', (d.colors || {}).border)}${ty ? '<h2>Type styles</h2>' + ty : ''}<h2>Fonts</h2><ul>${(d.fonts || []).map((x) => `<li>${e(x.value)} (${x.count} uses)</li>`).join('')}</ul><h2>Type sizes</h2><p>${(d.fontSizes || []).map((x) => e(x.value)).join(' · ')}</p><h2>Corner radii</h2><p>${(d.cornerRadii || []).map((x) => e(x.value)).join(' · ') || 'none'}</p><h2>Breakpoints</h2><ul>${(d.breakpoints || []).map((x) => `<li>${e(x.value)}</li>`).join('')}</ul></body></html>`;
  return [{ name: 'design-tokens.css', content: L.join('\n') + '\n' }, { name: 'design-tokens.json', content: JSON.stringify(tokens, null, 2) }, { name: 'style-sheet.html', content: sheet }];
}

async function estimate(dir, { include = [], files = [], section, contains, result } = {}) {
  const summary = readSummary(dir); const { sets, pages } = await gather(dir, summary, include.filter((x) => x !== 'content'), { section, contains, result });
  const out = { pagesMatched: pages.length, pagesTotal: summary.pages.length, sections: sections(summary), rows: Object.fromEntries(sets.map((s) => [s.id, s.rows.length])), files: {} };
  if (include.includes('content')) out.rows.content = pages.filter((p) => !p.error && p.kind !== 'file').length;
  const all = pages.length === summary.pages.length;
  for (const f of files) {
    if (f === 'assets') out.files[f] = await dirSize(path.join(dir, 'assets'));
    else if (f === 'documentFiles') out.files[f] = await dirSize(path.join(dir, 'files'));
    else { let bytes = 0, n = 0; for (const p of pages) { const pd = path.join(dir, 'pages', p.id); if (f === 'hiddenDataFiles') { const s = await dirSize(path.join(pd, 'api')); bytes += s.bytes; n += s.files; } else for (const name of FILE_GLOBS[f] || []) { try { bytes += (await fsp.stat(path.join(pd, name))).size; n++; } catch { /* none */ } } } out.files[f] = { bytes, files: n }; }
  }
  out.note = !all && (files.includes('assets') || files.includes('documentFiles')) ? 'Images, styles, scripts and document files are shared across pages, so those groups are included whole.' : '';
  return out;
}

/** Build the export. Returns { buffer, mime, filename }. */
async function buildExport(dir, { include = [], files = [], format, topic, section, contains, result } = {}) {
  const T = topic ? TOPICS.find((t) => t.id === topic) : null; if (topic && !T) throw new Error(`Unknown topic "${topic}". Topics: ${TOPICS.map((t) => t.id).join(', ')}.`);
  if (T) { format = format || T.best; if (!include.length) include = T.include; if (!files.length) files = T.files; }
  format = format || 'xlsx';
  const fmt = FORMATS.find((f) => f.id === format); if (!fmt) throw new Error(`Unknown format "${format}".`);
  include = include.filter((x) => DATASETS.some((d) => d.id === x)); files = fmt.files ? files.filter((x) => FILES.some((f) => f.id === x)) : [];
  if (!include.length && !files.length) throw new Error('Tick at least one thing to export.');
  const summary = readSummary(dir); const host = new URL(summary.startUrl).hostname;
  const gathered = await gather(dir, summary, include, { section, contains, result }); const pages = gathered.pages;
  const sets = T ? [...reviewSets(T, summary), ...[...gathered.sets].sort((a, b) => T.include.indexOf(a.id) - T.include.indexOf(b.id))] : gathered.sets;
  const scope = [section && `section ${section}`, contains && `addresses containing "${contains}"`, result === 'ok' && 'pages that loaded', result === 'problems' && 'pages with problems'].filter(Boolean).join(', ');
  const head = { title: T ? `${host}: ${T.label.toLowerCase()}` : `${host}: export`, lines: [summary.startUrl, `Scraped ${summary.finishedAt}. This export covers ${pages.length} of ${summary.pages.length} pages${scope ? ' (' + scope + ')' : ''}.`, `Included: ${[...sets.map((s) => `${s.label} (${s.rows.length})`), ...files.map((f) => FILES.find((x) => x.id === f).label)].join(', ')}.`] };
  const base = `${host}-${scope ? slug(section || contains || result) + '-' : ''}${T ? slug(T.id) : sets.length === 1 && !files.length ? slug(sets[0].label) : 'export'}`;
  let buffer, ext = format, mime = fmt.mime;
  if (format === 'xlsx') buffer = await toXlsx(sets, [['Website', summary.startUrl], ['Scraped', summary.finishedAt], ['Pages covered', `${pages.length} of ${summary.pages.length}${scope ? ' (' + scope + ')' : ''}`], ...sets.map((s) => [s.label, `${s.rows.length} rows`])]);
  else if (format === 'json') buffer = Buffer.from(JSON.stringify({ website: summary.startUrl, scrapedAt: summary.finishedAt, pagesCovered: pages.length, pagesTotal: summary.pages.length, scope: scope || 'all pages', data: Object.fromEntries(sets.map((s) => [s.id, s.rows.map((r) => Object.fromEntries(s.columns.map((c, i) => [c, r[i] ?? null])))])) }, null, 2));
  else if (format === 'md') buffer = Buffer.from(toMarkdown(sets, head));
  else if (format === 'html') buffer = Buffer.from(toHtml(sets, head));
  else if (format === 'docx') buffer = await toDocx(sets, head);
  else if (format === 'pdf') { const { launchBrowser } = require('./crawler'); const browser = await launchBrowser(true); try { const page = await browser.newPage(); await page.setContent(toHtml(sets, head, LIMIT.pdf), { waitUntil: 'load' }); buffer = await page.pdf({ format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font:8px sans-serif;color:#888;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' }); } finally { await browser.close().catch(() => {}); } }
  else if (format === 'csv' && sets.length === 1) buffer = Buffer.from(toCsv(sets[0]));
  else if (format === 'csv') { buffer = await zipBuffer((z) => { for (const s of sets) z.append(toCsv(s), { name: `${slug(s.label)}.csv` }); }); ext = 'csv.zip'; mime = 'application/zip'; }
  else {   // zip folder
    buffer = await zipBuffer(async (z) => {
      const root = base + '/';
      z.append(['DeepScrape export', '', ...head.lines, '', 'data/      each data set as .csv (opens in Excel) and .json', 'text/      the text of each page as Markdown', 'pages/     per-page files: screenshots, source, records, hidden data', 'assets/    images, styles, scripts, fonts', 'documents/ PDFs and Office files with their extracted text'].join('\r\n'), { name: root + 'READ ME.txt' });
      if (T) {   // a topic pack also carries a ready-to-read report, a workbook, and the topic's own files
        z.append(toHtml(sets, head), { name: root + 'report.html' }); z.append(toMarkdown(sets, head), { name: root + 'report.md' });
        z.append(await toXlsx(sets.filter((x) => x.id !== 'content'), [['Website', summary.startUrl], ['Scraped', summary.finishedAt], ['Topic', T.label]]), { name: root + 'data.xlsx' });
        if (T.id === 'design') for (const f of designFiles(summary)) z.append(f.content, { name: root + f.name });
      }
      for (const s of sets) {
        if (s.id === 'content') { const used = new Set(); for (const r of s.rows) { let n = slug(pathOf(r[0])) || 'home'; for (let i = 2; used.has(n); i++) n = (slug(pathOf(r[0])) || 'home') + '-' + i; used.add(n); z.append(String(r[3]), { name: `${root}text/${n}.md` }); } continue; }
        z.append(toCsv(s), { name: `${root}data/${slug(s.label)}.csv` }); z.append(JSON.stringify(s.rows.map((r) => Object.fromEntries(s.columns.map((c, i) => [c, r[i] ?? null]))), null, 2), { name: `${root}data/${slug(s.label)}.json` });
      }
      for (const p of pages) { const pd = path.join(dir, 'pages', p.id);
        for (const f of files) { for (const name of FILE_GLOBS[f] || []) if (fs.existsSync(path.join(pd, name))) z.file(path.join(pd, name), { name: `${root}pages/${p.id}/${name}` }); if (f === 'html' && fs.existsSync(path.join(pd, 'frames'))) z.directory(path.join(pd, 'frames'), `${root}pages/${p.id}/frames`); if (f === 'hiddenDataFiles' && fs.existsSync(path.join(pd, 'api'))) z.directory(path.join(pd, 'api'), `${root}pages/${p.id}/hidden-data`); } }
      if (files.includes('assets') && fs.existsSync(path.join(dir, 'assets'))) z.directory(path.join(dir, 'assets'), root + 'assets');
      if (files.includes('documentFiles') && fs.existsSync(path.join(dir, 'files'))) z.directory(path.join(dir, 'files'), root + 'documents');
    });
  }
  return { buffer, mime, filename: `${base}.${ext}`, rows: Object.fromEntries(sets.map((s) => [s.id, s.rows.length])), pages: pages.length };
}

module.exports = { buildExport, estimate, options, sections, DATASETS, FILES, FORMATS, PRESETS, TOPICS, designFiles };
