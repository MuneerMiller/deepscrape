#!/usr/bin/env node
'use strict';
// DeepScrape as a tool for Claude, Claude Code and any other program that speaks the Model Context Protocol (MCP).
//
// This is a thin bridge: it talks to the DeepScrape app on this computer (starting it in the background if it is not open),
// so scrapes started by an assistant show up in the dashboard, and sign-in windows still open for you when a site needs one.
//
//   Claude Code:     claude mcp add deepscrape -- node /path/to/deepscrape/mcp.js
//   Claude desktop:  see "Use with Claude" in the DeepScrape sidebar for the exact lines to paste.
//
// Protocol: JSON-RPC 2.0 over stdin/stdout, one message per line. Nothing but protocol messages may go to stdout.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const VERSION = require('./package.json').version;
const PORT = Number(process.env.DEEPSCRAPE_PORT || 4780);
const BASE = `http://127.0.0.1:${PORT}`;
const TEXT_LIMIT = 60000;   // characters returned to the assistant in one answer; longer results are cut with a note
const log = (...a) => process.stderr.write('[deepscrape] ' + a.join(' ') + '\n');

// ---- talking to the app ---------------------------------------------------------------------------------------------
async function api(route, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(BASE + route, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) || `DeepScrape answered ${res.status}`);
  return data;
}
const alive = async () => { try { const h = await api('/api/health'); return h && h.app === 'deepscrape' ? h : null; } catch { return null; } };

let starting = null;
async function ensureApp() {
  if (await alive()) return;
  if (!starting) {
    starting = (async () => {
      // Use the same data folder the desktop app uses, so its scrapes and these are one collection.
      const packaged = /[\\/]resources[\\/]app$/.test(__dirname);
      const data = process.env.DEEPSCRAPE_DATA || (packaged ? path.join(os.homedir(), 'Documents', 'DeepScrape', 'data') : path.join(__dirname, 'data'));
      log('starting the scraper in the background, data in', data);
      const child = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--no-open', '--port', String(PORT), '--data', data], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      child.unref();
      for (let i = 0; i < 100; i++) { if (await alive()) return; await new Promise((r) => setTimeout(r, 300)); }
      throw new Error('DeepScrape did not start. Open the DeepScrape app and try again.');
    })().finally(() => { starting = null; });
  }
  await starting;
}

// ---- helpers --------------------------------------------------------------------------------------------------------
const cut = (t, limit = TEXT_LIMIT) => (t.length > limit ? t.slice(0, limit) + `\n\n[Cut here: ${t.length - limit} more characters. Ask for a narrower part, or use export_scrape to save the whole thing to a file.]` : t);
const brief = (j) => ({ id: j.id, website: j.url, status: j.status, pages: (j.stats || {}).pages ?? 0, started: new Date(j.createdAt).toISOString(), ...(j.batch ? { batch: j.batch.name } : {}) });
const DONE = new Set(['done', 'stopped', 'failed', 'interrupted']);
async function latestId(id) { if (id) return id; const jobs = await api('/api/jobs'); const j = jobs.find((x) => x.status === 'done') || jobs[0]; if (!j) throw new Error('There are no scrapes yet. Use scrape_website first.'); return j.id; }
function scoreLines(scores) {
  if (!scores || scores.overall == null) return [];
  return [`Scores (out of 100): overall ${scores.overall} (${scores.grade}); ` + Object.values(scores.areas).map((a) => `${a.label.toLowerCase()} ${a.score} (${a.grade})`).join(', ') + '.',
    ...Object.values(scores.areas).filter((a) => a.basis.length).map((a) => `  ${a.label} lost points for: ${a.basis.slice(0, 5).map((b) => `${b.what} (-${b.points})`).join('; ')}.`),
    '  Security is a passive check of what any visitor can see, not a penetration test.'];
}
async function describe(id) {
  const j = await api(`/api/jobs/${id}`); const s = j.summary; const L = [`Scrape ${j.id}`, `Website: ${j.url}`, `Status: ${j.status}${j.live ? ' (still running)' : ''}`];
  const st = j.stats || {}; L.push(`Pages scraped so far: ${st.pages ?? 0}${st.queued ? `, ${st.queued} waiting` : ''}`);
  if (j.human || st.needSignIn) L.push('Some pages need a sign-in. A sign-in window opens on the computer running DeepScrape; the scrape carries on once the owner has signed in or closed it.');
  if (s) {
    const x = s.stats || {};
    L.push(`Finished: ${s.finishedAt}. ${x.pages} pages, ${x.filesDownloaded ?? 0} documents, ${x.assetsSaved ?? 0} images and other files saved.`);
    L.push(...scoreLines(s.scores));
    if (s.selfCheck) L.push(`Accuracy check: ${s.selfCheck.pagesInAgreement} of ${s.selfCheck.pagesChecked} sampled pages match a slow second reading (average coverage ${s.selfCheck.averageCoverage}%).`);
    if ((s.technologies || []).length) L.push('Built with: ' + s.technologies.map((t) => t.name).slice(0, 20).join(', ') + '.');
    if ((s.needSignIn || []).length) L.push(`${s.needSignIn.length} pages could not be read because they need a sign-in.`);
    const issues = Object.entries(s.issues || {}).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k, v]) => `${k} ${Array.isArray(v) ? v.length : v}`);
    if (issues.length) L.push('Issues found: ' + issues.join(', ') + '.');
    L.push('', 'Next: get_report for an in-depth report on one topic, list_pages and get_page for the content, search_scrape to find text, export_scrape to save a file.');
  } else if (!DONE.has(j.status)) L.push('', 'Not finished yet. Call get_scrape again in a little while.');
  return L.join('\n');
}

