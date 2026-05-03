#!/usr/bin/env node
// intake.js — iCloud Shared Album → Claude Vision Triage → Cloudinary
//
// Polls the OTL shared album for new photos, triages each with Claude Haiku Vision,
// and uploads approved photos to Cloudinary with searchable tags.
//
// Usage:
//   node intake.js              — process all new photos in the shared album
//   node intake.js --dry-run    — triage only, no Cloudinary upload
//   node intake.js --reprocess  — re-triage all photos (ignores log)
//
// Scheduled by launchd to run nightly (see com.otl.intake.plist).

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { v2 as cloudinary } from 'cloudinary';

// Match server.js env loading (avoids dotenv encoding quirks)
function loadEnv() {
  const p = resolve(dirname(fileURLToPath(import.meta.url)), '.env');
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}
const env = loadEnv();
const getEnv = k => env[k] || process.env[k];

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH  = resolve(__dirname, 'photo-intake-log.json');
const TEMP_DIR  = resolve(__dirname, 'assets/photos/.intake-tmp');

const DRY_RUN   = process.argv.includes('--dry-run');
const REPROCESS = process.argv.includes('--reprocess');
const VERBOSE   = process.argv.includes('--verbose');

// ── Config ────────────────────────────────────────────────────

const ALBUM_TOKEN   = getEnv('ICLOUD_ALBUM_TOKEN');
const ANTHROPIC_KEY = getEnv('ANTHROPIC_API_KEY');
const MIN_QUALITY  = 3;   // photos scoring below this are skipped
const CLOUDINARY_FOLDER = 'crossfit-otl/library';

// ── iCloud Shared Album API ───────────────────────────────────

const ICLOUD_BASE = 'sharedstreams.icloud.com';

async function fetchStream(host) {
  const url = `https://${host}/${ALBUM_TOKEN}/sharedstreams/webstream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.icloud.com',
    },
    body: JSON.stringify({ streamCtag: null }),
  });

  // iCloud returns 330 when you hit the wrong datacenter — follow to the right one
  if (res.status === 330) {
    const data = await res.json();
    const redirect = data['X-Apple-MMe-Host'];
    if (!redirect) throw new Error('330 redirect but no X-Apple-MMe-Host in response');
    log(`  ↪ Redirecting to ${redirect}`);
    return fetchStream(redirect);
  }

  if (!res.ok) throw new Error(`iCloud stream error ${res.status}: ${await res.text()}`);
  return { data: await res.json(), host };
}

async function fetchAssetUrls(host, guids) {
  const url = `https://${host}/${ALBUM_TOKEN}/sharedstreams/webasseturls`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.icloud.com' },
    body: JSON.stringify({ photoGuids: guids }),
  });
  if (!res.ok) throw new Error(`iCloud asset URL error ${res.status}: ${await res.text()}`);
  return res.json(); // { locations: {host: {scheme, hosts[]}}, items: {checksum: {url_path, url_location, url_expiry}} }
}

// Pick the largest derivative by pixel dimension key (iCloud uses numeric pixel-height keys e.g. "1920", "456")
function bestDerivative(derivatives) {
  if (!derivatives) return null;
  const keys = Object.keys(derivatives).map(Number).filter(n => !isNaN(n)).sort((a, b) => b - a);
  if (keys.length) return derivatives[String(keys[0])];
  // Fallback: largest fileSize
  return Object.values(derivatives).sort((a, b) => Number(b.fileSize || 0) - Number(a.fileSize || 0))[0];
}

// Build a download URL from the asset map using the derivative's checksum
function resolveDownloadUrl(derivative, items, locations) {
  if (!derivative?.checksum) return null;
  const item = items[derivative.checksum];
  if (!item) return null;
  const loc = locations[item.url_location];
  if (!loc) return null;
  return `${loc.scheme}://${item.url_location}${item.url_path}`;
}

