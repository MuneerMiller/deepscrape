'use strict';
// Checks the bridge that lets Claude, Claude Code and other MCP programs use DeepScrape: speaks the protocol by hand,
// starts the scraper by itself, scrapes the timing site, and reads results back through every tool.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process'); const readline = require('readline');
const startBenchSite = require('./bench-site');

(async () => {
  const site = await startBenchSite({ pages: 6, latency: 10 });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-mcp-')); const port = 4700 + Math.floor(Math.random() * 80);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp.js')], { env: { ...process.env, DEEPSCRAPE_PORT: String(port), DEEPSCRAPE_DATA: data }, stdio: ['pipe', 'pipe', 'ignore'] });
  const waiting = new Map(); let next = 1; let junk = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { junk++; return; } const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } });
  const rpc = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { text: r.content[0].text, isError: !!r.isError }; };
  let fail = 0; const check = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + String(x).slice(0, 300)}`); };

  const init = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).result;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  check('handshake', init.serverInfo.name === 'deepscrape' && init.protocolVersion === '2025-06-18' && init.capabilities.tools);
  const tools = (await rpc('tools/list', {})).result.tools;
  check('eight tools, each with a description and an input schema', tools.length === 8 && tools.every((t) => t.description.length > 40 && t.inputSchema.type === 'object'), tools.map((t) => t.name).join(','));
  const s = await call('scrape_website', { url: site.url, max_pages: 7, speed: 'fast' });
  check('scrape_website starts the scraper itself, scrapes and reports scores', /Status: done/.test(s.text) && /Scores \(out of 100\): overall \d+/.test(s.text) && /Accuracy check: \d+ of \d+/.test(s.text), s.text);
  check('list_scrapes', JSON.parse((await call('list_scrapes')).text)[0].pages === 7);
  const rep = await call('get_report', { topic: 'security' });
  check('get_report gives the in-depth security report', /## Summary/.test(rep.text) && /## Score: \d+ out of 100/.test(rep.text) && /Protective headers, page by page/.test(rep.text), rep.text);
  check('get_report: everything in one report', /Accessibility: Summary/.test((await call('get_report', { topic: 'everything' })).text));
  const pages = await call('list_pages', { contains: 'tabs' });
  check('list_pages with a filter', /^1 page\n\S+\s+200/.test(pages.text), pages.text);
  const pg = await call('get_page', { page: site.url + 'p/3' });
  check('get_page by address, with text revealed by clicking', /Page 3 \(tabs\)/.test(pg.text) && /Tab 3 text/.test(pg.text), pg.text);
  check('get_page design part', /"colors"/.test((await call('get_page', { page: site.url + 'p/3', part: 'design' })).text));
  check('search_scrape', /appears \d+ times on \d+ pages/.test((await call('search_scrape', { query: 'woodwork' })).text));
  const ex = await call('export_scrape', { topic: 'design', folder: path.join(data, 'out') }); const file = (/Saved (.+?) \(/.exec(ex.text) || [])[1];
  check('export_scrape saves the design pack to disk', file && fs.existsSync(file) && fs.statSync(file).size > 5000 && file.endsWith('.zip'), ex.text);
  const bad = await call('get_page', { page: 'no-such-page' });
  check('a wrong page id is reported as an error, not a crash', bad.isError === true);
  check('unknown method answers with an error', !!(await rpc('nope/nothing', {})).error);
  check('nothing but protocol messages on stdout', junk === 0, junk);
  const connect = await (await fetch(`http://127.0.0.1:${port}/api/connect`)).json();
  check('the app gives ready-to-paste connection lines', /claude mcp add .* deepscrape -- /.test(connect.claudeCode) && JSON.parse(connect.desktopConfig).mcpServers.deepscrape.args[0].endsWith('mcp.js') && connect.tools.length === 8, JSON.stringify(connect).slice(0, 300));
  child.stdin.end(); site.server.close();
  // The scraper the bridge started keeps running for the dashboard; stop it here so the test leaves nothing behind.
  try { const { execSync } = require('child_process'); if (process.platform !== 'win32') execSync(`pkill -f -- "--port ${port} --data ${data}"`); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 400)); fs.rmSync(data, { recursive: true, force: true });
  console.log(fail ? `\n${fail} check(s) failed` : '\nMCP bridge: all checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
