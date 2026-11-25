'use strict';
// A made-up website for timing the scraper: a few page types that behave like real sites do.
//   plain     - article with images, a stylesheet and a script
//   data      - loads its content from an API shortly after the page opens
//   lazy      - a long page whose images load as you scroll
//   tabs      - tabs and "show more" that reveal content when clicked
//   chatty    - keeps talking to the server forever (analytics, polling), so the network never goes quiet
// Every response waits `latency` ms, like a real network.
const http = require('http');
const zlib = require('zlib');

function png(seed) {   // a small valid PNG, different per seed
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const w = 64, h = 48; const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (seed * 37 + x * 3) & 255; raw[o + 1] = (seed * 91 + y * 5) & 255; raw[o + 2] = (seed * 13) & 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const words = 'school term fees uniform teacher garden music craft festival parent class learning story painting woodwork kindergarten upper middle campus library'.split(' ');
const para = (seed, n = 60) => Array.from({ length: n }, (_, i) => words[(seed * 7 + i * 13) % words.length]).join(' ') + '.';

module.exports = function startBenchSite({ pages = 60, latency = 40 } = {}) {
  const kinds = ['plain', 'data', 'lazy', 'tabs', 'chatty', 'plain'];
  const kindOf = (i) => kinds[i % kinds.length];
  const nav = (i) => [1, 2, 3, 5, 8].map((d) => `<a href="/p/${(i + d) % pages}">Page ${(i + d) % pages}</a>`).join(' ');
  const shell = (i, title, body, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} of the timing site">
<link rel="stylesheet" href="/site.css"><script src="/site.js" defer></script>${extra}</head><body><header><nav>${nav(i)} <a href="/">Home</a></nav></header><main><h1>${title}</h1>${body}</main><footer>info@bench.example</footer></body></html>`;
  const pageHtml = (i) => {
    const k = kindOf(i); const t = `Page ${i} (${k})`;
    const imgs = (n, lazy) => Array.from({ length: n }, (_, j) => `<p><img ${lazy ? 'loading="lazy"' : ''} src="/img/${i}-${j}.png" width="320" height="240" alt="Picture ${j} of page ${i}"></p><p>${para(i + j)}</p>`).join('');
    if (k === 'plain') return shell(i, t, `<p>${para(i)}</p>${imgs(3)}<table><tr><th>Grade</th><th>Fee</th></tr><tr><td>${i}</td><td>R ${1000 + i}</td></tr></table>`);
    if (k === 'data') return shell(i, t, `<p>${para(i)}</p><div id="out">Loading</div><script>setTimeout(() => fetch('/api/items?page=${i}').then((r) => r.json()).then((d) => { document.getElementById('out').innerHTML = d.items.map((x) => '<p>' + x.name + ': ' + x.text + '</p>').join(''); }), 120);</script>`);
    if (k === 'lazy') return shell(i, t, `<p>${para(i)}</p>${imgs(14, true)}<div style="height:1200px"></div><p>${para(i + 99)}</p>`);
    if (k === 'tabs') return shell(i, t, `<div role="tablist"><button role="tab" aria-selected="true" aria-controls="t1" onclick="show(1)">Overview</button><button role="tab" aria-selected="false" aria-controls="t2" onclick="show(2)">Fees</button><button role="tab" aria-selected="false" aria-controls="t3" onclick="show(3)">Contact</button></div>
<div id="t1" role="tabpanel"><p>${para(i)}</p></div><div id="t2" role="tabpanel" hidden></div><div id="t3" role="tabpanel" hidden></div>
<details><summary>More about page ${i}</summary><p>${para(i + 5)}</p></details><button id="more" onclick="more()">Show more</button><div id="list"></div>
<script>function show(n){for(const x of [1,2,3]){document.getElementById('t'+x).hidden=x!==n}const p=document.getElementById('t'+n);if(!p.textContent)fetch('/api/tab?page=${i}&tab='+n).then(r=>r.json()).then(d=>{p.innerHTML='<p>'+d.text+'</p>'})}
let shown=0;function more(){shown++;fetch('/api/more?page=${i}&n='+shown).then(r=>r.json()).then(d=>{document.getElementById('list').insertAdjacentHTML('beforeend','<p>'+d.text+'</p>');if(shown>=2)document.getElementById('more').remove()})}</script>`);
    return shell(i, t, `<p>${para(i)}</p>${imgs(2)}<script>setInterval(() => fetch('/beacon?page=${i}&t=' + Date.now()).catch(() => {}), 350);</script>`);
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    const send = (type, body, code = 200) => setTimeout(() => { res.writeHead(code, { 'content-type': type, 'cache-control': 'max-age=600' }); res.end(body); }, latency);
    if (p === '/robots.txt') return send('text/plain', 'User-agent: *\nAllow: /\n');
    if (p === '/site.css') return send('text/css', 'body{font:16px sans-serif;margin:24px;max-width:760px}nav a{margin-right:8px}img{background:#ddd}');
    if (p === '/site.js') return send('text/javascript', 'window.siteReady = true;');
    if (p === '/') return send('text/html', shell(0, 'Timing site', `<ul>${Array.from({ length: pages }, (_, i) => `<li><a href="/p/${i}">Page ${i}</a></li>`).join('')}</ul>`));
    if (p.startsWith('/p/')) { const i = Number(p.slice(3)); return i >= 0 && i < pages ? send('text/html', pageHtml(i)) : send('text/plain', 'no', 404); }
    if (p.startsWith('/img/')) { const s = p.slice(5).split(/[-.]/); return send('image/png', png(Number(s[0]) * 31 + Number(s[1]))); }
    if (p === '/api/items') return send('application/json', JSON.stringify({ items: Array.from({ length: 6 }, (_, j) => ({ name: 'Item ' + j, text: para(Number(u.searchParams.get('page')) + j, 20) })) }));
    if (p === '/api/tab') return send('application/json', JSON.stringify({ text: `Tab ${u.searchParams.get('tab')} text. ` + para(Number(u.searchParams.get('page')) + Number(u.searchParams.get('tab')) * 17, 30) }));
    if (p === '/api/more') return send('application/json', JSON.stringify({ text: `More ${u.searchParams.get('n')}. ` + para(Number(u.searchParams.get('page')) + Number(u.searchParams.get('n')) * 29, 30) }));
    if (p === '/beacon') return send('text/plain', 'ok', 200);
    send('text/plain', 'not found', 404);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/`, pages })));
};
