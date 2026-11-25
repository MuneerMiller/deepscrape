'use strict';
/*
 * Bring your own AI. The owner adds one or more AI connections (provider, their own API key, model)
 * and DeepScrape can hand the scraped information to whichever one they pick:
 *   - writeVerdicts: a short written verdict for every lens that has facts
 *   - askSite:       any question or instruction, answered from the scraped site
 *
 * What leaves the computer is only what is sent in these calls, to the provider the owner chose.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { evaluate } = require('./lenses');

// style: how the provider's API is spoken to. Most providers accept the "openai" style.
const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', style: 'anthropic', baseUrl: 'https://api.anthropic.com', modelHint: 'claude-sonnet-5-5', needsKey: true },
  { id: 'openai', name: 'OpenAI (ChatGPT)', style: 'openai', baseUrl: 'https://api.openai.com/v1', modelHint: 'the model name from platform.openai.com', needsKey: true },
  { id: 'gemini', name: 'Google (Gemini)', style: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelHint: 'the model name from Google AI Studio', needsKey: true },
  { id: 'openrouter', name: 'OpenRouter (many models)', style: 'openai', baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'vendor/model as listed on openrouter.ai', needsKey: true },
  { id: 'mistral', name: 'Mistral', style: 'openai', baseUrl: 'https://api.mistral.ai/v1', modelHint: 'the model name from Mistral', needsKey: true },
  { id: 'groq', name: 'Groq', style: 'openai', baseUrl: 'https://api.groq.com/openai/v1', modelHint: 'the model name from Groq', needsKey: true },
  { id: 'deepseek', name: 'DeepSeek', style: 'openai', baseUrl: 'https://api.deepseek.com/v1', modelHint: 'the model name from DeepSeek', needsKey: true },
  { id: 'xai', name: 'xAI (Grok)', style: 'openai', baseUrl: 'https://api.x.ai/v1', modelHint: 'the model name from xAI', needsKey: true },
  { id: 'ollama', name: 'Ollama (runs on this computer, nothing leaves it)', style: 'openai', baseUrl: 'http://localhost:11434/v1', modelHint: 'a model you have pulled, e.g. the name shown by "ollama list"', needsKey: false },
  { id: 'custom', name: 'Other (any OpenAI-compatible address)', style: 'openai', baseUrl: '', modelHint: 'the model name your service expects', needsKey: false },
];
const providerOf = (conn) => PROVIDERS.find((p) => p.id === conn.provider) || PROVIDERS[PROVIDERS.length - 1];

/** One request to the chosen AI. conn = { provider, baseUrl, model, apiKey }. Returns the reply text. */
async function callAi(conn, { system, user, maxTokens = 4000 }) {
  const p = providerOf(conn); const base = String(conn.baseUrl || p.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('This AI connection has no address.');
  if (!conn.model) throw new Error('This AI connection has no model name.');
  if (p.needsKey && !conn.apiKey) throw new Error('This AI connection has no API key.');
  let url, headers = { 'content-type': 'application/json' }, body, pick;
  if (p.style === 'anthropic') {
    url = base + '/v1/messages'; headers['x-api-key'] = conn.apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model: conn.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
    pick = (j) => (j.content || []).map((c) => c.text || '').join('');
  } else if (p.style === 'gemini') {
    url = `${base}/models/${encodeURIComponent(conn.model)}:generateContent`; headers['x-goog-api-key'] = conn.apiKey;
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } };
    pick = (j) => (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map((x) => x.text || '').join('');
  } else {
    url = base + '/chat/completions'; if (conn.apiKey) headers.authorization = 'Bearer ' + conn.apiKey;
    body = { model: conn.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens };
    pick = (j) => { const c = ((j.choices || [])[0] || {}).message || {}; return typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join(''); };
  }
  let res; try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) }); }
  catch (e) { throw new Error(`Could not reach ${p.name} at ${base} (${e.name === 'TimeoutError' ? 'no answer in 3 minutes' : (e.cause && e.cause.code) || e.message}).`); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (j.error && (j.error.message || j.error)) || j.message || ''; const d = typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300);
    throw new Error(res.status === 401 || res.status === 403 ? `${p.name} did not accept the API key. ${d}` : res.status === 404 ? `${p.name} does not know the model "${conn.model}" (or the address is wrong). ${d}` : res.status === 429 ? `${p.name} says too many requests, or the account is out of credit. ${d}` : `${p.name} answered ${res.status}. ${d}`);
  }
  const text = pick(j); if (!text) throw new Error(`${p.name} sent back an empty reply.`);
  return text;
}
const testAi = (conn) => callAi(conn, { system: 'Reply with the single word: ready', user: 'Are you there?', maxTokens: 20 });

const RATINGS = ['strong', 'fine', 'mixed', 'weak', 'cannot tell'];
function parseJson(text) { const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('The AI did not reply in the expected format. A more capable model usually fixes this.'); try { return JSON.parse(m[0]); } catch { throw new Error('The AI reply could not be read. A more capable model usually fixes this.'); } }