// ---- the tools ------------------------------------------------------------------------------------------------------
const TOPICS = ['scorecard', 'security', 'design', 'accessibility', 'speed', 'privacy', 'search', 'technology', 'legal', 'content', 'everything'];
const TOOLS = [
  { name: 'scrape_website', description: 'Scrape a website with DeepScrape on this computer: every page, its text, images, documents, design, security settings, accessibility, speed and more. Respects robots.txt, never submits forms, and does nothing a normal visitor could not. Returns when finished or after about 45 seconds, whichever is first; a long scrape keeps running and get_scrape reports on it. If a site needs a sign-in, a window opens on the computer for its owner to sign in.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Website address, for example https://example.com' }, scope: { type: 'string', enum: ['site', 'section', 'page'], description: 'site = the whole website (default); section = this address and everything below it; page = only this one page' }, max_pages: { type: 'integer', description: 'Stop after this many pages. 0 or omitted = no limit.' }, speed: { type: 'string', enum: ['gentle', 'balanced', 'fast'], description: 'How hard to go at the site. balanced is the default.' }, wait_seconds: { type: 'integer', description: 'How long to wait for it to finish before returning (0 to 50, default 45).' } }, required: ['url'] },
    async run(a) {
      const options = { speed: a.speed || 'balanced', maxPages: a.max_pages || 0 };
      if (a.scope === 'page') { options.maxPages = 1; options.maxDepth = 0; options.sitemap = false; options.wellKnown = false; }
      const made = await api('/api/jobs', { method: 'POST', body: { url: a.url, mode: a.scope === 'section' ? 'section' : undefined, options } });
      const id = made.jobs[0].id; const until = Date.now() + Math.max(0, Math.min(50, a.wait_seconds ?? 45)) * 1000;
      while (Date.now() < until) { const j = await api(`/api/jobs/${id}`); if (DONE.has(j.status)) break; await new Promise((r) => setTimeout(r, 1500)); }
      return describe(id);
    } },
  { name: 'list_scrapes', description: 'List the scrapes DeepScrape holds on this computer, newest first, with their ids, status and page counts.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'How many to list (default 20).' } } },
    async run(a) { const jobs = await api('/api/jobs'); return jobs.length ? JSON.stringify(jobs.slice(0, a.limit || 20).map(brief), null, 2) : 'There are no scrapes yet. Use scrape_website to make one.'; } },
  { name: 'get_scrape', description: 'Status and headline results of one scrape: progress, the five scores out of 100 (security, accessibility, speed, privacy, search) with what cost points, the accuracy check, technology and issue counts.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Scrape id from list_scrapes or scrape_website. Omit for the most recent finished scrape.' } } },
    async run(a) { return describe(await latestId(a.id)); } },
  { name: 'get_report', description: 'An in-depth report on one topic of a finished scrape, as Markdown: a written summary, the score with every point lost and how to fix it, page-by-page tables, and the data behind them. Topics: scorecard (all five scores), security, design (colours, fonts, type styles, tokens), accessibility, speed, privacy, search (titles, links, broken links), technology, legal, content (the text of every page), everything (all topics in one report).',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: TOPICS }, id: { type: 'string', description: 'Scrape id. Omit for the most recent finished scrape.' } }, required: ['topic'] },
    async run(a) { const id = await latestId(a.id); const res = await api(`/api/jobs/${id}/export?topic=${encodeURIComponent(a.topic)}&format=md`, { raw: true }); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That report could not be made.'); return cut(await res.text()); } },
  { name: 'list_pages', description: 'The pages of a scrape: address, title, status code, word count. Use the page id with get_page.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, contains: { type: 'string', description: 'Only pages whose address or title contains this text.' }, limit: { type: 'integer', description: 'Default 100.' } } },
    async run(a) { const id = await latestId(a.id); let pages = await api(`/api/jobs/${id}/pages`); const q = (a.contains || '').toLowerCase(); if (q) pages = pages.filter((p) => (p.url + ' ' + (p.title || '')).toLowerCase().includes(q)); const lim = a.limit || 100;
      return `${pages.length} page${pages.length === 1 ? '' : 's'}${pages.length > lim ? `, first ${lim} shown` : ''}\n` + pages.slice(0, lim).map((p) => `${p.id}  ${p.status ?? ''}  ${p.words ?? 0} words  ${p.url}  ${p.title ? '"' + p.title + '"' : ''}`).join('\n'); } },
  { name: 'get_page', description: 'One scraped page. part=content gives its text as Markdown (default); details gives title, description, headings, links, images, forms and tables; design gives its colours, fonts and type styles; security gives its headers, cookies and security findings; accessibility gives its accessibility checks.',
    inputSchema: { type: 'object', properties: { page: { type: 'string', description: 'Page id from list_pages (for example 0001-home) or the page address.' }, part: { type: 'string', enum: ['content', 'details', 'design', 'security', 'accessibility'] }, id: { type: 'string' } }, required: ['page'] },
    async run(a) {
      const id = await latestId(a.id); let pid = a.page;
      if (/^https?:/i.test(pid)) { const pages = await api(`/api/jobs/${id}/pages`); const norm = (u) => u.replace(/\/$/, '').toLowerCase(); const hit = pages.find((p) => norm(p.url) === norm(pid) || norm(p.finalUrl || '') === norm(pid)); if (!hit) throw new Error('That address is not among the scraped pages. Use list_pages to see them.'); pid = hit.id; }
      const r = await api(`/api/jobs/${id}/page/${encodeURIComponent(pid)}`); const part = a.part || 'content';
      if (part === 'content') return cut(`# ${r.title || r.url}\n${r.url}\n\n${r.markdown || (r.text && r.text.visible) || ''}` + ((r.interactions || []).length ? '\n\n## Revealed by clicking\n\n' + r.interactions.map((i) => `**${i.clicked}**\n${i.newText}`).join('\n\n') : ''));
      const pick = { details: ['url', 'finalUrl', 'status', 'title', 'description', 'language', 'canonical', 'robotsMeta', 'headings', 'wordCount', 'links', 'images', 'forms', 'tables', 'structuredData', 'contacts', 'technologies'], design: ['url', 'design'], security: ['url', 'responseHeaders', 'tls', 'security', 'cookies', 'audit'], accessibility: ['url', 'accessibility', 'landmarks', 'headings'] }[part];
      return cut(JSON.stringify(Object.fromEntries(pick.map((k) => [k, r[k]])), null, 1));
    } },
  { name: 'search_scrape', description: 'Find text across every page and document of a scrape. Returns the pages it appears on with the surrounding words.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'string' } }, required: ['query'] },
    async run(a) { const id = await latestId(a.id); const r = await api(`/api/jobs/${id}/search?q=${encodeURIComponent(a.query)}`); if (!r.results.length) return `"${a.query}" was not found.`; return cut(`"${a.query}" appears ${r.total} time${r.total === 1 ? '' : 's'} on ${r.results.length} page${r.results.length === 1 ? '' : 's'} or documents.\n\n` + r.results.slice(0, 40).map((x) => `${x.title || x.url} (${x.count})\n${x.url}${x.id ? `  [page ${x.id}]` : ''}\n${(x.snippets || []).map((s) => '  ... ' + s + ' ...').join('\n')}`).join('\n\n')); } },
  { name: 'export_scrape', description: 'Save a report or data file from a scrape to this computer and return where it is. Use this for files to keep or hand on: a PDF or Word report, an Excel workbook, or a complete ZIP pack (the design pack carries design tokens, a starter stylesheet and screenshots; the security pack carries the site\'s protective headers as nginx, Apache and Express configuration).',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: TOPICS }, format: { type: 'string', enum: ['pdf', 'docx', 'xlsx', 'zip', 'md', 'html', 'json', 'csv'], description: 'Default: the best format for the topic.' }, folder: { type: 'string', description: 'Folder to save into. Default: an "exports" folder inside the DeepScrape data folder.' }, id: { type: 'string' } }, required: ['topic'] },
    async run(a) {
      const id = await latestId(a.id); const res = await api(`/api/jobs/${id}/export?topic=${encodeURIComponent(a.topic)}${a.format ? '&format=' + a.format : ''}`, { raw: true });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That export could not be made.');
      const name = (/filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '') || [])[1] || `${a.topic}.${a.format || 'bin'}`;
      const folder = a.folder ? path.resolve(a.folder) : path.join((await alive()).data, 'exports'); fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, path.basename(name)); const buf = Buffer.from(await res.arrayBuffer()); fs.writeFileSync(file, buf);
      return `Saved ${file} (${buf.length > 1048576 ? (buf.length / 1048576).toFixed(1) + ' MB' : Math.round(buf.length / 1024) + ' KB'}).`;
    } },
];

