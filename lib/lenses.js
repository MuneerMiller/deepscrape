'use strict';
/*
 * The lens library: 1,860 ways of looking at a website, in 23 families (lib/lenses.json).
 *
 * For a finished scrape, every lens gets an entry saying how much the scrape can tell about it:
 *   measured  - read directly from the site
 *   evidence  - facts were gathered; the verdict needs a person (or an AI) to read them
 *   inside    - cannot be seen from a browser; the entry says what would be needed, with any outside hints
 *
 * A lens finds its facts in one of three ways, in this order:
 *   1. a hand-written mapping for that exact lens (lib/perspectives.js)
 *   2. topic rules below, matched on the words in the lens name
 *   3. the general facts for its family
 * `matchedBy` on each entry says which, so nobody mistakes a family-level entry for a tailored one.
 */
const FAMILIES = require('./lenses.json');
const { evaluator, curated, LEVEL } = require('./perspectives');

// topic rule:  words in the lens name => level => evidence keys => note
const RULES = `
accessibility law|accessibility statement|wcag|accessibility assessor|accessibility audit => E => a11yCounts, contrast, legalAccessibility
screen reader|blind user => E => ariaTree, landmarks, a11yCounts, lang => The saved accessibility tree is what a screen reader receives; listening to it needs a person.
skip link => M => a11ySkip
keyboard|tab order|focus => E => @focusRules, @focusOutlineRemoved, a11ySkip, @javascriptLinks => Tab order was not walked key by key.
contrast => M => contrast
colou?r[- ]blind|colour vision => E => colors, contrast
alt text|image description|text alternative => M => alt, a11yImages
caption|subtitle|transcript|audio description|deaf|hard-of-hearing => M => @videos, @videoEmbeds, @captionTracks, @transcriptMention
motion|vestibular|animation|parallax|scroll effect|flashing|transition => M => @reducedMotionStyles, @transitionsAndAnimations, @autoplayVideo, @carousels
zoom|text resiz|reflow|magnif|low vision => M => zoom, phoneScroll, sizes
touch target|target size|spacing between targets|one hand|tremor|motor => M => touchTargets
voice[- ]control|voice assistant|speech|smart speaker => E => a11yNames, @speakableOrVoice
reading level|plain language|literacy|readab|reading effort|jargon|technical terms|cognitive|memory difficult|dyslex|attention difficult => M => readingEase, @wordsPerSentence, @jargonOrAcronyms, @longParagraphs
aria\\b|semantic|landmark|accessible name|link text|accessibility tree => M => @ariaAttributes, @semanticElements, landmarks, a11yNames, ariaTree
error page|404|not found|error state|maintenance mode|expired link|500 => M => notFoundPage, errorPages, @errorWording
form error|error announc|validation|error prevention|error message|error recovery => E => @fieldsWithValidation, @requiredFields, @inlineErrorRegions, a11yFields => Forms were not submitted, so messages after sending were not seen.
\\bforms?\\b|field|autofill => M => formsDetail, @requiredFields, @fieldsWithAutocomplete, @fieldsWithValidation, a11yFields
right-to-left|\\brtl\\b|non-latin|bidi => M => @direction, @nonLatinText, charset
translat|locali[sz]|language|multilingual|hreflang|region switch|text expansion => M => lang, @hreflangs, @languageSwitcher, @translateWidget
dark mode|theme|theming|use in the dark => M => @darkModeStyles, @themeToggle, themeColors
print => M => @printStyles
javascript disabled|no javascript|without javascript|reader mode|progressive enhancement|graceful degradation => M => noJs, @hydrationMarkers, @semanticElements
ad[- ]?block|content block|tracker block => E => thirdParties, trackers => Blocking the listed hosts shows what would break.
\\btor\\b|vpn|incognito|private window|cookies blocked|shared .*(computer|device)|public (computer|device) => E => cookies, thirdParties, @captcha, @storageKeys.local, @rememberMe
slow|\\b[23]g\\b|offline|connection|data[- ]saver|low[- ]end|battery|bandwidth|data cost|metered|affordab|economic => M => weight, bytesByType, compression, caching, offline, dataCost
television|e-reader|game controller|console|in-car|kiosk|feature phone|opera mini|stylus|\\bvr\\b|wearable|watch|tv remote|foldable => I => breakpoints, noJs, weight, touchTargets => Not run on this device. The listed facts usually decide how it fares.
safari|firefox|\\bedge\\b|chrome|browser|webview|in-app => I => @deprecatedHtml, @libraries, jsErrors => Scraped in Chromium only; other browsers need to be run.
phone|mobile|tablet|small screen|narrow|responsive|orientation|split-screen|laptop|desktop|large monitor|screen size => M => mobileShot, phoneScroll, breakpoints, touchTargets, viewportMeta
typograph|typeface|\\bfonts?\\b|line height|line length|letter|type scale => M => fonts, sizes, typography, fontFiles, @fontDisplay
colou?r|palette => M => colors, cssVars, themeColors
spacing|white space|density|layout|\\bgrid\\b|alignment|rhythm|proportion|balance => M => layout, @textDensityWordsPerScreen, breakpoints, typography
\\bicons?\\b|iconograph => M => @iconSystems, @inlineSvgs, @appIcons
logo|favicon|brand => E => logos, colors, fonts, themeColors, @appIcons
image|photo|illustration|imagery|picture|\\bsvg\\b => M => imagesTotal, @imageFormats, @photoLikeImages, @illustrationLikeImages, alt, @responsiveImages
video|audio|sound|podcast|music => M => @videos, @audios, @videoEmbeds, @audioAutoplay, @captionTracks
hover|active state|button|\\bcards?\\b|component|border|shadow|corner|background|selected|current-page => M => @hoverRules, typography, radii, shadows, designConsistency
consisten|design system|pattern library|reuse|polish|craft => M => designConsistency, cssVars, @importantOverrides, @inlineStyles
hierarchy|heading|subheading|scannab => M => h1, @headingsCount, sizes, @listsCount
search[- ]engine|\\bseo\\b|crawlab|indexing|serp|rich result|snippet|search intent|keyword|google|bing => M => robots, sitemap, noindex, canonical, structuredTypes, missingTitle, missingDesc, topWords
navigation|menu|wayfinding|breadcrumb|information architecture|findab|sitemap|where am i => M => @navLinks, @footerLinks, @breadcrumbs, siteTree, depthDist, sitemap
\\bsearch\\b|autocomplete|suggestion => E => @siteSearch, @integrations => Search boxes are found but not typed into.
filter|sorting|facet|pagination => E => @filterControls, @sortControls
\\btitles?\\b|meta description|metadata|open graph|social preview|link preview|shareab => M => missingTitle, missingDesc, dupTitles, @socialPreview.title, @socialPreview.image
structured data|schema\\.org|linked data|semantic web => M => structuredTypes
robots|crawler|scraper|llms|ai agent|web-filter|machine => M => robots, llms, @captcha, humanChecks, noJs, allContent
canonical|duplicat => M => canonical, dupContent, dupTitles
\\blinks?\\b|link rot|backlink => M => brokenLinks, internalLinks, externalLinks, redirects
\\bfeeds?\\b|\\brss\\b|syndicat => M => feeds, @podcastOrFeed
archiv|wayback|snapshot|earliest version|redesign history|origin story|legacy|aged|historian => M => history, domainAge, @copyrightYear, @deprecatedHtml
domain|\\bdns\\b|registrar => M => dns, domainAge
certificate|\\btls\\b|\\bssl\\b|https|encryption in transit|hsts => M => cert, secFind:HTTPS/HSTS/certificate/encryption/Insecure
security header|content security|\\bcsp\\b|clickjack|framing|\\bcors\\b|cross-origin => M => secFind:header/Content Security/HSTS/framed/nosniff/Referrer/Permissions/Any website
cookie|consent|refusing versus accepting => M => cookies, consent, @cookieChoices, cookiesBeforeConsent, legalCookie
session|\\btokens?\\b|\\bjwt\\b => M => cookies, secFind:cookie
injection|\\bxss\\b|cross-site scripting|\\bcsrf\\b|request forgery|\\bssrf\\b|deserial|access control|privilege|business-logic|penetration|exploit|vulnerab|brute|enumeration|upload|default credential|hashing|fixation|hijack => I => secSummary, secFind:Content Security/inline/forgery/SameSite/nosniff/jQuery, uploads => Needs authorised active testing, which this tool does not do. Passive signs are listed.
verification|verify|confirm(ation)? (email|step)|activation => E => formsDetail, @emailServices => Messages sent after a form is submitted are not seen.
password|credential|log-?in|sign-?in|authenticat|account recovery|forgotten|\\bmfa\\b|two-factor|multi-factor|single sign|\\bsso\\b|oauth => E => @signInForm, @passwordReset, @passwordRulesShown, @multiFactorMention, @singleSignOn, secFind:password/sign-in => Sign-in pages are examined; credentials are never tested.
sign-?up|registration|onboarding|first run => E => @registerLink, @onboardingWording, formsDetail, @singleSignOn => Steps after sign-up need an account.
supply[- ]chain|subresource|third-party script|dependenc|librar|package|end of life|outdated => M => thirdParties, @libraries, secFind:integrity/jQuery, tech
secret|api key|leak|exposed|source map|debug|code comment => M => @possibleSecretsInCode, sourceMaps, @debugLeftovers, commentsCount, hiddenFields
phishing|spoof|look-alike|impersonat|\\bspf\\b|dmarc|deliverab|email sending => M => mail, secFind:SPF/DMARC, cert, domainAge
\\bbots?\\b|captcha|spam|fake account|scraping|rate limit|denial|ddos => E => @captcha, @honeypotFields, robots, rateLimit, cdn
security\\.txt|disclosure|bug bounty|breach => E => wellknownSecurity, @breachWording
attacker|threat|attack surface|osint|reconnaissance|intelligence|investigator|worth stealing => E => secSummary, @otherEnvironmentsMentioned, hiddenFields, robots, emails, server, sourceMaps => What an outsider can learn without touching anything.
security|defen[cs]|harden => M => secSummary, secTop
a/b test|experiment|feature flag|staged rollout => M => @experimentsAndFlags
track|pixel|fingerprint|session record|heatmap|analytics|tag manager|telemetry|attribution|traffic|page views|scroll depth => E => trackers, @sessionRecording, @fingerprintingHints, thirdParties => The tools are detected; the numbers they collect are in the owner's accounts.
personal data|data .*collected|data minimi|profil|location tracking => M => formsDetail, cookies, trackers, @storageKeys.local
third part|shared with|data broker|processor => M => thirdParties, trackers, @formsSendingToOtherSites, @integrations
retention|deletion|erasure|forgotten|data subject|access request|data export => E => cookieLifetimes, @retentionWording, @dataRequestsWording, @accountDeletionOrExport
cross-border|residency|where data is stored|jurisdiction => E => ip, dataLocation, @dataLocationWording
privacy => E => legalPrivacy, trackers, cookies, consent, @informationOfficer
child|minor|teen|\\bage\\b|parent|guardian|school|student|pupil => E => @ageGate, @childDirected, readingEase, trackers, @safeguardingWording
moderat|reporting tool|harass|troll|community guideline|illegal content|threats|vandal => E => @reportAbuse, @safeguardingWording, @userGeneratedContent, @communityFeatures
community|forum|comment|user-generated|review|rating|social proof|testimonial => E => @userGeneratedContent, @commentCount, @communityFeatures, @testimonials, @ratings
dark pattern|manipulat|nudge|persua|urgency|scarcity|confirmsham|deceptive|gambling-like|addict|attention|wellbeing|respect for the user => E => @scarcityWording, @countdownTimer, @confirmShaming, @preTickedBoxes, @autoplayVideo, @endlessFeed, @notificationsPrompt => Each hit needs a look: wording alone does not prove manipulation.
trust|credib|reassur|legitim|authentic|sceptic|anxiety => E => cert, legal, phones, @addressShown, @testimonials, @awardsOrAccreditation, history, secSummary
checkout|basket|\\bcart\\b|payment|purchase|\\bbuy\\b|\\border|shop|e-?commerce|catalogue|product page|delivery|shipping|fulfil => E => @cartOrCheckout, @paymentProviders, @pricesShown, @refundPolicyWording => Nothing is bought, so steps after "pay" are not seen.
pric(e|ing)|\\bplans?\\b|\\bfees?\\b|subscription|billing|invoice|\\btax\\b|\\bvat\\b|refund|discount|coupon|upgrade|downgrade|bundl => E => @priceExamples, @pricingPage, @vatMention, @subscriptionWording, @freeTrialOrDiscount, @refundPolicyWording
call to action|\\bcta\\b|conversion|funnel|\\bleads?\\b|landing => E => @callsToAction, valueProp, formsDetail, @campaignParametersInLinks => Rates need the owner's analytics.
value proposition|purpose|core message|positioning|differentiat|tagline|headline|business goal => E => valueProp, @taglineOrSubheading, @callsToAction
newsletter|email capture|notification|\\bpush\\b|\\bsms\\b|subscrib|following => E => @newsletterSignup, @notificationsPrompt, @emailServices
help|\\bfaqs?\\b|support|self-service|contact|live chat|chatbot|complain => M => @faq, @helpCentre, @chatWidgets, phones, emails
empty state|loading|skeleton|spinner|progress|success state => E => @emptyStateWording, @loadingIndicators, @inlineErrorRegions => Seen only where a scraped page happened to be in that state.
modal|pop-?up|dialog|overlay|interstitial|carousel|tooltip|drag => M => @modalsAndDialogs, @popupsOnLoad, @carousels, @tooltips, @draggable
tone|voice|\\bcopy|wording|microcopy|labels?\\b|writing|spelling|grammar|terminology|naming|rhetoric|narrative|story|humour|idiom => E => @firstPersonWords, @secondPersonWords, @exclamations, readingEase, topWords, @callsToAction, allContent => All text is saved; this is a reading of it.
fresh|up to date|stale|last (meaningful )?update|outdated content|accuracy|old content|old dates => E => @modifiedDate, @publishedDate, @latestYearMentioned, @copyrightYear, lastModified
document|\\bpdfs?\\b|download => M => docs, docsNoText, docsMeta
blog|\\bnews\\b|article|author|byline|editorial|journalis => E => @author, @publishedDate, @tagsAndCategories, feeds
taxonomy|tagging|categor => M => @tagsAndCategories, siteTree
\\bcontent\\b|thin|filler|completeness => E => words, thin, dupContent, topWords, docs
\\bhtml\\b|markup|\\bdom\\b|web component|deprecated|doctype|standards => M => @semanticElements, @deprecatedHtml, @duplicateIds, @doctype, domSize, @webComponents
\\bcss\\b|stylesheet => M => cssRules, cssVars, @cssFrameworks, @importantOverrides, @inlineStyles
javascript|framework|typescript|hydrat|rendering|client[- ]side|bundle|code split|build tool => M => tech, @libraries, @hydrationMarkers, noJs, @buildTooling, bytesByType
routing|\\burls?\\b|deep link|permalink|redirect|status code|citab => M => @routingStyle, @urlDepth, @urlQueryParameters, redirects, statusDist, canonical
storage|state management|cach(e|ing) => M => cookies, @storageKeys.local, @storageKeys.session, caching, @stateContainers
service worker|\\bpwa\\b|progressive web|installab|manifest|background sync => M => offline, manifest, @appIcons
\\bapis?\\b|graphql|\\brest\\b|webhook|endpoint|integration|websocket|real-time|polling|data fetching => E => apiCount, @apiStyleHints, apiSamples, @integrations, websockets => Only the calls the pages made were seen; they are saved.
time to first byte|ttfb|server response => M => ttfb
web vitals|contentful paint|layout shift|time to interactive|load time|page load|perceived|speed|performance => M => vitals, slowest, weight
weight|compress|minif|image optimi|lazy|render-blocking|critical|main-thread|long task|\\bcpu\\b|input lag => M => weight, bytesByType, compression, @oversizedImages, @lazyLoadedImages, @renderBlockingScripts, longTasks
carbon|sustainab|energy|e-waste => M => carbon, weight
\\bcdn\\b|\\bedge\\b|hosting|servers?\\b|cloud|load balanc|http version|protocol|network => E => cdn, ip, server, protocols, dnsNames, dataLocation
uptime|reliab|resilien|failure|outage|incident|recover|backup|disaster|scalab|capacity|queue|stability => I => errorPages, @statusPage, cdn, caching, thirdParties => Needs monitoring over time or the owner's records; one visit shows only today's state.
environment|staging|configuration|deploy|pipeline|continuous|release|rollback|container|orchestrat|infrastructure as code|monitor|observab|logging|\\blogs?\\b|alert|on-call|runbook|firewall => I => @otherEnvironmentsMentioned, @buildTooling, @monitoringTools, @statusPage => Internal operations. Outside hints are listed.
\\btests?\\b|\\blint|code review|pull request|version control|repository|technical debt|refactor|maintainab|type safety|readability|formatting|design patterns|workaround|rewrite => I => sourceMaps, @debugLeftovers, @libraries, @deprecatedHtml => Needs the repository.
database|schema|migration|background job|transaction|data model|replica|shard|normalis|seed|warehouse => I => apiSamples, structuredTypes => Needs server and database access.
licen[cs]e|copyright|trademark|attribution|open[- ]source => E => legalCopyright, @licenceMentions, @trademarkMarks, fontFiles
terms|polic(y|ies)|legal|\\blaws?\\b|regulat|complian|popia|gdpr|ccpa|liabil|disclaimer|contract|\\bsla\\b|defamation|ombud => E => legal, legalTerms, legalPrivacy, @lawsMentioned, @sectorRegulators, @informationOfficer, @disclaimerWording => Facts for a legal review; not legal advice.
advert|sponsor|affiliate|monetis|revenue|donation => E => @sponsoredOrAdMarkers, trackers, @paymentProviders, @subscriptionWording
competitor|compar|market|substitut|benchmark => E => tech, @priceExamples, @comparisonWording, topWords => Scrape the competitors as a batch and compare the reports.
\\blocal\\b|\\bmaps?\\b|opening hours|address|phone number => M => @localBusinessData, @addressShown, @mapEmbed, @openingHours, phones
social|twitter|facebook|instagram|linkedin|whatsapp => M => socials, @socialPreview.title, @socialPreview.image
personalis|recommend|algorithm|\\bai\\b|machine learning => E => @personalisation, @upsellWording, @chatWidgets
gamif|reward|streak|badge|motivation => E => @gamification
roadmap|changelog|future|longevity|sunset|succession|preserv|ten years => E => @roadmapOrChangelog, history, domainAge, @libraries, cert
neglect|abandon|zombie|parked|decay|momentum|lifecycle => M => brokenLinks, @copyrightYear, @latestYearMentioned, cert, @libraries, history
inclusiv|gender|cultur|identity|name format|address .*format|represent|\\bbias|stereotyp|\\bclass\\b|income|family structure|queer|feminist => E => @inclusiveFormOptions, lang, @priceExamples, screenshots, formsDetail => Form options and wording are captured; the reading is yours.
\\bcosts?\\b|budget|profit|\\broi\\b|return on|churn|lifetime value|acquisition|\\bkpi|metric|\\brates?\\b|volume|retention => I => trackers, @callsToAction => Figures are in the owner's accounts.
team|staff|stakeholder|process|hiring|skills|vendor|agency|procure|decision|governance|ownership|who (pays|commissioned|owns)|founder|executive|board|manager => I => tech, generator, @author, legalNumbers => About the people and process behind the site; ask them.
`.trim().split('\n').map((l) => { const [re, lv, keys, note = ''] = l.split(' => '); return { re: new RegExp(re, 'i'), lv, keys: keys.split(',').map((x) => x.trim()).filter(Boolean), note }; });

