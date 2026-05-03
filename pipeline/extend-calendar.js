#!/usr/bin/env node
/**
 * OTL Content Calendar Extender
 *
 * Reads content-plan.json and extends content-calendar.json by 60 days from today.
 * Idempotent — skips dates already in the calendar.
 * Updates rotationIndex in content-plan.json after generating new entries.
 *
 * Usage:
 *   node extend-calendar.js              # extend 60 days from today
 *   node extend-calendar.js --days 90    # extend 90 days
 *   node extend-calendar.js --rebuild    # clear future entries and regenerate from today
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const planPath     = resolve(__dirname, 'content-plan.json');
const calendarPath = resolve(__dirname, 'content-calendar.json');

const args      = process.argv.slice(2);
const daysAhead = parseInt(args[args.indexOf('--days') + 1]) || 60;
const rebuild   = args.includes('--rebuild');

// Compute 7:00am CT as UTC ISO string for a given YYYY-MM-DD date string.
// America/Chicago is CDT (UTC-5) Mar–Nov and CST (UTC-6) Nov–Mar.
function scheduledAtForDate(dateStr) {
  // Parse as CT midnight, then add 7 hours — JS handles DST via Intl
  const localMidnight = new Date(`${dateStr}T00:00:00`);
  // Determine CT offset by formatting a test time and reading the offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(localMidnight);
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
  const match = tzPart.match(/GMT([+-]\d+)/);
  const offsetHours = match ? parseInt(match[1]) : -5;
  // 7am CT = 7 - offsetHours UTC hours (offsetHours is negative for CT)
  const utcHour = 7 - offsetHours;
  return `${dateStr}T${String(utcHour).padStart(2, '0')}:00:00.000Z`;
}

function dayName(dateStr) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Main ──────────────────────────────────────────────────────────

const plan = JSON.parse(readFileSync(planPath, 'utf8'));
let calendar = {};
if (!rebuild && existsSync(calendarPath)) {
  try { calendar = JSON.parse(readFileSync(calendarPath, 'utf8')); } catch {}
}

let rotationIndex = plan.rotationIndex ?? 0;
const rotation    = plan.campaignRotation;

// If rebuilding, remove all future entries (today and beyond)
if (rebuild) {
  const today = todayStr();
  for (const date of Object.keys(calendar)) {
    if (date >= today) delete calendar[date];
  }
  rotationIndex = 0;
}

// Find the furthest existing date so we don't duplicate
const existingDates = Object.keys(calendar).sort();
const latestExisting = existingDates[existingDates.length - 1] || null;

// Start generating from today (or tomorrow if today already exists)
const startDate = latestExisting ? addDays(latestExisting, 1) : todayStr();
const endDate   = addDays(todayStr(), daysAhead);

let newCount = 0;
let current  = startDate;

while (current <= endDate) {
  if (!calendar[current]) {
    const day     = dayName(current);
    const dayPlan = plan.weekly[day];

    let entry;
    if (dayPlan.track === 'educational') {
      entry = {
        track:       'educational',
        scheduledAt: scheduledAtForDate(current),
      };
    } else if (dayPlan.pool === 'rotation') {
      const campaign = rotation[rotationIndex % rotation.length];
      rotationIndex++;
      entry = {
        track:       'campaign',
        campaign,
        scheduledAt: scheduledAtForDate(current),
      };
    } else {
      entry = {
        track:       'campaign',
        campaign:    dayPlan.campaign,
        scheduledAt: scheduledAtForDate(current),
      };
    }

    calendar[current] = entry;
    newCount++;
  }
  current = addDays(current, 1);
}

// Sort calendar by date
const sorted = Object.fromEntries(
  Object.entries(calendar).sort(([a], [b]) => a.localeCompare(b))
);

writeFileSync(calendarPath, JSON.stringify(sorted, null, 2), 'utf8');

// Update rotationIndex in plan
plan.rotationIndex = rotationIndex;
writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');

console.log(`✓ Calendar extended: ${newCount} new entries added (through ${endDate})`);
console.log(`  Campaign rotation index: ${rotationIndex}`);

// Show upcoming 14 days
const today = todayStr();
const upcoming = Object.entries(sorted)
  .filter(([d]) => d >= today)
  .slice(0, 14);

console.log('\nUpcoming 14 days:');
for (const [date, entry] of upcoming) {
  const day = dayName(date).slice(0, 3).toUpperCase();
  const label = entry.track === 'educational'
    ? 'EDUCATIONAL'
    : `CAMPAIGN → ${entry.campaign}`;
  console.log(`  ${date} ${day}  ${label}`);
}
