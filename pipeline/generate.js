#!/usr/bin/env node
// CrossFit OTL — Instagram Post Generator
// Reads brain from disk, calls Claude, renders with Puppeteer.
// Usage: node generate.js --campaign crossfit-is-the-cure --slug citc_apr28 --date 2026-04-28

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';
import { generateHookImage } from './image-gen.js';
import { configureCloudinary, getPhotoForSlide, buildPhotoUrl, PHOTO_EFFECTS } from './photo-library.js';

// Use same env loader as server.js (avoids dotenv encoding quirks)
function loadEnv() {
  const p = resolve(dirname(fileURLToPath(import.meta.url)), '.env');
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}
const envVars = loadEnv();
const getEnv  = k => envVars[k] || process.env[k];
configureCloudinary(envVars);

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const campaignSlug = get('--campaign') || 'crossfit-is-the-cure';
const slug         = get('--slug') || campaignSlug + '_' + Date.now();
const date         = get('--date') || new Date().toISOString().slice(0, 10);
const previewOnly  = args.includes('--preview');
const rerender     = args.includes('--rerender');     // re-render existing preview.html
const single       = args.includes('--single');       // single SplashSlide format
const track        = get('--track') || 'campaign';
const forceTopic   = get('--topic');
const directorNotes = process.env.OTL_NOTES || '';   // injected by server for regenerate

// ── Photo pool — matched by content type ─────────────────────
const PHOTOS = {
  training:  'assets/photos/training-crossfit.jpg',
  community: 'assets/photos/community.jpg',
  family:    'assets/photos/family.jpg',
  lifestyle: 'assets/photos/lifestyle.jpg',
  coaching:  'assets/photos/built-different.jpg',
  youth:     'assets/photos/youth.jpg',
  pt:        'assets/photos/personal-training.jpg',
  gym:       'assets/photos/storefront.jpg',
};

// ── Brain loader ──────────────────────────────────────────────
function loadBrain(campaignSlug) {
  const brainDir = resolve(__dirname, '../brain');
  const philosophy  = readFileSync(resolve(brainDir, 'philosophy.md'), 'utf8');
  const people      = readFileSync(resolve(brainDir, 'people.md'), 'utf8');
  const originStory = readFileSync(resolve(brainDir, 'origin-story.md'), 'utf8');

  let campaign = '';
  if (campaignSlug && campaignSlug !== 'none') {
    const campaignPath = resolve(brainDir, 'campaigns', `${campaignSlug}.md`);
    try { campaign = readFileSync(campaignPath, 'utf8'); }
    catch { console.warn(`  ⚠️  Campaign file not found: ${campaignSlug}.md`); }
  }

  return { philosophy, people, originStory, campaign };
}

// ── Educational topic picker ──────────────────────────────────
function pickTopic() {
  const topics = JSON.parse(readFileSync(resolve(__dirname, 'ccft-topics.json'), 'utf8'));
  const trackerPath = resolve(__dirname, 'ccft-tracker.json');
  const tracker = existsSync(trackerPath)
    ? JSON.parse(readFileSync(trackerPath, 'utf8'))
    : { used: [] };

  if (forceTopic) {
    const t = topics.find(t => t.id === forceTopic);
    if (!t) throw new Error(`Topic not found: ${forceTopic}`);
    return t;
  }

  // Prefer unused topics; once all used, reset cycle
  let pool = topics.filter(t => !tracker.used.includes(t.id));
  if (!pool.length) {
    tracker.used = [];
    pool = topics;
  }

  const topic = pool[Math.floor(Math.random() * pool.length)];
  tracker.used.push(topic.id);
  writeFileSync(trackerPath, JSON.stringify(tracker, null, 2), 'utf8');
  return topic;
}

