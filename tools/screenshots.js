'use strict';
// Takes the screenshots used in the README, from a scrape of the built-in practice site.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const startSite = require('../test/server');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'images'));
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
(async () => {
  const sites = [await startSite(), await startSite()];
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-shots-')); const port = 5100 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--no-open', '--port', port, '--data', data], { env: { ...process.env, DEEPSCRAPE_TEST_LOGIN: '1' }, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 1500)); const dash = `http://localhost:${port}`;
  let browser; try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const shot = async (name) => { await page.evaluate(() => { const j = document.querySelector('#jobview'); if (j && !j.hidden) window.scrollTo(0, j.offsetTop - 12); else window.scrollTo(0, 0); }); await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, name + '.png') }); console.log(name); };
  const done = async () => { for (let i = 0; i < 300; i++) { await page.waitForTimeout(500); const jobs = await (await fetch(dash + '/api/jobs')).json(); if (jobs.length && jobs.every((j) => !j.live && ['done', 'partial', 'failed', 'stopped'].includes(j.status))) return jobs; } throw new Error('scrape did not finish'); };
  await page.goto(dash); await page.screenshot({ path: path.join(out, 'start.png'), clip: { x: 0, y: 0, width: 1440, height: 520 } }); console.log('start');
  await page.fill('#url', sites[0].url); await page.click('details.opts summary'); await page.fill('#o-click', '#more'); await page.click('details.opts summary'); await page.click('#go');
  await page.waitForSelector('#jobhead h2'); await page.waitForTimeout(6000); await shot('running');
  await done(); await page.waitForTimeout(2500); await shot('overview');
  await page.click('#tabs button[data-t=audit]'); await page.waitForSelector('#famcards button'); await page.click('#famcards button[data-fam="13"]'); await page.waitForTimeout(600); await shot('lenses');
  await page.click('.subtabs button[data-s=security]'); await shot('security');
  await page.click('.subtabs button[data-s=design]'); await shot('design');
  await page.click('#tabs button[data-t=export]'); await page.waitForSelector('#exgo'); await page.waitForTimeout(1300); await shot('export');
  await page.click('#tabs button[data-t=pages]'); await page.click('#prow tr:nth-child(1)'); await page.waitForTimeout(900); await page.screenshot({ path: path.join(out, 'page.png') }); console.log('page'); await page.click('#dclose');
  await page.click('#aibtn'); await page.waitForSelector('#ai-add'); await page.evaluate(() => window.scrollTo(0, document.querySelector('#aiview').offsetTop - 12)); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'your-ai.png'), clip: { x: 0, y: 0, width: 1440, height: 470 } }); console.log('your-ai'); await page.click('#aibtn');
  await page.click('#newbtn'); await page.fill('#url', sites[0].url + '\n' + sites[1].url + '/table'); await page.click('#go'); await page.waitForSelector('#brow tr'); await done(); await page.waitForTimeout(2500); await shot('batch');
  await page.click('#theme'); await page.click('#brow tr:nth-child(1)'); await page.waitForSelector('#mosaic'); await page.waitForTimeout(600); await shot('dark');
  await browser.close(); srv.kill('SIGKILL'); sites.forEach((s) => s.server.close()); process.exit(0);
})();
