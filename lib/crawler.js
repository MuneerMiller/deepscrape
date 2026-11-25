'use strict';
/*
 * DeepScrape engine. Crawls a site in a real browser and saves everything it can see.
 *
 *   const crawl = new Crawl('https://example.com', { out: './out' });
 *   crawl.on('log', console.log);
 *   const summary = await crawl.run();
 *
 * Controls: crawl.pause() / resume() / stop() / continueHuman() / skipHuman()
 * Events:   log(line)  page(row)  stats(snapshot)  human({state,url,reason})  status(name)
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { chromium } = require('playwright');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const extractInPage = require('./extract');
const { extractDocText, ocrImage, stopOcr } = require('./documents');
const { Audit, pageSecurity, reportMarkdown, TRACKERS } = require('./audit');
const lensLib = require('./lenses');

// Flesch reading ease: 60+ is plain English, under 30 is academic.
function readingEase(text) {
  const words = text.match(/[A-Za-z']+/g) || []; const sentences = (text.match(/[^.!?\n]+[.!?]/g) || []).length;
  if (words.length < 80 || sentences < 3) return null;
  let syl = 0; for (const w of words) syl += Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) || []).length);
  return Math.max(0, Math.min(100, Math.round(206.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / words.length))));
}

const DEFAULTS = {
  out: null, maxPages: 1000, maxDepth: Infinity, concurrency: 3, delay: 300, retries: 2,
  subdomains: false, pathPrefix: null, include: null, exclude: null,
  assets: true, screenshots: true, mhtml: false, files: true, maxFileMb: 100,
  robots: true, sitemap: true, state: null, resume: false, headful: false,
  userAgent: null, timeout: 45000, wait: 0, waitFor: null, click: null, maxClicks: 30,
  scrollMs: 15000, insecure: false, viewport: '1366x900',
  interactive: false,       // may open a visible window when a page needs a human (sign-in, bot check)
  loginFirst: false,        // open the sign-in window before crawling
  maxLoginPrompts: 6,       // different sites that may each open one sign-in window per scrape
  searchTerms: null,        // words to look up through the site's own search
  loginTimeoutMs: 15 * 60000,
  interact: true, maxInteractions: 40,   // click through tabs, accordions, 'show more' and 'next' to reveal content
  mobileScreenshots: true,  // second screenshot at phone width
  docText: true,            // read the text inside PDFs, Office files and other documents
  ocr: false, ocrMax: 400,  // read the text inside images (slow)
  discoverFromData: true,   // follow addresses found inside the site's background data
  wellKnown: true,          // fetch feeds, manifest, humans.txt, security.txt, llms.txt ...
  loginDriver: null,        // test hook: async (page) => {} that operates the sign-in window
};

// ───────────────────────────── helpers ─────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const stripWww = (h) => h.replace(/^www\./i, '');
const TRACKING = /^(utm_\w+|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|yclid|ref_src)$/i;
// Links we never follow: they change state (log you out, delete things, add to cart).
const DANGEROUS = /(log|sign)[-_ ]?(out|off)|\/(delete|remove|destroy|unsubscribe)(\/|\?|$)|add[-_]?to[-_]?(cart|basket)|[?&]action=(delete|logout|remove)/i;
const LOGIN_LIKE = /(^|[\/._-])(log[-_]?in|sign[-_]?in|sso|auth|authenticate|authorize|oauth2?|saml|session\/new|wp-login|adfs)([\/._?-]|$)|^(login|accounts|auth|sso|id)\./i;
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|tsv|zip|rar|7z|gz|tar|epub|mobi|ics|vcf|mp3|wav|ogg|m4a|mp4|webm|mov|avi|mkv|apk|exe|dmg|msi|psd|ai|eps)$/i;
const MIME_EXT = {
  'text/html': '.html', 'application/json': '.json', 'text/css': '.css', 'application/javascript': '.js', 'text/javascript': '.js',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg',
  'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'application/xml': '.xml', 'text/xml': '.xml', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3',
  'application/manifest+json': '.webmanifest', 'text/csv': '.csv', 'application/zip': '.zip',
};
const safeName = (s) => s.replace(/[<>:"|?*\\\x00-\x1f]/g, '_').replace(/\.+$/g, '').replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '_$1');
const loginLike = (href) => { try { const u = new URL(href); return LOGIN_LIKE.test(u.hostname) || LOGIN_LIKE.test(u.pathname); } catch { return false; } };

function normalizeUrl(raw, base) {
  let u;
  try { u = new URL(raw, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (!/^#[!/]/.test(u.hash)) u.hash = '';           // keep the hash only for hash-routed apps
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href;
}
function urlKey(href) {
  const u = new URL(href);
  let p = u.pathname.replace(/\/{2,}/g, '/').replace(/\/(index|default)\.(html?|php|aspx?)$/i, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  return stripWww(u.hostname.toLowerCase()) + (u.port ? ':' + u.port : '') + p + u.search + u.hash;
}
function looksLikeTrap(href) {
  if (href.length > 2000) return true;
  const segs = new URL(href).pathname.split('/').filter(Boolean);
  if (segs.length > 25) return true;
  const count = {};
  for (const s of segs) if ((count[s] = (count[s] || 0) + 1) >= 4) return true;
  return false;
}
function pageSlug(href) {
  const u = new URL(href);
  let s = (u.pathname + (u.search ? '_' + u.search.slice(1) : '') + (u.hash ? '_' + u.hash.slice(1) : '')).replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'home').slice(0, 60);
}
const csvCell = (v) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' '); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvRow = (arr) => arr.map(csvCell).join(',') + '\n';
const writeJson = (file, data) => fsp.writeFile(file, JSON.stringify(data, null, 2));

function parseRobots(text) {
  const groups = []; const sitemaps = [];
  let cur = null, lastWasAgent = false;
  for (const line0 of text.split(/\r?\n/)) {
    const line = line0.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'sitemap') { sitemaps.push(v); continue; }
    if (k === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === 'disallow' || k === 'allow') { if (v) cur.rules.push({ allow: k === 'allow', path: v }); }
    else if (k === 'crawl-delay') cur.crawlDelay = Number(v) || null;
  }
  const g = groups.find((x) => x.agents.includes('*')) || { rules: [], crawlDelay: null };
  const rules = g.rules.map((r) => ({
    allow: r.allow, len: r.path.length,
    re: new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')),
  }));
  return {
    sitemaps, crawlDelay: g.crawlDelay, disallowed: [...new Set(groups.flatMap((x) => x.rules.filter((r) => !r.allow).map((r) => r.path)))],
    allowed(href) {
      const u = new URL(href); const p = u.pathname + u.search;
      let best = null;
      for (const r of rules) if (r.re.test(p) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
      return !best || best.allow;
    },
  };
}

async function launchBrowser(headless) {
  const tries = [{}, { channel: 'chrome' }, { channel: 'msedge' }];   // bundled Chromium, then installed Chrome, then Edge
  let lastErr;
  for (const t of tries) {
    try { return await chromium.launch({ headless, ...t }); } catch (e) { lastErr = e; }
  }
  throw new Error('Could not start a browser. Install Google Chrome or run: npx playwright install chromium (' + lastErr.message.split('\n')[0] + ')');
}

// Runs in the page: does this look like a sign-in wall or a "prove you are human" check?
function gateProbe() {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = ((document.body && document.body.innerText) || '').slice(0, 4000);
  const words = (text.match(/\S+/g) || []).length;
  const pw = [...document.querySelectorAll('input[type="password"]')].some(vis);
  const challenge = (/just a moment|checking your browser|verify(ing)? (that )?you are (a )?human|are you a robot|unusual traffic|press (and|&) hold|attention required/i.test(document.title + ' ' + text) && words < 250)
    || (!!document.querySelector('iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"], #challenge-form, #challenge-running') && words < 120);
  const loginWords = /\b(sign|log)[ -]?in\b|\blogin\b|\bpassword\b|authenticat|anmelden|connexion|iniciar sesi|aanmelden|accedi/i.test(document.title + ' ' + text.slice(0, 1500));
  const pwCount = [...document.querySelectorAll('input[type="password"]')].filter(vis).length;
  const session = {};
  try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); session[k] = sessionStorage.getItem(k); } } catch { /* blocked */ }
  return { pw, challenge, words, loginWall: pwCount === 1 && loginWords && words < 150, origin: location.origin, session };
}