// ── Educational prompt ────────────────────────────────────────
function buildEducationalPrompt(brain, topic) {
  return `You are the content engine for CrossFit OTL (@crossfitotl), a CrossFit affiliate in North Richland Hills, TX run by Javier and Deanie Jaime.

OTL VOICE — NON-NEGOTIABLE:
- Direct. Not preachy. Sounds like something a coach says after class.
- Personal — stories and observations first, science second.
- Credentialed — every claim has a mechanism behind it.
- Family-first audience: working adults, parents, 30s–50s. Not competitors.
- Bebas Neue ALL CAPS headlines. Short. Punchy. No fluff.
- "You've got this" is not OTL. Neither is "wellness journey."

OTL PHILOSOPHY:
${brain.philosophy}

---

EDUCATIONAL TRACK — CREATIVE BRIEF:

This post comes from a real CrossFit methodology concept. Your job is NOT to explain the paper. Your job is to find the truth inside it that makes someone stop scrolling — a truth that most gym-goers have gotten backwards, never heard articulated, or felt but couldn't name.

TOPIC SEED:
Title: ${topic.title}
Source: ${topic.source}
Hook: ${topic.hook}
Reframe: ${topic.reframe}
Mechanism: ${topic.mechanism}

CREATIVE LENSES — YOU MUST CHOOSE ONE:
1. THE REFRAME — Lead with what everyone believes. End with what's actually true. Let the pivot be the whole post.
2. THE MECHANISM — Name the system. Explain why the body adapts, in one sentence any parent understands.
3. THE CONFESSION — Something OTL is honest about that most gyms hide. Vulnerability that builds trust.
4. THE CONSEQUENCE — What happens if you never learn this? Visceral, not scary. Real, not dramatic.
5. THE TRANSLATION — Take what happens in the gym. Show what it prepares you for outside it.

SLIDE STRUCTURE — 5 slides total:
- Slide 1 (HookSlide): Stop the scroll. One bold claim. Short. The kind of thing that makes someone pause mid-swipe.
- Slides 2–4 (ValueSlide): One true thing per slide. Use variant "a" (photo + text) for at least 2 of the 3 value slides. Variant "b" (type-dominant, NO photo) for at most 1 slide — only when the headline is strong enough to own the full frame with zero visual support. Each slide stands alone.
- Slide 5 (CarouselCTA): Always last. Photo required. CTA feels earned — tied to the post's argument.

WHAT A GREAT HOOK HEADLINE LOOKS LIKE:
✓ "RANDOM IS NOT A PROGRAM"
✓ "YOU QUIT IN YOUR HEAD FIRST"
✓ "VO2 MAX WAS NEVER THE POINT"
✓ "FRAN IS A MIRROR"
✗ "CROSSFIT IMPROVES YOUR FITNESS"
✗ "SCIENCE SHOWS THAT..."

The post should make a 42-year-old parent who did the 6am class think: "I've felt that for two years and never knew how to say it."

---

Generate an Instagram carousel post. Return valid JSON only — no markdown, no commentary.

TEMPLATE REFERENCE:
- "HookSlide": full-bleed photo, bold hook. Fields: template, photo (null — pipeline assigns), headline, curiosity (short teaser line above headline), campaign
- "ValueSlide": variant "a" = photo top + text bottom; variant "b" = type-dominant, NO photo, pure text. Fields: template, variant, slideLabel (e.g. "TRUTH 01"), headline, body (2-3 sentences), nugget (bold one-liner at bottom), photo (null for variant b, null for a — pipeline assigns), campaign
- "CarouselCTA": last slide, photo required. Fields: template, headline, cta: {action, detail}, photo (null — pipeline assigns), campaign

Do NOT include "size" — defaults to "4:5".
Do NOT put photo paths — leave photo as null on every slide. Pipeline assigns real photos automatically.

The "campaign" object (same on every slide):
{
  "name": "${topic.title}",
  "hashtag": "#crossfitotl",
  "statement": "<the core truth of this post — 4–6 words>",
  "pull": "<one sentence that earns the follow>",
  "article": { "title": "<short topic title>", "byline": "CrossFit OTL · North Richland Hills, TX" }
}

Also return:
- "photoTheme": one of workout | community | coaching | event — what kind of photo fits this post visually
- "lens": which of the 5 lenses you chose

Return this exact shape:
{
  "lens": "...",
  "photoTheme": "...",
  "caption": "one or two sentences. plain. sounds like something you'd say at the gym.",
  "slides": [ ...5 slide objects... ]
}${directorNotes ? `\n\nDIRECTOR NOTES (address these in your revision):\n${directorNotes}` : ''}`;
}

