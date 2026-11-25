'use strict';
/**
 * Runs INSIDE the page (via page.evaluate). Must be fully self-contained.
 * Returns every piece of structured information we can read from the live DOM,
 * including content inside shadow DOM, which a plain HTML download never sees.
 */
module.exports = function extractInPage() {
  const abs = (u) => {
    if (u == null || u === '') return null;
    try { return new URL(String(u).trim(), document.baseURI).href; } catch { return null; }
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const attr = (el, n) => (el.getAttribute(n) == null ? null : el.getAttribute(n));

  // ---- every element, piercing open shadow roots -------------------------
  const all = [];
  let shadowRoots = 0;
  (function walk(root) {
    for (const el of root.querySelectorAll('*')) {
      all.push(el);
      if (el.shadowRoot) { shadowRoots++; walk(el.shadowRoot); }
    }
  })(document);
  const q = (sel) => all.filter((e) => { try { return e.matches(sel); } catch { return false; } });

  // ---- composed (flattened) tree: what the user actually sees ------------
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template']);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const URL_ATTRS = new Set(['href', 'src', 'poster', 'action']);
  function kids(node) {
    if (node.shadowRoot) return node.shadowRoot.childNodes;
    if (node.localName === 'slot' && node.assignedNodes) {
      const a = node.assignedNodes({ flatten: true });
      if (a.length) return a;
    }
    return node.childNodes;
  }
  function ser(node) {
    if (node.nodeType === 3) return esc(node.nodeValue);
    if (node.nodeType === 8) return '<!--' + node.nodeValue + '-->';
    if (node.nodeType !== 1) return '';
    const tag = node.localName;
    let a = '';
    for (const at of node.attributes) {
      let v = at.value;
      if (URL_ATTRS.has(at.name) && v && !/^(#|javascript:|data:|mailto:|tel:)/i.test(v)) v = abs(v) || v;
      a += ' ' + at.name + '="' + escA(v) + '"';
    }
    if (VOID.has(tag)) return '<' + tag + a + '>';
    let inner = '';
    if (tag === 'script' || tag === 'style') inner = node.textContent;
    else for (const c of kids(node)) inner += ser(c);
    return '<' + tag + a + '>' + inner + '</' + tag + '>';
  }
  function composedText(node, out) {
    if (node.nodeType === 3) { out.push(node.nodeValue); return; }
    if (node.nodeType !== 1 || SKIP_TEXT.has(node.localName)) return;
    for (const c of kids(node)) composedText(c, out);
    if (/^(p|div|li|tr|h[1-6]|br|section|article|header|footer|td|th|dt|dd|blockquote|pre)$/.test(node.localName)) out.push('\n');
  }
  const body = document.body || document.documentElement;
  const composedHtml = ser(body);
  const tparts = []; composedText(body, tparts);
  const allText = tparts.join('').replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const visibleText = (body.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

  // ---- metadata ----------------------------------------------------------
  const meta = [];
  const metaMap = {};
  for (const m of document.querySelectorAll('meta')) {
    const key = attr(m, 'name') || attr(m, 'property') || attr(m, 'http-equiv') || attr(m, 'itemprop') || (m.hasAttribute('charset') ? 'charset' : null);
    const val = attr(m, 'content') ?? attr(m, 'charset');
    const rec = {}; for (const at of m.attributes) rec[at.name] = at.value;
    meta.push(rec);
    if (key && val != null) {
      if (metaMap[key] === undefined) metaMap[key] = val;
      else metaMap[key] = [].concat(metaMap[key], val);
    }
  }
  const pick = (prefix) => Object.fromEntries(Object.entries(metaMap).filter(([k]) => k.startsWith(prefix)));
  const linkTags = [...document.querySelectorAll('link')].map((l) => {
    const rec = {}; for (const at of l.attributes) rec[at.name] = at.value;
    rec.href = abs(attr(l, 'href')); return rec;
  });
  const rel = (r) => linkTags.filter((l) => (l.rel || '').toLowerCase().split(/\s+/).includes(r));

  // ---- structured data ---------------------------------------------------
  const tryJson = (s) => { try { return JSON.parse(s); } catch { return { _unparsed: s }; } };
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => tryJson(s.textContent));
  const jsonScripts = [...document.querySelectorAll('script[type="application/json"], script[type$="+json"]:not([type="application/ld+json"])')]
    .map((s) => ({ id: s.id || null, type: s.type, data: tryJson(s.textContent) }));
  const microdata = [];
  function mdItem(el) {
    const item = { type: attr(el, 'itemtype'), id: attr(el, 'itemid'), properties: {} };
    (function scan(node) {
      for (const c of node.children) {
        const prop = attr(c, 'itemprop');
        if (prop) {
          let v;
          if (c.hasAttribute('itemscope')) v = mdItem(c);
          else if (c.localName === 'meta') v = attr(c, 'content');
          else if (/^(a|link|area)$/.test(c.localName)) v = abs(attr(c, 'href'));
          else if (/^(img|audio|video|source|iframe|embed)$/.test(c.localName)) v = abs(attr(c, 'src'));
          else if (c.localName === 'time') v = attr(c, 'datetime') || clean(c.textContent);
          else if (/^(data|meter)$/.test(c.localName)) v = attr(c, 'value');
          else v = clean(c.textContent);
          for (const p of prop.split(/\s+/)) (item.properties[p] = item.properties[p] || []).push(v);
          if (c.hasAttribute('itemscope')) continue;
        }
        if (!c.hasAttribute('itemscope')) scan(c);
      }
    })(el);
    return item;
  }
  for (const el of q('[itemscope]')) if (!el.hasAttribute('itemprop')) microdata.push(mdItem(el));

  const globals = {};
  for (const g of ['__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APOLLO_STATE__', '__remixContext', '__sveltekit_data', '__GATSBY', '__INITIAL_DATA__', 'dataLayer', '__APP_STATE__', '__data']) {
    try {
      if (window[g] !== undefined) {
        const seen = new WeakSet();
        const s = JSON.stringify(window[g], (k, v) => {
          if (typeof v === 'function') return undefined;
          if (v && typeof v === 'object') { if (seen.has(v) || v instanceof Node || v === window) return undefined; seen.add(v); }
          return v;
        });
        if (s && s.length < 20_000_000) globals[g] = JSON.parse(s);
      }
    } catch { /* not serialisable */ }
  }

  // ---- content structure -------------------------------------------------
  const headings = q('h1,h2,h3,h4,h5,h6').map((h) => ({ level: +h.localName[1], text: clean(h.textContent), id: h.id || null }));
  const here = location.hostname.replace(/^www\./, '');
  const links = q('a[href], area[href]').map((a) => {
    const href = abs(attr(a, 'href'));
    let internal = null;
    try { internal = new URL(href).hostname.replace(/^www\./, '') === here; } catch { /* mailto etc */ }
    return {
      href, rawHref: attr(a, 'href'),
      text: clean(a.textContent) || clean(attr(a, 'aria-label')) || clean(a.querySelector && a.querySelector('img') ? a.querySelector('img').alt : ''),
      title: attr(a, 'title'), rel: attr(a, 'rel'), target: attr(a, 'target'),
      download: a.hasAttribute('download') ? (attr(a, 'download') || true) : undefined,
      internal,
    };
  });
  const srcsetUrls = (s) => (s || '').split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean).map(abs).filter(Boolean);
  const images = q('img').map((i) => ({
    src: abs(i.currentSrc || attr(i, 'src')), declaredSrc: abs(attr(i, 'src')),
    lazySrc: abs(attr(i, 'data-src') || attr(i, 'data-lazy-src') || attr(i, 'data-original') || attr(i, 'data-lazy')),
    srcset: srcsetUrls(attr(i, 'srcset') || attr(i, 'data-srcset')),
    alt: attr(i, 'alt'), title: attr(i, 'title'), width: i.naturalWidth || null, height: i.naturalHeight || null, loading: attr(i, 'loading'),
    caption: i.closest && i.closest('figure') ? clean((i.closest('figure').querySelector('figcaption') || {}).textContent) || null : null,
  }));
  for (const s of q('picture source[srcset]')) for (const u of srcsetUrls(attr(s, 'srcset'))) images.push({ src: u, fromPictureSource: true, media: attr(s, 'media'), type: attr(s, 'type') });
  const backgroundImages = [];
  if (all.length <= 25000) {
    const seen = new Set();
    for (const el of all) {
      let bg; try { bg = getComputedStyle(el).backgroundImage; } catch { continue; }
      if (!bg || bg === 'none') continue;
      for (const m of bg.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
        const u = abs(m[2]);
        if (u && !u.startsWith('data:') && !seen.has(u)) { seen.add(u); backgroundImages.push(u); }
      }
    }
  }
  const svgs = q('svg').filter((s) => !s.parentElement || !s.parentElement.closest('svg')).slice(0, 300)
    .map((s) => ({ title: clean((s.querySelector('title') || {}).textContent) || null, ariaLabel: attr(s, 'aria-label'), markup: s.outerHTML.length < 50000 ? s.outerHTML : null }));
  const media = q('video, audio').map((v) => ({
    kind: v.localName, src: abs(v.currentSrc || attr(v, 'src')), poster: abs(attr(v, 'poster')),
    sources: [...v.querySelectorAll('source')].map((s) => ({ src: abs(attr(s, 'src')), type: attr(s, 'type') })),
    tracks: [...v.querySelectorAll('track')].map((t) => ({ src: abs(attr(t, 'src')), kind: attr(t, 'kind'), srclang: attr(t, 'srclang'), label: attr(t, 'label') })),
    duration: isFinite(v.duration) ? v.duration : null,
  }));
  const iframes = q('iframe, frame, embed, object').map((f) => ({ tag: f.localName, src: abs(attr(f, 'src') || attr(f, 'data')), title: attr(f, 'title'), name: attr(f, 'name') }));

  const tables = q('table').map((t) => {
    const rows = [...t.rows].map((r) => [...r.cells].map((c) => clean(c.textContent)));
    const headRow = t.tHead && t.tHead.rows[0] ? [...t.tHead.rows[0].cells].map((c) => clean(c.textContent))
      : (t.rows[0] && [...t.rows[0].cells].every((c) => c.localName === 'th') ? [...t.rows[0].cells].map((c) => clean(c.textContent)) : null);
    const cellLinks = [...t.querySelectorAll('a[href]')].map((a) => ({ text: clean(a.textContent), href: abs(attr(a, 'href')) }));
    let records = null;
    if (headRow) {
      const bodyRows = rows.slice(rows.findIndex((r) => r.join('|') === headRow.join('|')) + 1);
      records = bodyRows.map((r) => Object.fromEntries(headRow.map((h, i) => [h || 'col' + (i + 1), r[i] ?? null])));
    }
    return { caption: clean((t.caption || {}).textContent) || null, id: t.id || null, headers: headRow, rows, records, links: cellLinks };
  });
  const lists = q('ul, ol, dl').filter((l) => !l.closest('nav')).slice(0, 500).map((l) => (l.localName === 'dl'
    ? { type: 'dl', items: [...l.querySelectorAll(':scope > dt, :scope > div > dt')].map((dt) => ({ term: clean(dt.textContent), description: clean((dt.nextElementSibling || {}).textContent) })) }
    : { type: l.localName, items: [...l.querySelectorAll(':scope > li')].map((li) => clean(li.textContent)) }));

  const labelFor = (el) => {
    if (el.labels && el.labels.length) return clean(el.labels[0].textContent);
    return attr(el, 'aria-label') || null;
  };
  const fieldInfo = (f) => ({
    tag: f.localName, type: attr(f, 'type') || (f.localName === 'input' ? 'text' : null), name: attr(f, 'name'), id: f.id || null,
    label: labelFor(f), placeholder: attr(f, 'placeholder'),
    value: (attr(f, 'type') || '').toLowerCase() === 'password' ? undefined : (f.value ?? null),
    required: f.required || undefined, disabled: f.disabled || undefined, checked: f.checked || undefined,
    pattern: attr(f, 'pattern') || undefined, min: attr(f, 'min') || undefined, max: attr(f, 'max') || undefined, maxlength: attr(f, 'maxlength') || undefined,
    options: f.localName === 'select' ? [...f.options].map((o) => ({ value: o.value, text: clean(o.textContent), selected: o.selected || undefined })) : undefined,
  });
  const forms = q('form').map((f) => ({
    action: abs(attr(f, 'action')) || location.href, method: (attr(f, 'method') || 'get').toLowerCase(), id: f.id || null, name: attr(f, 'name'),
    enctype: attr(f, 'enctype'), fields: [...f.elements].filter((e) => e.localName !== 'fieldset').map(fieldInfo),
  }));
  const looseFields = q('input, select, textarea').filter((e) => !e.form).map(fieldInfo);
  const buttons = q('button, [role="button"], input[type="submit"], input[type="button"]').map((b) => ({ text: clean(b.textContent) || attr(b, 'value') || attr(b, 'aria-label'), type: attr(b, 'type'), id: b.id || null, disabled: b.disabled || undefined }));

  const landmark = (sel) => q(sel).map((n) => ({ label: attr(n, 'aria-label'), text: clean(n.textContent).slice(0, 5000), links: [...n.querySelectorAll('a[href]')].map((a) => ({ text: clean(a.textContent), href: abs(attr(a, 'href')) })) }));
  const scripts = [...document.querySelectorAll('script')].map((s) => ({ src: abs(attr(s, 'src')), type: attr(s, 'type'), async: s.async || undefined, defer: s.defer || undefined, inlineLength: s.src ? undefined : s.textContent.length, inline: s.src || /json/.test(s.type) ? undefined : s.textContent }));
  const styles = { external: rel('stylesheet').map((l) => l.href), inline: [...document.querySelectorAll('style')].map((s) => s.textContent) };

  const comments = [];
  const tw = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  while (tw.nextNode() && comments.length < 500) { const c = tw.currentNode.nodeValue.trim(); if (c) comments.push(c); }

  const dataAttributes = [];
  for (const el of all) {
    if (dataAttributes.length >= 3000) break;
    let d = null;
    for (const at of el.attributes) if (at.name.startsWith('data-') && at.value && at.value.length < 5000) (d = d || {})[at.name] = at.value;
    if (d) dataAttributes.push({ tag: el.localName, id: el.id || undefined, text: clean(el.textContent).slice(0, 120) || undefined, data: d });
  }

  // ---- contact details & socials ----------------------------------------
  const emails = new Set(), phones = new Set(), socials = new Set();
  for (const l of links) {
    if (!l.rawHref) continue;
    if (/^mailto:/i.test(l.rawHref)) emails.add(decodeURIComponent(l.rawHref.replace(/^mailto:/i, '').split('?')[0]).trim());
    else if (/^(tel|sms|callto):/i.test(l.rawHref)) phones.add(l.rawHref.replace(/^\w+:/, '').trim());
    else if (/^https?:\/\/([\w-]+\.)?(facebook|instagram|twitter|x|linkedin|youtube|tiktok|pinterest|github|threads|wa|t|telegram|whatsapp|snapchat|reddit|discord)\.(com|me|net|gg|tv)\//i.test(l.href || '')) socials.add(l.href);
  }
  for (const m of allText.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) emails.add(m[0]);
  for (const m of allText.matchAll(/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g)) phones.add(m[0].trim());

  // ---- text that is not in the page's text nodes ---------------------------
  const attrText = new Set(); const generated = new Set();
  for (const el of all) {
    for (const n of ['title', 'aria-label', 'placeholder', 'aria-description', 'data-tooltip', 'data-title', 'data-original-title', 'label', 'summary']) { const v = el.getAttribute(n); if (v && v.trim().length > 1 && v.length < 1000) attrText.add(v.trim()); }
    if (all.length <= 15000) for (const ps of ['::before', '::after']) {
      let c; try { c = getComputedStyle(el, ps).content; } catch { continue; }
      if (c && c !== 'none' && c !== 'normal' && /^["']/.test(c)) { const t = c.slice(1, -1).replace(/\\([0-9a-f]{1,6}) ?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))); if (/[A-Za-z0-9]{2}/.test(t)) generated.add(t.trim()); }
    }
  }
  const canvases = [];
  for (const cv of q('canvas')) { if (canvases.length >= 12) break; try { if (cv.width > 40 && cv.height > 40) { const d = cv.toDataURL('image/png'); if (d.length < 6_000_000) canvases.push(d); } } catch { /* drawn from another site: unreadable */ } }

  const storage = (st) => { const o = {}; try { for (let i = 0; i < st.length; i++) { const k = st.key(i); o[k] = st.getItem(k); } } catch { /* blocked */ } return o; };
  let perf = null;
  try { const n = performance.getEntriesByType('navigation')[0]; if (n) perf = { ttfbMs: Math.round(n.responseStart), domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd), transferSize: n.transferSize, protocol: n.nextHopProtocol }; } catch { /* ignore */ }

  // ---- technology fingerprints ---------------------------------------------
  const tech = new Set();
  try {
    const w = window; const html = document.documentElement.outerHTML.slice(0, 500000); const has = (re) => re.test(html);
    if (metaMap.generator) tech.add(String([].concat(metaMap.generator)[0]));
    if (w.jQuery) tech.add(('jQuery ' + ((w.jQuery.fn && w.jQuery.fn.jquery) || '')).trim());
    if (w.__NEXT_DATA__ || has(/\/_next\/static\//)) tech.add('Next.js');
    if (w.__NUXT__ || has(/\/_nuxt\//)) tech.add('Nuxt');
    if (w.React || document.querySelector('[data-reactroot]') || [...document.querySelectorAll('body > *')].some((el) => Object.keys(el).some((k) => k.startsWith('__reactContainer') || k.startsWith('_reactRootContainer')))) tech.add('React');
    if (w.Vue || w.__VUE__ || document.querySelector('[data-v-app]')) tech.add('Vue.js');
    const ng = document.querySelector('[ng-version]'); if (ng) tech.add('Angular ' + ng.getAttribute('ng-version'));
    if (w.angular) tech.add('AngularJS');
    if (has(/class="[^"]*svelte-[a-z0-9]{5,}/)) tech.add('Svelte');
    if (w.Alpine) tech.add('Alpine.js'); if (w.htmx) tech.add('htmx'); if (w.Livewire) tech.add('Livewire'); if (w.Ember) tech.add('Ember');
    if (w.Shopify) tech.add('Shopify');
    if (has(/\/wp-(content|includes)\//)) tech.add('WordPress');
    if (w.woocommerce_params || has(/woocommerce/i)) tech.add('WooCommerce');
    if (w.wixBiSession || has(/static\.wixstatic\.com/)) tech.add('Wix');
    if ((w.Static && w.Static.SQUARESPACE_CONTEXT) || has(/static1\.squarespace\.com/)) tech.add('Squarespace');
    if (document.documentElement.hasAttribute('data-wf-site')) tech.add('Webflow');
    if (w.Drupal) tech.add('Drupal'); if (w.Joomla) tech.add('Joomla');
    if (w.gtag || w.ga || has(/google-analytics\.com|googletagmanager\.com\/gtag/)) tech.add('Google Analytics');
    if (w.google_tag_manager) tech.add('Google Tag Manager');
    if (w.fbq) tech.add('Meta Pixel'); if (w.hj) tech.add('Hotjar'); if (w.clarity) tech.add('Microsoft Clarity');
    if (w.bootstrap || has(/bootstrap(\.bundle)?(\.min)?\.(css|js)/)) tech.add('Bootstrap');
    if (w.Stripe) tech.add('Stripe'); if (w.grecaptcha) tech.add('reCAPTCHA'); if (w.hcaptcha) tech.add('hCaptcha'); if (w.turnstile) tech.add('Cloudflare Turnstile');
    if (w.Sentry || w.__SENTRY__) tech.add('Sentry'); if (w.Intercom) tech.add('Intercom'); if (w.HubSpotConversations || w._hsq) tech.add('HubSpot');
    if (has(/fonts\.googleapis\.com/)) tech.add('Google Fonts'); if (has(/font-?awesome/i)) tech.add('Font Awesome');
    if (navigator.serviceWorker && navigator.serviceWorker.controller) tech.add('Service worker (PWA)');
  } catch { /* fingerprints are best-effort */ }

  // ════════ other ways of looking at the page: design, accessibility, security, privacy, legal ════════
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  const rgba = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined || isNaN(p[3]) ? 1 : p[3] }; };
  const hex = (c) => { const v = rgba(c); if (!v) return c; const h = '#' + [v.r, v.g, v.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join(''); return v.a < 1 ? `${h} @${Math.round(v.a * 100)}%` : h; };
  const lum = (v) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(v.r) + 0.7152 * f(v.g) + 0.0722 * f(v.b); };
  const bgOf = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement || (n.getRootNode() && n.getRootNode().host)) { const v = rgba(getComputedStyle(n).backgroundColor); if (v && v.a > 0.5) return v; if (getComputedStyle(n).backgroundImage !== 'none') return null; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const D = { text: {}, background: {}, border: {}, fonts: {}, sizes: {}, radii: {}, shadows: {} };
  const step = Math.max(1, Math.ceil(all.length / 6000)); let flex = 0, grid = 0; const lowContrast = []; let lowContrastCount = 0, contrastChecked = 0;
  for (let i = 0; i < all.length; i += step) {
    const el = all[i]; let cs; try { cs = getComputedStyle(el); } catch { continue; }
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.display.includes('flex')) flex++; else if (cs.display.includes('grid')) grid++;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim()).map((n) => n.nodeValue.trim()).join(' ');
    if (own) {
      bump(D.text, hex(cs.color)); bump(D.fonts, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() + ' / ' + cs.fontWeight); bump(D.sizes, cs.fontSize);
      if (contrastChecked < 2500) {
        contrastChecked++; const fg = rgba(cs.color); const bg = bgOf(el);
        if (fg && bg && fg.a > 0.5) { const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
          if (ratio < (large ? 3 : 4.5)) { lowContrastCount++; if (lowContrast.length < 15) lowContrast.push({ text: own.slice(0, 60), ratio: +ratio.toFixed(2), color: hex(cs.color), background: hex(`rgb(${bg.r},${bg.g},${bg.b})`), size: cs.fontSize }); } }
      }
    }
    const bgc = rgba(cs.backgroundColor); if (bgc && bgc.a > 0) bump(D.background, hex(cs.backgroundColor));
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') bump(D.border, hex(cs.borderTopColor));
    if (cs.borderTopLeftRadius && cs.borderTopLeftRadius !== '0px') bump(D.radii, cs.borderTopLeftRadius);
    if (cs.boxShadow && cs.boxShadow !== 'none') bump(D.shadows, cs.boxShadow);
  }
  const cssVariables = {}; const breakpoints = {}; let cssRules = 0, unreadableSheets = 0; const fontFaces = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { unreadableSheets++; continue; }
    (function scanRules(list, d) {
      for (const r of list) {
        cssRules++;
        if (r.type === 1 && /^(:root|html|body)$/i.test(r.selectorText || '')) { for (const p of r.style) if (p.startsWith('--') && Object.keys(cssVariables).length < 400) cssVariables[p] = r.style.getPropertyValue(p).trim(); }
        else if (r.type === 4) { bump(breakpoints, r.conditionText || r.media.mediaText); if (d < 3) try { scanRules(r.cssRules, d + 1); } catch { /* ignore */ } }
        else if (r.type === 5 && fontFaces.length < 60) fontFaces.push({ family: r.style.getPropertyValue('font-family').replace(/["']/g, ''), weight: r.style.getPropertyValue('font-weight') || undefined, src: (r.style.getPropertyValue('src').match(/url\(["']?([^"')]+)/) || [])[1] });
      }
    })(rules, 0);
  }
  const styleOf = (sel) => { const el = document.querySelector(sel); if (!el) return undefined; const cs = getComputedStyle(el); return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: hex(cs.color), background: hex(cs.backgroundColor), borderRadius: cs.borderRadius, padding: cs.padding, textTransform: cs.textTransform }; };
  const logoEl = q('img, svg').find((el) => /logo|brand/i.test((el.getAttribute('class') || '') + ' ' + (el.getAttribute('alt') || '') + ' ' + (el.getAttribute('src') || '') + ' ' + (el.id || '') + ' ' + ((el.parentElement && el.parentElement.className) || '')));
  const design = {
    colors: { text: top(D.text, 12), background: top(D.background, 12), border: top(D.border, 8) }, fonts: top(D.fonts, 12), fontSizes: top(D.sizes, 14), cornerRadii: top(D.radii, 8), shadows: top(D.shadows, 6),
    typography: { body: styleOf('body'), h1: styleOf('h1'), h2: styleOf('h2'), h3: styleOf('h3'), paragraph: styleOf('p'), link: styleOf('a'), button: styleOf('button, .btn, [role="button"], input[type="submit"]'), input: styleOf('input[type="text"], input[type="email"], input:not([type]), textarea') },
    cssVariables, breakpoints: top(breakpoints, 20), fontFaces, themeColor: metaMap['theme-color'] || null, colorScheme: metaMap['color-scheme'] || getComputedStyle(document.documentElement).colorScheme || null,
    logo: logoEl ? (logoEl.localName === 'img' ? abs(logoEl.currentSrc || logoEl.getAttribute('src')) : 'inline SVG') : null,
    layout: { viewportMeta: metaMap.viewport || null, flexContainers: flex * step, gridContainers: grid * step, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 4, cssRules, stylesheetsNotReadable: unreadableSheets },
    animations: (document.getAnimations ? document.getAnimations().length : 0),
  };

  const named = (el) => clean(el.textContent) || attr(el, 'aria-label') || attr(el, 'aria-labelledby') || attr(el, 'title') || (el.querySelector && el.querySelector('img[alt]:not([alt=""]), svg title')) ;
  const unlabelled = q('input, select, textarea').filter((f) => !/^(hidden|submit|button|reset|image)$/i.test(f.type || '') && !(f.labels && f.labels.length) && !attr(f, 'aria-label') && !attr(f, 'aria-labelledby') && !attr(f, 'title'));
  let skips = 0; for (let i = 1; i < headings.length; i++) if (headings[i].level - headings[i - 1].level > 1) skips++;
  const accessibility = {
    language: document.documentElement.lang || null, title: !!document.title.trim(),
    imagesWithoutDescription: images.filter((i) => !i.fromPictureSource && i.alt == null).length, linksWithoutText: q('a[href]').filter((el) => !named(el)).length, buttonsWithoutName: q('button, [role="button"]').filter((el) => !named(el)).length,
    fieldsWithoutLabel: unlabelled.length, fieldsWithoutLabelExamples: unlabelled.slice(0, 8).map((f) => f.name || f.id || f.placeholder || f.type), headingLevelsSkipped: skips, mainHeadings: headings.filter((x) => x.level === 1).length,
    lowContrastText: lowContrastCount, lowContrastExamples: lowContrast, positiveTabindex: q('[tabindex]').filter((el) => +el.getAttribute('tabindex') > 0).length,
    landmarks: { main: !!document.querySelector('main, [role="main"]'), navigation: !!document.querySelector('nav, [role="navigation"]'), header: !!document.querySelector('header, [role="banner"]'), footer: !!document.querySelector('footer, [role="contentinfo"]') },
    skipLink: !!q('a[href^="#"]').slice(0, 5).find((el) => /skip/i.test(el.textContent)), framesWithoutTitle: q('iframe').filter((f) => !attr(f, 'title')).length,
    zoomBlocked: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(String(metaMap.viewport || '')), autoplayingMedia: q('video[autoplay], audio[autoplay]').filter((m) => !m.muted).length,
  };

  const https = location.protocol === 'https:'; const pageHost = location.hostname;
  const ext3 = (u) => { try { return new URL(u).hostname !== pageHost; } catch { return false; } };
  const security = {
    https, passwordFields: q('input[type="password"]').length, passwordFieldOnInsecurePage: !https && q('input[type="password"]').length > 0,
    formsSendingOverHttp: forms.filter((f) => /^http:/.test(f.action) && https).map((f) => f.action), formsSendingToOtherSites: forms.filter((f) => ext3(f.action)).map((f) => f.action),
    formsUsingGetWithPassword: forms.filter((f) => f.method === 'get' && f.fields.some((x) => x.type === 'password')).length,
    passwordFieldsAllowingAutocomplete: q('input[type="password"]').filter((p) => !/off|new-password|current-password/.test(attr(p, 'autocomplete') || '')).length,
    newTabLinksWithoutNoopener: q('a[target="_blank"]').filter((el) => !/noopener|noreferrer/.test(attr(el, 'rel') || '') && ext3(abs(attr(el, 'href')))).length,
    inlineEventHandlers: all.filter((el) => [...el.attributes].some((at) => /^on[a-z]+$/.test(at.name))).length, inlineScripts: scripts.filter((x) => !x.src && x.inlineLength).length, javascriptLinks: q('a[href^="javascript:"]').length,
    thirdPartyScripts: [...document.querySelectorAll('script[src]')].filter((x) => ext3(abs(x.getAttribute('src')))).map((x) => ({ src: abs(x.getAttribute('src')), integrity: !!x.integrity })),
    thirdPartyStyles: [...document.querySelectorAll('link[rel~="stylesheet"][href]')].filter((x) => ext3(abs(x.getAttribute('href')))).map((x) => ({ href: abs(x.getAttribute('href')), integrity: !!x.integrity })),
    insecureResourcesInPage: https ? [...new Set(q('[src], link[href]').map((el) => abs(attr(el, 'src') || attr(el, 'href'))).filter((u) => u && /^http:/.test(u)))].slice(0, 50) : [],
    externalFrames: iframes.filter((f) => f.src && ext3(f.src)).map((f) => f.src), sandboxedFrames: q('iframe[sandbox]').length,
    policyInMetaTag: metaMap['Content-Security-Policy'] || metaMap['content-security-policy'] || null, referrerMeta: metaMap.referrer || null,
    emailAddressesExposed: emails.size, commentsInCode: comments.length, hiddenFields: q('input[type="hidden"]').map((x) => x.name).filter(Boolean).slice(0, 60),
    csrfTokenFields: q('input[type="hidden"]').filter((x) => /csrf|xsrf|token|nonce/i.test(x.name || '')).length, fileUploads: q('input[type="file"]').length, serviceWorker: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
  };

  const findLink = (re) => { const l = links.find((x) => re.test(x.text || '') || re.test((x.href || '').split('?')[0])); return l ? l.href : null; };
  const footText = clean((document.querySelector('footer, [role="contentinfo"]') || {}).textContent || '');
  const legal = {
    privacyPolicy: findLink(/privacy|popia|gdpr|data protection/i), terms: findLink(/terms|conditions|\btos\b/i), cookiePolicy: findLink(/cookie/i), accessibilityStatement: findLink(/accessibility/i),
    paiaManual: findLink(/paia|access to information/i), imprint: findLink(/imprint|impressum|legal notice|disclaimer/i), refunds: findLink(/refund|returns/i), contactPage: findLink(/contact/i), aboutPage: findLink(/about/i), careers: findLink(/career|jobs|vacanc/i),
    copyright: ((allText.match(/(©|\(c\)|copyright)\s?[^\n]{0,90}/i) || [])[0] || '').trim() || null, companyNumbers: [...new Set((footText.match(/\b(reg(istration)?\.? ?(no|number)\.?:? ?[\w/ -]{5,20}|vat ?(no|number)?\.?:? ?\d{8,12}|npo ?(no|number)?\.?:? ?[\d-]{5,12})/gi) || []))],
  };
  const consentEl = all.find((el) => /cookie|consent|gdpr|onetrust|cookiebot|cc-window|cmp/i.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')) && el.getBoundingClientRect().height > 20 && /cookie|consent|accept/i.test(el.textContent || ''));
  const privacy = { consentBannerShown: !!consentEl, consentBannerText: consentEl ? clean(consentEl.textContent).slice(0, 300) : null };
  let vitals = null;
  try { const v = window.__dsVitals || {}; const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint'); vitals = { firstPaintMs: fcp ? Math.round(fcp.startTime) : null, largestPaintMs: v.lcp ?? null, layoutShift: v.cls != null ? +v.cls.toFixed(3) : null, longTasks: v.long || 0, domNodes: all.length, maxDomDepth: (function depth(n, d) { let m = d; for (const c of n.children) { if (d < 60) m = Math.max(m, depth(c, d + 1)); } return m; })(document.documentElement, 1) }; } catch { /* unsupported */ }

  // ════════ signals for the wider perspectives: journeys, business, trust, content, engineering ════════
  const T = allText; const H = document.documentElement.outerHTML.slice(0, 1500000); const tx = (re) => re.test(T); const hx = (re) => re.test(H);
  const pick1 = (re) => { const m = T.match(re); return m ? m[0].slice(0, 120) : null; };
  const names = (pairs) => pairs.filter(([re]) => re.test(H)).map(([, n]) => n);
  const btnLabels = {}; for (const el of q('button, a.btn, a.button, [role="button"], input[type="submit"], a[class*="cta"], a[class*="btn"]')) { const l = clean(el.textContent || el.value || '').slice(0, 40); if (l && l.length > 1) btnLabels[l] = (btnLabels[l] || 0) + 1; }
  const boxes = q('input[type="checkbox"]'); const formText = (f) => (f.fields.map((x) => (x.name || '') + ' ' + (x.label || '') + ' ' + (x.placeholder || '')).join(' ')).toLowerCase();
  const mediaText = top(breakpoints, 200).map((x) => x.value).join(' | ');
  let hoverRules = 0, focusRules = 0, focusOutlineRemoved = 0, transitions = 0, importantCount = 0; const fontDisplay = {};
  for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules; } catch { continue; } let n = 0;
    for (const r of rules) { if (++n > 6000) break; const sel = r.selectorText || ''; if (!sel && r.type !== 5) continue;
      if (r.type === 5) { bump(fontDisplay, r.style.getPropertyValue('font-display') || 'not set'); continue; }
      if (sel.includes(':hover')) hoverRules++; if (sel.includes(':focus')) { focusRules++; const o = r.style.outline || r.style.outlineStyle || r.style.outlineWidth; if (/^(none|0|0px)/.test(o) && !r.style.boxShadow && !r.style.border) focusOutlineRemoved++; }
      if (r.style && (r.style.transition || r.style.animationName)) transitions++; if (r.cssText && r.cssText.includes('!important')) importantCount++; } }
  const imgFormats = {}; let oversized = 0, lazyImgs = 0, noDims = 0;
  for (const im of q('img')) { const u = (im.currentSrc || im.src || '').split('?')[0]; const ext = (u.match(/\.(\w{3,4})$/) || [])[1]; if (ext) bump(imgFormats, ext.toLowerCase()); if (im.loading === 'lazy') lazyImgs++; if (!im.getAttribute('width') && !im.getAttribute('height')) noDims++; const r = im.getBoundingClientRect(); if (r.width > 20 && im.naturalWidth > r.width * 2.5 && im.naturalWidth > 600) oversized++; }
  const hostsSeen = new Set(); for (const el of q('a[href], script[src], link[href], img[src], iframe[src], form[action]')) { try { hostsSeen.add(new URL(abs(el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('action'))).hostname); } catch { /* skip */ } }
  const secretHits = []; const inlineJs = scripts.map((x) => x.inline || '').join('\n').slice(0, 3000000);
  for (const [re, n] of [[/AKIA[0-9A-Z]{16}/, 'AWS access key'], [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'], [/sk_live_[0-9a-zA-Z]{16,}/, 'Stripe secret key'], [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'Private key'], [/xox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack token'], [/gh[pousr]_[0-9A-Za-z]{30,}/, 'GitHub token'], [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JSON web token'], [/(?:password|passwd|secret|api_?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i, 'Hard-coded credential-like value']]) { const m = (inlineJs + H).match(re); if (m) secretHits.push(`${n}: ${m[0].slice(0, 12)}…(${m[0].length} chars)`); }
  const libs = {}; try { const w = window; if (w.React && w.React.version) libs.React = w.React.version; if (w.Vue && w.Vue.version) libs.Vue = w.Vue.version; if (w.jQuery && w.jQuery.fn) libs.jQuery = w.jQuery.fn.jquery; if (w.angular && w.angular.version) libs.AngularJS = w.angular.version.full; if (w._ && w._.VERSION) libs['Lodash/Underscore'] = w._.VERSION; if (w.bootstrap && w.bootstrap.Tooltip && w.bootstrap.Tooltip.VERSION) libs.Bootstrap = w.bootstrap.Tooltip.VERSION; if (w.moment && w.moment.version) libs.Moment = w.moment.version; if (w.gsap && w.gsap.version) libs.GSAP = w.gsap.version; if (w.Swiper) libs.Swiper = 'present'; if (w.axios) libs.axios = w.axios.VERSION || 'present'; if (w.d3 && w.d3.version) libs.D3 = w.d3.version; if (w.Chart && w.Chart.version) libs['Chart.js'] = w.Chart.version; const ngv = document.querySelector('[ng-version]'); if (ngv) libs.Angular = ngv.getAttribute('ng-version'); } catch { /* best effort */ }
  const years = (T.match(/\b(19|20)\d{2}\b/g) || []).map(Number).filter((y) => y <= new Date().getFullYear() + 1); const times = q('time[datetime]').map((t) => t.getAttribute('datetime')).filter(Boolean).sort();
  const sentences = (visibleText.match(/[^.!?\n]+[.!?]/g) || []).length;
  const signals = {
    // journeys and interaction
    siteSearch: q('input[type="search"], form[role="search"], input[name="q"], input[name="s"], input[name="search"], input[placeholder*="earch" i]').length > 0, filterControls: q('select, input[type="range"], [role="combobox"], [role="listbox"]').length, sortControls: links.filter((l) => /[?&](sort|order|orderby)=/i.test(l.href || '')).length,
    breadcrumbs: q('[aria-label*="readcrumb" i], .breadcrumb, .breadcrumbs').length > 0 || JSON.stringify(jsonLd).includes('BreadcrumbList'), navLinks: (document.querySelector('nav') ? document.querySelector('nav').querySelectorAll('a').length : 0), footerLinks: (document.querySelector('footer') ? document.querySelector('footer').querySelectorAll('a').length : 0),
    callsToAction: top(btnLabels, 12).map((x) => x.value), formsCount: forms.length, formFields: forms.reduce((n, f) => n + f.fields.length, 0), requiredFields: q('[required], [aria-required="true"]').length, fieldsWithAutocomplete: q('input[autocomplete]').length, fieldsWithValidation: q('input[pattern], input[minlength], input[maxlength], input[min], input[max], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input[type="date"]').length, inlineErrorRegions: q('[aria-invalid], [role="alert"], [aria-live], .error, .invalid-feedback').length,
    loadingIndicators: q('[class*="skeleton" i], [class*="spinner" i], [class*="loader" i], [aria-busy="true"], progress').length, emptyStateWording: pick1(/no (results|items|records|posts|products) (found|yet|available)|nothing (here|found|to show)/i), errorWording: pick1(/something went wrong|page not found|an error (has )?occurred|try again later/i),
    modalsAndDialogs: q('dialog, [role="dialog"], [aria-modal="true"], .modal').length, carousels: q('[class*="carousel" i], [class*="slider" i], [class*="swiper" i]').length, tooltips: q('[title], [data-tooltip], [data-bs-toggle="tooltip"]').length, draggable: q('[draggable="true"]').length, infiniteScrollHint: hx(/infinite[-_ ]?scroll|IntersectionObserver/),
    // accounts and trust
    signInForm: q('input[type="password"]').length > 0, registerLink: findLink(/register|sign ?up|create (an )?account|join now|apply now|enrol/i), passwordReset: findLink(/forgot|reset (your )?password|recover/i), singleSignOn: [...new Set((T.match(/(sign in|log in|continue|sign up) with (google|microsoft|facebook|apple|github|linkedin|twitter)/gi) || []).map((x) => x.toLowerCase()))], multiFactorMention: tx(/two[- ]factor|2fa|multi[- ]factor|authenticator app|one[- ]time (pin|code|password)|\botp\b/i), passwordRulesShown: pick1(/(at least|minimum( of)?) \d+ characters|must (contain|include) [^.]{5,60}/i), rememberMe: tx(/remember me|keep me (signed|logged) in|stay signed in/i),
    captcha: hx(/g-recaptcha|grecaptcha|hcaptcha|cf-turnstile|challenges\.cloudflare/), honeypotFields: q('input[name*="honey" i], input[name*="hp_" i], input[tabindex="-1"][autocomplete="off"]').length,
    accountDeletionOrExport: pick1(/delete (my |your )?account|close (my |your )?account|export (my |your )?data|download (my |your )?data|cancel (my |your |the )?(subscription|membership|plan)/i), unsubscribeMention: tx(/unsubscribe|opt[- ]out|manage (your )?preferences/i), onboardingWording: pick1(/get started|take (a|the) tour|welcome to|how it works|step \d of \d/i),
    // business
    cartOrCheckout: findLink(/\b(cart|basket|checkout|bag)\b/i), paymentProviders: names([[/js\.stripe\.com|stripe/i, 'Stripe'], [/paypal/i, 'PayPal'], [/payfast/i, 'PayFast'], [/yoco/i, 'Yoco'], [/paystack/i, 'Paystack'], [/peachpayments/i, 'Peach Payments'], [/ozow/i, 'Ozow'], [/snapscan/i, 'SnapScan'], [/zapper/i, 'Zapper'], [/klarna/i, 'Klarna'], [/squareup|square\.site/i, 'Square'], [/adyen/i, 'Adyen'], [/braintree/i, 'Braintree'], [/paddle\.(com|js)/i, 'Paddle'], [/shop\.app|shopify.*pay/i, 'Shop Pay'], [/payflex|payjustnow/i, 'Buy now, pay later'], [/apple-pay|applepay/i, 'Apple Pay'], [/google-pay|googlepay|pay\.google/i, 'Google Pay']]),
    pricesShown: (T.match(/(?:\bR|ZAR|\$|USD|€|£)\s?\d[\d ,.]*\d\b/g) || []).length, priceExamples: [...new Set(T.match(/(?:\bR|ZAR|\$|USD|€|£)\s?\d[\d ,.]*\d\b(?:\s?(?:pm|p\/m|per month|per year|\/month|\/year|\/mo|pa|p\.a\.))?/gi) || [])].slice(0, 10), pricingPage: findLink(/pricing|price list|fees|plans|tariff|rates|packages/i), vatMention: pick1(/(incl|excl|including|excluding)\.? ?(of )?vat|vat (no|number|reg)[^\n]{0,30}|\btax (included|excluded)\b/i), freeTrialOrDiscount: pick1(/free trial|\d+% off|discount|promo code|coupon|special offer|limited[- ]time/i), subscriptionWording: pick1(/subscribe|subscription|membership|per month|billed (monthly|annually)/i),
    testimonials: tx(/testimonial|what (our )?(clients|customers|parents|students|users|members) (say|think)|customer stories|case stud(y|ies)|trusted by|as seen (in|on)/i), ratings: JSON.stringify(jsonLd).match(/AggregateRating|"Review"/) ? 'rating data in structured data' : pick1(/\b[1-5](\.\d)? ?(out of|\/) ?5\b|★{3,}|\d[\d,]* reviews/i), awardsOrAccreditation: pick1(/accredited|certified|award[- ]winning|member of|registered with|ISO ?\d{4,5}|B-BBEE|umalusi|IEB\b|ISASA/i), partnerLogos: q('[class*="partner" i] img, [class*="client" i] img, [class*="sponsor" i] img, [class*="logo-" i] img').length, newsletterSignup: forms.some((f) => /newsletter|subscribe|mailing/.test(formText(f)) || (f.fields.filter((x) => x.type !== 'hidden' && x.tag !== 'button').length <= 2 && f.fields.some((x) => x.type === 'email'))), campaignParametersInLinks: links.filter((l) => /[?&]utm_/i.test(l.rawHref || '')).length,
    valueProposition: clean((document.querySelector('h1') || {}).textContent || '').slice(0, 160) || null, taglineOrSubheading: clean((document.querySelector('h1 + p, h1 + h2, .hero p, [class*="hero" i] p, [class*="tagline" i], [class*="subtitle" i]') || {}).textContent || '').slice(0, 200) || null, comparisonWording: pick1(/\b(vs\.?|versus|compared to|better than|unlike other|alternative to)\b[^\n]{0,60}/i), upsellWording: pick1(/upgrade|premium|pro plan|you (may|might) also like|frequently bought together|add[- ]ons?|recommended for you/i), roadmapOrChangelog: findLink(/roadmap|changelog|release notes|what'?s new|coming soon/i), investorOrPress: findLink(/investor|press|media kit|newsroom|annual report/i),
    // help and support
    faq: tx(/frequently asked|\bfaqs?\b/i) || JSON.stringify(jsonLd).includes('FAQPage'), helpCentre: findLink(/help|support|knowledge ?base|docs|documentation|how[- ]to|guides?/i), chatWidgets: names([[/intercom/i, 'Intercom'], [/tawk\.to/i, 'Tawk.to'], [/crisp\.chat/i, 'Crisp'], [/zdassets|zendesk/i, 'Zendesk'], [/drift\.com|driftt/i, 'Drift'], [/tidio/i, 'Tidio'], [/livechatinc/i, 'LiveChat'], [/wa\.me|api\.whatsapp\.com|whatsapp:\/\//i, 'WhatsApp'], [/m\.me\/|messenger/i, 'Messenger'], [/freshchat|freshdesk/i, 'Freshworks'], [/hubspot.*conversations|hs-chat/i, 'HubSpot chat'], [/olark/i, 'Olark']]), feedbackOrSurvey: pick1(/give (us )?feedback|was this (page|article) helpful|rate (this|your)|take (our|the) survey/i) || (hx(/typeform|surveymonkey|hotjar.*survey|usabilla|qualtrics/i) ? 'survey tool loaded' : null), statusPage: findLink(/status\.|\/status\b|uptime/i), reportAbuse: pick1(/report (abuse|this|a problem|content|user)|flag (this|as inappropriate)|appeal/i), communityFeatures: pick1(/forum|community|discussion|comments? \(\d+\)|leave a (comment|reply)|join the conversation|members? directory/i),
    // persuasion, wellbeing, personalisation
    countdownTimer: /\b\d{1,2}\s?:\s?\d{2}\s?:\s?\d{2}\b/.test(T) && tx(/offer|sale|ends|left|hurry|deal/i), scarcityWording: pick1(/only \d+ (left|remaining|spots?|seats?)|selling fast|almost (gone|sold out)|\d+ (people|others) (are )?(viewing|looking|bought)|limited (stock|spaces|availability)|last chance|hurry/i), confirmShaming: pick1(/no thanks?,? i (don'?t|do not|prefer|hate|like)[^\n]{0,50}/i), preTickedBoxes: boxes.filter((b) => b.defaultChecked && /newsletter|marketing|consent|subscribe|offers|promot|agree|terms|third/i.test((b.name || '') + ' ' + ((b.labels && b.labels[0] && b.labels[0].textContent) || ''))).length, autoplayVideo: q('video[autoplay]').length, popupsOnLoad: q('[class*="popup" i], [class*="overlay" i][style*="block"], [class*="interstitial" i]').length, stickyElements: all.length <= 12000 ? all.filter((el) => { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'sticky'; }).length : null,
    personalisation: pick1(/welcome back|recommended for you|recently viewed|based on your|hi,? [A-Z][a-z]+!|your (dashboard|account|profile|orders)/), gamification: pick1(/\b(points|badges?|leaderboard|streak|level up|achievements?|rewards?|xp)\b/i), notificationsPrompt: pick1(/(enable|allow|turn on) notifications|push notifications|notify me|sms (alerts|notifications)/i), endlessFeed: hx(/infinite[-_ ]?scroll/i), screenTimeWording: pick1(/take a break|screen time|digital wellbeing|quiet hours|do not disturb/i),
    // content
    language: document.documentElement.lang || null, direction: document.documentElement.dir || getComputedStyle(document.documentElement).direction, hreflangs: linkTags.filter((l) => l.hreflang).map((l) => l.hreflang), languageSwitcher: q('[class*="lang" i] a, [class*="locale" i] a, select[name*="lang" i], [hreflang]').length > 0, translateWidget: hx(/translate\.google|gtranslate|weglot|wpml|polylang/i), nonLatinText: /[֐-ࣿ぀-ヿ一-鿿가-힯฀-๿ऀ-ॿ]/.test(visibleText.slice(0, 20000)),
    sentences, wordsPerSentence: sentences ? Math.round(((visibleText.match(/\S+/g) || []).length / sentences) * 10) / 10 : null, headingsCount: headings.length, listsCount: q('ul, ol').length, paragraphs: q('p').length, longParagraphs: q('p').filter((p) => (p.textContent.match(/\S+/g) || []).length > 120).length, boldOrHighlighted: q('strong, b, mark, em').length, readingTimeMinutes: Math.max(1, Math.round((visibleText.match(/\S+/g) || []).length / 220)),
    publishedDate: metaMap['article:published_time'] || metaMap.date || metaMap['dc.date'] || times[0] || null, modifiedDate: metaMap['article:modified_time'] || metaMap['og:updated_time'] || metaMap['last-modified'] || (times.length ? times[times.length - 1] : null), latestYearMentioned: years.length ? Math.max(...years) : null, copyrightYear: +(((allText.match(/(?:©|\(c\)|copyright)\s?(?:\d{4}\s?[-–]\s?)?((?:19|20)\d{2})/i) || [])[1]) || 0) || null, author: metaMap.author || metaMap['article:author'] || clean((document.querySelector('[rel="author"], .author, [class*="byline" i], [itemprop="author"]') || {}).textContent || '').slice(0, 80) || null,
    tagsAndCategories: [...new Set(q('a[rel~="tag"], [class*="tag" i] a, [class*="categor" i] a').map((x) => clean(x.textContent)).filter((x) => x && x.length < 40))].slice(0, 30), keywordsMeta: metaMap.keywords || null, videos: q('video').length, audios: q('audio').length, videoEmbeds: iframes.filter((f) => /youtube|youtu\.be|vimeo|wistia|loom|dailymotion|tiktok/i.test(f.src || '')).length, captionTracks: q('track[kind="captions"], track[kind="subtitles"]').length, transcriptMention: tx(/transcript/i), podcastOrFeed: linkTags.filter((l) => /rss|atom/i.test(l.type || '')).map((l) => l.href),
    userGeneratedContent: forms.some((f) => /comment|review|reply|message|post/.test(formText(f))) || q('[class*="comment" i], [id*="comment" i], [class*="review" i]').length > 3, commentCount: q('[class*="comment" i][class*="item" i], .comment, li.comment, article.comment').length, firstPersonWords: (T.match(/\b(we|our|us)\b/gi) || []).length, secondPersonWords: (T.match(/\b(you|your)\b/gi) || []).length, exclamations: (T.match(/!/g) || []).length, questions: (T.match(/\?/g) || []).length, jargonOrAcronyms: [...new Set(T.match(/\b[A-Z]{3,6}\b/g) || [])].slice(0, 25), emoji: (T.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length, inclusiveFormOptions: q('select, input[type="radio"]').filter((el) => /gender|title|sex/i.test(el.name || '')).map((el) => el.localName === 'select' ? [...el.options].map((o) => clean(o.textContent)).join('/') : el.value).slice(0, 12),
    ageGate: pick1(/are you (over|at least|older than) \d+|age verification|confirm your age|you must be \d+|parental consent|under ?1[368]s?/i), childDirected: pick1(/\bkids?\b|\bchildren\b|\bfor ages? \d+|parents? (and|&) (kids|children|guardians)/i), safeguardingWording: pick1(/safeguarding|child protection|anti[- ]bullying|code of conduct|community guidelines|acceptable use|moderation|moderators?/i),
    // front end and engineering, as far as a browser can see
    libraries: libs, buildTooling: names([[/webpackChunk|__webpack_require__|webpackJsonp/, 'webpack'], [/\/assets\/index-[\w-]{8,}\.js|@vite|vite\/modulepreload/, 'Vite'], [/parcelRequire/, 'Parcel'], [/\/_next\/static\/chunks\/webpack-/, 'Next.js (webpack)'], [/turbopack/i, 'Turbopack'], [/\/_astro\//, 'Astro'], [/\/_app\/immutable\//, 'SvelteKit'], [/\/build\/_shared\//, 'Remix'], [/gatsby-/, 'Gatsby'], [/wp-content\/cache|wp-rocket|autoptimize|w3tc/i, 'WordPress optimiser'], [/\.min\.(js|css)/, 'minified assets'], [/\.[a-f0-9]{8,20}\.(js|css)/, 'fingerprinted file names']]),
    cssFrameworks: names([[/bootstrap/i, 'Bootstrap'], [/class="[^"]*\b(sm|md|lg|xl):[a-z]/, 'Tailwind CSS'], [/\bMui[A-Z]\w+-root/, 'Material UI'], [/\bchakra-/, 'Chakra UI'], [/\bant-(btn|layout|menu)/, 'Ant Design'], [/bulma/i, 'Bulma'], [/foundation(\.min)?\.css/i, 'Foundation'], [/elementor/i, 'Elementor'], [/\bwp-block-/, 'WordPress blocks'], [/\bcss-[a-z0-9]{5,8}\b|\bsc-[a-zA-Z]{6}\b/, 'CSS-in-JS'], [/data-v-[a-f0-9]{8}/, 'Vue scoped styles']]),
    iconSystems: names([[/font-?awesome|\bfa[srldb]? fa-/i, 'Font Awesome'], [/material-icons|material-symbols/i, 'Material icons'], [/<use [^>]*href="[^"]*#/i, 'SVG sprite'], [/bootstrap-icons|\bbi bi-/, 'Bootstrap icons'], [/lucide|feather-icon/i, 'Lucide / Feather'], [/dashicons/, 'Dashicons'], [/ionicon/i, 'Ionicons']]), inlineSvgs: q('svg').length, iconFontsInUse: hx(/font-?awesome|material-icons|glyphicon|icomoon/i),
    experimentsAndFlags: names([[/optimizely/i, 'Optimizely'], [/visualwebsiteoptimizer|vwo_/i, 'VWO'], [/googleoptimize|optimize\.google/i, 'Google Optimize'], [/launchdarkly/i, 'LaunchDarkly'], [/split\.io/i, 'Split'], [/growthbook/i, 'GrowthBook'], [/statsig/i, 'Statsig'], [/posthog/i, 'PostHog'], [/ab-?test|experiment_id|variant[_-]?id/i, 'experiment markers in code']]),
    monitoringTools: names([[/sentry/i, 'Sentry'], [/datadoghq|dd-rum/i, 'Datadog'], [/newrelic|nr-data/i, 'New Relic'], [/logrocket/i, 'LogRocket'], [/bugsnag/i, 'Bugsnag'], [/rollbar/i, 'Rollbar'], [/appdynamics/i, 'AppDynamics'], [/elastic-apm|rum\.elastic/i, 'Elastic APM'], [/raygun/i, 'Raygun'], [/trackjs/i, 'TrackJS']]),
    sessionRecording: names([[/hotjar/i, 'Hotjar'], [/clarity\.ms/i, 'Microsoft Clarity'], [/fullstory/i, 'FullStory'], [/mouseflow/i, 'Mouseflow'], [/smartlook/i, 'Smartlook'], [/crazyegg/i, 'Crazy Egg'], [/luckyorange/i, 'Lucky Orange'], [/logrocket/i, 'LogRocket']]), fingerprintingHints: names([[/fingerprintjs|fpjs/i, 'FingerprintJS'], [/canvas.*toDataURL.*fingerprint|AudioContext.*fingerprint/i, 'canvas/audio fingerprint code'], [/navigator\.plugins|navigator\.hardwareConcurrency/, 'device-trait reads']]),
    emailServices: names([[/mailchimp|chimpstatic|list-manage/i, 'Mailchimp'], [/klaviyo/i, 'Klaviyo'], [/sendgrid/i, 'SendGrid'], [/brevo|sendinblue/i, 'Brevo'], [/mailerlite/i, 'MailerLite'], [/convertkit/i, 'ConvertKit'], [/hubspot/i, 'HubSpot'], [/campaign-?monitor|createsend/i, 'Campaign Monitor'], [/activecampaign/i, 'ActiveCampaign']]), integrations: names([[/maps\.google|maps\.googleapis/i, 'Google Maps'], [/calendly/i, 'Calendly'], [/typeform/i, 'Typeform'], [/docs\.google\.com\/forms|forms\.gle/i, 'Google Forms'], [/forms\.office\.com/i, 'Microsoft Forms'], [/jotform/i, 'Jotform'], [/zapier/i, 'Zapier'], [/algolia/i, 'Algolia search'], [/cloudinary/i, 'Cloudinary'], [/imgix/i, 'imgix'], [/firebase/i, 'Firebase'], [/supabase/i, 'Supabase'], [/amazonaws\.com/i, 'Amazon S3 / AWS'], [/blob\.core\.windows\.net|azureedge/i, 'Azure storage'], [/storage\.googleapis/i, 'Google Cloud Storage'], [/disqus/i, 'Disqus'], [/trustpilot/i, 'Trustpilot'], [/onesignal/i, 'OneSignal push'], [/pusher|socket\.io|ably/i, 'real-time service'], [/elfsight/i, 'Elfsight widgets'], [/mapbox/i, 'Mapbox'], [/openstreetmap|leaflet/i, 'OpenStreetMap / Leaflet']]),
    otherEnvironmentsMentioned: [...hostsSeen].filter((h2) => /(^|[.-])(dev|staging|stage|test|uat|qa|preprod|sandbox|beta|demo|old|new|admin|internal|intranet)([.-]|$)|localhost|127\.0\.0\.1|\.local$/i.test(h2) && h2 !== location.hostname).slice(0, 20), possibleSecretsInCode: secretHits, debugLeftovers: (H.match(/console\.(log|debug)\(|debugger;|TODO|FIXME|XXX/g) || []).length, generatorTag: metaMap.generator ? String([].concat(metaMap.generator)[0]) : null, apiStyleHints: names([[/graphql/i, 'GraphQL'], [/\/api\/v\d+\//, 'versioned REST paths'], [/\/wp-json\//, 'WordPress REST'], [/\/rest\/|\/api\//, 'REST-style paths'], [/odata/i, 'OData'], [/\.asmx|soap/i, 'SOAP'], [/trpc/i, 'tRPC'], [/grpc-web/i, 'gRPC-web']]),
    clientRendered: null, hydrationMarkers: names([[/__NEXT_DATA__|data-reactroot|data-react-helmet/, 'React server render + hydration'], [/data-server-rendered|__NUXT__/, 'Vue server render + hydration'], [/ng-server-context|ng-state/, 'Angular server render'], [/data-sveltekit|__sveltekit/, 'SvelteKit'], [/astro-island/, 'Astro islands'], [/data-turbo|turbolinks/, 'Turbo / Turbolinks'], [/hx-get|hx-post/, 'htmx'], [/wire:|livewire/, 'Livewire'], [/phx-/, 'Phoenix LiveView'], [/__VIEWSTATE/, 'ASP.NET WebForms'], [/blazor/i, 'Blazor']]), routingStyle: location.hash.startsWith('#/') ? 'hash routing' : (history.state ? 'history-API routing' : 'server routing'), urlHasFileExtension: (location.pathname.match(/\.(php|aspx?|jsp|html?|cfm|do|action)$/i) || [])[1] || null, urlDepth: location.pathname.split('/').filter(Boolean).length, urlQueryParameters: [...new URL(location.href).searchParams.keys()],
    stateContainers: Object.keys(globals), storageKeys: { local: Object.keys(storage(window.localStorage)), session: Object.keys(storage(window.sessionStorage)) }, webComponents: all.filter((el) => el.localName.includes('-')).length, deprecatedHtml: q('font, center, marquee, frameset, frame, big, strike, tt, acronym, applet').length, tablesForLayout: q('table').filter((t) => !t.querySelector('th') && t.querySelector('table, img, form')).length, inlineStyles: q('[style]').length, duplicateIds: (() => { const s2 = new Set(); let d2 = 0; for (const el of q('[id]')) { if (s2.has(el.id)) d2++; else s2.add(el.id); } return d2; })(), doctype: document.doctype ? document.doctype.name : null, semanticElements: q('main, article, section, aside, header, footer, nav, figure, time, address').length, ariaAttributes: all.filter((el) => [...el.attributes].some((at) => at.name.startsWith('aria-') || at.name === 'role')).length,
    // performance details
    imageFormats: imgFormats, oversizedImages: oversized, lazyLoadedImages: lazyImgs, imagesWithoutDimensions: noDims, responsiveImages: q('img[srcset], picture source').length, fontDisplay, preloads: linkTags.filter((l) => /preload|preconnect|dns-prefetch|modulepreload|prefetch/i.test(l.rel || '')).map((l) => l.rel), renderBlockingScripts: [...document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type="module"])')].length, asyncOrDeferredScripts: q('script[async], script[defer], script[type="module"]').length, stylesheets: linkTags.filter((l) => /stylesheet/i.test(l.rel || '')).length, inlineStyleBlocks: styles.inline.length, iframesCount: iframes.length, webFonts: [...(document.fonts || [])].length,
    // visual design details
    hoverRules, focusRules, focusOutlineRemoved, transitionsAndAnimations: transitions, importantOverrides: importantCount, darkModeStyles: /prefers-color-scheme/.test(mediaText), printStyles: /\bprint\b/.test(mediaText) || linkTags.some((l) => /print/.test(l.media || '')), reducedMotionStyles: /prefers-reduced-motion/.test(mediaText), highContrastStyles: /prefers-contrast|forced-colors/.test(mediaText), themeToggle: q('[class*="theme" i][class*="toggle" i], [aria-label*="dark" i], [class*="dark-mode" i]').length > 0, heroImage: !!document.querySelector('[class*="hero" i] img, [class*="banner" i] img, header img'), imageCount: q('img').length, photoLikeImages: q('img').filter((i) => /\.jpe?g|\.webp|\.avif/i.test(i.currentSrc || i.src || '')).length, illustrationLikeImages: q('img').filter((i) => /\.svg|\.png|\.gif/i.test(i.currentSrc || i.src || '')).length, textDensityWordsPerScreen: Math.round(((visibleText.match(/\S+/g) || []).length / Math.max(1, document.documentElement.scrollHeight / window.innerHeight)) * 10) / 10, appIcons: linkTags.filter((l) => /apple-touch-icon|mask-icon|icon/i.test(l.rel || '')).map((l) => `${l.rel}${l.sizes ? ' ' + l.sizes : ''}`), audioAutoplay: q('audio[autoplay]').length,
    // machines
    canonicalMatchesUrl: (rel('canonical')[0] || {}).href ? (rel('canonical')[0].href.replace(/\/$/, '') === location.href.split('#')[0].replace(/\/$/, '')) : null, structuredDataTypes: [...new Set(JSON.stringify(jsonLd).match(/"@type":\s*"([^"]+)"/g) || [])].map((x) => x.replace(/.*"([^"]+)"$/, '$1')).slice(0, 30), socialPreview: { title: metaMap['og:title'] || null, image: metaMap['og:image'] || null, description: metaMap['og:description'] || null, twitterCard: metaMap['twitter:card'] || null }, localBusinessData: /LocalBusiness|PostalAddress|"geo"|openingHours/.test(JSON.stringify(jsonLd)), addressShown: pick1(/\d{1,5} [A-Z][a-z]+ (Road|Street|Avenue|Drive|Lane|Rd|St|Ave|Dr|Way|Close|Crescent)\b[^\n]{0,60}/), mapEmbed: iframes.some((f) => /google\.[a-z.]+\/maps|openstreetmap|mapbox/i.test(f.src || '')), openingHours: pick1(/(mon|monday)[a-z]*\s?[-–to]+\s?(fri|friday|sat|sun)[a-z]*[^\n]{0,40}|open(ing)? hours[^\n]{0,60}/i), speakableOrVoice: /speakable|SpeakableSpecification/.test(JSON.stringify(jsonLd)), aiCrawlerRulesInMeta: metaMap.robots && /noai|noimageai/i.test(String(metaMap.robots)) ? String(metaMap.robots) : null, internalLinks: links.filter((l) => l.internal).length, externalLinks: links.filter((l) => l.internal === false).length, nofollowLinks: links.filter((l) => /nofollow|sponsored|ugc/.test(l.rel || '')).length, sponsoredOrAdMarkers: q('[class*="sponsor" i], [class*="advert" i], ins.adsbygoogle, [id*="google_ads" i], [data-ad-slot]').length + (T.match(/\b(sponsored|advertisement|paid partnership|affiliate link)\b/gi) || []).length,
    // legal detail
    cookieChoices: consentEl ? { accept: /accept|agree|allow|got it|ok\b/i.test(consentEl.textContent), reject: /reject|decline|deny|refuse|necessary only|essential only/i.test(consentEl.textContent), settings: /settings|preferences|customi[sz]e|manage/i.test(consentEl.textContent) } : null, lawsMentioned: [...new Set((T.match(/\b(POPIA?|GDPR|CCPA|PAIA|COPPA|ECT Act|Consumer Protection Act|CPA|FICA|PCI[- ]DSS|WCAG|ADA|HIPAA|ISO 27001|SOC 2)\b/g) || []))], informationOfficer: pick1(/information officer[^\n]{0,80}|data protection officer[^\n]{0,80}/i), dataRequestsWording: pick1(/(access|correct|delete|erase|object to)[^\n]{0,40}(personal (information|data))|data subject (access )?request|right to (be forgotten|erasure|access)/i), breachWording: pick1(/data breach|security (incident|compromise)[^\n]{0,60}/i), retentionWording: pick1(/(retain|keep|store)[^\n]{0,40}(for|period|as long as)[^\n]{0,50}/i), dataLocationWording: pick1(/(stored|hosted|processed|transferred)[^\n]{0,30}(in|to|outside) (south africa|the (eu|eea|us|uk)|europe|united states|other countries)[^\n]{0,40}/i), refundPolicyWording: pick1(/refund[^\n]{0,80}|cooling[- ]off[^\n]{0,60}|\d+[- ]day (return|money[- ]back)[^\n]{0,40}/i), licenceMentions: [...new Set((T + H.slice(0, 300000)).match(/\b(MIT License|Apache License|GPL(v\d)?|Creative Commons|CC BY[-A-Z]*|All rights reserved|Unsplash|Shutterstock|Getty Images|iStock|Adobe Stock|Pexels|Google Fonts|SIL Open Font)\b/g) || [])].slice(0, 15), trademarkMarks: (T.match(/[™®]/g) || []).length, disclaimerWording: pick1(/disclaimer[^\n]{0,80}|not (financial|legal|medical) advice[^\n]{0,40}/i), slaOrUptimeWording: pick1(/\b\d{2}(\.\d+)?% uptime|service[- ]level agreement|\bSLA\b[^\n]{0,40}/i), takedownWording: pick1(/takedown|dmca|copyright (complaint|infringement)[^\n]{0,60}/i), sectorRegulators: [...new Set((T.match(/\b(FSCA|FSP ?\d+|NCR(CP\d+)?|HPCSA|SAHPRA|Umalusi|SACE|DHET|ICASA|SARS|CIPC|FAIS|Department of (Basic )?Education|FCA|SEC|FDA|Ofsted)\b/g) || []))],
  };

  return {
    signals,
    design, accessibility, security, legal, privacy, vitals,
    url: location.href, title: document.title, technologies: [...tech],
    language: document.documentElement.lang || null, dir: document.documentElement.dir || null,
    charset: document.characterSet, doctype: document.doctype ? document.doctype.name : null,
    description: metaMap.description || metaMap['og:description'] || null,
    canonical: (rel('canonical')[0] || {}).href || null,
    robotsMeta: metaMap.robots || null,
    meta: { all: meta, byName: metaMap, openGraph: pick('og:'), twitter: pick('twitter:'), article: pick('article:') },
    linkTags,
    icons: linkTags.filter((l) => /icon/i.test(l.rel || '')).map((l) => l.href),
    alternates: rel('alternate'), manifest: (rel('manifest')[0] || {}).href || null,
    pagination: { next: (rel('next')[0] || {}).href || null, prev: (rel('prev')[0] || {}).href || null },
    structuredData: { jsonLd, microdata, jsonScripts, appState: globals },
    headings, h1Count: headings.filter((x) => x.level === 1).length, imagesMissingAlt: images.filter((i) => !i.fromPictureSource && (i.alt == null || i.alt === '')).length,
    text: { visible: visibleText, all: allText },
    wordCount: (visibleText.match(/\S+/g) || []).length,
    links, images, backgroundImages, svgs, media, iframes, tables, lists, forms, looseFields, buttons,
    landmarks: { nav: landmark('nav, [role="navigation"]'), header: landmark('body > header, [role="banner"]'), footer: landmark('body > footer, [role="contentinfo"]') },
    scripts, styles, comments, dataAttributes,
    contacts: { emails: [...emails], phones: [...phones], socials: [...socials] },
    storage: { localStorage: storage(window.localStorage), sessionStorage: storage(window.sessionStorage) },
    performance: perf,
    dom: { elementCount: all.length, shadowRoots },
    hiddenText: { attributes: [...attrText].slice(0, 3000), generated: [...generated].slice(0, 1000) }, _canvases: canvases,
    _composedHtml: composedHtml,
  };
};