// what a lens falls back to when nothing more specific matches:  family id => level, keys, note
const FAMILY_DEFAULT = {
  1: ['E', 'valueProp, @callsToAction, readingEase, a11yCounts, trackers, vitals', "Read the facts as this person would. Their view is a judgement, not a measurement."],
  2: ['E', 'mobileShot, phoneScroll, touchTargets, weight, noJs, @darkModeStyles, @printStyles', 'Scraped in desktop Chromium plus a phone-width pass. Other situations were not reproduced; these facts usually decide how the site fares in them.'],
  3: ['E', 'a11yCounts, vitals, @callsToAction, @navLinks, brokenLinks, readingEase', 'Real usability needs people. These are the measurable obstacles.'],
  4: ['E', 'formsDetail, notFoundPage, @signInForm, @registerLink, @cartOrCheckout, interactions', 'Moments that need an account, a purchase or submitted data were not exercised.'],
  5: ['E', 'a11yCounts, contrast, ariaTree, touchTargets, readingEase', 'Automated checks find roughly a third of accessibility problems.'],
  6: ['E', 'colors, fonts, sizes, designConsistency, screenshots', 'The measurable parts of the look are listed; the eye does the rest. Screenshots are saved for every page.'],
  7: ['E', 'words, topWords, readingEase, allContent', 'All text is saved; this lens is a reading of it.'],
  8: ['E', 'tech, @libraries, domSize, bytesByType, noJs', ''],
  9: ['I', 'server, tech, apiCount, apiSamples', 'Server-side: not visible from a browser. Needs the code, database or server access.'],
  10: ['I', 'ip, cdn, server, dns, protocols', 'Mostly internal. What the outside reveals about hosting is listed.'],
  11: ['I', 'sourceMaps, @libraries, @debugLeftovers', 'Needs the repository.'],
  12: ['E', 'vitals, weight, bytesByType, ttfb', 'Measured once, on this computer and connection.'],
  13: ['E', 'secSummary, secTop', 'Passive review only. Active testing needs authorisation and was not done.'],
  14: ['E', 'trackers, cookies, consent, legalPrivacy, formsDetail', 'What happens to data after it reaches the server is internal.'],
  15: ['E', 'robots, sitemap, structuredTypes, noJs, allContent', ''],
  16: ['I', 'valueProp, @callsToAction, @priceExamples, @paymentProviders, trackers', "Figures (costs, rates, revenue) are in the owner's accounts. What the site shows of its business is listed."],
  17: ['I', 'trackers, @sessionRecording, @experimentsAndFlags, @feedbackOrSurvey', 'The measuring tools are detected; the numbers and the research live with the owner.'],
  18: ['E', 'legal, @lawsMentioned, consent, legalNumbers', 'Facts for a legal review; not legal advice. Which laws apply depends on where the site and its users are.'],
  19: ['I', 'tech, generator, @author, legalNumbers', 'About the people and process behind the site. Not visible from outside; ask them.'],
  20: ['E', 'tech, structuredTypes, siteTree, @cartOrCheckout, @signInForm, formsDetail', 'Applies only if the site is of this type.'],
  21: ['E', 'allContent, topWords, screenshots, readingEase, designConsistency', 'An interpretive reading. Everything needed to make it is saved: the full text, screenshots and structure.'],
  22: ['E', 'lang, trackers, @priceExamples, thirdParties, allContent', "Looks past the screen. The site's own evidence is listed; its effect in the world needs research."],
  23: ['E', 'history, domainAge, @modifiedDate, @copyrightYear, cert, @libraries', 'One scrape is one moment. Scrape again later and compare to see change.'],
};