// ── Campaign prompt ────────────────────────────────────────────
function buildPrompt(brain) {
  return `You are the content engine for CrossFit OTL (@crossfitotl), a CrossFit affiliate in North Richland Hills, TX run by Javier and Deanie Jaime.

BRAND VOICE (non-negotiable):
- Direct. Not preachy. Sounds like something a coach says after class.
- Personal first. Real names, real moments, real observations from this gym.
- Family-first audience: working adults, parents, 30s–50s. Not competitors.
- Never soft. "You've got this" is not OTL. "Here's why it worked" is.
- Credentialed. Every claim earns its place — mechanism, story, or number.
- ALL CAPS headlines. Short. Punchy. Unexpected. Bebas Neue energy.

OTL PHILOSOPHY:
${brain.philosophy}

OTL PEOPLE:
${brain.people}

OTL ORIGIN STORY:
${brain.originStory}

ACTIVE CAMPAIGN:
${brain.campaign}

---

CAROUSEL ASOP — FOLLOW THESE RULES:

1. Slide 1 is a HookSlide. Contrarian or bold claim. Creates curiosity gap. No explanation.
   - headline: the stop-scroll statement (2–6 words, ALL CAPS, Bebas Neue energy)
   - curiosity: short phrase in accent color above the headline (what they're missing if they don't swipe)
   - The contrarian hook outperforms the instructional hook every time.
   - Examples of strong hooks: "MOST PEOPLE QUIT IN 90 DAYS." / "YOUR GYM IS LYING TO YOU." / "RANDOM IS NOT A PROGRAM."

2. Slides 2–N are ValueSlides. One thing per slide. Numbered badge. One-liner nugget at bottom.
   - headline: the slide's single claim (short, ALL CAPS)
   - body: one to two sentences expanding the claim. Plain. Sounds like a coach.
   - nugget: the save-worthy one-liner at the bottom. Bold. Memorable. ≤10 words.
   - slideLabel: "SHIFT 01", "RULE 01", "REASON 01", etc. — consistent with the post's frame
   - variant "a" uses photo + text layout (use this for the MAJORITY of value slides).
   - variant "b" is type-dominant (oversized headline, no photo) — use for ONE slide maximum, when the headline is so strong it needs no visual support.
   - Default to "a" unless the slide's single claim is so punchy it carries the whole frame alone.

3. Last slide is CarouselCTA. Always. Fixed structure every carousel.
   - headline: optional, ties back to the post theme
   - cta.action: "Book a Free Intro" (or campaign-specific action)
   - cta.detail: "Link in bio · @crossfitotl"

SLIDE COUNT: 3 content slides + 1 CarouselCTA = 4 slides total. Never more than 5 content slides.

Do NOT use photo paths — leave photo as null on all slides. The pipeline assigns real photos automatically.

The "campaign" object is the SAME on every slide:
{
  "name": "<campaign name>",
  "hashtag": "#crossfitotl",
  "statement": "<bold 2–5 word statement>",
  "pull": "<1 sentence that earns the follow>",
  "article": { "title": "<post headline>", "byline": "CrossFit OTL · North Richland Hills, TX" }
}

Return valid JSON only — no markdown, no commentary:
{
  "format": "<hook|compilation|tutorial|comparison>",
  "photoTheme": "<workout|community|coaching|event|kids|lifestyle>",
  "caption": "one or two sentences. plain. sounds like something you'd say at the gym.",
  "slides": [ ...slide objects... ]
}${directorNotes ? `\n\nDIRECTOR NOTES — build the post around this:\n${directorNotes}` : ''}`;
}

