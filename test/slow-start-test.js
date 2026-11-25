'use strict';
// A site that answers slowly at the very start (robots.txt takes seconds) must not break the once-a-second progress updates.
// This used to stop the whole app: the update ran before the sign-in list existed.
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { Crawl } = require('../lib/crawler');

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') return setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n'); }, 2600);
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Slow start</title><h1>Slow start</h1><p>One page.</p>'); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-slow-'));
  const crawl = new Crawl(url, { out, maxPages: 1, delay: 0, interactive: false, wellKnown: false });
  let early = 0, withList = 0; let error = null;
  crawl.on('stats', (s) => { if (!s.pages) early++; if (Array.isArray(s.signIns)) withList++; });
  process.on('uncaughtException', (e) => { error = e; });
  try { await crawl.run(); } catch (e) { error = error || e; }
  server.close();
  const ok = !error && early >= 2 && withList >= early && fs.existsSync(path.join(out, 'site.json'));
  console.log(`${ok ? 'PASS' : 'FAIL'}  progress updates work while the site is still answering its first request (${early} updates before the first page)${error ? '  ' + error.message : ''}`);
  fs.rmSync(out, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})();
