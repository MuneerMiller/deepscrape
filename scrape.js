#!/usr/bin/env node
'use strict';
/*
 * DeepScrape command line.
 *   node scrape.js https://example.com
 *   node scrape.js --help
 * For the dashboard run:  npm start
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Crawl } = require('./lib/crawler');

const HELP = `
DeepScrape - scrape an entire website, rendered in a real browser.
(For the point-and-click dashboard run:  npm start)

USAGE
  node scrape.js <url> [more urls...] [options]

LENSES AND REPORTS
  node scrape.js lenses                      List the 23 lens families
  --lenses <n,n,...>    Only examine these lens families (default: all). Collectors none of them
                        needs (screenshots, assets, documents, clicking) are switched off.
  node scrape.js export <scrape folder> --include pages,links,tables [--files screenshots,assets]
                        [--format xlsx|zip|csv|json|md|docx|pdf|html] [--section /blog] [--contains text]
                        [--result ok|problems] [--out file]     (node scrape.js export, on its own, lists the choices)
  node scrape.js report <scrape folder> [--format docx|pdf|xlsx|html|md|csv|json]
                        [--families n,n,...] [--detail full|findings|summary] [--out file]

SEVERAL WEBSITES
  --list <file>         Read website addresses from a text or CSV file
  --sites-at-once <n>   How many websites to scrape side by side (default 2)
                        With several websites, --out is the parent folder; each site gets its own folder inside.

SCOPE
  --max-pages <n>       Stop after n pages (default 1000, 0 = no limit)
  --max-depth <n>       Only follow links n clicks away from the start URL
  --single              Scrape just this one page
  --subdomains          Also crawl subdomains (blog.example.com, shop.example.com ...)
  --path-prefix <p>     Only crawl URLs whose path starts with p (e.g. /docs)
  --include <regex>     Only crawl URLs matching this regex
  --exclude <regex>     Never crawl URLs matching this regex
  --no-sitemap          Don't seed the crawl from sitemap.xml
  --ignore-robots       Don't obey robots.txt (only for sites you own or may scrape)

WHAT TO SAVE
  --out <dir>           Output folder (default: ./scraped/<host>-<timestamp>)
  --no-assets           Don't save images, CSS, JS, fonts and media
  --no-files            Don't download linked documents (PDF, DOCX, XLSX, ZIP ...)
  --no-screenshots      Don't take full-page screenshots
  --mhtml               Also save each page as a single-file .mhtml web archive
  --max-file-mb <n>     Skip any single file larger than n MB (default 100)

GOING DEEPER (on unless noted)
  --no-mobile           Don't take the second, phone-width screenshot
  --ocr                 Also read the text inside images (off by default: slow)
  --no-interact         Don't click tabs, accordions, "show more" and "next" to reveal content
  --no-doc-text         Don't read the text inside PDFs, Word, Excel and PowerPoint files
  --search <words>      Also look these comma-separated words up through the site's own search
  --no-data-links       Don't follow addresses found inside the site's background data

PAGE BEHAVIOUR
  --wait <ms>           Extra wait after each page loads
  --wait-for <selector> Wait for this CSS selector before scraping each page
  --click <selector>    Keep clicking this (e.g. a "Load more" button) until it disappears
  --max-clicks <n>      Limit for --click (default 30)
  --scroll-ms <n>       Max time spent scrolling to trigger lazy content (default 15000)
  --timeout <ms>        Page load timeout (default 45000)
  --retries <n>         Retries for pages that fail to load (default 2)

SIGNING IN
  When a page needs a sign-in, a browser window opens for you to sign in yourself; the
  crawl then carries on with your session. Your password is never seen or stored.
  --login               Open the sign-in window before the crawl starts
  --state <file>        Remember the session in this file and reuse it next time
  --no-login-window     Never open a window; just list the pages that need a sign-in

BROWSER / SPEED
  --headful             Show the browser while crawling
  --user-agent <ua>     Custom user agent
  --viewport <WxH>      Browser size (default 1366x900)
  --insecure            Ignore HTTPS certificate errors
  --no-self-check       Skip the accuracy check (a few pages re-read slowly at the end and compared)
  --speed <pace>        gentle, balanced (default) or fast: how many pages are open together, adapting to the site
  --concurrency <n>     Set the pace yourself: pages scraped in parallel
  --delay <ms>          Set the pace yourself: shortest gap between opening two pages
  --resume              Continue an interrupted crawl (use with the same --out folder)
`;

function die(msg) { console.error(msg); process.exit(1); }
function parseArgs(argv) {
  const o = { _: [], interactive: !!process.stdin.isTTY };
  const num = (v, name) => { const n = Number(v); if (!isFinite(n)) die(`--${name} needs a number`); return n; };
  const VALUE = { files: 'files_', section: 'section', contains: 'contains', result: 'result', search: 'searchTerms', lenses: 'lensFamilies', format: 'format', families: 'families', detail: 'detail', list: 'list', out: 'out', 'path-prefix': 'pathPrefix', include: 'include', exclude: 'exclude', state: 'state', 'user-agent': 'userAgent', viewport: 'viewport', 'wait-for': 'waitFor', click: 'click', speed: 'speed', topic: 'topic' };
  const NUM = { 'sites-at-once': 'sitesAtOnce', 'max-depth': 'maxDepth', concurrency: 'concurrency', delay: 'delay', 'max-file-mb': 'maxFileMb', timeout: 'timeout', wait: 'wait', 'max-clicks': 'maxClicks', 'scroll-ms': 'scrollMs', retries: 'retries' };
  const FLAG = { subdomains: ['subdomains', true], 'no-assets': ['assets', false], 'no-files': ['files', false], 'no-screenshots': ['screenshots', false], 'no-sitemap': ['sitemap', false], 'ignore-robots': ['robots', false], mhtml: ['mhtml', true], ocr: ['ocr', true], 'no-mobile': ['mobileScreenshots', false], 'no-self-check': ['selfCheck', false], 'no-interact': ['interact', false], 'no-doc-text': ['docText', false], 'no-data-links': ['discoverFromData', false], resume: ['resume', true], headful: ['headful', true], insecure: ['insecure', true], login: ['loginFirst', true], 'no-login-window': ['interactive', false] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const [flag, inline] = a.slice(2).split(/=(.*)/s);
    const val = () => (inline !== undefined ? inline : argv[++i] ?? die(`--${flag} needs a value`));
    if (flag === 'help') { console.log(HELP); process.exit(0); }
    else if (flag === 'max-pages') o.maxPages = num(val(), flag) || Infinity;
    else if (flag === 'single') { o.maxPages = 1; o.sitemap = false; }
    else if (VALUE[flag]) o[VALUE[flag]] = val();
    else if (NUM[flag]) o[NUM[flag]] = num(val(), flag);
    else if (FLAG[flag]) o[FLAG[flag][0]] = FLAG[flag][1];
    else die(`Unknown option --${flag}. Run with --help.`);
  }
  return o;
}

async function runOne(url, opts, label) {
  let crawl;
  try { crawl = new Crawl(url, opts); } catch (e) { console.error(label + e.message); return null; }
  crawl.on('log', (m) => console.log(label + m));
  let rl = null;
  crawl.on('human', (h) => {
    if (h.state === 'open' && process.stdin.isTTY) {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(label + '  Finish in the browser window. It continues by itself once you are in - or press Enter here to continue now (type "skip" to carry on without): ', (a) => (/^s/i.test(a) ? crawl.skipHuman() : crawl.continueHuman()));
    } else if (h.state === 'done' && rl) { rl.close(); rl = null; }
  });
  running.add(crawl);
  try {
    const summary = await crawl.run();
    if (summary.errors.length) console.log(`${label}${summary.errors.length} download errors (listed in site.json).`);
    console.log(`${label}Open: ${crawl.outDir}`);
    return { url, outDir: crawl.outDir, summary };
  } catch (e) { console.error(label + (e.message || e)); return { url, error: e.message }; }
  finally { running.delete(crawl); }
}

const running = new Set();
(async () => {
  const { _: urls, list, sitesAtOnce = 2, format, families, detail, ...opts } = parseArgs(process.argv.slice(2));
  if (urls[0] === 'lenses') { const L = require('./lib/lenses'); for (const f of L.families()) console.log(`${String(f.id).padStart(2)}  ${f.name} (${f.lenses} lenses)`); console.log(`\n${L.totalLenses} lenses in all. Use --lenses 6,13 to scrape for chosen families, or --families 6,13 when building a report.`); process.exit(0); }
  if (urls[0] === 'export') {
    const ex = require('./lib/exporter');
    if (!urls[1]) { const o = ex.options(); console.log('Topics (--topic):  ' + o.topics.map((d) => d.id).join(', ') + '\nData sets (--include):  ' + o.datasets.map((d) => d.id).join(', ') + '\nFile groups (ZIP only):  ' + o.files.map((d) => d.id).join(', ') + '\nFormats:  ' + o.formats.map((d) => d.id).join(', ')); process.exit(0); }
    try { const r = await ex.buildExport(path.resolve(urls[1]), { topic: opts.topic, include: opts.topic && !opts.include ? [] : String(opts.include || 'pages').split(','), files: (opts.files_ || '').split(',').filter(Boolean), format: format || (opts.topic ? undefined : 'xlsx'), section: opts.section, contains: opts.contains, result: opts.result }); const to = path.resolve(opts.out || path.join(urls[1], r.filename)); fs.writeFileSync(to, r.buffer); console.log(`Export written: ${to}`); process.exit(0); } catch (e) { die(e.message); }
  }
  if (urls[0] === 'report') {
    if (!urls[1]) die('Usage: node scrape.js report <scrape folder> [--format docx] [--families 6,13] [--detail full|findings|summary] [--out file]');
    try { const r = await require('./lib/report').buildReport(path.resolve(urls[1]), { format: format || 'docx', families: (families || '').split(',').map(Number).filter(Boolean), detail: detail || 'full' }); const to = path.resolve(opts.out || path.join(urls[1], r.filename)); fs.writeFileSync(to, r.buffer); console.log(`Report written: ${to}`); process.exit(0); } catch (e) { die(e.message); }
  }
  if (list) {
    const text = fs.readFileSync(list, 'utf8');
    urls.push(...(text.match(/https?:\/\/[^\s"'<>,;)]+/gi) || []), ...text.split(/[\r\n,;\t]+/).map((x) => x.trim().replace(/^"|"$/g, '')).filter((x) => /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(x)));
  }
  const sites = [...new Set(urls)];
  if (!sites.length) { console.log(HELP); process.exit(1); }
  let stops = 0, stopped = false;
  process.on('SIGINT', () => { if (stops++) process.exit(1); stopped = true; console.log('\nStopping after the current pages... (Ctrl+C again to quit now; use --resume to continue later)'); running.forEach((c) => c.stop()); });

  if (sites.length === 1) { const r = await runOne(sites[0], opts, ''); process.exit(r && !r.error ? 0 : 1); }

  // Several websites: each gets its own folder; a few run side by side.
  const parent = path.resolve(opts.out || path.join('scraped', 'batch-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)));
  fs.mkdirSync(parent, { recursive: true });
  console.log(`Scraping ${sites.length} websites, ${Math.min(sitesAtOnce, sites.length)} at a time, into ${parent}\n`);
  const results = []; const used = new Set(); let next = 0;
  const lane = async () => {
    while (next < sites.length && !stopped) {
      const url = sites[next++];
      let host; try { host = new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { host = 'site-' + next; }
      let name = host; for (let i = 2; used.has(name); i++) name = `${host}-${i}`; used.add(name);
      results.push(await runOne(url, { ...opts, out: path.join(parent, name) }, `[${name}] `) || { url, error: 'invalid address' });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(sitesAtOnce, sites.length)) }, lane));
  const rows = results.map((r) => ({ website: r.url, folder: r.outDir, pages: r.summary ? r.summary.stats.pages : 0, complete: !!(r.summary && r.summary.complete), needSignIn: r.summary ? r.summary.stats.pagesNeedingSignIn : 0, error: r.error }));
  fs.writeFileSync(path.join(parent, 'batch.json'), JSON.stringify(rows, null, 2));
  console.log(`\nBatch finished: ${rows.filter((r) => !r.error).length} of ${sites.length} websites scraped, ${rows.reduce((n, r) => n + r.pages, 0)} pages in total.\nSummary: ${path.join(parent, 'batch.json')}`);
  process.exit(rows.some((r) => r.error) ? 1 : 0);
})();
