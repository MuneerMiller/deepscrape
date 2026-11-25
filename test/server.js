'use strict';
// A small local website that exercises everything the scraper must handle.
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));

const page = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="description" content="${title} description"><link rel="stylesheet" href="/style.css"><link rel="icon" href="/favicon.png">${head}</head>
<body><header><nav aria-label="Main"><a href="/">Home</a> <a href="/spa">SPA</a> <a href="/lazy">Lazy</a> <a href="/table">Table</a> <a href="/form">Form</a>
<a href="/shadow">Shadow</a> <a href="/frame">Frame</a> <a href="/members">Members</a> <a href="/logout">Log out</a></nav></header><main>${body}</main>
<footer>Contact: info@testsite.example or <a href="tel:+27215550100">021 555 0100</a> <a href="https://www.instagram.com/testsite/">Instagram</a></footer></body></html>`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const routes = {
  '/robots.txt': (q, r) => send(r, 'text/plain', 'User-agent: *\nDisallow: /private\nSitemap: http://' + q.headers.host + '/sitemap.xml\n'),
  '/sitemap.xml': (q, r) => send(r, 'application/xml', zlib.gzipSync(`<?xml version="1.0"?><urlset><url><loc>http://${q.headers.host}/</loc></url><url><loc>http://${q.headers.host}/orphan</loc></url><url><loc>http://${q.headers.host}/private/secret</loc></url></urlset>`)),
  '/': (q, r) => send(r, 'text/html', page('Test Home', `<h1>Welcome</h1><form action="/find" method="get" role="search"><input type="search" name="q"><button>Go</button></form><p>Intro paragraph with <strong>bold</strong> text.</p>
    <!-- a hidden developer comment -->
    <a href="/old">Old link</a> <a href="/docs/fees.pdf">Fees</a> <a href="/docs/policy.docx">Policy</a> <a href="/docs/stock.xlsx">Stock</a> <a href="/tabs">Course</a> <a href="/members/reports">Member reports</a>
    <img src="/img/banner.png" alt=""> <abbr title="Parent Teacher Association">PTA</abbr> <span class="badge"></span> <a href="/docs/guide.pdf">Guide PDF</a> <a href="/missing">Broken</a> <a href="/private/secret">Private</a>
    <a href="https://external.example/page">External</a> <a href="/?utm_source=x">Tracking dup</a> <a href="/table/">Trailing dup</a>
    <img src="/img/hero.png" alt="Hero" srcset="/img/hero.png 1x, /img/hero@2x.png 2x"><div class="bg" style="width:10px;height:10px"></div>
    <div data-product-id="42" data-price="19.99">Widget</div>
    <details><summary>More</summary><p>Collapsed secret text</p></details>
    <div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Jane Doe</span></div>`,
    `<meta property="og:title" content="OG Home"><meta property="og:image" content="/img/og.png"><link rel="canonical" href="/">
     <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Test Org"}</script>
     <script id="__NEXT_DATA__" type="application/json">{"props":{"build":"abc123"}}</script>`)),
  '/spa': (q, r) => send(r, 'text/html', page('SPA', `<h1>Products</h1><div id="app">Loading...</div><button id="more">Load more</button>
    <script>window.__INITIAL_STATE__={user:null,flags:{beta:true}};localStorage.setItem('theme','dark');
    let p=1;async function load(){const d=await (await fetch('/api/products?page='+p)).json();
      if(p===1)app.innerHTML='';for(const x of d.items){const a=document.createElement('a');a.href='/product/'+x.id;a.textContent=x.name;app.append(a,document.createElement('br'))}
      if(!d.more)more.remove();p++}
    more.onclick=load;load();console.log('spa ready');</script>`)),
  '/lazy': (q, r) => send(r, 'text/html', page('Lazy', `<h1>Lazy</h1><div style="height:3000px">spacer</div><div id="end"></div>
    <script>new IntersectionObserver((e,o)=>{if(e[0].isIntersecting){o.disconnect();end.innerHTML='<p>Lazy loaded paragraph</p><img src="/img/lazy.png" alt="Lazy image"><a href="/deep">Deep link</a>'}}).observe(end)</script>`)),
  '/table': (q, r) => send(r, 'text/html', page('Table', `<h1>Prices</h1><table><caption>Price list</caption><thead><tr><th>Item</th><th>Price</th></tr></thead>
    <tbody><tr><td>Apple</td><td>R5</td></tr><tr><td>Pear</td><td>R7</td></tr></tbody></table><ul><li>One</li><li>Two</li></ul>`)),
  '/form': (q, r) => send(r, 'text/html', page('Form', `<h1>Contact</h1><form action="/submit" method="post"><label for="n">Name</label><input id="n" name="name" required>
    <input type="password" name="pw" value="hunter2"><select name="topic"><option value="a">Sales</option><option value="b" selected>Support</option></select><button type="submit">Send</button></form>`)),
  '/shadow': (q, r) => send(r, 'text/html', page('Shadow', `<h1>Shadow</h1><my-card><span>Slotted light text</span></my-card>
    <script>customElements.define('my-card',class extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<p>Shadow DOM secret</p><slot></slot><a href="/from-shadow">Shadow link</a>'}})</script>`)),
  '/frame': (q, r) => send(r, 'text/html', page('Frame', `<h1>Frame</h1><iframe src="/inner" title="Inner"></iframe>`)),
  '/inner': (q, r) => send(r, 'text/html', '<html><body><p>Inside the iframe</p></body></html>'),
  '/login': (q, r) => {
    if (q.method === 'POST') { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { const ok = /user=test/.test(b) && /pw=test-only/.test(b); r.writeHead(302, ok ? { 'set-cookie': 'sid=secret-session-value; Path=/; HttpOnly', location: '/members' } : { location: '/login?failed=1' }); r.end(); }); return; }
    send(r, 'text/html', '<html><head><title>Sign in</title></head><body><h1>Sign in</h1><form method="post" action="/login"><input name="user"><input type="password" name="pw"><button id="go">Sign in</button></form></body></html>');
  },
  '/members': (q, r) => (authed(q) ? send(r, 'text/html', page('Members', '<h1>Members</h1><p>Welcome back.</p><a href="/members/reports">Reports</a>')) : redirect(r, '/login?next=/members')),
  '/members/reports': (q, r) => (authed(q) ? send(r, 'text/html', page('Reports', '<h1>Reports</h1><p>Member-only report: revenue 12345</p>')) : redirect(r, '/login?next=/members/reports')),
  '/tabs': (q, r) => send(r, 'text/html', page('Course', `<h1>Course</h1>
    <div role="tablist"><button role="tab" aria-selected="true" data-n="1">Overview</button><button role="tab" aria-selected="false" data-n="2">Syllabus</button><button role="tab" aria-selected="false" data-n="3">Costs</button></div>
    <div id="panel">Overview panel text</div>
    <button aria-expanded="false" id="acc">Entry requirements</button><div id="accp"></div>
    <button aria-expanded="false" id="rm">Remove everything</button> <button id="del">Delete account</button>
    <ul id="list"><li>Row A1</li></ul><button id="nx">Next ›</button>
    <script>const J=(u)=>fetch(u).then(r=>r.json());
    for(const t of document.querySelectorAll('[role=tab]'))t.onclick=async()=>{document.querySelectorAll('[role=tab]').forEach(x=>x.setAttribute('aria-selected',x===t));panel.textContent=(await J('/api/tab?n='+t.dataset.n)).text};
    acc.onclick=async()=>{acc.setAttribute('aria-expanded','true');accp.textContent=(await J('/api/tab?n=9')).text};
    let pg=1;nx.onclick=async()=>{pg++;list.innerHTML='<li>'+(await J('/api/list?page='+pg)).row+'</li>';if(pg>=3)nx.remove()};
    del.onclick=rm.onclick=()=>fetch('/danger');</script>`)),
  '/danger': (q, r) => { hits.danger++; send(r, 'application/json', '{}'); },
  '/hidden-from-api': (q, r) => send(r, 'text/html', page('Hidden from API', '<h1>Only mentioned in background data</h1>')),
  '/feed-only': (q, r) => send(r, 'text/html', page('Feed only', '<h1>Only mentioned in the feed</h1>')),
  '/humans.txt': (q, r) => send(r, 'text/plain', 'Built by the test team in Cape Town'),
  '/feed.xml': (q, r) => send(r, 'application/rss+xml', `<rss><channel><item><title>News</title><link>http://${q.headers.host}/feed-only</link></item></channel></rss>`),
  '/docs/fees.pdf': (q, r) => send(r, 'application/pdf', fx('fees.pdf')),
  '/docs/policy.docx': (q, r) => send(r, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fx('policy.docx')),
  '/docs/stock.xlsx': (q, r) => send(r, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fx('stock.xlsx')),
  '/img/banner.png': (q, r) => send(r, 'image/png', fx('banner.png')),
  '/find': (q, r) => { const t = new URL(q.url, 'http://x').searchParams.get('q') || ''; send(r, 'text/html', page('Search: ' + t, `<h1>Results for ${t}</h1><p>Search-only result about ${t} number 8842</p>`)); },
  '/old': (q, r) => { r.writeHead(301, { location: '/table' }); r.end(); },
  '/orphan': (q, r) => send(r, 'text/html', page('Orphan', '<h1>Orphan</h1><p>Only in the sitemap</p>')),
  '/deep': (q, r) => send(r, 'text/html', page('Deep', '<h1>Deep</h1>')),
  '/from-shadow': (q, r) => send(r, 'text/html', page('From shadow', '<h1>Reached via shadow DOM link</h1>')),
  '/private/secret': (q, r) => { hits.private++; send(r, 'text/html', page('Private', 'should not be scraped')); },
  '/logout': (q, r) => { hits.logout++; send(r, 'text/html', page('Bye', 'logged out')); },
  '/style.css': (q, r) => send(r, 'text/css', '.bg{background-image:url(/img/bg.png)} .badge::before{content:"Limited offer"} body{font-family:sans-serif}'),
  '/docs/guide.pdf': (q, r) => send(r, 'application/pdf', PDF),
};
const hits = { private: 0, logout: 0, danger: 0 };
const authed = (q) => /sid=secret-session-value/.test(q.headers.cookie || '');
const redirect = (r, to) => { r.writeHead(302, { location: to }); r.end(); };
function send(res, type, body, status = 200) { res.writeHead(status, { 'content-type': type, 'x-test-header': 'yes' }); res.end(body); }

