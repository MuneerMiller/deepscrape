'use strict';
/*
 * The 325 ways of looking at a website, and what a scrape can say about each.
 *
 * Every perspective gets an entry in the output. Each is one of:
 *   measured  - read directly from the site
 *   evidence  - facts were gathered, but the verdict needs a person (or an AI) to read them
 *   inside    - cannot be seen from a browser at all; needs the owner's code, data, accounts or people.
 *               Any outside hints that were found are still listed.
 *
 * Line format:  Name | M/E/I | evidence keys | what would be needed (for I) or how to read it (for E)
 * Evidence keys: a word = a named fact below; @key = a page signal summed across the site.
 */
const CATALOGUE = `
# People and users
First-time visitor | E | valueProp, @taglineOrSubheading, @callsToAction, @onboardingWording, @navLinks, vitals, consent | Judge whether a newcomer can tell what the site is and what to do next from the start page evidence.
Returning user | E | @signInForm, @rememberMe, @personalisation, cookies, @storageKeys.local | Whether returning is rewarded shows only partly from outside; sign in and scrape again to see the signed-in side.
Expert or power user | E | @siteSearch, @filterControls, @sortControls, @urlQueryParameters, apiCount, @helpCentre | Shortcuts and bulk tools usually sit behind a sign-in.
Novice | E | readingEase, @faq, @helpCentre, @onboardingWording, @jargonOrAcronyms, @tooltips | Compare the reading level and jargon list with the intended audience.
Child | E | @childDirected, @ageGate, readingEase, trackers, @safeguardingWording | Check trackers and reading level against a young audience.
Older person | E | sizes, contrast, zoom, touchTargets, readingEase | Small type, low contrast and small targets are the usual barriers.
Stressed user or user in a crisis | E | phones, @chatWidgets, @helpCentre, vitals, @popupsOnLoad, @navLinks | Is urgent contact reachable in one step from any page?
Distracted or hurried user | E | vitals, @callsToAction, @popupsOnLoad, @stickyElements, @readingTimeMinutes | Fast load, one clear action and few interruptions.
Privacy-conscious user | M | trackers, thirdParties, cookies, consent, @cookieChoices, @fingerprintingHints, @sessionRecording
User with an ad blocker | E | thirdParties, trackers, @sponsoredOrAdMarkers | Blocking the listed hosts shows what would break; content loaded from tracker hosts is at risk.
User with JavaScript disabled | M | noJs, @hydrationMarkers
User relying on a translation tool | M | lang, @translateWidget, @hreflangs, ocr, @nonLatinText | Text inside images is not translated; see images with text.
User in reader mode | M | noJs, @semanticElements, @paragraphs, @headingsCount
User on a shared or public device | E | @rememberMe, cookies, @storageKeys.local, @signInForm, secFind:cookie | Long-lived sign-in cookies and stored data matter here.
One-handed mobile user | E | touchTargets, @stickyElements, mobileShot, phoneScroll | Look at the phone screenshots for reach and target size.
Touch versus mouse versus keyboard user | E | touchTargets, @hoverRules, @focusRules, @focusOutlineRemoved, a11yCounts | Hover-only content and removed focus outlines exclude touch and keyboard users.
User switching between devices mid-task | I | @signInForm, @storageKeys.local | Needs a signed-in test on two devices; state kept only in browser storage does not follow the user.
Administrator | I | needSignIn, @otherEnvironmentsMentioned, robots | The admin side is behind a sign-in. Sign in as an admin and scrape to capture it.
Content editor | I | generator, tech, @author, @modifiedDate | The editing tools are not public; the content system detected is listed.
Support agent | I | @chatWidgets, @helpCentre, @faq, phones, emails | Support tooling and ticket volumes are internal.
Developer joining the project | E | tech, @libraries, @buildTooling, sourceMaps, @debugLeftovers, @cssFrameworks | The stack is visible; the repository, docs and set-up are not.
Tester (QA) | E | brokenLinks, errorPages, jsErrors, @duplicateIds, @otherEnvironmentsMentioned | Defects found from outside are listed; test suites are internal.
Investor or buyer | E | tech, history, @investorOrPress, trackers, secSummary, pages | Outside due-diligence facts; financials are internal.
Auditor | M | secSummary, legal, cookies, a11yCounts, @lawsMentioned, @informationOfficer
Journalist or researcher | M | history, legal, trackers, emails, dns, @licenceMentions, @author
Competitor | M | tech, @priceExamples, @callsToAction, topWords, @paymentProviders, trackers, structuredTypes
Regulator | E | legal, @lawsMentioned, @sectorRegulators, consent, @cookieChoices, @informationOfficer, a11yCounts | Facts against the rules are gathered; compliance is a legal judgement.
Advertiser or partner | E | trackers, @sponsoredOrAdMarkers, @partnerLogos, @campaignParametersInLinks, socials | Audience size is internal.

# Experience and usability
Usability | E | a11yCounts, brokenLinks, jsErrors, @formsCount, vitals, touchTargets | Real usability needs people; these are the measurable obstacles.
User journey | E | depthDist, @callsToAction, @registerLink, @cartOrCheckout, siteTree | The click-depth map and calls to action outline the journeys on offer.
Information architecture | M | siteTree, depthDist, @navLinks, @breadcrumbs, @tagsAndCategories, pages
Navigation and wayfinding | M | @navLinks, @footerLinks, @breadcrumbs, @siteSearch, depthDist, brokenLinks
Interaction design | E | @modalsAndDialogs, @carousels, @tooltips, @draggable, interactions, @transitionsAndAnimations | What each control revealed when clicked is saved per page.
Affordance (does it look clickable?) | E | @hoverRules, typography, touchTargets, @javascriptLinks | Compare link and button styling in the design review with the screenshots.
Feedback (does the site confirm what I did?) | E | @inlineErrorRegions, @loadingIndicators, @modalsAndDialogs | Forms were not submitted, so confirmations after sending were not observed.
Cognitive load | E | @textDensityWordsPerScreen, @navLinks, @callsToAction, @popupsOnLoad, readingEase, @formFields | Many choices, dense text and long forms raise the load.
Learnability | E | @onboardingWording, @helpCentre, @tooltips, @faq | Needs observation of new users.
Memorability | I | @navLinks, designConsistency | Needs returning-user testing; consistency across pages is the outside proxy.
Error prevention and recovery | E | @fieldsWithValidation, @requiredFields, @inlineErrorRegions, notFoundPage, @errorWording | The not-found page was captured; form errors were not triggered.
Efficiency for repeated tasks | E | @fieldsWithAutocomplete, @rememberMe, @siteSearch, @urlQueryParameters | Mostly a signed-in question.
Emotional response | E | colors, @exclamations, @heroImage, @emoji, screenshots | Read the screenshots and tone evidence; feelings need people.
Trust and credibility | E | cert, legal, phones, @addressShown, @testimonials, @awardsOrAccreditation, history, secSummary, @copyrightYear | The usual trust markers, present or missing.
Persuasion and nudges | E | @callsToAction, @freeTrialOrDiscount, @testimonials, @scarcityWording, @countdownTimer
Dark patterns | E | @scarcityWording, @countdownTimer, @confirmShaming, @preTickedBoxes, @cookieChoices, @accountDeletionOrExport | Each hit needs a look: wording alone does not prove manipulation.
Gamification | E | @gamification | Wording hits only.
Personalisation | E | @personalisation, cookies, @storageKeys.local, trackers | Compare a signed-in scrape with a signed-out one.
Onboarding | E | @onboardingWording, @registerLink, @formFields, @singleSignOn | The sign-up form fields are captured; the steps after sign-up need an account.
Offboarding (cancel, delete, export) | E | @accountDeletionOrExport, @unsubscribeMention, @dataRequestsWording | Usually inside the account area.
Empty states | E | @emptyStateWording | Seen only if a scraped page happened to be empty.
Loading states | E | @loadingIndicators, vitals
Error states | M | notFoundPage, errorPages, @errorWording, jsErrors
Edge cases (long names, huge lists, zero results) | I | @emptyStateWording, phoneScroll | Needs test data to be entered; overflow on phone width is the outside hint.
Site search | E | @siteSearch | Search boxes are found but not typed into; scrape result addresses directly to capture results.
Filtering and sorting | E | @filterControls, @sortControls | Controls are counted; combinations are not exhausted.
Forms | M | @formsCount, @formFields, @requiredFields, @fieldsWithValidation, @fieldsWithAutocomplete, a11yFields, formsDetail
Checkout and payment flow | E | @cartOrCheckout, @paymentProviders, @vatMention, @refundPolicyWording | Nothing is bought, so the steps after "pay" are not seen.
Notifications (email, push, SMS) | E | @notificationsPrompt, @newsletterSignup, @emailServices, @integrations | What is sent afterwards is internal.
Help, FAQs and self-service | M | @faq, @helpCentre, @chatWidgets, docs
Digital wellbeing and attention | E | @autoplayVideo, @endlessFeed, @notificationsPrompt, @popupsOnLoad, @screenTimeWording

# Accessibility and inclusion
Screen reader experience | E | ariaTree, landmarks, a11yCounts, lang | The saved accessibility tree is what a screen reader receives; listening to it needs a person.
Keyboard navigation | E | @focusRules, @focusOutlineRemoved, a11ySkip, @javascriptLinks, @draggable | Tab order was not walked key by key.
Focus management and visible focus | E | @focusOutlineRemoved, @focusRules, @modalsAndDialogs
Colour contrast | M | contrast
Colour-blind safety | E | colors, contrast | The palette is extracted; whether colour alone carries meaning needs a look.
Alt text | M | alt, a11yImages
ARIA and semantic roles | M | @ariaAttributes, @semanticElements, landmarks, ariaTree
Captions and transcripts | M | @videos, @videoEmbeds, @captionTracks, @transcriptMention
Motion sensitivity | M | @reducedMotionStyles, @transitionsAndAnimations, @autoplayVideo, @carousels
Zoom and text reflow | M | zoom, phoneScroll, mobileShot
Touch target size | M | touchTargets
Voice control | E | a11yNames, @ariaAttributes | Controls without names cannot be spoken to.
Plain language and reading level | M | readingEase, @wordsPerSentence, @jargonOrAcronyms, @longParagraphs
Inclusivity (culture, gender, age, literacy) | E | @inclusiveFormOptions, readingEase, lang, screenshots | Form options are captured; imagery and wording need a human read.
Localisation and translation | M | lang, @hreflangs, @languageSwitcher, @translateWidget, @priceExamples
Right-to-left and non-Latin scripts | M | @direction, @nonLatinText, charset
Low-end devices | M | weight, bytesByType, vitals, @webFonts, domSize
Slow, expensive or offline connectivity | M | weight, compression, caching, offline, @lazyLoadedImages
Economic access (cost of data, device, subscription) | E | weight, dataCost, @priceExamples, @subscriptionWording

# Visual design
Visual hierarchy | E | typography, sizes, h1, screenshots | Type scale and headings are measured; whether the eye lands right needs a look.
Layout and grid | M | layout, breakpoints, phoneScroll
Spacing and white space | E | @textDensityWordsPerScreen, typography, screenshots
Typography | M | fonts, sizes, typography, fontFiles, @fontDisplay
Colour palette and meaning | M | colors, cssVars, themeColors
Imagery and photography style | E | @photoLikeImages, @heroImage, imagesTotal, ocr | All images are saved for review.
Illustration style | E | @illustrationLikeImages, @inlineSvgs
Iconography | M | @iconSystems, @inlineSvgs, @appIcons
Motion and animation | M | @transitionsAndAnimations, @carousels, @reducedMotionStyles, @libraries
Hover, active and focus states | M | @hoverRules, @focusRules, @focusOutlineRemoved
Density (compact versus airy) | M | @textDensityWordsPerScreen, domSize, typography
Brand expression | E | logos, colors, fonts, @taglineOrSubheading, themeColors
Logo, favicon and app icons | M | logos, @appIcons, manifest
Design-system consistency | M | designConsistency, cssVars, radii, shadows, @importantOverrides, @inlineStyles
Responsive behaviour | M | breakpoints, mobileShot, phoneScroll, @responsiveImages, viewportMeta
Dark mode and theming | M | @darkModeStyles, @themeToggle, themeColors, cssVars
Print stylesheet | M | @printStyles
Sound and audio | M | @audios, @audioAutoplay, @autoplayVideo
Aesthetic or art-critical (the site as an object of its era) | E | history, tech, screenshots, fonts, colors | Dates, stack and look are gathered; the criticism is yours.

# Content
Copy and tone of voice | E | @firstPersonWords, @secondPersonWords, @exclamations, @questions, readingEase, topWords | All text is saved; tone is a reading.
Microcopy | M | @callsToAction, hiddenText, @emptyStateWording, @errorWording, formsDetail
Content accuracy and freshness | E | @modifiedDate, @publishedDate, @latestYearMentioned, @copyrightYear, lastModified, history | Dates are gathered; accuracy needs a subject expert.
Content depth and usefulness | E | words, thin, docs, @readingTimeMinutes
Editorial structure and scannability | M | @headingsCount, @listsCount, @longParagraphs, @boldOrHighlighted, h1
Content strategy | E | topWords, siteTree, @tagsAndCategories, @podcastOrFeed, pages | The shape of what is published; the plan behind it is internal.
Taxonomy and tagging | M | @tagsAndCategories, @breadcrumbs, siteTree, @keywordsMeta
Metadata | M | missingTitle, missingDesc, structuredTypes, @socialPreview.title, @author
Content lifecycle (create, review, retire) | I | @modifiedDate, @publishedDate, history, redirects | Workflow is internal; dates and redirects are the outside trace.
Duplication and redundancy | M | dupContent, dupTitles, canonical
Link health and link rot | M | brokenLinks, errorPages, redirects, externalLinks
Downloads and documents (PDFs) | M | docs, docsNoText
Video and audio content | M | @videos, @audios, @videoEmbeds, @captionTracks
User-generated content | E | @userGeneratedContent, @commentCount, @reportAbuse
Storytelling and narrative | E | valueProp, @taglineOrSubheading, topWords | Read all-content.md.
Rhetoric (how it argues, who it addresses) | E | @secondPersonWords, @firstPersonWords, @questions, @testimonials, @comparisonWording
Semiotics (what its signs and metaphors mean) | E | @iconSystems, colors, logos, screenshots | Needs interpretation.
Linguistics (word choice, dialect, jargon) | M | topWords, @jargonOrAcronyms, lang, @wordsPerSentence

# Front end
HTML and semantics | M | @semanticElements, @deprecatedHtml, @tablesForLayout, @duplicateIds, @doctype, h1
CSS architecture | M | cssRules, cssVars, @cssFrameworks, @importantOverrides, @inlineStyles, @stylesheets
JavaScript and frameworks | M | tech, @libraries, jsErrors, @renderBlockingScripts
Bundle size and code splitting | M | bytesByType, scriptCount, @buildTooling, @asyncOrDeferredScripts
DOM and rendering | M | domSize, vitals, @webComponents
Rendering strategy (server, client, static, hybrid) | M | noJs, @hydrationMarkers, generator
Hydration | M | @hydrationMarkers, @stateContainers, noJs
Routing and URL design | M | @routingStyle, @urlHasFileExtension, @urlDepth, @urlQueryParameters, redirects, canonical
State management | E | @stateContainers, @storageKeys.local, @storageKeys.session | Embedded state is saved; the library behind it is often not nameable from outside.
Client storage (cookies, local storage, sessions) | M | cookies, @storageKeys.local, @storageKeys.session
Browser compatibility | I | @deprecatedHtml, @libraries, jsErrors | Scraped in Chromium only; other browsers need to be run.
In-app browsers and webviews | I | viewportMeta, @appIcons | Needs testing inside the apps.
Progressive web app features | M | manifest, offline, @appIcons, themeColors
Service workers and offline behaviour | M | offline
Standards compliance (valid HTML, WCAG levels) | E | @duplicateIds, @deprecatedHtml, @doctype, a11yCounts, contrast | Automated checks cover part of WCAG; full conformance needs a manual audit.
Third-party scripts and embeds | M | thirdParties, secFind:integrity, @integrations, @videoEmbeds

# Back end and data
Server logic and language | E | server, tech, @urlHasFileExtension, cookieNames, generator | Inferred from headers, cookie names and file extensions.
API design | E | apiCount, @apiStyleHints, apiSamples | Only the calls the pages made were seen; they are saved.
API versioning | E | @apiStyleHints, apiSamples
Webhooks and integrations | E | @integrations, @emailServices, @paymentProviders, thirdParties | Server-to-server links are invisible.
Database schema | I | apiSamples, structuredTypes | Needs database access; field names in saved API responses hint at it.
Query performance | I | ttfb | Needs server metrics; time to first byte is the outside proxy.
Data model (entities and relationships) | E | apiSamples, structuredTypes, siteTree | Inferred from address patterns and saved data.
Data flow (origin, movement, destination) | E | thirdParties, formsDetail, @formsSendingToOtherSites, trackers | Flows leaving the browser are seen; server-side flows are not.
Data integrity and validation | E | @fieldsWithValidation, @requiredFields | Browser-side rules only.
Migrations | I | | Needs the repository.
Background jobs and queues | I | | Needs server access.
Search infrastructure | E | @siteSearch, @integrations | A search service is named if its script is loaded.
File storage and media pipeline | E | assetHosts, @integrations, @imageFormats, @responsiveImages
Payment integration | M | @paymentProviders, @cartOrCheckout
Email sending and deliverability | M | mail, @emailServices
Real-time behaviour (websockets, polling) | M | websockets, @integrations
Concurrency (simultaneous edits) | I | | Needs two signed-in sessions and test data.
Multi-tenancy | I | subdomains, @otherEnvironmentsMentioned | Outside hints only.
Role and permission model | I | needSignIn, robots | Scrape once per role and compare what each can reach.
Audit trail | I | | Internal.
Time handling (time zones, scheduling) | E | @publishedDate, @modifiedDate, @openingHours | Date formats seen in pages.
Text handling (encodings, emoji, name formats) | M | charset, @emoji, @nonLatinText, @inclusiveFormOptions
Error handling | E | notFoundPage, errorPages, secFind:disclosed, jsErrors | Errors met while scraping are recorded; none were provoked.
Logging | I | @monitoringTools | Server logs are internal; browser error reporting tools are detected.

# Architecture and operations
Overall architecture (monolith, microservices, serverless, static) | E | tech, server, cdn, @hydrationMarkers, apiHosts, generator | Inferred.
Hosting and infrastructure | M | ip, dnsNames, server, cdn
Domain and DNS | M | dns, domainAge
TLS certificates | M | cert, secFind:certificate/encryption
Protocol level (HTTP versions, headers, redirects, status codes) | M | protocols, statusDist, redirects, secFind:header/HSTS, compression
CDN and edge | M | cdn, assetHosts
Load balancing | I | ip | Several addresses are the only outside hint.
Caching strategy | M | caching, offline, @preloads
Containerisation | I | | Not visible from outside.
Infrastructure as code | I | | Needs the repository.
Configuration and environments | E | @otherEnvironmentsMentioned, @possibleSecretsInCode, @debugLeftovers
Secrets management | E | @possibleSecretsInCode, sourceMaps, secFind:comment | Only leaks are visible; values are masked in the results.
Build tooling | M | @buildTooling, sourceMaps
Deployment pipeline | I | @buildTooling | Internal.
Releases and rollbacks | I | @roadmapOrChangelog, history | Public changelog if any.
Feature flags and experiments | M | @experimentsAndFlags
Staging and test environments | E | @otherEnvironmentsMentioned
Local development setup | I | | Needs the repository.
Monitoring and alerting | E | @monitoringTools, @statusPage
Observability and tracing | E | @monitoringTools, serverTiming
Backup and disaster recovery | I | | Internal.
Vendor lock-in and portability | E | tech, @integrations, @paymentProviders, generator | The dependencies are listed; the cost of leaving them is a judgement.
Infrastructure cost per user or request | I | weight, cdn | Needs the bills and traffic figures.

# Code and engineering health
Code readability | E | sourceMaps, @debugLeftovers | Readable only where source maps are public; those files are saved.
Technical debt | E | @deprecatedHtml, @libraries, secFind:jQuery, @importantOverrides, @inlineStyles, @tablesForLayout
Type safety | I | sourceMaps | Needs the repository.
Unit tests | I | | Needs the repository.
Integration tests | I | | Needs the repository.
End-to-end tests | I | | Needs the repository.
Linting and formatting | I | | Needs the repository.
Dependencies and their risks | E | @libraries, tech, thirdParties, secFind:jQuery/integrity | Browser-side libraries and versions; server-side packages are not visible.
Open-source licence compliance | E | @licenceMentions, @libraries | Needs the dependency list from the repository.
Documentation | E | @helpCentre, docs | Public docs only.
Version control and change history | I | history, @roadmapOrChangelog | Needs the repository; web archive dates are the outside trace.
Developer experience | I | | Internal.
Maintainability | E | designConsistency, @duplicateIds, @inlineStyles, @importantOverrides, @libraries
Bus factor (who else understands it?) | I | @author, generator | A people question.
Conway's law (how the team's structure shows in the site) | E | subdomains, designConsistency, siteTree, tech | Different looks or stacks per section hint at separate teams.

# Performance and reliability
Load performance and Core Web Vitals | M | vitals, slowest
Time to first byte | M | ttfb
Critical rendering path | M | @renderBlockingScripts, @stylesheets, @preloads, @inlineStyleBlocks
Image optimisation | M | @imageFormats, @oversizedImages, @responsiveImages, @imagesWithoutDimensions, imageBytes
Font loading | M | fontFiles, @fontDisplay, @webFonts, @preloads
Lazy loading | M | @lazyLoadedImages, imagesTotal
Compression | M | compression
Runtime performance (scrolling, input lag) | E | longTasks, domSize, @stickyElements | Long tasks during load are counted; scrolling feel needs a device.
Memory use | I | domSize | Needs profiling.
Battery and data consumption | E | weight, @autoplayVideo, @transitionsAndAnimations, trackers
Scalability under traffic | I | cdn, caching | Needs load testing by the owner.
Uptime and error rates | I | errorPages, @statusPage | One visit only; needs monitoring over time.
Resilience when a dependency fails | E | thirdParties, @renderBlockingScripts, secFind:integrity | Blocking scripts from other hosts are single points of failure.
Graceful degradation and progressive enhancement | M | noJs, @hydrationMarkers
Sustainability and carbon per page view | M | carbon, weight

# Security
Attacker's view | E | secSummary, @otherEnvironmentsMentioned, @possibleSecretsInCode, hiddenFields, robots, sourceMaps, server | What an outsider can learn without touching anything. Nothing was attacked.
Defender's view | M | secSummary, secTop
Authentication | E | @signInForm, @singleSignOn, secFind:password/sign-in, @captcha | The sign-in page is examined; credentials are never tested.
Authorisation | I | needSignIn | Needs accounts of different roles.
Session management | M | cookies, secFind:cookie
Password and recovery flows | E | @passwordReset, @passwordRulesShown, secFind:password | Flows are not exercised.
Multi-factor authentication | E | @multiFactorMention | Mention only; confirm with an account.
Injection attacks | I | | Needs authorised penetration testing. Not attempted.
Cross-site scripting | E | secFind:Content Security/inline/jQuery, @inlineEventHandlersNote | Protections are assessed; no payloads were sent.
Cross-site request forgery | E | secFind:forgery/SameSite | Token presence and cookie flags only.
Server-side request forgery | I | | Needs authorised penetration testing. Not attempted.
File upload handling | E | uploads, secFind:nosniff | Upload fields are counted; nothing was uploaded.
Security headers and content security policy | M | secFind:header/Content Security/HSTS/framed/nosniff/Referrer/Permissions
Cross-origin rules (CORS) | M | secFind:Any website
Encryption in transit and at rest | E | cert, secFind:HTTPS/HSTS/Insecure | In transit is measured; at rest is internal.
Supply-chain risk | M | thirdParties, secFind:integrity, @libraries
Rate limiting | E | rateLimit | Only noticed if the site pushed back during the scrape.
Denial-of-service resistance | I | cdn | Not tested, and must not be without permission.
Bots and scraping | M | robots, @captcha, humanChecks, @honeypotFields
Spam and fake accounts | E | @captcha, @honeypotFields, @registerLink
Fraud | I | @paymentProviders | Internal controls.
Phishing and impersonation surface | M | mail, secFind:SPF/DMARC, cert, domainAge
Security logging and incident response | E | wellknownSecurity, @breachWording | Published contact and policy only.
Penetration testing | I | secSummary | This is a passive review, not a penetration test. Commission one for sites you own.
Forensics (logs, metadata, timestamps) | E | lastModified, history, sourceMaps, docsMeta, commentsCount

# Privacy and safety
Data collected | M | formsDetail, cookies, trackers, @storageKeys.local
Data shared with third parties | M | thirdParties, trackers, @formsSendingToOtherSites
Tracking and fingerprinting | M | trackers, @fingerprintingHints, @sessionRecording, cookies
Consent and cookie handling | M | consent, @cookieChoices, cookiesBeforeConsent
Data retention | E | cookieLifetimes, @retentionWording | Cookie lifetimes are measured; server retention is whatever the policy states.
Data residency | E | ip, @dataLocationWording, thirdParties | Server address and policy wording.
Anonymity and pseudonymity | E | @registerLink, formsDetail, trackers | What must be given to take part.
Trust and safety (moderation) | E | @safeguardingWording, @reportAbuse, @userGeneratedContent
Child safety and age-appropriateness | E | @ageGate, @childDirected, trackers, @safeguardingWording
Harassment and abuse handling | E | @reportAbuse, @safeguardingWording
Reporting and appeals | E | @reportAbuse

# How machines see it
Search engine crawlability and indexing | M | robots, sitemap, noindex, statusDist, canonical, noJs
Keywords and search intent | M | topWords, @keywordsMeta, h1, missingTitle
Titles and meta descriptions | M | missingTitle, missingDesc, dupTitles
Internal linking | M | internalLinks, depthDist, brokenLinks, orphanHint
Backlinks | I | externalLinks | Who links in needs a search-data service; outbound links are listed.
Sitemaps and robots rules | M | sitemap, robots
Canonical URLs and duplicate content | M | canonical, dupContent, redirects
Local search | M | @localBusinessData, @addressShown, @mapEmbed, @openingHours, phones
Language targeting (hreflang) | M | @hreflangs, lang
Structured data | M | structuredTypes
Social link previews | M | @socialPreview.title, @socialPreview.image, @socialPreview.twitterCard
Scraper's view | M | pages, apiCount, needSignIn, humanChecks, noJs, interactions
AI agent or LLM readability | M | noJs, llms, @semanticElements, ariaTree, allContent
Accessibility tree | M | ariaTree
Voice assistants | E | @speakableOrVoice, structuredTypes, @faq
Feeds and syndication (RSS) | M | feeds, @podcastOrFeed
Web archives | M | history

# Business
Business goal | E | valueProp, @callsToAction, @cartOrCheckout, @registerLink | Inferred from what the site asks visitors to do.
Value proposition | E | valueProp, @taglineOrSubheading
Conversion and funnels | I | @callsToAction, @experimentsAndFlags, depthDist | Rates need the owner's analytics.
Calls to action | M | @callsToAction
Revenue model | E | @paymentProviders, @subscriptionWording, @sponsoredOrAdMarkers, @pricesShown
Pricing presentation | M | @priceExamples, @pricingPage, @vatMention, @freeTrialOrDiscount
Acquisition cost | I | @campaignParametersInLinks, trackers | Internal figures.
Retention and churn | I | @newsletterSignup, @notificationsPrompt | Internal figures.
Lifetime value | I | | Internal figures.
Upsell and cross-sell | E | @upsellWording
Social proof and testimonials | M | @testimonials, @ratings, @partnerLogos, @awardsOrAccreditation
Marketing and positioning | E | valueProp, topWords, @comparisonWording, socials
Campaigns and landing pages | E | @campaignParametersInLinks, noindex, orphanHint
Competitive comparison | E | @comparisonWording | Scrape the competitors as a batch and compare the reports.
Reputation and reviews | E | @ratings, @integrations | On-site ratings only; off-site reviews need those sites.
Customer support load | I | @chatWidgets, @faq | Internal figures.
Build and running cost | I | tech, cdn, thirdParties | Internal figures; the paid services detected are listed.
Return on investment | I | | Internal figures.
Opportunity cost (what it should stop doing) | E | thin, dupContent, errorPages | Low-value pages are the outside hint.
Roadmap and priorities | E | @roadmapOrChangelog
Asset value and liabilities | E | domainAge, history, pages, secSummary, legal

# Measurement
Analytics and traffic | E | trackers | Tools are detected; the numbers are in the owner's accounts.
Measurement accuracy | E | trackers, consent, @cookieChoices | Tags firing before consent, or twice, distort figures.
Attribution (which channel gets the credit) | I | @campaignParametersInLinks | Internal.
Key performance indicators | I | @callsToAction | Internal.
Segmentation and cohorts | I | | Internal.
Heatmaps and session recordings | M | @sessionRecording
A/B test validity | E | @experimentsAndFlags | Tools are detected; validity needs the test data.
User feedback and surveys | E | @feedbackOrSurvey
Support tickets as evidence | I | | Internal.
Recommendation and ranking algorithms | E | @personalisation, @upsellWording | Presence only.
Algorithmic bias and fairness | I | | Needs the data and the model.
Transparency and explainability | E | legal, @sponsoredOrAdMarkers, @personalisation

# Legal and governance
Terms of service | M | legalTerms
Privacy policy | M | legalPrivacy, @informationOfficer
Data protection law (POPIA, GDPR) | E | legalPrivacy, @lawsMentioned, @informationOfficer, @dataRequestsWording, consent, trackers | Facts for a compliance review; not legal advice.
Cookie law | E | consent, @cookieChoices, cookiesBeforeConsent, legalCookie
Accessibility law | E | a11yCounts, contrast, legalAccessibility
Consumer protection (refunds, cancellations) | E | @refundPolicyWording, legalRefunds, @accountDeletionOrExport
E-commerce law | E | @vatMention, legalNumbers, @addressShown, @refundPolicyWording, legalTerms
Tax and VAT | E | @vatMention, legalNumbers
Sector regulation (finance, health, education) | E | @sectorRegulators, @awardsOrAccreditation
Advertising standards | E | @sponsoredOrAdMarkers, @freeTrialOrDiscount, @scarcityWording
Copyright and content licensing | E | legalCopyright, @licenceMentions
Trademarks | E | @trademarkMarks
Font and image licences | E | fontFiles, @licenceMentions, imagesTotal | Files in use are listed; the licences held are internal.
Liability for user content and takedown process | E | @takedownWording, @reportAbuse, @userGeneratedContent
Data subject requests | E | @dataRequestsWording, @informationOfficer
Breach notification | E | @breachWording, wellknownSecurity
Contracts and service-level agreements | E | @slaOrUptimeWording, legalTerms
Content governance (who publishes and approves) | I | @author, generator | Internal.
Ownership and stakeholder politics | I | domainAge, legalNumbers | Registration facts only.
Training and change management | I | | Internal.

# Wider context
Historical (how it evolved, legacy decisions) | M | history, domainAge, @deprecatedHtml, @copyrightYear
Lifecycle (growing, maintained, due for retirement) | E | @modifiedDate, @latestYearMentioned, history, @libraries, cert
Future-proofing and longevity | E | @libraries, @deprecatedHtml, tech, domainAge
Ecosystem (integrations, what depends on it) | M | @integrations, thirdParties, feeds, apiCount
Community (users' relationships with each other) | E | @communityFeatures, @userGeneratedContent, socials
Network effects | I | @communityFeatures | Needs usage data.
Cultural assumptions | E | lang, @priceExamples, @inclusiveFormOptions, @openingHours, screenshots
Political and censorship | E | ip, dataLocation, @lawsMentioned | Hosting country and legal references only.
Labour (who moderates and maintains it, and under what conditions) | I | @safeguardingWording, @author | Not visible.
Open-source intelligence (what outsiders can infer) | M | emails, phones, dns, tech, hiddenFields, @otherEnvironmentsMentioned, docsMeta, history
Ethics (honesty, manipulation, who benefits and who is harmed) | E | @scarcityWording, @confirmShaming, @preTickedBoxes, trackers, consent, @sponsoredOrAdMarkers | The facts are gathered; the judgement is human.
`;

