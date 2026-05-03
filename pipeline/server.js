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
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const NODE = process.execPath;

// ── Ship registry ─────────────────────────────────────────────
const LOS_OUTPUT = '/Users/javierjaimemini/Library/CloudStorage/OneDrive-OnTheLineFitness/L·OS/los-library/04_content_matrix/pipeline/output';
const SHIPS = {
  otl: {
    label: 'CrossFit OTL', handle: '@crossfitotl', color: '#003566', accent: '#3a7ab8',
    outputDir: resolve(__dirname, 'output'), staticPrefix: 'output',
  },
  los: {
    label: 'Lifestyle OS', handle: '@life_styleos', color: '#0071E3', accent: '#5AC8FA',
    outputDir: LOS_OUTPUT, staticPrefix: 'los-output',
  },
};
const LOS_SUB_COLORS = {
  recovery:'#007AFF', metabolic:'#FF9500', physical:'#FF3B30', cognitive:'#AF52DE',
  time:'#5AC8FA', financial:'#34C759', bonds:'#FF2D55', relational:'#FF2D55', strategic:'#5856D6',
};

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

// ── Supabase client (atlas project — otl_post_queue) ─────────
const SUPABASE_URL = dotenvVars.SUPABASE_URL || '';
const SUPABASE_KEY = dotenvVars.SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ── Supabase client (LOS project — scheduled_posts) ──────────
const LOS_ENV_PATH = '/Users/javierjaimemini/Library/CloudStorage/OneDrive-OnTheLineFitness/L·OS/los-library/04_content_matrix/pipeline/.env';
const losEnv = existsSync(LOS_ENV_PATH)
  ? Object.fromEntries(
      readFileSync(LOS_ENV_PATH, 'utf8').split('\n')
        .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
    )
  : {};
const losSupabase = losEnv.SUPABASE_URL && losEnv.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(losEnv.SUPABASE_URL, losEnv.SUPABASE_SERVICE_ROLE_KEY)
  : null;

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
  const globalAccent = meta.accentColor || null;

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
    // Global accent (from meta.json) always wins over per-slide baked value
    // This lets the panel's accent swatch switcher apply on re-render
    if (globalAccent) merged.accent = globalAccent;
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
function postDir(date, slug, ship = 'otl') {
  return resolve((SHIPS[ship] || SHIPS.otl).outputDir, date, slug);
}
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Collect posts ─────────────────────────────────────────────
const STATUS_RANK = { approved: 0, rendered: 1, staged: 2, posted: 3 };

