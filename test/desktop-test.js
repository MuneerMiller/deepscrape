// Checks the desktop app: it starts the scraper itself, shows the dashboard, answers in-page questions, and stops cleanly.
// Run: node test/desktop-test.js   (on Linux without a screen: xvfb-run -a node test/desktop-test.js)
const { _electron: electron } = require('playwright');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');

const get = (url) => new Promise((resolve) => { http.get(url, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve(b)); }).on('error', () => resolve(null)); });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-desktop-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js'), '--no-sandbox'], env: { ...process.env, DEEPSCRAPE_DATA: data } });
  const page = await app.firstWindow();
  await page.waitForURL(/localhost:\d+/, { timeout: 40000 });
  const base = new URL(page.url()).origin.replace('localhost', '127.0.0.1');
  check('window shows the dashboard', (await page.locator('#brand h1').textContent()).includes('DeepScrape'));
  const health = JSON.parse(await get(base + '/api/health'));
  check('scraper started by the app', health && health.app === 'deepscrape');
  check('data goes to the chosen folder', health.data === data && fs.existsSync(path.join(data, 'jobs')));
  check('window title', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).includes('DeepScrape'));

  const answer = page.evaluate(() => ask('Repeat how often?', 'week', ['day', 'week', 'month']));
  await page.locator('dialog.ask select').selectOption('month'); await page.locator('dialog.ask button[value=ok]').click();
  check('question box returns the choice', (await answer) === 'month');
  const none = page.evaluate(() => ask('New page limit', '0'));
  await page.locator('dialog.ask button[value=cancel]').click();
  check('question box cancel returns nothing', (await none) === null);

  const second = await app.evaluate(({ app: a }) => a.hasSingleInstanceLock());
  check('only one copy runs at a time', second === true);

  const closed = new Promise((resolve) => app.process().once('exit', resolve));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
  check('closing the window quits the app', app.process().exitCode !== null);
  await new Promise((r) => setTimeout(r, 500));
  check('scraper stopped with it', (await get(base + '/api/health')) === null);
  fs.rmSync(data, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) failed` : '\nDesktop app: all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
