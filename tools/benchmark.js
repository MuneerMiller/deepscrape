'use strict';
// Times a scrape of the built-in timing site and shows where the seconds go.
// Run: node tools/benchmark.js [--pages 60] [--latency 40] [--fast] [--json]
const fs = require('fs'); const os = require('os'); const path = require('path');
const startBenchSite = require('../test/bench-site');
const { Crawl } = require('../lib/crawler');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);

(async () => {
  const site = await startBenchSite({ pages: Number(arg('pages', 60)), latency: Number(arg('latency', 40)) });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-bench-'));
  let extra = {}; try { extra = JSON.parse(arg('opts', '{}')); } catch { /* ignore */ }
  const crawl = new Crawl(site.url, { out, maxPages: site.pages + 1, interactive: false, wellKnown: false, sitemap: false, selfCheck: false, ...(flag('fast') ? { speed: 'fast' } : {}), ...extra });
  const t0 = Date.now();
  const summary = await crawl.run();
  const secs = (Date.now() - t0) / 1000;
  site.server.close();
  const pages = fs.readFileSync(path.join(out, 'pages.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const totals = {}; for (const p of pages) for (const [k, v] of Object.entries(p.timings || {})) totals[k] = (totals[k] || 0) + v;
  const words = pages.reduce((a, p) => a + (p.wordCount || 0), 0);
  const revealed = pages.reduce((a, p) => a + ((p.interactions && p.interactions.length) || p.interactionCount || 0), 0);
  const result = { pages: pages.length, seconds: +secs.toFixed(1), pagesPerMinute: Math.round(pages.length / secs * 60), words, revealed, images: pages.reduce((a, p) => a + (p.images ? p.images.filter((i) => i.saved).length : 0), 0), apiResponses: fs.readdirSync(path.join(out, 'pages')).reduce((a, d) => { try { return a + fs.readdirSync(path.join(out, 'pages', d, 'api')).length; } catch { return a; } }, 0), screenshots: fs.readdirSync(path.join(out, 'pages')).reduce((a, d) => a + fs.readdirSync(path.join(out, 'pages', d)).filter((f) => f.startsWith('screenshot')).length, 0), revealedWords: pages.reduce((a, p) => a + (p.interactions || []).reduce((x, i) => x + i.newText.split(/\s+/).length, 0), 0), perPhaseSeconds: Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / 1000).toFixed(1)])) };
  if (flag('json')) console.log(JSON.stringify(result)); else console.log(result);
  fs.rmSync(out, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
