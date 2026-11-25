'use strict';
// The in-depth part of a topic report: a written summary, the score and every point behind it, what to fix first,
// and page-by-page tables built from each page's own record. Used by the topic exports in exporter.js.
const fs = require('fs'); const fsp = fs.promises; const path = require('path');
const { scorecard } = require('./scores');

const HEADERS = [['strict-transport-security', 'HSTS'], ['content-security-policy', 'Content-Security-Policy'], ['x-frame-options', 'X-Frame-Options'], ['x-content-type-options', 'X-Content-Type-Options'], ['referrer-policy', 'Referrer-Policy'], ['permissions-policy', 'Permissions-Policy'], ['cross-origin-opener-policy', 'Cross-Origin-Opener-Policy'], ['cross-origin-resource-policy', 'Cross-Origin-Resource-Policy'], ['cross-origin-embedder-policy', 'Cross-Origin-Embedder-Policy']];
const RECOMMENDED = { 'strict-transport-security': 'max-age=31536000; includeSubDomains', 'content-security-policy': "default-src 'self'", 'x-frame-options': 'SAMEORIGIN', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
const yn = (v) => (v ? 'yes' : 'no');
const kb = (n) => (n == null ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const first = (h) => String(h || '').split('\n')[0];

async function eachPage(dir, summary, fn) {
  for (const p of summary.pages || []) {
    if (p.error || p.kind === 'file') continue;
    try { fn(JSON.parse(await fsp.readFile(path.join(dir, 'pages', p.id, 'page.json'), 'utf8')), p); } catch { /* a page whose record is missing is skipped */ }
  }
}
const text = (id, label, intro) => ({ id, label, columns: [], rows: [], intro: intro.filter(Boolean), textOnly: true });

// The score for one area as two sections: the number with its meaning, and every deduction.
function scoreSets(id, a, all) {
  if (!a) return [];
  const cols = ['What was found', ...(a.basis.some((b) => b.severity) ? ['Severity'] : []), 'Detail', ...(a.basis.some((b) => b.standard) ? ['Standard'] : []), 'Points lost', 'How to fix'];
  const sev = a.basis.some((b) => b.severity), std = a.basis.some((b) => b.standard);
  return [
    { id: id + '-score', label: `Score: ${a.score} out of 100 (grade ${a.grade})`, columns: ['What was found', ...(sev ? ['Severity'] : []), 'Detail', ...(std ? ['Standard'] : []), 'Points lost', 'How to fix'], rows: a.basis.map((b) => [b.what, ...(sev ? [b.severity] : []), b.pagesAffected != null ? `${b.why} (${b.pagesAffected} page${b.pagesAffected === 1 ? '' : 's'})` : b.why, ...(std ? [b.standard || ''] : []), b.points, b.fix || '']),
      intro: [`${a.label} starts at 100 and loses points for each problem found. ${a.basis.length ? `${a.basis.length} thing${a.basis.length === 1 ? '' : 's'} cost points, ${a.pointsLost} in all. The table lists every one, biggest first, so this is also the order to fix them in.` : 'Nothing cost points.'}`, `Measured on ${a.measuredOn}. ${a.limits}`, all.howToRead],
      emptyNote: 'No points were lost.' },
  ];
}

async function deepSets(topic, summary, dir) {
  const P = summary.perspectives || {}; const sc = summary.scores && summary.scores.method ? summary.scores : scorecard(summary);
  const host = (() => { try { return new URL(summary.startUrl).hostname; } catch { return summary.startUrl; } })();
  const sets = []; const files = []; const A = sc.areas || {};
  const top = (a, n = 3) => (a && a.basis.length ? a.basis.slice(0, n).map((b) => b.what.toLowerCase()).join('; ') : '');

  if (topic === 'security') {
    const a = A.security; const sm = (P.security || {}).summary || {};
    const rows = [], facts = [], third = new Map(); let homeHeaders = null; const certs = new Map();
    await eachPage(dir, summary, (r) => {
      const h = r.responseHeaders || {}; if (!homeHeaders) homeHeaders = h;
      rows.push([r.url, ...HEADERS.map(([k]) => (h[k] ? first(h[k]).slice(0, 120) : 'missing'))]);
      const s = r.security || {};
      facts.push([r.url, yn(s.https), s.inlineScripts ?? '', s.inlineEventHandlers ?? '', (s.thirdPartyScripts || []).length, (s.thirdPartyScripts || []).filter((x) => !x.integrity).length, (s.formsSendingToOtherSites || []).length, s.passwordFields ?? '', (s.insecureResourcesInPage || []).length, s.newTabLinksWithoutNoopener ?? '', (s.hiddenFields || []).length, s.commentsInCode ?? '', (r.cookies || []).length]);
      for (const x of [...(s.thirdPartyScripts || []).map((y) => ({ ...y, kind: 'script' })), ...(s.thirdPartyStyles || []).map((y) => ({ ...y, kind: 'stylesheet' }))]) {
        const u = x.src || x.href; if (!u) continue; const e = third.get(u) || { kind: x.kind, integrity: !!x.integrity, pages: 0 }; e.pages++; third.set(u, e);
      }
      if (r.tls && r.tls.issuer) certs.set([r.tls.subjectName, r.tls.issuer, r.tls.protocol].join('|'), r.tls);
    });
    sets.push(text('security-summary', 'Summary', [
      a ? `${host} scores ${a.score} out of 100 for security (grade ${a.grade}), from a passive review of ${a.measuredOn}.` : '',
      `The review found ${sm.high || 0} high, ${sm.medium || 0} medium, ${sm.low || 0} low and ${sm.info || 0} informational findings.${top(a) ? ` The ones costing most: ${top(a)}.` : ''}`,
      'What this covers: the protective headers each page sends, cookies and their flags, forms and where they send data, the certificate and connection, code loaded from other companies, and anything sensitive left visible in the pages.',
      'What it cannot cover: nothing was attacked, guessed or probed. Server-side weaknesses (login handling, access control, injection, outdated server software that does not announce itself) are invisible from outside. A high score means careful visible configuration, which usually goes with good practice elsewhere, but it is not proof that a site is safe.',
    ]));
    sets.push(...scoreSets('security', a, sc));
    sets.push({ id: 'security-headers', label: 'Protective headers, page by page', columns: ['Page', ...HEADERS.map(([, n]) => n)], rows, intro: ['Each column is a header that tells browsers to protect visitors. "missing" means the page did not send it. A well-configured site sends the same set on every page.'] });
    sets.push({ id: 'security-page-facts', label: 'Security facts, page by page', columns: ['Page', 'HTTPS', 'Inline scripts', 'Inline event handlers', 'Scripts from other hosts', 'Of those, without integrity check', 'Forms sending to other sites', 'Password fields', 'Insecure (http) resources', 'New-tab links without noopener', 'Hidden form fields', 'Comments in code', 'Cookies'], rows: facts });
    sets.push({ id: 'security-third-party-code', label: 'Code loaded from other companies', columns: ['Address', 'Kind', 'Integrity check', 'Pages using it'], rows: [...third.entries()].sort((x, y) => y[1].pages - x[1].pages).map(([u, e]) => [u, e.kind, yn(e.integrity), e.pages]), intro: ['Every script or stylesheet from another host can change what visitors see. An integrity check (SRI) makes the browser refuse a file that has been altered.'], emptyNote: 'No scripts or stylesheets are loaded from other hosts.' });
    sets.push({ id: 'security-certificate', label: 'Certificate and connection', columns: ['Name', 'Issued by', 'Protocol', 'Valid from', 'Valid to'], rows: [...certs.values()].map((t) => [t.subjectName, t.issuer, t.protocol, t.validFrom ? new Date(t.validFrom * 1000).toISOString().slice(0, 10) : '', t.validTo ? new Date(t.validTo * 1000).toISOString().slice(0, 10) : '']) });
    // The security set-up as files: what this site sends, ready to reuse on your own server.
    const real = (k) => k.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-');   // the header's actual name, as servers expect it
    const sent = HEADERS.filter(([k]) => homeHeaders && homeHeaders[k]).map(([k]) => [real(k), first(homeHeaders[k])]);
    const missing = HEADERS.filter(([k]) => RECOMMENDED[k] && !(homeHeaders && homeHeaders[k])).map(([k]) => [real(k), RECOMMENDED[k]]);
    const q = (v) => v.replace(/"/g, '\\"');
    const block = (fmtLine, comment) => [`${comment} Security headers ${host} sends, read by DeepScrape on ${String(summary.finishedAt || '').slice(0, 10)}.`, ...(sent.length ? sent.map(([n, v]) => fmtLine(n, v)) : [`${comment} (it sends none of the protective headers)`]), ...(missing.length ? ['', `${comment} Not sent by ${host}. Commonly recommended starting values, commented out: test before switching on.`, ...missing.map(([n, v]) => `${comment} ${fmtLine(n, v)}`)] : []), ''].join('\n');
    files.push({ name: 'security-setup/headers-observed.txt', content: block((n, v) => `${n}: ${v}`, '#') });
    files.push({ name: 'security-setup/nginx.conf', content: block((n, v) => `add_header ${n} "${q(v)}" always;`, '#') });
    files.push({ name: 'security-setup/apache.htaccess', content: block((n, v) => `Header always set ${n} "${q(v)}"`, '#') });
    files.push({ name: 'security-setup/express.js', content: "// Use: app.use(securityHeaders)\nfunction securityHeaders(req, res, next) {\n" + block((n, v) => `  res.setHeader(${JSON.stringify(n)}, ${JSON.stringify(v)});`, '  //') + "  next();\n}\nmodule.exports = securityHeaders;\n" });
    files.push({ name: 'security-setup/_headers', content: block((n, v) => `  ${n}: ${v}`, '#').replace(/^(# Security headers.*)$/m, '$1\n/*') });
    files.push({ name: 'security-setup/READ ME.txt', content: `These files hold the browser-protection headers ${host} sends, in the form each kind of server wants:\n\n  headers-observed.txt   the plain list\n  nginx.conf             for nginx (inside a server block)\n  apache.htaccess        for Apache (needs mod_headers)\n  express.js             for a Node.js Express app\n  _headers               for Netlify or Cloudflare Pages\n\nA Content-Security-Policy is written for one site's own scripts and hosts. Copying another site's policy unchanged will block your own files: use it as a pattern and replace the hosts with yours.\n` });
  }

  if (topic === 'design') {
    const d = P.design || {}; const ty = d.typography || {}; const n = (x) => (x || []).length;
    const fam = [...new Set((d.fonts || []).map((f) => String(f.value).split(' / ')[0]))];
    sets.push(text('design-summary', 'Summary', [
      `${host} uses ${fam.length} font famil${fam.length === 1 ? 'y' : 'ies'}${fam.length ? ` (${fam.slice(0, 4).join(', ')})` : ''}, ${n((d.colors || {}).text)} text colours, ${n((d.colors || {}).background)} background colours and ${n(d.fontSizes)} type sizes.`,
      ty.body ? `Body text is ${ty.body.fontSize} ${String(ty.body.fontFamily).split(',')[0].replace(/"/g, '')} at weight ${ty.body.fontWeight}, in ${ty.body.color} on ${ty.body.background}.${ty.h1 ? ` Main headings are ${ty.h1.fontSize} ${String(ty.h1.fontFamily).split(',')[0].replace(/"/g, '')} at weight ${ty.h1.fontWeight}.` : ''}` : '',
      `A tight design system usually has few values of each kind. This one has ${n(d.fontSizes)} type sizes, ${n(d.cornerRadii)} corner radii and ${n(d.shadows)} shadows in use.`,
      'The complete pack carries the design as files: design-tokens.css and design-tokens.json (every value, most used first), starter.css (a base stylesheet that applies the site\'s type styles), style-sheet.html (swatches and type samples), and a screenshot of every page at desktop and phone size.',
      'Colours, sizes, spacing and layout ideas are free to learn from. The site\'s logo, images and wording belong to its owner, and many fonts need their own licence before you can use them.',
    ]));
    const order = ['body', 'h1', 'h2', 'h3', 'h4', 'paragraph', 'link', 'button', 'input', 'nav', 'footer', 'card'];
    const keys = [...order.filter((k) => ty[k]), ...Object.keys(ty).filter((k) => ty[k] && !order.includes(k))];
    sets.push({ id: 'design-type-styles', label: 'Type and element styles', columns: ['Element', 'Font', 'Size', 'Line height', 'Weight', 'Letter spacing', 'Colour', 'Background', 'Corner radius', 'Padding', 'Text transform'], rows: keys.map((k) => { const v = ty[k]; return [k, v.fontFamily, v.fontSize, v.lineHeight, v.fontWeight, v.letterSpacing, v.color, v.background, v.borderRadius, v.padding, v.textTransform]; }), intro: ['How each kind of element is actually drawn on the start page, read from the browser after all styles applied.'] });
    const perPage = [];
    await eachPage(dir, summary, (r) => { const g = r.design || {}; const c = g.colors || {}; perPage.push([r.url, ((c.text || [])[0] || {}).value || '', ((c.background || [])[0] || {}).value || '', ((g.fonts || [])[0] || {}).value || '', (g.fontSizes || []).length, (c.text || []).length + (c.background || []).length, g.colorScheme || '', g.themeColor || '', r.screenshot ? 'yes' : 'no']); });
    sets.push({ id: 'design-per-page', label: 'Design, page by page', columns: ['Page', 'Main text colour', 'Main background', 'Main font', 'Type sizes used', 'Colours used', 'Colour scheme', 'Theme colour', 'Screenshot saved'], rows: perPage, intro: ['Pages that differ from the rest here are where the design system is not being followed.'] });
    const css = (v) => { const m = /^(#[0-9a-f]{6}) @(\d+)%$/i.exec(String(v)); if (!m) return v; const x = parseInt(m[1].slice(1), 16); return `rgb(${x >> 16} ${(x >> 8) & 255} ${x & 255} / ${m[2]}%)`; };
    const rule = (sel, v, extra = '') => !v ? '' : `${sel} {\n  font-family: ${v.fontFamily};\n  font-size: ${v.fontSize};\n  line-height: ${v.lineHeight};\n  font-weight: ${v.fontWeight};\n  letter-spacing: ${v.letterSpacing};\n  color: ${css(v.color)};\n${extra}}\n`;
    const box = (v) => !v ? '' : `  background: ${css(v.background)};\n  border-radius: ${v.borderRadius};\n  padding: ${v.padding};\n  text-transform: ${v.textTransform};\n`;
    files.push({ name: 'starter.css', content: [`/* A starting stylesheet that applies the type and element styles read from ${summary.startUrl}.\n   Fonts must be loaded separately (and licensed where needed). */`, rule('body', ty.body, ty.body ? `  background: ${css(ty.body.background)};\n` : ''), ...['h1', 'h2', 'h3', 'h4'].map((k) => rule(k, ty[k])), rule('p', ty.paragraph), rule('a', ty.link), rule('button, .button', ty.button, box(ty.button)), rule('input, select, textarea', ty.input, box(ty.input))].filter(Boolean).join('\n') });
  }

  if (topic === 'accessibility') {
    const a = A.accessibility; const rows = [], examples = [];
    await eachPage(dir, summary, (r) => {
      const x = r.accessibility; if (!x) return; const lm = x.landmarks || {};
      const total = (x.imagesWithoutDescription || 0) + (x.linksWithoutText || 0) + (x.buttonsWithoutName || 0) + (x.fieldsWithoutLabel || 0) + (x.lowContrastText || 0) + (x.headingLevelsSkipped || 0);
      rows.push([r.url, total, x.language || 'not set', x.imagesWithoutDescription, x.linksWithoutText, x.buttonsWithoutName, x.fieldsWithoutLabel, x.lowContrastText, x.headingLevelsSkipped, yn(lm.main), yn(lm.navigation), yn(x.skipLink), yn(x.zoomBlocked), x.framesWithoutTitle, x.positiveTabindex, x.autoplayingMedia, x.smallTouchTargets]);
      for (const e of x.lowContrastExamples || []) examples.push([r.url, 'Low contrast', typeof e === 'string' ? e : [e.text, e.color && `${e.color} on ${e.background}`, e.ratio && `ratio ${e.ratio}`].filter(Boolean).join(' | ')]);
      for (const e of x.fieldsWithoutLabelExamples || []) examples.push([r.url, 'Field without a label', typeof e === 'string' ? e : JSON.stringify(e)]);
    });
    rows.sort((x, y) => y[1] - x[1]);
    sets.push(text('accessibility-summary', 'Summary', [
      a ? `${host} scores ${a.score} out of 100 for accessibility (grade ${a.grade}), from automated checks on ${a.measuredOn}.${top(a) ? ` The problems costing most: ${top(a)}.` : ' No problems were found by the automated checks.'}` : '',
      'What this covers: page language, text alternatives for images, names for links and buttons, labels for form fields, text contrast, heading order, landmarks, zoom, frame titles, tab order, autoplaying media and touch-target size at phone width. Each is tied to its WCAG success criterion in the score table.',
      'What it cannot cover: automated checks find roughly a third of accessibility problems. Whether the site works by keyboard alone, makes sense in a screen reader, and uses plain wording needs a person to try it. The saved accessibility tree for every page (in the raw files) shows what a screen reader is given.',
    ]));
    sets.push(...scoreSets('accessibility', a, sc));
    sets.push({ id: 'accessibility-per-page', label: 'Problems, page by page', columns: ['Page', 'Problems', 'Language', 'Images without description', 'Links without text', 'Buttons without name', 'Fields without label', 'Low-contrast text', 'Heading levels skipped', 'Main landmark', 'Navigation landmark', 'Skip link', 'Zoom blocked', 'Frames without title', 'Positive tabindex', 'Autoplaying media', 'Small touch targets (phone)'], rows, intro: ['Worst pages first.'] });
    sets.push({ id: 'accessibility-examples', label: 'Examples to fix', columns: ['Page', 'Problem', 'Where'], rows: examples, emptyNote: 'No examples were recorded.' });
  }

  if (topic === 'speed') {
    const a = A.speed; const rows = [];
    await eachPage(dir, summary, (r) => { const v = r.vitals || {}, pf = r.performance || {}; const bytes = (r.network || []).reduce((s, x) => s + (x.bytes || x.size || 0), 0); rows.push([r.url, bytes || '', kb(bytes), (r.network || []).length, pf.ttfbMs, pf.domContentLoadedMs, pf.loadMs, v.firstPaintMs, v.largestPaintMs, v.layoutShift, v.longTasks, v.domNodes, pf.protocol]); });
    rows.sort((x, y) => (y[1] || 0) - (x[1] || 0));
    sets.push(text('speed-summary', 'Summary', [
      a ? `${host} scores ${a.score} out of 100 for speed (grade ${a.grade}).${top(a) ? ` What costs most: ${top(a)}.` : ' Nothing cost points.'}` : '',
      'What this covers: page weight and request counts, time to first byte, first paint, largest paint, layout shift, long tasks and page structure size, for every page.',
      'How to read the timings: they were taken on this computer and connection while several pages loaded together, so treat them as a guide and compare pages with each other. Real visitors on phones and slower connections will see longer times.',
    ]));
    sets.push(...scoreSets('speed', a, sc));
    sets.push({ id: 'speed-per-page', label: 'Every page, heaviest first', columns: ['Page', 'Bytes', 'Weight', 'Requests', 'First byte (ms)', 'DOM ready (ms)', 'Loaded (ms)', 'First paint (ms)', 'Largest paint (ms)', 'Layout shift', 'Long tasks', 'Elements', 'Protocol'], rows });
  }

  if (topic === 'privacy') {
    const a = A.privacy; const rows = [];
    await eachPage(dir, summary, (r) => { const x = r.privacy || {}; rows.push([r.url, (r.cookies || []).length, (x.trackers || []).map((t) => t.name || t).join(', '), x.consentBanner == null ? '' : yn(x.consentBanner), (x.thirdPartyHosts || []).length || '', Object.keys((r.storage || {}).localStorage || {}).length, Object.keys((r.storage || {}).sessionStorage || {}).length]); });
    sets.push(text('privacy-summary', 'Summary', [
      a ? `${host} scores ${a.score} out of 100 for privacy (grade ${a.grade}).${top(a) ? ` What costs most: ${top(a)}.` : ' Nothing cost points.'}` : '',
      'What this covers: every cookie set and its flags, every other company contacted while pages load, known tracking and advertising services, whether a consent banner was seen, what pages keep in browser storage, and whether a privacy policy is linked.',
      'What it cannot cover: what the site does with data once it reaches its servers, and whether its policy matches its practice. Consent banners are recognised by their wording and can be missed.',
    ]));
    sets.push(...scoreSets('privacy', a, sc));
    sets.push({ id: 'privacy-trackers', label: 'Tracking and advertising services', columns: ['Service', 'Kind', 'Pages'], rows: ((P.privacy || {}).trackers || []).map((t) => [t.name || t.host || String(t), t.kind || t.category || '', t.pages ?? '']), emptyNote: 'No known tracking or advertising services were seen.' });
    sets.push({ id: 'privacy-per-page', label: 'Privacy, page by page', columns: ['Page', 'Cookies', 'Trackers', 'Consent banner seen', 'Other hosts contacted', 'Local storage keys', 'Session storage keys'], rows });
  }

  if (topic === 'search') {
    const a = A.search; const I = summary.issues || {}; const rows = [];
    for (const [k, list] of Object.entries(I)) if (Array.isArray(list)) for (const x of list.slice(0, 500)) rows.push([k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), typeof x === 'string' ? x : x.url || x.href || x.title || JSON.stringify(x).slice(0, 200), typeof x === 'object' && x ? Object.entries(x).filter(([kk]) => !['url', 'href'].includes(kk)).map(([kk, v]) => `${kk}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ').slice(0, 300) : '']);
    sets.push(text('search-summary', 'Summary', [
      a ? `${host} scores ${a.score} out of 100 for search and content basics (grade ${a.grade}).${top(a) ? ` What costs most: ${top(a)}.` : ' Nothing cost points.'}` : '',
      'What this covers: titles, descriptions, headings, canonical addresses, robots rules, structured data, internal and external links, broken links, redirects, duplicate and thin pages, for every page.',
      'What it cannot cover: rankings also depend on who links to the site, what people search for, and how the content compares with competitors. None of that can be seen from a scrape.',
    ]));
    sets.push(...scoreSets('search', a, sc));
    sets.push({ id: 'search-issues', label: 'Every issue, with the page it is on', columns: ['Issue', 'Page or link', 'Detail'], rows, emptyNote: 'No issues were found.' });
  }

  if (topic === 'technology') {
    const inf = P.infrastructure || {}; const tech = (summary.technologies || []).map((t) => t.name); const dns = inf.dns || {}; const cert = inf.certificate || {};
    sets.push(text('technology-summary', 'Summary', [
      `${host} is built with ${tech.length ? tech.slice(0, 12).join(', ') : 'nothing that announces itself'}${(inf.serverSoftware || []).length ? `, served by ${inf.serverSoftware.join(', ')}` : ''}.`,
      `It answers from ${(dns.addresses || []).length} address${(dns.addresses || []).length === 1 ? '' : 'es'}${cert.issuer ? `, with a certificate from ${cert.issuer} valid to ${cert.validTo}` : ''}. Email protection: SPF ${dns.spf ? 'set' : 'not found'}, DMARC ${dns.dmarc ? 'set' : 'not found'}.`,
      'What this covers: software recognised from the pages and responses, server and protocol, DNS records, certificate, standard files (robots.txt, sitemap, security.txt) and every other host contacted.',
      'What it cannot cover: software that does not show itself in pages or headers, and anything behind the server (databases, internal services).',
    ]));
    const rows = []; await eachPage(dir, summary, (r) => rows.push([r.url, (r.technologies || []).map((t) => t.name || t).join(', '), first((r.responseHeaders || {}).server), first((r.responseHeaders || {})['x-powered-by']), (r.performance || {}).protocol || '', r.serverAddress || '', first((r.responseHeaders || {})['cache-control']), first((r.responseHeaders || {})['content-encoding'])]));
    sets.push({ id: 'technology-per-page', label: 'Technology, page by page', columns: ['Page', 'Recognised', 'Server', 'Powered by', 'Protocol', 'Server address', 'Caching', 'Compression'], rows });
  }
  if (topic === 'legal') {
    const L = P.legal || {}; const found = Object.entries(L).filter(([, v]) => typeof v === 'string' && /^https?:/.test(v)).map(([k]) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    sets.push(text('legal-summary', 'Summary', [
      `${host} links to: ${found.length ? found.join(', ') : 'none of the usual legal pages'}.${L.copyright ? ` Copyright line: ${L.copyright}` : ''}`,
      'What this covers: privacy policy, terms, cookie notice, accessibility statement, imprint and refund pages found by their links and wording; contact details; and the documents published on the site.',
      'What it cannot cover: whether those documents are legally sufficient where the site operates. That needs a lawyer who knows the jurisdiction.',
    ]));
  }
  if (topic === 'content') {
    const c = P.content || {};
    sets.push(text('content-summary', 'Summary', [
      `${host}: ${c.pages ?? (summary.pages || []).length} pages, ${c.totalWords ?? '?'} words${c.languages ? ', in ' + Object.keys(c.languages).join(', ') : ''}, and ${(summary.documents || []).length} documents.`,
      (c.topWords || []).length ? `Most used words: ${c.topWords.slice(0, 15).map((w) => w.word).join(', ')}.` : '',
      'This report carries the text of every page as it was read, including text revealed by clicking tabs and "show more", the text of PDFs and Office documents, every table, and contact details.',
    ]));
  }
  return { sets, files, scores: sc };
}

// All five scores in one table, for overviews and the lens report.
function scoreTable(summary) {
  const sc = summary.scores && summary.scores.method ? summary.scores : scorecard(summary);
  return { id: 'scores', label: `Scores: ${sc.overall ?? 'n/a'} out of 100 overall${sc.grade ? ` (grade ${sc.grade})` : ''}`, columns: ['Area', 'Score', 'Grade', 'Points lost', 'Biggest causes', 'Measured on'], rows: Object.values(sc.areas).map((a) => [a.label, a.score, a.grade, a.pointsLost, a.basis.slice(0, 3).map((b) => `${b.what} (-${b.points})`).join('; ') || 'nothing', a.measuredOn]), intro: [sc.howToRead] };
}

module.exports = { deepSets, scoreTable };
