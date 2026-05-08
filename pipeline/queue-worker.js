#!/usr/bin/env node
// CrossFit OTL — Queue Render Worker
// Polls Supabase for posts with render_status='requested', runs generate.js
// --rerender, uploads new slide PNGs to Cloudinary, writes results back.
//
// Usage: node queue-worker.js
// Managed by launchd: com.otl.queue-worker.plist (StartInterval=30)

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const OUTPUT_DIR = resolve(__dirname, 'output');

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

// ── Supabase (atlas project) ───────────────────────────────────────────────
const supabase = createClient(
  env.SUPABASE_URL || process.env.SUPABASE_URL || '',
  env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// ── Cloudinary ────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key:    env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

// ── Helpers ───────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`[queue-worker] ${new Date().toISOString()} ${msg}\n`);
}

function readMeta(postDir) {
  const p = join(postDir, 'meta.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeMeta(postDir, data) {
  writeFileSync(join(postDir, 'meta.json'), JSON.stringify(data, null, 2));
}

function postDir(date, slug) {
  return resolve(OUTPUT_DIR, date, slug);
}

function spawnRerender(dir, meta) {
  return new Promise((resolve, reject) => {
    const args = [
      resolve(__dirname, 'generate.js'),
      '--rerender',
      '--slug', meta.slug || '',
      '--date', meta.date || '',
    ];
    if (meta.track)    args.push('--track', meta.track);
    if (meta.campaign) args.push('--campaign', meta.campaign);
    if (meta.topic)    args.push('--topic', meta.topic);

    const child = spawn(NODE, args, {
      cwd: __dirname,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`generate.js exited ${code}:\n${out}`));
    });
  });
}

async function uploadSlides(dir, date, slug) {
  const urls = [];
  const timestamp = Date.now();
  let i = 1;
  while (existsSync(join(dir, `slide_${i}.png`))) {
    const publicId = `otl_ig_queue/${date}_${slug}_slide_${i}_${timestamp}`;
    const result = await cloudinary.uploader.upload(join(dir, `slide_${i}.png`), {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
    });
    urls.push(result.secure_url);
    i++;
  }
  return urls;
}

// ── Main poll loop ────────────────────────────────────────────────────────
async function processOne(row) {
  const { id, date, slug, slide_overrides } = row;
  const dir = postDir(date, slug);

  if (!existsSync(dir)) {
    log(`SKIP ${id} — output dir not found: ${dir}`);
    await supabase.from('otl_post_queue').update({
      render_status: 'failed',
      error: `Output directory not found: ${date}/${slug}`,
    }).eq('id', id);
    return;
  }

  // Mark rendering
  await supabase.from('otl_post_queue').update({ render_status: 'rendering' }).eq('id', id);

  try {
    // Merge slide_overrides from Supabase into local meta.json
    const meta = readMeta(dir);
    const merged = {
      ...meta,
      slug,
      date,
      slideOverrides: slide_overrides ?? meta.slideOverrides ?? {},
    };
    writeMeta(dir, merged);

    log(`Rerendering ${date}/${slug}…`);
    await spawnRerender(dir, merged);

    // Upload new PNGs to Cloudinary
    log(`Uploading slides for ${date}/${slug}…`);
    const cloudinaryUrls = await uploadSlides(dir, date, slug);

    if (cloudinaryUrls.length === 0) {
      throw new Error('No slide PNGs found after rerender');
    }

    // Write results back to Supabase
    await supabase.from('otl_post_queue').update({
      render_status: 'done',
      cloudinary_urls: cloudinaryUrls,
    }).eq('id', id);

    // Update local meta
    writeMeta(dir, { ...merged, cloudinaryUrls, renderedAt: new Date().toISOString() });

    log(`Done ${date}/${slug} — ${cloudinaryUrls.length} slides uploaded`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR ${date}/${slug}: ${msg}`);
    await supabase.from('otl_post_queue').update({
      render_status: 'failed',
      error: msg.slice(0, 500),
    }).eq('id', id);
  }
}

async function poll() {
  const { data, error } = await supabase
    .from('otl_post_queue')
    .select('id, date, slug, slide_overrides')
    .eq('render_status', 'requested')
    .order('render_requested_at', { ascending: true })
    .limit(3);

  if (error) {
    log(`Poll error: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) return;

  log(`Found ${data.length} render job(s)`);
  for (const row of data) {
    await processOne(row);
  }
}

// Run once — launchd re-invokes every 30s via StartInterval
poll().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
