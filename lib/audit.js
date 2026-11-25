'use strict';
/*
 * Looks at what was scraped from every angle - security, design, accessibility, speed, privacy,
 * infrastructure, content, legal - and rolls the page-level readings up into a site report.
 * Everything here is passive: it only reads what the site already sent to the browser.
 */
const dns = require('dns').promises;

const TRACKERS = [[/google-analytics\.com|analytics\.google\.com/, 'Google Analytics'], [/googletagmanager\.com/, 'Google Tag Manager'], [/doubleclick\.net|googlesyndication\.com|googleadservices\.com/, 'Google Ads'], [/facebook\.net|facebook\.com\/tr/, 'Meta Pixel'], [/hotjar\.com/, 'Hotjar'], [/clarity\.ms/, 'Microsoft Clarity'], [/tiktok\.com|ttwstatic/, 'TikTok Pixel'], [/linkedin\.com|licdn\.com/, 'LinkedIn Insight'], [/twitter\.com|t\.co|ads-twitter/, 'X / Twitter'], [/segment\.(com|io)/, 'Segment'], [/mixpanel\.com/, 'Mixpanel'], [/hubspot\.com|hs-scripts|hs-analytics/, 'HubSpot'], [/intercom\.io|intercomcdn/, 'Intercom'], [/cloudflareinsights\.com/, 'Cloudflare Web Analytics'], [/matomo|piwik/, 'Matomo'], [/plausible\.io/, 'Plausible'], [/fullstory\.com/, 'FullStory'], [/sentry\.io|sentry-cdn/, 'Sentry'], [/newrelic\.com|nr-data\.net/, 'New Relic'], [/pinterest\.com|pinimg/, 'Pinterest'], [/snapchat\.com|sc-static/, 'Snap Pixel'], [/bing\.com\/bat|bat\.bing/, 'Microsoft Ads'], [/amplitude\.com/, 'Amplitude'], [/klaviyo\.com/, 'Klaviyo'], [/mailchimp\.com|chimpstatic/, 'Mailchimp'], [/youtube\.com|ytimg\.com/, 'YouTube embed'], [/vimeo\.com/, 'Vimeo embed'], [/recaptcha|gstatic\.com\/recaptcha/, 'reCAPTCHA'], [/crisp\.chat/, 'Crisp'], [/tawk\.to/, 'Tawk.to'], [/zendesk|zdassets/, 'Zendesk']];
const STOP = new Set('the and for that with this from are was were have has had not but you your our their his her its they them can will would should could about into more than then there here what when where which who how all any some such only also just been being over under out off per via may one two new use used using get got each other these those very much many most own same too yes page home menu click read view see back next previous skip main content search close open login sign email phone'.split(' '));
const SEV = { high: 0, medium: 1, low: 2, info: 3 };
const sessionish = (n) => /sess|sid\b|auth|token|login|jwt|csrf|xsrf|remember|identity|user/i.test(n);

