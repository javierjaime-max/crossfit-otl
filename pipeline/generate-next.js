#!/usr/bin/env node
/**
 * OTL Daily Post Generator
 *
 * Runs at 7:05am daily via launchd.
 * Reads content-calendar.json for today + 7 days and generates that post.
 * Skips if a post already exists for that date.
 *
 * Usage:
 *   node generate-next.js               # generate for today + 7 days
 *   node generate-next.js --days 3      # generate for today + 3 days (testing)
 *   node generate-next.js --dry-run     # print what would be generated, don't run
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const calPath    = resolve(__dirname, 'content-calendar.json');
const outputDir  = resolve(__dirname, 'output');
const generateJs = resolve(__dirname, 'generate.js');

const args    = process.argv.slice(2);
const daysOut = parseInt(args[args.indexOf('--days') + 1] || '7') || 7;
const dryRun  = args.includes('--dry-run');

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function postExistsForDate(targetDate) {
  const dateDir = resolve(outputDir, targetDate);
  if (!existsSync(dateDir)) return false;
  const slugDirs = readdirSync(dateDir).filter(f =>
    existsSync(resolve(dateDir, f, 'meta.json'))
  );
  return slugDirs.length > 0;
}

function slugForEntry(targetDate, entry) {
  const suffix = targetDate.replace(/-/g, '').slice(4); // MMDD
  if (entry.track === 'educational') {
    return `edu_${suffix}_${Math.random().toString(36).slice(2, 6)}`;
  }
  const prefix = (entry.campaign || 'camp').replace(/-/g, '_').slice(0, 8);
  return `${prefix}_${suffix}`;
}

// ── Main ──────────────────────────────────────────────────────────

if (!existsSync(calPath)) {
  console.error('✗ content-calendar.json not found — run: node extend-calendar.js');
  process.exit(1);
}

const calendar   = JSON.parse(readFileSync(calPath, 'utf8'));
const targetDate = addDays(todayStr(), daysOut);
const entry      = calendar[targetDate];

if (!entry) {
  console.log(`✓ No post scheduled for ${targetDate} — skipping`);
  process.exit(0);
}

if (postExistsForDate(targetDate)) {
  console.log(`✓ Post already exists for ${targetDate} — skipping`);
  process.exit(0);
}

const slug = slugForEntry(targetDate, entry);
const { scheduledAt } = entry;

const cmd = entry.track === 'educational'
  ? `node "${generateJs}" --track educational --date ${targetDate} --slug ${slug} --scheduled-at ${scheduledAt}`
  : `node "${generateJs}" --campaign ${entry.campaign} --date ${targetDate} --slug ${slug} --scheduled-at ${scheduledAt}`;

console.log(`\n▶ Generating post for ${targetDate}`);
console.log(`  Track:    ${entry.track}`);
if (entry.campaign) console.log(`  Campaign: ${entry.campaign}`);
console.log(`  Slug:     ${slug}`);
console.log(`  Schedule: ${scheduledAt}`);
console.log(`  Command:  ${cmd}\n`);

if (dryRun) {
  console.log('(dry-run — not executing)');
  process.exit(0);
}

try {
  execSync(cmd, { cwd: __dirname, stdio: 'inherit' });
  console.log(`\n✓ Generated: ${targetDate}/${slug}`);
} catch (e) {
  console.error('\n✗ Generation failed:', e.message);
  process.exit(1);
}

// Push staged posts to Cloudinary + Supabase
try {
  execSync(`node "${resolve(__dirname, 'push-staged.js')}"`, { cwd: __dirname, stdio: 'inherit' });
} catch (e) {
  console.error('\n✗ push-staged failed:', e.message);
  process.exit(1);
}