// Runs in the page: things that are safe to click to reveal more content. Never forms, never links to
// other pages, never anything whose label suggests it changes something.
function findClickables() {
  const DANGER = /delete|remove|buy|pay|purchase|checkout|order|submit|send|post\b|log ?out|sign ?out|sign ?in|log ?in|register|subscribe|save|confirm|cancel|accept|agree|decline|reject|apply|book|reserve|donate|vote|like|follow|share|download|print|close|dismiss|upload|\badd\b|edit|update|reset|clear|install|approve|archive|publish|enable|disable|import|export|sync|generate|\brun\b|start|stop|invite|assign|mark|move|merge|create|new\b/i;
  const MORE = /\b(more|show|expand|view all|see all|read|load|next|older|details|full|reveal|continue reading|transcript|description|specs?|specifications|reviews|faq|overview|features)\b|[›»→+]\s*$/i;
  const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const label = (el) => (el.innerText || el.getAttribute('aria-label') || el.title || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  for (const el of document.querySelectorAll('[data-ds-click]')) el.removeAttribute('data-ds-click');
  const out = []; const ord = {}; let i = 0;
  const add = (el, kind, repeat) => {
    if (el.hasAttribute('data-ds-click') || !vis(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const l = label(el); if (DANGER.test(l)) return;
    if (/^(input|select|textarea)$/.test(el.localName)) return;
    if (el.closest('form') && (el.type === 'submit' || (el.localName === 'button' && !el.getAttribute('type')))) return;
    const a = el.closest('a[href]'); if (a) { const h = a.getAttribute('href'); if (h && !/^(#|javascript:)/i.test(h)) return; }
    const base = kind + '|' + l; ord[base] = (ord[base] || 0) + 1;
    el.setAttribute('data-ds-click', ++i); out.push({ id: i, kind, label: l || '(unlabelled ' + kind + ')', repeat: !!repeat, key: repeat ? base : base + '|' + ord[base] });
  };
  for (const el of document.querySelectorAll('[role="tab"]')) if (el.getAttribute('aria-selected') !== 'true') add(el, 'tab');
  for (const el of document.querySelectorAll('[aria-expanded="false"]')) add(el, 'expand');
  for (const el of document.querySelectorAll('[data-toggle="tab"],[data-bs-toggle="tab"],[data-toggle="pill"],[data-bs-toggle="pill"],[data-toggle="collapse"],[data-bs-toggle="collapse"]')) add(el, 'toggle');
  for (const el of document.querySelectorAll('button,[role="button"],a,[onclick]')) { const l = label(el); if (l && l.length <= 40 && MORE.test(l)) add(el, 'more', /more|load|next|older|[›»→]/i.test(l)); }
  return out.slice(0, 200);
}

// Web addresses mentioned inside JSON data (background responses, embedded app state).
function harvestUrls(node, out, key, budget = { n: 60000 }, depth = 0) {
  if (node == null || depth > 14 || budget.n-- <= 0) return;
  if (typeof node === 'string') {
    if (node.length > 600 || /\s/.test(node)) return;
    if (/^https?:\/\//i.test(node)) out.add(node);
    else if (/^\/[^/\s]/.test(node) && node.length < 300 && key && /^(url|href|link|permalink|path|uri|canonical|route|to|slug|pathname|web_?url)$/i.test(key)) out.add(node);
  } else if (Array.isArray(node)) for (const v of node) harvestUrls(v, out, key, budget, depth + 1);
  else if (typeof node === 'object') for (const [k, v] of Object.entries(node)) harvestUrls(v, out, k, budget, depth + 1);
}
const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|css|js|mjs|map|woff2?|ttf|otf|eot)$/i;

// ───────────────────────────── the crawl ─────────────────────────────
class Crawl extends EventEmitter {
  constructor(startUrl, options = {}) {
    super();
    this.opts = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== null && v !== '')) };
    const o = this.opts;
    for (const k of ['include', 'exclude']) if (typeof o[k] === 'string') o[k] = new RegExp(o[k], 'i');
    if (!o.maxPages || o.maxPages <= 0) o.maxPages = Infinity;
    // Choosing lens families switches off the expensive collectors that none of them needs. It never switches one on.
    if (typeof o.lensFamilies === 'string') o.lensFamilies = o.lensFamilies.split(/[\s,]+/).map(Number);
    o.lensFamilies = Array.isArray(o.lensFamilies) ? [...new Set(o.lensFamilies.map(Number).filter((n) => n >= 1 && n <= lensLib.families().length))].sort((a, b) => a - b) : null;
    if (o.lensFamilies && (!o.lensFamilies.length || o.lensFamilies.length === lensLib.families().length)) o.lensFamilies = null;
    const need = lensLib.collectorsFor(o.lensFamilies); this.skipped = [];
    if (need) for (const [k, wanted] of Object.entries(need)) if (!wanted && o[k]) { o[k] = false; this.skipped.push(k); }
    if (o.maxDepth == null || o.maxDepth < 0) o.maxDepth = Infinity;
    this.startUrl = normalizeUrl(/^https?:\/\//i.test(startUrl) ? startUrl : 'https://' + startUrl);
    if (!this.startUrl) throw new Error('Invalid URL: ' + startUrl);
    this.status = 'idle'; this.pagesIndex = []; this._paused = false; this._stop = false; this._humanDecide = null;
    this._snapshot = () => ({ status: this.status, pages: 0, queued: 0 });
  }
  pause() { if (this.status === 'running') { this._paused = true; this._setStatus('paused'); } }
  resume() { if (this._paused) { this._paused = false; this._setStatus('running'); } }
  stop() { this._stop = true; this._paused = false; if (this._humanDecide) this._humanDecide('skip'); }
  continueHuman() { if (this._humanDecide) this._humanDecide('continue'); }
  skipHuman() { if (this._humanDecide) this._humanDecide('skip'); }
  snapshot() { return this._snapshot(); }
  _setStatus(s) { this.status = s; this.emit('status', s); }

  async run() {
    const self = this; const opts = this.opts; const startUrl = this.startUrl;
    const log = (m) => this.emit('log', m);
    const start = new URL(startUrl);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const outDir = this.outDir = path.resolve(opts.out || path.join('scraped', `${safeName(start.hostname)}-${stamp}`));
    const dirs = { pages: path.join(outDir, 'pages'), assets: path.join(outDir, 'assets'), files: path.join(outDir, 'files') };
    for (const d of [outDir, ...Object.values(dirs)]) await fsp.mkdir(d, { recursive: true });
    const [vw, vh] = String(opts.viewport).split('x').map(Number);
    this._setStatus('starting');

    const browser = await launchBrowser(!opts.headful);
    // Use the same user agent in the hidden browser and in the visible sign-in window, so a session started in one keeps working in the other.
    let ua = opts.userAgent;
    if (!ua) { const p = await browser.newPage(); ua = (await p.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome'); await p.close(); }
    async function makeContext(state) {
      const { sessionStorage: ss, ...pwState } = state || {};
      const ctx = await browser.newContext({ viewport: { width: vw || 1366, height: vh || 900 }, ignoreHTTPSErrors: opts.insecure, userAgent: ua, ...(state ? { storageState: pwState } : {}) });
      ctx.setDefaultTimeout(opts.timeout);
      await ctx.addInitScript(() => {   // speed readings have to start before the page does
        try {
          window.__dsVitals = { cls: 0, long: 0 };
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__dsVitals.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__dsVitals.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver((l) => { window.__dsVitals.long += l.getEntries().length; }).observe({ type: 'longtask', buffered: true });
        } catch { /* older browser */ }
      });
      if (ss && ss.origin && ss.items && Object.keys(ss.items).length) {
        await ctx.addInitScript(({ origin, items }) => { try { if (location.origin === origin) for (const [k, v] of Object.entries(items)) if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v); } catch { /* ignore */ } }, ss);
      }
      return ctx;
    }
    let savedState = null;
    if (opts.state && fs.existsSync(opts.state)) { try { savedState = JSON.parse(await fsp.readFile(opts.state, 'utf8')); } catch { log('Saved sign-in could not be read; starting signed out.'); } }
    let context = await makeContext(savedState);
    const oldContexts = [];
    let authenticated = !!savedState, epoch = 0;

    // ---- crawl state ----
    const allowedHosts = new Set([stripWww(start.hostname.toLowerCase())]);
    const seen = new Set(); const queue = [];
    const pagesIndex = this.pagesIndex; const errors = [];
    const skipped = { robots: [], outOfScope: 0, dangerous: [], trap: 0 };
    const redirects = []; const gated = [];
    const assetMap = new Map(); const fileMap = new Map();
    const allLinks = []; const linkGraph = new Map(); const docs = []; const wellKnown = []; const queryVariants = new Map(); let ocrCount = 0;
    const discovered = { emails: new Set(), phones: new Set(), socials: new Set(), externalLinks: new Set(), tech: new Map() };
    let counter = 0, apiTotal = 0, bytesSaved = 0, delay = opts.delay;
    const activeUrls = new Set();
    const stateFile = path.join(outDir, 'crawl-state.json');
    const F = { jsonl: path.join(outDir, 'pages.jsonl'), images: path.join(outDir, 'images.jsonl'), api: path.join(outDir, 'api.jsonl'), links: path.join(outDir, 'links.jsonl'), docs: path.join(outDir, 'documents.jsonl') };
    const tStart = Date.now();

    if (opts.resume && fs.existsSync(stateFile)) {
      const st = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
      st.seen.forEach((k) => seen.add(k)); queue.push(...st.queue); counter = st.counter;
      pagesIndex.push(...st.pagesIndex); st.allowedHosts.forEach((h) => allowedHosts.add(h));
      redirects.push(...(st.redirects || [])); gated.push(...(st.gated || []));
      for (const g of gated.splice(0)) queue.unshift({ url: g.url, depth: g.depth || 1, from: g.foundOn || null }); // continuing = try the waiting pages again (one window per site)
      log(`Resuming: ${pagesIndex.length} pages done, ${queue.length} queued.`);
      this._replay = true;
    }
    const saveState = () => fsp.writeFile(stateFile, JSON.stringify({ seen: [...seen], queue: [...queue, ...[...activeUrls].map((u) => ({ url: u, depth: 1, from: null }))], counter, pagesIndex, allowedHosts: [...allowedHosts], redirects, gated })).catch(() => {});

    // Declared before the live snapshot below: the once-a-second progress tick reads them while the browser is still starting.
    const humanSites = new Map();    // "reason|login host" -> { host, reason, url, state: 'signed-in' | 'declined' | 'unavailable' }
    const signInList = () => [...humanSites].map(([key, v]) => ({ ...v, key, pagesWaiting: gated.filter((g) => g.key === key).length }))
      .concat([...new Set(gated.filter((g) => !humanSites.has(g.key)).map((g) => g.key))].map((key) => ({ key, host: key.split('|')[1], reason: key.split('|')[0], state: 'not-asked', pagesWaiting: gated.filter((g) => g.key === key).length })));

    this._snapshot = () => ({
      status: self.status, startUrl, outDir, pages: pagesIndex.length, queued: queue.length, active: [...activeUrls],
      assets: [...assetMap.values()].filter(Boolean).length, files: [...fileMap.values()].filter(Boolean).length, apiResponses: apiTotal,
      errors: errors.length + pagesIndex.filter((p) => p.error).length, redirects: redirects.length, needSignIn: gated.length, signIns: signInList(), robotsBlocked: skipped.robots.length,
      documentsRead: docs.filter((d) => d.words).length, bytesSaved, elapsedMs: Date.now() - tStart, authenticated, delay,
    });
    const ticker = setInterval(() => { try { this.emit('stats', this._snapshot()); } catch (e) { log('Progress update failed: ' + e.message); } }, 1000);

    const inScope = (href) => {
      const u = new URL(href); const h = stripWww(u.hostname.toLowerCase());
      const hostOk = allowedHosts.has(h) || (opts.subdomains && [...allowedHosts].some((a) => h.endsWith('.' + a)));
      if (!hostOk) return false;
      if (opts.pathPrefix && !u.pathname.startsWith(opts.pathPrefix)) return false;
      if (opts.include && !opts.include.test(href)) return false;
      if (opts.exclude && opts.exclude.test(href)) return false;
      return true;
    };

    // ---- robots.txt + sitemaps ----
    let robots = { sitemaps: [], crawlDelay: null, allowed: () => true, disallowed: [] };
    const audit = new Audit(); let mapCount = 0;
    let robotsTxt = null;
    try {
      const r = await context.request.get(start.origin + '/robots.txt', { timeout: 15000 });
      if (r.ok() && !/<html/i.test((robotsTxt = await r.text()).slice(0, 500))) {
        await fsp.writeFile(path.join(outDir, 'robots.txt'), robotsTxt);
        const parsed = parseRobots(robotsTxt);
        robots.sitemaps = parsed.sitemaps; robots.disallowed = parsed.disallowed;
        if (opts.robots) { robots.allowed = parsed.allowed; robots.crawlDelay = parsed.crawlDelay; }
      } else robotsTxt = null;
    } catch { robotsTxt = null; }
    delay = Math.max(opts.delay, Math.min((robots.crawlDelay || 0) * 1000, 10000));

    function enqueue(raw, depth, from) {
      const href = normalizeUrl(raw, from && /^https?:/.test(from) ? from : startUrl);
      if (!href) return false;
      const key = urlKey(href);
      if (seen.has(key)) return false;
      if (!inScope(href)) { skipped.outOfScope++; return false; }
      seen.add(key);
      if (depth > opts.maxDepth) return false;
      if (DANGEROUS.test(href)) { skipped.dangerous.push(href); return false; }
      if (looksLikeTrap(href)) { skipped.trap++; return false; }
      const qu = new URL(href);
      if (qu.search) { const pk = qu.hostname + qu.pathname; const nq = (queryVariants.get(pk) || 0) + 1; queryVariants.set(pk, nq); if (nq > 3000) { skipped.trap++; return false; } }   // endless calendars, filters, sort orders
      if (!robots.allowed(href)) { skipped.robots.push(href); return false; }
      queue.push({ url: href, depth, from: from || null });
      return true;
    }

    const sitemapUrls = []; const sitemapsRead = [];
    async function readSitemap(url, level = 0) {
      if (sitemapsRead.length >= 60 || sitemapsRead.includes(url) || level > 3) return;
      sitemapsRead.push(url);
      try {
        const r = await context.request.get(url, { timeout: 20000 });
        if (!r.ok()) return;
        let buf = await r.body();
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
        const xml = buf.toString('utf8');
        const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
        if (/<sitemapindex/i.test(xml)) for (const l of locs) await readSitemap(l, level + 1);
        else sitemapUrls.push(...locs);
      } catch { /* unreadable sitemap */ }
    }
    if (!seen.size) {
      enqueue(startUrl, 0, null);
      if (opts.sitemap && opts.maxPages > 1) {
        const candidates = robots.sitemaps.length ? robots.sitemaps : [start.origin + '/sitemap.xml', start.origin + '/sitemap_index.xml'];
        for (const s of candidates) await readSitemap(s);
        let n = 0; for (const u of sitemapUrls) if (enqueue(u, 1, 'sitemap')) n++;
        if (sitemapUrls.length) log(`Sitemap: ${sitemapUrls.length} URLs listed, ${n} added to the queue.`);
      }
      if (opts.wellKnown && opts.maxPages > 1) {
        // Standard files sites publish outside their pages: feeds, app manifest, humans.txt, security.txt, llms.txt.
        await Promise.all(['/feed', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/manifest.json', '/site.webmanifest', '/humans.txt', '/security.txt', '/.well-known/security.txt', '/ads.txt', '/llms.txt', '/llms-full.txt', '/opensearch.xml'].map(async (pth) => {
          try {
            const url = start.origin + pth; if (!robots.allowed(url)) return;
            const r = await context.request.get(url, { timeout: 8000 }); if (!r.ok()) return;
            const mime = (r.headers()['content-type'] || '').split(';')[0].trim(); const buf = await r.body();
            if (!buf.length || /text\/html/.test(mime) || /^\s*<!doctype html|^\s*<html/i.test(buf.slice(0, 300).toString())) return;
            const rel = 'files/' + assetPath(url, mime); await saveBuffer(dirs.files, rel.slice(6), buf); fileMap.set(url, rel); seen.add(urlKey(normalizeUrl(url)));
            await readDoc(url, rel, buf, mime, 'well-known');
            let n = 0; if (/xml|rss|atom|json|llms/.test(mime + pth)) for (const m of buf.toString('utf8').matchAll(/https?:\/\/[^\s"'<>\])]+/g)) if (enqueue(m[0].replace(/&amp;/g, '&'), 1, 'feed')) n++;
            wellKnown.push({ path: pth, saved: rel, linksAdded: n });
          } catch { /* not there */ }
        }));
        if (wellKnown.length) log(`Also found: ${wellKnown.map((w) => w.path).join(', ')}`);
      }
    }

    // ---- a person is needed: sign-in wall or bot check ----
    // Rules: a window opens at most ONCE per site that asks for a sign-in. If you close it or skip it,
    // that site is never asked for again in this scrape; its pages are listed as waiting on you instead.
    let humanPromise = null, windowsBroken = false, humanCount = 0;
    const siteKey = (url, reason) => { let h = url; try { h = stripWww(new URL(url).hostname); } catch { /* keep */ } return reason + '|' + h; };
    async function doHuman(url, reason, detected) {
      const before = self.status; self._setStatus('waiting-for-you');
      const host = siteKey(url, reason).split('|')[1];
      self.emit('human', { state: 'open', url, reason, host });
      log(reason === 'challenge' ? `${host} wants to check you are human. A browser window is open. Close it to skip this site.` : `${host} needs a sign-in. A browser window is open - sign in there, or close it to skip this site.`);
      const state = await context.storageState().catch(() => undefined);
      const hb = await launchBrowser(false);
      let closed = false; hb.on('disconnected', () => { closed = true; });
      const hctx = await hb.newContext({ viewport: null, ignoreHTTPSErrors: opts.insecure, userAgent: ua, ...(state ? { storageState: state } : {}) });
      hctx.on('close', () => { closed = true; });
      const page = await hctx.newPage();
      page.on('close', () => { if (!hctx.pages().length) closed = true; });      // last tab closed = window closed
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      if (opts.loginDriver) opts.loginDriver(page).catch((e) => log('loginDriver error: ' + e.message));
      let decided = null; self._humanDecide = (v) => { decided = v; };
      let last = null, lastSS = null, sawGate = !!detected, calm = 0;
      try { const first = await page.evaluate(gateProbe); if (first.pw || first.challenge) sawGate = true; } catch { /* still loading */ }
      const deadline = Date.now() + opts.loginTimeoutMs;
      while (decided === null && !closed && Date.now() < deadline) {
        await sleep(1000);
        try {
          const pages = hctx.pages(); if (!pages.length) { closed = true; break; }
          const p = pages[pages.length - 1];
          const info = await p.evaluate(gateProbe);
          last = await hctx.storageState(); lastSS = { origin: info.origin, items: info.session };
          if (info.pw || info.challenge) { sawGate = true; calm = 0; }
          else if (sawGate && !loginLike(p.url())) { if (++calm >= 4) decided = 'auto'; }  // through the sign-in and settled
          else calm = 0;
        } catch { /* page navigating, or the window is going away */ }
      }
      if (!closed) { try { last = await hctx.storageState(); } catch { /* keep last */ } }
      await hb.close().catch(() => {});
      self._humanDecide = null;
      // Signed in = it settled past the sign-in by itself, you pressed Continue, or you closed the window after getting through.
      const ok = !!last && (decided === 'auto' || decided === 'continue' || (closed && decided === null && sawGate && calm >= 1));
      if (ok) {
        const merged = { ...last, sessionStorage: lastSS };
        oldContexts.push(context); context = await makeContext(merged); epoch++; authenticated = true;
        if (opts.state) { await fsp.mkdir(path.dirname(path.resolve(opts.state)), { recursive: true }); await fsp.writeFile(opts.state, JSON.stringify(merged)); }
        log(`Signed in to ${host}. Carrying on with your session.`);
      } else log(closed ? `Window closed without signing in. ${host} will not be asked for again; its pages are listed as waiting on you.` : decided === 'skip' ? `Skipped ${host}. Its pages are listed as waiting on you.` : `Nobody signed in to ${host} in time; carrying on without.`);
      self.emit('human', { state: 'done', ok, host });
      if (!self._stop) self._setStatus(self._paused ? 'paused' : (before === 'starting' ? 'starting' : 'running'));
      return ok;
    }
    async function requestHuman(url, reason, detected = true, forced = false) {
      if (!opts.interactive || self._stop || windowsBroken) return false;
      const key = siteKey(url, reason);
      while (humanPromise) await humanPromise.catch(() => {});          // one window at a time
      if (humanSites.has(key) && !forced) return false;                  // already asked for this site once
      if (humanCount >= opts.maxLoginPrompts && !forced) { humanSites.set(key, { host: key.split('|')[1], reason, url, state: 'declined' }); return false; }
      humanCount++;
      humanPromise = doHuman(url, reason, detected)
        .then((ok) => { humanSites.set(key, { host: key.split('|')[1], reason, url, state: ok ? 'signed-in' : 'declined' }); return ok; })
        .catch((e) => { windowsBroken = true; self._humanDecide = null; humanSites.set(key, { host: key.split('|')[1], reason, url, state: 'unavailable' }); log('Could not open a sign-in window (' + e.message.split('\n')[0] + '). Carrying on without.'); self.emit('human', { state: 'done', ok: false }); if (!self._stop) self._setStatus('running'); return false; })
        .finally(() => { humanPromise = null; self.emit('stats', self._snapshot()); });
      return humanPromise;
    }
    // "Sign in now" from the dashboard: ask again for one site, on request, and retry its pages.
    self.retrySignIn = (host) => {
      let n = 0;
      for (const [key, v] of [...humanSites]) if (v.host === host && v.state !== 'signed-in') humanSites.delete(key);
      for (let i = gated.length - 1; i >= 0; i--) if (gated[i].key.split('|')[1] === host) { const g = gated.splice(i, 1)[0]; queue.unshift({ url: g.url, depth: g.depth || 1, from: g.foundOn || null }); n++; }
      if (!n) { const v = [...humanSites.values()].find((x) => x.host === host); if (v) queue.unshift({ url: v.url, depth: 1, from: null }); }
      humanCount = Math.max(0, humanCount - 1); windowsBroken = false;
      return n;
    };

    // ---- saving assets & files ----
    function assetPath(href, mime) {
      const u = new URL(href);
      let dec; try { dec = decodeURIComponent(u.pathname); } catch { dec = u.pathname; }
      const p = dec.split('/').filter(Boolean).map(safeName).map((s) => s.slice(0, 80));
      if (!p.length || u.pathname.endsWith('/')) p.push('index');
      let file = p.pop();
      let ext = path.extname(file);
      if (!ext || ext.length > 6) ext = MIME_EXT[(mime || '').split(';')[0].trim()] || '';
      else file = file.slice(0, -ext.length);
      if (u.search) file += '_' + sha(u.search).slice(0, 8);
      const dir = [safeName(u.hostname), ...p].join('/');
      return (dir.length > 150 ? safeName(u.hostname) + '/_long/' + sha(dir).slice(0, 12) : dir) + '/' + file + ext;
    }
    async function saveBuffer(rootDir, rel, buf) {
      const full = path.join(rootDir, ...rel.split('/'));
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, buf); bytesSaved += buf.length;
    }
    async function saveAsset(href, buf, mime) {
      if (assetMap.has(href)) return assetMap.get(href);
      if (buf.length > opts.maxFileMb * 1048576) { assetMap.set(href, null); return null; }
      const rel = 'assets/' + assetPath(href, mime);
      assetMap.set(href, rel);
      try { await saveBuffer(dirs.assets, rel.slice(7), buf); } catch { assetMap.set(href, null); return null; }
      return rel;
    }
    // Read the text out of a saved document so it is searchable and part of the content, not just a file.
    async function readDoc(href, rel, buf, mime, foundOn) {
      if (!opts.docText) return;
      const r = await extractDocText(buf, rel, mime); if (!r) return;
      const row = { url: href, saved: rel, kind: r.kind, bytes: buf.length, words: r.words, ...r.meta, scanned: r.scanned, error: r.error, foundOn: foundOn || null };
      if (r.text.trim()) { row.text = rel + '.txt'; await fsp.writeFile(path.join(outDir, ...row.text.split('/')), r.text); bytesSaved += r.text.length; }
      docs.push(row); await fsp.appendFile(F.docs, JSON.stringify(row) + '\n');
      if (r.words) log(`  read  ${r.kind}, ${r.words} words: ${href}`);
    }
    async function download(href, kind, referer) {
      const map = kind === 'file' ? fileMap : assetMap;
      if (map.has(href)) return map.get(href);
      map.set(href, null);
      try {
        const headers = referer ? { referer } : {};
        const head = await context.request.head(href, { timeout: 15000, headers }).catch(() => null);
        const len = head && Number(head.headers()['content-length']);
        if (len && len > opts.maxFileMb * 1048576) { errors.push({ url: href, error: `skipped: ${(len / 1048576).toFixed(1)} MB is over the file size limit` }); return null; }
        const r = await context.request.get(href, { timeout: 120000, headers });
        if (!r.ok()) { if (kind === 'file') errors.push({ url: href, error: 'download HTTP ' + r.status() }); return null; }
        const buf = await r.body();
        const rel = (kind === 'file' ? 'files/' : 'assets/') + assetPath(href, r.headers()['content-type'] || '');
        await saveBuffer(kind === 'file' ? dirs.files : dirs.assets, rel.replace(/^(files|assets)\//, ''), buf);
        map.set(href, rel);
        if (kind === 'file') await readDoc(href, rel, buf, r.headers()['content-type'] || '', referer);
        return rel;
      } catch (e) { if (kind === 'file') errors.push({ url: href, error: 'download failed: ' + e.message.split('\n')[0] }); return null; }
    }

    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    turndown.use(gfm);
    turndown.remove(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'head']);
    const mask = (v) => (v == null ? v : `<hidden: ${String(v).length} chars>`);

    // ---- one page. Returns true when a page was scraped. ----
    async function scrapePage(item) {
      const t0 = Date.now(); const myEpoch = epoch;
      const net = []; const pending = []; const consoleLog = []; const sockets = []; const apiData = []; const sourceMaps = [];
      let apiCount = 0;
      const pathname = new URL(item.url).pathname;

      if (FILE_EXT.test(pathname)) {   // linked documents are downloaded, not opened
        const rel = opts.files ? await download(item.url, 'file', item.from && /^https?:/.test(item.from) ? item.from : undefined) : null;
        if (rel) log(`  file  ${item.url}`);
        return false;
      }
      const n = ++counter;
      const id = String(n).padStart(4, '0') + '-' + pageSlug(item.url);
      const dir = path.join(dirs.pages, id);
      await fsp.mkdir(dir, { recursive: true });
      const ctx = context;
      const page = await ctx.newPage();
      const abandon = async () => { await Promise.allSettled(pending); await page.close().catch(() => {}); await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); };

      page.on('console', (m) => { if (consoleLog.length < 300) consoleLog.push({ type: m.type(), text: m.text().slice(0, 2000) }); });
      page.on('pageerror', (e) => { if (consoleLog.length < 300) consoleLog.push({ type: 'pageerror', text: String(e.message).slice(0, 2000) }); });
      page.on('dialog', (d) => d.dismiss().catch(() => {}));
      page.on('popup', (p) => p.close().catch(() => {}));
      page.on('websocket', (ws) => {
        const rec = { url: ws.url(), frames: [] }; sockets.push(rec);
        const add = (dirn) => (f) => { if (rec.frames.length < 500) rec.frames.push({ dir: dirn, data: typeof f.payload === 'string' ? f.payload.slice(0, 20000) : `<binary ${f.payload.length} bytes>` }); };
        ws.on('framereceived', add('in')); ws.on('framesent', add('out'));
      });
      page.on('requestfailed', (rq) => net.push({ url: rq.url(), method: rq.method(), type: rq.resourceType(), failed: (rq.failure() || {}).errorText || 'failed' }));
      page.on('response', (res) => {
        pending.push((async () => {
          const rq = res.request(); const type = rq.resourceType(); const url = res.url();
          if (url.startsWith('data:') || url.startsWith('blob:')) return;
          const headers = res.headers(); const mime = (headers['content-type'] || '').split(';')[0].trim();
          const rec = { url, method: rq.method(), type, status: res.status(), mime, headers };
          net.push(rec);
          if (res.status() >= 300 && res.status() < 400) { rec.redirectTo = headers.location; return; }
          const isMainDoc = type === 'document' && rq.frame() === page.mainFrame() && rq.isNavigationRequest();
          const isApi = type === 'xhr' || type === 'fetch' || type === 'eventsource' || (!isMainDoc && /json|graphql/.test(mime) && type !== 'script' && type !== 'manifest');
          const isAsset = ['image', 'stylesheet', 'script', 'font', 'media', 'manifest', 'texttrack', 'other'].includes(type);
          if (!isApi && !(isAsset && opts.assets)) { const cl = Number(headers['content-length']); if (cl > 0) rec.bytes = cl; return; }   // size still counts toward page weight
          let buf; try { buf = await res.body(); } catch { return; }
          rec.bytes = buf.length;
          if (isApi) {
            // The data the site loads behind the scenes - usually the cleanest form of its content.
            const ext = /json/.test(mime) ? '.json' : MIME_EXT[mime] || '.txt';
            const file = `api/${String(++apiCount).padStart(3, '0')}${ext}`;
            rec.saved = `pages/${id}/${file}`;
            const post = rq.postData(); if (post) rec.requestBody = authenticated && /pass|token|secret/i.test(post) ? mask(post) : post.slice(0, 100000);
            await fsp.mkdir(path.join(dir, 'api'), { recursive: true });
            let out = buf;
            if (ext === '.json') { try { const parsed = JSON.parse(buf.toString('utf8')); if (apiData.length < 60 && buf.length < 4e6) apiData.push(parsed); out = Buffer.from(JSON.stringify(parsed, null, 2)); } catch { /* keep raw */ } }
            await fsp.writeFile(path.join(dir, file), out); bytesSaved += out.length;
          } else {
            rec.saved = await saveAsset(url, buf, mime);
            if (type === 'script' || type === 'stylesheet') {     // original source, when the site publishes it
              const ref = headers.sourcemap || headers['x-sourcemap'] || (buf.slice(-400).toString('utf8').match(/[#@]\s*sourceMappingURL=([^\s*]+)/) || [])[1];
              if (ref && !ref.startsWith('data:')) { const mu = normalizeUrl(ref, url); if (mu) { sourceMaps.push(mu); if (mapCount++ < 200 && !assetMap.has(mu)) await download(mu, 'asset', url).then((ok) => { if (!ok) sourceMaps.pop(); }); } }
            }
          }
        })().catch(() => {}));
      });

      let response = null, navError = null;
      try { response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: opts.timeout }); }
      catch (e) {
        navError = e.message.split('\n')[0];
        if (/Download is starting/.test(navError)) {
          await abandon();
          if (opts.files) { const rel = await download(item.url, 'file'); if (rel) log(`  file  ${item.url}`); }
          return false;
        }
      }
      const retryLater = async (why, waitMs) => {
        await abandon();
        queue.push({ ...item, tries: (item.tries || 0) + 1, notBefore: Date.now() + waitMs });
        log(`  retry ${item.url}  (${why})`);
        return false;
      };
      const gate = async (reason, atUrl) => {
        await abandon();
        const again = { ...item, gateTries: (item.gateTries || 0) + 1 };
        if (!item.gateTries && myEpoch < epoch) { queue.unshift({ ...item }); return false; }           // someone signed in while this page was loading
        const at = atUrl || item.url; const key = siteKey(at, reason);
        if (!item.gateTries) {
          const ok = await requestHuman(at, reason);
          if (ok || myEpoch < epoch) { queue.unshift(ok ? again : { ...item }); return false; }   // signed in now, or someone signed in while we waited
        }
        gated.push({ url: item.url, reason, depth: item.depth, foundOn: item.from, key, loginHost: key.split('|')[1], loginPage: at });
        log(`  ${reason === 'challenge' ? 'bot check' : 'needs sign-in'}  ${item.url}`);
        return false;
      };

      const record = { id, url: item.url, depth: item.depth, foundOn: item.from, scrapedAt: new Date().toISOString() };
      try {
        if (!response) {
          if ((item.tries || 0) < opts.retries && !self._stop) return await retryLater(navError || 'no response', 2000 * 2 ** (item.tries || 0));
          throw new Error(navError || 'no response');
        }
        const status = response.status();
        if ((status === 429 || status === 503) && (item.tries || 0) < opts.retries) {
          const ra = Number(response.headers()['retry-after']);
          delay = Math.min(10000, Math.max(1000, delay * 2));   // the site asked us to slow down
          return await retryLater('HTTP ' + status + ', slowing down', Math.min(60000, (ra > 0 ? ra * 1000 : 5000 * ((item.tries || 0) + 1))));
        }
        const mainMime = (response.headers()['content-type'] || '').split(';')[0].trim();
        const chain = []; for (let r = response.request().redirectedFrom(); r; r = r.redirectedFrom()) chain.unshift(r.url());
        Object.assign(record, { finalUrl: page.url(), status, statusText: response.statusText(), contentType: mainMime, redirectChain: chain, responseHeaders: response.headers() });
        try { const sd = await response.securityDetails(); if (sd) record.tls = sd; } catch { /* n/a */ }
        try { const addr = await response.serverAddr(); if (addr) record.serverAddress = addr; } catch { /* n/a */ }

        const finalNorm = normalizeUrl(page.url());
        const moved = finalNorm && urlKey(finalNorm) !== urlKey(item.url);
        if (status === 401 || (moved && loginLike(finalNorm) && !loginLike(item.url))) return await gate('login', page.url());
        if (n === 1 && finalNorm) allowedHosts.add(stripWww(new URL(finalNorm).hostname.toLowerCase())); // follow the start URL's redirect
        if (moved) {
          if (seen.has(urlKey(finalNorm))) {     // forwards to a page we already have or will get
            redirects.push({ from: item.url, to: finalNorm, foundOn: item.from });
            await abandon(); log(`  redirect  ${item.url} -> ${finalNorm}`);
            return false;
          }
          seen.add(urlKey(finalNorm));
        }

        let raw = null; try { raw = await response.body(); } catch { /* body gone */ }
        if (mainMime && !/html|xml/.test(mainMime) && raw) {
          // Not a web page (JSON, text, an image opened directly...). Save it as-is.
          const rel = 'files/' + assetPath(item.url, mainMime);
          await saveBuffer(dirs.files, rel.slice(6), raw);
          fileMap.set(item.url, rel); record.savedAs = rel; record.kind = 'file';
          await readDoc(item.url, rel, raw, mainMime, item.from);
          if (/json|text/.test(mainMime)) record.body = raw.toString('utf8').slice(0, 2_000_000);
        } else {
          if (raw) { await fsp.writeFile(path.join(dir, 'raw.html'), raw); bytesSaved += raw.length; record.htmlBytes = raw.length; }
          await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
          if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 15000 }).catch(() => {});

          const probe = await page.evaluate(gateProbe).catch(() => null);
          if (probe && probe.challenge) return await gate('challenge', page.url());
          if (probe && probe.loginWall && (!loginLike(item.url) || (n === 1 && !authenticated))) return await gate('login', page.url());

          // Scroll through the page so lazy-loaded images and endless lists appear.
          await page.evaluate(async (maxMs) => {
            const t = Date.now(); let last = -1, stable = 0;
            while (Date.now() - t < maxMs) {
              window.scrollBy(0, Math.max(300, window.innerHeight * 0.9));
              await new Promise((r) => setTimeout(r, 250));
              const h = document.documentElement.scrollHeight;
              if (window.scrollY + window.innerHeight >= h - 2) { if (h === last) { if (++stable >= 3) break; } else { stable = 0; last = h; } }
            }
            for (const d of document.querySelectorAll('details:not([open])')) d.open = true;
            window.scrollTo(0, 0);
          }, opts.scrollMs).catch(() => {});

          if (opts.click) {
            for (let i = 0; i < opts.maxClicks; i++) {
              const btn = page.locator(opts.click).first();
              if (!(await btn.isVisible().catch(() => false))) break;
              const beforeUrl = page.url();
              await btn.click({ timeout: 5000 }).catch(() => {});
              await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
              await sleep(400);
              if (page.url() !== beforeUrl) { await page.goBack().catch(() => {}); break; }   // it was a link, not a "load more"
            }
          }
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          if (opts.wait) await sleep(opts.wait);

          // Click through tabs, accordions, "show more" and "next" so content that only loads on demand is captured.
          const interactions = [];
          if (opts.interact) {
            const readLines = () => page.evaluate(() => ((document.body && document.body.innerText) || '').split('\n').map((x) => x.trim()).filter(Boolean)).catch(() => []);
            const seenLines = new Set(await readLines()); const clicked = new Map(); const home = page.url().split('#')[0]; const tEnd = Date.now() + 45000;
            for (let k = 0; k < opts.maxInteractions && Date.now() < tEnd && !self._stop; ) {
              const cands = await page.evaluate(findClickables).catch(() => []);
              const next = cands.find((c) => (clicked.get(c.key) || 0) < (c.repeat ? 25 : 1));
              if (!next) break;
              clicked.set(next.key, (clicked.get(next.key) || 0) + 1); k++;
              try { await page.locator(`[data-ds-click="${next.id}"]`).first().click({ timeout: 2500, noWaitAfter: true }); } catch { continue; }
              await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); await sleep(250);
              if (page.url().split('#')[0] !== home) {        // it navigated: queue where it went and come back
                enqueue(page.url(), item.depth + 1, home); clicked.set(next.key, 99);
                await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                continue;
              }
              const fresh = (await readLines()).filter((l) => !seenLines.has(l)); fresh.forEach((l) => seenLines.add(l));
              if (fresh.length) interactions.push({ clicked: next.label, kind: next.kind, newText: fresh.join('\n') });
              else if (next.repeat) clicked.set(next.key, 99);
            }
          }

          const data = await page.evaluate(extractInPage);
          delete data.url;
          const canvases = data._canvases || []; delete data._canvases; data.canvases = [];
          for (let ci = 0; ci < canvases.length; ci++) { try { const f = `canvas-${ci + 1}.png`; await fsp.writeFile(path.join(dir, f), Buffer.from(canvases[ci].split(',')[1], 'base64')); data.canvases.push(`pages/${id}/${f}`); } catch { /* skip */ } }
          const composed = data._composedHtml; delete data._composedHtml;
          const rendered = await page.content();
          let markdown = '';
          try { markdown = turndown.turndown('<body>' + composed.replace(/^<body[^>]*>|<\/body>$/g, '') + '</body>').replace(/\n{3,}/g, '\n\n').trim(); } catch { markdown = data.text.visible; }

          const frames = [];
          for (const f of page.frames()) {
            if (f === page.mainFrame() || !f.url() || f.url() === 'about:blank') continue;
            try {
              const html = await f.content();
              const text = await f.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
              const file = `frames/${String(frames.length + 1).padStart(2, '0')}.html`;
              await fsp.mkdir(path.join(dir, 'frames'), { recursive: true });
              await fsp.writeFile(path.join(dir, file), html);
              frames.push({ url: f.url(), name: f.name() || null, saved: `pages/${id}/${file}`, text });
            } catch { /* frame went away */ }
          }

          if (opts.screenshots) {
            try { await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true, timeout: 30000 }); record.screenshot = `pages/${id}/screenshot.png`; }
            catch { try { await page.screenshot({ path: path.join(dir, 'screenshot.png'), timeout: 15000 }); record.screenshot = `pages/${id}/screenshot.png`; } catch { /* no screenshot */ } }
          }
          if (opts.screenshots && opts.mobileScreenshots) {
            try { await page.setViewportSize({ width: 390, height: 844 }); await sleep(400); await page.screenshot({ path: path.join(dir, 'screenshot-mobile.png'), fullPage: true, timeout: 20000 }); record.screenshotMobile = `pages/${id}/screenshot-mobile.png`; data.design.layout.horizontalScrollOnPhone = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
              data.accessibility.smallTouchTargets = await page.evaluate(() => [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && getComputedStyle(el).display !== 'inline'; }).length); } catch { /* skip */ }
            await page.setViewportSize({ width: vw || 1366, height: vh || 900 }).catch(() => {});
          }
          try { const tree = await page.locator('body').ariaSnapshot({ timeout: 6000 }); await fsp.writeFile(path.join(dir, 'accessibility-tree.yaml'), tree); record.accessibilityTree = `pages/${id}/accessibility-tree.yaml`; } catch { /* unsupported */ }
          if (opts.mhtml) {
            try { const cdp = await ctx.newCDPSession(page); const { data: mh } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' }); await fsp.writeFile(path.join(dir, 'page.mhtml'), mh); await cdp.detach(); } catch { /* unsupported */ }
          }
          let cookies = await ctx.cookies(page.url()).catch(() => []);
          await Promise.allSettled(pending);

          // Fetch anything referenced on the page that the browser did not load itself
          // (other srcset sizes, lazy sources, posters, icons, background images).
          if (opts.assets) {
            const want = new Set();
            for (const im of data.images) for (const u of [im.src, im.declaredSrc, im.lazySrc, ...(im.srcset || [])]) if (u) want.add(u);
            for (const u of data.backgroundImages) want.add(u);
            for (const u of data.icons) if (u) want.add(u);
            for (const m of data.media) { if (m.poster) want.add(m.poster); for (const t of m.tracks) if (t.src) want.add(t.src); for (const s of [{ src: m.src }, ...m.sources]) if (s.src) want.add(s.src); }
            for (const k of ['og:image', 'twitter:image']) for (const u of [].concat(data.meta.byName[k] || [])) { const a = normalizeUrl(u, page.url()); if (a) want.add(a); }
            const todo = [...want].filter((u) => /^https?:/.test(u) && !assetMap.has(u)).slice(0, 400);
            for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map((u) => download(u, 'asset', page.url())));
          }
          const local = (u) => (u && assetMap.get(u)) || undefined;
          for (const im of data.images) im.saved = local(im.src) || local(im.declaredSrc) || local(im.lazySrc);
          const imageText = [];
          if (opts.ocr) {
            for (const im of data.images) {
              if (ocrCount >= opts.ocrMax || !im.saved || !(im.width >= 120 && im.height >= 40) || !/\.(png|jpe?g|webp|bmp)$/i.test(im.saved)) continue;
              ocrCount++;
              const r = await ocrImage(path.join(outDir, ...im.saved.split('/')));
              if (r) { im.textInImage = r.text; imageText.push({ src: im.src, text: r.text }); }
            }
          }

          // Queue the links we found.
          const base = page.url(); let queued = 0; const internalKeys = [];
          const linkTargets = [...data.links.map((l) => l.href), ...data.iframes.map((f) => f.src), data.pagination.next, data.pagination.prev, data.canonical, ...data.alternates.filter((a) => /html|^$/.test(a.type || '')).map((a) => a.href)];
          for (const href of linkTargets) { if (href && /^https?:/.test(href) && enqueue(href, item.depth + 1, base)) queued++; }
          if (n === 1 && opts.searchTerms) {      // look the given words up through the site's own search (GET search forms only)
            const terms = (Array.isArray(opts.searchTerms) ? opts.searchTerms : String(opts.searchTerms).split(/[,\n]+/)).map((t) => t.trim()).filter(Boolean).slice(0, 50);
            const sf = data.forms.find((f) => f.method === 'get' && f.fields.some((x) => x.type === 'search' || /^(q|s|search|query|keyword|keywords|term|k)$/i.test(x.name || '')));
            const field = sf && sf.fields.find((x) => x.type === 'search' || /^(q|s|search|query|keyword|keywords|term|k)$/i.test(x.name || ''));
            let made = 0;
            for (const t of terms) {
              let u2 = null;
              if (sf && field && field.name) { try { u2 = new URL(sf.action); for (const x of sf.fields) if (x.type === 'hidden' && x.name && x.value) u2.searchParams.set(x.name, x.value); u2.searchParams.set(field.name, t); } catch { u2 = null; } }
              else if ((data.technologies || []).some((x) => /wordpress/i.test(x))) { u2 = new URL('/', base); u2.searchParams.set('s', t); }
              if (u2 && enqueue(u2.href, 1, base)) made++;
            }
            record.searchesQueued = made; log(made ? `  searching the site for ${made} of your words` : '  no search box that can be used by address was found on the start page');
          }
          let fromData = 0;
          if (opts.discoverFromData) {
            const found = new Set();
            for (const d of [...apiData, data.structuredData.appState, data.structuredData.jsonScripts.map((x) => x.data), data.structuredData.jsonLd]) harvestUrls(d, found);
            for (const u of found) {
              if (fromData >= 500) break;
              const abs = normalizeUrl(u, base); if (!abs) continue;
              if (ASSET_EXT.test(new URL(abs).pathname)) { if (opts.assets && inScope(abs) && !assetMap.has(abs)) download(abs, 'asset', base).catch(() => {}); continue; }
              if (/\/api\/|graphql/i.test(abs)) continue;     // data endpoints are captured when pages call them
              if (enqueue(abs, item.depth + 1, base)) { fromData++; queued++; }
            }
          }
          let linkLines = '';
          for (const l of data.links) {
            if (l.internal === false && l.href) discovered.externalLinks.add(l.href);
            if (l.internal && l.href && /^https?:/.test(l.href)) { const nn = normalizeUrl(l.href); if (nn) internalKeys.push(urlKey(nn)); }
            const row = [base, l.href, l.text, l.internal === null ? '' : l.internal ? 'internal' : 'external', l.rel || ''];
            allLinks.push(row); linkLines += JSON.stringify({ page: id, from: base, href: l.href, text: l.text, scope: row[3], rel: row[4] }) + '\n';
          }
          linkGraph.set(item.url, internalKeys);
          data.contacts.emails.forEach((e) => discovered.emails.add(e));
          data.contacts.phones.forEach((e) => discovered.phones.add(e));
          data.contacts.socials.forEach((e) => discovered.socials.add(e));
          const h = record.responseHeaders || {};
          const headerTech = [h.server && 'Server: ' + h.server, h['x-powered-by'] && 'Powered by: ' + h['x-powered-by'], h['cf-ray'] && 'Cloudflare', h['x-vercel-id'] && 'Vercel', h['x-nf-request-id'] && 'Netlify', h['x-shopid'] && 'Shopify', h['x-amz-cf-id'] && 'Amazon CloudFront', h['x-github-request-id'] && 'GitHub Pages'].filter(Boolean);
          data.technologies = [...new Set([...data.technologies, ...headerTech])];
          for (const t of data.technologies) discovered.tech.set(t, (discovered.tech.get(t) || 0) + 1);

          // Readings for the other perspectives: security, speed, privacy.
          const pageHost = stripWww(new URL(page.url()).hostname); const weight = { total: record.htmlBytes || 0, requests: net.length, byType: { document: record.htmlBytes || 0 } }; const tp = new Map();
          for (const r of net) {
            if (r.bytes) { weight.total += r.bytes; weight.byType[r.type] = (weight.byType[r.type] || 0) + r.bytes; }
            let hst; try { hst = stripWww(new URL(r.url).hostname); } catch { continue; }
            if (hst !== pageHost && !hst.endsWith('.' + pageHost)) { const e = tp.get(hst) || tp.set(hst, { host: hst, service: (TRACKERS.find(([re]) => re.test(r.url)) || [])[1], requests: 0, kinds: [] }).get(hst); e.requests++; if (!e.kinds.includes(r.type)) e.kinds.push(r.type); }
          }
          record.sourceMaps = [...new Set(sourceMaps)];
          { // signals that need the response, the raw HTML or the phone-width pass
            const rh = record.responseHeaders || {}; const sg = data.signals;
            const rawWords = raw ? (raw.toString('utf8').replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').match(/[A-Za-z0-9\u00c0-\uffff]{2,}/g) || []).length : 0;
            const shown = (data.text.visible.match(/[A-Za-z0-9\u00c0-\uffff]{2,}/g) || []).length;
            Object.assign(sg, {
              textWithoutJavascript: shown > 10 ? Math.max(1, Math.min(100, Math.round((rawWords / shown) * 100))) : null, clientRendered: shown > 30 && rawWords < shown * 0.3,
              readingEase: readingEase(data.text.visible), compression: rh['content-encoding'] || null, cacheControl: rh['cache-control'] || null, etag: !!rh.etag, lastModifiedHeader: rh['last-modified'] || null, serverTiming: !!rh['server-timing'],
              cdn: rh['cf-ray'] ? 'Cloudflare' : rh['x-amz-cf-id'] ? 'Amazon CloudFront' : rh['x-vercel-id'] ? 'Vercel' : rh['x-nf-request-id'] ? 'Netlify' : /fastly/i.test(rh['x-served-by'] || rh.via || '') ? 'Fastly' : rh['x-akamai-transformed'] || /akamai/i.test(rh.server || '') ? 'Akamai' : rh['x-azure-ref'] ? 'Azure Front Door' : /bunny/i.test(rh.server || '') ? 'bunny.net' : rh['x-cache'] ? 'a caching layer (x-cache)' : null,
              http3Offered: /h3/.test(rh['alt-svc'] || ''), timeToFirstByteMs: data.performance ? data.performance.ttfbMs : null, longTasks: data.vitals ? data.vitals.longTasks : null, redirectHops: chain.length,
              skipLinkPages: data.accessibility.skipLink, smallTouchTargets: data.accessibility.smallTouchTargets || 0, charset: data.charset, viewportMeta: data.design.layout.viewportMeta, horizontalScrollOnPhone: !!data.design.layout.horizontalScrollOnPhone,
              'layout.cssRules': data.design.layout.cssRules, 'layout.flexContainers': data.design.layout.flexContainers, 'layout.gridContainers': data.design.layout.gridContainers,
              serviceWorker: data.security.serviceWorker, manifest: data.manifest, fileUploads: data.security.fileUploads, commentsInCode: data.security.commentsInCode, webSockets: sockets.length, formsSendingToOtherSites: data.security.formsSendingToOtherSites,
            });
          }
          record.audit = {
            securityFindings: pageSecurity({ ...record, ...data }, net, cookies), weight, thirdParties: [...tp.values()],
            cookies: cookies.map((c) => ({ name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, lastsDays: c.expires > 0 ? Math.round((c.expires * 1000 - Date.now()) / 864e5) : 0, fromAnotherSite: !stripWww(c.domain.replace(/^\./, '')).endsWith(pageHost) })),
          };

          if (authenticated) {   // never write live session secrets into the results
            cookies = cookies.map((c) => ({ ...c, value: mask(c.value) }));
            for (const k of ['localStorage', 'sessionStorage']) for (const key of Object.keys(data.storage[k])) data.storage[k][key] = mask(data.storage[k][key]);
          }
          Object.assign(record, data, {
            markdown, frames, cookies, console: consoleLog, webSockets: sockets, contentHash: sha(data.text.visible),
            network: { requests: net.length, apiResponses: apiCount, log: `pages/${id}/network.json` },
            files: { raw: raw ? `pages/${id}/raw.html` : null, rendered: `pages/${id}/rendered.html`, markdown: `pages/${id}/content.md`, text: `pages/${id}/text.txt` },
            linksQueued: queued, linksFromData: fromData, interactions, imageText,
          });
          let extra = '';
          for (const it of interactions) extra += `\n\n## Revealed by clicking "${it.clicked}"\n\n${it.newText}`;
          if (imageText.length) extra += '\n\n## Text inside images\n\n' + imageText.map((t) => `${t.text}\n(${t.src})`).join('\n\n');
          const gen = (data.hiddenText.generated || []).join('\n');
          if (extra) { markdown += extra; record.markdown = markdown; }
          data.text.all += extra.replace(/^## /gm, '') + (data.hiddenText.attributes.length ? '\n\n[Labels and tooltips]\n' + data.hiddenText.attributes.join('\n') : '') + (gen ? '\n\n[Text drawn by styles]\n' + gen : '');
          let imgLines = '';
          for (const im of data.images) if (im.src) imgLines += JSON.stringify({ page: id, pageUrl: base, src: im.src, alt: im.alt, width: im.width, height: im.height, saved: im.saved, textInImage: im.textInImage }) + '\n';
          await Promise.all([
            fsp.writeFile(path.join(dir, 'rendered.html'), rendered),
            fsp.writeFile(path.join(dir, 'content.md'), `# ${data.title || item.url}\n\nSource: ${base}\n\n${markdown}\n`),
            fsp.writeFile(path.join(dir, 'text.txt'), data.text.all),
            linkLines && fsp.appendFile(F.links, linkLines), imgLines && fsp.appendFile(F.images, imgLines),
          ]);
          bytesSaved += rendered.length + markdown.length + data.text.all.length;
        }
        await Promise.allSettled(pending);
        await writeJson(path.join(dir, 'network.json'), net);
        const apiLines = net.filter((r) => r.saved && r.saved.includes('/api/')).map((r) => JSON.stringify({ page: id, pageUrl: item.url, url: r.url, method: r.method, status: r.status, mime: r.mime, bytes: r.bytes, saved: r.saved }) + '\n').join('');
        if (apiLines) await fsp.appendFile(F.api, apiLines);
        apiTotal += apiCount;
      } catch (e) {
        record.error = e.message.split('\n')[0];
      } finally {
        await page.close().catch(() => {});
      }
      record.durationMs = Date.now() - t0;
      await writeJson(path.join(dir, 'page.json'), record);
      const { markdown: _md, ...lean } = record;
      await fsp.appendFile(F.jsonl, JSON.stringify(lean) + '\n');
      audit.add(lean);
      const row = {
        id, url: item.url, finalUrl: record.finalUrl, status: record.status, title: record.title, description: record.description, depth: item.depth,
        words: record.wordCount, links: record.links ? record.links.length : 0, images: record.images ? record.images.length : 0, tables: record.tables ? record.tables.length : 0,
        forms: record.forms ? record.forms.length : 0, apiResponses: apiCount, revealed: record.interactions ? record.interactions.length : 0, durationMs: record.durationMs, htmlBytes: record.htmlBytes, contentType: record.contentType,
        h1: record.h1Count, noAlt: record.imagesMissingAlt, hash: record.contentHash, noindex: /noindex/i.test(String(record.robotsMeta || '')) || undefined,
        consoleErrors: consoleLog.filter((c) => c.type === 'error' || c.type === 'pageerror').length || undefined,
        risks: record.audit ? record.audit.securityFindings.filter((x) => x.severity === 'high' || x.severity === 'medium').length : undefined,
        screenshot: !!record.screenshot, kind: record.kind, foundOn: item.from, error: record.error,
      };
      pagesIndex.push(row);
      self.emit('page', row);
      log(`[${String(pagesIndex.length).padStart(4)}] ${record.error ? 'ERR ' : record.status}  ${item.url}${record.error ? '  - ' + record.error : ''}  (${queue.length} queued)`);
      if (pagesIndex.length % 10 === 0) await saveState();
      return true;
    }

    // ---- worker pool ----
    let active = 0, started = pagesIndex.length;
    async function worker() {
      while (!self._stop) {
        if (self._paused || humanPromise) { await sleep(200); continue; }
        if (started >= opts.maxPages) break;
        const item = queue.shift();
        if (!item) { if (active === 0) break; await sleep(150); continue; }
        if (item.notBefore && item.notBefore > Date.now()) { queue.push(item); await sleep(250); continue; }
        active++; started++; activeUrls.add(item.url);
        try { if (!(await scrapePage(item))) started--; }
        catch (e) { started--; errors.push({ url: item.url, error: e.message.split('\n')[0] }); }
        finally { active--; activeUrls.delete(item.url); }
        await sleep(delay);
      }
    }

    let summary;
    try {
      log(`Scraping ${startUrl}`); log(`Output: ${outDir}`);
      if (opts.lensFamilies) log(`Lens families: ${lensLib.families().filter((f) => opts.lensFamilies.includes(f.id)).map((f) => f.name).join(', ')}.${this.skipped.length ? ' Not needed for these, so skipped: ' + this.skipped.join(', ') + '.' : ''}`);
      if (this._replay && fs.existsSync(F.jsonl)) {   // rebuild the site-wide readings from pages scraped before the pause
        const rl = require('readline').createInterface({ input: fs.createReadStream(F.jsonl), crlfDelay: Infinity });
        for await (const line of rl) { try { audit.add(JSON.parse(line)); } catch { /* partial line */ } }
      }
      if (opts.loginFirst && opts.interactive) await requestHuman(startUrl, 'login', false, true);
      if (!self._stop) self._setStatus('running');
      await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
      await saveState();
      self._setStatus('finishing');

      // ---- site-level outputs ----
      pagesIndex.sort((a, b) => a.id.localeCompare(b.id));
      let pagesCsv = csvRow(['id', 'url', 'final_url', 'status', 'title', 'description', 'depth', 'words', 'links', 'images', 'tables', 'forms', 'api_responses', 'load_ms', 'error']);
      for (const p of pagesIndex) pagesCsv += csvRow([p.id, p.url, p.finalUrl, p.status, p.title, p.description, p.depth, p.words, p.links, p.images, p.tables, p.forms, p.apiResponses, p.durationMs, p.error]);
      await fsp.writeFile(path.join(outDir, 'pages.csv'), '﻿' + pagesCsv);
      if (allLinks.length) await fsp.writeFile(path.join(outDir, 'links.csv'), '﻿' + csvRow(['found_on', 'href', 'text', 'scope', 'rel']) + allLinks.map(csvRow).join(''));

      const md = fs.createWriteStream(path.join(outDir, 'all-content.md'));
      md.write(`# ${start.hostname} - full site content\n\nScraped ${new Date().toISOString()} - ${pagesIndex.length} pages\n`);
      for (const p of pagesIndex) {
        const f = path.join(dirs.pages, p.id, 'content.md');
        if (fs.existsSync(f)) md.write('\n\n---\n\n' + (await fsp.readFile(f, 'utf8')));
      }
      for (const d of docs) {
        if (!d.text) continue;
        const t = await fsp.readFile(path.join(outDir, ...d.text.split('/')), 'utf8').catch(() => '');
        md.write(`\n\n---\n\n# Document (${d.kind}): ${d.url}\n\n${t.length > 600000 ? t.slice(0, 600000) + `\n\n[cut here; full text in ${d.text}]` : t}`);
      }
      await new Promise((r) => md.end(r));

      // ---- quality checks ----
      const statusByKey = new Map();
      for (const p of pagesIndex) { statusByKey.set(urlKey(p.url), p.status); if (p.finalUrl) { const f = normalizeUrl(p.finalUrl); if (f) statusByKey.set(urlKey(f), p.status); } }
      const broken = [];
      for (const [from, keys] of linkGraph) for (const k of new Set(keys)) { const st = statusByKey.get(k); if (st >= 400) broken.push({ from, to: k, status: st }); }
      const html = pagesIndex.filter((p) => !p.error && p.kind !== 'file' && p.status < 400);
      const dup = (field) => { const m = new Map(); for (const p of html) if (p[field]) (m.get(p[field]) || m.set(p[field], []).get(p[field])).push(p.url); return [...m].filter(([, v]) => v.length > 1).map(([k, v]) => ({ value: field === 'hash' ? undefined : k, pages: v })); };
      const list = (f) => html.filter(f).map((p) => p.url);
      const issues = {
        brokenInternalLinks: broken, errorPages: pagesIndex.filter((p) => p.status >= 400).map((p) => ({ url: p.url, status: p.status, foundOn: p.foundOn })),
        failedToLoad: pagesIndex.filter((p) => p.error).map((p) => ({ url: p.url, error: p.error })),
        missingTitle: list((p) => !p.title), missingDescription: list((p) => !p.description), missingH1: list((p) => p.h1 === 0), multipleH1: list((p) => p.h1 > 1),
        duplicateTitles: dup('title'), duplicateContent: dup('hash'),
        imagesWithoutAlt: html.filter((p) => p.noAlt > 0).map((p) => ({ url: p.url, count: p.noAlt })),
        thinContent: list((p) => p.words < 50), slowPages: html.filter((p) => p.durationMs > 15000).map((p) => ({ url: p.url, seconds: Math.round(p.durationMs / 1000) })),
        documentsWithoutText: docs.filter((d) => d.scanned || d.error || (d.kind === 'PDF' && !d.words)).map((d) => ({ url: d.url, error: d.error || 'looks like a scan: pages are pictures, no text layer' })),
        javascriptErrors: html.filter((p) => p.consoleErrors).map((p) => ({ url: p.url, count: p.consoleErrors })), noindexPages: list((p) => p.noindex),
      };

      const savedAssets = Object.fromEntries([...assetMap].filter(([, v]) => v));
      const savedFiles = Object.fromEntries([...fileMap].filter(([, v]) => v));
      await writeJson(path.join(outDir, 'assets.json'), { assets: savedAssets, files: savedFiles });
      const complete = queue.length === 0 && !self._stop;
      summary = {
        tool: 'DeepScrape 2.0.0', startUrl, finishedAt: new Date().toISOString(), durationSeconds: Math.round((Date.now() - tStart) / 1000), complete,
        stats: { pages: pagesIndex.length, pagesWithErrors: pagesIndex.filter((p) => p.error).length, stillQueued: queue.length, assetsSaved: Object.keys(savedAssets).length, filesDownloaded: Object.keys(savedFiles).length, apiResponsesCaptured: pagesIndex.reduce((s, p) => s + (p.apiResponses || 0), 0), documentsRead: docs.filter((d) => d.words).length, revealedByClicking: pagesIndex.reduce((s, p) => s + (p.revealed || 0), 0), imagesRead: ocrCount, linksRecorded: allLinks.length, bytesSaved, pagesNeedingSignIn: gated.length },
        options: { ...opts, loginDriver: undefined, state: opts.state ? '(saved sign-in used)' : null, include: opts.include && String(opts.include), exclude: opts.exclude && String(opts.exclude), maxPages: isFinite(opts.maxPages) ? opts.maxPages : 'unlimited', maxDepth: isFinite(opts.maxDepth) ? opts.maxDepth : 'unlimited' },
        signedIn: authenticated,
        robots: { found: !!robotsTxt, obeyed: opts.robots, crawlDelay: robots.crawlDelay, blockedUrls: skipped.robots, disallowedPaths: robots.disallowed },
        sitemaps: { read: sitemapsRead, urlsListed: sitemapUrls.length },
        skipped: { outOfScopeLinks: skipped.outOfScope, stateChangingLinks: skipped.dangerous, trapLikeUrls: skipped.trap },
        needSignIn: gated, signIns: signInList(), redirects, documents: docs, wellKnown,
        technologies: [...discovered.tech].sort((a, b) => b[1] - a[1]).map(([name, pages]) => ({ name, pages })),
        contacts: { emails: [...discovered.emails], phones: [...discovered.phones], socials: [...discovered.socials] },
        externalLinks: [...discovered.externalLinks], issues,
        pages: pagesIndex, errors,
      };
      summary.perspectives = await audit.finish({ startUrl, robots: { found: !!robotsTxt, blockedUrls: skipped.robots, disallowed: robots.disallowed }, wellKnown, sitemapCount: sitemapUrls.length, pagesIndex, emails: [...discovered.emails], docs });
      summary.stats.securityFindings = summary.perspectives.security.summary;
      await writeJson(path.join(outDir, 'site.json'), summary);
      summary.lensFamilies = opts.lensFamilies; summary.collectorsSkipped = this.skipped;
      const { model, buildReport } = require('./report');
      const lm = model(summary, {}); summary.stats.lenses = { families: lm.families.length, ...lm.totals };
      await writeJson(path.join(outDir, 'site.json'), summary);
      await fsp.writeFile(path.join(outDir, 'all-lenses.md'), (await buildReport(outDir, { format: 'md' })).buffer);
      await writeJson(path.join(outDir, 'perspectives.json'), summary.perspectives);
      await fsp.writeFile(path.join(outDir, 'report.md'), reportMarkdown(summary));
      const s = summary.stats;
      log(`Done in ${summary.durationSeconds}s: ${s.pages} pages, ${s.assetsSaved} assets, ${s.filesDownloaded} files, ${s.apiResponsesCaptured} API responses.`);
      if (queue.length) log(`${queue.length} URLs were still queued (page limit reached or stopped). Resume to continue.`);
      if (gated.length) log(`${gated.length} pages need a sign-in or human check and were not scraped (listed in site.json).`);
      if (skipped.robots.length) log(`${skipped.robots.length} URLs skipped because robots.txt disallows them.`);
      this._setStatus(self._stop ? 'stopped' : complete ? 'done' : 'partial');
    } finally {
      clearInterval(ticker);
      this.emit('stats', this._snapshot());
      await browser.close().catch(() => {});
      if (opts.ocr) await stopOcr();
    }
    return summary;
  }
}

module.exports = { Crawl, DEFAULTS, launchBrowser, normalizeUrl, urlKey };