/** Security readings for one page, from its headers, cookies, connection and markup. */
function pageSecurity(rec, net, cookies) {
  const f = []; const add = (severity, title, detail, fix) => f.push({ severity, title, detail, fix });
  const h = rec.responseHeaders || {}; const s = rec.security || {}; const https = /^https:/.test(rec.finalUrl || rec.url);
  const csp = h['content-security-policy'] || s.policyInMetaTag || '';
  if (!https) add('high', 'Page is not served over HTTPS', 'Everything on it, including anything typed into forms, travels unencrypted.', 'Serve the site over HTTPS and redirect HTTP to it.');
  if (s.passwordFieldOnInsecurePage) add('high', 'Password field on an unencrypted page', 'Passwords typed here can be read on the network.', 'Move the sign-in page to HTTPS.');
  if ((s.formsSendingOverHttp || []).length) add('high', 'Form sends its data over plain HTTP', s.formsSendingOverHttp.join(', '), 'Point the form at an https:// address.');
  if (s.formsUsingGetWithPassword) add('high', 'Sign-in form uses GET', 'The password ends up in the address bar, browser history and server logs.', 'Use method="post".');
  if (https && !h['strict-transport-security']) add('medium', 'No HSTS header', 'Browsers are not told to always use HTTPS, so a first visit can be downgraded.', 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains.');
  if (!csp) add('medium', 'No Content Security Policy', 'Nothing limits which scripts may run, so an injected script would run freely.', 'Add a Content-Security-Policy header, starting in report-only mode.');
  else { if (/'unsafe-inline'/.test(csp) && /script-src|default-src/.test(csp)) add('low', 'Content Security Policy allows inline scripts', "'unsafe-inline' removes most of the protection against injected scripts.", 'Use nonces or hashes instead.'); if (/'unsafe-eval'/.test(csp)) add('low', 'Content Security Policy allows eval', "'unsafe-eval' is present.", 'Remove it if the code allows.'); }
  if (!h['x-frame-options'] && !/frame-ancestors/.test(csp)) add('medium', 'Page can be framed by other sites', 'No X-Frame-Options or frame-ancestors rule, so it could be embedded invisibly to trick clicks.', 'Send X-Frame-Options: SAMEORIGIN or CSP frame-ancestors.');
  if (!/nosniff/i.test(h['x-content-type-options'] || '')) add('low', 'No X-Content-Type-Options: nosniff', 'Browsers may guess file types, which can turn an upload into a script.', 'Send X-Content-Type-Options: nosniff.');
  if (!h['referrer-policy'] && !s.referrerMeta) add('low', 'No Referrer-Policy', 'Full page addresses may be passed to other sites when visitors click out.', 'Send Referrer-Policy: strict-origin-when-cross-origin.');
  if (!h['permissions-policy']) add('info', 'No Permissions-Policy', 'Camera, microphone, location and similar features are not explicitly restricted.', 'Add a Permissions-Policy listing what the site needs.');
  for (const k of ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator']) if (h[k] && /\d/.test(h[k])) add('low', 'Server software and version are disclosed', `${k}: ${h[k]}`, 'Hide version numbers in response headers.');
  if (h['access-control-allow-origin'] === '*') add('info', 'Any website may read this page via scripts', 'Access-Control-Allow-Origin: *', 'Fine for public data; restrict it for anything personal.');
  for (const c of cookies || []) {
    const sens = sessionish(c.name);
    if (https && !c.secure) add(sens ? 'medium' : 'low', 'Cookie without the Secure flag', `${c.name} can be sent over unencrypted connections.`, 'Set the Secure flag.');
    if (sens && !c.httpOnly) add('medium', 'Session-type cookie readable by scripts', `${c.name} has no HttpOnly flag, so an injected script could steal it.`, 'Set the HttpOnly flag.');
    if (!c.sameSite || c.sameSite === 'None') add('low', 'Cookie without SameSite protection', `${c.name} is sent on requests coming from other sites.`, 'Set SameSite=Lax or Strict.');
  }
  const mixed = [...new Set([...(https ? (net || []).filter((r) => /^http:/.test(r.url)).map((r) => r.url) : []), ...(s.insecureResourcesInPage || [])])];
  if (mixed.length) add('medium', 'Insecure (http://) resources on a secure page', mixed.slice(0, 8).join(', ') + (mixed.length > 8 ? ` and ${mixed.length - 8} more` : ''), 'Load everything over https://.');
  const tls = rec.tls;
  if (tls) {
    if (/TLS 1(\.0|\.1)?$|SSL/i.test(tls.protocol || '')) add('high', 'Outdated encryption protocol', tls.protocol, 'Disable TLS 1.0/1.1; use TLS 1.2 or 1.3.');
    if (tls.validTo) { const days = Math.round((tls.validTo * 1000 - Date.now()) / 864e5); if (days < 0) add('high', 'Security certificate has expired', `${-days} days ago`, 'Renew the certificate.'); else if (days < 21) add('medium', 'Security certificate expires soon', `in ${days} days`, 'Renew the certificate.'); }
  }
  const noSri = (s.thirdPartyScripts || []).filter((x) => !x.integrity);
  if (noSri.length) add('low', 'Scripts from other sites loaded without integrity checks', [...new Set(noSri.map((x) => { try { return new URL(x.src).hostname; } catch { return x.src; } }))].join(', '), 'Add integrity="sha384-..." or host the files yourself.');
  if (s.newTabLinksWithoutNoopener) add('info', 'Links opening new tabs without rel="noopener"', `${s.newTabLinksWithoutNoopener} links`, 'Add rel="noopener".');
  if (s.passwordFields && !s.csrfTokenFields && (rec.forms || []).some((x) => x.method === 'post')) add('info', 'No anti-forgery token seen in forms', 'Forms that change things usually carry a hidden token. It may be handled another way (headers, SameSite cookies).', 'Confirm the site has CSRF protection.');
  const jq = (rec.technologies || []).find((t) => /^jQuery \d/.test(t));
  if (jq) { const [maj, min] = jq.split(' ')[1].split('.').map(Number); if (maj < 3 || (maj === 3 && min < 5)) add('low', 'Old jQuery version', `${jq}: versions before 3.5.0 have published cross-site-scripting weaknesses.`, 'Upgrade jQuery.'); }
  if ((rec.sourceMaps || []).length) add('info', 'Source maps are public', `${rec.sourceMaps.length} files reveal the original, unminified source code.`, 'Remove them from production if the source is not meant to be public.');
  if ((rec.comments || []).some((c) => /password|passwd|secret|api[_-]?key|token|todo|fixme|debug/i.test(c))) add('low', 'Code comments mention sensitive-sounding words', 'A comment in the page source contains words like password, key, token, TODO or debug.', 'Review and remove comments from production HTML.');
  return f;
}

async function dnsInfo(hostname) {
  if (!hostname || /^[\d.]+$/.test(hostname) || hostname === 'localhost' || hostname.includes(':')) return null;
  const apex = hostname.replace(/^www\./, '');
  const t = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), 6000))]).catch(() => null);
  const [a, aaaa, cname, mx, txt, ns, dmarc, caa] = await Promise.all([t(dns.resolve4(hostname)), t(dns.resolve6(hostname)), t(dns.resolveCname(hostname)), t(dns.resolveMx(apex)), t(dns.resolveTxt(apex)), t(dns.resolveNs(apex)), t(dns.resolveTxt('_dmarc.' + apex)), t(dns.resolveCaa(apex))]);
  const flat = (x) => (x || []).map((r) => r.join(''));
  const spf = flat(txt).find((x) => /^v=spf1/i.test(x)) || null; const dm = flat(dmarc).find((x) => /^v=DMARC1/i.test(x)) || null;
  let reverse = null; if (a && a[0]) reverse = await t(dns.reverse(a[0]));
  return { hostname, addresses: a || [], ipv6: aaaa || [], alias: cname || [], reverseName: reverse || [], nameServers: ns || [], mailServers: (mx || []).sort((x, y) => x.priority - y.priority).map((m) => m.exchange), textRecords: flat(txt), spf, dmarc: dm, caa: caa || [] };
}

