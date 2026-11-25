'use strict';
// Dashboard test: start the server, drop in a URL through the real UI, let the scripted
// "person" sign in when the window opens, then check the API and take screenshots.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const startSite = require('./server');
const shots = process.argv[2] || os.tmpdir();
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });
(async () => {
  const { server: site, url } = await startSite();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-dash-'));
  const port = 4900 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--no-open', '--port', port, '--data', data], { env: { ...process.env, DEEPSCRAPE_TEST_LOGIN: '1' }, stdio: 'inherit' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 1500));
  const dash = `http://localhost:${port}`;
  let fail = 0; const check = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); };
  let browser; try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(dash);
  await page.screenshot({ path: path.join(shots, 'dash-1-start.png') });
  await page.fill('#url', url); await page.click('details.opts summary'); await page.fill('#o-click', '#more'); await page.click('#go');
  await page.waitForSelector('#jobhead h2');
  let sawBanner = false, midShot = false;
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(500);
    if (!sawBanner && await page.$('#human')) { sawBanner = true; await page.screenshot({ path: path.join(shots, 'dash-2-signin.png') }); }
    const jobs = await (await fetch(dash + '/api/jobs')).json();
    if (!midShot && jobs[0].stats.pages >= 6) { midShot = true; await page.screenshot({ path: path.join(shots, 'dash-3-running.png') }); }
    if (['done', 'failed', 'partial', 'stopped'].includes(jobs[0].status)) break;
  }
  const jobs = await (await fetch(dash + '/api/jobs')).json(); const id = jobs[0].id;
  const j = (p) => fetch(`${dash}/api/jobs/${id}${p}`).then((r) => r.json());
  check('job finished', jobs[0].status === 'done', jobs[0].status + ' ' + (jobs[0].error || ''));
  check('sign-in banner was shown', sawBanner);
  const pages = await j('/pages');
  check('members-only pages scraped after sign-in', pages.some((p) => p.url.endsWith('/members/reports')));
  check('search finds member-only text', (await j('/search?q=revenue')).total >= 1);
  check('images / hidden data / links lists', (await j('/images')).total >= 2 && (await j('/api')).total >= 3 && (await j('/links')).total > 50);
  check('files list', (await j('/files')).downloads.some((f) => f.path.endsWith('guide.pdf')));
  check('search reaches inside documents', (await j('/search?q=R98765')).results.some((r) => r.document));
  check('documents list with text', (await j('/files')).documents.some((x) => x.kind === 'PDF' && x.words > 5));
  const lr = await j('/lenses?family=13'); const lq = await j('/lenses?q=contrast');
  check('lens review per family and by search', lr.overview.length === 23 && lr.families[0].lenses.length === 100 && lq.families.length > 0);
  for (const f of ['docx', 'xlsx', 'pdf', 'html', 'md', 'csv', 'json']) { const r = await fetch(`${dash}/api/jobs/${id}/report?format=${f}&families=5,13&detail=findings`); const b = Buffer.from(await r.arrayBuffer()); check(`report download: ${f}`, r.status === 200 && b.length > 2000 && /attachment/.test(r.headers.get('content-disposition')), r.status + ' ' + b.length); }
  // your own AI, through the dashboard, against a stand-in service
  const http = require('http');
  const mock = http.createServer((q, r) => { let b = ''; q.on('data', (x) => (b += x)); q.on('end', () => { const nums = [...b.matchAll(/\\n(\d+)\. /g)].map((m) => +m[1]); const reply = /Lenses and their facts/.test(b) ? JSON.stringify({ summary: 'Mixed.', lenses: nums.map((n) => ({ n, rating: 'weak', verdict: 'V' + n, action: '' })) }) : /Are you there/.test(b) ? 'ready' : 'The site is a test site.'; r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ choices: [{ message: { content: reply } }] })); }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const post = (p, body) => fetch(dash + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
  const conn = await post('/api/ai', { provider: 'custom', baseUrl: 'http://127.0.0.1:' + mock.address().port + '/v1', model: 'local-model', apiKey: 'my-secret-key', name: 'My AI' });
  const listed = await (await fetch(dash + '/api/ai')).json();
  check('AI connection saved; key never sent back to the page', listed.connections.length === 1 && listed.connections[0].hasKey && !JSON.stringify(listed).includes('my-secret-key') && listed.providers.length >= 8);
  check('AI connection test', (await post(`/api/ai/${conn.id}/test`)).ok === true);
  await post(`/api/jobs/${id}/verdicts`, { families: [5] });
  let vs; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); vs = await j('/verdicts'); if (vs.status && vs.status.state !== 'running') break; }
  check('AI verdicts through the dashboard', vs.status.state === 'done' && (await j('/lenses?family=5')).families[0].lenses.some((l) => l.ai && l.ai.rating === 'weak'), JSON.stringify(vs.status));
  const ans = await post(`/api/jobs/${id}/ask`, { question: 'What is this site?' });
  check('ask AI through the dashboard', ans.answer === 'The site is a test site.' && (await j('/ask')).length === 1, JSON.stringify(ans).slice(0, 120));
  const sc = await post('/api/schedules', { url, every: 'week', at: '06:00', options: { maxPages: 2 } });
  check('repeating scrape saved with a next run time', sc.next > Date.now() && (await (await fetch(dash + '/api/schedules')).json()).length === 1);
  await fetch(`${dash}/api/schedules/${sc.id}`, { method: 'DELETE' });
  check('no earlier scrape to compare with yet', Array.isArray(await j('/earlier')));
  mock.close();
  const eo = await (await fetch(dash + '/api/export-options')).json(); const ee = await j('/export/estimate?include=pages,links,tables&files=screenshots');
  check('export choices and preview through the dashboard', eo.datasets.length > 20 && eo.presets.length >= 8 && ee.rows.pages === pages.length && ee.files.screenshots.files > 0);
  for (const f of ['xlsx', 'zip', 'md']) { const r = await fetch(`${dash}/api/jobs/${id}/export?include=pages,links,tables&files=screenshots&format=${f}&section=/product`); const b = Buffer.from(await r.arrayBuffer()); check(`custom export download: ${f}`, r.status === 200 && b.length > 800 && /product/.test(r.headers.get('content-disposition')), r.status + ' ' + b.length); }
  const pz = await fetch(`${dash}/api/jobs/${id}/page/${pages[0].id}/zip`); check('single page download', pz.status === 200 && Buffer.from(await pz.arrayBuffer()).includes('page.json'));
  const full = await j('');
  check('summary with issues + contacts', full.summary.issues.brokenInternalLinks.length >= 1 && full.summary.contacts.emails.length === 1);
  const zip = await fetch(`${dash}/api/jobs/${id}/zip`); const zb = Buffer.from(await zip.arrayBuffer());
  check('zip download', zb.slice(0, 2).toString() === 'PK' && zb.length > 20000, zb.length);
  check('saved sign-in listed', (await (await fetch(dash + '/api/sessions')).json()).length === 1);
  const trav = await fetch(`${dash}/files/${id}/..%2F..%2Fsessions%2F127.0.0.1.json`);
  check('cannot read outside the scrape folder', trav.status === 403 || trav.status === 404, trav.status);
  const xs = await fetch(`${dash}/api/jobs`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"url":"https://example.com"}' });
  check('other websites cannot start scrapes', xs.status === 403);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, 'dash-4-done.png'), fullPage: true });
  for (const s2 of ['security', 'design', 'accessibility', 'performance', 'privacy', 'infrastructure', 'content']) { await page.click('#tabs button[data-t=audit]'); await page.click(`.subtabs button[data-s=${s2}]`); await page.waitForTimeout(250); if (s2 === 'security' || s2 === 'design' || s2 === 'all') await page.screenshot({ path: path.join(shots, `dash-9-${s2}.png`) }); }
  await page.click('#tabs button[data-t=audit]'); await page.click('.subtabs button[data-s=all]'); await page.waitForSelector('#famcards button'); await page.click('#famcards button[data-fam="13"]'); await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, 'dash-10-lenses.png') });
  await page.click('#tabs button[data-t=export]'); await page.waitForSelector('.topicgrid .topic'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, 'dash-10-export-topics.png'), fullPage: true });
  { const n = await page.locator('.topicgrid .topic').count(); const href = await page.locator('.topicgrid .topic a.btn.best').first().getAttribute('href');
    const r = await fetch(dash + href); const buf = Buffer.from(await r.arrayBuffer());
    check('export by topic: ten topics, and the first one downloads', n === 10 && r.ok && buf.length > 2000, `${n} ${r.status} ${buf.length}`);
    const zr = await fetch(dash + href.replace(/topic=\w+/, 'topic=design').replace(/format=\w+/, 'format=zip')); const zb = Buffer.from(await zr.arrayBuffer()).toString('latin1');
    check('design pack carries tokens, a starter stylesheet, a style sheet and a report', ['design-tokens.css', 'design-tokens.json', 'starter.css', 'style-sheet.html', 'report.html', 'data.xlsx'].every((x) => zb.includes(x)));
    const sr = await fetch(dash + href.replace(/topic=\w+/, 'topic=security').replace(/format=\w+/, 'format=zip')); const sb = Buffer.from(await sr.arrayBuffer()).toString('latin1');
    check('security pack carries the score and the header set-up files', ['scores.json', 'security-setup/nginx.conf', 'security-setup/apache.htaccess', 'security-setup/express.js', 'report.html'].every((x) => sb.includes(x)));
    const md = await (await fetch(dash + href.replace(/topic=\w+/, 'topic=security').replace(/format=\w+/, 'format=md'))).text();
    check('security report has a summary, a score with deductions and page-by-page tables', /## Summary/.test(md) && /## Score: \d+ out of 100 \(grade [A-F]\+?\)/.test(md) && /Protective headers, page by page/.test(md) && /Security facts, page by page/.test(md));
    const site = await (await fetch(dash + href.split('/export')[0])).json();
    check('the scrape carries five scores and an overall grade', site.summary && site.summary.scores && Object.keys(site.summary.scores.areas).length === 5 && typeof site.summary.scores.overall === 'number', JSON.stringify(site.summary && site.summary.scores).slice(0, 200)); }
  await page.click('[data-es=custom]'); await page.waitForSelector('#exgo'); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(shots, 'dash-11-export.png'), fullPage: true }); await page.click('[data-preset=designer]'); await page.waitForTimeout(900); await page.locator('.summarybar').screenshot({ path: path.join(shots, 'dash-11b-export-summary.png') });
  await page.click('[data-es=lens]'); await page.waitForSelector('#repfams'); await page.click('[data-es=raw]'); await page.waitForTimeout(200); await page.click('[data-es=custom]');
  await page.click('#aibtn'); await page.waitForSelector('#ai-add'); await page.screenshot({ path: path.join(shots, 'dash-12-your-ai.png') }); await page.click('#aibtn');
  await page.click('#tabs button[data-t=askai]'); await page.waitForSelector('#askq'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, 'dash-13-ask-ai.png') });
  for (const t of ['changes', 'pages', 'search', 'images', 'files', 'api', 'links', 'issues', 'about', 'log', 'export']) { await page.click(`#tabs button[data-t=${t}]`); await page.waitForTimeout(350); if (t === 'issues' || t === 'images') await page.screenshot({ path: path.join(shots, `dash-5-${t}.png`) }); }
  await page.click('#tabs button[data-t=pages]'); await page.click('#prow tr:nth-child(2)'); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(shots, 'dash-6-drawer.png') });
  for (const t of ['content', 'text', 'preview', 'details', 'audit', 'links', 'images', 'tables', 'data', 'network', 'source', 'json']) { await page.click(`#dtabs button[data-t=${t}]`); await page.waitForTimeout(300); }
  await page.click('#dtabs button[data-t=details]'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'dash-7-details.png') });
  await page.click('#dclose'); await page.click('#theme'); await page.click('#tabs button[data-t=overview]'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, 'dash-8-dark.png') });
  check('no browser errors in the dashboard', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.kill('SIGKILL'); site.close();
  console.log(fail ? `\n${fail} failed` : '\nAll dashboard checks passed');
  process.exit(fail ? 1 : 0);
})();