async function downloadPhoto(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Claude Haiku Vision Triage ────────────────────────────────

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const TRIAGE_PROMPT = `You are triaging photos for use in CrossFit OTL's Instagram carousels.
CrossFit OTL is a CrossFit affiliate gym in North Richland Hills, TX.

Evaluate this photo for Instagram carousel use. Return JSON only — no markdown, no explanation.

{
  "quality": <1-5>,
  "theme": "<workout|community|coaching|event|kids|lifestyle|other>",
  "tags": ["<specific tags — use any that apply: barbell, pull-ups, kettlebell, running, box-jump, rope-climb, rowing, group, celebration, coach, intensity, sweat, chalk, kids-class, team, murph, competition, outdoor, indoor, whiteboard>"],
  "mood": "<intense|joyful|determined|focused|celebratory|candid|instructional>",
  "description": "<one sentence — what is literally happening in this photo>",
  "reject_reason": "<only include if quality < 3 — why it fails: blurry, too dark, poor composition, not gym-related, personal/sensitive, etc.>"
}

Quality rubric:
5 — Excellent. Sharp, well-lit, compelling composition, strong emotional moment or action. Stop-scroll worthy.
4 — Good. Sharp, adequately lit, useful subject. Minor composition issues.
3 — Usable. Acceptable for carousel slide 2-3 but not ideal for a hook slide.
2 — Marginal. Blurry, dark, awkward crop, or not clearly CrossFit-related. Skip.
1 — Reject. Unusable: completely out of focus, accidental shot, contains sensitive content, or unrelated to CrossFit OTL.`;

async function triagePhoto(imageBuffer, mimeType = 'image/jpeg') {
  const b64 = imageBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: b64 },
        },
        { type: 'text', text: TRIAGE_PROMPT },
      ],
    }],
  });

  const raw = response.content[0].text.trim();
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1) throw new Error('No JSON in triage response: ' + raw.slice(0, 100));
  return JSON.parse(raw.slice(start, end + 1));
}

// ── Cloudinary Upload ─────────────────────────────────────────

cloudinary.config({
  cloud_name:  getEnv('CLOUDINARY_CLOUD_NAME'),
  api_key:     getEnv('CLOUDINARY_API_KEY'),
  api_secret:  getEnv('CLOUDINARY_API_SECRET'),
});

async function uploadToCloudinary(imageBuffer, { guid, theme, tags, mood, quality, description }) {
  return new Promise((resolve, reject) => {
    const allTags = [
      `theme:${theme}`,
      `mood:${mood}`,
      `quality:${quality}`,
      'source:icloud-album',
      ...tags.map(t => t.replace(/\s+/g, '-')),
    ];

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: `otl_${guid.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}`,
        tags: allTags,
        context: {
          theme,
          mood,
          quality: String(quality),
          description,
          source: 'icloud-album',
        },
        resource_type: 'image',
        overwrite: false,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );

    uploadStream.end(imageBuffer);
  });
}

// ── Intake Log ────────────────────────────────────────────────

function loadLog() {
  if (!existsSync(LOG_PATH)) return { ingested: {}, skipped: {}, lastRun: null };
  return JSON.parse(readFileSync(LOG_PATH, 'utf8'));
}

function saveLog(logData) {
  writeFileSync(LOG_PATH, JSON.stringify(logData, null, 2), 'utf8');
}

// ── Logging ───────────────────────────────────────────────────

