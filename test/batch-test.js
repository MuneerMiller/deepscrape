'use strict';
// Batch test: three websites dropped in at once, scraped side by side, shown and exported together.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn, execFile } = require('child_process');
const { chromium } = require('playwright');
const startSite = require('./server');
const shots = process.argv[2] || os.tmpdir();
(async () => {
  const sites = [await startSite(), await startSite(), await startSite()];
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-batch-'));
  const port = 5000 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--no-open', '--port', port, '--data', data], { env: { ...process.env, DEEPSCRAPE_TEST_LOGIN: '1' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const dash = `http://localhost:${port}`;
  let fail = 0; const check = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); };
  let browser; try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(dash);
  const listFile = path.join(data, 'sites.csv'); fs.writeFileSync(listFile, `name,website\nOne,${sites[0].url}\nTwo,${sites[1].url}\n`);
  await page.setInputFiles('#importfile', listFile);
  await page.waitForFunction(() => document.querySelector('#url').value.split('\n').filter(Boolean).length >= 2);   // the list is read a moment after it is chosen
  await page.fill('#url', (await page.inputValue('#url')) + '\n' + sites[2].url + '\n' + sites[0].url);   // one more, plus a duplicate
  check('list imported and counted', (await page.textContent('#go')) === 'Scrape 3 websites', await page.textContent('#go'));
  await page.click('#go');
  await page.waitForSelector('#brow tr');
  let maxSide = 0, id = null, shot = false, b;
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(400);
    const jobs = await (await fetch(dash + '/api/jobs')).json(); id = jobs[0].batch.id;
    maxSide = Math.max(maxSide, jobs.filter((j) => j.live).length);
    b = await (await fetch(`${dash}/api/batches/${id}`)).json();
    if (!shot && b.jobs.filter((j) => j.stats.pages > 3).length >= 2) { shot = true; await page.screenshot({ path: path.join(shots, 'batch-running.png') }); }
    if (b.jobs.every((j) => ['done', 'failed', 'partial', 'stopped'].includes(j.status))) break;
  }
  await new Promise((r) => setTimeout(r, 1500)); b = await (await fetch(`${dash}/api/batches/${id}`)).json();   // results are readable a moment after the last status change
  check('three websites in one batch, duplicate dropped', b.jobs.length === 3);
  check('all three finished', b.jobs.every((j) => j.status === 'done'), b.jobs.map((j) => j.status + (j.error || '')).join(','));
  check('never more than two side by side', maxSide === 2, maxSide);
  check('side-by-side figures for each website', b.jobs.every((j) => j.highlights && j.highlights.pages >= 16 && j.highlights.serious >= 1 && Array.isArray(j.highlights.builtWith)), JSON.stringify(b.jobs.map((j) => j.highlights && [j.highlights.pages, j.highlights.serious, j.status])));
  check('every site fully scraped', b.jobs.every((j) => j.stats.pages >= 15), b.jobs.map((j) => j.stats.pages).join(','));
  const csv = await (await fetch(`${dash}/api/batches/${id}/summary.csv`)).text();
  check('summary for Excel', csv.trim().split('\n').length === 4 && csv.includes('info@testsite.example'));
  const zb = Buffer.from(await (await fetch(`${dash}/api/batches/${id}/zip`)).arrayBuffer());
  check('combined zip has a folder per website', ['127.0.0.1/site.json', '127.0.0.1-2/site.json', '127.0.0.1-3/site.json'].every((n) => zb.includes(n)));
  await page.waitForTimeout(2000); await page.screenshot({ path: path.join(shots, 'batch-done.png') });
  await page.click('#brow tr:nth-child(2)'); await page.waitForSelector('#mosaic');
  check('open one website from the batch, with a way back', !!(await page.$('[data-back]')));
  await page.click('[data-back]'); await page.waitForSelector('#brow tr');
  check('no browser errors', errs.length === 0, errs.join(' | '));
  await browser.close(); srv.kill('SIGKILL');

  // Command line with two websites
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-clibatch-'));
  await new Promise((r) => execFile(process.execPath, [path.join(__dirname, '..', 'scrape.js'), sites[0].url, sites[1].url + '/table', '--max-pages', '2', '--no-sitemap', '--no-screenshots', '--out', out], () => r()));
  const rows = fs.existsSync(path.join(out, 'batch.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'batch.json'), 'utf8')) : [];
  check('command line: two websites, a folder each', rows.length === 2 && rows.every((r) => r.pages === 2 && fs.existsSync(path.join(r.folder, 'site.json'))) && fs.existsSync(path.join(out, '127.0.0.1-2')), JSON.stringify(rows));
  // A scrape focused on two lens families skips what they do not need, and reports on just those by default.
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-focus-'));
  await new Promise((r) => execFile(process.execPath, [path.join(__dirname, '..', 'scrape.js'), sites[0].url, '--lenses', '13,15', '--max-pages', '4', '--no-sitemap', '--out', out2], () => r()));
  const fs2 = JSON.parse(fs.readFileSync(path.join(out2, 'site.json'), 'utf8')); const pg = fs.readdirSync(path.join(out2, 'pages'))[0];
  check('focused scrape: only chosen families, unneeded collectors skipped', fs2.lensFamilies.join() === '13,15' && fs2.collectorsSkipped.includes('screenshots') && !fs.existsSync(path.join(out2, 'pages', pg, 'screenshot.png')) && fs2.stats.lenses.families === 2 && fs2.perspectives.security.findings.length > 0, JSON.stringify([fs2.lensFamilies, fs2.collectorsSkipped]));
  await new Promise((r) => execFile(process.execPath, [path.join(__dirname, '..', 'scrape.js'), 'report', out2, '--format', 'xlsx'], () => r()));
  check('command-line report', fs.readdirSync(out2).some((f) => /2-lens-families\.xlsx$/.test(f)), fs.readdirSync(out2).join(' '));
  sites.forEach((s) => s.server.close());
  console.log(fail ? `\n${fail} failed` : '\nAll batch checks passed');
  process.exit(fail ? 1 : 0);
})();
