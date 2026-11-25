#!/usr/bin/env node
'use strict';
/*
 * DeepScrape dashboard.   npm start   ->  http://localhost:4780
 * Runs only on this computer (bound to 127.0.0.1). Results live in ./data.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { Crawl } = require('./lib/crawler');
const lensLib = require('./lib/lenses');
const { buildReport, FORMATS, DETAIL } = require('./lib/report');
const { compare } = require('./lib/compare');
const ai = require('./lib/ai');
const exporter = require('./lib/exporter');
const exportQuery = (u) => ({ include: (u.searchParams.get('include') || '').split(',').filter(Boolean), files: (u.searchParams.get('files') || '').split(',').filter(Boolean), format: u.searchParams.get('format') || (u.searchParams.get('topic') ? undefined : 'xlsx'), topic: u.searchParams.get('topic') || undefined, section: u.searchParams.get('section') || '', contains: u.searchParams.get('contains') || '', result: u.searchParams.get('result') || '' });
const sendFile = (res, r) => { res.writeHead(200, { 'content-type': r.mime, 'content-length': r.buffer.length, 'content-disposition': `attachment; filename="${r.filename.replace(/[^\w.-]+/g, '-')}"`, 'cache-control': 'no-store' }); res.end(r.buffer); };
const famList = (q) => (q || '').split(',').map(Number).filter((n) => n > 0);

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(argVal('port', process.env.PORT || 4780));
const DATA = path.resolve(argVal('data', process.env.DEEPSCRAPE_DATA || path.join(__dirname, 'data')));
const JOBS_DIR = path.join(DATA, 'jobs');
const SESSIONS_DIR = path.join(DATA, 'sessions');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const settings = { sitesAtOnce: 2, ais: [], activeAi: null };   // ais: the owner's own AI connections, keys included, kept only in data/settings.json on this computer   // how many websites are scraped side by side
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch { /* defaults */ }
const saveSettings = () => fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
const publicAi = (c) => ({ id: c.id, name: c.name, provider: c.provider, baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey, active: c.id === settings.activeAi });
const pickAi = (id) => settings.ais.find((c) => c.id === id) || settings.ais.find((c) => c.id === settings.activeAi) || settings.ais[0] || null;
const TEST_LOGIN = process.env.DEEPSCRAPE_TEST_LOGIN === '1';   // automated tests only: a script signs in to the local test site
fs.mkdirSync(JOBS_DIR, { recursive: true }); fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'text/plain; charset=utf-8', '.mhtml': 'application/octet-stream' };
const ALLOWED_OPTS = ['maxPages', 'maxDepth', 'speed', 'selfCheck', 'concurrency', 'delay', 'retries', 'subdomains', 'pathPrefix', 'include', 'exclude', 'assets', 'screenshots', 'mhtml', 'files', 'maxFileMb', 'robots', 'sitemap', 'userAgent', 'timeout', 'wait', 'waitFor', 'click', 'maxClicks', 'insecure', 'viewport', 'loginFirst', 'interact', 'docText', 'ocr', 'discoverFromData', 'mobileScreenshots', 'lensFamilies', 'searchTerms'];
const hostOf = (u) => new URL(u).hostname.replace(/^www\./, '').toLowerCase();
const sessionFile = (host) => path.join(SESSIONS_DIR, host.replace(/[^a-z0-9.-]/gi, '_') + '.json');
const safeId = (s) => /^[A-Za-z0-9._-]+$/.test(s) && !s.includes('..');

// ───────────────────────────── jobs ─────────────────────────────
const jobs = new Map();   // id -> { meta, crawl, clients:Set, log:[], site }
const metaPath = (id) => path.join(JOBS_DIR, id, 'job.json');
const saveMeta = (job) => fsp.writeFile(metaPath(job.meta.id), JSON.stringify(job.meta, null, 2)).catch(() => {});
const isLive = (job) => !!job.crawl;

for (const id of fs.readdirSync(JOBS_DIR)) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
    if (['queued', 'starting', 'running', 'paused', 'waiting-for-you', 'finishing'].includes(meta.status)) meta.status = 'interrupted';
    jobs.set(id, { meta, crawl: null, clients: new Set(), log: [] });
  } catch { /* not a job folder */ }
}

function broadcast(job, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.clients) res.write(msg);
}
function addLog(job, line) {
  const entry = { t: Date.now(), line };
  job.log.push(entry); if (job.log.length > 800) job.log.shift();
  fs.appendFile(path.join(JOBS_DIR, job.meta.id, 'crawl.log'), new Date().toISOString() + '  ' + line + '\n', () => {});
  broadcast(job, 'log', entry);
}