function log(msg) { process.stdout.write(msg + '\n'); }
function verbose(msg) { if (VERBOSE) process.stdout.write('  ' + msg + '\n'); }

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!ALBUM_TOKEN) throw new Error('ICLOUD_ALBUM_TOKEN not set in .env');
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');

  mkdirSync(TEMP_DIR, { recursive: true });

  const intakeLog = loadLog();
  if (REPROCESS) {
    log('⚠️  --reprocess: ignoring existing log, re-triaging all photos');
    intakeLog.ingested = {};
    intakeLog.skipped = {};
  }

  log(`\n📸 OTL Photo Intake — ${new Date().toISOString().slice(0, 10)}`);
  if (DRY_RUN) log('   DRY RUN — no Cloudinary uploads');
  log('');

  // Step 1: Fetch album stream
  log('→ Fetching iCloud shared album...');
  const { data: stream, host } = await fetchStream(`p15-${ICLOUD_BASE}`);
  const photos = stream.photos || [];
  log(`  Found ${photos.length} photo(s) in album`);

  if (!photos.length) {
    log('\nAlbum is empty. Add photos to the shared album and run intake again.');
    log('Album: https://www.icloud.com/sharedalbum/#' + ALBUM_TOKEN);
    return;
  }

  // Step 2: Filter to new photos
  const newPhotos = REPROCESS
    ? photos
    : photos.filter(p => !intakeLog.ingested[p.photoGuid] && !intakeLog.skipped[p.photoGuid]);

  log(`  ${newPhotos.length} new photo(s) to process (${photos.length - newPhotos.length} already ingested)\n`);

  if (!newPhotos.length) {
    log('✓ All photos already ingested. Nothing to do.');
    intakeLog.lastRun = new Date().toISOString();
    saveLog(intakeLog);
    return;
  }

  // Step 3: Get download URLs for new photos
  const guids = newPhotos.map(p => p.photoGuid);
  log(`→ Fetching download URLs for ${guids.length} photo(s)...`);
  const { items: assetItems, locations } = await fetchAssetUrls(host, guids);

  // Step 4: Process each photo
  let approved = 0, rejected = 0, errors = 0;

  for (let i = 0; i < newPhotos.length; i++) {
    const photo = newPhotos[i];
    const guid  = photo.photoGuid;
    const label = `[${i + 1}/${newPhotos.length}]`;

    const derivative = bestDerivative(photo.derivatives);
    if (!derivative) {
      log(`${label} ⚠️  No derivatives for ${guid} — skipping`);
      errors++;
      continue;
    }

    const downloadUrl = resolveDownloadUrl(derivative, assetItems, locations);
    if (!downloadUrl) {
      log(`${label} ⚠️  Could not resolve download URL for ${guid} (checksum: ${derivative.checksum?.slice(0, 8)}...) — skipping`);
      errors++;
      continue;
    }

    const ext = downloadUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

    try {
      // Download
      verbose(`Downloading from iCloud (${Math.round(Number(derivative.fileSize) / 1024)}KB)...`);
      const buffer = await downloadPhoto(downloadUrl);

      // Triage with Claude Haiku Vision
      verbose(`Triaging with Claude Haiku...`);
      const triage = await triagePhoto(buffer, mimeType);
      verbose(`Quality: ${triage.quality}/5 | Theme: ${triage.theme} | ${triage.description}`);

      const qualityBar = '█'.repeat(triage.quality) + '░'.repeat(5 - triage.quality);
      const themeStr = triage.theme.padEnd(12);
      const tagStr = (triage.tags || []).slice(0, 3).join(', ');

      if (triage.quality < MIN_QUALITY) {
        log(`${label} ✗ SKIP  [${qualityBar}] ${themeStr} — ${triage.reject_reason || 'below quality threshold'}`);
        intakeLog.skipped[guid] = {
          date: new Date().toISOString(),
          quality: triage.quality,
          reason: triage.reject_reason,
        };
        rejected++;
        continue;
      }

      log(`${label} ✓ OK    [${qualityBar}] ${themeStr} | ${tagStr}`);
      verbose(`Description: ${triage.description}`);

      // Upload to Cloudinary
      if (!DRY_RUN) {
        verbose(`Uploading to Cloudinary...`);
        const result = await uploadToCloudinary(buffer, {
          guid,
          theme: triage.theme,
          tags: triage.tags || [],
          mood: triage.mood || 'candid',
          quality: triage.quality,
          description: triage.description,
        });
        intakeLog.ingested[guid] = {
          date: new Date().toISOString(),
          quality: triage.quality,
          theme: triage.theme,
          tags: triage.tags,
          mood: triage.mood,
          description: triage.description,
          cloudinaryUrl: result.secure_url,
          cloudinaryId: result.public_id,
        };
        verbose(`Cloudinary: ${result.secure_url}`);
      } else {
        // Dry run — still log the triage result
        intakeLog.ingested[guid] = {
          date: new Date().toISOString(),
          quality: triage.quality,
          theme: triage.theme,
          tags: triage.tags,
          mood: triage.mood,
          description: triage.description,
          cloudinaryUrl: null,
          dryRun: true,
        };
      }

      approved++;

    } catch (err) {
      log(`${label} ✗ ERROR ${guid}: ${err.message}`);
      errors++;
    }
  }

  // Step 5: Summary
  log(`\n── Summary ──────────────────────────────────`);
  log(`  Approved  ${approved}   (uploaded to Cloudinary)`);
  log(`  Rejected  ${rejected}   (below quality threshold)`);
  log(`  Errors    ${errors}`);
  log(`  Total     ${newPhotos.length}`);
  if (DRY_RUN) log(`\n  DRY RUN — re-run without --dry-run to upload`);
  log('');

  intakeLog.lastRun = new Date().toISOString();
  saveLog(intakeLog);

  log(`✓ Intake log saved → photo-intake-log.json`);
  log(`  Total in library: ${Object.keys(intakeLog.ingested).length} approved photos\n`);
}

main().catch(e => {
  console.error('\n✗ Intake failed:', e.message);
  process.exit(1);
});