class Audit {
  constructor() {
    this.n = 0; this.sec = new Map(); this.design = { text: {}, background: {}, border: {}, fonts: {}, sizes: {}, radii: {}, shadows: {}, breakpoints: {}, vars: {}, logos: {}, fontFaces: new Map(), typography: null, theme: {} };
    this.a11y = { pages: 0, noLang: 0, images: 0, links: 0, buttons: 0, fields: 0, contrast: 0, skips: 0, noMain: 0, zoom: 0, worst: [] };
    this.perf = { pages: [], bytesByType: {}, requests: 0 }; this.third = new Map(); this.cookies = new Map(); this.words = new Map(); this.legal = {}; this.consent = 0;
    this.sig = {};
    this.hidden = new Set(); this.sourceMaps = new Set(); this.langs = {}; this.totalWords = 0; this.protocols = {}; this.servers = {}; this.tls = null; this.ip = {};
  }
  /** Sum a page's signals into site-wide ones: how many pages, totals, the distinct values, an example page. */
  addSignals(obj, url, prefix = '') {
    for (const [k0, v] of Object.entries(obj || {})) {
      const k = prefix + k0;
      if (v == null || v === false || v === '' || v === 0) continue;
      if (typeof v === 'object' && !Array.isArray(v)) { if (!prefix) this.addSignals(v, url, k + '.'); continue; }
      if (Array.isArray(v) && !v.length) continue;
      const e = this.sig[k] || (this.sig[k] = { pages: 0, sum: 0, values: [], examples: [] });
      e.pages++; if (e.examples.length < 3) e.examples.push(url);
      if (typeof v === 'number') e.sum += v;
      else for (const x of Array.isArray(v) ? v : [v]) { if (typeof x === 'boolean') continue; const t = typeof x === 'string' ? x : JSON.stringify(x); if (e.values.length < 40 && !e.values.includes(t)) e.values.push(t); }
    }
  }
  /** rec = the lean page record (as written to pages.jsonl) carrying rec.audit. */
  add(rec) {
    if (!rec || rec.error || rec.kind === 'file' || !rec.audit) return;
    this.n++; const A = rec.audit; this.addSignals(rec.signals, rec.url); const bumpAll = (dst, list) => { for (const x of list || []) dst[x.value] = (dst[x.value] || 0) + x.count; };
    for (const fd of A.securityFindings || []) { const e = this.sec.get(fd.title) || this.sec.set(fd.title, { severity: fd.severity, title: fd.title, fix: fd.fix, pages: [], details: new Set() }).get(fd.title); if (e.pages.length < 200) e.pages.push(rec.url); if (e.details.size < 12) e.details.add(fd.detail); }
    const d = rec.design; if (d) { bumpAll(this.design.text, d.colors.text); bumpAll(this.design.background, d.colors.background); bumpAll(this.design.border, d.colors.border); bumpAll(this.design.fonts, d.fonts); bumpAll(this.design.sizes, d.fontSizes); bumpAll(this.design.radii, d.cornerRadii); bumpAll(this.design.shadows, d.shadows); bumpAll(this.design.breakpoints, d.breakpoints); Object.assign(this.design.vars, d.cssVariables); if (d.logo) this.design.logos[d.logo] = (this.design.logos[d.logo] || 0) + 1; for (const ff of d.fontFaces || []) this.design.fontFaces.set(ff.family + '|' + (ff.weight || ''), ff); if (!this.design.typography) this.design.typography = d.typography; if (d.themeColor) this.design.theme[d.themeColor] = 1; }
    const a = rec.accessibility; if (a) { const t = this.a11y; t.pages++; if (!a.language) t.noLang++; t.images += a.imagesWithoutDescription; t.links += a.linksWithoutText; t.buttons += a.buttonsWithoutName; t.fields += a.fieldsWithoutLabel; t.contrast += a.lowContrastText; t.skips += a.headingLevelsSkipped; if (!a.landmarks.main) t.noMain++; if (a.zoomBlocked) t.zoom++; const score = a.imagesWithoutDescription + a.linksWithoutText + a.buttonsWithoutName + a.fieldsWithoutLabel + a.lowContrastText; if (score) t.worst.push({ url: rec.url, problems: score, lowContrast: a.lowContrastText, unlabelled: a.fieldsWithoutLabel + a.linksWithoutText + a.buttonsWithoutName, imagesWithoutDescription: a.imagesWithoutDescription }); if (a.language) this.langs[a.language] = (this.langs[a.language] || 0) + 1; }
    this.perf.pages.push({ url: rec.url, bytes: A.weight.total, requests: A.weight.requests, loadMs: rec.performance && rec.performance.loadMs, firstPaintMs: rec.vitals && rec.vitals.firstPaintMs, largestPaintMs: rec.vitals && rec.vitals.largestPaintMs, layoutShift: rec.vitals && rec.vitals.layoutShift, domNodes: rec.vitals && rec.vitals.domNodes });
    for (const [k, v] of Object.entries(A.weight.byType)) this.perf.bytesByType[k] = (this.perf.bytesByType[k] || 0) + v; this.perf.requests += A.weight.requests;
    for (const hst of A.thirdParties || []) { const e = this.third.get(hst.host) || this.third.set(hst.host, { host: hst.host, service: hst.service, requests: 0, pages: 0, kinds: new Set() }).get(hst.host); e.requests += hst.requests; e.pages++; hst.kinds.forEach((k) => e.kinds.add(k)); }
    for (const c of A.cookies || []) if (!this.cookies.has(c.name + '|' + c.domain)) this.cookies.set(c.name + '|' + c.domain, c);
    if (rec.privacy && rec.privacy.consentBannerShown) this.consent++;
    for (const [k, v] of Object.entries(rec.legal || {})) if (v && (!Array.isArray(v) || v.length) && !this.legal[k]) this.legal[k] = v;
    for (const hf of (rec.security && rec.security.hiddenFields) || []) this.hidden.add(hf); for (const m of rec.sourceMaps || []) this.sourceMaps.add(m);
    const text = (rec.text && rec.text.visible) || ''; this.totalWords += rec.wordCount || 0;
    for (const w of text.toLowerCase().match(/[a-zÀ-ɏ][a-zÀ-ɏ'-]{2,}/g) || []) if (!STOP.has(w)) this.words.set(w, (this.words.get(w) || 0) + 1);
    const pr = rec.performance && rec.performance.protocol; if (pr) this.protocols[pr] = (this.protocols[pr] || 0) + 1;
    const sv = (rec.responseHeaders || {}).server; if (sv) this.servers[sv] = (this.servers[sv] || 0) + 1;
    if (rec.tls && rec.tls.issuer && !this.tls) this.tls = { ...rec.tls, validFrom: rec.tls.validFrom ? new Date(rec.tls.validFrom * 1000).toISOString().slice(0, 10) : undefined, validTo: rec.tls.validTo ? new Date(rec.tls.validTo * 1000).toISOString().slice(0, 10) : undefined };
    if (rec.serverAddress) this.ip[rec.serverAddress.ipAddress] = 1;
  }

  async finish(ctx) {   // ctx: { startUrl, robots, wellKnown, sitemapCount, pagesIndex, emails, tech, docs }
    const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([value, count]) => ({ value, count }));
    const host = new URL(ctx.startUrl).hostname; const infra = await dnsInfo(host);
    const site = [];
    if (!ctx.wellKnown.some((w) => /security\.txt/.test(w.path))) site.push({ severity: 'info', title: 'No security.txt', details: ['There is no published contact for reporting security problems.'], fix: 'Publish /.well-known/security.txt.', pages: [] });
    if (infra && infra.mailServers.length) { if (!infra.spf) site.push({ severity: 'low', title: 'No SPF record for the domain', details: ['Others can more easily send email pretending to be from this domain.'], fix: 'Publish an SPF TXT record.', pages: [] }); if (!infra.dmarc) site.push({ severity: 'low', title: 'No DMARC record for the domain', details: ['Receiving mail servers are not told what to do with forged email.'], fix: 'Publish a _dmarc TXT record.', pages: [] }); else if (/p=none/i.test(infra.dmarc)) site.push({ severity: 'info', title: 'DMARC is in monitor-only mode', details: [infra.dmarc], fix: 'Move to p=quarantine or p=reject once reports look clean.', pages: [] }); }
    if (ctx.robots.blockedUrls.length || (ctx.robots.disallowed || []).length) site.push({ severity: 'info', title: 'robots.txt names paths the owner wants kept out of search', details: (ctx.robots.disallowed || []).slice(0, 30), fix: 'robots.txt is public; do not rely on it to hide anything sensitive.', pages: [] });
    if (ctx.emails.length) site.push({ severity: 'info', title: 'Email addresses are published in page text', details: [`${ctx.emails.length} addresses can be harvested by spammers.`], fix: 'Consider a contact form for addresses that get too much spam.', pages: [] });
    const findings = [...[...this.sec.values()].map((e) => ({ severity: e.severity, title: e.title, pagesAffected: e.pages.length, details: [...e.details], fix: e.fix, pages: e.pages.slice(0, 50) })), ...site.map((x) => ({ ...x, pagesAffected: 0 }))].sort((x, y) => SEV[x.severity] - SEV[y.severity] || y.pagesAffected - x.pagesAffected);
    const counts = { high: 0, medium: 0, low: 0, info: 0 }; findings.forEach((x) => counts[x.severity]++);
    const P = this.perf.pages; const avg = (k) => { const v = P.map((p) => p[k]).filter((x) => x != null); if (!v.length) return null; const m = v.reduce((s, x) => s + x, 0) / v.length; return k === 'layoutShift' ? Math.round(m * 1000) / 1000 : k === 'requests' ? Math.round(m * 10) / 10 : Math.round(m); };
    const third = [...this.third.values()].map((t) => ({ ...t, kinds: [...t.kinds] })).sort((x, y) => y.pages - x.pages);
    // How long the site has existed: Internet Archive captures and the domain's public registration record.
    const history = {}; const apex = host.replace(/^www\./, '');
    if (infra) {
      const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } }); return r.ok ? await r.json() : null; } catch { return null; } };
      const stamp = (t) => (t ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : undefined);
      const [first, last, rd, ipr] = await Promise.all([get(`https://archive.org/wayback/available?url=${encodeURIComponent(apex)}&timestamp=19960101`), get(`https://archive.org/wayback/available?url=${encodeURIComponent(apex)}`), get(`https://rdap.org/domain/${encodeURIComponent(apex)}`), Object.keys(this.ip)[0] ? get(`https://rdap.org/ip/${Object.keys(this.ip)[0]}`) : null]);
      const snap = (x) => x && x.archived_snapshots && x.archived_snapshots.closest;
      if (snap(first)) { history.firstArchived = stamp(snap(first).timestamp); history.firstArchivedCopy = snap(first).url; }
      if (snap(last)) history.lastArchived = stamp(snap(last).timestamp);
      if (rd && rd.events) { const ev = (n) => ((rd.events.find((x) => x.eventAction === n) || {}).eventDate || '').slice(0, 10) || undefined; history.domainRegistered = ev('registration'); history.domainExpires = ev('expiration'); history.domainLastChanged = ev('last changed');
        const reg = (rd.entities || []).find((x) => (x.roles || []).includes('registrar')); try { history.registrar = reg.vcardArray[1].find((x) => x[0] === 'fn')[3]; } catch { /* not given */ } history.domainStatus = rd.status; }
      if (ipr) { history.hostingCountry = ipr.country; history.hostingNetwork = ipr.name; }
    }
    const out = {
      history, signals: this.sig,
      security: { summary: counts, note: 'Passive review of what the site sends to any visitor. Nothing was attacked or probed.', findings, hiddenFormFields: [...this.hidden].slice(0, 200), publicSourceMaps: [...this.sourceMaps] },
      design: { colors: { text: top(this.design.text, 16), background: top(this.design.background, 16), border: top(this.design.border, 10) }, fonts: top(this.design.fonts, 14), fontSizes: top(this.design.sizes, 16), cornerRadii: top(this.design.radii, 10), shadows: top(this.design.shadows, 8), breakpoints: top(this.design.breakpoints, 24), typography: this.design.typography, cssVariables: this.design.vars, fontFiles: [...this.design.fontFaces.values()], logos: top(this.design.logos, 5).map((x) => x.value), themeColors: Object.keys(this.design.theme) },
      accessibility: { pagesChecked: this.a11y.pages, pagesWithoutLanguage: this.a11y.noLang, imagesWithoutDescription: this.a11y.images, linksWithoutText: this.a11y.links, buttonsWithoutName: this.a11y.buttons, formFieldsWithoutLabel: this.a11y.fields, lowContrastText: this.a11y.contrast, headingLevelsSkipped: this.a11y.skips, pagesWithoutMainLandmark: this.a11y.noMain, pagesBlockingZoom: this.a11y.zoom, worstPages: this.a11y.worst.sort((x, y) => y.problems - x.problems).slice(0, 25), note: 'Automated checks find roughly a third of accessibility problems; the rest need a person.' },
      performance: { averages: { pageBytes: avg('bytes'), requests: avg('requests'), loadMs: avg('loadMs'), firstPaintMs: avg('firstPaintMs'), largestPaintMs: avg('largestPaintMs'), layoutShift: avg('layoutShift'), domNodes: avg('domNodes') }, bytesByType: this.perf.bytesByType, heaviestPages: [...P].sort((x, y) => y.bytes - x.bytes).slice(0, 15), slowestPages: [...P].filter((p) => p.largestPaintMs != null).sort((x, y) => y.largestPaintMs - x.largestPaintMs).slice(0, 15), note: 'Measured on this computer and connection while scraping; treat as relative, not absolute.' },
      privacy: { thirdParties: third, trackers: third.filter((t) => t.service), cookies: [...this.cookies.values()], pagesShowingConsentBanner: this.consent, pagesChecked: this.n },
      infrastructure: { dns: infra, ipAddresses: Object.keys(this.ip), certificate: this.tls, protocols: this.protocols, serverSoftware: top(this.servers, 6).map((x) => x.value), robotsTxt: ctx.robots.found, sitemapAddresses: ctx.sitemapCount, standardFiles: ctx.wellKnown.map((w) => w.path) },
      content: { pages: this.n, totalWords: this.totalWords, languages: this.langs, topWords: [...this.words].sort((x, y) => y[1] - x[1]).slice(0, 80).map(([word, count]) => ({ word, count })), documents: ctx.docs.length },
      legal: this.legal,
    };
    return out;
  }
}