function createJob(rawUrl, options = {}, batch = null) {
  let url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const u = new URL(url);   // throws on nonsense
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('That does not look like a website address.');
  const opts = {};
  for (const k of ALLOWED_OPTS) if (options[k] !== undefined && options[k] !== '' && options[k] !== null) opts[k] = options[k];
  for (const k of ['include', 'exclude']) if (opts[k]) new RegExp(opts[k]);   // validate now, not mid-crawl
  const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + hostOf(url).replace(/[^a-z0-9.-]/gi, '_').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);
  const meta = { id, url, host: hostOf(url), options: opts, useSavedSession: options.useSavedSession !== false, status: 'queued', createdAt: Date.now(), stats: { pages: 0, queued: 0 }, ...(batch ? { batch } : {}) };
  fs.mkdirSync(path.join(JOBS_DIR, id), { recursive: true });
  const job = { meta, crawl: null, clients: new Set(), log: [] };
  jobs.set(id, job); saveMeta(job); pump();
  return job;
}

function pump() {
  let running = [...jobs.values()].filter(isLive).length;
  for (const job of [...jobs.values()].sort((a, b) => a.meta.createdAt - b.meta.createdAt)) {
    if (running >= settings.sitesAtOnce) break;
    if (job.meta.status === 'queued' && !job.crawl) { startJob(job, !!job.meta.resumeNext); running++; }
  }
}

function startJob(job, resume) {
  const { meta } = job; const dir = path.join(JOBS_DIR, meta.id);
  const sf = sessionFile(meta.host);
  if (!meta.useSavedSession && !resume && fs.existsSync(sf)) fs.rmSync(sf);
  let crawl;
  try {
    crawl = new Crawl(meta.url, {
      ...meta.options, out: dir, resume, interactive: true, state: sf,
      ...(TEST_LOGIN ? { loginDriver: async (page) => { await page.fill('input[name=user]', 'test'); await page.fill('input[name=pw]', 'test-only'); await page.click('#go'); } } : {}),
    });
  } catch (e) { meta.status = 'failed'; meta.error = e.message; saveMeta(job); return; }
  job.crawl = crawl; job.site = null; job.lensCache = null; meta.resumeNext = false; meta.startedAt = meta.startedAt || Date.now(); meta.error = undefined; meta.human = null;
  crawl.on('log', (l) => addLog(job, l));
  crawl.on('status', (s) => { meta.status = s; if (!['done', 'partial', 'stopped'].includes(s)) broadcast(job, 'status', { status: s }); saveMeta(job); });   // final states are announced once the results are readable
  crawl.on('stats', (s) => { meta.stats = s; broadcast(job, 'stats', s); });
  crawl.on('page', (row) => broadcast(job, 'page', row));
  crawl.on('human', (h) => { meta.human = h.state === 'open' ? h : null; broadcast(job, 'human', h); });
  crawl.run()
    .then((summary) => { meta.stats = { ...crawl.snapshot(), ...summary.stats }; meta.finishedAt = Date.now(); meta.durationSeconds = summary.durationSeconds; })
    .catch((e) => { meta.status = 'failed'; meta.error = e.message.split('\n')[0]; addLog(job, 'Failed: ' + meta.error); })
    .finally(async () => { job.crawl = null; meta.human = null; saveMeta(job); if (meta.status === 'done' || meta.status === 'partial') await noteChanges(job); broadcast(job, 'status', { status: meta.status, error: meta.error }); pump(); });
}

async function loadSite(job) {
  if (job.crawl) return null;
  if (!job.site) { try { job.site = JSON.parse(await fsp.readFile(path.join(JOBS_DIR, job.meta.id, 'site.json'), 'utf8')); } catch { return null; } }
  return job.site;
}
async function pagesOf(job) {
  if (job.crawl) return job.crawl.pagesIndex;
  const site = await loadSite(job);
  if (site) return site.pages;
  try { return JSON.parse(await fsp.readFile(path.join(JOBS_DIR, job.meta.id, 'crawl-state.json'), 'utf8')).pagesIndex; } catch { return []; }
}
async function readJsonl(file, filter, limit = 3000) {
  const rows = []; let total = 0;
  if (!fs.existsSync(file)) return { rows, total };
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    if (filter && !line.toLowerCase().includes(filter)) continue;
    total++;
    if (rows.length < limit) { try { rows.push(JSON.parse(line)); } catch { /* partial line while writing */ } }
  }
  return { rows, total };
}
async function listFiles(dir, base = '') {
  const out = [];
  let entries; try { entries = await fsp.readdir(path.join(dir, base), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...await listFiles(dir, rel));
    else { const st = await fsp.stat(path.join(dir, rel)); out.push({ path: rel, bytes: st.size }); }
    if (out.length > 5000) break;
  }
  return out;
}