// Which collectors each family needs. Choosing families switches off the expensive ones nothing asked for.
const NEEDS = {
  screenshots: [1, 2, 3, 4, 5, 6, 7, 20, 21, 22, 23], mobileScreenshots: [2, 5, 6, 12], assets: [6, 7, 8, 12, 20, 21],
  files: [7, 14, 16, 18, 20, 23], docText: [7, 14, 16, 18, 20, 23], interact: [3, 4, 7, 20],
};
function collectorsFor(familyIds) {
  if (!familyIds || !familyIds.length) return null;
  const on = {}; for (const [k, fams] of Object.entries(NEEDS)) on[k] = fams.some((f) => familyIds.includes(f));
  return on;
}

const NAMES = { measured: 'Measured', evidence: 'Evidence gathered', inside: 'Needs inside access' };
const hand = curated();
function planFor(name, familyId) {
  const c = hand.get(name.toLowerCase());
  if (c) return { lv: c.lv, keys: c.keys, note: c.note, matchedBy: 'this lens' };
  const hits = RULES.filter((r) => r.re.test(name)).slice(0, 2);
  if (hits.length) return { lv: hits[0].lv, keys: [...new Set(hits.flatMap((h) => h.keys))], note: hits.find((h) => h.note) ? hits.find((h) => h.note).note : '', matchedBy: 'its topic' };
  const d = FAMILY_DEFAULT[familyId];
  return { lv: d[0], keys: d[1].split(',').map((x) => x.trim()), note: d[2], matchedBy: 'its family' };
}

const families = () => FAMILIES.map((f) => ({ id: f.id, name: f.name, about: f.about, lenses: f.lenses.length }));
const totalLenses = FAMILIES.reduce((n, f) => n + f.lenses.length, 0);

/** Every lens in the chosen families (all when none given), with its facts for this scrape. */
function evaluate(summary, familyIds) {
  const ev = evaluator(summary); const want = familyIds && familyIds.length ? familyIds : FAMILIES.map((f) => f.id);
  const out = [];
  for (const f of FAMILIES) {
    if (!want.includes(f.id)) continue;
    const counts = { measured: 0, evidence: 0, inside: 0 };
    const lenses = f.lenses.map((name, i) => {
      const p = planFor(name, f.id); const coverage = LEVEL[p.lv] || 'evidence'; counts[coverage]++;
      return { n: i + 1, name, coverage, matchedBy: p.matchedBy, note: p.note, evidence: ev(p.keys, p.lv) };
    });
    out.push({ id: f.id, name: f.name, about: f.about, counts, lenses });
  }
  return out;
}

module.exports = { families, totalLenses, evaluate, collectorsFor, NAMES, FAMILY_DEFAULT };
