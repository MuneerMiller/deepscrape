'use strict';
// Speed must never cost content. Scrapes the timing site and checks that every kind of page still gives up everything:
// data loaded after the page opens, images that load on scroll, text behind tabs and "show more",
// and that a page which never stops talking to its server does not hold the scrape up.
const fs = require('fs'); const os = require('os'); const path = require('path');
const startBenchSite = require('./bench-site');
const { Crawl } = require('../lib/crawler');

(async () => {
  const site = await startBenchSite({ pages: 18, latency: 60 });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-speed-'));
  const crawl = new Crawl(site.url, { out, maxPages: site.pages + 1, interactive: false, wellKnown: false, sitemap: false });
  const grew = []; crawl.on('log', (m) => { if (/at a time now/.test(m)) grew.push(m); });
  const t0 = Date.now(); await crawl.run(); const secs = (Date.now() - t0) / 1000;
  site.server.close();
  const pages = fs.readFileSync(path.join(out, 'pages.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const kind = (k) => pages.filter((p) => new RegExp(`\\(${k}\\)`).test(p.title || ''));
  let fail = 0; const check = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); };
  check('every page scraped', pages.length === site.pages + 1 && pages.every((p) => !p.error), String(pages.length));
  check('data loaded after the page opens is read', kind('data').length === 3 && kind('data').every((p) => /Item 5/.test(p.markdown || p.text.visible || '')));
  check('images that load on scroll are saved', kind('lazy').length === 3 && kind('lazy').every((p) => p.images.filter((i) => i.saved).length === 14), kind('lazy').map((p) => p.images.filter((i) => i.saved).length).join(','));
  const reveals = kind('tabs').map((p) => (p.interactions || []).map((i) => i.newText).join(' '));
  check('text behind tabs and "show more" is read', reveals.length === 3 && reveals.every((t) => ['Tab 2 text', 'Tab 3 text', 'More 1.', 'More 2.'].every((x) => t.includes(x))), reveals.map((t) => t.length).join(','));
  const chatty = kind('chatty').map((p) => p.durationMs);
  check('a page that never goes quiet does not hold things up', chatty.length === 3 && Math.max(...chatty) < 6000, chatty.join(','));
  check('pages open together grow while the site keeps up', grew.some((m) => /quickly/.test(m)), grew.join(' | '));
  const sc = JSON.parse(fs.readFileSync(path.join(out, 'site.json'), 'utf8')).selfCheck;
  check('accuracy self-check: sampled pages match a slow re-read', sc && sc.pagesChecked >= 3 && sc.pagesInAgreement === sc.pagesChecked, JSON.stringify(sc));
  check('each page records where its time went', pages.every((p) => p.timings && typeof p.timings.open === 'number'));
  console.log(`\n${pages.length} pages in ${secs.toFixed(1)}s (${Math.round(pages.length / secs * 60)} a minute)`);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(fail ? `\n${fail} speed check(s) failed` : '\nAll speed checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
