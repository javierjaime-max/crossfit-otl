#!/usr/bin/env node
/**
 * OTL Scheduled Post Publisher
 *
 * Runs at 7:00am daily via launchd.
 * Finds locally approved posts with scheduledAt <= now, posts to Instagram,
 * and marks them as posted in local meta.json.
 *
 * Usage:
 *   node publish-overdue-otl.js           # publish all overdue approved posts
 *   node publish-overdue-otl.js --dry-run # show what would be posted, don't post
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Log immediately so launchd log file is never empty on crash
process.stdout.write(`[publish-overdue-otl] startup ${new Date().toISOString()}\n`);

// Supabase client — optional, used to sync status so the Vercel backup publisher
// sees 'posted' and never double-posts the same carousel.
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, 'output');

const dryRun = process.argv.includes('--dry-run');

// ── Helpers ───────────────────────────────────────────────────────

function readMeta(postDir) {
  try { return JSON.parse(readFileSync(join(postDir, 'meta.json'), 'utf8')); } catch { return {}; }
}

function writeMeta(postDir, meta) {
  writeFileSync(join(postDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

function findOverduePosts() {
  const now = new Date();
  const overdue = [];

  if (!existsSync(outputDir)) return overdue;

  const dateDirs = readdirSync(outputDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const dateDir of dateDirs) {
    const datePath = join(outputDir, dateDir);
    const slugDirs = readdirSync(datePath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const slug of slugDirs) {
      const postDir = join(datePath, slug);
      const meta    = readMeta(postDir);

      if (meta.status !== 'approved') continue;
      if (!meta.scheduledAt) continue;

      const scheduledAt = new Date(meta.scheduledAt);
      if (scheduledAt > now) continue;

      // Check that slides exist
      const slide1 = join(postDir, 'slide_1.png');
      if (!existsSync(slide1)) continue;

      overdue.push({ date: dateDir, slug, postDir, meta });
    }
  }

  return overdue;
}

function getSlidePaths(postDir) {
  const paths = [];
  let i = 1;
  while (existsSync(join(postDir, `slide_${i}.png`))) {
    paths.push(join(postDir, `slide_${i}.png`));
    i++;
  }
  return paths;
}

function getCaption(postDir) {
  try { return readFileSync(join(postDir, 'caption.txt'), 'utf8').trim(); } catch { return ''; }
}

// ── Main ──────────────────────────────────────────────────────────

const overdue = findOverduePosts();

if (!overdue.length) {
  console.log(`[publish-overdue-otl] ${new Date().toISOString()} — No approved posts due. Nothing to post.`);
  process.exit(0);
}

console.log(`[publish-overdue-otl] ${new Date().toISOString()} — Found ${overdue.length} post(s) to publish`);

// Import postToInstagram dynamically (ES module)
const { postToInstagram } = await import('./post_to_instagram.js');

let successCount = 0;
let failCount    = 0;

for (const { date, slug, postDir, meta } of overdue) {
  console.log(`\n▶ Publishing ${date}/${slug} (scheduled: ${meta.scheduledAt})`);

  const slidePaths = getSlidePaths(postDir);
  const caption    = getCaption(postDir);

  if (!caption) {
    console.error(`  ✗ No caption.txt — skipping`);
    failCount++;
    continue;
  }

  console.log(`  Slides: ${slidePaths.length}`);
  if (dryRun) {
    console.log('  (dry-run — not posting)');
    continue;
  }

  try {
    const result = await postToInstagram({
      slidePaths,
      caption,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    const postedAt = new Date().toISOString();
    writeMeta(postDir, {
      ...meta,
      status:   'posted',
      postedAt,
      igPostId: result.postId,
    });

    // Sync to Supabase so Vercel backup publisher sees 'posted' and won't double-post
    if (supabase && meta.queueId) {
      await supabase
        .from('otl_post_queue')
        .update({ status: 'posted', ig_post_id: result.postId, posted_at: postedAt })
        .eq('id', meta.queueId)
        .then(({ error }) => { if (error) console.warn(`  ⚠️  Supabase sync failed: ${error.message}`); });
    }

    console.log(`  ✓ Posted → Instagram ID: ${result.postId}`);
    successCount++;

  } catch (e) {
    console.error(`  ✗ Failed: ${e.message}`);
    failCount++;
  }
}

console.log(`\n[publish-overdue-otl] Done — ${successCount} posted, ${failCount} failed`);
if (failCount > 0) process.exit(1);
