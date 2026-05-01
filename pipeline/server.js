#!/usr/bin/env node
// CrossFit OTL — Post Review Server
// Usage: node server.js  →  http://localhost:3001

import http from 'http';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { resolve, dirname, extname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { postToInstagram } from './post_to_instagram.js';
import { buildPhotoUrl, configureCloudinary } from './photo-library.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const NODE = process.execPath;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
};

// ── Load .env vars for child processes ────────────────────────
function loadDotenv() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
  );
}
const dotenvVars = loadDotenv();
const anthropic  = new Anthropic({ apiKey: dotenvVars.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY });
configureCloudinary(dotenvVars);

// ── Slide helpers ─────────────────────────────────────────────
function resolvePhoto(photo) {
  if (!photo) return undefined;
  if (photo.startsWith('file://') || photo.startsWith('http')) return photo;
  return `file://${resolve(__dirname, photo)}`;
}

function getBaseSlides(postDir) {
  const p = join(postDir, 'slides.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Merge base slides + per-slide overrides + global photo override → resolved for preview.html
function buildResolvedSlides(postDir) {
  const base = getBaseSlides(postDir);
  if (!base) return null;
  const meta = readMeta(postDir);
  const overrides = meta.slideOverrides || {};
  const globalPhoto = meta.photoOverride ? resolvePhoto(meta.photoOverride) : null;

  return base.map((slide, i) => {
    const ov = overrides[String(i)] || {};
    const merged = { ...slide, ...ov };
    // Resolve photo: per-slide override wins, then global, then original
    if (ov.photo !== undefined) {
      merged.photo = ov.photo === '' ? undefined : resolvePhoto(ov.photo);
    } else if (globalPhoto) {
      merged.photo = globalPhoto;
    } else {
      merged.photo = resolvePhoto(merged.photo);
    }
    return merged;
  });
}

// Rewrite the slide-data block in preview.html with current resolved slides
function rebuildPreview(postDir) {
  const slides = buildResolvedSlides(postDir);
  if (!slides) { console.error('[rebuildPreview] no slides for', postDir); return false; }
  const previewPath = join(postDir, 'preview.html');
  if (!existsSync(previewPath)) { console.error('[rebuildPreview] no preview.html at', previewPath); return false; }
  // Guard against corrupted files — a healthy preview.html is < 500KB
  const stat = statSync(previewPath);
  if (stat.size > 500 * 1024) {
    console.error(`[rebuildPreview] preview.html is corrupt (${Math.round(stat.size/1024)}KB) — deleting for clean rebuild`);
    unlinkSync(previewPath);
    return false;
  }
  let html = readFileSync(previewPath, 'utf8');
  const json = JSON.stringify(slides, null, 2);
  const RE = /(<script id="slide-data"[^>]*>)([\s\S]*?)(<\/script>)/;
  if (!RE.test(html)) { console.error('[rebuildPreview] slide-data block not found in preview.html'); return false; }
  // Use function replacement — safe against $ in JSON content
  const next = html.replace(RE, (_, open, _old, close) => `${open}\n${json}\n${close}`);
  writeFileSync(previewPath, next, 'utf8');
  return true;
}

// ── In-memory job log ─────────────────────────────────────────
const jobs = new Map();
let jobSeq = 0;

function spawnJob(cmd, args, env = {}) {
  const id = String(++jobSeq);
  const job = { done: false, ok: false, log: '' };
  jobs.set(id, job);

  const proc = spawn(cmd, args, {
    cwd: __dirname,
    env: { ...process.env, ...dotenvVars, ...env },
  });
  const append = d => { job.log += d.toString(); };
  proc.stdout.on('data', append);
  proc.stderr.on('data', append);
  proc.on('close', code => {
    job.done = true;
    job.ok = code === 0;
    if (!job.ok) job.log += `\nExited with code ${code}`;
  });
  return id;
}

// ── Helpers ───────────────────────────────────────────────────
function readMeta(postDir) {
  const p = join(postDir, 'meta.json');
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeMeta(postDir, data) {
  writeFileSync(join(postDir, 'meta.json'), JSON.stringify(data, null, 2), 'utf8');
}
function postDir(date, slug) {
  return resolve(__dirname, 'output', date, slug);
}
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Collect posts ─────────────────────────────────────────────
const STATUS_RANK = { approved: 0, rendered: 1, staged: 2, posted: 3 };

function collectPosts() {
  const outDir = resolve(__dirname, 'output');
  const posts = [];
  if (!existsSync(outDir)) return posts;

  for (const dateDir of readdirSync(outDir, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name).sort().reverse()) {
    const dp = join(outDir, dateDir);
    for (const slug of readdirSync(dp, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name).sort().reverse()) {
      const pp = join(dp, slug);
      if (!existsSync(join(pp, 'meta.json'))) continue;

      const meta = readMeta(pp);
      if (meta.status === 'cancelled') continue;
      // Hide posted posts older than 7 days
      if (meta.status === 'posted' && meta.postedAt) {
        const age = Date.now() - new Date(meta.postedAt).getTime();
        if (age > 7 * 24 * 60 * 60 * 1000) continue;
      }

      let caption = '';
      try { caption = readFileSync(join(pp, 'caption.txt'), 'utf8').trim(); } catch {}

      let slideCount = 0;
      while (existsSync(join(pp, `slide_${slideCount + 1}.png`))) slideCount++;

      // Slide templates + overlay opacities + effects for per-slide controls
      let slideTemplates = [];
      let slideOverlayOpacities = [];
      let slideEffects = [];
      try {
        const base = JSON.parse(readFileSync(join(pp, 'slides.json'), 'utf8'));
        const ov = (readMeta(pp).slideOverrides) || {};
        slideTemplates = base.map((s, i) => (ov[String(i)]?.template || s.template || ''));
        slideOverlayOpacities = base.map((s, i) => {
          const ovVal = ov[String(i)]?.overlayOpacity;
          return ovVal != null ? ovVal : null;
        });
        slideEffects = base.map((s, i) => ov[String(i)]?.photoEffect || s.photoEffect || 'none');
      } catch {}

      // Available photos for picker
      const photosDir = resolve(__dirname, 'assets', 'photos');
      const photos = existsSync(photosDir)
        ? readdirSync(photosDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f))
        : [];

      // Derive effective status for sorting
      const hasRendered = slideCount > 0;
      const effectiveStatus = meta.status === 'approved' ? 'approved'
        : meta.status === 'posted'   ? 'posted'
        : hasRendered                ? 'rendered'
        : 'staged';

      posts.push({
        date: dateDir, slug, meta, caption,
        hasPreview: existsSync(join(pp, 'preview.html')),
        hasRendered,
        slideCount,
        photos,
        slideTemplates,
        slideOverlayOpacities,
        slideEffects,
        effectiveStatus,
        generatedAt: meta.generated ? new Date(meta.generated).getTime() : 0,
      });
    }
  }

  // Sort: approved first → rendered → staged → posted; newest first within each group
  posts.sort((a, b) => {
    const rankDiff = (STATUS_RANK[a.effectiveStatus] ?? 2) - (STATUS_RANK[b.effectiveStatus] ?? 2);
    if (rankDiff !== 0) return rankDiff;
    return b.generatedAt - a.generatedAt;
  });

  return posts;
}

// ── Status styling ────────────────────────────────────────────
function statusBadge(meta) {
  const s = meta.status || 'staged';
  if (s === 'posted')   return `<span class="badge posted">POSTED ✓</span>`;
  if (s === 'approved') return `<span class="badge approved">APPROVED ✓</span>`;
  if (s === 'rendered') return `<span class="badge rendered">RENDERED</span>`;
  return `<span class="badge staged">STAGED</span>`;
}

// ── Queue HTML ────────────────────────────────────────────────
function buildQueueHtml(posts) {
  const total    = posts.length;
  const posted   = posts.filter(p => p.meta.status === 'posted').length;
  const approved = posts.filter(p => p.meta.status === 'approved').length;
  const rendered = posts.filter(p => p.hasRendered && !['posted','approved'].includes(p.meta.status)).length;
  const staged   = posts.filter(p => !p.hasRendered).length;

  const cards = posts.map(p => {
    const { date, slug, meta, caption, hasRendered, slideCount, hasPreview, photos, slideTemplates = [], slideOverlayOpacities = [], slideEffects = [] } = p;

    const trackBadge = meta.track === 'educational'
      ? `<span class="badge edu">EDUCATIONAL</span>`
      : `<span class="badge camp">CAMPAIGN</span>`;

    const topicLine = meta.topic
      ? `<div class="topic">${esc(meta.topic.title)}${meta.topic.lens
          ? ` <em>· ${esc(meta.topic.lens.split('—')[0].trim())}</em>`
          : ''}</div>`
      : '';

    const captionHtml = caption
      ? `<p class="cap">${esc(caption.slice(0, 140))}${caption.length > 140 ? '…' : ''}</p>`
      : '';

    // Build slide URLs array for inline navigation
    const slideUrls = hasRendered
      ? Array.from({ length: slideCount }, (_, i) =>
          `/output/${date}/${slug}/slide_${i + 1}.png`)
      : [];
    const slideUrlsJson      = JSON.stringify(slideUrls);
    const slideTemplatesJson = JSON.stringify(slideTemplates);

    const thumb = hasRendered
      ? `<img class="thumb" id="thumb-${date}-${slug}"
            src="/output/${date}/${slug}/slide_1.png" loading="lazy">`
      : `<div class="thumb no-thumb">PREVIEW ONLY</div>`;

    const photoOpts = photos.map(f =>
      `<img class="photo-opt ${meta.photoOverride === `assets/photos/${f}` ? 'selected' : ''}"
        src="/assets/photos/${f}" title="${f}"
        onclick="setPhoto('${date}','${slug}','assets/photos/${f}',this)">`
    ).join('');

    const notes = meta.notes || '';

    const ago = meta.generated
      ? new Date(meta.generated).toLocaleDateString('en-US',
          { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    const isPosted   = meta.status === 'posted';
    const isApproved = meta.status === 'approved';

    return `
<div class="card ${meta.track === 'educational' ? 'is-edu' : 'is-camp'} ${isPosted ? 'is-posted' : ''}"
     data-date="${date}" data-slug="${slug}">

  <div class="card-img" data-slides='${slideUrlsJson}' data-templates='${slideTemplatesJson}' data-idx="0"
       data-date="${date}" data-slug="${slug}">
    ${thumb}
    ${hasRendered && slideCount > 1 ? `
      <button class="nav-btn nav-prev" onclick="slideNav(this.closest('.card-img'),-1)">&#8249;</button>
      <button class="nav-btn nav-next" onclick="slideNav(this.closest('.card-img'),1)">&#8250;</button>
      <span class="sc" id="sc-${date}-${slug}">1 / ${slideCount}</span>
    ` : slideCount === 1 ? `<span class="sc">1 / 1</span>` : ''}
    ${!isPosted ? `<button class="cancel-btn" onclick="cancelPost('${date}','${slug}',this)" title="Remove">✕</button>` : ''}
  </div>

  <!-- Per-slide toolbar — updates as you navigate slides -->
  <div class="slide-bar" id="sbar-${date}-${slug}"
       data-ovl-opacities='${JSON.stringify(slideOverlayOpacities)}'
       data-effects='${JSON.stringify(slideEffects)}'>
    <span class="sbar-num">Slide 1</span>
    <span class="sbar-tmpl">${slideTemplates[0] || ''}</span>
    <div class="sbar-actions">
      <button class="sbar-btn" onclick="slideAction('text-only','${date}','${slug}')">Text only</button>
      <button class="sbar-btn" onclick="slideAction('restore-photo','${date}','${slug}')">Restore photo</button>
      <button class="sbar-btn sbar-edit" id="edit-${date}-${slug}"
        onclick="toggleSlideEdit('${date}','${slug}',this)">✎ Edit text</button>
      <button class="sbar-btn sbar-gen" id="genimg-${date}-${slug}"
        onclick="generateImage('${date}','${slug}',this)">✦ Generate image</button>
    </div>
    <div class="sbar-overlay-row">
      <span class="sbar-font-label">World</span>
      <button class="sbar-btn sbar-ovl" id="ovl-${date}-${slug}" data-ovl="dark"
        onclick="toggleWorld('${date}','${slug}',this)">Dark</button>
      <span class="sbar-font-label" style="margin-left:8px">Line 2</span>
      <button class="sbar-btn sbar-sub-style" id="substyle-${date}-${slug}" data-style="stroke"
        onclick="cycleSubheadStyle('${date}','${slug}',this)">Stroke</button>
    </div>
    <div class="sbar-ovl-slider-row">
      <span class="sbar-font-label">Overlay</span>
      <input type="range" class="sbar-ovl-slider" id="ovlslider-${date}-${slug}"
        min="0" max="100" value="${Math.round((slideOverlayOpacities[0] ?? 0.62) * 100)}" step="1"
        oninput="previewOverlay('${date}','${slug}',this)"
        onchange="saveOverlay('${date}','${slug}',this)">
      <span class="sbar-ovl-val" id="ovlval-${date}-${slug}">${Math.round((slideOverlayOpacities[0] ?? 0.62) * 100)}%</span>
    </div>
    <div class="sbar-font-row">
      <span class="sbar-font-label">H</span>
      <button class="sbar-font-btn" onclick="adjustFont('${date}','${slug}','headlineFontScale',-0.1)">−</button>
      <button class="sbar-font-btn" onclick="adjustFont('${date}','${slug}','headlineFontScale',0.1)">+</button>
      <span class="sbar-font-label" style="margin-left:8px">B</span>
      <button class="sbar-font-btn" onclick="adjustFont('${date}','${slug}','subheadFontScale',-0.1)">−</button>
      <button class="sbar-font-btn" onclick="adjustFont('${date}','${slug}','subheadFontScale',0.1)">+</button>
    </div>
    <div class="sbar-effect-row" id="sbar-effect-${date}-${slug}">
      <span class="sbar-font-label" style="min-width:40px">FX</span>
      <div class="effect-btns">
        ${['none','portrait_blur','portrait_black','portrait_bw_blur','black_and_white','dramatic','art_noir','vignette','remove_bg'].map(fx => {
          const labels = { none:'Original', portrait_blur:'Blur BG', portrait_black:'Black BG', portrait_bw_blur:'B&W Blur', black_and_white:'B&W', dramatic:'Dramatic', art_noir:'Noir', vignette:'Vignette', remove_bg:'No BG' };
          const active = (slideEffects[0] || 'none') === fx ? ' fx-active' : '';
          return `<button class="fx-btn${active}" data-fx="${fx}" onclick="setEffect('${date}','${slug}','${fx}',this)">${labels[fx]}</button>`;
        }).join('')}
      </div>
    </div>
  </div>
  <!-- Image direction input -->
  <div class="img-dir-row" id="imgdir-${date}-${slug}">
    <input class="img-dir-input" id="imgdir-txt-${date}-${slug}"
      type="text" placeholder="Image direction (optional) — e.g. 'surgical tools on dark surface' or 'empty gym at dawn'">
  </div>
  <!-- Per-slide text editor -->
  <div class="slide-edit-row" id="sedit-${date}-${slug}" style="display:none">
    <div class="sedit-field">
      <label class="sedit-lbl">Headline</label>
      <textarea class="sedit-ta" id="sedit-h-${date}-${slug}" rows="2" placeholder="Headline…"></textarea>
    </div>
    <div class="sedit-field">
      <label class="sedit-lbl">Subhead</label>
      <textarea class="sedit-ta" id="sedit-s-${date}-${slug}" rows="2" placeholder="Subhead / body text…"></textarea>
    </div>
    <div class="sedit-actions">
      <button class="btn-sedit-save" onclick="saveSlideText('${date}','${slug}',this)">Save text</button>
      <button class="btn-sedit-clear" onclick="clearSlideText('${date}','${slug}',this)">Clear overrides</button>
    </div>
  </div>
  <!-- Per-slide rework instruction -->
  <div class="slide-rework-row" id="srw-${date}-${slug}">
    <textarea class="rework-box" id="srw-txt-${date}-${slug}"
      placeholder="Rework this slide — e.g. 'stronger headline' or 'focus on Deanie's surgery story'"></textarea>
    <button class="btn-rework" onclick="reworkSlide('${date}','${slug}',this)">Rework slide →</button>
  </div>

  <div class="card-body">
    <div class="badges">${trackBadge}${statusBadge(meta)}</div>
    <div class="campaign">${esc(meta.campaign || slug)}</div>
    ${topicLine}
    ${captionHtml}

    <!-- Caption editor -->
    <div class="section-toggle" onclick="toggleSection(this,'cap-${date}-${slug}')">
      Caption ${caption ? '●' : '+'}</div>
    <div class="section" id="cap-${date}-${slug}" style="display:none">
      <textarea class="notes-box cap-box" id="cap-txt-${date}-${slug}" rows="4"
        placeholder="Instagram caption…"
        onblur="saveCaption('${date}','${slug}',this.value)">${esc(caption)}</textarea>
    </div>

    <!-- Post-level notes -->
    <div class="section-toggle" onclick="toggleSection(this,'notes-${date}-${slug}')">
      Post notes ${notes ? '●' : '+'}</div>
    <div class="section" id="notes-${date}-${slug}" ${notes ? '' : 'style="display:none"'}>
      <textarea class="notes-box" placeholder="Change something, fix this, try a different angle…"
        onblur="saveNotes('${date}','${slug}',this.value)">${esc(notes)}</textarea>
    </div>

    <!-- Per-slide photo picker -->
    <div class="section-toggle" onclick="toggleSection(this,'photos-${date}-${slug}')">
      Slide photo +</div>
    <div class="section photo-grid" id="photos-${date}-${slug}" style="display:none">
      <div class="photo-opts" id="photo-opts-${date}-${slug}">${photoOpts.replace(/onclick="setPhoto\(/g, `onclick="setSlidePhoto(`)}</div>
      <div class="upload-row">
        <label class="upload-btn">
          + Add photo
          <input type="file" accept="image/*" style="display:none"
            onchange="uploadPhoto('${date}','${slug}',this)">
        </label>
      </div>
    </div>

    <div class="card-actions">
      ${!isPosted && !isApproved ? `
        <button class="btn-action" onclick="runJob('render','${date}','${slug}',this)">Render</button>
        <button class="btn-action" onclick="runJob('regenerate','${date}','${slug}',this)">Regenerate</button>
        ${hasRendered ? `<button class="btn-action btn-approve" onclick="markStatus('${date}','${slug}','approved',this)">Approve ✓</button>` : ''}
      ` : ''}
      ${isApproved ? `
        <button class="btn-action" onclick="runJob('regenerate','${date}','${slug}',this)">Regenerate</button>
        <button class="btn-action btn-post-ig" id="igpost-${date}-${slug}"
          onclick="postToIG('${date}','${slug}',this)">▶ Post to Instagram</button>
        <button class="btn-action btn-post" onclick="markStatus('${date}','${slug}','posted',this)">Mark Posted</button>
      ` : ''}
      ${hasPreview ? `<a class="btn-preview" href="/output/${date}/${slug}/preview.html" target="_blank">Preview →</a>` : ''}
    </div>

    <div class="job-status" id="job-${date}-${slug}"></div>
    <div class="card-date">${ago}</div>
  </div>
</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OTL Post Queue</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#ddd;font-family:-apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh}

header{background:#111;border-bottom:1px solid #1e1e1e;padding:18px 28px;position:sticky;top:0;z-index:9;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.logo{font-size:15px;font-weight:700;color:#fff;letter-spacing:.05em;white-space:nowrap}
.logo span{color:#003566}
.stats{display:flex;gap:18px;margin-left:auto}
.stat{text-align:center;min-width:40px}
.sn{font-size:18px;font-weight:700;color:#fff;line-height:1}
.sl{font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-top:1px}
.filters{display:flex;gap:5px}
.fb{background:#161616;border:1px solid #252525;color:#777;padding:5px 11px;border-radius:4px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;transition:.15s}
.fb:hover,.fb.on{background:#003566;border-color:#003566;color:#fff}

main{padding:24px 28px;max-width:1400px;margin:0 auto}
.empty{text-align:center;padding:80px;color:#333;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}

.card{background:#111;border:1px solid #1e1e1e;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .15s}
.card:hover{border-color:#2a2a2a}
.is-edu{border-left:3px solid #003566}
.is-camp{border-left:3px solid #5a1010}
.is-posted{opacity:.55}
.is-posted .card-img{filter:grayscale(.4)}

.card-img{position:relative;aspect-ratio:4/5;background:#0d0d0d;overflow:hidden;flex-shrink:0}
.thumb{width:100%;height:100%;object-fit:cover;display:block}
.no-thumb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#252525;font-size:9px;letter-spacing:.12em}
.sc{position:absolute;bottom:7px;right:7px;background:rgba(0,0,0,.8);color:#999;font-size:9px;padding:2px 6px;border-radius:3px;pointer-events:none}
.nav-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.6);border:none;color:#fff;font-size:28px;line-height:1;width:32px;height:48px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;z-index:2}
.card-img:hover .nav-btn{opacity:1}
.nav-btn:hover{background:rgba(0,0,0,.85)}
.nav-prev{left:0;border-radius:0 4px 4px 0}
.nav-next{right:0;border-radius:4px 0 0 4px}
.cancel-btn{position:absolute;top:7px;right:7px;background:rgba(0,0,0,.7);border:none;color:#666;width:22px;height:22px;border-radius:50%;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
.cancel-btn:hover{background:rgba(200,40,40,.8);color:#fff}

.card-body{padding:13px;display:flex;flex-direction:column;gap:7px;flex:1}
.badges{display:flex;gap:4px;flex-wrap:wrap}
.badge{font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:2px 6px;border-radius:3px}
.badge.edu{background:#001428;color:#3a7ab8}
.badge.camp{background:#1e0808;color:#8b4040}
.badge.staged{background:#1a1a08;color:#777733}
.badge.rendered{background:#0d1a0d;color:#3d883d}
.badge.approved{background:#0a1a22;color:#5599bb}
.badge.posted{background:#061828;color:#2277aa}
.campaign{font-size:11px;font-weight:600;color:#ccc;text-transform:uppercase;letter-spacing:.05em}
.topic{font-size:11px;color:#3a7ab8;line-height:1.4}
.topic em{color:#557799;font-style:normal}
.cap{font-size:12px;color:#666;line-height:1.5}

.section-toggle{font-size:10px;color:#444;cursor:pointer;user-select:none;letter-spacing:.06em;text-transform:uppercase;padding:2px 0;transition:.15s}
.section-toggle:hover{color:#888}
.section{margin-top:4px}
.notes-box{width:100%;background:#0d0d0d;border:1px solid #222;border-radius:4px;color:#bbb;font-size:12px;padding:8px;resize:vertical;min-height:60px;font-family:inherit;line-height:1.5}
.notes-box:focus{outline:none;border-color:#003566}
.cap-box{min-height:80px;font-size:12px;line-height:1.55;color:#ccc}
.photo-grid{margin-top:4px}
.photo-opts{display:flex;gap:5px;flex-wrap:wrap}
.photo-opt{width:52px;height:52px;object-fit:cover;border-radius:3px;cursor:pointer;border:2px solid transparent;transition:.15s;opacity:.6}
.photo-opt:hover{opacity:1;border-color:#555}
.photo-opt.selected{border-color:#003566;opacity:1}
.slide-bar{display:flex;align-items:center;gap:7px;padding:7px 13px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;flex-wrap:wrap}
.sbar-num{font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.sbar-tmpl{font-size:9px;color:#333;letter-spacing:.06em;flex:1}
.sbar-actions{display:flex;gap:5px;margin-left:auto}
.sbar-btn{font-size:9px;background:#161616;border:1px solid #252525;color:#666;padding:3px 8px;border-radius:3px;cursor:pointer;letter-spacing:.06em;text-transform:uppercase;transition:.15s}
.sbar-btn:hover{background:#1e1e1e;color:#aaa;border-color:#333}
.sbar-btn:disabled{opacity:.4;cursor:default}
.sbar-gen{border-color:#2a1a40;color:#8866bb}
.sbar-gen:hover{background:#1a0d2e;color:#aa88dd;border-color:#4a2a70}
.sbar-edit{border-color:#1a2a1a;color:#558855}
.sbar-edit:hover{background:#0d1a0d;color:#77bb77;border-color:#2a4a2a}
.sbar-edit.active{background:#0d1a0d;color:#77bb77;border-color:#2a4a2a}
.sbar-overlay-row{display:flex;align-items:center;gap:5px;margin-left:auto;padding-left:10px;border-left:1px solid #222}
.sbar-ovl{min-width:38px;text-align:center}
.sbar-ovl.is-light{border-color:#3a3a2a;color:#dddd88;background:#1a1a0a}
.sbar-ovl.is-none{border-color:#2a2a2a;color:#888;background:#111}
.sbar-sub-style{min-width:44px;text-align:center}
.sbar-sub-style.is-color{border-color:#2a1a40;color:#8866bb;background:#1a0d2e}
.sbar-sub-style.is-solid{border-color:#1a3a1a;color:#558855;background:#0d1a0d}

.new-post-btn{background:#003566;border:1px solid #0055a0;color:#fff;padding:6px 14px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;transition:.15s;white-space:nowrap}
.new-post-btn:hover{background:#0055a0}
.new-post-panel{display:none;position:absolute;top:100%;right:0;background:#111;border:1px solid #252525;border-radius:6px;padding:16px;min-width:300px;z-index:20;flex-direction:column;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,.6)}
.new-post-panel.open{display:flex}
.np-label{font-size:9px;font-weight:700;color:#555;letter-spacing:.09em;text-transform:uppercase}
.np-select,.np-input{width:100%;background:#0d0d0d;border:1px solid #252525;border-radius:4px;color:#ccc;font-size:12px;padding:7px 9px;font-family:inherit}
.np-select:focus,.np-input:focus{outline:none;border-color:#003566}
.np-select option{background:#111}
.np-row{display:flex;gap:8px;align-items:center}
.np-check{accent-color:#003566}
.np-check-label{font-size:11px;color:#888;cursor:pointer}
.np-btn{background:#003566;border:none;color:#fff;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:8px 16px;border-radius:4px;cursor:pointer;transition:.15s;flex:1}
.np-btn:hover{background:#0055a0}
.np-btn:disabled{opacity:.4;cursor:default}
.np-status{font-size:10px;color:#556;min-height:12px}
.sbar-ovl-slider-row{display:flex;align-items:center;gap:7px;padding:5px 13px 6px;background:#0a0a0a;border-top:1px solid #1a1a1a}
.sbar-ovl-slider{flex:1;accent-color:#003566;height:3px;cursor:pointer}
.sbar-ovl-val{font-size:9px;font-weight:700;color:#555;letter-spacing:.06em;min-width:28px;text-align:right}
.sbar-font-row{display:flex;align-items:center;gap:3px;padding-left:10px;border-left:1px solid #222}
.sbar-font-label{font-size:9px;font-weight:700;color:#444;letter-spacing:.08em;text-transform:uppercase}
.sbar-font-btn{width:20px;height:20px;background:#161616;border:1px solid #252525;color:#666;border-radius:3px;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
.sbar-font-btn:hover{background:#222;color:#ccc;border-color:#444}
.sbar-effect-row{display:flex;align-items:flex-start;gap:7px;padding:7px 13px 8px;background:#0a0a0a;border-top:1px solid #1a1a1a;flex-wrap:wrap}
.effect-btns{display:flex;flex-wrap:wrap;gap:4px;flex:1}
.fx-btn{padding:3px 8px;background:#111;border:1px solid #252525;color:#555;border-radius:3px;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;transition:.15s}
.fx-btn:hover{background:#1a1a1a;color:#aaa;border-color:#444}
.fx-btn.fx-active{background:#0d0d2a;border-color:#003566;color:#6699ff}
.img-dir-row{padding:5px 13px 8px;background:#0d0d0d;border-bottom:1px solid #1a1a1a}
.img-dir-input{width:100%;background:#111;border:1px solid #222;border-radius:4px;color:#bbb;font-size:11px;padding:6px 9px;font-family:inherit;letter-spacing:.02em}
.img-dir-input::placeholder{color:#333}
.img-dir-input:focus{outline:none;border-color:#2a1a40}
.slide-edit-row{padding:10px 13px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;display:flex;flex-direction:column;gap:8px}
.sedit-field{display:flex;flex-direction:column;gap:3px}
.sedit-lbl{font-size:9px;font-weight:700;color:#444;letter-spacing:.08em;text-transform:uppercase}
.sedit-ta{background:#111;border:1px solid #222;border-radius:4px;color:#ccc;font-size:12px;padding:7px 9px;resize:vertical;font-family:inherit;line-height:1.4;min-height:36px}
.sedit-ta:focus{outline:none;border-color:#2a4a2a}
.sedit-actions{display:flex;gap:6px;margin-top:2px}
.btn-sedit-save{background:#003566;border:none;color:#fff;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:6px 12px;border-radius:4px;cursor:pointer;transition:.15s}
.btn-sedit-save:hover{background:#0055a0}
.btn-sedit-save:disabled{opacity:.4;cursor:default}
.btn-sedit-clear{background:none;border:1px solid #2a2a2a;color:#555;font-size:10px;letter-spacing:.07em;text-transform:uppercase;padding:6px 10px;border-radius:4px;cursor:pointer;transition:.15s}
.btn-sedit-clear:hover{color:#aaa;border-color:#444}
.slide-photo-row{padding:8px 13px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;display:none}
.slide-rework-row{padding:8px 13px;background:#0d0d0d;border-bottom:1px solid #1e1e1e;display:flex;gap:6px;align-items:flex-start}
.rework-box{flex:1;background:#111;border:1px solid #222;border-radius:4px;color:#bbb;font-size:12px;padding:7px;resize:none;height:48px;font-family:inherit;line-height:1.4}
.rework-box:focus{outline:none;border-color:#003566}
.btn-rework{background:#003566;border:none;color:#fff;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:7px 11px;border-radius:4px;cursor:pointer;white-space:nowrap;transition:.15s;align-self:stretch}
.btn-rework:hover{background:#0055a0}
.btn-rework:disabled{opacity:.4;cursor:default}
.upload-row{display:flex;align-items:center;gap:10px;margin-top:6px}
.upload-btn{font-size:10px;color:#556;border:1px dashed #2a2a2a;border-radius:4px;padding:5px 10px;cursor:pointer;letter-spacing:.06em;text-transform:uppercase;transition:.15s;white-space:nowrap}
.upload-btn:hover{border-color:#003566;color:#3a7ab8}
.upload-btn.uploading{color:#777733;border-color:#333;pointer-events:none}
.clear-btn{font-size:9px;color:#555;background:none;border:none;cursor:pointer;padding:3px 0;letter-spacing:.06em;text-transform:uppercase}
.clear-btn:hover{color:#aaa}

.card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}
.btn-action{background:#1a1a1a;border:1px solid #2a2a2a;color:#aaa;padding:5px 10px;border-radius:4px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;cursor:pointer;transition:.15s}
.btn-action:hover{background:#222;color:#fff;border-color:#444}
.btn-action:disabled{opacity:.4;cursor:default}
.btn-approve{border-color:#1a4a1a;color:#3d883d}
.btn-approve:hover{background:#0d1a0d;color:#5daa5d}
.btn-post{border-color:#003566;color:#3a7ab8}
.btn-post:hover{background:#001428;color:#5599cc}
.btn-post-ig{background:#003566;border-color:#0055a0;color:#fff;font-weight:700}
.btn-post-ig:hover{background:#0055a0}
.btn-post-ig:disabled{opacity:.5;cursor:default}
.btn-preview{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:5px 10px;border-radius:4px;text-decoration:none;background:#161616;border:1px solid #2a2a2a;color:#888;margin-left:auto;transition:.15s}
.btn-preview:hover{background:#003566;border-color:#003566;color:#fff}

.job-status{font-size:10px;color:#556;min-height:14px;white-space:pre-wrap;line-height:1.4;margin-top:2px}
.job-status.running{color:#3a7ab8;animation:pulse 1.5s infinite}
.job-status.ok{color:#3d883d}
.job-status.err{color:#883333}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.card-date{font-size:9px;color:#2a2a2a;margin-top:2px}

footer{text-align:center;padding:40px;color:#1e1e1e;font-size:10px}
</style>
</head>
<body>

<header>
  <div class="logo"><span>@crossfitotl</span> Post Queue</div>
  <div class="stats">
    <div class="stat"><div class="sn">${total}</div><div class="sl">Total</div></div>
    <div class="stat"><div class="sn" style="color:#777733">${staged}</div><div class="sl">Staged</div></div>
    <div class="stat"><div class="sn" style="color:#3d883d">${rendered}</div><div class="sl">Rendered</div></div>
    <div class="stat"><div class="sn" style="color:#5599bb">${approved}</div><div class="sl">Approved</div></div>
    <div class="stat"><div class="sn" style="color:#2277aa">${posted}</div><div class="sl">Posted</div></div>
  </div>
  <div class="filters">
    <button class="fb on" onclick="filter('all',this)">All</button>
    <button class="fb" onclick="filter('edu',this)">Educational</button>
    <button class="fb" onclick="filter('camp',this)">Campaign</button>
    <button class="fb" onclick="filter('staged',this)">Staged</button>
    <button class="fb" onclick="filter('rendered',this)">Rendered</button>
    <button class="fb" onclick="filter('approved',this)">Approved</button>
    <button class="fb" onclick="filter('posted',this)">Posted</button>
    <div style="position:relative;margin-left:8px">
      <button class="new-post-btn" onclick="toggleNewPost(this)">+ New Post</button>
      <div class="new-post-panel" id="new-post-panel">
        <div class="np-label">Track</div>
        <div class="np-row">
          <select class="np-select" id="np-track" onchange="toggleNpCampaign()">
            <option value="campaign">Campaign</option>
            <option value="educational">Educational</option>
          </select>
        </div>
        <div id="np-campaign-row">
          <div class="np-label" style="margin-top:4px">Campaign</div>
          <select class="np-select" id="np-campaign">
            <option value="crossfit-is-the-cure">CrossFit Is the Cure</option>
            <option value="forging-elite-fitness">Forging Elite Fitness</option>
            <option value="join-our-culture">Join Our Culture</option>
            <option value="the-crossfit-effect">The CrossFit Effect</option>
            <option value="this-is-crossfit">This Is CrossFit</option>
            <option value="share-your-stories">Share Your Stories</option>
          </select>
        </div>
        <div class="np-row" style="margin-top:4px">
          <input type="checkbox" class="np-check" id="np-single">
          <label class="np-check-label" for="np-single">Single splash slide (SplashSlide format)</label>
        </div>
        <div class="np-label" style="margin-top:4px">Notes (optional)</div>
        <textarea class="np-input" id="np-notes" rows="2" placeholder="e.g. focus on InBody data, feature Javier…" style="resize:vertical"></textarea>
        <div class="np-row" style="gap:6px">
          <button class="np-btn" onclick="submitNewPost(this)">Generate</button>
          <button class="np-btn" style="background:#222;flex:.4" onclick="toggleNewPost(document.querySelector('.new-post-btn'))">Cancel</button>
        </div>
        <div class="job-status" id="np-status"></div>
      </div>
    </div>
  </div>
</header>

<main>
  ${total === 0
    ? '<div class="empty">No posts yet.<br><br>Run: <code>node generate.js --track educational --preview</code></div>'
    : `<div class="grid" id="grid">${cards}</div>`}
</main>

<footer>localhost:${PORT} · refreshes on load</footer>

<script>
// ── Filter ────────────────────────────────────────────────────
function filter(type, btn) {
  document.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.querySelectorAll('.card').forEach(c => {
    const show =
      type === 'all'      ? true :
      type === 'edu'      ? c.classList.contains('is-edu') :
      type === 'camp'     ? c.classList.contains('is-camp') :
      type === 'posted'   ? !!c.querySelector('.badge.posted') :
      type === 'approved' ? !!c.querySelector('.badge.approved') :
      type === 'rendered' ? !!c.querySelector('.badge.rendered') :
      type === 'staged'   ? !!c.querySelector('.badge.staged') : true;
    c.style.display = show ? '' : 'none';
  });
}

// ── Slide navigation ──────────────────────────────────────────
function slideNav(imgBox, dir) {
  const slides    = JSON.parse(imgBox.dataset.slides    || '[]');
  const templates = JSON.parse(imgBox.dataset.templates || '[]');
  if (!slides.length) return;
  let idx = (parseInt(imgBox.dataset.idx || '0') + dir + slides.length) % slides.length;
  imgBox.dataset.idx = idx;

  const img = imgBox.querySelector('img.thumb');
  if (img) img.src = slides[idx] + '?t=' + Date.now();
  const sc = imgBox.querySelector('.sc');
  if (sc) sc.textContent = (idx + 1) + ' / ' + slides.length;

  // Update per-slide toolbar
  const date = imgBox.dataset.date, slug = imgBox.dataset.slug;
  const sbar = document.getElementById(\`sbar-\${date}-\${slug}\`);
  if (sbar) {
    sbar.querySelector('.sbar-num').textContent = 'Slide ' + (idx + 1);
    sbar.querySelector('.sbar-tmpl').textContent = templates[idx] || '';
    sbar.dataset.slideIdx = idx;

    // Show Line 2 / subheadStyle control for any template with a headline
    const substyleBtn = document.getElementById(\`substyle-\${date}-\${slug}\`);
    const substyleRow = substyleBtn?.closest('.sbar-overlay-row')?.querySelector('.sbar-font-label:last-of-type');
    if (substyleBtn) {
      const SUBHEAD_TEMPLATES = ['SplashSlide', 'HookSlide', 'ValueSlide', 'CarouselCTA'];
      const hasSubhead = SUBHEAD_TEMPLATES.includes(templates[idx] || '');
      substyleBtn.style.display = hasSubhead ? '' : 'none';
      if (substyleRow) substyleRow.style.display = hasSubhead ? '' : 'none';
    }

    // Sync overlay slider to this slide's saved opacity
    const ovlOpacities = JSON.parse(sbar.dataset.ovlOpacities || '[]');
    const saved = ovlOpacities[idx];
    const pct = saved != null ? Math.round(saved * 100) : 62;
    const slider = document.getElementById(\`ovlslider-\${date}-\${slug}\`);
    const valEl  = document.getElementById(\`ovlval-\${date}-\${slug}\`);
    if (slider) slider.value = pct;
    if (valEl)  valEl.textContent = pct + '%';

    // Sync FX buttons to this slide's saved effect
    const effects = JSON.parse(sbar.dataset.effects || '[]');
    const activeEffect = effects[idx] || 'none';
    const fxRow = document.getElementById(\`sbar-effect-\${date}-\${slug}\`);
    if (fxRow) {
      fxRow.querySelectorAll('.fx-btn').forEach(b =>
        b.classList.toggle('fx-active', b.dataset.fx === activeEffect));
    }
  }
}

// ── Per-slide text edit ───────────────────────────────────────
async function toggleSlideEdit(date, slug, btn) {
  const panel = document.getElementById(\`sedit-\${date}-\${slug}\`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    btn.classList.remove('active');
    return;
  }
  // Load current values from server
  const slideIdx = getSlideIdx(date, slug);
  const r = await fetch(\`/api/slide-text?date=\${date}&slug=\${slug}&slideIdx=\${slideIdx}\`);
  const j = await r.json();
  document.getElementById(\`sedit-h-\${date}-\${slug}\`).value = j.headline || '';
  document.getElementById(\`sedit-s-\${date}-\${slug}\`).value = j.subhead || '';
  panel.style.display = 'flex';
  btn.classList.add('active');
}

async function saveSlideText(date, slug, btn) {
  const slideIdx = getSlideIdx(date, slug);
  const headline = document.getElementById(\`sedit-h-\${date}-\${slug}\`)?.value ?? '';
  const subhead  = document.getElementById(\`sedit-s-\${date}-\${slug}\`)?.value ?? '';
  btn.disabled = true;
  const r = await fetch('/api/slide-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, headline, subhead }),
  });
  btn.disabled = false;
  const j = await r.json();
  if (j.ok) { showSlideStatus(date, slug, 'Rendering…'); autoRender(date, slug); }
  else showSlideStatus(date, slug, '✗ ' + (j.error || 'Error'));
}

async function clearSlideText(date, slug, btn) {
  const slideIdx = getSlideIdx(date, slug);
  btn.disabled = true;
  const r = await fetch('/api/slide-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, headline: null, subhead: null }),
  });
  btn.disabled = false;
  const j = await r.json();
  if (j.ok) {
    document.getElementById(\`sedit-h-\${date}-\${slug}\`).value = j.headline || '';
    document.getElementById(\`sedit-s-\${date}-\${slug}\`).value = j.subhead || '';
    showSlideStatus(date, slug, '✓ Text overrides cleared — click Render');
  }
}

// ── Per-slide actions ─────────────────────────────────────────
function getSlideIdx(date, slug) {
  const imgBox = document.querySelector(\`.card-img[data-date="\${date}"][data-slug="\${slug}"]\`);
  return imgBox ? parseInt(imgBox.dataset.idx || '0') : 0;
}

async function adjustFont(date, slug, field, delta) {
  const slideIdx = getSlideIdx(date, slug);
  const r = await fetch('/api/slide-font', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, field, delta }),
  });
  const j = await r.json();
  if (!j.ok) return;
  showSlideStatus(date, slug, 'Rendering…');
  autoRender(date, slug);
}

async function setEffect(date, slug, effect, btn) {
  const slideIdx = getSlideIdx(date, slug);
  const r = await fetch('/api/slide-effect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, effect }),
  });
  const j = await r.json();
  if (j.ok) {
    // Mark active FX button
    const row = document.getElementById(\`sbar-effect-\${date}-\${slug}\`);
    if (row) row.querySelectorAll('.fx-btn').forEach(b => b.classList.toggle('fx-active', b.dataset.fx === effect));
    // Update cached effects array so slideNav stays in sync
    const sbar = document.getElementById(\`sbar-\${date}-\${slug}\`);
    if (sbar) {
      const effects = JSON.parse(sbar.dataset.effects || '[]');
      effects[slideIdx] = effect;
      sbar.dataset.effects = JSON.stringify(effects);
    }
    showSlideStatus(date, slug, 'Rendering…');
    autoRender(date, slug);
  } else {
    showSlideStatus(date, slug, '✗ ' + (j.error || 'Effect failed'));
  }
}

async function toggleWorld(date, slug, btn) {
  const slideIdx = getSlideIdx(date, slug);
  const next = (btn.dataset.ovl === 'dark') ? 'light' : 'dark';
  const r = await fetch('/api/slide-world', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, world: next }),
  });
  const j = await r.json();
  if (j.ok) {
    btn.dataset.ovl = next;
    btn.textContent = next === 'light' ? 'Light' : 'Dark';
    btn.classList.toggle('is-light', next === 'light');
    showSlideStatus(date, slug, 'Rendering…');
    autoRender(date, slug);
  }
}

async function autoRender(date, slug) {
  const { jobId } = await api('render', date, slug, {});
  if (!jobId) return;
  const poll = setInterval(async () => {
    const j = await (await fetch(\`/api/job/\${jobId}\`)).json();
    if (j.done) {
      clearInterval(poll);
      if (j.ok) {
        showSlideStatus(date, slug, '✓ Done');
        const imgBox = document.querySelector(\`.card-img[data-date="\${date}"][data-slug="\${slug}"]\`);
        if (imgBox) {
          const t = Date.now();
          const slides = JSON.parse(imgBox.dataset.slides || '[]');
          const busted = slides.map(s => s.split('?')[0] + '?t=' + t);
          imgBox.dataset.slides = JSON.stringify(busted);
          const idx = parseInt(imgBox.dataset.idx || '0');
          const thumb = imgBox.querySelector('img.thumb');
          if (thumb) thumb.src = (busted[idx] || busted[0]);
        }
      } else {
        showSlideStatus(date, slug, '✗ Render failed');
      }
    }
  }, 1200);
}

async function slidePhoto(date, slug, payload) {
  const r = await fetch('/api/slide-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, ...payload }),
  });
  return r.json();
}

async function slideAction(action, date, slug) {
  const slideIdx = getSlideIdx(date, slug);
  const sbar = document.getElementById(\`sbar-\${date}-\${slug}\`);
  if (action === 'text-only') {
    await slidePhoto(date, slug, { slideIdx, photo: '', template: 'BoldStatement' });
    if (sbar) sbar.querySelector('.sbar-tmpl').textContent = 'BoldStatement (text only)';
  } else if (action === 'restore-photo') {
    await slidePhoto(date, slug, { slideIdx, photo: null, template: null });
    if (sbar) sbar.querySelector('.sbar-tmpl').textContent = '';
  }
  showSlideStatus(date, slug, '✓ Updated — click Render to see result');
}

async function setSlidePhoto(date, slug, photo, imgEl) {
  const slideIdx = getSlideIdx(date, slug);
  await slidePhoto(date, slug, { slideIdx, photo });
  const grid = document.getElementById(\`sphoto-opts-\${date}-\${slug}\`);
  if (grid) grid.querySelectorAll('.photo-opt').forEach(i => i.classList.remove('selected'));
  if (imgEl) imgEl.classList.add('selected');
  showSlideStatus(date, slug, '✓ Photo set for slide ' + (slideIdx + 1) + ' — click Render');
}

async function reworkSlide(date, slug, btn) {
  const slideIdx  = getSlideIdx(date, slug);
  const instruction = document.getElementById(\`srw-txt-\${date}-\${slug}\`)?.value?.trim();
  if (!instruction) return;
  btn.disabled = true;
  btn.textContent = 'Working…';
  showSlideStatus(date, slug, 'Claude is reworking slide ' + (slideIdx + 1) + '…');

  const r = await fetch('/api/slide-rework', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, instruction }),
  });
  const json = await r.json();
  btn.disabled = false;
  btn.textContent = 'Rework slide →';

  if (json.ok) {
    showSlideStatus(date, slug, '✓ Slide ' + (slideIdx + 1) + ' reworked — click Render to see result');
    document.getElementById(\`srw-txt-\${date}-\${slug}\`).value = '';
  } else {
    showSlideStatus(date, slug, '✗ ' + (json.error || 'Error'));
  }
}

async function generateImage(date, slug, btn) {
  const slideIdx = getSlideIdx(date, slug);
  // Use dedicated image direction input
  const imageDirection = document.getElementById(\`imgdir-txt-\${date}-\${slug}\`)?.value?.trim() || '';
  btn.disabled = true;
  btn.textContent = '✦ Generating…';
  showSlideStatus(date, slug, 'Generating image for slide ' + (slideIdx + 1) + (imageDirection ? ' — using your direction…' : '…'));

  const r = await fetch('/api/slide-generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, imageDirection }),
  });
  const json = await r.json();
  btn.disabled = false;
  btn.textContent = '✦ Generate image';

  if (json.ok) {
    showSlideStatus(date, slug, '✓ Image generated — rendering…');
    // Poll the auto-render job, then refresh thumbnail when done
    if (json.jobId) {
      const poll = setInterval(async () => {
        const j = await (await fetch(\`/api/job/\${json.jobId}\`)).json();
        if (j.done) {
          clearInterval(poll);
          if (j.ok) {
            showSlideStatus(date, slug, '✓ Done');
            // Refresh the current slide thumbnail with cache-bust
            const imgBox = document.querySelector(\`.card-img[data-date="\${date}"][data-slug="\${slug}"]\`);
            if (imgBox) {
              const t = Date.now();
              const idx = parseInt(imgBox.dataset.idx || '0');
              const slides = JSON.parse(imgBox.dataset.slides || '[]');
              // Build the URL for the current slide index; fall back to slide_1.png
              const slideNum = idx + 1;
              const freshUrl = \`/output/\${date}/\${slug}/slide_\${slideNum}.png?t=\${t}\`;
              const thumb = imgBox.querySelector('img.thumb');
              if (thumb) {
                thumb.src = freshUrl;
              } else {
                // Post was staged (no img.thumb yet) — reload to show rendered card
                location.reload();
              }
              if (slides.length) {
                const busted = slides.map((s, i) => s.split('?')[0] + '?t=' + t);
                imgBox.dataset.slides = JSON.stringify(busted);
              }
            }
          } else {
            showSlideStatus(date, slug, '✗ Render failed — ' + j.log.slice(-120));
          }
        }
      }, 1500);
    }
  } else {
    showSlideStatus(date, slug, '✗ ' + (json.error || 'Error'));
  }
}

function showSlideStatus(date, slug, msg) {
  const el = document.getElementById(\`job-\${date}-\${slug}\`);
  if (el) { el.textContent = msg; el.className = 'job-status ok'; }
}

// ── Toggle sections ───────────────────────────────────────────
function toggleSection(btn, id) {
  const el = document.getElementById(id);
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : '';
}

// ── API helpers ───────────────────────────────────────────────
async function api(action, date, slug, extra = {}) {
  const r = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, date, slug, ...extra }),
  });
  return r.json();
}

// ── Notes auto-save ───────────────────────────────────────────
async function saveNotes(date, slug, notes) {
  await api('notes', date, slug, { notes });
}

// ── Photo override ────────────────────────────────────────────
async function setPhoto(date, slug, photo, imgEl) {
  await api('photo', date, slug, { photo });
  // Update selected state
  const card = document.querySelector(\`[data-date="\${date}"][data-slug="\${slug}"]\`);
  if (card) {
    card.querySelectorAll('.photo-opt').forEach(i => i.classList.remove('selected'));
    if (imgEl) imgEl.classList.add('selected');
  }
}

// ── Cancel post ───────────────────────────────────────────────
async function cancelPost(date, slug, btn) {
  if (!confirm('Remove this post from the queue?')) return;
  await api('cancel', date, slug);
  const card = document.querySelector(\`[data-date="\${date}"][data-slug="\${slug}"]\`);
  if (card) card.style.transition = 'opacity .3s', card.style.opacity = 0,
    setTimeout(() => card.remove(), 300);
}

// ── Mark approved / posted ────────────────────────────────────
async function markStatus(date, slug, status, btn) {
  await api(status, date, slug);
  // Reload the card section by reloading the page — simplest for status transitions
  location.reload();
}

// ── Photo upload ──────────────────────────────────────────────
async function uploadPhoto(date, slug, input) {
  const file = input.files[0];
  if (!file) return;
  const label = input.closest('.upload-btn');
  label.textContent = 'Uploading…';
  label.classList.add('uploading');

  const reader = new FileReader();
  reader.onload = async (e) => {
    // Strip data-url prefix to get raw base64
    const base64 = e.target.result.split(',')[1];
    const r = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, data: base64 }),
    });
    const json = await r.json();
    label.textContent = '+ Add photo';
    label.classList.remove('uploading');
    if (!json.ok) { alert('Upload failed: ' + json.error); return; }

    // Prefer Cloudinary URL (supports effects) — fall back to local path
    const photoUrl = json.cloudinaryUrl || json.path;
    const thumbSrc = '/assets/photos/' + json.filename;

    // Add new thumbnail to picker and auto-select it
    const grid = document.getElementById(\`photo-opts-\${date}-\${slug}\`);
    const img = document.createElement('img');
    img.className = 'photo-opt';
    img.src = thumbSrc;
    img.title = json.filename + (json.cloudinaryUrl ? ' ✓ Cloudinary' : ' (local)');
    img.onclick = () => setPhoto(date, slug, photoUrl, img);
    grid.appendChild(img);
    setPhoto(date, slug, photoUrl, img);
    if (json.cloudinaryUrl) showSlideStatus(date, slug, '✓ Uploaded to Cloudinary — effects available');
  };
  reader.readAsDataURL(file);
}

// ── Overlay opacity slider ────────────────────────────────────
function previewOverlay(date, slug, input) {
  const val = document.getElementById(\`ovlval-\${date}-\${slug}\`);
  if (val) val.textContent = input.value + '%';
}

async function saveOverlay(date, slug, input) {
  const opacity = Math.round(input.value) / 100;
  const val = document.getElementById(\`ovlval-\${date}-\${slug}\`);
  if (val) val.textContent = Math.round(opacity * 100) + '%';
  const slideIdx = getSlideIdx(date, slug);
  const r = await fetch('/api/slide-overlay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, overlayOpacity: opacity }),
  });
  const j = await r.json();
  if (j.ok) { showSlideStatus(date, slug, 'Rendering…'); autoRender(date, slug); }
}

// ── SubheadStyle cycle ────────────────────────────────────────
async function cycleSubheadStyle(date, slug, btn) {
  const order = ['stroke', 'color', 'solid'];
  const cur   = btn.dataset.style || 'stroke';
  const next  = order[(order.indexOf(cur) + 1) % order.length];
  btn.dataset.style  = next;
  btn.textContent    = next.charAt(0).toUpperCase() + next.slice(1);
  btn.classList.toggle('is-color',  next === 'color');
  btn.classList.toggle('is-solid',  next === 'solid');

  const slideIdx = getSlideIdx(date, slug);
  const r = await fetch('/api/slide-subhead-style', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, slideIdx, subheadStyle: next }),
  });
  const j = await r.json();
  if (j.ok) { showSlideStatus(date, slug, 'Rendering…'); autoRender(date, slug); }
}

// ── New Post panel ────────────────────────────────────────────
function toggleNewPost(btn) {
  const panel = document.getElementById('new-post-panel');
  const open  = panel.classList.toggle('open');
  btn.textContent = open ? '✕ Close' : '+ New Post';
}

function toggleNpCampaign() {
  const track = document.getElementById('np-track').value;
  document.getElementById('np-campaign-row').style.display = track === 'campaign' ? '' : 'none';
}

async function submitNewPost(btn) {
  const track    = document.getElementById('np-track').value;
  const campaign = document.getElementById('np-campaign')?.value || '';
  const single   = document.getElementById('np-single').checked;
  const notes    = document.getElementById('np-notes').value.trim();
  const status   = document.getElementById('np-status');

  btn.disabled   = true;
  status.className = 'job-status running';
  status.textContent = 'Generating…';

  const r = await fetch('/api/new-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track, campaign, single, notes }),
  });
  const j = await r.json();
  if (!j.jobId) {
    btn.disabled = false;
    status.className = 'job-status err';
    status.textContent = '✗ ' + (j.error || 'Error');
    return;
  }

  const poll = setInterval(async () => {
    const s = await (await fetch(\`/api/job/\${j.jobId}\`)).json();
    if (s.done) {
      clearInterval(poll);
      btn.disabled = false;
      if (s.ok) {
        status.className = 'job-status ok';
        status.textContent = '✓ Done — reloading…';
        setTimeout(() => location.reload(), 800);
      } else {
        status.className = 'job-status err';
        status.textContent = '✗ ' + s.log.slice(-200);
      }
    }
  }, 1400);
}

// ── Render / Regenerate jobs ──────────────────────────────────
async function runJob(action, date, slug, btn) {
  const notes = document.querySelector(\`#notes-\${date}-\${slug} textarea\`)?.value || '';
  const { jobId } = await api(action, date, slug, { notes });
  const statusEl = document.getElementById(\`job-\${date}-\${slug}\`);
  btn.disabled = true;
  statusEl.className = 'job-status running';
  statusEl.textContent = action === 'render' ? 'Rendering…' : 'Generating…';

  const poll = setInterval(async () => {
    const j = await (await fetch(\`/api/job/\${jobId}\`)).json();
    if (j.done) {
      clearInterval(poll);
      btn.disabled = false;
      statusEl.className = 'job-status ' + (j.ok ? 'ok' : 'err');
      if (j.ok) {
        statusEl.textContent = '✓ Done';
        if (action === 'render' || action === 'regenerate') {
          // Refresh all slide thumbnails in place without a page reload
          const imgBox = document.querySelector(\`.card-img[data-date="\${date}"][data-slug="\${slug}"]\`);
          if (imgBox) {
            const t = Date.now();
            const slides = JSON.parse(imgBox.dataset.slides || '[]');
            // Update cached slide URLs with cache-busted versions
            const busted = slides.map(s => s.split('?')[0] + '?t=' + t);
            imgBox.dataset.slides = JSON.stringify(busted);
            const idx = parseInt(imgBox.dataset.idx || '0');
            const thumb = imgBox.querySelector('img.thumb');
            if (thumb) thumb.src = (busted[idx] || busted[0]);
          }
        }
      } else {
        statusEl.textContent = '✗ ' + j.log.slice(-200);
      }
    }
  }, 1200);
}

// ── Caption save ──────────────────────────────────────────────
async function saveCaption(date, slug, text) {
  await fetch('/api/caption', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slug, caption: text }),
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────
// A = approve hovered card, R = render, ←/→ = navigate slides
let _hoveredCard = null;
document.addEventListener('mouseover', e => {
  const card = e.target.closest('.card');
  if (card) _hoveredCard = card;
});
document.addEventListener('keydown', e => {
  // Ignore when typing in a textarea/input
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  if (!_hoveredCard) return;
  const date = _hoveredCard.dataset.date;
  const slug = _hoveredCard.dataset.slug;
  if (!date || !slug) return;

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const imgBox = _hoveredCard.querySelector('.card-img');
    if (imgBox) { e.preventDefault(); slideNav(imgBox, e.key === 'ArrowRight' ? 1 : -1); }
  } else if (e.key === 'r' || e.key === 'R') {
    const btn = _hoveredCard.querySelector('.btn-action:not(.btn-approve):not(.btn-post):not(.btn-post-ig)');
    if (btn && btn.textContent.includes('Render')) { e.preventDefault(); runJob('render', date, slug, btn); }
  } else if (e.key === 'a' || e.key === 'A') {
    const approveBtn = _hoveredCard.querySelector('.btn-approve');
    if (approveBtn) { e.preventDefault(); markStatus(date, slug, 'approved', approveBtn); }
  }
});

// ── Post to Instagram ─────────────────────────────────────────
async function postToIG(date, slug, btn) {
  const statusEl = document.getElementById(\`job-\${date}-\${slug}\`);
  btn.disabled = true;
  statusEl.className = 'job-status running';
  statusEl.textContent = 'Posting to Instagram…';

  let jobId;
  try {
    const res = await fetch('/api/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, slug }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    jobId = data.jobId;
  } catch (e) {
    btn.disabled = false;
    statusEl.className = 'job-status err';
    statusEl.textContent = '✗ ' + e.message;
    return;
  }

  const poll = setInterval(async () => {
    const j = await (await fetch(\`/api/job/\${jobId}\`)).json();
    if (!j.done) {
      const lines = j.log.trim().split('\\n');
      const last = lines[lines.length - 1] || 'Posting…';
      statusEl.textContent = last;
      return;
    }
    clearInterval(poll);
    if (j.ok) {
      statusEl.className = 'job-status ok';
      statusEl.textContent = '✓ Posted to Instagram!';
      btn.textContent = '✓ Posted';
      setTimeout(() => location.reload(), 2000);
    } else {
      btn.disabled = false;
      statusEl.className = 'job-status err';
      statusEl.textContent = '✗ ' + j.log.split('\\n').filter(Boolean).pop();
    }
  }, 1500);
}
</script>
</body>
</html>`;
}

// ── Request router ────────────────────────────────────────────
function serveStatic(res, filePath) {
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  const ext  = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': mime };
  // Never cache HTML or JSON — preview.html and meta.json must always be fresh
  if (ext === '.html' || ext === '.json') headers['Cache-Control'] = 'no-store';
  res.writeHead(200, headers);
  res.end(readFileSync(filePath));
}

function jsonResp(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(ok => {
    let buf = '';
    req.on('data', d => buf += d);
    req.on('end', () => { try { ok(JSON.parse(buf)); } catch { ok({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // ── Static files ────────────────────────────────────────────
  if (path.startsWith('/output/'))
    return serveStatic(res, resolve(__dirname, path.slice(1)));
  if (path.startsWith('/assets/'))
    return serveStatic(res, resolve(__dirname, path.slice(1)));

  // ── Job status ───────────────────────────────────────────────
  if (path.startsWith('/api/job/') && method === 'GET') {
    const id = path.split('/').pop();
    const job = jobs.get(id);
    if (!job) return jsonResp(res, { done: true, ok: false, log: 'Job not found' }, 404);
    return jsonResp(res, job);
  }

  // ── Actions ──────────────────────────────────────────────────
  if (path === '/api/action' && method === 'POST') {
    const body = await readBody(req);
    const { action, date, slug, notes, photo } = body;
    if (!date || !slug) return jsonResp(res, { error: 'Missing date/slug' }, 400);

    const dir = postDir(date, slug);
    const meta = readMeta(dir);

    if (action === 'cancel') {
      writeMeta(dir, { ...meta, status: 'cancelled' });
      return jsonResp(res, { ok: true });
    }

    if (action === 'approved') {
      writeMeta(dir, { ...meta, status: 'approved' });
      return jsonResp(res, { ok: true });
    }

    if (action === 'posted') {
      writeMeta(dir, { ...meta, status: 'posted', postedAt: new Date().toISOString() });
      return jsonResp(res, { ok: true });
    }

    if (action === 'notes') {
      writeMeta(dir, { ...meta, notes: notes || '' });
      return jsonResp(res, { ok: true });
    }

    if (action === 'photo') {
      writeMeta(dir, { ...meta, photoOverride: photo || null });
      rebuildPreview(dir);
      return jsonResp(res, { ok: true });
    }

    if (action === 'render') {
      const hasPreview = existsSync(join(dir, 'preview.html'));
      const hasSlides  = existsSync(join(dir, 'slides.json'));
      if (!hasPreview && !hasSlides) {
        // Too old to rerender — no source data. Must regenerate.
        const id = String(++jobSeq);
        jobs.set(id, { done: true, ok: false, log: 'No slide data found — click Regenerate to rebuild this post from scratch.' });
        return jsonResp(res, { jobId: id });
      }
      rebuildPreview(dir);
      const jobId = spawnJob(NODE, [
        'generate.js', '--rerender', '--date', date, '--slug', slug,
      ]);
      return jsonResp(res, { jobId });
    }

    if (action === 'regenerate') {
      const args = [
        'generate.js',
        '--track', meta.track || 'campaign',
        '--date', date, '--slug', slug,
      ];
      if (meta.track === 'educational' && meta.topic?.id)
        args.push('--topic', meta.topic.id);
      if (meta.track === 'campaign' && meta.campaign)
        args.push('--campaign', meta.campaign);

      const jobId = spawnJob(NODE, args, {
        OTL_NOTES: notes || meta.notes || '',
      });
      return jsonResp(res, { jobId });
    }

    return jsonResp(res, { error: 'Unknown action' }, 400);
  }

  // ── Per-slide photo / template override ─────────────────────
  if (path === '/api/slide-photo' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, photo, template } = body;
    const dir  = postDir(date, slug);
    const meta = readMeta(dir);
    const overrides = meta.slideOverrides || {};
    const key = String(slideIdx);
    const existing = overrides[key] || {};

    if (photo === null && template === null) {
      // restore-photo: clear all per-slide overrides for this slide
      delete overrides[key];
    } else {
      const updated = { ...existing };
      if (photo === null) {
        delete updated.photo;
      } else if (photo !== undefined) {
        updated.photo = photo; // '' = text-only, string = path
      }
      if (template === null) {
        delete updated.template;
      } else if (template !== undefined) {
        updated.template = template;
      }
      if (Object.keys(updated).length === 0) {
        delete overrides[key];
      } else {
        overrides[key] = updated;
      }
    }
    writeMeta(dir, { ...meta, slideOverrides: overrides });
    rebuildPreview(dir);
    return jsonResp(res, { ok: true });
  }

  // ── Per-slide font scale ─────────────────────────────────────
  if (path === '/api/slide-font' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, field, delta } = body;
    if (!['headlineFontScale','subheadFontScale'].includes(field))
      return jsonResp(res, { error: 'Invalid field' }, 400);
    const dir  = postDir(date, slug);
    const meta = readMeta(dir);
    const overrides = meta.slideOverrides || {};
    const key = String(slideIdx);
    const current = overrides[key]?.[field] ?? 1.0;
    const next = Math.round(Math.min(2.0, Math.max(0.4, current + delta)) * 100) / 100;
    overrides[key] = { ...(overrides[key] || {}), [field]: next };
    writeMeta(dir, { ...meta, slideOverrides: overrides });
    rebuildPreview(dir);
    return jsonResp(res, { ok: true, scale: next });
  }

  // ── Per-slide world (dark / light) ──────────────────────────
  if (path === '/api/slide-world' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, world } = body;
    if (!['dark','light'].includes(world))
      return jsonResp(res, { error: 'Invalid world' }, 400);
    const dir  = postDir(date, slug);
    const meta = readMeta(dir);
    const overrides = meta.slideOverrides || {};
    const key = String(slideIdx);
    overrides[key] = { ...(overrides[key] || {}), world };
    writeMeta(dir, { ...meta, slideOverrides: overrides });
    rebuildPreview(dir);
    return jsonResp(res, { ok: true });
  }

  // ── Per-slide text edit (headline / subhead) ─────────────────
  if (path.startsWith('/api/slide-text')) {
    const url = new URL('http://x' + req.url);
    const date    = url.searchParams.get('date');
    const slug    = url.searchParams.get('slug');
    const slideIdxParam = url.searchParams.get('slideIdx');

    if (method === 'GET') {
      const dir  = postDir(date, slug);
      const slideIdx = parseInt(slideIdxParam || '0');
      const resolved = buildResolvedSlides(dir);
      const slide = resolved?.[slideIdx] || {};
      return jsonResp(res, { ok: true, headline: slide.headline || '', subhead: slide.subhead || '' });
    }

    if (method === 'POST') {
      const body = await readBody(req);
      const { date: bDate, slug: bSlug, slideIdx, headline, subhead } = body;
      const dir  = postDir(bDate, bSlug);
      const meta = readMeta(dir);
      const overrides = meta.slideOverrides || {};
      const key = String(slideIdx);
      const existing = overrides[key] || {};
      const updated = { ...existing };

      if (headline === null) { delete updated.headline; }
      else if (headline !== undefined) { updated.headline = headline; }

      if (subhead === null) { delete updated.subhead; }
      else if (subhead !== undefined) { updated.subhead = subhead; }

      if (Object.keys(updated).length === 0) { delete overrides[key]; }
      else { overrides[key] = updated; }

      writeMeta(dir, { ...meta, slideOverrides: overrides });
      rebuildPreview(dir);

      // Return current resolved values (base if cleared)
      const resolved = buildResolvedSlides(dir);
      const slide = resolved?.[slideIdx] || {};
      return jsonResp(res, { ok: true, headline: slide.headline || '', subhead: slide.subhead || '' });
    }
  }

  // ── Imagen 3 image generation ────────────────────────────────
  if (path === '/api/slide-generate-image' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, imageDirection } = body;
    const googleKey = dotenvVars.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
    if (!googleKey) return jsonResp(res, { error: 'GOOGLE_API_KEY not set in .env' }, 400);

    const dir      = postDir(date, slug);
    const meta     = readMeta(dir);
    // Use resolved slides so rework/override content is reflected in the prompt
    const resolved = buildResolvedSlides(dir);
    const slide    = resolved?.[slideIdx] || {};
    let caption = '';
    try { caption = readFileSync(join(dir, 'caption.txt'), 'utf8').trim(); } catch {}

    const userDirection = imageDirection?.trim();

    // Ask Claude to write the Imagen prompt so it understands the thematic content
    const claudePrompt = `You are writing an Imagen 4 prompt for a CrossFit gym Instagram carousel background image.

SLIDE HEADLINE: ${slide.headline || ''}
SLIDE SUBHEAD: ${slide.subhead || ''}
POST CAPTION: ${caption || ''}
${userDirection ? `HUMAN DIRECTION: ${userDirection}` : ''}

Your job: write a single specific Imagen 4 prompt for a CINEMATIC ATMOSPHERIC BACKGROUND that visually matches the emotional theme of this slide.

ABSOLUTE RULES:
- NO people, NO faces, NO human figures, NO silhouettes — ever
- The image is a BACKGROUND — text will overlay it, so it must be dark enough for white text
- No text, no logos in the image

Read the headline keywords and let them define the environment. Examples:
- "surgery, GERD" → dark clinical surfaces, clean food on black, pill bottles, medical instruments in shadow
- "community, together" → empty gym at golden hour, chalk dust in light, rings hanging still
- "quit in your head" → dark tunnel, single light ahead, blurred motion
- "food, nutrition, grains" → whole foods on dark surface, close-up grain texture, kitchen in shadow

Write ONLY the Imagen prompt. One paragraph. No explanation. No quotes around it.`;

    const claudeResp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: claudePrompt }],
    });
    const imagePrompt = claudeResp.content[0].text.trim();

    try {
      // Imagen 4 via Google AI Studio
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: imagePrompt }],
            parameters: { sampleCount: 1, aspectRatio: '3:4' },
          }),
        }
      );
      const json = await response.json();
      if (!response.ok) return jsonResp(res, { error: json.error?.message || 'Imagen API error' }, 500);

      const b64  = json.predictions?.[0]?.bytesBase64Encoded;
      const mime = json.predictions?.[0]?.mimeType || 'image/png';
      if (!b64) return jsonResp(res, { error: 'No image in response — ' + JSON.stringify(json).slice(0, 200) }, 500);

      const ext      = mime.includes('png') ? 'png' : 'jpg';
      const genDir   = resolve(__dirname, 'assets', 'photos', 'generated');
      mkdirSync(genDir, { recursive: true });
      const filename = `gen_${Date.now()}.${ext}`;
      const outPath  = join(genDir, filename);
      writeFileSync(outPath, Buffer.from(b64, 'base64'));

      const photoPath = `assets/photos/generated/${filename}`;

      // Re-read meta fresh — the Imagen call takes seconds and other writes may have happened
      const freshMeta = readMeta(dir);
      const overrides = freshMeta.slideOverrides || {};
      const existing  = overrides[String(slideIdx)] || {};
      // BoldStatement variant "a" is pure-type (no photo rendered).
      // Switching to "b" makes the photo show as a cinematic background with text overlay.
      const currentTemplate = existing.template || slide.template || '';
      const currentVariant  = existing.variant  || slide.variant  || 'a';
      const variantUpgrade  = currentTemplate === 'BoldStatement' && currentVariant === 'a'
        ? { variant: 'b' } : {};
      overrides[String(slideIdx)] = { ...existing, photo: photoPath, ...variantUpgrade };
      writeMeta(dir, { ...freshMeta, slideOverrides: overrides });
      rebuildPreview(dir);

      // Auto-trigger a render so the user sees the composited result immediately
      const jobId = spawnJob(NODE, ['generate.js', '--rerender', '--date', date, '--slug', slug]);
      return jsonResp(res, { ok: true, photo: photoPath, filename, jobId });
    } catch (e) {
      return jsonResp(res, { error: e.message }, 500);
    }
  }

  // ── Per-slide Claude rework ───────────────────────────────────
  if (path === '/api/slide-rework' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, instruction } = body;
    const dir  = postDir(date, slug);
    const base = getBaseSlides(dir);
    if (!base || !base[slideIdx]) return jsonResp(res, { error: 'Slide not found' }, 400);
    const meta = readMeta(dir);
    const overrides = meta.slideOverrides || {};
    const current = { ...base[slideIdx], ...(overrides[String(slideIdx)] || {}) };

    let caption = '';
    try { caption = readFileSync(join(dir, 'caption.txt'), 'utf8').trim(); } catch {}

    const prompt = `You are updating ONE slide in an Instagram carousel for CrossFit OTL (@crossfitotl).

Current slide (JSON):
${JSON.stringify(current, null, 2)}

Post caption context: "${caption}"
Campaign: ${meta.campaign || ''}

INSTRUCTION: ${instruction}

RULES:
- Templates: ArticleCover (photo + headline), BoldStatement (type only, photo optional), MemberSpotlight, CoachCard, CTASlide (last slide — has cta: {action, detail, offer} fields)
- If instruction says "text only" or "no photo" → use BoldStatement, omit photo field entirely
- Keep "size": "4:5", keep "variant" and "campaign" identical to current slide
- Headlines: Bebas Neue ALL CAPS. Short. Punchy. Credentialed. No fluff.
- For BoldStatement: subhead can be 1–2 sentences expanding the headline
- Photo paths if needed: "assets/photos/training-crossfit.jpg", "assets/photos/community.jpg", "assets/photos/family.jpg", "assets/photos/lifestyle.jpg", "assets/photos/built-different.jpg"

Return ONLY the replacement slide as valid JSON. No markdown. No explanation. No wrapper object.`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = response.content[0].text.trim();
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
      if (start === -1) return jsonResp(res, { error: 'No JSON in response' }, 500);
      const updated = JSON.parse(raw.slice(start, end + 1));

      // Save as slide override
      overrides[String(slideIdx)] = updated;
      writeMeta(dir, { ...meta, slideOverrides: overrides });

      // Also update slides.json so future rerenders use this
      base[slideIdx] = { ...base[slideIdx], ...updated };
      writeFileSync(join(dir, 'slides.json'), JSON.stringify(base, null, 2), 'utf8');

      rebuildPreview(dir);
      return jsonResp(res, { ok: true });
    } catch (e) {
      return jsonResp(res, { error: e.message }, 500);
    }
  }

  // ── Photo upload ─────────────────────────────────────────────
  if (path === '/api/upload' && method === 'POST') {
    const body = await readBody(req);
    const { filename, data, tags = [] } = body;  // data = base64 string (no data-url prefix)
    if (!filename || !data) return jsonResp(res, { error: 'Missing filename or data' }, 400);

    // Sanitize filename — alphanumeric, hyphens, underscores, one extension
    const safe = basename(filename)
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/\.{2,}/g, '.')
      .slice(0, 80);
    const ext = extname(safe).toLowerCase();
    if (!['.jpg','.jpeg','.png','.gif','.webp'].includes(ext))
      return jsonResp(res, { error: 'Only image files allowed' }, 400);

    // Save locally (for preview fallback)
    const photosDir = resolve(__dirname, 'assets', 'photos');
    mkdirSync(photosDir, { recursive: true });
    const outPath = join(photosDir, safe);
    const buf = Buffer.from(data, 'base64');
    writeFileSync(outPath, buf);

    // Also push to Cloudinary so effects work and photo enters the library
    let cloudinaryUrl = null;
    try {
      const { v2: cld } = await import('cloudinary'); // v2 already configured at startup
      const uploadResult = await new Promise((resolve, reject) => {
        cld.uploader.upload_stream(
          {
            folder: 'crossfit-otl/library',
            public_id: safe.replace(/\.[^.]+$/, ''),
            tags: ['uploaded', 'quality:3', ...tags],
            overwrite: false,
          },
          (err, result) => err ? reject(err) : resolve(result)
        ).end(buf);
      });
      cloudinaryUrl = uploadResult.secure_url;
    } catch (e) {
      process.stderr.write(`  ⚠️  Cloudinary upload failed: ${e.message}\n`);
    }

    return jsonResp(res, {
      ok: true,
      path: `assets/photos/${safe}`,
      filename: safe,
      cloudinaryUrl,  // null if upload failed — caller falls back to local path
    });
  }

  // ── Per-slide overlay opacity ────────────────────────────────
  if (path === '/api/slide-overlay' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, overlayOpacity } = body;
    const val = Number(overlayOpacity);
    if (isNaN(val) || val < 0 || val > 1)
      return jsonResp(res, { error: 'overlayOpacity must be 0–1' }, 400);
    const dir  = postDir(date, slug);
    const meta = readMeta(dir);
    const overrides = meta.slideOverrides || {};
    const key = String(slideIdx);
    overrides[key] = { ...(overrides[key] || {}), overlayOpacity: val };
    writeMeta(dir, { ...meta, slideOverrides: overrides });
    rebuildPreview(dir);
    return jsonResp(res, { ok: true });
  }

  // ── Per-slide subheadStyle ───────────────────────────────────
  if (path === '/api/slide-subhead-style' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, subheadStyle } = body;
    if (!['stroke','color','solid'].includes(subheadStyle))
      return jsonResp(res, { error: 'Invalid subheadStyle' }, 400);
    const dir  = postDir(date, slug);
    const meta = readMeta(dir);
    const overrides = meta.slideOverrides || {};
    const key = String(slideIdx);
    overrides[key] = { ...(overrides[key] || {}), subheadStyle };
    writeMeta(dir, { ...meta, slideOverrides: overrides });
    rebuildPreview(dir);
    return jsonResp(res, { ok: true });
  }

  // ── Per-slide photo effect (Cloudinary transform) ────────────
  if (path === '/api/slide-effect' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, slideIdx, effect } = body;
    const VALID_EFFECTS = ['none','portrait_blur','portrait_black','portrait_white',
      'portrait_bw_blur','black_and_white','dramatic','art_noir','art_muted','art_vintage',
      'vignette','remove_bg'];
    if (!VALID_EFFECTS.includes(effect))
      return jsonResp(res, { error: 'Invalid effect' }, 400);
    const dir  = postDir(date, slug);
    const meta = readMeta(dir);
    const base = getBaseSlides(dir);
    const slide = base?.[slideIdx];
    if (!slide) return jsonResp(res, { error: 'Slide not found' }, 400);

    const rawUrl = slide.photoRaw || slide.photo;
    const slot   = slide.photoSlot || (
      (slide.template === 'HookSlide' || slide.template === 'CarouselCTA') ? 'hook' : 'value'
    );
    const newPhotoUrl = buildPhotoUrl(rawUrl, slot, effect);

    // Save effect + new photo url as slide override
    const overrides = meta.slideOverrides || {};
    const key = String(slideIdx);
    overrides[key] = { ...(overrides[key] || {}), photo: newPhotoUrl, photoEffect: effect };
    writeMeta(dir, { ...meta, slideOverrides: overrides });
    rebuildPreview(dir);
    return jsonResp(res, { ok: true, photo: newPhotoUrl, effect });
  }

  // ── Caption update ───────────────────────────────────────────
  if (path === '/api/caption' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, caption } = body;
    if (!date || !slug) return jsonResp(res, { error: 'Missing date/slug' }, 400);
    const dir = postDir(date, slug);
    writeFileSync(join(dir, 'caption.txt'), caption || '', 'utf8');
    return jsonResp(res, { ok: true });
  }

  // ── New post generation ──────────────────────────────────────
  if (path === '/api/new-post' && method === 'POST') {
    const body = await readBody(req);
    const { track = 'campaign', campaign = 'crossfit-is-the-cure', single = false, notes = '' } = body;
    const args = ['generate.js', '--track', track, '--preview'];
    if (track === 'campaign') {
      args.push('--campaign', campaign);
      if (single) args.push('--single');
    }
    const jobId = spawnJob(NODE, args, { OTL_NOTES: notes || '' });
    return jsonResp(res, { jobId });
  }

  // ── Post to Instagram ────────────────────────────────────────
  if (path === '/api/post' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug } = body;
    if (!date || !slug) return jsonResp(res, { error: 'Missing date/slug' }, 400);

    const dir      = postDir(date, slug);
    const meta     = readMeta(dir);
    const jobId    = String(++jobSeq);
    const job      = { done: false, ok: false, log: '' };
    jobs.set(jobId, job);

    const appendLog = (msg) => { job.log += msg + '\n'; };

    // Run posting async
    (async () => {
      try {
        // Collect rendered slide paths
        let slideCount = 0;
        while (existsSync(join(dir, `slide_${slideCount + 1}.png`))) slideCount++;
        if (!slideCount) throw new Error('No rendered slides found — click Render first');

        const slidePaths = Array.from({ length: slideCount }, (_, i) =>
          join(dir, `slide_${i + 1}.png`));

        let caption = '';
        try { caption = readFileSync(join(dir, 'caption.txt'), 'utf8').trim(); } catch {}
        if (!caption) throw new Error('No caption.txt found for this post');

        await postToInstagram({ slidePaths, caption, onProgress: appendLog });

        writeMeta(dir, { ...meta, status: 'posted', postedAt: new Date().toISOString() });
        job.done = true;
        job.ok   = true;
      } catch (e) {
        appendLog('✗ ' + e.message);
        job.done = true;
        job.ok   = false;
      }
    })();

    return jsonResp(res, { jobId });
  }

  // ── Queue page ───────────────────────────────────────────────
  if (path === '/' || path === '/queue') {
    const posts = collectPosts();
    const html  = buildQueueHtml(posts);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

import { networkInterfaces } from 'os';

server.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const localIp = Object.values(nets).flat()
    .find(n => n.family === 'IPv4' && !n.internal)?.address || 'unknown';
  console.log(`\n  OTL Post Queue`);
  console.log(`  Local   →  http://localhost:${PORT}`);
  console.log(`  Network →  http://${localIp}:${PORT}  ← open this on MacBook Pro\n`);
});