function reportMarkdown(summary) {
  const P = summary.perspectives; const L = []; const kb = (n) => (n == null ? '-' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  L.push(`# ${new URL(summary.startUrl).hostname}: full site report`, '', `Scraped ${summary.finishedAt}. ${summary.stats.pages} pages, ${summary.stats.assetsSaved} assets, ${summary.stats.filesDownloaded} documents, ${summary.stats.apiResponsesCaptured} background data responses.`, '');
  L.push('## Security', '', P.security.note, '', `High ${P.security.summary.high}, medium ${P.security.summary.medium}, low ${P.security.summary.low}, informational ${P.security.summary.info}.`, '');
  for (const f of P.security.findings) L.push(`- **${f.severity.toUpperCase()}: ${f.title}**${f.pagesAffected ? ` (${f.pagesAffected} pages)` : ''}. ${f.details[0] || ''} Fix: ${f.fix}`);
  L.push('', '## Design', '', `Text colours: ${P.design.colors.text.slice(0, 8).map((c) => c.value).join(', ')}`, `Background colours: ${P.design.colors.background.slice(0, 8).map((c) => c.value).join(', ')}`, `Fonts: ${P.design.fonts.slice(0, 6).map((c) => c.value).join('; ')}`, `Font sizes: ${P.design.fontSizes.slice(0, 10).map((c) => c.value).join(', ')}`, `Corner radii: ${P.design.cornerRadii.map((c) => c.value).join(', ') || 'none'}`, `Breakpoints: ${P.design.breakpoints.slice(0, 10).map((c) => c.value).join('; ') || 'none found'}`, `Design variables: ${Object.keys(P.design.cssVariables).length}`, '');
  const a = P.accessibility; L.push('## Accessibility', '', `${a.pagesChecked} pages checked. Images without a description: ${a.imagesWithoutDescription}. Low-contrast text: ${a.lowContrastText}. Unlabelled form fields: ${a.formFieldsWithoutLabel}. Links without text: ${a.linksWithoutText}. Buttons without a name: ${a.buttonsWithoutName}. Pages without a language: ${a.pagesWithoutLanguage}. ${a.note}`, '');
  const pf = P.performance.averages; L.push('## Speed', '', `Average page: ${kb(pf.pageBytes)}, ${pf.requests} requests, first paint ${pf.firstPaintMs} ms, largest paint ${pf.largestPaintMs} ms, layout shift ${pf.layoutShift}. ${P.performance.note}`, '');
  L.push('## Privacy', '', `Other companies contacted: ${P.privacy.thirdParties.length} hosts. Trackers and embeds recognised: ${[...new Set(P.privacy.trackers.map((t) => t.service))].join(', ') || 'none'}. Cookies: ${P.privacy.cookies.length}. Consent banner seen on ${P.privacy.pagesShowingConsentBanner} of ${P.privacy.pagesChecked} pages.`, '');
  const inf = P.infrastructure; L.push('## Infrastructure', '', `Addresses: ${inf.ipAddresses.join(', ') || '-'}. Server: ${inf.serverSoftware.join(', ') || 'not disclosed'}. Certificate: ${inf.certificate ? `${inf.certificate.issuer}, valid to ${inf.certificate.validTo}, ${inf.certificate.protocol}` : 'none (site is not on HTTPS)'}.` + (inf.dns ? ` Name servers: ${inf.dns.nameServers.join(', ')}. Mail: ${inf.dns.mailServers.join(', ') || 'none'}. SPF: ${inf.dns.spf || 'none'}. DMARC: ${inf.dns.dmarc || 'none'}.` : ''), '');
  L.push('## Technology', '', summary.technologies.map((t) => t.name).join(', ') || 'Nothing recognised', '');
  L.push('## Content', '', `${P.content.totalWords} words across ${P.content.pages} pages. Most used words: ${P.content.topWords.slice(0, 30).map((w) => w.word).join(', ')}.`, '');
  L.push('## Legal and contact', '', Object.entries(P.legal).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n') || 'No policy links found.', '', `Emails: ${summary.contacts.emails.join(', ') || 'none'}. Phones: ${summary.contacts.phones.join(', ') || 'none'}.`, '');
  L.push('## Content and search checks', '', Object.entries(summary.issues).map(([k, v]) => `- ${k}: ${v.length}`).join('\n'), '');
  return L.join('\n');
}

module.exports = { Audit, pageSecurity, reportMarkdown, TRACKERS };
