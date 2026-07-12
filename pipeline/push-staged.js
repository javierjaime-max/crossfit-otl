#!/usr/bin/env node
/**
 * OTL Push Staged Posts to Queue
 *
 * Finds all locally-staged posts in output/, uploads slide PNGs to Cloudinary,
 * inserts into Supabase otl_post_queue, and marks local meta.json as pending.
 *
 * Called automatically by generate-next.js after generation.
 * Can also be run manually to flush any backlog of staged posts.
 *
 * Usage:
 *   node push-staged.js             # push all staged posts
 *   node push-staged.js --dry-run   # preview what would be pushed
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'output');
const dryRun = process.argv.includes('--dry-run');

// ── Load .env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}
const env = loadEnv();

const supabase = createClient(
  env.SUPABASE_URL || process.env.SUPABASE_URL || '',
  env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
);

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    env.CLOUDINARY_API_KEY    || process.env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET,
});

function readMeta(dir) {
  const p = join(dir, 'meta.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function writeMeta(dir, data) {
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(data, null, 2));
}

function log(msg) {
  process.stdout.write(`[push-staged] ${msg}\n`);
}

// Collect all staged posts
function findStagedPosts() {
  const posts = [];
  if (!existsSync(OUTPUT_DIR)) return posts;

  for (const dateDir of readdirSync(OUTPUT_DIR).sort()) {
    const datePath = join(OUTPUT_DIR, dateDir);
    if (!dateDir.match(/^\d{4}-\d{2}-\d{2}$/)) continue; // skip .DS_Store etc
    for (const slugDir of readdirSync(datePath)) {
      const postPath = join(datePath, slugDir);
      const meta = readMeta(postPath);
      if (!meta) continue;
      if (meta.status !== 'staged') continue;
      if (!meta.scheduledAt) continue;
      // Check slide PNGs exist
      if (!existsSync(join(postPath, 'slide_1.png'))) continue;
      posts.push({ date: dateDir, slug: slugDir, dir: postPath, meta });
    }
  }
  return posts;
}

async function pushPost(date, slug, dir, meta) {
  const caption = existsSync(join(dir, 'caption.txt'))
    ? readFileSync(join(dir, 'caption.txt'), 'utf8').trim()
    : '';
  if (!caption) { log(`SKIP ${date}/${slug} — no caption.txt`); return; }

  // Count slides
  let slideCount = 0;
  while (existsSync(join(dir, `slide_${slideCount + 1}.png`))) slideCount++;
  if (!slideCount) { log(`SKIP ${date}/${slug} — no slide PNGs`); return; }

  log(`Uploading ${slideCount} slides for ${date}/${slug}…`);
  const timestamp = Date.now();
  const cloudinaryUrls = [];

  for (let i = 0; i < slideCount; i++) {
    const slidePath = join(dir, `slide_${i + 1}.png`);
    const publicId  = `otl_ig_queue/${date}_${slug}_slide_${i + 1}_${timestamp}`;
    const result = await cloudinary.uploader.upload(slidePath, {
      public_id: publicId, overwrite: true, resource_type: 'image',
    });
    cloudinaryUrls.push(result.secure_url);
    log(`  slide ${i + 1}/${slideCount} → ${result.secure_url}`);
  }

  log(`Inserting into Supabase queue…`);
  const { data: row, error: dbErr } = await supabase
    .from('otl_post_queue')
    .insert({
      slug,
      date,
      ship: 'otl',
      cloudinary_urls: cloudinaryUrls,
      caption,
      scheduled_at: meta.scheduledAt,
      status: 'pending',
      render_status: 'idle',
    })
    .select('id')
    .single();

  if (dbErr) {
    log(`ERROR ${date}/${slug}: ${dbErr.message}`);
    return;
  }

  writeMeta(dir, {
    ...meta,
    status: 'pending',
    queueId: row.id,
    cloudinaryUrls,
    queuedAt: new Date().toISOString(),
  });

  log(`✓ ${date}/${slug} → queue ID ${row.id}`);
}

// ── Main ──────────────────────────────────────────────────────────────────
const staged = findStagedPosts();

if (staged.length === 0) {
  log('No staged posts found.');
  process.exit(0);
}

log(`Found ${staged.length} staged post(s):`);
for (const { date, slug, meta } of staged) {
  log(`  ${date}/${slug} — scheduled ${meta.scheduledAt}`);
}

if (dryRun) {
  log('(dry-run — not uploading)');
  process.exit(0);
}

for (const { date, slug, dir, meta } of staged) {
  await pushPost(date, slug, dir, meta);
}

log('Done.');
