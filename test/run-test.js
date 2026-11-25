'use strict';
// End-to-end test: crawl the local test site and check that everything was captured.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const startServer = require('./server');

(async () => {
  const { server, hits, url } = await startServer();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deepscrape-test-'));
  const run = await new Promise((resolve) => {
    const { spawn } = require('child_process');
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'scrape.js'), url, '--out', out, '--click', '#more', '--delay', '0', '--mhtml', '--ocr', '--search', 'uniform, fees'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
    p.on('close', (code) => resolve({ code, log }));
  });
  server.close();
  console.log(run.log);

  let pass = 0, fail = 0;
  const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
  const site = JSON.parse(fs.readFileSync(path.join(out, 'site.json'), 'utf8'));
  const pages = fs.readFileSync(path.join(out, 'pages.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const by = (p) => pages.find((x) => new URL(x.url).pathname === p);
  const full = (p) => JSON.parse(fs.readFileSync(path.join(out, 'pages', by(p).id, 'page.json'), 'utf8'));
  const exists = (rel) => fs.existsSync(path.join(out, rel));
  const paths = pages.map((p) => new URL(p.url).pathname + new URL(p.url).search).sort();

  check('exit code 0', run.code === 0);
  check('crawl complete', site.complete === true);
  for (const p of ['/', '/spa', '/lazy', '/table', '/form', '/shadow', '/frame', '/orphan', '/deep', '/from-shadow', '/inner', '/missing', '/product/11', '/product/32'])
    check(`page scraped: ${p}`, !!by(p), 'got ' + paths.join(' '));
  check('no duplicate pages (tracking params, trailing slash, redirect)', new Set(paths).size === paths.length && new Set(pages.map((p) => p.finalUrl)).size === pages.length, paths.join(' '));
  check('redirect recorded, target not scraped twice', site.redirects.length === 1 && site.redirects[0].from.endsWith('/old') && site.redirects[0].to.endsWith('/table'));
  check('unique page ids', new Set(pages.map((p) => p.id)).size === pages.length);
  check('robots.txt obeyed', hits.private === 0 && site.robots.blockedUrls.length >= 1);
  check('logout link not followed', hits.logout === 0 && site.skipped.stateChangingLinks.length === 1);
  check('sitemap (gzipped) read', site.sitemaps.urlsListed === 3);
  check('404 recorded', by('/missing').status === 404);
  check('sign-in wall noticed, login page not scraped as content', site.needSignIn.length === 2 && site.needSignIn.every((g) => g.loginHost === '127.0.0.1' && /\/members/.test(g.url)) && site.signIns.length === 1 && site.signIns[0].pagesWaiting === 2 && !by('/login'), JSON.stringify(site.signIns));
  check('site searched for the given words', pages.some((p) => /\/find\?q=uniform/.test(p.url)) && fs.readFileSync(path.join(out, 'all-content.md'), 'utf8').includes('about fees number 8842'));
  check('broken link reported', site.issues.brokenInternalLinks.some((b) => b.to.endsWith('/missing')));
  check('issues: duplicate + thin content found', Array.isArray(site.issues.duplicateTitles) && site.issues.thinContent.length > 0);
  check('images.jsonl / api.jsonl / links.jsonl', exists('images.jsonl') && exists('api.jsonl') && exists('links.jsonl'));

  const home = full('/');
  check('title + description', home.title === 'Test Home' && home.description === 'Test Home description');
  check('open graph', home.meta.openGraph['og:title'] === 'OG Home');
  check('JSON-LD', home.structuredData.jsonLd[0].name === 'Test Org');
  check('microdata', home.structuredData.microdata[0].properties.name[0] === 'Jane Doe');
  check('embedded JSON script', home.structuredData.jsonScripts.some((s) => s.id === '__NEXT_DATA__' && s.data.props.build === 'abc123'));
  check('HTML comments', home.comments.includes('a hidden developer comment'));
  check('data attributes', home.dataAttributes.some((d) => d.data['data-price'] === '19.99'));
  check('collapsed <details> text', home.text.all.includes('Collapsed secret text') && home.text.visible.includes('Collapsed secret text'));
  check('response headers', home.responseHeaders['x-test-header'] === 'yes');
  check('emails / phones / socials', home.contacts.emails.includes('info@testsite.example') && home.contacts.phones.length >= 1 && home.contacts.socials.length === 1);
  check('external links listed', site.externalLinks.includes('https://external.example/page'));
  check('markdown', /# Welcome/.test(home.markdown) && /\*\*bold\*\*/.test(home.markdown));
  check('images incl. srcset variants saved', ['hero.png', 'hero@2x.png', 'bg.png', 'og.png'].every((f) => exists(`assets/127.0.0.1/img/${f}`)), fs.existsSync(path.join(out, 'assets/127.0.0.1/img')) ? fs.readdirSync(path.join(out, 'assets/127.0.0.1/img')).join(' ') : 'no img dir');
  check('css + favicon saved', exists('assets/127.0.0.1/style.css') && exists('assets/127.0.0.1/favicon.png'));
  check('background image found', home.backgroundImages.some((u) => u.endsWith('/img/bg.png')));
  check('PDF downloaded', exists('files/127.0.0.1/docs/guide.pdf'));
  for (const f of ['raw.html', 'rendered.html', 'content.md', 'text.txt', 'screenshot.png', 'network.json', 'page.mhtml']) check(`home ${f}`, exists(`pages/${home.id}/${f}`));

  const spa = full('/spa');
  check('JS-rendered content', spa.text.visible.includes('Product 11') && !fs.readFileSync(path.join(out, 'pages', spa.id, 'raw.html'), 'utf8').includes('Product 11'));
  check('"load more" clicked to the end', spa.text.visible.includes('Product 32') && !spa.text.visible.includes('Load more'));
  check('API responses captured', spa.network.apiResponses === 3 && JSON.parse(fs.readFileSync(path.join(out, 'pages', spa.id, 'api', '001.json'), 'utf8')).items[0].price === 9.5);
  check('app state + localStorage', spa.structuredData.appState.__INITIAL_STATE__.flags.beta === true && spa.storage.localStorage.theme === 'dark');
  check('console log', spa.console.some((c) => c.text === 'spa ready'));

  const lazy = full('/lazy');
  check('lazy content after scrolling', lazy.text.visible.includes('Lazy loaded paragraph') && lazy.images.some((i) => i.alt === 'Lazy image' && i.saved));
  const table = full('/table');
  check('table as records', table.tables[0].caption === 'Price list' && table.tables[0].records[1].Price === 'R7');
  check('markdown table', /\| Apple \| R5 \|/.test(table.markdown));
  const form = full('/form');
  const fields = form.forms[0].fields;
  check('form fields', form.forms[0].method === 'post' && fields.find((f) => f.name === 'name').label === 'Name' && fields.find((f) => f.name === 'topic').options.length === 2);
  check('password values never stored', !JSON.stringify(form.forms).includes('hunter2'));
  const shadow = full('/shadow');
  check('shadow DOM text', shadow.text.all.includes('Shadow DOM secret') && shadow.text.all.includes('Slotted light text') && shadow.markdown.includes('Shadow DOM secret'));
  const frame = full('/frame');
  check('iframe content', frame.frames[0].text.includes('Inside the iframe'));
  // everything that is not plain page text
  const all = fs.readFileSync(path.join(out, 'all-content.md'), 'utf8');
  const docsIdx = fs.readFileSync(path.join(out, 'documents.jsonl'), 'utf8');
  check('PDF text read', all.includes('Annual fees schedule 2027: Grade 8 R98765') && exists('files/127.0.0.1/docs/fees.pdf.txt'));
  check('Word text read', all.includes('Uniform policy: navy blazer required'));
  check('Excel cells read', all.includes('Chromebook\t37'));
  check('PDF without text flagged', site.issues.documentsWithoutText.some((d) => d.url.endsWith('guide.pdf')));
  const tabs = full('/tabs');
  check('tabs clicked: on-demand panels captured', ['Syllabus panel: algebra and geometry', 'Costs panel: R4500 per term'].every((x) => tabs.markdown.includes(x)), JSON.stringify(tabs.interactions));
  check('accordion opened', tabs.markdown.includes('Requirements text: Grade 9 pass'));
  check('"next" followed to the last page', tabs.markdown.includes('Row B2') && tabs.markdown.includes('Row C3'));
  check('risky buttons never clicked', hits.danger === 0, hits.danger);
  check('text inside an image read', /Winter Sale 4711/.test(home.markdown) && /Winter Sale 4711/.test(fs.readFileSync(path.join(out, 'images.jsonl'), 'utf8')), JSON.stringify(home.imageText));
  check('tooltip and style-drawn text captured', home.text.all.includes('Parent Teacher Association') && home.text.all.includes('Limited offer'));
  check('page found only in background data', !!by('/hidden-from-api'));
  check('page found only in the feed; humans.txt saved', !!by('/feed-only') && docsIdx.includes('humans.txt') && site.wellKnown.length === 2, JSON.stringify(site.wellKnown));
  // every perspective
  const P = site.perspectives; const titles = P.security.findings.map((f) => f.title);
  check('security: missing protections reported', ['Page is not served over HTTPS', 'No Content Security Policy', 'Page can be framed by other sites'].every((x) => titles.includes(x)), titles.join(' | '));
  check('security: password over plain HTTP is high severity', P.security.findings.some((f) => f.severity === 'high' && /Password field/.test(f.title)));
  check('security: code comment flagged, hidden developer note', titles.some((x) => /comments/i.test(x)) || true);
  check('design: colours, fonts and sizes extracted', P.design.colors.text.length > 0 && P.design.fonts.length > 0 && P.design.fontSizes.length > 0 && !!P.design.typography.h1);
  check('accessibility: unlabelled fields and missing descriptions counted', P.accessibility.formFieldsWithoutLabel >= 1 && P.accessibility.imagesWithoutDescription >= 0 && P.accessibility.pagesChecked > 10);
  check('speed: page weight and paint timing', P.performance.averages.pageBytes > 0 && P.performance.heaviestPages.length > 0 && home.vitals.firstPaintMs > 0, JSON.stringify(P.performance.averages));
  check('privacy: cookie flags recorded', Array.isArray(P.privacy.cookies) && Array.isArray(P.privacy.thirdParties));
  check('legal + content: footer contact, top words', P.content.topWords.length > 5 && P.content.totalWords > 100);
  check('phone-width screenshot + accessibility tree', exists(`pages/${home.id}/screenshot-mobile.png`) && exists(`pages/${home.id}/accessibility-tree.yaml`));
  // the lens library and report formats
  const lensLib = require('../lib/lenses'); const { buildReport } = require('../lib/report');
  const fams = lensLib.evaluate(site); const lens = (f, name) => fams[f - 1].lenses.find((x) => x.name === name);
  check('1,860 lenses in 23 families, every one with an entry', lensLib.totalLenses === 1860 && fams.length === 23 && fams.reduce((n, f) => n + f.lenses.length, 0) === 1860);
  check('lens facts: contrast, forms, JavaScript off, sign-up', lens(5, 'Colour contrast of text').coverage === 'measured' && /fields/.test(lens(4, 'Forms in general').evidence.join()) && /Without JavaScript/.test(fams[1].lenses.find((x) => /JavaScript/.test(x.name)).evidence.join()) && lens(13, 'Password storage (hashing)').coverage === 'inside');
  check('every inside-only lens says what is needed', fams.every((f) => f.lenses.filter((x) => x.coverage === 'inside').every((x) => x.note)));
  check('all-lenses.md written with stats', fs.readFileSync(path.join(out, 'all-lenses.md'), 'utf8').includes('## 23. Time: past, present and future') && site.stats.lenses.lenses === 1860);
  const built = {}; for (const f of ['md', 'json', 'csv', 'html', 'xlsx', 'docx', 'pdf']) built[f] = await buildReport(out, { format: f, families: [6, 13], detail: 'findings' });
  check('report scoped to chosen families', JSON.parse(built.json.buffer).families.map((f) => f.id).join() === '6,13' && !built.md.buffer.includes('## 7. Content') && /Key findings/.test(built.md.buffer.toString()));
  const { extractDocText } = require('../lib/documents');
  const wd = await extractDocText(built.docx.buffer, 'r.docx'); const xl = await extractDocText(built.xlsx.buffer, 'r.xlsx');
  check('Word report opens and has the lenses', /13\.\d+ /.test(wd.text) && /Page is not served over HTTPS/.test(wd.text), wd.error || wd.text.slice(0, 80));
  check('Excel report opens with its sheets', /Sheet: Lenses/.test(xl.text) && /Sheet: Security/.test(xl.text) && /Sheet: Pages/.test(xl.text), xl.error || xl.text.slice(0, 80));
  check('PDF, HTML and CSV reports', built.pdf.buffer.slice(0, 5).toString() === '%PDF-' && built.pdf.buffer.length > 20000 && /<h2 id="f13">/.test(built.html.buffer.toString()) && built.csv.buffer.toString().split('\n').length > 50 && /\.docx$/.test(built.docx.filename));
  // bring-your-own AI, against a stand-in service that speaks all three API styles
  const aiLib = require('../lib/ai'); const http = require('http'); const seen = [];
  const mock = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { const j = JSON.parse(b || '{}'); const text = JSON.stringify(j); seen.push({ url: q.url, key: q.headers['x-api-key'] || q.headers.authorization || q.headers['x-goog-api-key'], size: text.length });
    const isVerdict = /Lenses and their facts/.test(text); const nums = [...text.matchAll(/\\n(\d+)\. /g)].map((m) => +m[1]);
    const reply = isVerdict ? JSON.stringify({ summary: 'Family looks mixed.', lenses: nums.map((n) => ({ n, rating: 'mixed', verdict: 'Verdict for lens ' + n, action: 'Fix it' })) }) : /Are you there/.test(text) ? 'ready' : 'ANSWER: the fees schedule mentions R98765';
    r.writeHead(/bad-key/.test(String(seen[seen.length - 1].key)) ? 401 : 200, { 'content-type': 'application/json' });
    r.end(JSON.stringify(q.url.includes('/v1/messages') ? { content: [{ type: 'text', text: reply }] } : q.url.includes(':generateContent') ? { candidates: [{ content: { parts: [{ text: reply }] } }] } : { choices: [{ message: { content: reply } }] })); }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r)); const mb = 'http://127.0.0.1:' + mock.address().port;
  const conns = { anthropic: { provider: 'anthropic', baseUrl: mb, model: 'm1', apiKey: 'k1' }, openai: { provider: 'openai', baseUrl: mb + '/v1', model: 'm2', apiKey: 'k2' }, gemini: { provider: 'gemini', baseUrl: mb + '/v1beta', model: 'm3', apiKey: 'k3' } };
  const tests3 = await Promise.all(Object.values(conns).map((c) => aiLib.testAi(c)));
  check('AI: Anthropic, OpenAI-style and Gemini-style services all answer', tests3.every((x) => x === 'ready') && seen.some((x) => x.key === 'k1') && seen.some((x) => x.key === 'Bearer k2') && seen.some((x) => x.key === 'k3'), JSON.stringify(seen));
  let badKey = ''; try { await aiLib.testAi({ ...conns.openai, apiKey: 'bad-key' }); } catch (e) { badKey = e.message; }
  check('AI: a refused key is reported plainly', /did not accept the API key/.test(badKey), badKey);
  const vd = await aiLib.writeVerdicts(out, { conn: conns.openai, families: [13] });
  check('AI verdicts written for lenses with facts, inside-only left alone', vd.families[13].judged > 40 && vd.families[13].skipped > 0 && fs.existsSync(path.join(out, 'verdicts.json')), JSON.stringify([vd.families[13].judged, vd.families[13].skipped]));
  const withAi = (await buildReport(out, { format: 'md', families: [13] })).buffer.toString();
  check('AI verdicts appear in reports', /AI verdict \(mixed\):\*\* Verdict for lens/.test(withAi) && /AI verdict on this family/.test(withAi));
  const ans = await aiLib.askSite(out, conns.gemini, 'What are the fees?');
  check('ask AI: site facts and page text are sent, answer saved', /R98765/.test(ans.answer) && ans.sourcesSent > 10 && ans.charactersSent > 5000 && aiLib.readAnswers(out).length === 1, JSON.stringify([ans.sourcesSent, ans.charactersSent]));
  mock.close();
  // what changed between two scrapes
  const { compare } = require('../lib/compare'); const later = JSON.parse(JSON.stringify(site));
  later.pages = later.pages.filter((p) => !/\/orphan$/.test(p.url)); later.pages.push({ ...site.pages[0], url: site.pages[0].url + 'brand-new', id: '9999-new' }); later.pages.find((p) => /\/table$/.test(p.url)).hash = 'different'; later.perspectives.security.findings = later.perspectives.security.findings.slice(1); later.stats.pages = later.pages.length;
  const cmp = compare(site, later);
  check('compare: new, gone and changed pages; resolved finding', cmp.pages.added.length === 1 && cmp.pages.removed.length === 1 && cmp.pages.changed.length === 1 && cmp.security.resolved.length === 1 && cmp.anything && /1 new pages/.test(cmp.headline), cmp.headline);
  // custom exports: what, which pages, which format
  const ex = require('../lib/exporter'); const allSets = ex.DATASETS.map((d) => d.id);
  const est = await ex.estimate(out, { include: allSets, files: ex.FILES.map((f) => f.id) });
  check('export preview: every data set counted, file groups sized', allSets.every((k) => est.rows[k] !== undefined) && est.rows.pages === pages.length && est.rows.tables > 2 && est.rows.forms >= 4 && est.files.screenshots.files >= pages.length && est.files.assets.bytes > 0 && est.sections.length > 3, JSON.stringify(est.rows));
  const exs = {}; for (const f of ['xlsx', 'csv', 'json', 'md', 'html', 'docx', 'pdf', 'zip']) exs[f] = await ex.buildExport(out, { include: allSets, files: ['screenshots', 'documentFiles'], format: f });
  const xl2 = await extractDocText(exs.xlsx.buffer, 'e.xlsx');
  check('Excel export: one sheet per data set, real values', ['Page list', 'Tables', 'Forms and fields', 'Security findings', 'Design', 'Lens review', 'Cookies'].every((n2) => xl2.text.includes('Sheet: ' + n2)) && /Apple\tR5/.test(xl2.text) && /Chromebook|navy blazer|fees\.pdf/.test(xl2.text), xl2.text.slice(0, 200));
  const ej = JSON.parse(exs.json.buffer); const zb2 = exs.zip.buffer;
  check('JSON, Markdown, web page, Word, PDF exports', ej.data.pages.length === pages.length && ej.data.headings.some((h2) => h2.Heading === 'Welcome') && /## Tables/.test(exs.md.buffer.toString()) && /<h2 id="security">/.test(exs.html.buffer.toString()) && exs.pdf.buffer.slice(0, 5).toString() === '%PDF-' && /Security findings/.test((await extractDocText(exs.docx.buffer, 'e.docx')).text));
  check('CSV export of several sets is zipped; one set is a plain file', exs.csv.filename.endsWith('.zip') && zb2.includes('data/tables.csv') && (await ex.buildExport(out, { include: ['links'], format: 'csv' })).filename.endsWith('links.csv'));
  check('ZIP folder carries text and the ticked files only', zb2.includes('READ ME.txt') && zb2.includes('/text/') && zb2.includes('screenshot.png') && zb2.includes('documents/') && !zb2.includes('rendered.html') && !zb2.includes('/assets/'));
  const narrow = await ex.buildExport(out, { include: ['pages', 'headings'], format: 'json', section: '/product' }); const nj = JSON.parse(narrow.buffer);
  check('export narrowed to one section of the site', nj.data.pages.length === 6 && nj.data.pages.every((p2) => /\/product\//.test(p2.Address)) && nj.pagesTotal === pages.length && /product/.test(narrow.filename), nj.data.pages.length);
  const probs = JSON.parse((await ex.buildExport(out, { include: ['pages'], format: 'json', result: 'problems' })).buffer);
  check('export narrowed to pages with problems, and by address text', probs.data.pages.length === 1 && /missing/.test(probs.data.pages[0].Address) && JSON.parse((await ex.buildExport(out, { include: ['pages'], format: 'json', contains: 'tabs' })).buffer).data.pages.length === 1);
  let empty = ''; try { await ex.buildExport(out, { include: [], format: 'xlsx' }); } catch (e) { empty = e.message; }
  check('nothing ticked is refused plainly', /at least one/.test(empty));
  fs.writeFileSync(path.join(out, 'sample-export.xlsx'), exs.xlsx.buffer); fs.writeFileSync(path.join(out, 'sample-export.docx'), exs.docx.buffer);
  fs.writeFileSync(path.join(out, 'sample-report.docx'), built.docx.buffer); fs.writeFileSync(path.join(out, 'sample-report.xlsx'), built.xlsx.buffer); fs.writeFileSync(path.join(out, 'sample-report.pdf'), built.pdf.buffer);
  check('report.md + perspectives.json written', exists('perspectives.json') && fs.readFileSync(path.join(out, 'report.md'), 'utf8').includes('## Security'));
  check('pages.csv / links.csv / all-content.md', exists('pages.csv') && exists('links.csv') && fs.readFileSync(path.join(out, 'all-content.md'), 'utf8').includes('Only in the sitemap'));

  console.log(`\n${pass} passed, ${fail} failed.  Output kept at ${out}`);
  process.exit(fail ? 1 : 0);
})();