// ── Single splash slide prompt ────────────────────────────────
function buildSinglePrompt(brain) {
  return `You are the content engine for CrossFit OTL (@crossfitotl), a CrossFit affiliate in North Richland Hills, TX.

ACTIVE CAMPAIGN:
${brain.campaign}

OTL PHILOSOPHY:
${brain.philosophy}

---

YOUR TASK: Write ONE high-impact splash slide for Instagram.

FORMAT: SplashSlide — a single cinematic image with a two-line contrasting headline.
- Line 1 (headline): solid white text — the setup or the truth
- Line 2 (subhead): stroke/outlined text — the punchline or the contrast

REFERENCE STYLE:
  "RESOLUTIONS FADE." / "STANDARDS DON'T."
  "THE PILL TREATS." / "CROSSFIT CURES."
  "EVERYONE STARTS." / "FEW STAY."

RULES:
- Short. Punchy. 2–5 words per line. Bebas Neue energy — ALL CAPS.
- The two lines must create tension or contrast — setup / resolution.
- Do NOT use Deanie's personal health story. Ever.
- This is a conviction post — not a story post.
- Photo: pick the most cinematic match for the emotional tone.

PHOTO OPTIONS:
- "assets/photos/training-crossfit.jpg" — grit, intensity, work
- "assets/photos/community.jpg" — people, together, warmth
- "assets/photos/family.jpg" — life outside the gym
- "assets/photos/lifestyle.jpg" — aspirational, real
- "assets/photos/built-different.jpg" — coaching, standard

Return ONLY valid JSON. No markdown. No explanation.

Shape:
{
  "caption": "1–2 sentence Instagram caption. Plain. Sounds like a coach, not a brand.",
  "slides": [
    {
      "template": "SplashSlide",
      "size": "4:5",
      "campaign": { "name": "<campaign name>", "hashtag": "#crossfitotl" },
      "photo": "<photo path>",
      "headline": "<LINE 1 — solid>",
      "subhead": "<LINE 2 — stroke outline>",
      "subheadStyle": "stroke",
      "world": "dark",
      "variant": "a"
    },
    {
      "template": "CTASlide",
      "size": "4:5",
      "campaign": { "name": "<campaign name>", "hashtag": "#crossfitotl", "statement": "<2–4 words>", "pull": "<1 sentence>", "article": { "title": "<post headline>", "byline": "@crossfitotl" } },
      "variant": "a",
      "headline": "<CTA headline — tied to the splash>",
      "subhead": "<CTA subhead>",
      "cta": { "action": "Book Your Free Intro", "detail": "Link in bio · @crossfitotl", "offer": "No commitment · No pressure" }
    }
  ]
}${directorNotes ? `\n\nDIRECTOR NOTES:\n${directorNotes}` : ''}`;
}

// ── Generate with Claude ──────────────────────────────────────
async function generatePost(brain, topic = null) {
  const client = new Anthropic({ apiKey: getEnv('ANTHROPIC_API_KEY') });
  const prompt = topic ? buildEducationalPrompt(brain, topic)
               : single ? buildSinglePrompt(brain)
               : buildPrompt(brain);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in response:\n' + raw);
  return JSON.parse(raw.slice(start, end + 1));
}

