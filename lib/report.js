'use strict';
/*
 * Turns a finished scrape into a report, for the lens families you choose (or all of them),
 * in the format you choose: Word, PDF, Excel, HTML, Markdown, CSV or JSON.
 *
 *   const { buildReport } = require('./lib/report');
 *   const { buffer, filename } = await buildReport('/path/to/scrape', { format: 'docx', families: [6, 13] });
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { evaluate, families: allFamilies, NAMES } = require('./lenses');

const FORMATS = {
  docx: { label: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { label: 'PDF', mime: 'application/pdf' },
  xlsx: { label: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  html: { label: 'Web page', mime: 'text/html; charset=utf-8' },
  md: { label: 'Markdown', mime: 'text/markdown; charset=utf-8' },
  csv: { label: 'CSV', mime: 'text/csv; charset=utf-8' },
  json: { label: 'JSON', mime: 'application/json; charset=utf-8' },
};
const DETAIL = { full: 'Every lens', findings: 'Only lenses with facts', summary: 'Family summaries only' };
const kb = (n) => (n == null ? 'n/a' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The report as data; every format is rendered from this. */
function model(summary, { families, detail = 'full', verdicts = null } = {}) {
  const scope = families && families.length ? families : (summary.lensFamilies && summary.lensFamilies.length ? summary.lensFamilies : allFamilies().map((f) => f.id));
  const fams = evaluate(summary, scope); const P = summary.perspectives; const has = (id) => scope.includes(id);
  const totals = { measured: 0, evidence: 0, inside: 0, lenses: 0 };
  for (const f of fams) {
    for (const k of ['measured', 'evidence', 'inside']) totals[k] += f.counts[k]; totals.lenses += f.lenses.length;
    const seen = new Map(); for (const l of f.lenses) for (const e of l.evidence) seen.set(e, (seen.get(e) || 0) + 1);
    const vf = verdicts && verdicts.families && verdicts.families[f.id];
    if (vf) { f.aiSummary = vf.summary; for (const l of f.lenses) if (vf.lenses[l.n]) l.ai = vf.lenses[l.n]; }
    f.headline = [...seen].sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);       // the facts most lenses in this family rest on
    if (detail === 'findings') f.lenses = f.lenses.filter((l) => l.evidence.length);
    if (detail === 'summary') f.lenses = [];
  }
  const key = [];   // focused findings, only for the families asked for
  if (has(13)) key.push({ title: 'Security', lines: [`${P.security.summary.high} serious, ${P.security.summary.medium} should fix, ${P.security.summary.low} minor, ${P.security.summary.info} notes. ${P.security.note}`, ...P.security.findings.slice(0, 15).map((f) => `${f.severity.toUpperCase()}: ${f.title}${f.pagesAffected ? ` (${f.pagesAffected} pages)` : ''}. ${f.details[0] || ''} Fix: ${f.fix}`)] });
  if (has(5)) { const a = P.accessibility; key.push({ title: 'Accessibility', lines: [`Low-contrast text ${a.lowContrastText}; images without a description ${a.imagesWithoutDescription}; form fields without a label ${a.formFieldsWithoutLabel}; links without text ${a.linksWithoutText}; buttons without a name ${a.buttonsWithoutName}; pages without a language ${a.pagesWithoutLanguage}.`, a.note] }); }
  if (has(6)) { const d = P.design; key.push({ title: 'Visual design', lines: [`Text colours: ${d.colors.text.slice(0, 8).map((c) => c.value).join(', ')}`, `Background colours: ${d.colors.background.slice(0, 8).map((c) => c.value).join(', ')}`, `Fonts: ${d.fonts.slice(0, 6).map((c) => c.value).join('; ')}`, `Type sizes: ${d.fontSizes.slice(0, 10).map((c) => c.value).join(', ')}`, `Breakpoints: ${d.breakpoints.slice(0, 8).map((c) => c.value).join('; ') || 'none found'}`] }); }
  if (has(12)) { const v = P.performance.averages; key.push({ title: 'Performance', lines: [`Average page ${kb(v.pageBytes)} over ${v.requests} requests; first paint ${v.firstPaintMs} ms; largest paint ${v.largestPaintMs} ms; layout shift ${v.layoutShift}.`, P.performance.note, ...P.performance.heaviestPages.slice(0, 5).map((p) => `Heavy: ${p.url} (${kb(p.bytes)})`)] }); }
  if (has(14)) key.push({ title: 'Privacy', lines: [`Other hosts contacted: ${P.privacy.thirdParties.length}. Trackers and embeds: ${[...new Set(P.privacy.trackers.map((t) => t.service))].join(', ') || 'none recognised'}. Cookies: ${P.privacy.cookies.length}. Consent banner on ${P.privacy.pagesShowingConsentBanner} of ${P.privacy.pagesChecked} pages.`] });
  if (has(10)) { const i = P.infrastructure; key.push({ title: 'Infrastructure', lines: [`Addresses: ${i.ipAddresses.join(', ') || 'n/a'}. Server: ${i.serverSoftware.join(', ') || 'not disclosed'}. Certificate: ${i.certificate ? `${i.certificate.issuer}, valid to ${i.certificate.validTo}` : 'none (not on HTTPS)'}.`, i.dns ? `Name servers: ${i.dns.nameServers.join(', ')}. Mail: ${i.dns.mailServers.join(', ') || 'none'}. SPF: ${i.dns.spf || 'none'}. DMARC: ${i.dns.dmarc || 'none'}.` : 'No public DNS records (local address).'] }); }
  if (has(7)) key.push({ title: 'Content', lines: [`${P.content.totalWords} words across ${P.content.pages} pages; ${(summary.documents || []).length} documents. Most used words: ${P.content.topWords.slice(0, 25).map((w) => w.word).join(', ')}.`, `Checks: ${Object.entries(summary.issues).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.length}`).join(', ') || 'nothing flagged'}.`] });
  const host = new URL(summary.startUrl).hostname;
  return {
    title: `${host}: website lens report`, host, url: summary.startUrl, scrapedAt: summary.finishedAt, detail: DETAIL[detail] || DETAIL.full,
    scope: scope.length === allFamilies().length ? 'All 23 lens families' : fams.map((f) => f.name).join(', '),
    stats: { pages: summary.stats.pages, assets: summary.stats.assetsSaved, documents: summary.stats.filesDownloaded, backgroundData: summary.stats.apiResponsesCaptured, complete: summary.complete, signedIn: !!summary.signedIn },
    totals, legend: { measured: 'Read directly from the site.', evidence: 'The facts are gathered; the verdict needs a person or an AI to read them.', inside: 'Cannot be seen from a browser. The entry says what would be needed and lists any outside hints.' },
    caveat: 'Each lens finds its facts through a hand-written mapping, a topic rule matched on its name, or the general facts for its family ("matched by" says which). Topic and family matches can be loose: treat them as where to look, not as a verdict.',
    keyFindings: key, families: fams, ai: verdicts && Object.keys(verdicts.families || {}).length ? { model: verdicts.model, generatedAt: verdicts.generatedAt } : null,
  };
}

// ───────────── text formats ─────────────
function toMarkdown(m) {
  const L = [`# ${m.title}`, '', `${m.url}`, `Scraped ${m.scrapedAt}. ${m.stats.pages} pages, ${m.stats.assets} assets, ${m.stats.documents} documents, ${m.stats.backgroundData} background data responses${m.stats.signedIn ? ', signed in' : ''}${m.stats.complete ? '' : ' (scrape not complete)'}.`, '', `**Scope:** ${m.scope}`, `**Detail:** ${m.detail}`, '',
    `Of ${m.totals.lenses} lenses: **${m.totals.measured} measured**, **${m.totals.evidence} with evidence gathered**, **${m.totals.inside} needing inside access**.`, '', ...Object.entries(m.legend).map(([k, v]) => `- **${NAMES[k]}:** ${v}`), '', m.caveat, '', ...(m.ai ? [`AI verdicts were written by ${m.ai.model} on ${m.ai.generatedAt} from the facts listed under each lens. They are a reading of those facts, not an inspection of the site.`, ''] : [])];
  if (m.keyFindings.length) { L.push('## Key findings', ''); for (const k of m.keyFindings) L.push(`### ${k.title}`, '', ...k.lines.map((x) => `- ${x}`), ''); }
  for (const f of m.families) {
    L.push(`## ${f.id}. ${f.name}`, '', f.about, '', `${f.counts.measured} measured, ${f.counts.evidence} evidence gathered, ${f.counts.inside} need inside access.`, '');
    if (f.aiSummary) L.push(`**AI verdict on this family:** ${f.aiSummary}`, '');
    if (f.headline.length) L.push('Facts this family rests on most:', '', ...f.headline.map((x) => `- ${x}`), '');
    for (const l of f.lenses) L.push(`### ${f.id}.${l.n} ${l.name}`, `*${NAMES[l.coverage]}, matched by ${l.matchedBy}*${l.note ? '. ' + l.note : ''}`, '', ...(l.ai ? [`**AI verdict (${l.ai.rating}):** ${l.ai.verdict}${l.ai.action ? ' *Do:* ' + l.ai.action : ''}`, ''] : []), ...(l.evidence.length ? l.evidence.map((e) => `- ${e}`) : [l.coverage === 'inside' ? '- Nothing visible from outside.' : '- Nothing of this kind was found on the pages scraped.']), '');
  }
  return L.join('\n');
}
function toCsv(m) {
  const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const rows = [['family_number', 'family', 'lens_number', 'lens', 'coverage', 'matched_by', 'facts', 'note', 'ai_rating', 'ai_verdict', 'ai_action']];
  for (const f of m.families) for (const l of f.lenses) rows.push([f.id, f.name, l.n, l.name, NAMES[l.coverage], l.matchedBy, l.evidence.join(' | '), l.note, l.ai ? l.ai.rating : '', l.ai ? l.ai.verdict : '', l.ai ? l.ai.action : '']);
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
function toHtml(m) {
  const tag = { measured: '#2E7D4F', evidence: '#B86E00', inside: '#5B6B7D' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(m.title)}</title><style>
  body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#14263B;max-width:900px;margin:32px auto;padding:0 24px}
  h1{font-size:28px;margin:0 0 4px} h2{font-size:21px;margin:34px 0 6px;border-bottom:2px solid #0B7A75;padding-bottom:4px;break-after:avoid} h3{font-size:16px;margin:20px 0 4px;break-after:avoid} h4{font-size:14px;margin:14px 0 2px;break-after:avoid}
  .meta{color:#5B6B7D} .tiles{display:flex;gap:12px;margin:16px 0} .tiles div{flex:1;border:1px solid #D3DCE4;border-radius:8px;padding:10px 14px} .tiles b{display:block;font-size:26px}
  .lens{break-inside:avoid;margin:0 0 10px} .lens p{margin:0;color:#5B6B7D;font-size:12.5px} ul{margin:4px 0 0;padding-left:20px} li{margin:1px 0;word-break:break-word}
  .t{display:inline-block;color:#fff;border-radius:4px;font-size:11px;padding:0 6px;margin-right:6px;font-weight:600} nav a{display:inline-block;margin:0 10px 4px 0;color:#0B7A75} .about{color:#5B6B7D;margin:0 0 6px}
  @media print{body{margin:0;max-width:none} nav{display:none}}</style></head><body>
  <h1>${esc(m.title)}</h1><div class="meta">${esc(m.url)}<br>Scraped ${esc(m.scrapedAt)}. ${m.stats.pages} pages, ${m.stats.assets} assets, ${m.stats.documents} documents, ${m.stats.backgroundData} background data responses.<br><b>Scope:</b> ${esc(m.scope)}. <b>Detail:</b> ${esc(m.detail)}.</div>
  <div class="tiles">${['measured', 'evidence', 'inside'].map((k) => `<div><b style="color:${tag[k]}">${m.totals[k]}</b>${NAMES[k]}<br><span class="meta">${esc(m.legend[k])}</span></div>`).join('')}</div><p class="meta">${esc(m.caveat)}</p>
  <nav>${m.families.map((f) => `<a href="#f${f.id}">${f.id}. ${esc(f.name)}</a>`).join('')}</nav>
  ${m.keyFindings.length ? `<h2>Key findings</h2>${m.keyFindings.map((k) => `<h3>${esc(k.title)}</h3><ul>${k.lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}` : ''}
  ${m.families.map((f) => `<h2 id="f${f.id}">${f.id}. ${esc(f.name)}</h2><p class="about">${esc(f.about)} ${f.counts.measured} measured, ${f.counts.evidence} evidence gathered, ${f.counts.inside} need inside access.</p>${f.aiSummary ? `<p><b>AI verdict on this family:</b> ${esc(f.aiSummary)}</p>` : ''}${f.headline.length ? `<h4>Facts this family rests on most</h4><ul>${f.headline.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${f.lenses.map((l) => `<div class="lens"><h4><span class="t" style="background:${tag[l.coverage]}">${NAMES[l.coverage]}</span>${f.id}.${l.n} ${esc(l.name)}</h4><p>Matched by ${l.matchedBy}.${l.note ? ' ' + esc(l.note) : ''}</p>${l.ai ? `<p style="color:#14263B;font-size:13.5px;margin:4px 0"><b>AI verdict (${esc(l.ai.rating)}):</b> ${esc(l.ai.verdict)}${l.ai.action ? ` <i>Do: ${esc(l.ai.action)}</i>` : ''}</p>` : ''}<ul>${(l.evidence.length ? l.evidence : [l.coverage === 'inside' ? 'Nothing visible from outside.' : 'Nothing of this kind was found on the pages scraped.']).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`).join('')}`).join('')}
  </body></html>`;
}

// ───────────── Excel (written directly: a workbook is a zip of XML) ─────────────
async function toXlsx(m, summary) {
  const JSZip = require('jszip'); const zip = new JSZip(); const P = summary.perspectives;
  const sheets = [
    ['Overview', [['Website', m.url], ['Scraped', m.scrapedAt], ['Scope', m.scope], ['Detail', m.detail], ['Pages', m.stats.pages], ['Assets', m.stats.assets], ['Documents', m.stats.documents], ['Background data responses', m.stats.backgroundData], ['Lenses', m.totals.lenses], ['Measured', m.totals.measured], ['Evidence gathered', m.totals.evidence], ['Needs inside access', m.totals.inside], ['How to read "matched by"', m.caveat], [], ['Family', 'Lenses', 'Measured', 'Evidence gathered', 'Needs inside access'], ...m.families.map((f) => [`${f.id}. ${f.name}`, f.counts.measured + f.counts.evidence + f.counts.inside, f.counts.measured, f.counts.evidence, f.counts.inside])], [34, 70, 12, 18, 20]],
    ['Lenses', [['Family no.', 'Family', 'Lens no.', 'Lens', 'Coverage', 'Matched by', 'Facts', 'Note', 'AI rating', 'AI verdict', 'AI: what to do'], ...m.families.flatMap((f) => f.lenses.map((l) => [f.id, f.name, l.n, l.name, NAMES[l.coverage], l.matchedBy, l.evidence.join('\n'), l.note, l.ai ? l.ai.rating : '', l.ai ? l.ai.verdict : '', l.ai ? l.ai.action : '']))], [9, 30, 8, 46, 20, 12, 90, 50, 12, 70, 50]],
    ['Key findings', [['Area', 'Finding'], ...m.keyFindings.flatMap((k) => k.lines.map((x) => [k.title, x]))], [18, 140]],
    ['Security', [['Severity', 'Finding', 'Pages affected', 'Detail', 'Fix', 'Example pages'], ...P.security.findings.map((f) => [f.severity, f.title, f.pagesAffected, f.details.join('\n'), f.fix, f.pages.slice(0, 10).join('\n')])], [10, 46, 12, 60, 50, 60]],
    ['Pages', [['Address', 'Result', 'Title', 'Description', 'Clicks from start', 'Words', 'Links', 'Images', 'Tables', 'Forms', 'Background data', 'Seconds', 'Security risks', 'Found on'], ...summary.pages.map((p) => [p.url, p.error ? 'failed' : p.status, p.title, p.description, p.depth, p.words, p.links, p.images, p.tables, p.forms, p.apiResponses, p.durationMs ? Math.round(p.durationMs / 100) / 10 : '', p.risks, p.foundOn])], [60, 8, 40, 50, 9, 8, 8, 8, 8, 8, 10, 9, 9, 40]],
    ['Checks', [['Check', 'Item', 'Detail'], ...Object.entries(summary.issues).flatMap(([k, list]) => list.map((x) => [k, typeof x === 'string' ? x : x.url || x.from || (x.pages || []).join(', '), typeof x === 'string' ? '' : x.to ? `links to ${x.to} (${x.status})` : x.error || x.value || x.count || x.status || x.seconds || '']))], [28, 70, 60]],
    ['Other hosts', [['Host', 'Recognised as', 'Pages', 'Requests', 'Loads'], ...P.privacy.thirdParties.map((t) => [t.host, t.service || '', t.pages, t.requests, t.kinds.join(', ')])], [40, 28, 8, 10, 30]],
    ['Cookies', [['Name', 'Set by', 'Lasts (days)', 'Secure', 'Hidden from scripts', 'SameSite', 'From another site'], ...P.privacy.cookies.map((c) => [c.name, c.domain, c.lastsDays, c.secure ? 'yes' : 'no', c.httpOnly ? 'yes' : 'no', c.sameSite || 'not set', c.fromAnotherSite ? 'yes' : 'no'])], [30, 30, 12, 8, 18, 12, 16]],
    ['Documents', [['Address', 'Kind', 'Words', 'Bytes', 'Found on', 'Saved as'], ...(summary.documents || []).map((d) => [d.url, d.kind, d.words, d.bytes, d.foundOn, d.saved])], [60, 14, 8, 10, 40, 50]],
    ['Contacts & tech', [['Kind', 'Value'], ...summary.contacts.emails.map((x) => ['Email', x]), ...summary.contacts.phones.map((x) => ['Phone', x]), ...summary.contacts.socials.map((x) => ['Social profile', x]), ...summary.technologies.map((t) => ['Built with', `${t.name} (${t.pages} pages)`])], [16, 80]],
  ].filter((s) => s[1].length > 1);
  const x = (v) => String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 32000);
  const col = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  sheets.forEach(([name, rows, widths], si) => {
    const head = name === 'Overview' ? -1 : 0; let body = '';
    rows.forEach((r, ri) => { body += `<row r="${ri + 1}">` + r.map((v, ci) => { if (v == null || v === '') return ''; const ref = col(ci) + (ri + 1); const st = ri === head || (name === 'Overview' && (ci === 0 || ri === 14)) ? 1 : 2; return typeof v === 'number' && isFinite(v) ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`; }).join('') + '</row>'; });
    const last = col(Math.max(...rows.map((r) => r.length)) - 1) + rows.length;
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${head === 0 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${head === 0 && rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`);
  });
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ───────────── Word ─────────────
async function toDocx(m) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, LevelFormat, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle } = require('docx');
  const FONT = 'Calibri'; const tint = { measured: '2E7D4F', evidence: 'B86E00', inside: '5B6B7D' };
  const clean = (t) => String(t ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\s*\n\s*/g, ' ');
  const p = (text, o = {}) => new Paragraph({ spacing: { after: 100 }, ...o.para, children: [new TextRun({ text: clean(text), font: FONT, size: 22, ...o.run })] });
  const bullet = (text) => new Paragraph({ numbering: { reference: 'facts', level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: clean(text), font: FONT, size: 21 })] });
  const h = (text, level) => new Paragraph({ heading: level, children: [new TextRun({ text: clean(text), font: FONT })] });
  const kids = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: clean(m.title), font: FONT })] }), p(m.url, { run: { color: '5B6B7D' } }),
    p(`Scraped ${m.scrapedAt}. ${m.stats.pages} pages, ${m.stats.assets} assets, ${m.stats.documents} documents, ${m.stats.backgroundData} background data responses.`, { run: { color: '5B6B7D' } }),
    new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Scope: ', bold: true, font: FONT, size: 22 }), new TextRun({ text: clean(m.scope), font: FONT, size: 22 })] }),
    new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'Detail: ', bold: true, font: FONT, size: 22 }), new TextRun({ text: clean(m.detail), font: FONT, size: 22 })] })];
  const W = [2600, 1100, 5326]; const border = { style: BorderStyle.SINGLE, size: 4, color: 'D3DCE4' }; const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text, w, o = {}) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders, margins: { top: 60, bottom: 60, left: 100, right: 100 }, ...(o.fill ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } } : {}), children: [new Paragraph({ children: [new TextRun({ text: clean(text), font: FONT, size: 21, bold: !!o.bold, color: o.color })] })] });
  kids.push(new Table({ width: { size: 9026, type: WidthType.DXA }, columnWidths: W, rows: [
    new TableRow({ tableHeader: true, children: [cell('Coverage', W[0], { bold: true, fill: 'EEF2F5' }), cell('Lenses', W[1], { bold: true, fill: 'EEF2F5' }), cell('What it means', W[2], { bold: true, fill: 'EEF2F5' })] }),
    ...['measured', 'evidence', 'inside'].map((k) => new TableRow({ children: [cell(NAMES[k], W[0], { bold: true, color: tint[k] }), cell(m.totals[k], W[1]), cell(m.legend[k], W[2])] }))] }));
  kids.push(p(m.caveat, { para: { spacing: { before: 160, after: 160 } }, run: { italics: true, color: '5B6B7D', size: 20 } }));
  if (m.keyFindings.length) { kids.push(h('Key findings', HeadingLevel.HEADING_1)); for (const k of m.keyFindings) { kids.push(h(k.title, HeadingLevel.HEADING_2)); k.lines.forEach((x) => kids.push(bullet(x))); } }
  for (const f of m.families) {
    kids.push(h(`${f.id}. ${f.name}`, HeadingLevel.HEADING_1), p(`${f.about} ${f.counts.measured} measured, ${f.counts.evidence} evidence gathered, ${f.counts.inside} need inside access.`, { run: { color: '5B6B7D' } }));
    if (f.aiSummary) kids.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'AI verdict on this family: ', bold: true, font: FONT, size: 22 }), new TextRun({ text: clean(f.aiSummary), font: FONT, size: 22 })] }));
    if (f.headline.length) { kids.push(p('Facts this family rests on most:', { run: { bold: true } })); f.headline.forEach((x) => kids.push(bullet(x))); }
    for (const l of f.lenses) {
      kids.push(h(`${f.id}.${l.n} ${l.name}`, HeadingLevel.HEADING_3));
      kids.push(new Paragraph({ spacing: { after: 60 }, keepNext: true, children: [new TextRun({ text: NAMES[l.coverage], bold: true, color: tint[l.coverage], font: FONT, size: 19 }), new TextRun({ text: `, matched by ${l.matchedBy}.${l.note ? ' ' + clean(l.note) : ''}`, italics: true, color: '5B6B7D', font: FONT, size: 19 })] }));
      if (l.ai) kids.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `AI verdict (${clean(l.ai.rating)}): `, bold: true, font: FONT, size: 21 }), new TextRun({ text: clean(l.ai.verdict) + (l.ai.action ? ' Do: ' + clean(l.ai.action) : ''), font: FONT, size: 21 })] }));
      (l.evidence.length ? l.evidence : [l.coverage === 'inside' ? 'Nothing visible from outside.' : 'Nothing of this kind was found on the pages scraped.']).forEach((e) => kids.push(bullet(e)));
    }
  }
  const hs = (size, before, color) => ({ run: { font: FONT, size, bold: true, color }, paragraph: { spacing: { before, after: 100 }, keepNext: true } });
  const doc = new Document({
    creator: 'DeepScrape', title: m.title,
    styles: { default: { document: { run: { font: FONT, size: 22 } }, title: { run: { font: FONT, size: 48, bold: true, color: '14263B' }, paragraph: { spacing: { before: 0, after: 120 }, keepNext: true } }, heading1: hs(32, 360, '0B7A75'), heading2: hs(26, 240, '14263B'), heading3: hs(22, 200, '14263B') } },
    numbering: { config: [{ reference: 'facts', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 250 } } } }] }] },
    sections: [{ properties: { page: { margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } }, children: kids }],
  });
  return Packer.toBuffer(doc);
}

async function toPdf(html) {
  const { launchBrowser } = require('./crawler');
  const browser = await launchBrowser(true);
  try { const page = await browser.newPage(); await page.setContent(html, { waitUntil: 'load' }); return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font:8px sans-serif;color:#888;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' }); }
  finally { await browser.close().catch(() => {}); }
}

/** Build a report from a finished scrape folder. Returns { buffer, mime, filename }. */
async function buildReport(dir, { format = 'md', families, detail = 'full' } = {}) {
  if (!FORMATS[format]) throw new Error(`Unknown format "${format}". Choose one of: ${Object.keys(FORMATS).join(', ')}.`);
  let summary; try { summary = JSON.parse(await fsp.readFile(path.join(dir, 'site.json'), 'utf8')); } catch { throw new Error('This scrape has no finished results yet (site.json is missing). Let it finish, or continue it, first.'); }
  if (!summary.perspectives) throw new Error('This scrape was made by an older version; scrape the site again to build lens reports.');
  const m = model(summary, { families, detail, verdicts: require('./ai').readVerdicts(dir) });
  let out;
  if (format === 'md') out = toMarkdown(m);
  else if (format === 'json') out = JSON.stringify(m, null, 2);
  else if (format === 'csv') out = toCsv(m);
  else if (format === 'html') out = toHtml(m);
  else if (format === 'pdf') out = await toPdf(toHtml(m));
  else if (format === 'xlsx') out = await toXlsx(m, summary);
  else if (format === 'docx') out = await toDocx(m);
  const scopeTag = m.families.length === allFamilies().length ? 'all-lenses' : m.families.length === 1 ? m.families[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) : `${m.families.length}-lens-families`;
  return { buffer: Buffer.isBuffer(out) ? out : Buffer.from(out), mime: FORMATS[format].mime, filename: `${m.host}-${scopeTag}.${format}` };
}

module.exports = { buildReport, model, FORMATS, DETAIL };
