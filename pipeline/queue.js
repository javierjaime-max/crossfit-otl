#!/usr/bin/env node
// CrossFit OTL — Queue Dashboard Generator
// Scans output/ for all generated posts and builds a visual review page.
// Usage: node queue.js
// Then open: output/queue.html

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, 'output');
const queuePath = resolve(outputDir, 'queue.html');

function collectPosts() {
  const posts = [];

  if (!existsSync(outputDir)) return posts;

  const dateDirs = readdirSync(outputDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.' && d.name !== '..')
    .map(d => d.name)
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    const datePath = join(outputDir, dateDir);
    const slugDirs = readdirSync(datePath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();

    for (const slug of slugDirs) {
      const postPath = join(datePath, slug);
      const metaPath = join(postPath, 'meta.json');
      const captionPath = join(postPath, 'caption.txt');
      const previewPath = join(postPath, 'preview.html');
      const slide1Path = join(postPath, 'slide_1.png');

      if (!existsSync(metaPath)) continue;

      let meta = {};
      try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch {}

      let caption = '';
      try { caption = readFileSync(captionPath, 'utf8').trim(); } catch {}

      const hasPreview = existsSync(previewPath);
      const hasRendered = existsSync(slide1Path);

      // Count rendered slides
      let slideCount = 0;
      if (hasRendered) {
        while (existsSync(join(postPath, `slide_${slideCount + 1}.png`))) slideCount++;
      }

      posts.push({
        date: dateDir,
        slug,
        postPath,
        previewPath: hasPreview ? `file://${previewPath}` : null,
        slide1Path: hasRendered ? `file://${slide1Path}` : null,
        track: meta.track || 'campaign',
        campaign: meta.campaign || slug,
        topic: meta.topic || null,
        status: meta.status || 'staged',
        generated: meta.generated || '',
        caption,
        hasPreview,
        hasRendered,
        slideCount,
      });
    }
  }

  return posts;
}

function buildHtml(posts) {
  const totalPosts = posts.length;
  const totalRendered = posts.filter(p => p.hasRendered).length;
  const totalEducational = posts.filter(p => p.track === 'educational').length;
  const totalCampaign = posts.filter(p => p.track === 'campaign').length;

  const cards = posts.map(p => {
    const trackBadge = p.track === 'educational'
      ? `<span class="badge badge-edu">EDUCATIONAL</span>`
      : `<span class="badge badge-camp">CAMPAIGN</span>`;
    const statusBadge = p.hasRendered
      ? `<span class="badge badge-rendered">RENDERED ✓</span>`
      : `<span class="badge badge-staged">PREVIEW ONLY</span>`;

    const thumb = p.hasRendered
      ? `<img class="thumb" src="${p.slide1Path}" alt="Slide 1" loading="lazy">`
      : `<div class="thumb thumb-placeholder"><span>NO RENDER YET</span></div>`;

    const slideInfo = p.hasRendered
      ? `<span class="slide-count">${p.slideCount} slides</span>`
      : '';

    const topicLine = p.topic
      ? `<div class="topic-line">${p.topic.title}${p.topic.lens ? ` · ${p.topic.lens}` : ''}</div>`
      : '';

    const caption = p.caption
      ? `<div class="caption">${escHtml(p.caption.slice(0, 120))}${p.caption.length > 120 ? '…' : ''}</div>`
      : '<div class="caption no-caption">No caption</div>';

    const previewBtn = p.hasPreview
      ? `<a class="btn btn-preview" href="${p.previewPath}" target="_blank">Open Preview</a>`
      : '';

    const generatedDate = p.generated
      ? new Date(p.generated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    return `
    <div class="card ${p.track === 'educational' ? 'card-edu' : 'card-camp'}">
      <div class="card-thumb">
        ${thumb}
        ${slideInfo}
      </div>
      <div class="card-body">
        <div class="card-badges">${trackBadge}${statusBadge}</div>
        <div class="card-campaign">${escHtml(p.campaign)}</div>
        ${topicLine}
        ${caption}
        <div class="card-footer">
          <span class="card-date">${p.date}${generatedDate ? ' · ' + generatedDate : ''}</span>
          ${previewBtn}
        </div>
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CrossFit OTL — Post Queue</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a;
    color: #e8e8e8;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    min-height: 100vh;
  }
  header {
    background: #111;
    border-bottom: 1px solid #222;
    padding: 24px 32px;
    position: sticky; top: 0; z-index: 10;
  }
  .header-inner {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .header-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #fff;
  }
  .header-title span {
    color: #003566;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-right: 12px;
  }
  .stats {
    display: flex;
    gap: 24px;
  }
  .stat {
    text-align: center;
  }
  .stat-num {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    line-height: 1;
  }
  .stat-label {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-top: 2px;
  }
  .filters {
    display: flex;
    gap: 8px;
  }
  .filter-btn {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #aaa;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    transition: all 0.15s;
  }
  .filter-btn:hover, .filter-btn.active {
    background: #003566;
    border-color: #003566;
    color: #fff;
  }
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 32px;
  }
  .empty {
    text-align: center;
    padding: 80px 0;
    color: #444;
    font-size: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
  }
  .card {
    background: #111;
    border: 1px solid #222;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-color 0.15s;
  }
  .card:hover { border-color: #444; }
  .card-edu { border-left: 3px solid #003566; }
  .card-camp { border-left: 3px solid #8b1a1a; }
  .card-thumb {
    position: relative;
    aspect-ratio: 4/5;
    background: #0d0d0d;
    overflow: hidden;
  }
  .thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .slide-count {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0,0,0,0.7);
    color: #aaa;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 3px;
    letter-spacing: 0.06em;
  }
  .card-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }
  .card-badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 3px;
  }
  .badge-edu { background: #001a3a; color: #4d8fcc; }
  .badge-camp { background: #2a0a0a; color: #cc6666; }
  .badge-rendered { background: #0a1a0a; color: #4daa4d; }
  .badge-staged { background: #1a1a0a; color: #aaaa44; }
  .card-campaign {
    font-size: 13px;
    font-weight: 600;
    color: #ddd;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .topic-line {
    font-size: 12px;
    color: #4d8fcc;
    line-height: 1.4;
  }
  .caption {
    font-size: 13px;
    color: #888;
    line-height: 1.5;
    flex: 1;
  }
  .no-caption { font-style: italic; color: #444; }
  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px solid #1a1a1a;
    margin-top: auto;
  }
  .card-date {
    font-size: 11px;
    color: #444;
    letter-spacing: 0.04em;
  }
  .btn {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 5px 12px;
    border-radius: 4px;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-preview {
    background: #003566;
    color: #fff;
  }
  .btn-preview:hover { background: #0055a0; }
  footer {
    text-align: center;
    padding: 48px 32px 32px;
    color: #333;
    font-size: 12px;
  }
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="header-title">
      <span>@crossfitotl</span>Post Queue
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-num">${totalPosts}</div><div class="stat-label">Total</div></div>
      <div class="stat"><div class="stat-num">${totalRendered}</div><div class="stat-label">Rendered</div></div>
      <div class="stat"><div class="stat-num">${totalEducational}</div><div class="stat-label">Educational</div></div>
      <div class="stat"><div class="stat-num">${totalCampaign}</div><div class="stat-label">Campaign</div></div>
    </div>
    <div class="filters">
      <button class="filter-btn active" onclick="filterAll()">All</button>
      <button class="filter-btn" onclick="filterBy('educational')">Educational</button>
      <button class="filter-btn" onclick="filterBy('campaign')">Campaign</button>
      <button class="filter-btn" onclick="filterBy('rendered')">Rendered</button>
    </div>
  </div>
</header>

<main>
  ${posts.length === 0
    ? '<div class="empty">No posts yet. Run <code>node generate.js --preview</code> to generate your first post.</div>'
    : `<div class="grid" id="grid">${cards}</div>`
  }
</main>

<footer>
  Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · CrossFit OTL Pipeline
</footer>

<script>
  function filterAll() {
    document.querySelectorAll('.card').forEach(c => c.style.display = '');
    setActive(0);
  }
  function filterBy(type) {
    document.querySelectorAll('.card').forEach(c => {
      if (type === 'rendered') {
        c.style.display = c.querySelector('.badge-rendered') ? '' : 'none';
      } else {
        c.style.display = c.classList.contains('card-' + type.slice(0,4)) ? '' : 'none';
      }
    });
    const btns = document.querySelectorAll('.filter-btn');
    btns.forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
  }
  function setActive(idx) {
    const btns = document.querySelectorAll('.filter-btn');
    btns.forEach((b, i) => b.classList.toggle('active', i === idx));
  }
</script>

</body>
</html>`;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const posts = collectPosts();
const html = buildHtml(posts);
writeFileSync(queuePath, html, 'utf8');

process.stdout.write(`✓ Queue dashboard → file://${queuePath}\n`);
process.stdout.write(`  ${posts.length} posts · ${posts.filter(p => p.hasRendered).length} rendered · ${posts.filter(p => p.track === 'educational').length} educational\n`);
