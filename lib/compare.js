'use strict';
/* What changed between two scrapes of the same site (older first). Works on two site.json summaries. */
const keyOf = (u) => { try { const x = new URL(u); return (x.pathname.replace(/\/$/, '') || '/') + x.search; } catch { return u; } };
const setDiff = (a, b) => ({ added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) });

function compare(older, newer) {
  const A = new Map(older.pages.map((p) => [keyOf(p.url), p])); const B = new Map(newer.pages.map((p) => [keyOf(p.url), p]));
  const added = [], removed = [], changed = [], statusChanged = [], titleChanged = [];
  for (const [k, p] of B) {
    const o = A.get(k);
    if (!o) { added.push({ url: p.url, title: p.title }); continue; }
    if ((o.status || 0) !== (p.status || 0)) statusChanged.push({ url: p.url, was: o.status, now: p.status });
    if ((o.title || '') !== (p.title || '')) titleChanged.push({ url: p.url, was: o.title, now: p.title });
    if (o.hash && p.hash && o.hash !== p.hash) changed.push({ url: p.url, title: p.title, wordsWas: o.words, wordsNow: p.words });
  }
  for (const [k, p] of A) if (!B.has(k)) removed.push({ url: p.url, title: p.title });
  const PA = older.perspectives || {}, PB = newer.perspectives || {};
  const sec = (P) => new Map(((P.security || {}).findings || []).map((f) => [f.title, f]));
  const sa = sec(PA), sb = sec(PB);
  const names = (list, f) => new Set((list || []).map(f));
  const num = (label, a, b, unit = '') => (a == null && b == null ? null : { label, was: a ?? null, now: b ?? null, change: a != null && b != null ? Math.round((b - a) * 1000) / 1000 : null, unit });
  const av = (P) => ((P.performance || {}).averages || {}); const ac = (P) => P.accessibility || {};
  const numbers = [
    num('Pages', older.stats.pages, newer.stats.pages), num('Words', (PA.content || {}).totalWords, (PB.content || {}).totalWords), num('Documents', older.stats.filesDownloaded, newer.stats.filesDownloaded),
    num('Average page size', av(PA).pageBytes, av(PB).pageBytes, 'bytes'), num('Largest paint', av(PA).largestPaintMs, av(PB).largestPaintMs, 'ms'), num('Requests per page', av(PA).requests, av(PB).requests),
    num('Serious security findings', ((PA.security || {}).summary || {}).high, ((PB.security || {}).summary || {}).high), num('Security findings to fix', ((PA.security || {}).summary || {}).medium, ((PB.security || {}).summary || {}).medium),
    num('Low-contrast text', ac(PA).lowContrastText, ac(PB).lowContrastText), num('Images without a description', ac(PA).imagesWithoutDescription, ac(PB).imagesWithoutDescription), num('Form fields without a label', ac(PA).formFieldsWithoutLabel, ac(PB).formFieldsWithoutLabel),
    num('Broken links', older.issues.brokenInternalLinks.length, newer.issues.brokenInternalLinks.length), num('Other hosts contacted', ((PA.privacy || {}).thirdParties || []).length, ((PB.privacy || {}).thirdParties || []).length), num('Cookies', ((PA.privacy || {}).cookies || []).length, ((PB.privacy || {}).cookies || []).length),
  ].filter(Boolean);
  const out = {
    older: { url: older.startUrl, scrapedAt: older.finishedAt, pages: older.stats.pages }, newer: { url: newer.startUrl, scrapedAt: newer.finishedAt, pages: newer.stats.pages },
    pages: { added, removed, changed, statusChanged, titleChanged, unchanged: [...B.keys()].filter((k) => A.has(k)).length - changed.length },
    security: { new: [...sb.values()].filter((f) => !sa.has(f.title)).map((f) => ({ severity: f.severity, title: f.title, fix: f.fix })), resolved: [...sa.values()].filter((f) => !sb.has(f.title)).map((f) => ({ severity: f.severity, title: f.title })) },
    technology: setDiff(names(older.technologies, (t) => t.name), names(newer.technologies, (t) => t.name)),
    otherHosts: setDiff(names((PA.privacy || {}).thirdParties, (t) => t.host), names((PB.privacy || {}).thirdParties, (t) => t.host)),
    cookies: setDiff(names((PA.privacy || {}).cookies, (c) => c.name), names((PB.privacy || {}).cookies, (c) => c.name)),
    documents: setDiff(names(older.documents, (d) => keyOf(d.url)), names(newer.documents, (d) => keyOf(d.url))),
    emails: setDiff(new Set(older.contacts.emails), new Set(newer.contacts.emails)), numbers,
  };
  out.headline = [added.length && `${added.length} new pages`, removed.length && `${removed.length} pages gone`, changed.length && `${changed.length} pages changed`, statusChanged.length && `${statusChanged.length} changed status`, out.security.new.length && `${out.security.new.length} new security findings`, out.security.resolved.length && `${out.security.resolved.length} security findings resolved`].filter(Boolean).join(', ') || 'No changes found';
  out.anything = out.headline !== 'No changes found';
  return out;
}
module.exports = { compare };
