'use strict';
// Sign-in flow test: the crawl hits a members-only area, opens the sign-in window,
// a scripted "person" signs in to the local test site, and the crawl carries on.
// Needs a display (on Linux servers run under xvfb-run).
const fs = require('fs');
const os = require('os');
const path = require('path');
const startServer = require('./server');
const { Crawl } = require('../lib/crawler');

(async () => {
  const { server, url } = await startServer();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-login-'));
  const stateFile = path.join(out, '..', path.basename(out) + '-session.json');
  const events = [];
  const crawl = new Crawl(url, {
    out, interactive: true, state: stateFile, delay: 0, screenshots: false,
    // Stands in for the person at the keyboard. Test credentials for the local test site only.
    loginDriver: async (page) => { await page.fill('input[name=user]', 'test'); await page.fill('input[name=pw]', 'test-only'); await page.click('#go'); },
  });
  crawl.on('human', (h) => events.push(h.state + (h.ok === undefined ? '' : ':' + h.ok)));
  crawl.on('log', (m) => console.log(m));
  const site = await crawl.run();

  let fail = 0;
  const check = (name, ok, extra = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
  const page = (p) => { const row = site.pages.find((x) => new URL(x.url).pathname === p); return row && JSON.parse(fs.readFileSync(path.join(out, 'pages', row.id, 'page.json'), 'utf8')); };
  check('sign-in window opened once and finished by itself', events.join(',') === 'open,done:true', events.join(','));
  check('members page scraped after sign-in', !!page('/members') && page('/members').text.visible.includes('Welcome back'));
  check('deeper members-only page scraped', !!page('/members/reports') && page('/members/reports').text.visible.includes('revenue 12345'));
  check('nothing left behind the sign-in', site.needSignIn.length === 0 && site.signedIn === true);
  check('session cookie value hidden in results', !fs.readFileSync(path.join(out, 'pages.jsonl'), 'utf8').includes('secret-session-value'));
  check('session remembered for next time', fs.existsSync(stateFile) && fs.readFileSync(stateFile, 'utf8').includes('secret-session-value'));

  // Second run reuses the saved session: no window should be needed.
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-login2-'));
  const again = new Crawl(url + '/members', { out: out2, interactive: true, state: stateFile, delay: 0, screenshots: false, assets: false, maxPages: 3, sitemap: false });
  const ev2 = []; again.on('human', (h) => ev2.push(h.state));
  const site2 = await again.run();
  check('saved session reused without a window', ev2.length === 0 && site2.pages.some((p) => p.title === 'Members'), ev2.join(','));

  // Closing the window without signing in: asked once, never again, and the pages are listed as waiting.
  fs.rmSync(stateFile, { force: true });
  const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-login3-'));
  const shy = new Crawl(url, { out: out3, interactive: true, delay: 0, screenshots: false, assets: false, interact: false, loginDriver: async (page) => { await page.waitForTimeout(1500); await page.context().browser().close(); } });
  const ev3 = []; shy.on('human', (h) => ev3.push(h.state + (h.ok === undefined ? '' : ':' + h.ok)));
  const site3 = await shy.run();
  check('window closed: opened exactly once, never re-opened', ev3.join(',') === 'open,done:false', ev3.join(','));
  check('closed window: both member pages listed as waiting, site marked as skipped', site3.needSignIn.length === 2 && site3.signIns.length === 1 && site3.signIns[0].state === 'declined' && site3.signIns[0].pagesWaiting === 2 && site3.signedIn === false, JSON.stringify(site3.signIns));
  check('the rest of the site was still scraped', site3.pages.length >= 14, site3.pages.length);

  server.close();
  console.log(fail ? `\n${fail} failed` : '\nAll sign-in checks passed');
  process.exit(fail ? 1 : 0);
})();