// ───────────────────────────── repeating scrapes ─────────────────────────────
// Run while the app is open. Each run is compared with the one before it.
const SCHED_FILE = path.join(DATA, 'schedules.json');
let schedules = []; try { schedules = JSON.parse(fs.readFileSync(SCHED_FILE, 'utf8')); } catch { /* none yet */ }
const saveSchedules = () => fsp.writeFile(SCHED_FILE, JSON.stringify(schedules, null, 2)).catch(() => {});
function nextRun(s, from = Date.now()) {
  const [hh, mm] = String(s.at || '06:00').split(':').map(Number); const d = new Date(from); d.setSeconds(0, 0); d.setHours(hh || 0, mm || 0);
  if (s.every === 'hours') return from + Math.max(1, Number(s.hours) || 6) * 3600000;
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  if (s.every === 'week') while (d.getDay() !== (Number(s.weekday) || 1)) d.setDate(d.getDate() + 1);
  if (s.every === 'month') { d.setDate(Math.min(28, Number(s.day) || 1)); if (d.getTime() <= from) d.setMonth(d.getMonth() + 1); }
  return d.getTime();
}
function runSchedule(s) {
  try { const job = createJob(s.url, { ...s.options }, null); job.meta.scheduleId = s.id; saveMeta(job); s.lastRun = Date.now(); s.lastJobId = job.meta.id; s.lastError = undefined; } catch (e) { s.lastError = e.message; }
  s.next = nextRun(s); saveSchedules();
}
setInterval(() => { for (const s of schedules) if (s.enabled !== false && s.next && Date.now() >= s.next) runSchedule(s); }, 30000).unref();
async function noteChanges(job) {     // after any scrape: what changed since the last finished scrape of the same address
  try {
    const prev = [...jobs.values()].filter((j) => j !== job && j.meta.url === job.meta.url && !j.crawl && ['done', 'partial'].includes(j.meta.status) && (j.meta.finishedAt || 0) < (job.meta.finishedAt || Date.now())).sort((a, b) => b.meta.finishedAt - a.meta.finishedAt)[0];
    if (!prev) return;
    const a = await loadSite(prev), b = await loadSite(job); if (!a || !b) return;
    const c = compare(a, b); job.meta.changes = { since: prev.meta.id, headline: c.headline, anything: c.anything }; saveMeta(job);
  } catch { /* comparison is a nicety */ }
}

// ───────────────────────────── http ─────────────────────────────
const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 1e6) reject(new Error('too large')); }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); });
const publicJob = (job) => ({ ...job.meta, live: isLive(job) });