/** A short verdict for every lens that has facts. Writes verdicts.json in the scrape folder as it goes. */
async function writeVerdicts(dir, { conn, families, onProgress = () => {}, shouldStop = () => false }) {
  const summary = JSON.parse(await fsp.readFile(path.join(dir, 'site.json'), 'utf8'));
  const fams = evaluate(summary, families && families.length ? families : summary.lensFamilies || undefined);
  let excerpt = ''; try { excerpt = (await fsp.readFile(path.join(dir, 'all-content.md'), 'utf8')).slice(0, 9000); } catch { /* no text */ }
  const file = path.join(dir, 'verdicts.json'); const label = `${providerOf(conn).name}, ${conn.model}`;
  let out = { model: label, generatedAt: null, families: {} }; try { out = { ...out, ...JSON.parse(await fsp.readFile(file, 'utf8')) }; } catch { /* first time */ }
  const system = 'You review websites. You are given lenses (ways of looking at a site) and the facts a scraper gathered for each. For every lens, judge the site through that lens using ONLY the facts given and the excerpt. Be specific and plain. If the facts do not bear on the lens, say "cannot tell" rather than guessing. Reply with JSON only, no other text: {"summary":"two or three sentences on the family as a whole","lenses":[{"n":1,"rating":"strong|fine|mixed|weak|cannot tell","verdict":"one or two sentences","action":"the one most useful thing to do, or empty"}]}';
  let done = 0;
  for (const f of fams) {
    if (shouldStop()) break;
    const usable = f.lenses.filter((l) => l.coverage !== 'inside' && l.evidence.length);
    const result = { name: f.name, summary: '', lenses: {}, judged: 0, skipped: f.lenses.length - usable.length };
    for (let i = 0; i < usable.length; i += 30) {
      if (shouldStop()) break;
      const chunk = usable.slice(i, i + 30);
      const user = `Website: ${summary.startUrl} (${summary.stats.pages} pages scraped)\nLens family ${f.id}: ${f.name}. ${f.about}\n\nLenses and their facts:\n${chunk.map((l) => `${l.n}. ${l.name}${l.note ? ` [note: ${l.note}]` : ''}\n${l.evidence.map((e) => '   - ' + e).join('\n')}`).join('\n')}\n\nExcerpt of the site's own text:\n${excerpt}`;
      const reply = parseJson(await callAi(conn, { system, user }));
      if (reply.summary) result.summary = result.summary ? result.summary + ' ' + reply.summary : reply.summary;
      for (const v of reply.lenses || []) if (v && v.n) { result.lenses[v.n] = { rating: RATINGS.includes(v.rating) ? v.rating : 'cannot tell', verdict: String(v.verdict || '').slice(0, 600), action: String(v.action || '').slice(0, 300) }; result.judged++; }
    }
    out.families[f.id] = result; out.model = label; out.generatedAt = new Date().toISOString();
    await fsp.writeFile(file, JSON.stringify(out, null, 2));
    onProgress({ done: ++done, total: fams.length, family: f.name });
  }
  return out;
}
const readVerdicts = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'verdicts.json'), 'utf8')); } catch { return null; } };

/**
 * Hand the scraped site to the AI with any question or instruction.
 * Sends: the site's facts (the lens report at summary level, security findings, contacts, technology),
 * then as much page and document text as fits the budget, most relevant to the question first.
 */
async function askSite(dir, conn, question, { budget = 160000 } = {}) {
  const summary = JSON.parse(await fsp.readFile(path.join(dir, 'site.json'), 'utf8'));
  const { buildReport } = require('./report');
  const facts = (await buildReport(dir, { format: 'md', detail: 'summary' })).buffer.toString().slice(0, 40000);
  const words = [...new Set(String(question).toLowerCase().match(/[a-zÀ-ɏ0-9]{4,}/g) || [])];
  const sources = [];
  for (const p of summary.pages) { if (p.error || p.kind === 'file') continue; let t = ''; try { t = await fsp.readFile(path.join(dir, 'pages', p.id, 'content.md'), 'utf8'); } catch { continue; } sources.push({ label: `PAGE ${p.url}`, text: t, depth: p.depth }); }
  for (const d of summary.documents || []) { if (!d.text) continue; let t = ''; try { t = await fsp.readFile(path.join(dir, ...d.text.split('/')), 'utf8'); } catch { continue; } sources.push({ label: `DOCUMENT (${d.kind}) ${d.url}`, text: t, depth: 2 }); }
  for (const s of sources) { const low = s.text.toLowerCase(); s.score = words.reduce((n, w) => n + Math.min(8, low.split(w).length - 1), 0) - s.depth * 0.5; }
  sources.sort((a, b) => b.score - a.score);
  let used = facts.length, included = 0, body = '';
  for (const s of sources) { const room = budget - used; if (room < 1500) break; const piece = s.text.length > room ? s.text.slice(0, room) + '\n[cut]' : s.text; body += `\n\n===== ${s.label} =====\n${piece}`; used += piece.length; included++; }
  const system = 'You are given information scraped from a website: measured facts about it, then the text of its pages and documents. Answer the request using only this material. Say plainly when the material does not cover something. Quote page addresses when pointing at something specific.';
  const user = `REQUEST:\n${question}\n\n########## FACTS ABOUT THE SITE ##########\n${facts}\n\n########## PAGE AND DOCUMENT TEXT (${included} of ${sources.length} sources fit) ##########${body}`;
  const answer = await callAi(conn, { system, user, maxTokens: 6000 });
  const entry = { at: new Date().toISOString(), ai: `${providerOf(conn).name}, ${conn.model}`, question, answer, sourcesSent: included, sourcesTotal: sources.length, charactersSent: user.length };
  await fsp.appendFile(path.join(dir, 'ai-answers.jsonl'), JSON.stringify(entry) + '\n');
  return entry;
}
const readAnswers = (dir) => { try { return fs.readFileSync(path.join(dir, 'ai-answers.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse(); } catch { return []; } };

module.exports = { PROVIDERS, callAi, testAi, writeVerdicts, readVerdicts, askSite, readAnswers };