const LEVEL = { M: 'measured', E: 'evidence', I: 'inside' };
const kb = (n) => (n == null ? 'n/a' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const list = (a, n = 8) => (a && a.length ? a.slice(0, n).join(', ') + (a.length > n ? ` (+${a.length - n} more)` : '') : null);
const label = (k) => k.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Named facts. Each returns a short sentence or null when there is nothing to say. */
function facts(s) {
  const P = s.perspectives; const I = s.issues; const G = P.signals || {}; const sec = (re) => P.security.findings.filter((f) => new RegExp(re, 'i').test(f.title));
  const n = (k) => (I[k] || []).length; const pages = s.stats.pages; const L = P.legal; const av = P.performance.averages; const D = P.design; const A = P.accessibility; const inf = P.infrastructure; const sig = (k) => G[k];
  const F = {
    pages: () => `${pages} pages scraped`, words: () => `${P.content.totalWords} words in total, about ${Math.round(P.content.totalWords / Math.max(1, P.content.pages))} per page`,
    depthDist: () => { const m = {}; for (const p of s.pages) m[p.depth] = (m[p.depth] || 0) + 1; return 'Clicks from the start page: ' + Object.entries(m).map(([d, c]) => `${d} clicks: ${c} pages`).join('; '); },
    statusDist: () => { const m = {}; for (const p of s.pages) { const k = p.error ? 'failed' : p.status; m[k] = (m[k] || 0) + 1; } return 'Responses: ' + Object.entries(m).map(([d, c]) => `${d}: ${c}`).join(', '); },
    siteTree: () => { const m = {}; for (const p of s.pages) { const seg = '/' + (new URL(p.url).pathname.split('/').filter(Boolean)[0] || ''); m[seg] = (m[seg] || 0) + 1; } return 'Top sections: ' + Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, c]) => `${k} (${c})`).join(', '); },
    brokenLinks: () => `${n('brokenInternalLinks')} links lead to missing pages`, errorPages: () => `${n('errorPages')} pages returned an error, ${n('failedToLoad')} would not load`, jsErrors: () => `${n('javascriptErrors')} pages had script errors`,
    dupTitles: () => `${n('duplicateTitles')} titles are reused`, dupContent: () => `${n('duplicateContent')} groups of pages have identical text`, thin: () => `${n('thinContent')} pages have under 50 words`, missingTitle: () => `${n('missingTitle')} pages have no title`, missingDesc: () => `${n('missingDescription')} pages have no description`,
    h1: () => `${n('missingH1')} pages have no main heading, ${n('multipleH1')} have several`, alt: () => `${n('imagesWithoutAlt')} pages have images with no text description`, slowest: () => list(P.performance.slowestPages.slice(0, 3).map((p) => `${p.url} (${p.largestPaintMs} ms)`), 3) && 'Slowest: ' + list(P.performance.slowestPages.slice(0, 3).map((p) => `${p.url} (${p.largestPaintMs} ms)`), 3),
    noindex: () => `${n('noindexPages')} pages ask search engines not to index them`, docs: () => `${(s.documents || []).length} documents saved, ${s.stats.documentsRead} with their text read`, docsNoText: () => `${n('documentsWithoutText')} documents have no readable text (scans)`,
    docsMeta: () => { const d = (s.documents || []).filter((x) => x.author || x.producer || x.created); return d.length ? `Document properties expose: ${list(d.map((x) => [x.author, x.producer].filter(Boolean).join(' / ')), 5)}` : null; },
    contrast: () => `${A.lowContrastText} pieces of text fail the contrast minimum`, a11yCounts: () => `Images without description ${A.imagesWithoutDescription}, unlabelled fields ${A.formFieldsWithoutLabel}, links without text ${A.linksWithoutText}, buttons without a name ${A.buttonsWithoutName}, heading levels skipped ${A.headingLevelsSkipped}`,
    a11yFields: () => `${A.formFieldsWithoutLabel} form fields have no label`, a11yImages: () => `${A.imagesWithoutDescription} images have no description at all`, a11yNames: () => `${A.linksWithoutText + A.buttonsWithoutName} controls have no spoken name`, a11ySkip: () => (G.skipLinkPages ? `Skip link on ${G.skipLinkPages.pages} pages` : 'No skip link found'),
    lang: () => `Languages declared: ${Object.entries(P.content.languages).map(([k, c]) => `${k} (${c} pages)`).join(', ') || 'none'}; ${A.pagesWithoutLanguage} pages declare none`, landmarks: () => `${A.pagesWithoutMainLandmark} of ${A.pagesChecked} pages have no main landmark`, zoom: () => `${A.pagesBlockingZoom} pages block pinch-zoom`,
    touchTargets: () => (G.smallTouchTargets ? `${G.smallTouchTargets.sum} tap targets smaller than 24 px at phone width, on ${G.smallTouchTargets.pages} pages` : 'No tap targets under 24 px at phone width'), ariaTree: () => 'Accessibility tree saved for every page (accessibility-tree.yaml)', charset: () => (G.charset ? `Encoding: ${list(G.charset.values)}` : null),
    colors: () => `Text colours: ${list(D.colors.text.map((c) => c.value), 6)}. Backgrounds: ${list(D.colors.background.map((c) => c.value), 6)}`, fonts: () => `Fonts: ${list(D.fonts.map((c) => c.value), 6)}`, sizes: () => `Type sizes: ${list(D.fontSizes.map((c) => c.value), 10)}`, radii: () => `Corner radii in use: ${D.cornerRadii.length} (${list(D.cornerRadii.map((c) => c.value), 6) || 'none'})`, shadows: () => `${D.shadows.length} distinct shadows`,
    breakpoints: () => `Breakpoints: ${list(D.breakpoints.map((c) => c.value), 8) || 'none found'}`, cssVars: () => `${Object.keys(D.cssVariables).length} design variables declared`, cssRules: () => (G['layout.cssRules'] ? `About ${Math.round(G['layout.cssRules'].sum / Math.max(1, G['layout.cssRules'].pages))} style rules per page` : null), logos: () => (D.logos.length ? `Logo: ${list(D.logos, 3)}` : 'No logo image identified'), themeColors: () => (D.themeColors.length ? `Theme colour: ${list(D.themeColors)}` : null),
    typography: () => { const t = D.typography || {}; return ['h1', 'h2', 'paragraph', 'button'].filter((k) => t[k]).map((k) => `${k}: ${t[k].fontFamily.split(',')[0]} ${t[k].fontSize} weight ${t[k].fontWeight}`).join('; ') || null; }, fontFiles: () => (D.fontFiles.length ? `${D.fontFiles.length} font files: ${list([...new Set(D.fontFiles.map((f) => f.family))], 6)}` : 'No web font files declared'),
    layout: () => (G['layout.flexContainers'] ? `Flex containers ${G['layout.flexContainers'].sum}, grid containers ${(G['layout.gridContainers'] || {}).sum || 0} across the site` : null), viewportMeta: () => (G.viewportMeta ? `Viewport setting: ${list(G.viewportMeta.values, 2)}` : 'No viewport setting (not phone-ready)'), phoneScroll: () => (G.horizontalScrollOnPhone ? `${G.horizontalScrollOnPhone.pages} pages scroll sideways at phone width` : 'No sideways scrolling at phone width'),
    designConsistency: () => `${D.colors.text.length} text colours, ${D.fonts.length} font/weight pairs, ${D.fontSizes.length} type sizes, ${D.cornerRadii.length} corner radii in use (fewer usually means a tighter system)`, screenshots: () => 'Desktop screenshot saved for every page', mobileShot: () => 'Phone-width screenshot saved for every page', imagesTotal: () => (G.imageCount ? `${G.imageCount.sum} images across the site` : null), hiddenText: () => 'Tooltips, labels and style-drawn text captured per page',
    weight: () => `Average page ${kb(av.pageBytes)} over ${av.requests} requests`, bytesByType: () => 'Weight by kind: ' + Object.entries(P.performance.bytesByType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${kb(v)}`).join(', '), imageBytes: () => `Images total ${kb(P.performance.bytesByType.image || 0)}`, scriptCount: () => `Scripts total ${kb(P.performance.bytesByType.script || 0)}`,
    vitals: () => `First paint ${av.firstPaintMs} ms, largest paint ${av.largestPaintMs} ms, layout shift ${av.layoutShift} (averages, this computer)`, ttfb: () => (G.timeToFirstByteMs ? `Time to first byte averages ${Math.round(G.timeToFirstByteMs.sum / G.timeToFirstByteMs.pages)} ms` : null), domSize: () => `About ${av.domNodes} elements per page`, longTasks: () => (G.longTasks ? `${G.longTasks.sum} long tasks during load across ${G.longTasks.pages} pages` : 'No long tasks during load'),
    compression: () => (G.compression ? `Compression: ${list(G.compression.values)} on ${G.compression.pages} of ${pages} pages` : 'Pages are sent uncompressed'), caching: () => (G.cacheControl ? `Cache rules seen: ${list(G.cacheControl.values, 4)}` : 'No cache rules on pages'), cdn: () => (G.cdn ? `Delivery network: ${list(G.cdn.values)}` : 'No delivery network detected'), serverTiming: () => (G.serverTiming ? 'Server-Timing header present' : null), lastModified: () => (G.lastModifiedHeader ? `Last-Modified headers, e.g. ${list(G.lastModifiedHeader.values, 2)}` : null),
    offline: () => (G.serviceWorker ? `Service worker on ${G.serviceWorker.pages} pages` : 'No service worker (no offline support)'), manifest: () => (G.manifest ? `App manifest: ${list(G.manifest.values, 1)}` : 'No app manifest'), noJs: () => (G.textWithoutJavascript ? `Without JavaScript, pages still show on average ${Math.round(G.textWithoutJavascript.sum / G.textWithoutJavascript.pages)}% of their text` : null),
    carbon: () => (av.pageBytes ? `Roughly ${(av.pageBytes / 1073741824 * 0.81 * 442).toFixed(2)} g CO2 per page view (rough estimate from page weight)` : null), dataCost: () => (av.pageBytes ? `A visit to ${Math.min(pages, 10)} pages uses about ${kb(av.pageBytes * Math.min(pages, 10))} of mobile data` : null),
    readingEase: () => (G.readingEase ? `Reading ease averages ${Math.round(G.readingEase.sum / G.readingEase.pages)} of 100 (60+ is plain English, under 30 is academic)` : null),
    thirdParties: () => `${P.privacy.thirdParties.length} other hosts contacted: ${list(P.privacy.thirdParties.map((t) => t.host), 8) || 'none'}`, trackers: () => `Trackers and embeds: ${list([...new Set(P.privacy.trackers.map((t) => t.service))]) || 'none recognised'}`, cookies: () => `${P.privacy.cookies.length} cookies: ${list(P.privacy.cookies.map((c) => c.name), 8) || 'none'}`, cookieNames: () => list(P.privacy.cookies.map((c) => c.name), 8) && `Cookie names: ${list(P.privacy.cookies.map((c) => c.name), 8)}`,
    cookieLifetimes: () => (P.privacy.cookies.length ? `Longest-lived cookie: ${Math.max(...P.privacy.cookies.map((c) => c.lastsDays))} days` : null), consent: () => `Consent banner seen on ${P.privacy.pagesShowingConsentBanner} of ${P.privacy.pagesChecked} pages`, cookiesBeforeConsent: () => (P.privacy.trackers.length ? `${P.privacy.trackers.length} tracker hosts were contacted without any consent being given` : 'No trackers fired before consent'),
    dns: () => (inf.dns ? `Name servers: ${list(inf.dns.nameServers, 4)}. Mail: ${list(inf.dns.mailServers, 3) || 'none'}` : 'No public DNS (local address)'), dnsNames: () => (inf.dns ? `Reverse name: ${list(inf.dns.reverseName, 2) || 'none'}; alias: ${list(inf.dns.alias, 2) || 'none'}` : null), mail: () => (inf.dns ? `SPF: ${inf.dns.spf || 'none'}. DMARC: ${inf.dns.dmarc || 'none'}` : null), ip: () => `Server addresses: ${list(inf.ipAddresses) || 'n/a'}`,
    cert: () => (inf.certificate ? `Certificate from ${inf.certificate.issuer}, valid to ${inf.certificate.validTo}, ${inf.certificate.protocol}` : 'No certificate: the site is not on HTTPS'), protocols: () => `Connection: ${list(Object.keys(inf.protocols)) || 'n/a'}`, server: () => `Server software: ${list(inf.serverSoftware) || 'not disclosed'}`,
    robots: () => (s.robots.found ? `robots.txt present; asks crawlers to avoid: ${list(s.robots.disallowedPaths, 8) || 'nothing'}` : 'No robots.txt'), sitemap: () => `${s.sitemaps.urlsListed} addresses in the sitemap versus ${pages} pages found`, wellknown: () => `Standard files: ${list(inf.standardFiles) || 'none'}`, wellknownSecurity: () => (inf.standardFiles.some((x) => /security/.test(x)) ? 'security.txt is published' : 'No security.txt'), llms: () => (inf.standardFiles.some((x) => /llms/.test(x)) ? 'llms.txt is published' : 'No llms.txt'), feeds: () => (inf.standardFiles.some((x) => /feed|rss|atom/.test(x)) ? `Feed found: ${list(inf.standardFiles.filter((x) => /feed|rss|atom/.test(x)))}` : 'No feed found'),
    tech: () => `Built with: ${list(s.technologies.map((t) => t.name), 12) || 'nothing recognised'}`, generator: () => (G.generatorTag ? `Generator: ${list(G.generatorTag.values, 3)}` : null), emails: () => `${s.contacts.emails.length} email addresses: ${list(s.contacts.emails, 5) || 'none'}`, phones: () => `${s.contacts.phones.length} phone numbers: ${list(s.contacts.phones, 4) || 'none'}`, socials: () => `Social profiles: ${list(s.contacts.socials, 5) || 'none'}`,
    externalLinks: () => `${s.externalLinks.length} links to other sites`, internalLinks: () => (G.internalLinks ? `${G.internalLinks.sum} internal links, about ${Math.round(G.internalLinks.sum / G.internalLinks.pages)} per page` : null), orphanHint: () => { const c = s.pages.filter((p) => p.foundOn === 'sitemap' || p.foundOn === 'feed').length; return `${c} pages were found only through the sitemap or feed (nothing links to them)`; },
    topWords: () => `Most used words: ${list(P.content.topWords.map((w) => w.word), 20)}`, valueProp: () => (G.valueProposition ? `Main headings: ${list(G.valueProposition.values, 3)}` : null), canonical: () => (G.canonicalMatchesUrl ? `Canonical address matches on ${G.canonicalMatchesUrl.pages} pages` : 'No canonical addresses declared'), structuredTypes: () => (G.structuredDataTypes ? `Structured data types: ${list(G.structuredDataTypes.values, 12)}` : 'No structured data'),
    legal: () => { const have = Object.entries(L).filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k]) => label(k)); return `Found: ${list(have, 12) || 'no policy pages'}`; }, legalTerms: () => (L.terms ? `Terms: ${L.terms}` : 'No terms page found'), legalPrivacy: () => (L.privacyPolicy ? `Privacy policy: ${L.privacyPolicy}` : 'No privacy policy found'), legalCookie: () => (L.cookiePolicy ? `Cookie policy: ${L.cookiePolicy}` : 'No cookie policy found'),
    legalAccessibility: () => (L.accessibilityStatement ? `Accessibility statement: ${L.accessibilityStatement}` : 'No accessibility statement found'), legalRefunds: () => (L.refunds ? `Refunds page: ${L.refunds}` : 'No refunds page found'), legalCopyright: () => (L.copyright ? `Copyright line: ${L.copyright}` : 'No copyright line'), legalNumbers: () => ((L.companyNumbers || []).length ? `Registration numbers shown: ${list(L.companyNumbers)}` : 'No company or VAT number shown'),
    secSummary: () => `Security review: ${P.security.summary.high} serious, ${P.security.summary.medium} should fix, ${P.security.summary.low} minor, ${P.security.summary.info} notes`, secTop: () => list(P.security.findings.slice(0, 6).map((f) => f.title), 6) && 'Top findings: ' + list(P.security.findings.slice(0, 6).map((f) => f.title), 6), hiddenFields: () => (P.security.hiddenFormFields.length ? `Hidden form fields: ${list(P.security.hiddenFormFields, 10)}` : null), sourceMaps: () => (P.security.publicSourceMaps.length ? `${P.security.publicSourceMaps.length} source maps are public (original code saved)` : 'No public source maps'),
    uploads: () => (G.fileUploads ? `${G.fileUploads.sum} file upload fields` : 'No file upload fields'), commentsCount: () => (G.commentsInCode ? `${G.commentsInCode.sum} comments left in page code` : null), needSignIn: () => `${(s.needSignIn || []).length} pages were behind a sign-in${s.signedIn ? ' (scraped while signed in)' : ''}`, humanChecks: () => { const c = (s.needSignIn || []).filter((g) => g.reason === 'challenge').length; return c ? `${c} pages showed an "are you human" check` : 'No bot checks met'; },
    rateLimit: () => (/slowing down/.test(JSON.stringify(s.errors || [])) || s.options.delay > 300 ? 'The site pushed back on request speed during the scrape' : 'No rate limiting met at this scrape speed'), redirects: () => `${(s.redirects || []).length} redirects`, apiCount: () => `${s.stats.apiResponsesCaptured} background data responses saved`, apiSamples: () => (s.stats.apiResponsesCaptured ? 'Field names and shapes are in the saved responses (api.jsonl)' : null), apiHosts: () => { const h = P.privacy.thirdParties.filter((t) => t.kinds.includes('xhr') || t.kinds.includes('fetch')).map((t) => t.host); return h.length ? `Data is fetched from: ${list(h, 6)}` : null; },
    assetHosts: () => { const h = P.privacy.thirdParties.filter((t) => t.kinds.includes('image') || t.kinds.includes('font') || t.kinds.includes('media')).map((t) => t.host); return h.length ? `Media is served from: ${list(h, 6)}` : 'Media is served from the site itself'; }, websockets: () => (G.webSockets ? `Live connections on ${G.webSockets.pages} pages` : 'No live (websocket) connections'), subdomains: () => { const h = [...new Set(s.externalLinks.map((u) => { try { return new URL(u).hostname; } catch { return ''; } }).filter((h2) => h2.endsWith('.' + new URL(s.startUrl).hostname.replace(/^www\./, ''))))]; return h.length ? `Sister subdomains linked: ${list(h, 8)}` : null; },
    interactions: () => `${s.stats.revealedByClicking} pieces of content were revealed by clicking tabs, accordions and "more"`, ocr: () => (s.stats.imagesRead ? `${s.stats.imagesRead} images were read for text` : 'Text inside images was not read (switch on "Read text inside images")'), allContent: () => 'The whole site is saved as one Markdown file (all-content.md)', formsDetail: () => (G.formFields ? `${(G.formsCount || {}).sum || 0} forms asking for ${G.formFields.sum} fields; every field is recorded per page` : 'No forms'),
    notFoundPage: () => { const p = s.pages.find((x) => x.status === 404); return p ? `Not-found page captured: "${p.title || 'untitled'}" with ${p.links} links` : 'No not-found page was met'; },
    history: () => { const h = P.history || {}; return h.firstArchived ? `First archived ${h.firstArchived}, latest ${h.lastArchived} (Internet Archive)` : 'No web archive record found (or the archive could not be reached)'; }, domainAge: () => { const h = P.history || {}; return h.domainRegistered ? `Domain registered ${h.domainRegistered}${h.registrar ? ' with ' + h.registrar : ''}${h.domainExpires ? ', expires ' + h.domainExpires : ''}` : null; }, dataLocation: () => { const h = P.history || {}; return h.hostingCountry ? `Hosted in ${h.hostingCountry}` : null; },
  };
  return { F, sec, sig };
}

function generic(key, G) {
  const v = G[key]; if (!v) return null; const l = label(key);
  if (v.values && v.values.length) return `${l}: ${list(v.values, 10)}${v.pages > 1 ? ` (${v.pages} pages)` : ''}`;
  if (v.sum) return `${l}: ${Math.round(v.sum * 10) / 10}${v.pages ? ` across ${v.pages} pages` : ''}`;
  return v.pages ? `${l}: on ${v.pages} pages${v.examples && v.examples.length ? `, e.g. ${v.examples[0]}` : ''}` : null;
}

/** Returns a function that turns evidence keys into sentences for this scrape. */
function evaluator(summary) {
  const { F, sec } = facts(summary); const G = summary.perspectives.signals || {};
  return (keys, lv) => {
    const evidence = [];
    for (const k of keys) {
      let e = null;
      try {
        if (k.startsWith('@')) e = generic(k.slice(1), G) || (lv === 'M' ? `${label(k.slice(1))}: none found` : null);
        else if (k.startsWith('secFind:')) { const f = sec(k.slice(8).replace(/\//g, '|')); e = f.length ? f.map((x) => `${x.title}${x.pagesAffected ? ` (${x.pagesAffected} pages)` : ''}`).join('; ') : (lv === 'M' ? `No findings for: ${k.slice(8).replace(/\//g, ', ')}` : null); }
        else if (F[k]) e = F[k]();
      } catch { e = null; }
      if (e && !evidence.includes(e)) evidence.push(e);
    }
    return evidence;
  };
}
/** The hand-mapped lenses: lower-case name -> { lv, keys, note }. */
function curated() {
  const m = new Map();
  for (const raw of CATALOGUE.split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('# ')) continue;
    const [name, lv, keys = '', note = ''] = line.split(/\s*\|\s*/);
    m.set(name.toLowerCase(), { lv, keys: keys.split(',').map((x) => x.trim()).filter(Boolean), note });
  }
  return m;
}

module.exports = { evaluator, curated, LEVEL };