function collectPosts(ship = 'otl') {
  const shipCfg = SHIPS[ship] || SHIPS.otl;
  const outDir = shipCfg.outputDir;
  const staticPrefix = shipCfg.staticPrefix;
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

      // Slide templates + overlay opacities + effects + texts for per-slide controls
      let slideTemplates = [];
      let slideOverlayOpacities = [];
      let slideEffects = [];
      let slideTexts = [];  // [{headline, subhead}, ...]
      try {
        const base = JSON.parse(readFileSync(join(pp, 'slides.json'), 'utf8'));
        const ov = (readMeta(pp).slideOverrides) || {};
        slideTemplates = base.map((s, i) => (ov[String(i)]?.template || s.template || ''));
        slideOverlayOpacities = base.map((s, i) => {
          const ovVal = ov[String(i)]?.overlayOpacity;
          return ovVal != null ? ovVal : null;
        });
        slideEffects = base.map((s, i) => ov[String(i)]?.photoEffect || s.photoEffect || 'none');
        slideTexts   = base.map((s, i) => ({
          headline: ov[String(i)]?.headline ?? s.headline ?? '',
          subhead:  ov[String(i)]?.subhead  ?? s.subhead  ?? s.body ?? '',
        }));
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
        slideTexts,
        effectiveStatus,
        generatedAt: meta.generated ? new Date(meta.generated).getTime() : 0,
        ship, staticPrefix,
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
  if (s === 'rendered') return `<span class="badge rendered">READY</span>`;
  return `<span class="badge staged">DRAFT</span>`;
}

// ── Accent slots (mirrored from generate.js / templates.jsx) ──
const ACCENT_SLOTS_SERVER = [
  { accent: '#7eb8ff', bg: '#0a0a0a', label: 'OTL Blue'   },
  { accent: '#003566', bg: '#0d1a2e', label: 'Navy Night'  },
  { accent: '#F5C518', bg: '#0a0a0a', label: 'Gold'        },
  { accent: '#10B981', bg: '#061a0f', label: 'Emerald'     },
  { accent: '#ffffff', bg: '#0a0a0a', label: 'White'       },
  { accent: '#E8C49A', bg: '#1a1008', label: 'Sand'        },
];

// ── Queue HTML ────────────────────────────────────────────────
function buildCalendarHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OTL Content Calendar</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
header{background:#111;border-bottom:1px solid #1e1e1e;padding:14px 24px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:20}
.nav-btn-h{background:#161616;border:1px solid #252525;color:#888;padding:5px 12px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;text-decoration:none}
.nav-btn-h:hover{background:#222;color:#ccc}
.logo{font-size:13px;font-weight:700;letter-spacing:.06em;color:#fff;text-transform:uppercase}
.logo span{color:#7eb8ff}
h1{font-size:13px;font-weight:700;color:#aaa;letter-spacing:.06em;text-transform:uppercase}
main{padding:24px;max-width:1100px;margin:0 auto}
.cal-nav{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.cal-nav button{background:#161616;border:1px solid #252525;color:#aaa;width:30px;height:30px;border-radius:4px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
.cal-nav button:hover{background:#222;color:#fff}
.cal-month{font-size:18px;font-weight:700;color:#fff;letter-spacing:.04em;min-width:160px;text-align:center}
.extend-btn{margin-left:auto;background:#1a0a2e;border:1px solid #7C3AED44;color:#7C3AED;padding:6px 14px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:.15s}
.extend-btn:hover{background:#2d0a52;border-color:#7C3AED}
.grid-header{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}
.grid-header div{text-align:center;font-size:10px;font-weight:700;color:#444;letter-spacing:.08em;text-transform:uppercase;padding:4px}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal-day{min-height:88px;background:#111;border:1px solid #1a1a1a;border-radius:6px;padding:8px;cursor:pointer;transition:.15s;position:relative;display:flex;flex-direction:column;gap:4px}
.cal-day:hover{border-color:#333;background:#161616}
.cal-day.empty{background:#0a0a0a;border-color:#111;cursor:default}
.cal-day.today{border-color:#003566}
.day-num{font-size:11px;font-weight:600;color:#444;text-align:right;line-height:1}
.day-chip{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:3px;line-height:1.4;word-break:break-word;margin-top:2px}
.day-status{font-size:8px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 5px;border-radius:3px;margin-top:auto;display:inline-flex;align-items:center;gap:3px;align-self:flex-start}
.ds-staged{color:#666}
.ds-approved{color:#5599bb}
.ds-posted{color:#3d883d}
/* Campaign colors */
.chip-edu{background:#0d2540;color:#7eb8ff}
.chip-lifestyle-reset{background:#2d0a52;color:#a78bfa}
.chip-join-our-culture{background:#062a1a;color:#34d399}
.chip-forging-elite-fitness{background:#2a1e00;color:#F5C518}
.chip-crossfit-is-the-cure{background:#2a0808;color:#f87171}
.chip-this-is-crossfit{background:#2a1000;color:#fb923c}
.chip-the-crossfit-effect{background:#001a20;color:#22d3ee}
.chip-share-your-stories{background:#28002a;color:#e879f9}
.chip-other{background:#1a1a1a;color:#888}
/* Modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;display:flex;align-items:center;justify-content:center}
.modal{background:#161616;border:1px solid #2a2a2a;border-radius:8px;padding:24px;width:340px;max-width:95vw}
.modal h3{font-size:13px;font-weight:700;color:#fff;letter-spacing:.06em;text-transform:uppercase;margin-bottom:16px}
.modal label{display:block;font-size:10px;font-weight:600;color:#666;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px;margin-top:12px}
.modal select{width:100%;background:#111;border:1px solid #2a2a2a;color:#e0e0e0;padding:8px 10px;border-radius:4px;font-size:12px}
.modal-actions{display:flex;gap:8px;margin-top:20px}
.btn-save{flex:1;background:#003566;border:none;color:#fff;padding:9px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.btn-save:hover{background:#004a8f}
.btn-cancel{background:#1a1a1a;border:1px solid #2a2a2a;color:#888;padding:9px 16px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer}
.btn-cancel:hover{background:#222;color:#aaa}
.status-bar{font-size:11px;color:#666;margin-top:8px;min-height:16px;text-align:center}
</style>
</head>
<body>
<header>
  <div style="display:flex;gap:8px">
    <a href="/?ship=otl" class="nav-btn-h">OTL</a>
    <a href="/?ship=los" class="nav-btn-h">LOS</a>
    <a href="/scheduled" class="nav-btn-h" style="border-color:#10B98144;color:#10B981">Queue</a>
    <a href="/calendar" class="nav-btn-h" style="border-color:#7C3AED;color:#7C3AED">Calendar</a>
  </div>
  <div class="logo"><span>@crossfitotl</span> Content Calendar</div>
</header>

<main>
  <div class="cal-nav">
    <button onclick="changeMonth(-1)">&#8249;</button>
    <div class="cal-month" id="month-label"></div>
    <button onclick="changeMonth(1)">&#8250;</button>
    <button class="extend-btn" onclick="extendCalendar()">+ Extend 60 days</button>
  </div>
  <div class="grid-header">
    <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
  </div>
  <div class="cal-grid" id="cal-grid"></div>
  <div class="status-bar" id="status-bar"></div>
</main>

<div class="modal-bg" id="modal" style="display:none" onclick="closeModal(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <h3 id="modal-title">Edit Day</h3>
    <label>Track</label>
    <select id="m-track" onchange="trackChanged()">
      <option value="educational">Educational</option>
      <option value="campaign">Campaign</option>
    </select>
    <label id="m-camp-label">Campaign</label>
    <select id="m-campaign">
      <option value="forging-elite-fitness">Forging Elite Fitness</option>
      <option value="crossfit-is-the-cure">CrossFit Is the Cure</option>
      <option value="this-is-crossfit">This Is CrossFit</option>
      <option value="the-crossfit-effect">The CrossFit Effect</option>
      <option value="share-your-stories">Share Your Stories</option>
      <option value="join-our-culture">Join Our Culture</option>
      <option value="lifestyle-reset">Lifestyle Reset</option>
    </select>
    <div class="modal-actions">
      <button class="btn-save" onclick="saveEntry()">Save</button>
      <button class="btn-cancel" onclick="document.getElementById('modal').style.display='none'">Cancel</button>
    </div>
  </div>
</div>

<script>
let calData = {}, postStatus = {}, plan = {};
let currentYear  = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let editingDate  = null;

const CAMPAIGN_LABELS = {
  'educational':            'Educational',
  'lifestyle-reset':        'Lifestyle Reset',
  'join-our-culture':       'Join Our Culture',
  'forging-elite-fitness':  'Forging Elite Fitness',
  'crossfit-is-the-cure':   'CrossFit Is The Cure',
  'this-is-crossfit':       'This Is CrossFit',
  'the-crossfit-effect':    'The CrossFit Effect',
  'share-your-stories':     'Share Your Stories',
};

function chipClass(entry) {
  if (!entry) return 'chip-other';
  if (entry.track === 'educational') return 'chip-edu';
  return 'chip-' + (entry.campaign || 'other');
}

function chipLabel(entry) {
  if (!entry) return '';
  if (entry.track === 'educational') return 'Educational';
  return CAMPAIGN_LABELS[entry.campaign] || entry.campaign || '';
}

function statusHtml(date) {
  const s = postStatus[date];
  if (!s) return '';
  const cls = 'ds-' + s;
  const icon = s === 'posted' ? '✓' : s === 'approved' ? '●' : '·';
  return \`<span class="day-status \${cls}">\${icon} \${s}</span>\`;
}

function renderCalendar() {
  const label = new Date(currentYear, currentMonth, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('month-label').textContent = label;

  const today = new Date().toISOString().slice(0, 10);
  const grid  = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Empty cells before month start
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = \`\${currentYear}-\${String(currentMonth+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
    const entry   = calData[dateStr];
    const isToday = dateStr === today;

    const el = document.createElement('div');
    el.className = 'cal-day' + (isToday ? ' today' : '');
    el.onclick = () => openModal(dateStr);
    el.innerHTML = \`
      <div class="day-num">\${d}</div>
      \${entry ? \`<div class="day-chip \${chipClass(entry)}">\${chipLabel(entry)}</div>\` : '<div class="day-chip chip-other">No plan</div>'}
      \${statusHtml(dateStr)}
    \`;
    grid.appendChild(el);
  }
}

function changeMonth(dir) {
  currentMonth += dir;
  if (currentMonth > 11) { currentMonth = 0;  currentYear++; }
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  renderCalendar();
}

function openModal(date) {
  editingDate = date;
  const entry = calData[date] || {};
  document.getElementById('modal-title').textContent = new Date(date + 'T12:00:00Z')
    .toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  document.getElementById('m-track').value    = entry.track    || 'educational';
  document.getElementById('m-campaign').value = entry.campaign || 'forging-elite-fitness';
  trackChanged();
  document.getElementById('modal').style.display = 'flex';
}

function closeModal(e) {
  if (e.target === document.getElementById('modal'))
    document.getElementById('modal').style.display = 'none';
}

function trackChanged() {
  const isCamp = document.getElementById('m-track').value === 'campaign';
  document.getElementById('m-camp-label').style.display  = isCamp ? 'block' : 'none';
  document.getElementById('m-campaign').style.display    = isCamp ? 'block' : 'none';
}

async function saveEntry() {
  const track    = document.getElementById('m-track').value;
  const campaign = track === 'campaign' ? document.getElementById('m-campaign').value : null;
  const body     = { date: editingDate, track, ...(campaign ? { campaign } : {}) };
  setStatus('Saving…');
  const r = await fetch('/api/calendar-entry', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.ok) {
    calData[editingDate] = j.entry;
    document.getElementById('modal').style.display = 'none';
    renderCalendar();
    setStatus('Saved.');
    setTimeout(() => setStatus(''), 2000);
  } else {
    setStatus('✗ ' + (j.error || 'Error'));
  }
}

async function extendCalendar() {
  setStatus('Extending calendar…');
  const r = await fetch('/api/calendar-extend', { method:'POST' });
  const j = await r.json();
  if (j.ok) {
    await loadData();
    renderCalendar();
    setStatus('✓ Extended. ' + (j.output?.split('\\n')[0] || ''));
    setTimeout(() => setStatus(''), 4000);
  } else {
    setStatus('✗ Failed');
  }
}

function setStatus(msg) {
  document.getElementById('status-bar').textContent = msg;
}

async function loadData() {
  const r = await fetch('/api/calendar-data');
  const j = await r.json();
  calData    = j.calendar    || {};
  plan       = j.plan        || {};
  postStatus = j.postStatus  || {};
}

(async () => {
  await loadData();
  renderCalendar();
})();
</script>
</body>
</html>`;
}

function buildQueueHtml(posts, ship = 'otl') {
  const shipCfg  = SHIPS[ship] || SHIPS.otl;
  const total    = posts.length;
  const posted   = posts.filter(p => p.meta.status === 'posted').length;
  const approved = posts.filter(p => p.meta.status === 'approved').length;
  const rendered = posts.filter(p => p.hasRendered && !['posted','approved'].includes(p.meta.status)).length;
  const staged   = posts.filter(p => !p.hasRendered).length;
  const accentSlotsJson = JSON.stringify(ACCENT_SLOTS_SERVER);

  const cards = posts.map(p => {
    const { date, slug, meta, caption, hasRendered, slideCount, hasPreview, photos, slideTemplates = [], slideOverlayOpacities = [], slideEffects = [], slideTexts = [], ship: pShip = 'otl', staticPrefix: pPrefix = 'output' } = p;
    const isLOS = pShip === 'los';

    // Track / format badge
    let trackBadge;
    if (isLOS) {
      const fmt = meta.format || 'depth';
      const sub = (meta.subsystem || '').toLowerCase();
      const subColor = LOS_SUB_COLORS[sub] || '#5AC8FA';
      const fmtLabels = { short: 'SHORT', depth: 'DEPTH', gap: 'GAP' };
      trackBadge = `<span class="badge los-fmt" style="background:${subColor}18;color:${subColor};border:1px solid ${subColor}40">${fmtLabels[fmt] || fmt.toUpperCase()}</span><span class="badge los-sub" style="background:${subColor}12;color:${subColor}bb">${sub.toUpperCase()}</span>`;
    } else {
      trackBadge = meta.track === 'educational'
        ? `<span class="badge edu">EDUCATIONAL</span>`
        : `<span class="badge camp">CAMPAIGN</span>`;
    }

    // Topic / hook line
    let topicLine = '';
    if (isLOS) {
      const hookSnippet = (meta.hook || '').slice(0, 110);
      topicLine = hookSnippet ? `<div class="topic los-hook">${esc(hookSnippet)}${(meta.hook || '').length > 110 ? '...' : ''}</div>` : '';
    } else {
      topicLine = meta.topic
        ? `<div class="topic">${esc(meta.topic.title)}${meta.topic.lens
            ? ` <em>· ${esc(meta.topic.lens.split('—')[0].trim())}</em>`
            : ''}</div>`
        : '';
    }

    const captionHtml = caption
      ? `<p class="cap">${esc(caption.slice(0, 140))}${caption.length > 140 ? '…' : ''}</p>`
      : '';

    // Build slide URLs array for inline navigation
    const slideUrls = hasRendered
      ? Array.from({ length: slideCount }, (_, i) =>
          `/${pPrefix}/${date}/${slug}/slide_${i + 1}.png`)
      : [];
    const slideUrlsJson      = JSON.stringify(slideUrls);
    const slideTemplatesJson = JSON.stringify(slideTemplates);

    const thumb = hasRendered
      ? `<img class="thumb" id="thumb-${date}-${slug}"
            src="/${pPrefix}/${date}/${slug}/slide_1.png" loading="lazy">`
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
<div class="card ${isLOS ? 'is-los' : meta.track === 'educational' ? 'is-edu' : 'is-camp'} ${isPosted ? 'is-posted' : ''}"
     data-date="${date}" data-slug="${slug}" data-ship="${pShip}"
     data-slides='${slideUrlsJson}' data-templates='${slideTemplatesJson}'
     data-effects='${JSON.stringify(slideEffects)}'
     data-opacities='${JSON.stringify(slideOverlayOpacities)}'
     data-texts='${JSON.stringify(slideTexts).replace(/'/g, "&#39;")}'
     data-accentslot="${meta.accentSlot ?? 0}"
     data-scheduled="${meta.scheduledAt || ''}"
     data-queueid="${meta.queueId || ''}">

  <div class="card-img" data-idx="0" data-date="${date}" data-slug="${slug}">
    ${thumb}
    ${hasRendered && slideCount > 1 ? `
      <button class="nav-btn nav-prev" onclick="slideNav(this.closest('.card-img'),-1)">&#8249;</button>
      <button class="nav-btn nav-next" onclick="slideNav(this.closest('.card-img'),1)">&#8250;</button>
      <span class="sc" id="sc-${date}-${slug}">1 / ${slideCount}</span>
    ` : slideCount === 1 ? `<span class="sc">1 / 1</span>` : ''}
    ${!isPosted ? `<button class="cancel-btn" onclick="cancelPost('${date}','${slug}',this)" title="Remove">✕</button>` : ''}
  </div>

  <div class="card-body">
    <div class="badges">${trackBadge}${statusBadge(meta)}</div>
    <div class="campaign">${esc(meta.campaign || slug)}</div>
    ${topicLine}
    ${captionHtml}
    <div class="card-actions">
      ${!isPosted ? `<button class="btn-edit" onclick="openEditPanel('${date}','${slug}')">Edit →</button>` : ''}
      ${isLOS ? `
        ${!isPosted && !isApproved && hasRendered ? `<button class="btn-action btn-approve" onclick="markStatus('${date}','${slug}','approved',this)">Approve ✓</button>` : ''}
        ${isApproved ? `<button class="btn-action btn-post" onclick="markStatus('${date}','${slug}','posted',this)">Mark Posted</button>` : ''}
      ` : `
        ${!isPosted && !isApproved && hasRendered ? `<button class="btn-action btn-approve" onclick="openQueueModal('${date}','${slug}')">Queue →</button>` : ''}
        ${isApproved ? `
          ${meta.scheduledAt
            ? `<div class="autopost-label">
                 <span class="autopost-icon">⏰</span>
                 <span class="autopost-time">Auto-posts ${new Date(meta.scheduledAt).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'})}</span>
                 <button class="reschedule-btn" onclick="openQueueModal('${date}','${slug}')">Reschedule</button>
               </div>`
            : `<div class="no-schedule-label">
                 <span>⚠ No post date — won't auto-post</span>
                 <button class="reschedule-btn" onclick="openQueueModal('${date}','${slug}')">Set Date →</button>
               </div>`}
          <button class="btn-action btn-post-ig" id="igpost-${date}-${slug}"
            onclick="postToIG('${date}','${slug}',this)">▶ Post Now</button>
          <button class="btn-action btn-post" onclick="markStatus('${date}','${slug}','posted',this)">Mark Posted</button>
        ` : ''}
      `}
      ${hasPreview ? `<a class="btn-preview" href="/${pPrefix}/${date}/${slug}/preview.html" target="_blank">Preview →</a>` : ''}
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
<title>${shipCfg.label} Post Queue</title>
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
.is-los{border-left:3px solid #0071E3}
.los-hook{font-size:11px;color:#5AC8FA88;line-height:1.4;font-style:italic}
.ship-selector{display:flex;gap:4px;border:1px solid #252525;border-radius:5px;overflow:hidden;margin-right:8px}
.ship-btn{padding:5px 12px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:none;background:#161616;color:#555;cursor:pointer;transition:.15s}
.ship-btn:hover{color:#aaa}
.ship-btn.active-otl{background:#003566;color:#fff}
.ship-btn.active-los{background:#0071E3;color:#fff}
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
.sbar-hidden{display:none!important}
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
.scheduled-label{font-size:10px;color:#3d883d;letter-spacing:.04em;padding:3px 0;width:100%}
.autopost-label{display:flex;align-items:center;gap:6px;background:#0a1f0a;border:1px solid #1e4a1e;border-radius:4px;padding:5px 8px;width:100%;margin-bottom:2px;flex-wrap:wrap}
.autopost-icon{font-size:12px;flex-shrink:0}
.autopost-time{font-size:10px;font-weight:600;color:#4ade80;letter-spacing:.03em;flex:1}
.no-schedule-label{display:flex;align-items:center;gap:6px;background:#1f0a0a;border:1px solid #4a1e1e;border-radius:4px;padding:5px 8px;width:100%;margin-bottom:2px;flex-wrap:wrap}
.no-schedule-label span{font-size:10px;font-weight:600;color:#f87171;letter-spacing:.03em;flex:1}
.reschedule-btn{background:transparent;border:1px solid #2a3a2a;color:#4ade8088;font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:3px;cursor:pointer;flex-shrink:0;transition:.15s}
.reschedule-btn:hover{border-color:#4ade80;color:#4ade80}
.no-schedule-label .reschedule-btn{border-color:#4a2a2a;color:#f8717188}
.no-schedule-label .reschedule-btn:hover{border-color:#f87171;color:#f87171}

/* Queue modal */
.qmodal-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:999;align-items:center;justify-content:center}
.qmodal-backdrop.open{display:flex}
.qmodal{background:#161616;border:1px solid #2a2a2a;border-radius:10px;padding:28px;width:360px;max-width:95vw}
.qmodal h3{font-size:13px;font-weight:700;color:#fff;letter-spacing:.06em;text-transform:uppercase;margin-bottom:18px}
.qmodal label{font-size:10px;color:#666;letter-spacing:.07em;text-transform:uppercase;display:block;margin-bottom:6px}
.qmodal input[type=datetime-local]{width:100%;background:#0a0a0a;border:1px solid #2a2a2a;color:#ddd;border-radius:5px;padding:8px 10px;font-size:13px;color-scheme:dark}
.qmodal-actions{display:flex;gap:8px;margin-top:20px}
.qmodal-submit{flex:1;background:#003566;border:none;color:#fff;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:9px;border-radius:5px;cursor:pointer;transition:.15s}
.qmodal-submit:hover{background:#0055a0}
.qmodal-submit:disabled{opacity:.5;cursor:default}
.qmodal-cancel{background:none;border:1px solid #2a2a2a;color:#555;font-size:11px;letter-spacing:.07em;text-transform:uppercase;padding:9px 14px;border-radius:5px;cursor:pointer;transition:.15s}
.qmodal-cancel:hover{border-color:#444;color:#aaa}
.qmodal-status{font-size:11px;color:#3a7ab8;min-height:16px;margin-top:10px;text-align:center}
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

/* Change Photo button */
.pick-photo-btn{width:100%;margin-top:4px;background:#111;border:1px dashed #2a2a2a;color:#556;padding:6px 10px;border-radius:4px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;cursor:pointer;transition:.15s;text-align:left}
.pick-photo-btn:hover{border-color:#003566;color:#3a7ab8;background:#0d1a2e}

/* Photo picker modal */
.photo-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:1000;align-items:flex-start;justify-content:center;padding-top:40px;overflow-y:auto}
.photo-modal.open{display:flex}
.photo-modal-inner{background:#161616;border:1px solid #252525;border-radius:12px;width:min(960px,96vw);padding:24px;position:relative;flex-shrink:0}
.photo-modal-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.photo-modal-header h3{font-size:13px;font-weight:700;color:#fff;letter-spacing:.06em;text-transform:uppercase;flex:1;margin:0}
.photo-search{flex:1;max-width:300px;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:5px;color:#ddd;font-size:12px;padding:7px 10px;font-family:inherit}
.photo-search:focus{outline:none;border-color:#003566}
.photo-modal-close{background:none;border:1px solid #2a2a2a;color:#666;width:28px;height:28px;border-radius:50%;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;flex-shrink:0}
.photo-modal-close:hover{border-color:#666;color:#fff}
.photo-modal-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.photo-tag-btn{padding:3px 9px;background:#111;border:1px solid #252525;color:#555;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;transition:.15s}
.photo-tag-btn:hover,.photo-tag-btn.active{background:#003566;border-color:#003566;color:#fff}
.photo-grid-modal{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:4px}
.photo-grid-modal img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer;border:3px solid transparent;transition:.15s;display:block}
.photo-grid-modal img:hover{border-color:#555;transform:scale(1.02)}
.photo-grid-modal img.selected{border-color:#e63946}
.photo-modal-footer{display:flex;align-items:center;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid #1e1e1e}
.photo-load-more{background:#161616;border:1px solid #252525;color:#666;padding:7px 16px;border-radius:4px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;cursor:pointer;transition:.15s}
.photo-load-more:hover{background:#222;color:#aaa;border-color:#444}
.photo-modal-status{font-size:11px;color:#555;flex:1}
.photo-upload-label{background:none;border:1px dashed #333;color:#556;padding:7px 14px;border-radius:4px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;cursor:pointer;transition:.15s;white-space:nowrap}
.photo-upload-label:hover{border-color:#003566;color:#3a7ab8}

/* Upload tag picker */
.upload-tags{display:flex;flex-direction:column;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid #1e1e1e}
.upload-tag-group label:first-child{font-size:9px;font-weight:700;color:#555;letter-spacing:.09em;text-transform:uppercase;display:block;margin-bottom:6px}
.upload-tag-chips{display:flex;flex-wrap:wrap;gap:5px}
.upload-tag-chips label{display:flex;align-items:center;gap:4px;font-size:10px;color:#777;cursor:pointer;padding:3px 8px;border:1px solid #252525;border-radius:14px;transition:.15s}
.upload-tag-chips label:hover{border-color:#444;color:#ccc}
.upload-tag-chips input[type=checkbox]{accent-color:#003566;cursor:pointer}
.upload-tag-chips input[type=checkbox]:checked + span{color:#fff}
.upload-quality-select{background:#0d0d0d;border:1px solid #252525;border-radius:4px;color:#ccc;font-size:11px;padding:5px 8px;width:auto}

/* Edit button on cards */
.btn-edit{background:#003566;border:1px solid #0055a0;color:#fff;padding:5px 11px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;cursor:pointer;transition:.15s}
.btn-edit:hover{background:#0055a0}

/* Grid shifts when panel open */
.grid.panel-open{margin-right:432px}

/* Edit panel — fixed right drawer */
.ep{position:fixed;top:0;right:-440px;width:420px;height:100vh;background:#111;border-left:1px solid #1e1e1e;display:flex;flex-direction:column;z-index:100;transition:right .25s cubic-bezier(.4,0,.2,1);box-shadow:-4px 0 24px rgba(0,0,0,.6)}
.ep.open{right:0}
.ep-header{padding:14px 16px 10px;border-bottom:1px solid #1e1e1e;display:flex;align-items:flex-start;gap:10px;flex-shrink:0}
.ep-close{background:none;border:1px solid #2a2a2a;color:#555;width:26px;height:26px;border-radius:50%;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s;margin-top:2px}
.ep-close:hover{border-color:#666;color:#ccc}
.ep-hinfo{flex:1;min-width:0}
.ep-title{font-size:11px;font-weight:700;color:#ccc;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}
.ep-nav{display:flex;align-items:center;gap:6px}
.ep-nav button{background:#161616;border:1px solid #252525;color:#777;width:22px;height:22px;border-radius:3px;font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
.ep-nav button:hover{background:#222;color:#ccc;border-color:#444}
.ep-nav-counter{font-size:10px;color:#444;letter-spacing:.06em}
.ep-tmpl{font-size:9px;color:#333;letter-spacing:.07em;margin-top:3px}
.ep-thumb-wrap{flex-shrink:0;background:#0a0a0a;border-bottom:1px solid #1e1e1e;aspect-ratio:4/5;max-height:200px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.ep-thumb{width:100%;height:100%;object-fit:contain;display:block}
.ep-scroll{flex:1;overflow-y:auto;display:flex;flex-direction:column}
.ep-scroll::-webkit-scrollbar{width:4px}.ep-scroll::-webkit-scrollbar-thumb{background:#222;border-radius:2px}
.ep-section{padding:12px 16px;border-bottom:1px solid #161616;display:flex;flex-direction:column;gap:7px}
.ep-section-title{font-size:8px;font-weight:700;color:#444;letter-spacing:.12em;text-transform:uppercase}
.ep-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ep-label{font-size:9px;font-weight:700;color:#444;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.ep-field{display:flex;flex-direction:column;gap:3px}
.ep-textarea{width:100%;background:#0d0d0d;border:1px solid #222;border-radius:4px;color:#ccc;font-size:12px;padding:7px 9px;resize:vertical;font-family:inherit;line-height:1.4;min-height:36px}
.ep-textarea:focus{outline:none;border-color:#003566}
.ep-btn{background:#161616;border:1px solid #252525;color:#888;padding:4px 10px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:.15s;white-space:nowrap}
.ep-btn:hover{background:#1e1e1e;color:#ccc;border-color:#444}
.ep-btn:disabled{opacity:.4;cursor:default}
.ep-btn-photo{border-color:#1a2a1a;color:#558855}
.ep-btn-photo:hover{background:#0d1a0d;color:#77bb77;border-color:#2a4a2a}
.ep-btn-save{background:#003566;border-color:#0055a0;color:#fff}
.ep-btn-save:hover{background:#0055a0}
.ep-btn-full{width:100%;text-align:center;padding:7px}
.ep-btn-gen{border-color:#2a1a40;color:#8866bb}
.ep-btn-gen:hover{background:#1a0d2e;color:#aa88dd;border-color:#4a2a70}
.ep-btn-regen{border-color:#2a2a1a;color:#777733}
.ep-btn-regen:hover{background:#1a1a0a;color:#aaaa55;border-color:#4a4a1a}
.ep-slider{flex:1;accent-color:#003566;height:3px;cursor:pointer}
.ep-slider-val{font-size:9px;font-weight:700;color:#555;letter-spacing:.06em;min-width:30px;text-align:right}
.ep-sm-btn{width:22px;height:22px;background:#161616;border:1px solid #252525;color:#666;border-radius:3px;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s}
.ep-sm-btn:hover{background:#222;color:#ccc;border-color:#444}
.ep-fx-btns{display:flex;flex-wrap:wrap;gap:4px}
.ep-fx-btn{padding:3px 8px;background:#111;border:1px solid #252525;color:#555;border-radius:3px;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;transition:.15s}
.ep-fx-btn:hover{background:#1a1a1a;color:#aaa;border-color:#444}
.ep-fx-btn.ep-fx-active{background:#0d0d2a;border-color:#003566;color:#6699ff}
.ep-swatch-row{display:flex;gap:5px;flex-wrap:wrap}
.ep-swatch{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer;transition:.15s;flex-shrink:0}
.ep-swatch:hover{transform:scale(1.15)}
.ep-swatch.ep-swatch-active{border-color:#fff;box-shadow:0 0 0 1px #555}
.ep-footer{border-bottom:none}
.ep-status{font-size:11px;color:#556;padding:8px 16px;min-height:20px;flex-shrink:0}
.ep-status.ok{color:#3d883d}
.ep-status.err{color:#883333}
.ep-status.running{color:#3a7ab8;animation:pulse 1.5s infinite}
</style>
</head>
<body>

<header>
  <div class="ship-selector">
    <button class="ship-btn ${ship === 'otl' ? 'active-otl' : ''}" onclick="location.href='/?ship=otl'">OTL</button>
    <button class="ship-btn ${ship === 'los' ? 'active-los' : ''}" onclick="location.href='/?ship=los'">LOS</button>
    <button class="ship-btn" onclick="location.href='/scheduled'" style="border-color:#10B98144;color:#10B981">Queue</button>
    <button class="ship-btn" onclick="location.href='/calendar'" style="border-color:#7C3AED44;color:#7C3AED">Calendar</button>
  </div>
  <div class="logo"><span>${shipCfg.handle}</span> Post Queue</div>
  <div class="stats">
    <div class="stat"><div class="sn">${total}</div><div class="sl">Total</div></div>
    <div class="stat"><div class="sn" style="color:#777733">${staged}</div><div class="sl">Draft</div></div>
    <div class="stat"><div class="sn" style="color:#3d883d">${rendered}</div><div class="sl">Ready</div></div>
    <div class="stat"><div class="sn" style="color:#5599bb">${approved}</div><div class="sl">Approved</div></div>
    <div class="stat"><div class="sn" style="color:#2277aa">${posted}</div><div class="sl">Posted</div></div>
  </div>
  <div class="filters">
    <button class="fb on" onclick="filter('all',this)">All</button>
    ${ship === 'los' ? `
      <button class="fb" onclick="filter('short',this)">Short</button>
      <button class="fb" onclick="filter('depth',this)">Depth</button>
      <button class="fb" onclick="filter('gap',this)">Gap</button>
    ` : `
      <button class="fb" onclick="filter('edu',this)">Educational</button>
      <button class="fb" onclick="filter('camp',this)">Campaign</button>
    `}
    <button class="fb" title="Generated but not yet rendered to images" onclick="filter('staged',this)">Draft</button>
    <button class="fb" title="Images rendered — ready to review &amp; approve" onclick="filter('rendered',this)">Ready</button>
    <button class="fb" onclick="filter('approved',this)">Approved</button>
    <button class="fb" onclick="filter('posted',this)">Posted</button>
    ${ship === 'otl' ? `
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
    ` : ''}
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
      type === 'staged'   ? !!c.querySelector('.badge.staged') :
      // LOS format filters — match badge text
      ['short','depth','gap'].includes(type) ? !![...c.querySelectorAll('.badge.los-fmt')].find(b => b.textContent.trim().toLowerCase() === type) : true;
    c.style.display = show ? '' : 'none';
  });
}

// ── Slide navigation ──────────────────────────────────────────
function slideNav(imgBox, dir) {
  const slides = JSON.parse((imgBox.closest('.card') || imgBox).dataset.slides || '[]');
  if (!slides.length) return;
  let idx = (parseInt(imgBox.dataset.idx || '0') + dir + slides.length) % slides.length;
  imgBox.dataset.idx = idx;

  const img = imgBox.querySelector('img.thumb');
  if (img) img.src = slides[idx] + '?t=' + Date.now();
  const sc = imgBox.querySelector('.sc');
  if (sc) sc.textContent = (idx + 1) + ' / ' + slides.length;
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
        const t = Date.now();
        const imgBox = document.querySelector(\`.card-img[data-date="\${date}"][data-slug="\${slug}"]\`);
        if (imgBox) {
          const slides = JSON.parse(imgBox.dataset.slides || '[]');
          const busted = slides.map(s => s.split('?')[0] + '?t=' + t);
          imgBox.dataset.slides = JSON.stringify(busted);
          const card = imgBox.closest('.card');
          if (card) card.dataset.slides = JSON.stringify(busted);
          const idx = parseInt(imgBox.dataset.idx || '0');
          const thumb = imgBox.querySelector('img.thumb');
          if (thumb) thumb.src = (busted[idx] || busted[0]);
        }
        // Refresh panel thumbnail if this post is currently open
        if (_pd === date && _ps === slug) {
          _pSlides = _pSlides.map(s => s.split('?')[0] + '?t=' + t);
          refreshPanelThumb();
          showPanelStatus('✓ Done', 'ok');
        }
      } else {
        showSlideStatus(date, slug, '✗ Render failed');
        if (_pd === date && _ps === slug) showPanelStatus('✗ Render failed', 'err');
      }
    }
  }, 1200);
}

// ── Edit panel ────────────────────────────────────────────────
let _pd = null, _ps = null, _pi = 0;
let _pSlides = [], _pTemplates = [], _pEffects = [], _pOverlays = [], _pTexts = [];
const ACCENT_SLOTS_CLIENT = ${accentSlotsJson};

async function openEditPanel(date, slug) {
  _pd = date; _ps = slug; _pi = 0;
  const card = document.querySelector(\`.card[data-date="\${date}"][data-slug="\${slug}"]\`);
  if (!card) return;
  _pSlides    = JSON.parse(card.dataset.slides    || '[]');
  _pTemplates = JSON.parse(card.dataset.templates || '[]');
  _pEffects   = JSON.parse(card.dataset.effects   || '[]');
  _pOverlays  = JSON.parse(card.dataset.opacities || '[]');
  _pTexts     = JSON.parse(card.dataset.texts     || '[]');

  const campaignEl = card.querySelector('.campaign');
  document.getElementById('ep-title').textContent = campaignEl ? campaignEl.textContent : slug;

  document.getElementById('ep').classList.add('open');
  document.getElementById('grid').classList.add('panel-open');

  await updatePanelSlide();

  // Load caption separately (it's stored as caption.txt, not slide text)
  const capEl = card.querySelector('.cap');
  if (capEl) {
    const capText = capEl.textContent.replace(/…$/, '');
    document.getElementById('ep-caption').value = capText;
  }
}

function closeEditPanel() {
  document.getElementById('ep').classList.remove('open');
  document.getElementById('grid').classList.remove('panel-open');
  _pd = null; _ps = null;
}

async function updatePanelSlide() {
  if (!_pd || !_ps) return;
  const slideUrl = _pSlides[_pi] || '';
  const template = _pTemplates[_pi] || '';
  const effect   = _pEffects[_pi]   || 'none';
  const opacity  = _pOverlays[_pi];

  // Thumbnail
  const thumb = document.getElementById('ep-thumb');
  if (thumb) {
    if (slideUrl) {
      thumb.src = slideUrl.split('?')[0] + '?t=' + Date.now();
      thumb.style.display = '';
    } else {
      thumb.style.display = 'none';
    }
  }

  // Counter + template label
  document.getElementById('ep-counter').textContent = \`\${_pi + 1} / \${Math.max(_pSlides.length, 1)}\`;
  document.getElementById('ep-tmpl').textContent = template;

  // FX buttons
  document.querySelectorAll('#ep-fx .ep-fx-btn').forEach(b =>
    b.classList.toggle('ep-fx-active', b.dataset.fx === effect));

  // World button state (default dark)
  const worldBtn = document.getElementById('ep-world');
  if (worldBtn) { worldBtn.dataset.ovl = 'dark'; worldBtn.textContent = 'Dark'; }

  // Overlay slider
  const pct = opacity != null ? Math.round(opacity * 100) : 62;
  const slider = document.getElementById('ep-ovl-slider');
  const valEl  = document.getElementById('ep-ovl-val');
  if (slider) slider.value = pct;
  if (valEl)  valEl.textContent = pct + '%';

  // Load text from embedded card data (no fetch needed)
  const textData = _pTexts[_pi] || {};
  document.getElementById('ep-headline').value = textData.headline || '';
  document.getElementById('ep-subhead').value  = textData.subhead  || '';

  // Subhead style button reset
  const ssBtn = document.getElementById('ep-subhead-style');
  if (ssBtn) { ssBtn.dataset.style = 'stroke'; ssBtn.textContent = 'Stroke'; }

  // Accent swatches
  renderAccentSwatches();
}

async function panelSlideNav(dir) {
  if (!_pSlides.length) return;
  _pi = (_pi + dir + _pSlides.length) % _pSlides.length;
  const imgBox = document.querySelector(\`.card-img[data-date="\${_pd}"][data-slug="\${_ps}"]\`);
  if (imgBox) { imgBox.dataset.idx = _pi; const sc = imgBox.querySelector('.sc'); if (sc) sc.textContent = (_pi+1)+' / '+_pSlides.length; }
  await updatePanelSlide();
}

async function panelSetEffect(fx, btn) {
  if (!_pd || !_ps) return;
  showPanelStatus('Applying effect…', 'running');
  const r = await fetch('/api/slide-effect', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, effect: fx }),
  });
  const j = await r.json();
  if (j.ok) {
    _pEffects[_pi] = fx;
    document.querySelectorAll('#ep-fx .ep-fx-btn').forEach(b =>
      b.classList.toggle('ep-fx-active', b.dataset.fx === fx));
    const card = document.querySelector(\`.card[data-date="\${_pd}"][data-slug="\${_ps}"]\`);
    if (card) card.dataset.effects = JSON.stringify(_pEffects);
    showPanelStatus('Rendering…', 'running');
    autoRender(_pd, _ps);
  } else {
    showPanelStatus('✗ ' + (j.error || 'Effect failed'), 'err');
  }
}

async function panelToggleWorld() {
  if (!_pd || !_ps) return;
  const btn = document.getElementById('ep-world');
  const next = btn.dataset.ovl === 'dark' ? 'light' : 'dark';
  const r = await fetch('/api/slide-world', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, world: next }),
  });
  const j = await r.json();
  if (j.ok) {
    btn.dataset.ovl = next;
    btn.textContent = next === 'light' ? 'Light' : 'Dark';
    showPanelStatus('Rendering…', 'running');
    autoRender(_pd, _ps);
  }
}

async function panelCycleSubhead() {
  if (!_pd || !_ps) return;
  const btn = document.getElementById('ep-subhead-style');
  const order = ['stroke','color','solid'];
  const cur   = btn.dataset.style || 'stroke';
  const next  = order[(order.indexOf(cur) + 1) % order.length];
  btn.dataset.style = next;
  btn.textContent   = next.charAt(0).toUpperCase() + next.slice(1);
  const r = await fetch('/api/slide-subhead-style', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, subheadStyle: next }),
  });
  const j = await r.json();
  if (j.ok) { showPanelStatus('Rendering…', 'running'); autoRender(_pd, _ps); }
}

async function panelSaveOverlay() {
  if (!_pd || !_ps) return;
  const opacity = Math.round(document.getElementById('ep-ovl-slider').value) / 100;
  _pOverlays[_pi] = opacity;
  const r = await fetch('/api/slide-overlay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, overlayOpacity: opacity }),
  });
  const j = await r.json();
  if (j.ok) { showPanelStatus('Rendering…', 'running'); autoRender(_pd, _ps); }
}

async function panelFontAdjust(field, delta) {
  if (!_pd || !_ps) return;
  const r = await fetch('/api/slide-font', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, field, delta }),
  });
  const j = await r.json();
  if (j.ok) { showPanelStatus('Rendering…', 'running'); autoRender(_pd, _ps); }
}

async function panelSaveText() {
  if (!_pd || !_ps) return;
  const headline = document.getElementById('ep-headline').value;
  const subhead  = document.getElementById('ep-subhead').value;
  showPanelStatus('Saving…', 'running');
  const r = await fetch('/api/slide-text', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, headline, subhead }),
  });
  const j = await r.json();
  if (j.ok) {
    // Keep local cache in sync so nav stays accurate
    if (!_pTexts[_pi]) _pTexts[_pi] = {};
    _pTexts[_pi].headline = j.headline || '';
    _pTexts[_pi].subhead  = j.subhead  || '';
    // Update card data-texts too
    const card = document.querySelector(\`.card[data-date="\${_pd}"][data-slug="\${_ps}"]\`);
    if (card) card.dataset.texts = JSON.stringify(_pTexts);
    showPanelStatus('Rendering…', 'running');
    autoRender(_pd, _ps);
  } else showPanelStatus('✗ ' + (j.error || 'Error'), 'err');
}

async function panelClearText() {
  if (!_pd || !_ps) return;
  showPanelStatus('Clearing…', 'running');
  const r = await fetch('/api/slide-text', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, headline: null, subhead: null }),
  });
  const j = await r.json();
  if (j.ok) {
    const hl = j.headline || '';
    const sh = j.subhead  || '';
    document.getElementById('ep-headline').value = hl;
    document.getElementById('ep-subhead').value  = sh;
    if (!_pTexts[_pi]) _pTexts[_pi] = {};
    _pTexts[_pi].headline = hl;
    _pTexts[_pi].subhead  = sh;
    const card = document.querySelector(\`.card[data-date="\${_pd}"][data-slug="\${_ps}"]\`);
    if (card) card.dataset.texts = JSON.stringify(_pTexts);
    showPanelStatus('Rendering…', 'running');
    autoRender(_pd, _ps);
  }
}

async function panelRework() {
  if (!_pd || !_ps) return;
  const instruction = document.getElementById('ep-rework').value.trim();
  if (!instruction) return;
  const btn = document.getElementById('ep-rework-btn');
  if (btn) { btn.textContent = 'Working…'; btn.disabled = true; }
  showPanelStatus('Claude is reworking slide ' + (_pi + 1) + '…', 'running');
  const r = await fetch('/api/slide-rework', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, instruction }),
  });
  const json = await r.json();
  if (btn) { btn.textContent = 'Rework slide →'; btn.disabled = false; }
  if (json.ok) {
    document.getElementById('ep-rework').value = '';
    showPanelStatus('Rendering…', 'running');
    autoRender(_pd, _ps);
  } else {
    showPanelStatus('✗ ' + (json.error || 'Error'), 'err');
  }
}

async function panelGenerateImage() {
  if (!_pd || !_ps) return;
  const imageDirection = document.getElementById('ep-imgdir').value.trim();
  const btn = document.getElementById('ep-gen-btn');
  if (btn) { btn.textContent = '✦ Generating…'; btn.disabled = true; }
  showPanelStatus('Generating image…', 'running');
  const r = await fetch('/api/slide-generate-image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, imageDirection }),
  });
  const json = await r.json();
  if (btn) { btn.textContent = '✦ Generate Image'; btn.disabled = false; }
  if (json.ok) {
    showPanelStatus('✓ Image generated — rendering…', 'ok');
    if (json.jobId) {
      const poll = setInterval(async () => {
        const j = await (await fetch(\`/api/job/\${json.jobId}\`)).json();
        if (j.done) {
          clearInterval(poll);
          if (j.ok) { showPanelStatus('✓ Done', 'ok'); refreshPanelThumb(); }
          else showPanelStatus('✗ Render failed', 'err');
        }
      }, 1500);
    }
  } else {
    showPanelStatus('✗ ' + (json.error || 'Error'), 'err');
  }
}

async function panelSetAccent(slot) {
  if (!_pd || !_ps) return;
  const color = ACCENT_SLOTS_CLIENT[slot]?.accent;
  if (!color) return;
  const r = await fetch('/api/post-accent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, accentSlot: slot, accentColor: color }),
  });
  const j = await r.json();
  if (j.ok) {
    const card = document.querySelector(\`.card[data-date="\${_pd}"][data-slug="\${_ps}"]\`);
    if (card) card.dataset.accentslot = slot;
    renderAccentSwatches();
    showPanelStatus('Rendering…', 'running');
    autoRender(_pd, _ps);
  }
}

function renderAccentSwatches() {
  const card = _pd && _ps ? document.querySelector(\`.card[data-date="\${_pd}"][data-slug="\${_ps}"]\`) : null;
  const activeSlot = parseInt(card?.dataset.accentslot ?? 0);
  const container = document.getElementById('ep-swatches');
  if (!container) return;
  container.innerHTML = ACCENT_SLOTS_CLIENT.map((s, i) =>
    \`<button class="ep-swatch \${i === activeSlot ? 'ep-swatch-active' : ''}"
      title="\${s.label}" style="background:\${s.accent};border-color:\${i === activeSlot ? '#fff' : 'transparent'}"
      onclick="panelSetAccent(\${i})"></button>\`
  ).join('');
}

async function panelTextOnly() {
  if (!_pd || !_ps) return;
  const r = await fetch('/api/slide-photo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, photo: '', template: 'BoldStatement' }),
  });
  const j = await r.json();
  if (j.ok) { showPanelStatus('Rendering…', 'running'); autoRender(_pd, _ps); }
}

async function panelRestorePhoto() {
  if (!_pd || !_ps) return;
  const r = await fetch('/api/slide-photo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, slideIdx: _pi, photo: null, template: null }),
  });
  const j = await r.json();
  if (j.ok) { showPanelStatus('Rendering…', 'running'); autoRender(_pd, _ps); }
}

async function panelSaveCaption() {
  if (!_pd || !_ps) return;
  const caption = document.getElementById('ep-caption').value;
  await fetch('/api/caption', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: _pd, slug: _ps, caption }),
  });
  showPanelStatus('✓ Caption saved', 'ok');
  const card = document.querySelector(\`.card[data-date="\${_pd}"][data-slug="\${_ps}"]\`);
  const capEl = card?.querySelector('.cap');
  if (capEl) capEl.textContent = (caption || '').slice(0, 140) + (caption.length > 140 ? '…' : '');
}

async function panelRegenerate() {
  if (!_pd || !_ps) return;
  const btn = document.getElementById('ep-regen-btn');
  if (btn) { btn.textContent = 'Regenerating…'; btn.disabled = true; }
  showPanelStatus('Regenerating post…', 'running');
  const { jobId } = await api('regenerate', _pd, _ps, {});
  if (!jobId) { if (btn) { btn.textContent = 'Regenerate post'; btn.disabled = false; } return; }
  const poll = setInterval(async () => {
    const j = await (await fetch(\`/api/job/\${jobId}\`)).json();
    if (j.done) {
      clearInterval(poll);
      if (btn) { btn.textContent = 'Regenerate post'; btn.disabled = false; }
      if (j.ok) { showPanelStatus('✓ Done — reloading…', 'ok'); setTimeout(() => location.reload(), 800); }
      else showPanelStatus('✗ ' + j.log.slice(-200), 'err');
    }
  }, 1400);
}

function showPanelStatus(msg, type) {
  const el = document.getElementById('ep-status');
  if (el) { el.textContent = msg; el.className = 'ep-status ' + (type || 'ok'); }
}

function refreshPanelThumb() {
  if (!_pd || !_ps) return;
  const thumb = document.getElementById('ep-thumb');
  if (thumb && _pSlides[_pi]) thumb.src = _pSlides[_pi].split('?')[0] + '?t=' + Date.now();
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

// ── Photo picker modal ────────────────────────────────────────
let _pickerDate = null, _pickerSlug = null;
let _pickerTag  = '';
let _pickerOffset = 0;
let _pickerTotal  = 0;
let _searchTimer  = null;
let _pendingUploadFile = null;

function openPhotoPicker(date, slug) {
  _pickerDate   = date;
  _pickerSlug   = slug;
  _pickerTag    = '';
  _pickerOffset = 0;
  _pickerTotal  = 0;
  document.getElementById('photo-modal').classList.add('open');
  document.getElementById('photo-search').value = '';
  document.getElementById('modal-upload-tags').style.display = 'none';
  _pendingUploadFile = null;
  // Reset tag filter buttons
  document.querySelectorAll('.photo-tag-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.photo-tag-btn[data-tag=""]').classList.add('active');
  loadPhotos(true);
}

function closePhotoPicker() {
  document.getElementById('photo-modal').classList.remove('open');
  _pickerDate = null; _pickerSlug = null;
}

function setPhotoTag(btn) {
  document.querySelectorAll('.photo-tag-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _pickerTag = btn.dataset.tag;
  _pickerOffset = 0;
  loadPhotos(true);
}

function debounceLoadPhotos() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _pickerOffset = 0; loadPhotos(true); }, 400);
}

async function loadPhotos(reset = false) {
  if (reset) _pickerOffset = 0;
  const grid   = document.getElementById('photo-grid-modal');
  const status = document.getElementById('photo-modal-status');
  const moreBtn = document.getElementById('photo-load-more');
  const q = document.getElementById('photo-search').value.trim() || _pickerTag;

  if (reset) {
    grid.innerHTML = '<div style="color:#333;font-size:12px;padding:20px 0">Loading…</div>';
    moreBtn.style.display = 'none';
  }

  status.textContent = 'Loading…';
  try {
    const res  = await fetch(\`/api/photos?q=\${encodeURIComponent(q)}&limit=60&skip=\${_pickerOffset}\`);
    const data = await res.json();
    _pickerTotal = data.total || 0;

    if (reset) grid.innerHTML = '';
    if (!data.photos?.length && _pickerOffset === 0) {
      grid.innerHTML = '<div style="color:#333;font-size:12px;padding:20px 0">No photos found — try a different tag or upload a new one.</div>';
      status.textContent = '0 photos';
      moreBtn.style.display = 'none';
      return;
    }

    data.photos.forEach(p => {
      const img = document.createElement('img');
      img.src   = p.thumb;
      img.title = (p.tags || []).join(', ') || p.publicId;
      img.loading = 'lazy';
      img.onclick = () => pickPhoto(p.raw, img);
      grid.appendChild(img);
    });

    _pickerOffset += data.photos.length;
    const showing = _pickerOffset;
    status.textContent = \`Showing \${showing} of \${_pickerTotal}\`;
    moreBtn.style.display = _pickerOffset < _pickerTotal ? '' : 'none';
  } catch (e) {
    status.textContent = '✗ ' + e.message;
  }
}

function loadMorePhotos() { loadPhotos(false); }

async function pickPhoto(rawUrl, imgEl) {
  if (!_pickerDate || !_pickerSlug) return;
  // Mark selected
  document.querySelectorAll('#photo-grid-modal img').forEach(i => i.classList.remove('selected'));
  imgEl.classList.add('selected');
  // Apply to current slide
  await setSlidePhoto(_pickerDate, _pickerSlug, rawUrl, null);
  document.getElementById('photo-modal-status').textContent = '✓ Photo set';
  // Close after brief confirmation
  setTimeout(closePhotoPicker, 600);
  // Auto-render (panel handles status if open)
  if (_pd === _pickerDate && _ps === _pickerSlug) {
    showPanelStatus('Rendering…', 'running');
  }
  autoRender(_pickerDate, _pickerSlug);
}

// Upload from modal
function uploadPhotoModal(input) {
  const file = input.files[0];
  if (!file) return;
  _pendingUploadFile = file;
  document.getElementById('modal-upload-tags').style.display = '';
  document.getElementById('modal-upload-submit').textContent = 'Upload ' + file.name;
  input.value = '';
}

function cancelUploadModal() {
  _pendingUploadFile = null;
  document.getElementById('modal-upload-tags').style.display = 'none';
}

async function submitUploadModal() {
  if (!_pendingUploadFile) return;
  const file = _pendingUploadFile;
  const btn  = document.getElementById('modal-upload-submit');
  const status = document.getElementById('photo-modal-status');

  const quality = document.getElementById('modal-upload-quality').value;
  const checks  = [...document.querySelectorAll('#modal-upload-tags .upload-tag-chips input:checked')].map(i => i.value);
  const tags    = [quality, ...checks];

  btn.textContent = 'Uploading…';
  btn.disabled = true;
  status.textContent = 'Uploading to Cloudinary…';

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    try {
      const res  = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data: base64, tags }),
      });
      const json = await res.json();
      btn.textContent = 'Upload →';
      btn.disabled = false;
      if (!json.ok) { status.textContent = '✗ Upload failed: ' + json.error; return; }

      const photoUrl = json.cloudinaryUrl || json.path;
      status.textContent = json.cloudinaryUrl ? '✓ Uploaded — effects available' : '✓ Uploaded (local only)';
      document.getElementById('modal-upload-tags').style.display = 'none';
      _pendingUploadFile = null;

      // Add to grid and auto-select
      const thumb = json.cloudinaryUrl
        ? json.cloudinaryUrl.replace('/upload/', '/upload/c_fill,w_200,h_200/')
        : '/assets/photos/' + json.filename;
      const grid = document.getElementById('photo-grid-modal');
      const img  = document.createElement('img');
      img.src    = thumb;
      img.title  = json.filename + ' ✓ Cloudinary';
      img.onclick = () => pickPhoto(photoUrl, img);
      grid.prepend(img);
      pickPhoto(photoUrl, img);
    } catch (err) {
      btn.textContent = 'Upload →';
      btn.disabled = false;
      status.textContent = '✗ ' + err.message;
    }
  };
  reader.readAsDataURL(file);
}

// ── Queue modal ───────────────────────────────────────────────
let _qDate = null, _qSlug = null;

function openQueueModal(date, slug) {
  _qDate = date; _qSlug = slug;
  const pad = n => String(n).padStart(2,'0');

  // Try to pre-populate from card's data-scheduled (set by generate-next.js)
  const card = document.querySelector(\`.card[data-date="\${date}"][data-slug="\${slug}"]\`);
  const existing = card?.dataset?.scheduled;
  const isReschedule = card?.dataset?.queueid;

  let dt;
  if (existing) {
    dt = new Date(existing);
  } else {
    // Default: 7am tomorrow local time
    dt = new Date();
    dt.setDate(dt.getDate() + 1);
    dt.setHours(7, 0, 0, 0);
  }
  const local = \`\${dt.getFullYear()}-\${pad(dt.getMonth()+1)}-\${pad(dt.getDate())}T\${pad(dt.getHours())}:\${pad(dt.getMinutes())}\`;
  document.getElementById('qmodal-dt').value = local;
  document.getElementById('qmodal-status').textContent = '';
  document.getElementById('qmodal-submit').textContent = isReschedule ? 'Reschedule →' : 'Queue it →';
  document.getElementById('qmodal-backdrop').classList.add('open');
}

function closeQueueModal() {
  document.getElementById('qmodal-backdrop').classList.remove('open');
  _qDate = null; _qSlug = null;
}

async function submitQueueModal() {
  const dtVal = document.getElementById('qmodal-dt').value;
  if (!dtVal) return;
  const scheduledAt = new Date(dtVal).toISOString();
  const btn = document.getElementById('qmodal-submit');
  const statusEl = document.getElementById('qmodal-status');
  btn.disabled = true;

  // If already approved (has queueId), reschedule instead of re-uploading
  const card = document.querySelector(\`.card[data-date="\${_qDate}"][data-slug="\${_qSlug}"]\`);
  const isReschedule = !!card?.dataset?.queueid;
  const endpoint = isReschedule ? '/api/reschedule-post' : '/api/approve-post';

  statusEl.textContent = isReschedule ? 'Rescheduling…' : 'Uploading slides…';
  statusEl.style.color = '#3a7ab8';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: _qDate, slug: _qSlug, scheduledAt }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed');
    statusEl.style.color = '#3d883d';
    statusEl.textContent = isReschedule ? '✓ Rescheduled!' : '✓ Queued!';
    setTimeout(() => { closeQueueModal(); location.reload(); }, 1200);
  } catch (e) {
    statusEl.style.color = '#883333';
    statusEl.textContent = '✗ ' + e.message;
    btn.disabled = false;
  }
}
</script>

<!-- Queue schedule modal -->
<div class="qmodal-backdrop" id="qmodal-backdrop" onclick="if(event.target===this)closeQueueModal()">
  <div class="qmodal">
    <h3>Schedule Post</h3>
    <label>Post date &amp; time (your local time)</label>
    <input type="datetime-local" id="qmodal-dt">
    <div class="qmodal-status" id="qmodal-status"></div>
    <div class="qmodal-actions">
      <button class="qmodal-cancel" onclick="closeQueueModal()">Cancel</button>
      <button class="qmodal-submit" id="qmodal-submit" onclick="submitQueueModal()">Queue it →</button>
    </div>
  </div>
</div>

<!-- Edit panel (single shared fixed drawer) -->
<div id="ep" class="ep">
  <div class="ep-header">
    <button class="ep-close" onclick="closeEditPanel()">✕</button>
    <div class="ep-hinfo">
      <div class="ep-title" id="ep-title">—</div>
      <div class="ep-nav">
        <button onclick="panelSlideNav(-1)">‹</button>
        <span id="ep-counter" class="ep-nav-counter">— / —</span>
        <button onclick="panelSlideNav(1)">›</button>
      </div>
      <div class="ep-tmpl" id="ep-tmpl"></div>
    </div>
  </div>
  <div class="ep-thumb-wrap">
    <img id="ep-thumb" class="ep-thumb" src="" alt="" style="display:none">
  </div>
  <div class="ep-scroll">

    <!-- PHOTO -->
    <div class="ep-section">
      <div class="ep-section-title">PHOTO</div>
      <div class="ep-row">
        <button class="ep-btn ep-btn-photo" onclick="openPhotoPicker(_pd,_ps)">📷 Change Photo</button>
        <button class="ep-btn" onclick="panelTextOnly()">Text only</button>
        <button class="ep-btn" onclick="panelRestorePhoto()">Restore photo</button>
      </div>
      <div class="ep-fx-btns" id="ep-fx">
        ${['none','portrait_blur','portrait_black','portrait_bw_blur','black_and_white','dramatic','art_noir','vignette','remove_bg'].map(fx => {
          const labels = { none:'Original', portrait_blur:'Blur BG', portrait_black:'Black BG', portrait_bw_blur:'B&W Blur', black_and_white:'B&W', dramatic:'Dramatic', art_noir:'Noir', vignette:'Vignette', remove_bg:'No BG' };
          return `<button class="ep-fx-btn" data-fx="${fx}" onclick="panelSetEffect('${fx}',this)">${labels[fx]}</button>`;
        }).join('')}
      </div>
    </div>

    <!-- STYLE -->
    <div class="ep-section">
      <div class="ep-section-title">STYLE</div>
      <div class="ep-row">
        <span class="ep-label">World</span>
        <button class="ep-btn" id="ep-world" data-ovl="dark" onclick="panelToggleWorld()">Dark</button>
        <span class="ep-label" style="margin-left:8px">Line 2</span>
        <button class="ep-btn" id="ep-subhead-style" data-style="stroke" onclick="panelCycleSubhead()">Stroke</button>
      </div>
      <div class="ep-row">
        <span class="ep-label">Overlay</span>
        <input type="range" id="ep-ovl-slider" class="ep-slider" min="0" max="100" value="62" step="1"
          oninput="document.getElementById('ep-ovl-val').textContent=this.value+'%'"
          onchange="panelSaveOverlay()">
        <span id="ep-ovl-val" class="ep-slider-val">62%</span>
      </div>
      <div class="ep-row">
        <span class="ep-label">H</span>
        <button class="ep-sm-btn" onclick="panelFontAdjust('headlineFontScale',-0.1)">−</button>
        <button class="ep-sm-btn" onclick="panelFontAdjust('headlineFontScale',0.1)">+</button>
        <span class="ep-label" style="margin-left:8px">Body</span>
        <button class="ep-sm-btn" onclick="panelFontAdjust('subheadFontScale',-0.1)">−</button>
        <button class="ep-sm-btn" onclick="panelFontAdjust('subheadFontScale',0.1)">+</button>
      </div>
      <div class="ep-row">
        <span class="ep-label">Accent</span>
        <div class="ep-swatch-row" id="ep-swatches"></div>
      </div>
    </div>

    <!-- TEXT -->
    <div class="ep-section">
      <div class="ep-section-title">TEXT</div>
      <div class="ep-field">
        <label class="ep-label">Headline</label>
        <textarea class="ep-textarea" id="ep-headline" rows="2" placeholder="Headline…"></textarea>
      </div>
      <div class="ep-field">
        <label class="ep-label">Subhead / Body</label>
        <textarea class="ep-textarea" id="ep-subhead" rows="3" placeholder="Subhead or body text…"></textarea>
      </div>
      <div class="ep-row">
        <button class="ep-btn ep-btn-save" onclick="panelSaveText()">Save text</button>
        <button class="ep-btn" onclick="panelClearText()">Clear overrides</button>
      </div>
    </div>

    <!-- REWORK -->
    <div class="ep-section">
      <div class="ep-section-title">REWORK WITH CLAUDE</div>
      <textarea class="ep-textarea" id="ep-rework" rows="2" placeholder="e.g. stronger headline, focus on community…"></textarea>
      <button class="ep-btn ep-btn-full" id="ep-rework-btn" onclick="panelRework()">Rework slide →</button>
    </div>

    <!-- GENERATE IMAGE -->
    <div class="ep-section">
      <div class="ep-section-title">GENERATE IMAGE</div>
      <textarea class="ep-textarea" id="ep-imgdir" rows="2" placeholder="Direction (optional) — e.g. 'empty gym at dawn'"></textarea>
      <button class="ep-btn ep-btn-full ep-btn-gen" id="ep-gen-btn" onclick="panelGenerateImage()">✦ Generate Image</button>
    </div>

    <!-- CAPTION -->
    <div class="ep-section">
      <div class="ep-section-title">CAPTION</div>
      <textarea class="ep-textarea" id="ep-caption" rows="5" placeholder="Instagram caption…"></textarea>
      <button class="ep-btn" onclick="panelSaveCaption()">Save caption</button>
    </div>

    <!-- FOOTER -->
    <div class="ep-section ep-footer">
      <button class="ep-btn ep-btn-full ep-btn-regen" id="ep-regen-btn" onclick="panelRegenerate()">Regenerate post</button>
    </div>

    <div class="ep-status" id="ep-status"></div>
  </div>
</div>

<!-- Photo picker modal (single shared instance) -->
<div class="photo-modal" id="photo-modal" onclick="if(event.target===this)closePhotoPicker()">
  <div class="photo-modal-inner">
    <div class="photo-modal-header">
      <h3>📷 Choose Photo</h3>
      <input class="photo-search" id="photo-search" type="text"
        placeholder="Search by tag (barbell, group, coach…)"
        oninput="debounceLoadPhotos()">
      <button class="photo-modal-close" onclick="closePhotoPicker()">✕</button>
    </div>
    <div class="photo-modal-tags" id="photo-tag-filters">
      <button class="photo-tag-btn active" data-tag="" onclick="setPhotoTag(this)">All</button>
      <button class="photo-tag-btn" data-tag="intensity" onclick="setPhotoTag(this)">Intensity</button>
      <button class="photo-tag-btn" data-tag="group" onclick="setPhotoTag(this)">Group</button>
      <button class="photo-tag-btn" data-tag="community" onclick="setPhotoTag(this)">Community</button>
      <button class="photo-tag-btn" data-tag="coach" onclick="setPhotoTag(this)">Coach</button>
      <button class="photo-tag-btn" data-tag="barbell" onclick="setPhotoTag(this)">Barbell</button>
      <button class="photo-tag-btn" data-tag="pull-ups" onclick="setPhotoTag(this)">Pull-ups</button>
      <button class="photo-tag-btn" data-tag="kettlebell" onclick="setPhotoTag(this)">Kettlebell</button>
      <button class="photo-tag-btn" data-tag="rowing" onclick="setPhotoTag(this)">Rowing</button>
      <button class="photo-tag-btn" data-tag="running" onclick="setPhotoTag(this)">Running</button>
      <button class="photo-tag-btn" data-tag="murph" onclick="setPhotoTag(this)">Murph</button>
      <button class="photo-tag-btn" data-tag="kids-class" onclick="setPhotoTag(this)">Kids</button>
    </div>
    <div class="photo-grid-modal" id="photo-grid-modal">
      <div style="color:#333;font-size:12px;padding:20px 0">Loading photos…</div>
    </div>
    <div class="photo-modal-footer">
      <button class="photo-load-more" id="photo-load-more" onclick="loadMorePhotos()" style="display:none">Load more</button>
      <div class="photo-modal-status" id="photo-modal-status"></div>
      <label class="photo-upload-label">
        + Upload photo
        <input type="file" accept="image/*" style="display:none" onchange="uploadPhotoModal(this)">
      </label>
    </div>
    <!-- Upload tag picker — shown after file is selected -->
    <div class="upload-tags" id="modal-upload-tags" style="display:none">
      <div class="upload-tag-group">
        <label>Quality</label>
        <select class="upload-quality-select" id="modal-upload-quality">
          <option value="quality:3">3 — OK</option>
          <option value="quality:4" selected>4 — Good</option>
          <option value="quality:5">5 — Hero shot</option>
        </select>
      </div>
      <div class="upload-tag-group">
        <label>Theme</label>
        <div class="upload-tag-chips">
          <label><input type="checkbox" value="group"><span> Group</span></label>
          <label><input type="checkbox" value="community"><span> Community</span></label>
          <label><input type="checkbox" value="coach"><span> Coach</span></label>
          <label><input type="checkbox" value="intensity"><span> Intensity</span></label>
          <label><input type="checkbox" value="kids-class"><span> Kids</span></label>
          <label><input type="checkbox" value="murph"><span> Murph</span></label>
        </div>
      </div>
      <div class="upload-tag-group">
        <label>Movement</label>
        <div class="upload-tag-chips">
          <label><input type="checkbox" value="barbell"><span> Barbell</span></label>
          <label><input type="checkbox" value="pull-ups"><span> Pull-ups</span></label>
          <label><input type="checkbox" value="kettlebell"><span> Kettlebell</span></label>
          <label><input type="checkbox" value="rowing"><span> Rowing</span></label>
          <label><input type="checkbox" value="running"><span> Running</span></label>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="photo-load-more" id="modal-upload-submit" onclick="submitUploadModal()">Upload →</button>
        <button class="photo-load-more" onclick="cancelUploadModal()">Cancel</button>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ── Request router ────────────────────────────────────────────
function serveStatic(res, filePath) {
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  const ext  = extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const fileData = readFileSync(filePath);
  const headers = {
    'Content-Type': mime,
    'Content-Length': fileData.length,
    'Connection': 'close',
  };
  // Never cache HTML or JSON — preview.html and meta.json must always be fresh
  if (ext === '.html' || ext === '.json') headers['Cache-Control'] = 'no-store';
  res.writeHead(200, headers);
  res.end(fileData);
}

function jsonResp(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Connection': 'close',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(ok => {
    let buf = '';
    req.on('data', d => buf += d);
    req.on('end', () => { try { ok(JSON.parse(buf)); } catch { ok({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  // Global catch: any unhandled throw → 500, not a hanging connection
  try {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;
  console.log(`[req] ${method} ${path}`);

  // ── Static files ────────────────────────────────────────────
  if (path.startsWith('/output/'))
    return serveStatic(res, resolve(__dirname, path.slice(1)));
  if (path.startsWith('/los-output/'))
    return serveStatic(res, resolve(SHIPS.los.outputDir, path.slice('/los-output/'.length)));
  if (path.startsWith('/assets/'))
    return serveStatic(res, resolve(__dirname, path.slice(1)));

  // ── Job status ───────────────────────────────────────────────
  if (path.startsWith('/api/job/') && method === 'GET') {
    const id = path.split('/').pop();
    const job = jobs.get(id);
    if (!job) return jsonResp(res, { done: true, ok: false, log: 'Job not found' }, 404);
    return jsonResp(res, job);
  }

  // ── Cloudinary photo library browser ────────────────────────
  if (path.startsWith('/api/photos') && method === 'GET') {
    try {
      const { v2: cld } = await import('cloudinary');
      const q      = url.searchParams.get('q')     || '';
      const limit  = Math.min(parseInt(url.searchParams.get('limit') || '60', 10), 100);
      const skip   = parseInt(url.searchParams.get('skip') || '0', 10);

      const expression = q
        ? `folder:crossfit-otl/library AND tags:${q}`
        : 'folder:crossfit-otl/library';

      const result = await cld.search
        .expression(expression)
        .sort_by('uploaded_at', 'desc')
        .max_results(limit)
        .with_field('tags')
        .execute();

      const resources = result.resources || [];
      return jsonResp(res, {
        photos: resources.map(r => ({
          raw:      r.secure_url,
          publicId: r.public_id,
          tags:     r.tags || [],
          thumb:    r.secure_url.replace('/upload/', '/upload/c_fill,w_220,h_220/'),
        })),
        total:   result.total_count || resources.length,
        showing: resources.length,
      });
    } catch (e) {
      return jsonResp(res, { error: e.message, photos: [], total: 0 }, 500);
    }
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
      writeMeta(dir, { ...meta, photoOverride: photo || null, photoRaw: photo || null });
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
        delete updated.photoRaw;
      } else if (photo !== undefined) {
        updated.photo = photo; // '' = text-only, string = path
        if (photo) updated.photoRaw = photo; // save raw URL so effects can chain correctly
        else delete updated.photoRaw;
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
            tags: ['uploaded', ...(tags.length ? tags : ['quality:3'])],
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

    // Resolve the current photo: prefer the raw URL saved when user last picked a photo
    // via the picker (stored in slideOverrides[i].photoRaw), then fall back to base slide data.
    const overrides = meta.slideOverrides || {};
    const key = String(slideIdx);
    const slotOverrides = overrides[key] || {};
    const rawUrl = slotOverrides.photoRaw   // saved when user picked a new photo
                || slotOverrides.photo      // fallback: the current override photo
                || slide.photoRaw           // original raw URL from generation
                || slide.photo;             // last resort
    const slot   = slide.photoSlot || (
      (slide.template === 'HookSlide' || slide.template === 'CarouselCTA') ? 'hook' : 'value'
    );
    const newPhotoUrl = buildPhotoUrl(rawUrl, slot, effect);

    // Save effect + new photo url as slide override (preserve photoRaw so future effect changes still work)
    overrides[key] = { ...slotOverrides, photo: newPhotoUrl, photoEffect: effect };
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

  // ── Post accent color ────────────────────────────────────────
  if (path === '/api/post-accent' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, accentSlot, accentColor } = body;
    if (!date || !slug || accentColor == null) return jsonResp(res, { error: 'Missing params' }, 400);
    const dir = postDir(date, slug);
    const meta = readMeta(dir);
    writeMeta(dir, { ...meta, accentSlot, accentColor });
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

  // ── Approve & queue post in Supabase ─────────────────────────
  if (path === '/api/approve-post' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, scheduledAt } = body;
    if (!date || !slug || !scheduledAt)
      return jsonResp(res, { error: 'Missing date, slug, or scheduledAt' }, 400);
    if (!supabase)
      return jsonResp(res, { error: 'Supabase not configured — add SUPABASE_URL + SUPABASE_ANON_KEY to pipeline/.env' }, 500);

    const dir  = postDir(date, slug);
    const meta = readMeta(dir);

    // Collect rendered slide paths
    let slideCount = 0;
    while (existsSync(join(dir, `slide_${slideCount + 1}.png`))) slideCount++;
    if (!slideCount) return jsonResp(res, { error: 'No rendered slides — click Render first' }, 400);

    let caption = '';
    try { caption = readFileSync(join(dir, 'caption.txt'), 'utf8').trim(); } catch {}
    if (!caption) return jsonResp(res, { error: 'No caption.txt — add a caption first' }, 400);

    // Upload slide PNGs to Cloudinary (otl_ig_queue/ folder)
    const { v2: cld } = await import('cloudinary');
    const timestamp = Date.now();
    const cloudinaryUrls = [];
    for (let i = 0; i < slideCount; i++) {
      const slidePath = join(dir, `slide_${i + 1}.png`);
      const publicId  = `otl_ig_queue/${date}_${slug}_slide_${i + 1}_${timestamp}`;
      const result = await cld.uploader.upload(slidePath, {
        public_id: publicId, overwrite: true, resource_type: 'image',
      });
      cloudinaryUrls.push(result.secure_url);
    }

    // Insert into Supabase queue
    const { data: row, error: dbErr } = await supabase
      .from('otl_post_queue')
      .insert({ slug, date, cloudinary_urls: cloudinaryUrls, caption, scheduled_at: scheduledAt })
      .select('id')
      .single();

    if (dbErr) return jsonResp(res, { error: `Supabase error: ${dbErr.message}` }, 500);

    // Mark post as approved in local meta
    writeMeta(dir, { ...meta, status: 'approved', scheduledAt, queueId: row.id, queuedAt: new Date().toISOString() });

    return jsonResp(res, { ok: true, queueId: row.id, scheduledAt, cloudinaryUrls });
  }

  // ── LOS Scheduled Queue (Supabase) ───────────────────────────
  if (path === '/scheduled' && method === 'GET') {
    if (!losSupabase) {
      res.writeHead(500); res.end('LOS Supabase not configured'); return;
    }
    const { data: posts } = await losSupabase
      .from('scheduled_posts')
      .select('id, scheduled_at, cloudinary_urls, caption')
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true });

    const CDT = { timeZone: 'America/Chicago' };
    const grouped = {};
    for (const p of (posts || [])) {
      const day = new Date(p.scheduled_at).toLocaleDateString('en-US',
        { ...CDT, weekday: 'long', month: 'long', day: 'numeric' });
      (grouped[day] = grouped[day] || []).push(p);
    }

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const dayHtml = Object.entries(grouped).map(([day, items]) => {
      const cards = items.map(p => {
        const hr = new Date(p.scheduled_at).getHours();
        const time = new Date(p.scheduled_at).toLocaleTimeString('en-US',
          { ...CDT, hour: '2-digit', minute: '2-digit' });
        const slot = hr < 11 ? ['MORNING · 9AM','#F59E0B','#1a1200']
                   : hr < 15 ? ['MIDDAY · 1PM','#6366F1','#0d0d1a']
                              : ['EVENING · 6PM','#10B981','#001a0d'];
        const imgs = (p.cloudinary_urls || []).slice(0, 10);
        const strip = imgs.map((u,i) =>
          `<img class="sthumb${i===0?' on':''}" src="${esc(u)}" loading="lazy" onclick="pick(this,${i})">`
        ).join('');
        const cap = esc((p.caption || '').slice(0, 160));
        return `<div class="sc" id="sc-${esc(p.id)}">
  <div class="sc-head">
    <span class="slot" style="color:${slot[1]};background:${slot[2]}">${slot[0]}</span>
    <span class="sc-time">${time}</span>
    <button class="sc-del" onclick="del('${esc(p.id)}',this)">✕</button>
  </div>
  <div class="sv">
    <div class="smain"><img class="sbig" src="${esc(imgs[0]||'')}">
      ${imgs.length>1?`<button class="sn sl" onclick="step(this,-1)">❮</button><button class="sn sr" onclick="step(this,1)">❯</button><span class="scnt">1/${imgs.length}</span>`:''}
    </div>
    ${imgs.length>1?`<div class="ss">${strip}</div>`:''}
  </div>
  <div class="sc-cap">${cap}${(p.caption||'').length>160?'…':''}</div>
</div>`;
      }).join('');
      return `<div class="dg"><div class="dl">${esc(day)}</div><div class="dc">${cards}</div></div>`;
    }).join('');

    res.writeHead(200, { 'Content-Type': 'text/html', 'Connection': 'close' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LOS · Scheduled Queue</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#ddd;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
header{background:#111;border-bottom:1px solid #1e1e1e;padding:14px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:9}
.logo{font-size:14px;font-weight:700;color:#fff}.logo em{color:#10B981;font-style:normal}
nav{display:flex;gap:4px;margin-left:auto}
.nb{background:#161616;border:1px solid #252525;color:#666;padding:5px 13px;border-radius:4px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;text-decoration:none;transition:.15s}
.nb:hover{color:#ccc}.nb.on{background:#10B981;border-color:#10B981;color:#fff}
.cnt{background:#10B981;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:99px;margin-left:6px}
main{padding:24px;max-width:1100px;margin:0 auto}
.empty{text-align:center;padding:80px;color:#333;font-size:13px}
.dg{margin-bottom:32px}
.dl{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#333;border-bottom:1px solid #181818;padding-bottom:8px;margin-bottom:14px}
.dc{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.sc{background:#111;border:1px solid #1e1e1e;border-radius:8px;overflow:hidden}
.sc-head{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #161616}
.slot{font-size:8px;font-weight:700;letter-spacing:.1em;padding:2px 7px;border-radius:3px}
.sc-time{font-size:10px;color:#444;margin-left:auto}
.sc-del{background:none;border:none;color:#2a2a2a;font-size:13px;cursor:pointer;padding:0 3px;border-radius:3px;line-height:1;transition:.15s}
.sc-del:hover{color:#cc4444;background:#1a0808}
.sv{position:relative}
.smain{position:relative;aspect-ratio:4/5;background:#0d0d0d;overflow:hidden}
.sbig{width:100%;height:100%;object-fit:cover;display:block}
.sn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.6);border:none;color:#fff;font-size:22px;width:28px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:.15s}
.smain:hover .sn{opacity:1}.sl{left:0;border-radius:0 4px 4px 0}.sr{right:0;border-radius:4px 0 0 4px}
.scnt{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.8);color:#888;font-size:8px;padding:2px 5px;border-radius:3px;pointer-events:none}
.ss{display:flex;gap:3px;padding:5px;background:#0d0d0d;overflow-x:auto}
.ss::-webkit-scrollbar{height:3px}.ss::-webkit-scrollbar-thumb{background:#222;border-radius:3px}
.sthumb{width:36px;height:45px;object-fit:cover;border-radius:2px;cursor:pointer;opacity:.4;border:1px solid transparent;flex-shrink:0;transition:.12s}
.sthumb.on{opacity:1;border-color:#10B981}
.sc-cap{padding:9px 11px;font-size:11px;color:#444;line-height:1.5;border-top:1px solid #141414}
</style></head><body>
<header>
  <div class="logo">Lifestyle <em>OS</em> · Scheduled</div>
  <nav>
    <a class="nb" href="/?ship=los">← LOS Posts</a>
    <a class="nb" href="/?ship=otl">OTL Posts</a>
    <a class="nb on" href="/scheduled">Queue <span class="cnt">${(posts||[]).length}</span></a>
  </nav>
</header>
<main>${(posts||[]).length === 0
  ? '<div class="empty">Queue is empty — weekly-cycle.mjs runs every Sunday at noon.</div>'
  : dayHtml}</main>
<script>
function pick(img, idx) {
  const sv = img.closest('.sv');
  sv.querySelectorAll('.sthumb').forEach((t,i) => t.classList.toggle('on', i===idx));
  const big = sv.querySelector('.sbig');
  if (big) big.src = img.src;
  const cnt = sv.querySelector('.scnt');
  if (cnt) cnt.textContent = (idx+1)+'/'+sv.querySelectorAll('.sthumb').length;
}
function step(btn, dir) {
  const sv = btn.closest('.sv');
  const thumbs = [...sv.querySelectorAll('.sthumb')];
  const cur = thumbs.findIndex(t => t.classList.contains('on'));
  const next = Math.max(0, Math.min(thumbs.length-1, cur+dir));
  pick(thumbs[next], next);
}
async function del(id, btn) {
  if (!confirm('Remove from queue?')) return;
  btn.disabled = true;
  const r = await fetch('/api/cancel-scheduled', {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({id})
  });
  const j = await r.json();
  if (j.ok) document.getElementById('sc-'+id)?.remove();
  else { alert('Error: '+j.error); btn.disabled=false; }
}
</script></body></html>`);
    return;
  }

  if (path === '/api/cancel-scheduled' && method === 'POST') {
    const body = await readBody(req);
    const { id } = body;
    if (!losSupabase) return jsonResp(res, { error: 'LOS Supabase not configured' }, 500);
    const { error } = await losSupabase.from('scheduled_posts').delete().eq('id', id);
    return jsonResp(res, error ? { ok: false, error: error.message } : { ok: true });
  }

  // ── Queue page ───────────────────────────────────────────────
  // ── Reschedule approved post ──────────────────────────────────
  if (path === '/api/reschedule-post' && method === 'POST') {
    const body = await readBody(req);
    const { date, slug, scheduledAt } = body;
    if (!date || !slug || !scheduledAt) return jsonResp(res, { error: 'Missing date/slug/scheduledAt' }, 400);
    const dir  = postDir(date, slug);
    const meta = readMeta(dir);
    // Update local meta
    writeMeta(dir, { ...meta, scheduledAt });
    // Update Supabase row if we have a queueId
    if (supabase && meta.queueId) {
      const { error } = await supabase
        .from('otl_post_queue')
        .update({ scheduled_at: scheduledAt })
        .eq('id', meta.queueId);
      if (error) return jsonResp(res, { error: `Supabase: ${error.message}` }, 500);
    }
    return jsonResp(res, { ok: true, scheduledAt });
  }

  // ── Content Calendar API ─────────────────────────────────────
  if (path === '/api/calendar-data' && method === 'GET') {
    const calPath  = resolve(__dirname, 'content-calendar.json');
    const planPath = resolve(__dirname, 'content-plan.json');
    const calendar = existsSync(calPath)  ? JSON.parse(readFileSync(calPath,  'utf8')) : {};
    const plan     = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) : {};

    // Build a map of date → post status from local output dirs
    const postStatus = {};
    const outDir = resolve(__dirname, 'output');
    if (existsSync(outDir)) {
      for (const dateDir of readdirSync(outDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
        const datePath = join(outDir, dateDir);
        for (const slugDir of readdirSync(datePath, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
          const metaPath = join(datePath, slugDir, 'meta.json');
          if (!existsSync(metaPath)) continue;
          try {
            const m = JSON.parse(readFileSync(metaPath, 'utf8'));
            if (!postStatus[dateDir] || m.status === 'posted') postStatus[dateDir] = m.status;
          } catch {}
        }
      }
    }
    return jsonResp(res, { calendar, plan, postStatus });
  }

  if (path === '/api/calendar-entry' && method === 'POST') {
    const body     = await readBody(req);
    const { date, track, campaign } = body;
    if (!date || !track) return jsonResp(res, { error: 'Missing date/track' }, 400);
    const calPath  = resolve(__dirname, 'content-calendar.json');
    const calendar = existsSync(calPath) ? JSON.parse(readFileSync(calPath, 'utf8')) : {};
    const existing = calendar[date] || {};
    calendar[date] = { ...existing, track, ...(campaign ? { campaign } : {}), ...(track === 'educational' ? {} : {}) };
    if (track === 'educational') delete calendar[date].campaign;
    const sorted = Object.fromEntries(Object.entries(calendar).sort(([a],[b]) => a.localeCompare(b)));
    writeFileSync(calPath, JSON.stringify(sorted, null, 2), 'utf8');
    return jsonResp(res, { ok: true, entry: calendar[date] });
  }

  if (path === '/api/calendar-extend' && method === 'POST') {
    return new Promise((resolve2) => {
      const child = spawn(NODE, [resolve(__dirname, 'extend-calendar.js')], { cwd: __dirname });
      let out = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { out += d; });
      child.on('close', code => {
        jsonResp(res, { ok: code === 0, output: out.trim() });
        resolve2();
      });
    });
  }

  // ── Content Calendar Page ─────────────────────────────────────
  if (path === '/calendar') {
    const html = buildCalendarHtml();
    const buf  = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': buf.length, 'Connection': 'close' });
    res.end(buf);
    return;
  }

  if (path === '/' || path === '/queue') {
    const ship = url.searchParams.get('ship') || 'otl';
    const validShip = SHIPS[ship] ? ship : 'otl';
    const posts = collectPosts(validShip);
    const html  = buildQueueHtml(posts, validShip);
    const htmlBuf = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': htmlBuf.length, 'Connection': 'close' });
    res.end(htmlBuf);
    return;
  }

  res.writeHead(404);
  res.end('Not found');

  } catch (e) {
    console.error('[server] Unhandled error in request handler:', e.message);
    console.error(e.stack?.split('\n').slice(0,3).join('\n'));
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error: ' + e.message }));
    }
  }
});

import { networkInterfaces } from 'os';

// Prevent Chrome keep-alive race: Node closes at 5s, Chrome expects >60s
server.keepAliveTimeout = 65000;
server.headersTimeout   = 66000;

server.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const localIp = Object.values(nets).flat()
    .find(n => n.family === 'IPv4' && !n.internal)?.address || 'unknown';
  console.log(`\n  OTL Post Queue`);
  console.log(`  Local   →  http://localhost:${PORT}`);
  console.log(`  Network →  http://${localIp}:${PORT}  ← open this on MacBook Pro\n`);
});
