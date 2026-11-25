'use strict';
// Scores: one number out of 100 and a grade for each area, worked out the same way for every site so sites can be compared.
// Every point lost is listed with its reason, so a score can always be checked and argued with.
// These measure what a visitor's browser can see. They are not an audit: see the `limits` line on each area.

const METHOD = 1;   // raise when a formula changes, so old and new scores are not compared by mistake
const GRADES = [[95, 'A+'], [90, 'A'], [80, 'B'], [70, 'C'], [60, 'D'], [50, 'E'], [0, 'F']];
const grade = (n) => GRADES.find(([min]) => n >= min)[1];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (n) => Math.round(n * 100) + '%';
// Points lost between a "fine" value and a "bad" value, rising in a straight line.
const slope = (value, fine, bad, most) => value == null ? 0 : clamp((value - fine) / (bad - fine), 0, 1) * most;

function area(label, basis, limits, measuredOn) {
  const lost = basis.reduce((a, b) => a + b.points, 0);
  const score = Math.round(clamp(100 - lost, 0, 100));
  return { label, score, grade: grade(score), pointsLost: Math.round(lost * 10) / 10, basis: basis.filter((b) => b.points > 0.04).map((b) => ({ ...b, points: Math.round(b.points * 10) / 10 })).sort((a, b) => b.points - a.points), measuredOn, limits };
}

function security(summary, pages) {
  const P = (summary.perspectives || {}).security; if (!P) return null;
  const W = { high: 25, medium: 10, low: 4, info: 0 };
  const basis = (P.findings || []).map((f) => {
    const share = pages ? clamp((f.pagesAffected || 1) / pages, 0, 1) : 1;
    return { what: f.title, severity: f.severity, pagesAffected: f.pagesAffected, points: (W[f.severity] || 0) * (0.5 + 0.5 * share), why: (f.details || [])[0] || '', fix: f.fix || '' };
  });
  return area('Security', basis, 'Passive check of what any visitor\'s browser is sent: headers, cookies, forms, certificate, visible code. Nothing was attacked or probed, so this shows how carefully the visible settings are configured, not whether the site can be broken into.', `${pages} pages`);
}

function accessibility(summary) {
  const a = (summary.perspectives || {}).accessibility; if (!a || !a.pagesChecked) return null;
  const n = a.pagesChecked; const per = (k) => (a[k] || 0) / n;
  const rows = [
    ['Pages without a stated language', per('pagesWithoutLanguage') * 10, `${a.pagesWithoutLanguage} of ${n} pages`, 'WCAG 3.1.1', 'Set the lang attribute on the html element.'],
    ['Images without a description', Math.min(15, 3 * per('imagesWithoutDescription')), `${a.imagesWithoutDescription} images`, 'WCAG 1.1.1', 'Give each meaningful image alt text; mark decorative ones alt="".'],
    ['Links without text', Math.min(10, 3 * per('linksWithoutText')), `${a.linksWithoutText} links`, 'WCAG 2.4.4, 4.1.2', 'Give every link visible text or an aria-label.'],
    ['Buttons without a name', Math.min(10, 3 * per('buttonsWithoutName')), `${a.buttonsWithoutName} buttons`, 'WCAG 4.1.2', 'Give every button text or an aria-label.'],
    ['Form fields without a label', Math.min(15, 5 * per('formFieldsWithoutLabel')), `${a.formFieldsWithoutLabel} fields`, 'WCAG 1.3.1, 3.3.2', 'Connect a label element to each field.'],
    ['Text with low contrast', Math.min(15, 1.5 * per('lowContrastText')), `${a.lowContrastText} pieces of text`, 'WCAG 1.4.3', 'Raise contrast to at least 4.5:1 (3:1 for large text).'],
    ['Heading levels skipped', Math.min(5, 2 * per('headingLevelsSkipped')), `${a.headingLevelsSkipped} times`, 'WCAG 1.3.1', 'Do not jump from h2 to h4; keep headings in order.'],
    ['Pages without a main landmark', per('pagesWithoutMainLandmark') * 5, `${a.pagesWithoutMainLandmark} of ${n} pages`, 'WCAG 1.3.1, 2.4.1', 'Wrap the page\'s main content in a main element.'],
    ['Pages that block zooming', per('pagesBlockingZoom') * 10, `${a.pagesBlockingZoom} of ${n} pages`, 'WCAG 1.4.4', 'Remove user-scalable=no and maximum-scale from the viewport tag.'],
  ];
  return area('Accessibility', rows.map(([what, points, why, standard, fix]) => ({ what, points, why, standard, fix })), 'Automated checks find roughly a third of accessibility problems. Keyboard use, screen-reader sense and plain wording need a person.', `${n} pages`);
}