const server = http.createServer(async (req, res) => {
  try {
    // Only this computer may talk to the dashboard (blocks other websites from poking it).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'local only' });
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return send(res, 403, { error: 'cross-site request refused' });
    }
    const u = new URL(req.url, 'http://localhost'); const p = u.pathname; let m;

    if (p === '/' || p === '/index.html') return send(res, 200, await fsp.readFile(path.join(__dirname, 'public', 'index.html')), { 'content-type': 'text/html; charset=utf-8' });

    if (p === '/api/jobs' && req.method === 'GET') return send(res, 200, [...jobs.values()].map(publicJob).sort((a, b) => b.createdAt - a.createdAt));
    if (p === '/api/jobs' && req.method === 'POST') {
      const body = await readBody(req);
      const urls = [].concat(body.urls || body.url || []).flatMap((x) => String(x).split(/[\s,]+/)).filter(Boolean);
      if (!urls.length) return send(res, 400, { error: 'Paste a website address first.' });
      const made = []; const bad = [];
      // Several addresses at once become one batch: scraped side by side, shown and exported together.
      const seenUrl = new Set(); const list = urls.filter((x) => { const k = x.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase(); return !seenUrl.has(k) && seenUrl.add(k); }).slice(0, 500);
      const batch = list.length > 1 ? { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(body.batchName || '').slice(0, 80) || `${list.length} websites`, createdAt: Date.now() } : null;
      const sectionMode = body.mode === 'section';
      for (const x of list) {
        const opts = { ...(body.options || {}) };
        if (sectionMode) { try { opts.pathPrefix = new URL(/^https?:/i.test(x) ? x : 'https://' + x).pathname.replace(/[^/]*$/, '') || '/'; } catch { /* reported below */ } }
        try { made.push(publicJob(createJob(x, opts, batch))); } catch (e) { bad.push({ url: x, error: e.message }); }
      }
      return send(res, made.length ? 200 : 400, { jobs: made, rejected: bad, error: made.length ? undefined : (bad[0] && bad[0].error) || 'Could not start.' });
    }
    if (p === '/api/health') return send(res, 200, { app: 'deepscrape', version: require('./package.json').version, running: [...jobs.values()].filter(isLive).length, data: DATA });
    if (p === '/api/export-options') return send(res, 200, exporter.options());
    if (p === '/api/lenses') return send(res, 200, { families: lensLib.families(), total: lensLib.totalLenses, formats: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label })), detail: DETAIL });
    if (p === '/api/settings') {
      if (req.method === 'POST') { const b = await readBody(req); const n = Math.round(Number(b.sitesAtOnce)); if (n >= 1 && n <= 8) { settings.sitesAtOnce = n; await saveSettings(); pump(); } }
      return send(res, 200, { sitesAtOnce: settings.sitesAtOnce });
    }
    // ---- the owner's own AI connections ----
    if (p === '/api/ai' && req.method === 'GET') return send(res, 200, { providers: ai.PROVIDERS, connections: settings.ais.map(publicAi) });
    if (p === '/api/ai' && req.method === 'POST') {
      const b = await readBody(req); const prov = ai.PROVIDERS.find((x) => x.id === b.provider); if (!prov) return send(res, 400, { error: 'Choose a provider.' });
      const baseUrl = String(b.baseUrl || prov.baseUrl || '').trim(); if (!/^https?:\/\//i.test(baseUrl)) return send(res, 400, { error: 'Give the address of the AI service (starting with http).' });
      if (!String(b.model || '').trim()) return send(res, 400, { error: 'Give the model name.' });
      if (prov.needsKey && !String(b.apiKey || '').trim()) return send(res, 400, { error: 'Paste your API key for this provider.' });
      const c = { id: 'ai' + Date.now().toString(36), name: String(b.name || '').trim().slice(0, 60) || `${prov.name.split(' (')[0]} ${String(b.model).trim()}`, provider: prov.id, baseUrl, model: String(b.model).trim(), apiKey: String(b.apiKey || '').trim() };
      settings.ais.push(c); if (!settings.activeAi) settings.activeAi = c.id; await saveSettings();
      return send(res, 200, publicAi(c));
    }
    if ((m = p.match(/^\/api\/ai\/([^/]+)(?:\/(test|use))?$/))) {
      const c = settings.ais.find((x) => x.id === m[1]); if (!c) return send(res, 404, { error: 'No such AI connection.' });
      if (req.method === 'DELETE') { settings.ais = settings.ais.filter((x) => x !== c); if (settings.activeAi === c.id) settings.activeAi = (settings.ais[0] || {}).id || null; await saveSettings(); return send(res, 200, { ok: true }); }
      if (m[2] === 'use') { settings.activeAi = c.id; await saveSettings(); return send(res, 200, publicAi(c)); }
      if (m[2] === 'test') { try { const reply = await ai.testAi(c); return send(res, 200, { ok: true, reply: reply.slice(0, 80) }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
    }
    if (p === '/api/schedules' && req.method === 'GET') return send(res, 200, schedules);
    if (p === '/api/schedules' && req.method === 'POST') {
      const b = await readBody(req); let url = String(b.url || '').trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url; new URL(url);
      const opts = {}; for (const k of ALLOWED_OPTS) if (b.options && b.options[k] !== undefined && b.options[k] !== '' && b.options[k] !== null) opts[k] = b.options[k];
      const s = { id: 's' + Date.now().toString(36), url, host: hostOf(url), options: opts, every: ['day', 'week', 'month', 'hours'].includes(b.every) ? b.every : 'week', at: /^\d{1,2}:\d{2}$/.test(b.at || '') ? b.at : '06:00', weekday: Number(b.weekday) || 1, day: Number(b.day) || 1, hours: Number(b.hours) || 6, enabled: true, createdAt: Date.now() };
      s.next = nextRun(s); schedules.push(s); saveSchedules(); return send(res, 200, s);
    }
    if ((m = p.match(/^\/api\/schedules\/([^/]+)(?:\/(run))?$/))) {
      const s = schedules.find((x) => x.id === m[1]); if (!s) return send(res, 404, { error: 'No such repeating scrape.' });
      if (req.method === 'DELETE') { schedules = schedules.filter((x) => x !== s); saveSchedules(); return send(res, 200, { ok: true }); }
      if (req.method === 'POST' && m[2] === 'run') { runSchedule(s); return send(res, 200, s); }
      if (req.method === 'POST') { const b = await readBody(req); if (typeof b.enabled === 'boolean') s.enabled = b.enabled; s.next = nextRun(s); saveSchedules(); return send(res, 200, s); }
    }
    if ((m = p.match(/^\/api\/batches\/([^/]+)(?:\/(.*))?$/))) {
      const members = [...jobs.values()].filter((j) => j.meta.batch && j.meta.batch.id === m[1]).sort((a, b) => a.meta.createdAt - b.meta.createdAt);
      if (!members.length) return send(res, 404, { error: 'No such batch.' });
      const sub = m[2] || '';
      if (!sub && req.method === 'GET') {
        const out = [];
        for (const j of members) {
          const site = await loadSite(j); let hi = null;
          if (site && site.perspectives) { const P = site.perspectives; const a = P.accessibility;
            hi = { pages: site.stats.pages, words: P.content.totalWords, https: /^https:/.test(site.startUrl), serious: P.security.summary.high, shouldFix: P.security.summary.medium, pageBytes: P.performance.averages.pageBytes, largestPaintMs: P.performance.averages.largestPaintMs, accessibilityProblems: a.lowContrastText + a.imagesWithoutDescription + a.formFieldsWithoutLabel + a.linksWithoutText + a.buttonsWithoutName, brokenLinks: site.issues.brokenInternalLinks.length, otherHosts: P.privacy.thirdParties.length, trackers: [...new Set(P.privacy.trackers.map((t) => t.service))], builtWith: site.technologies.slice(0, 6).map((t) => t.name), documents: (site.documents || []).length, needSignIn: (site.needSignIn || []).length, prices: ((P.signals || {}).priceExamples || {}).values || [], readingEase: (P.signals || {}).readingEase ? Math.round(P.signals.readingEase.sum / P.signals.readingEase.pages) : null };
          }
          out.push({ ...publicJob(j), highlights: hi });
        }
        return send(res, 200, { ...members[0].meta.batch, jobs: out });
      }
      if (req.method === 'POST' && ['pause', 'resume', 'stop'].includes(sub)) {
        for (const j of members) {
          if (j.crawl) j.crawl[sub]();
          else if (sub === 'stop' && j.meta.status === 'queued') { j.meta.status = 'stopped'; saveMeta(j); }
        }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && !sub) {
        for (const j of members) { if (j.crawl) j.crawl.stop(); else if (j.meta.status === 'queued') j.meta.status = 'stopped'; }
        for (let i = 0; i < 150 && members.some(isLive); i++) await new Promise((r) => setTimeout(r, 200));
        for (const j of members) { jobs.delete(j.meta.id); for (const c of j.clients) c.end(); await fsp.rm(path.join(JOBS_DIR, j.meta.id), { recursive: true, force: true }); }
        return send(res, 200, { ok: true });
      }
      if (sub === 'report') {     // one report per website, zipped together
        const format = u.searchParams.get('format') || 'docx'; const opts = { format, families: famList(u.searchParams.get('families')), detail: u.searchParams.get('detail') || 'full' };
        const zip = archiver('zip', { zlib: { level: 6 } }); const used = new Set(); const parts = [];
        for (const j of members) { try { const r = await buildReport(path.join(JOBS_DIR, j.meta.id), opts); let n = r.filename; for (let i = 2; used.has(n); i++) n = r.filename.replace(/(\.\w+)$/, `-${i}$1`); used.add(n); parts.push([n, r.buffer]); } catch { /* not finished: left out */ } }
        if (!parts.length) return send(res, 409, { error: 'None of these scrapes has finished yet.' });
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="lens-reports-${format}.zip"` });
        zip.on('error', () => res.destroy()); zip.pipe(res); for (const [n, b] of parts) zip.append(b, { name: n });
        return zip.finalize();
      }
      if (sub === 'export') {     // the same custom export for every website in the batch, zipped together
        const zip = archiver('zip', { zlib: { level: 6 } }); const used = new Set(); const parts = [];
        for (const j of members) { try { const r = await exporter.buildExport(path.join(JOBS_DIR, j.meta.id), exportQuery(u)); let n = r.filename; for (let i = 2; used.has(n); i++) n = r.filename.replace(/(\.\w+)$/, `-${i}$1`); used.add(n); parts.push([n, r.buffer]); } catch { /* not finished: left out */ } }
        if (!parts.length) return send(res, 409, { error: 'None of these scrapes has finished yet, or nothing was ticked.' });
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="deepscrape-batch-export.zip"' });
        zip.on('error', () => res.destroy()); zip.pipe(res); for (const [n, b] of parts) zip.append(b, { name: n });
        return zip.finalize();
      }
      if (sub === 'summary.csv') {
        const cell = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        let csv = '\ufeff' + ['website', 'address', 'result', 'pages', 'problem_pages', 'need_sign_in', 'assets', 'documents', 'hidden_data_responses', 'saved_bytes', 'seconds', 'emails', 'phones', 'built_with'].join(',') + '\n';
        for (const j of members) {
          const st = j.meta.stats || {}; const site = await loadSite(j);
          csv += [j.meta.host, j.meta.url, j.meta.status, st.pages, site ? site.pages.filter((x) => x.error || x.status >= 400).length : '', st.pagesNeedingSignIn ?? st.needSignIn, st.assetsSaved ?? st.assets, st.filesDownloaded ?? st.files, st.apiResponsesCaptured ?? st.apiResponses, st.bytesSaved, j.meta.durationSeconds,
            site ? site.contacts.emails.join('; ') : '', site ? site.contacts.phones.join('; ') : '', site ? site.technologies.map((t) => t.name).join('; ') : ''].map(cell).join(',') + '\n';
        }
        return send(res, 200, csv, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="batch-summary.csv"' });
      }
      if (sub === 'zip') {
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="deepscrape-batch.zip"' });
        const zip = archiver('zip', { zlib: { level: 6 } });
        zip.on('error', () => res.destroy()); zip.pipe(res);
        const used = new Set();
        for (const j of members) {
          let name = j.meta.host; for (let i = 2; used.has(name); i++) name = `${j.meta.host}-${i}`; used.add(name);
          zip.glob('**/*', { cwd: path.join(JOBS_DIR, j.meta.id), ignore: ['job.json', 'crawl-state.json', 'crawl.log'] }, { prefix: name });
        }
        return zip.finalize();
      }
      return send(res, 404, { error: 'Unknown request.' });
    }
    if (p === '/api/sessions' && req.method === 'GET') {
      const list = [];
      for (const f of await fsp.readdir(SESSIONS_DIR)) if (f.endsWith('.json')) { const st = await fsp.stat(path.join(SESSIONS_DIR, f)); list.push({ host: f.slice(0, -5), savedAt: st.mtimeMs }); }
      return send(res, 200, list);
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)$/)) && req.method === 'DELETE') {
      if (!safeId(m[1])) return send(res, 400, { error: 'bad name' });
      await fsp.rm(path.join(SESSIONS_DIR, m[1] + '.json'), { force: true });
      return send(res, 200, { ok: true });
    }

    if ((m = p.match(/^\/api\/jobs\/([^/]+)(?:\/(.*))?$/))) {
      const job = jobs.get(m[1]); const sub = m[2] || '';
      if (!job) return send(res, 404, { error: 'No such scrape.' });
      const dir = path.join(JOBS_DIR, job.meta.id);

      if (!sub && req.method === 'GET') {
        const site = await loadSite(job);
        return send(res, 200, { ...publicJob(job), log: job.log.slice(-300), summary: site ? { ...site, pages: undefined } : null });
      }
      if (!sub && req.method === 'DELETE') {
        if (job.crawl) { job.crawl.stop(); for (let i = 0; i < 100 && job.crawl; i++) await new Promise((r) => setTimeout(r, 200)); }
        jobs.delete(job.meta.id); for (const c of job.clients) c.end();
        await fsp.rm(dir, { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && ['pause', 'resume', 'stop', 'continue', 'skip', 'resume-crawl', 'rerun'].includes(sub)) {
        const c = job.crawl;
        if (sub === 'pause' && c) c.pause();
        else if (sub === 'resume' && c) c.resume();
        else if (sub === 'stop') { if (c) c.stop(); else if (job.meta.status === 'queued') { job.meta.status = 'stopped'; saveMeta(job); } }
        else if (sub === 'continue' && c) c.continueHuman();
        else if (sub === 'skip' && c) c.skipHuman();
        else if (sub === 'resume-crawl' && !c) {      // carry on an interrupted / stopped / page-limited scrape
          const body = await readBody(req);
          if (body.maxPages !== undefined) job.meta.options.maxPages = Number(body.maxPages) || 0;
          job.meta.status = 'queued'; job.meta.resumeNext = true; job.site = null; saveMeta(job); pump();
        } else if (sub === 'rerun') { const again = createJob(job.meta.url, { ...job.meta.options, useSavedSession: job.meta.useSavedSession }); return send(res, 200, publicJob(again)); }
        else return send(res, 409, { error: 'Not possible right now.' });
        return send(res, 200, publicJob(job));
      }
      if (sub === 'events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify(publicJob(job))}\n\n`);
        job.clients.add(res); req.on('close', () => job.clients.delete(res));
        return;
      }
      if (sub === 'pages') return send(res, 200, await pagesOf(job));
      if ((m = sub.match(/^page\/([^/]+)$/))) {
        if (!safeId(m[1])) return send(res, 400, { error: 'bad id' });
        try { return send(res, 200, await fsp.readFile(path.join(dir, 'pages', m[1], 'page.json'))); } catch { return send(res, 404, { error: 'Page not found.' }); }
      }
      if (sub === 'search') {
        const q = (u.searchParams.get('q') || '').toLowerCase().trim();
        if (q.length < 2) return send(res, 200, { results: [], total: 0 });
        const results = []; let total = 0;
        for (const pg of await pagesOf(job)) {
          let text = ''; try { text = await fsp.readFile(path.join(dir, 'pages', pg.id, 'text.txt'), 'utf8'); } catch { /* no text */ }
          const low = text.toLowerCase(); const hits = []; let i = -1, count = 0;
          while ((i = low.indexOf(q, i + 1)) !== -1) { count++; if (hits.length < 3) hits.push(text.slice(Math.max(0, i - 70), i + q.length + 90).replace(/\s+/g, ' ')); }
          const inMeta = ((pg.title || '') + ' ' + pg.url).toLowerCase().includes(q);
          if (count || inMeta) { total += count; if (results.length < 300) results.push({ id: pg.id, url: pg.url, title: pg.title, count, snippets: hits }); }
        }
        for (const d of (await readJsonl(path.join(dir, 'documents.jsonl'), '', 5000)).rows) {     // text inside PDFs, Office files ...
          if (!d.text) continue;
          let text = ''; try { text = await fsp.readFile(path.join(dir, ...d.text.split('/')), 'utf8'); } catch { continue; }
          const low = text.toLowerCase(); const hits = []; let i = -1, count = 0;
          while ((i = low.indexOf(q, i + 1)) !== -1) { count++; if (hits.length < 3) hits.push(text.slice(Math.max(0, i - 70), i + q.length + 90).replace(/\s+/g, ' ')); }
          if (count) { total += count; if (results.length < 300) results.push({ document: d.saved, textFile: d.text, url: d.url, title: `${d.kind}: ${decodeURIComponent(d.url.split('/').pop() || d.url)}`, count, snippets: hits }); }
        }
        results.sort((a, b) => b.count - a.count);
        return send(res, 200, { results, total });
      }
      if (['images', 'api', 'links'].includes(sub)) {
        const q = (u.searchParams.get('q') || '').toLowerCase().trim();
        return send(res, 200, await readJsonl(path.join(dir, sub + '.jsonl'), q, sub === 'links' ? 4000 : 2500));
      }
      if (sub === 'export/estimate') { try { return send(res, 200, await exporter.estimate(dir, exportQuery(u))); } catch (e) { return send(res, 409, { error: e.message }); } }
      if (sub === 'export') { try { return sendFile(res, await exporter.buildExport(dir, exportQuery(u))); } catch (e) { return send(res, 409, { error: e.message }); } }
      if ((m = sub.match(/^page\/([^/]+)\/zip$/))) {
        if (!safeId(m[1]) || !fs.existsSync(path.join(dir, 'pages', m[1]))) return send(res, 404, { error: 'Page not found.' });
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${m[1]}.zip"` });
        const zip = archiver('zip', { zlib: { level: 6 } }); zip.on('error', () => res.destroy()); zip.pipe(res); zip.directory(path.join(dir, 'pages', m[1]), m[1]);
        return zip.finalize();
      }
      if (sub === 'signin' && req.method === 'POST') {       // "Sign in now" for a site whose window was closed or skipped
        const host = u.searchParams.get('host') || '';
        if (job.crawl && job.crawl.retrySignIn) { job.crawl.retrySignIn(host); return send(res, 200, { ok: true, live: true }); }
        job.meta.status = 'queued'; job.meta.resumeNext = true; job.site = null; saveMeta(job); pump();   // finished: continue the scrape, which retries the waiting pages
        return send(res, 200, { ok: true, live: false });
      }
      if (sub === 'earlier') return send(res, 200, [...jobs.values()].filter((j) => j !== job && j.meta.host === job.meta.host && !j.crawl && ['done', 'partial', 'stopped'].includes(j.meta.status)).sort((a, b) => b.meta.createdAt - a.meta.createdAt).map((j) => ({ id: j.meta.id, url: j.meta.url, finishedAt: j.meta.finishedAt, pages: (j.meta.stats || {}).pages })));
      if (sub === 'compare') {
        const other = jobs.get(u.searchParams.get('with') || ''); const a = other && await loadSite(other); const b = await loadSite(job);
        if (!a || !b) return send(res, 409, { error: 'Both scrapes need to be finished to compare them.' });
        const older = (other.meta.finishedAt || 0) <= (job.meta.finishedAt || 0);
        return send(res, 200, older ? compare(a, b) : compare(b, a));
      }
      if (sub === 'verdicts') {
        if (req.method === 'GET') return send(res, 200, { status: job.meta.verdicts || null, verdicts: ai.readVerdicts(dir) });
        if (req.method === 'DELETE') { if (job.verdictStop) job.verdictStop.stop = true; return send(res, 200, { ok: true }); }
        const body = await readBody(req); const conn = pickAi(body.ai);
        if (!conn) return send(res, 409, { error: 'Add an AI connection first (the "Your AI" tab).' });
        if (job.meta.verdicts && job.meta.verdicts.state === 'running') return send(res, 409, { error: 'Verdicts are already being written for this scrape.' });
        const stop = job.verdictStop = { stop: false };
        job.meta.verdicts = { state: 'running', done: 0, total: 0, startedAt: Date.now(), ai: conn.name };
        ai.writeVerdicts(dir, { conn, families: (body.families || []).map(Number).filter(Boolean), shouldStop: () => stop.stop, onProgress: (pr) => { job.meta.verdicts = { ...job.meta.verdicts, ...pr }; } })
          .then(() => { job.meta.verdicts = { ...job.meta.verdicts, state: stop.stop ? 'stopped' : 'done' }; })
          .catch((e) => { job.meta.verdicts = { ...job.meta.verdicts, state: 'failed', error: e.message.split('\n')[0] }; })
          .finally(() => { saveMeta(job); });
        return send(res, 200, { ok: true });
      }
      if (sub === 'ask') {
        if (req.method === 'GET') return send(res, 200, ai.readAnswers(dir));
        const body = await readBody(req); const conn = pickAi(body.ai);
        if (!conn) return send(res, 409, { error: 'Add an AI connection first (the "Your AI" tab).' });
        if (!String(body.question || '').trim()) return send(res, 400, { error: 'Type a question or an instruction.' });
        try { return send(res, 200, await ai.askSite(dir, conn, String(body.question).trim())); } catch (e) { return send(res, 409, { error: e.message.split('\n')[0] }); }
      }
      if (sub === 'lenses') {
        const site = await loadSite(job); if (!site || !site.perspectives) return send(res, 409, { error: 'The lens review is ready when the scrape finishes.' });
        const q = (u.searchParams.get('q') || '').toLowerCase().trim(); const fam = famList(u.searchParams.get('family'));
        job.lensCache = job.lensCache || lensLib.evaluate(site);      // all 1,860, evaluated once per finished scrape
        const overview = job.lensCache.map((f) => ({ id: f.id, name: f.name, about: f.about, counts: f.counts, inScope: !site.lensFamilies || site.lensFamilies.includes(f.id) }));
        let families = [];
        if (q) families = job.lensCache.map((f) => ({ ...f, lenses: f.lenses.filter((l) => (l.name + ' ' + l.evidence.join(' ')).toLowerCase().includes(q)).slice(0, 60) })).filter((f) => f.lenses.length);
        else if (fam.length) families = job.lensCache.filter((f) => fam.includes(f.id));
        const vd = ai.readVerdicts(dir);
        if (vd) families = families.map((f) => { const vf = vd.families[f.id]; return vf ? { ...f, aiSummary: vf.summary, lenses: f.lenses.map((l) => (vf.lenses[l.n] ? { ...l, ai: vf.lenses[l.n] } : l)) } : f; });
        return send(res, 200, { overview: overview.map((o) => ({ ...o, judged: vd && vd.families[o.id] ? vd.families[o.id].judged : 0 })), families, scope: site.lensFamilies, skipped: site.collectorsSkipped || [], ai: vd ? { model: vd.model, generatedAt: vd.generatedAt } : null });
      }
      if (sub === 'report') {
        try {
          const r = await buildReport(dir, { format: u.searchParams.get('format') || 'docx', families: famList(u.searchParams.get('families')), detail: u.searchParams.get('detail') || 'full' });
          res.writeHead(200, { 'content-type': r.mime, 'content-length': r.buffer.length, 'content-disposition': `attachment; filename="${r.filename}"`, 'cache-control': 'no-store' });
          return res.end(r.buffer);
        } catch (e) { return send(res, 409, { error: e.message }); }
      }
      if (sub === 'files') return send(res, 200, { documents: (await readJsonl(path.join(dir, 'documents.jsonl'), '', 5000)).rows, downloads: await listFiles(path.join(dir, 'files')), assets: (await listFiles(path.join(dir, 'assets'))).slice(0, 3000) });
      if (sub === 'zip') {
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${job.meta.host}-scrape.zip"` });
        const zip = archiver('zip', { zlib: { level: 6 } });
        zip.on('error', () => res.destroy()); zip.pipe(res);
        zip.glob('**/*', { cwd: dir, ignore: ['job.json', 'crawl-state.json', 'crawl.log'] }, { prefix: job.meta.host + '-scrape' });
        return zip.finalize();
      }
      return send(res, 404, { error: 'Unknown request.' });
    }

    // Scraped files. Served sandboxed so a scraped page's scripts can never run with access to the dashboard.
    if ((m = p.match(/^\/files\/([^/]+)\/(.+)$/))) {
      const job = jobs.get(m[1]); if (!job) return send(res, 404, { error: 'not found' });
      const root = path.join(JOBS_DIR, job.meta.id);
      const full = path.resolve(root, decodeURIComponent(m[2]));
      if (!full.startsWith(root + path.sep)) return send(res, 403, { error: 'outside the scrape folder' });
      let st; try { st = await fsp.stat(full); } catch { return send(res, 404, { error: 'not found' }); }
      if (!st.isFile()) return send(res, 404, { error: 'not found' });
      const headers = { 'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
      if (u.searchParams.has('preview') && /\.html$/.test(full)) {
        // Saved page with scripts off; relative images and styles resolve against the original site.
        let base = ''; try { const b = new URL(u.searchParams.get('base')); if (/^https?:$/.test(b.protocol)) base = `<base href="${b.href.replace(/"/g, '%22')}">`; } catch { /* no base */ }
        const html = (await fsp.readFile(full, 'utf8')).replace(/<head[^>]*>/i, (h) => h + base);
        return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "sandbox; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'" });
      }
      if (u.searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${path.basename(full).replace(/"/g, '')}"`;
      res.writeHead(200, headers);
      return fs.createReadStream(full).pipe(res);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message }); else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is busy - DeepScrape may already be running. Open http://localhost:${PORT} or start with --port <other>.`); if (process.send) process.send({ busy: true, port: PORT }); process.exit(1); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`DeepScrape dashboard: ${url}\nResults folder:       ${DATA}\nLeave this window open while scraping. Ctrl+C to quit.`);
  if (process.send) process.send({ ready: true, port: PORT, data: DATA });
  if (!args.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* open it by hand */ }
  }
});
let quitting = false;
async function shutdown() {
  if (quitting) process.exit(1); quitting = true;
  const live = [...jobs.values()].filter(isLive);
  if (live.length) console.log('\nSaving progress of running scrapes...');
  live.forEach((j) => j.crawl.stop());
  for (let i = 0; i < 150 && [...jobs.values()].some(isLive); i++) await new Promise((r) => setTimeout(r, 200));
  process.exit(0);
}
process.on('SIGINT', shutdown);
// The desktop app starts this file as a child process and asks it to stop with a message (Windows has no SIGINT for child processes).
process.on('message', (m) => { if (m === 'shutdown') shutdown(); });
process.on('disconnect', () => { if (process.env.DEEPSCRAPE_DESKTOP === '1') shutdown(); });