module.exports = function start() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/products') {
      const p = +u.searchParams.get('page') || 1;
      return send(res, 'application/json', JSON.stringify({ items: [{ id: p * 10 + 1, name: 'Product ' + (p * 10 + 1), price: 9.5, url: '/hidden-from-api' }, { id: p * 10 + 2, name: 'Product ' + (p * 10 + 2), price: 12 }], more: p < 3 }));
    }
    if (u.pathname.startsWith('/product/')) return send(res, 'text/html', page('Product ' + u.pathname.slice(9), `<h1>Product ${u.pathname.slice(9)}</h1>`));
    if (u.pathname === '/api/tab') return send(res, 'application/json', JSON.stringify({ text: { 1: 'Overview panel text', 2: 'Syllabus panel: algebra and geometry', 3: 'Costs panel: R4500 per term', 9: 'Requirements text: Grade 9 pass' }[u.searchParams.get('n')] }));
    if (u.pathname === '/api/list') return send(res, 'application/json', JSON.stringify({ row: { 2: 'Row B2', 3: 'Row C3' }[u.searchParams.get('page')] }));
    if (routes[u.pathname] && u.pathname.startsWith('/img/')) return routes[u.pathname](req, res);
    if (u.pathname.startsWith('/img/') || u.pathname === '/favicon.png') return send(res, 'image/png', PNG);
    const h = routes[u.pathname.replace(/(.)\/$/, '$1')];
    if (h) return h(req, res);
    send(res, 'text/html', page('Not found', '<h1>404</h1>'), 404);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, hits, url: 'http://127.0.0.1:' + server.address().port })));
};