// ── Render slides via Puppeteer ───────────────────────────────
async function renderSlides(post, postDir, previewOnly = false) {
  let html = readFileSync(resolve(__dirname, 'render.html'), 'utf8');

  // Resolve photo paths: local paths → file:// URLs, HTTPS URLs pass through unchanged
  const slides = post.slides.map(slide => ({
    ...slide,
    photo: slide.photo
      ? (slide.photo.startsWith('http') ? slide.photo : `file://${resolve(__dirname, slide.photo)}`)
      : undefined,
  }));

  // Inject slide data
  html = html.replace(
    /<script id="slide-data" type="application\/json">[\s\S]*?<\/script>/,
    `<script id="slide-data" type="application/json">\n${JSON.stringify(slides, null, 2)}\n</script>`
  );

  // Inline CSS (file:// can't load these relatively; vendor JS stays as relative src — temp file lives in same dir)
  const tokensCss    = readFileSync(resolve(__dirname, 'otl-tokens.css'), 'utf8');
  const templatesCss = readFileSync(resolve(__dirname, 'templates.css'), 'utf8');
  html = html
    .replace('<style id="otl-tokens"></style>', `<style id="otl-tokens">\n${tokensCss}\n</style>`)
    .replace('<style id="otl-templates"></style>', `<style id="otl-templates">\n${templatesCss}\n</style>`);

  // Inline templates.jsx
  const templatesJs = readFileSync(resolve(__dirname, 'templates.jsx'), 'utf8');
  html = html.replace(
    '<script type="text/babel" src="templates.jsx"></script>',
    `<script type="text/babel">\n${templatesJs}\n</script>`
  );

  // Save preview HTML (permanent — used for Chrome MCP evaluation)
  const previewPath = resolve(postDir, 'preview.html');
  writeFileSync(previewPath, html, 'utf8');

  if (previewOnly) {
    process.stdout.write(`  ✓ Preview → file://${previewPath}\n`);
    return;
  }

  // Write temp file for Puppeteer render
  const tempPath = resolve(__dirname, `_render_${Date.now()}.html`);
  writeFileSync(tempPath, html, 'utf8');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--allow-file-access-from-files'],
  });

  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(err.message));
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.goto(`file://${tempPath}?print=1`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => document.fonts.ready);
    await page.waitForSelector('.print-page', { timeout: 15000 }).catch(async (e) => {
      const bodyHtml = await page.evaluate(() => document.body.innerHTML.slice(0, 800));
      if (consoleErrors.length) process.stderr.write(`  JS errors:\n${consoleErrors.map(m => '    ' + m).join('\n')}\n`);
      process.stderr.write(`  Body preview: ${bodyHtml}\n`);
      throw e;
    });
    await page.waitForFunction(
      () => [...document.querySelectorAll('img')].every(img => img.complete),
      { timeout: 15000 }
    );

    const failed = await page.evaluate(() =>
      [...document.querySelectorAll('img')]
        .filter(img => img.complete && img.naturalWidth === 0)
        .map(img => img.src)
    );
    if (failed.length) {
      process.stderr.write(`  ⚠️  ${failed.length} image(s) failed to load:\n`);
      failed.forEach(s => process.stderr.write(`     ${s}\n`));
    }

    await new Promise(r => setTimeout(r, 500));

    const printPages = await page.$$('.print-page');
    if (!printPages.length) throw new Error('No .print-page elements found');

    for (let i = 0; i < printPages.length; i++) {
      const outPath = resolve(postDir, `slide_${i + 1}.png`);
      await printPages[i].screenshot({ path: outPath, type: 'png' });
      process.stdout.write(`  ✓ slide ${i + 1}/${printPages.length}\n`);
    }
  } finally {
    await browser.close();
    try { (await import('fs')).unlinkSync(tempPath); } catch {}
  }
}

// ── Rerender existing post ────────────────────────────────────
// preview.html is always kept current by the server's rebuildPreview() before this runs.
// This function just runs Puppeteer on whatever preview.html contains.
function buildPreviewHtml(postDir) {
  // Build preview.html from scratch using slides.json + current assets.
  // Used when a post predates preview.html generation.
  const slidesPath = resolve(postDir, 'slides.json');
  if (!existsSync(slidesPath)) throw new Error(`No slides.json found in ${postDir} — use Regenerate`);
  const base = JSON.parse(readFileSync(slidesPath, 'utf8'));
  const slides = base.map(slide => ({
    ...slide,
    photo: slide.photo ? (slide.photo.startsWith('http') ? slide.photo : `file://${resolve(__dirname, slide.photo)}`) : undefined,
  }));
  let html = readFileSync(resolve(__dirname, 'render.html'), 'utf8');
  html = html.replace(
    /<script id="slide-data" type="application\/json">[\s\S]*?<\/script>/,
    `<script id="slide-data" type="application/json">\n${JSON.stringify(slides, null, 2)}\n</script>`
  );
  const tokensCss    = readFileSync(resolve(__dirname, 'otl-tokens.css'), 'utf8');
  const templatesCss = readFileSync(resolve(__dirname, 'templates.css'), 'utf8');
  const templatesJs  = readFileSync(resolve(__dirname, 'templates.jsx'), 'utf8');
  html = html
    .replace('<style id="otl-tokens"></style>', `<style id="otl-tokens">\n${tokensCss}\n</style>`)
    .replace('<style id="otl-templates"></style>', `<style id="otl-templates">\n${templatesCss}\n</style>`)
    .replace('<script type="text/babel" src="templates.jsx"></script>', `<script type="text/babel">\n${templatesJs}\n</script>`);
  writeFileSync(resolve(postDir, 'preview.html'), html, 'utf8');
}