function speed(summary) {
  const p = (summary.perspectives || {}).performance; if (!p || !p.averages) return null;
  const v = p.averages; const mb = (v.pageBytes || 0) / 1048576;
  const rows = [
    ['Largest content appears late', slope(v.largestPaintMs, 2500, 4000, 25), `average ${v.largestPaintMs ?? 'n/a'} ms (good is under 2500)`, 'Shrink or preload the main image; cut render-blocking scripts and styles.'],
    ['First paint is late', slope(v.firstPaintMs, 1800, 3000, 15), `average ${v.firstPaintMs ?? 'n/a'} ms (good is under 1800)`, 'Send less before the first paint: inline critical CSS, defer scripts.'],
    ['Layout jumps while loading', slope(v.layoutShift, 0.1, 0.25, 20), `average shift ${v.layoutShift ?? 'n/a'} (good is under 0.1)`, 'Give images, ads and embeds fixed dimensions.'],
    ['Pages are heavy', slope(mb, 1.6, 5, 20), `average ${mb.toFixed(1)} MB a page (good is under 1.6)`, 'Compress images, use modern formats, drop unused scripts.'],
    ['Many requests per page', slope(v.requests, 50, 150, 10), `average ${v.requests ?? 'n/a'} (good is under 50)`, 'Bundle files and remove third-party tags that are not needed.'],
    ['Very large page structure', slope(v.domNodes, 1500, 5000, 10), `average ${v.domNodes ?? 'n/a'} elements (good is under 1500)`, 'Simplify markup; load long lists as needed.'],
  ];
  return area('Speed', rows.map(([what, points, why, fix]) => ({ what, points, why, fix })), 'Measured from this computer on this connection while several pages loaded together, so timings are a guide. They are not the same as what real visitors on phones see.', `${(summary.pages || []).length} pages`);
}

function privacy(summary) {
  const p = (summary.perspectives || {}).privacy; if (!p) return null;
  const L = (summary.perspectives || {}).legal || {};
  const trackers = (p.trackers || []).length, third = (p.thirdParties || []).length, cookies = (p.cookies || []).length, banner = p.pagesShowingConsentBanner || 0;
  const rows = [
    ['Trackers', Math.min(40, trackers * 8), `${trackers} tracking or advertising services load`, 'Remove the ones not needed; load the rest only after consent.'],
    ['Many other companies contacted', Math.min(15, Math.max(0, third - 5)), `${third} other hosts are contacted when pages load`, 'Host fonts, scripts and images yourself where you can.'],
    ['Tracking with no consent banner seen', trackers > 0 && banner === 0 ? 15 : 0, 'Trackers load but no consent banner was seen on any page', 'Ask before loading trackers, as the law requires in many places.'],
    ['Cookies set with no consent banner seen', cookies > 0 && banner === 0 ? Math.min(15, cookies * 2) : 0, `${cookies} cookies set, no consent banner seen`, 'Set only necessary cookies until the visitor agrees.'],
    ['No privacy policy found', L.privacyPolicy ? 0 : 15, 'No link to a privacy policy was found', 'Publish a privacy policy and link it from every page.'],
  ];
  return area('Privacy', rows.map(([what, points, why, fix]) => ({ what, points, why, fix })), 'Based on what loaded during this visit. Consent banners are recognised by their wording and can be missed; what the site does with data on its servers cannot be seen.', `${p.pagesChecked || (summary.pages || []).length} pages`);
}

function search(summary, pages) {
  const I = summary.issues; if (!I || !pages) return null;
  const c = (k) => (Array.isArray(I[k]) ? I[k].length : Number(I[k]) || 0); const share = (k) => clamp(c(k) / pages, 0, 1);
  const rows = [
    ['Pages without a title', share('missingTitle') * 20, 'missingTitle', 'Give every page its own title.'],
    ['Pages without a description', share('missingDescription') * 10, 'missingDescription', 'Write a one or two sentence meta description for each page.'],
    ['Pages without a main heading', share('missingH1') * 10, 'missingH1', 'Give every page one h1 that says what it is about.'],
    ['Pages with several main headings', share('multipleH1') * 5, 'multipleH1', 'Keep one h1 per page.'],
    ['Pages sharing a title', share('duplicateTitles') * 10, 'duplicateTitles', 'Make each title unique.'],
    ['Pages with the same content', share('duplicateContent') * 10, 'duplicateContent', 'Merge duplicates or point them at one canonical address.'],
    ['Broken links inside the site', Math.min(15, 15 * c('brokenInternalLinks') / pages), 'brokenInternalLinks', 'Fix or remove each broken link.'],
    ['Pages that return an error', share('errorPages') * 10, 'errorPages', 'Restore or redirect them.'],
    ['Pages with very little text', share('thinContent') * 10, 'thinContent', 'Expand, merge or remove thin pages.'],
  ];
  return area('Search and content', rows.map(([what, points, k, fix]) => ({ what, points, why: k === 'brokenInternalLinks' ? `${c(k)} broken links` : `${c(k)} of ${pages} pages`, fix })), 'On-page basics only. Rankings also depend on things no scrape can see: other sites linking in, search demand, and how the content compares with competitors.', `${pages} pages`);
}

/** All scores for one finished scrape. */
function scorecard(summary) {
  const pages = (summary.pages || []).filter((p) => !p.error && p.kind !== 'file' && String(p.contentType || 'text/html').includes('html')).length || (summary.pages || []).length;
  const areas = {};
  for (const [id, fn] of [['security', () => security(summary, pages)], ['accessibility', () => accessibility(summary)], ['speed', () => speed(summary)], ['privacy', () => privacy(summary)], ['search', () => search(summary, pages)]]) {
    try { const a = fn(); if (a) areas[id] = a; } catch { /* an area that cannot be scored is left out */ }
  }
  const list = Object.values(areas);
  const overall = list.length ? Math.round(list.reduce((a, b) => a + b.score, 0) / list.length) : null;
  return {
    method: METHOD, overall, grade: overall == null ? null : grade(overall), areas,
    howToRead: 'Each area starts at 100 and loses points for each problem found; the list under each score shows every deduction. Grades: A+ 95 and up, A 90, B 80, C 70, D 60, E 50, F below 50. The overall score is the plain average of the areas. Scores use the same method for every site, so two sites can be compared.',
  };
}

module.exports = { scorecard, grade, METHOD, pct };