// ---- protocol -------------------------------------------------------------------------------------------------------
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
async function handle(msg) {
  const { id, method, params = {} } = msg; const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result }); const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') return reply({ protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'deepscrape', title: 'DeepScrape', version: VERSION }, instructions: 'DeepScrape scrapes whole websites on this computer and reports on them. Typical flow: scrape_website, then get_scrape for scores, then get_report for depth or get_page / search_scrape for content. Scores and security findings come from a passive look at what any visitor can see; say so when reporting them.' });
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params.name); if (!tool) return fail(-32602, `Unknown tool: ${params.name}`);
      try { await ensureApp(); const text = await tool.run(params.arguments || {}); return reply({ content: [{ type: 'text', text: String(text) }] }); }
      catch (e) { return reply({ content: [{ type: 'text', text: e.message }], isError: true }); }
    }
    if (method === 'resources/list') return reply({ resources: [] });
    if (method === 'prompts/list') return reply({ prompts: [] });
    if (id === undefined) return;   // a notification we do not need to act on
    return fail(-32601, `Method not found: ${method}`);
  } catch (e) { fail(-32603, e.message); }
}
if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin });
  let busy = 0, closed = false; const finish = () => { if (closed && !busy) process.exit(0); };
  rl.on('line', (line) => { if (!line.trim()) return; let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); } for (const m of Array.isArray(msg) ? msg : [msg]) { busy++; handle(m).finally(() => { busy--; finish(); }); } });
  rl.on('close', () => { closed = true; finish(); });   // answer what is already asked before leaving
  log(`DeepScrape MCP server ${VERSION} ready`);
}
module.exports = { TOOLS };