async function rerenderPost(postDir) {
  const previewPath = resolve(postDir, 'preview.html');
  if (!existsSync(previewPath)) {
    process.stdout.write(`  No preview.html — building from slides.json…\n`);
    buildPreviewHtml(postDir);
  }

  let html = readFileSync(previewPath, 'utf8');

  // Always swap in current templates.jsx and templates.css so any changes take effect.
  const templatesJs  = readFileSync(resolve(__dirname, 'templates.jsx'), 'utf8');
  const templatesCss = readFileSync(resolve(__dirname, 'templates.css'), 'utf8');
  const tokensCss    = readFileSync(resolve(__dirname, 'otl-tokens.css'), 'utf8');

  html = html.replace(
    /(<script type="text\/babel">)\n[\s\S]*?(\n<\/script>)/,
    (_, open, close) => `${open}\n${templatesJs}${close}`
  );
  html = html.replace(
    /(<style id="otl-templates">)\n[\s\S]*?(\n<\/style>)/,
    (_, open, close) => `${open}\n${templatesCss}${close}`
  );
  html = html.replace(
    /(<style id="otl-tokens">)\n[\s\S]*?(\n<\/style>)/,
    (_, open, close) => `${open}\n${tokensCss}${close}`
  );

  const tempPath = resolve(__dirname, `_render_${Date.now()}.html`);
  writeFileSync(tempPath, html, 'utf8');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--allow-file-access-from-files'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.goto(`file://${tempPath}?print=1`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => document.fonts.ready);
    await page.waitForSelector('.print-page', { timeout: 15000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll('img')].every(img => img.complete),
      { timeout: 15000 }
    );
    await new Promise(r => setTimeout(r, 500));

    const printPages = await page.$$('.print-page');
    if (!printPages.length) throw new Error('No .print-page elements found');

    for (let i = 0; i < printPages.length; i++) {
      const outPath = resolve(postDir, `slide_${i + 1}.png`);
      await printPages[i].screenshot({ path: outPath, type: 'png' });
      process.stdout.write(`  ✓ slide ${i + 1}/${printPages.length}\n`);
    }
  } finally {
    await browser.close();
    try { (await import('fs')).unlinkSync(tempPath); } catch {}
  }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  // Rerender mode: skip Claude, just run Puppeteer on existing preview.html
  if (rerender) {
    const slugArg = get('--slug');
    const dateArg = get('--date') || date;
    if (!slugArg) throw new Error('--rerender requires --slug and --date');
    const postDir = resolve(__dirname, 'output', dateArg, slugArg);
    process.stdout.write(`▶ Rerendering ${dateArg}/${slugArg}\n`);
    await rerenderPost(postDir);
    process.stdout.write(`  ✓ Done\n`);
    return;
  }

  const isEducational = track === 'educational';
  const topic = isEducational ? pickTopic() : null;

  const effectiveSlug = get('--slug') || (isEducational
    ? `educational_${topic.id}_${date}`
    : single
    ? `${campaignSlug}_splash_${Date.now()}`
    : campaignSlug + '_' + Date.now());

  const postDir = resolve(__dirname, 'output', date, effectiveSlug);
  mkdirSync(postDir, { recursive: true });

  const label = isEducational ? `[educational: ${topic.id}]` : `[${campaignSlug}]`;
  process.stdout.write(`▶ ${date}/${effectiveSlug} ${label}\n`);

  process.stdout.write('  Loading brain...\n');
  const brain = loadBrain(isEducational ? 'none' : campaignSlug);

  if (isEducational) {
    process.stdout.write(`  Topic: "${topic.title}" — lens: ${topic.hook.split('.')[0]}\n`);
  }

  process.stdout.write('  Generating...\n');
  const post = await generatePost(brain, topic);
  // Normalize: Claude sometimes returns "type" instead of "template"
  for (const slide of post.slides) {
    if (!slide.template && slide.type) { slide.template = slide.type; delete slide.type; }
  }
  process.stdout.write(`  ✓ ${post.slides.length} slides\n`);
  if (post.lens) process.stdout.write(`  Lens: ${post.lens}\n`);

  // Assign real OTL photos from Cloudinary library — photo-library.js queries by tag
  const PHOTO_TEMPLATES = new Set(['HookSlide', 'ArticleCover', 'BoldStatement', 'CarouselCTA', 'ValueSlide']);
  const photoTheme = post.photoTheme || 'workout';
  process.stdout.write(`  Selecting photos from Cloudinary (theme: ${photoTheme})...\n`);

  // Shared set across all slides — no photo reused within one post
  const usedUrls = new Set();

  for (const slide of post.slides) {
    if (!PHOTO_TEMPLATES.has(slide.template) || slide.photo) continue;
    // ValueSlide variant "b" is type-dominant — no photo needed
    if (slide.template === 'ValueSlide' && slide.variant === 'b') continue;

    // Hook/CTA slides: need high-quality intensity shot regardless of text theme
    const isHero = slide.template === 'HookSlide' || slide.template === 'CarouselCTA';
    const slideTheme = isHero ? 'workout' : photoTheme;
    const minQ = isHero ? 4 : 3;

    // Auto-effect per template: cinematic for stop-scroll slides, editorial for content slides
    const defaultEffect = isHero ? 'portrait_blur' : (slide.variant === 'a' ? 'dramatic' : 'none');
    const slideEffect = slide.effect || defaultEffect;
    const url = await getPhotoForSlide({
      headline: slide.headline,
      theme: slideTheme,
      campaign: slide.campaign,
      minQuality: minQ,
      usedUrls,
      slot: isHero ? 'hook' : 'value',
      effect: slideEffect,
    }).catch(() => null);

    if (url) {
      // Store the raw Cloudinary URL (no transforms) so the server can re-apply effects later
      const rawUrl = url.includes('/upload/')
        ? url.replace(/\/upload\/(?:(?!v\d+\/|crossfit)[^/]+\/)+/, '/upload/')
        : url;
      slide.photo = url;
      slide.photoRaw = rawUrl;
      slide.photoSlot = isHero ? 'hook' : 'value';
      slide.photoEffect = slideEffect;
      process.stdout.write(`  ✓ ${slide.template}: photo assigned\n`);
    } else {
      // Last resort: Imagen 4 via Google API
      process.stdout.write(`  ↳ No library photo — generating via Imagen...\n`);
      const generated = await generateHookImage({
        headline: slide.headline,
        subhead: slide.subhead,
        campaign: slide.campaign,
        slug: effectiveSlug,
      }).catch(e => { process.stderr.write(`  ⚠️  Imagen failed: ${e.message}\n`); return null; });
      if (generated) slide.photo = generated;
    }
  }

  // Save slides.json for later rerender/photo-swap use
  writeFileSync(resolve(postDir, 'slides.json'), JSON.stringify(post.slides, null, 2), 'utf8');
  writeFileSync(resolve(postDir, 'caption.txt'), post.caption, 'utf8');

  // Preserve existing meta fields (notes, photoOverride) on regenerate
  let existingMeta = {};
  const existingMetaPath = resolve(postDir, 'meta.json');
  if (existsSync(existingMetaPath)) {
    try { existingMeta = JSON.parse(readFileSync(existingMetaPath, 'utf8')); } catch {}
  }
  writeFileSync(resolve(postDir, 'meta.json'), JSON.stringify({
    ...existingMeta,
    track,
    campaign: isEducational ? 'educational' : campaignSlug,
    topic: topic ? { id: topic.id, title: topic.title, lens: post.lens } : null,
    format: single ? 'single' : 'carousel',
    status: existingMeta.status || 'staged',
    generated: new Date().toISOString(),
  }, null, 2), 'utf8');

  if (previewOnly) {
    process.stdout.write('  Building preview...\n');
    await renderSlides(post, postDir, true);
    process.stdout.write(`\nPREVIEW READY → file://${resolve(postDir, 'preview.html')}\n`);
    return;
  }

  process.stdout.write('  Rendering...\n');
  await renderSlides(post, postDir);
  process.stdout.write(`  ✓ Done → ${postDir}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
