# CLAUDE.md — CrossFit OTL

CrossFit OTL is one ship in the Fit4 Associates portfolio. This repo contains the public website, the OTL ship brain, and the Instagram content pipeline.

**Always `git pull` before touching any file. Always `git push origin main` when done.**

---

## OTL at a Glance

- **Location:** North Richland Hills, TX (DFW Mid-Cities)
- **Founded:** **2017** in the garage, as **"Box 9013"** (couldn't use the CrossFit name without an affiliate license). **February 2022** = commercial space opens, name becomes CrossFit OTL, 30 founding members carry over from the garage.
- **The gym is 2017. The affiliate is 2022.** Apparel and anniversary copy use **EST. 2017** — the premise of who we are, why we do it, and how we help people has not changed since the garage. Never date the brand from 2022; that dates the paperwork. Detail in `brain/origin-story.md`.
- **Current size:** ~120+ members (adults + teens + kids + PT)
- **Price:** **Unlimited $180 / 4 weeks** · **12 sessions $145 / 4 weeks**. Development Time is an Unlimited-only benefit. **Never put membership pricing in the new member packet or /welcome.**
- **Youth classes:** **Kids = Tue/Thu 4PM** · **Teens = Mon/Tue/Thu 5PM** (no Wednesday teens). Adult CrossFit runs all weekday slots; 5PM and 6PM are Mon–Thu. Full grid in `brain/coaching/class-management.md`.
- **Programs:** CrossFit classes, CrossFit Kids/Teens, Development Time (Unlimited only), personal training, nutrition coaching, The Lifestyle Reset (12 wk), InBody scan ($35, open to anyone)
- **Corporate structure:** Fit4 Associates Inc. (S Corp) — CrossFit OTL is a DBA
- **Instagram:** @crossfitotl (IG User ID: 17841448179180217)
- **Programming:** CAP (CrossFit Affiliate Programming) — James Hobart
- **Business framework:** Two-Brain Business

---

## Coaching Team

**11 coaches. Family first, couples together, then staff by floor activity.**

| Coach | Role | Cert |
|-------|------|------|
| Javier Jaime | Founder / Coach | **L3** (earned Jul 2026) |
| Deanie Jaime | Co-Founder / GM / Nutrition Coach | L2 |
| Isabel Butler | Co-Founder / Coach | L2, L3 candidate |
| Clay Butler | Coach | L2 · USAW-L1 · ATG |
| Nicholas Jaime | Co-Founder / Coach | L2 |
| Ava Jaime | Coach | L1 |
| Lamar DeOreo | Coach / Nutrition Coach | L2 |
| Christi Chaka | Coach (5AM) | L2 |
| Maci Osborn | Coach | L1 |
| Kasey Price | Coach / Kids | L1 |
| Nichole Ward | Coach | L1 |

**Hard rules for any coach-facing copy (GP, 2026-08-04):**
- Javier is **not** the head coach; CrossFit OTL does not name one.
- **"Certified CrossFit Trainer" means L3 and only L3.** L1/L2 holders "hold a CrossFit Level 1/2" or are "credentialed by CrossFit."
- **Never rank coaches against each other**, and **never list side businesses** in bios.
- Isabel and Nicholas **started CrossFit as kids** — they did not start the kids program.
- **Never write bare "OTL."** It is **CrossFit OTL**; full identity **CrossFit OTL — On The Line Fitness**.

Full detail in `brain/people.md`.

---

## Ship Brain

**`brain/` is the source of truth for OTL knowledge.**

| File/Dir | What It Is |
|---|---|
| `brain/people.md` | Full coach roster — credentials, backstory, personality |
| `brain/origin-story.md` | How OTL was built — Javier's story, the garage years |
| `brain/philosophy.md` | OTL values, voice, what we do and don't do |
| `brain/campaigns/` | All active campaign briefs (see campaigns section below) |
| `brain/ops/member-experience.md` | Committed Club, programs, front of house, naming + voice rules |
| `brain/ops/safety-and-emergency.md` | AED, the 911 address, first aid, kids flooring, barbell drops |
| `brain/ops/facility.md` | Space, equipment, **authoritative membership pricing** |
| `brain/ops/asop-new-member-onboarding.md` | Where the welcome packet sits in the new member sequence + the On-Ramp floor-walk checklist |
| `brain/ops/asop-new-member-onboarding-email.md` | Welcome email copy, ready to paste into PushPress |

Architecture decision (2026-04-27): Ship brains live in GitHub repos as markdown. The Obsidian Vault is for personal content only — no ship brain content goes there.

---

## Active Campaigns

| Campaign | Slug | When Used |
|---|---|---|
| Forging Elite Fitness | `forging-elite-fitness` | Tue/Thu rotation |
| CrossFit Is the Cure | `crossfit-is-the-cure` | Tue/Thu rotation |
| This Is CrossFit | `this-is-crossfit` | Tue/Thu rotation |
| The CrossFit Effect | `the-crossfit-effect` | Tue/Thu rotation |
| Share Your Stories | `share-your-stories` | Tue/Thu rotation |
| Lifestyle Reset | `lifestyle-reset` | Every Saturday |
| Join Our Culture | `join-our-culture` | Every Sunday |
| Murph 2025 | `murph-2025` | Event-specific (manual) |
| Chad1000x 2025 | `chad1000x-2025` | Event-specific (manual) |

---

## Website

Public-facing static HTML at crossfit-otl.com. No build step.

| File | What It Is |
|---|---|
| `index.html` | Full site — single page, all sections inline |
| `welcome.html` | **New member welcome page** at `/welcome` (rewrite in vercel.json). Same file prints the 15-page PDF packet via its `@media print` block — edit once, page and PDF stay in sync. Source of the PDF also mirrored at `Fit4/CrossFit OTL/Marketing/new-member-packet/`. |
| `welcome-img/` | Images for the welcome page |
| `blog/` | **The blog.** `blog/index.html` is the listing at `/blog/`; each post is `blog/<slug>.html` with a clean-URL rewrite in `vercel.json` and a `<url>` in `sitemap.xml`. Every post carries canonical, Open Graph article tags, Twitter card, and BlogPosting + BreadcrumbList JSON-LD. Images live in `blog/img/` (hero 1600×900 webp, social 1200×630 jpg, card 800×450 webp). Drafts are authored first in `Fit4/CrossFit OTL/Content/blog/`. First post 2026-09-03: `fifteen-days-a-month` (consistency), hero = the Board at the front of the gym. |
| `Fit4/CrossFit OTL/Content/blog/staged/<slug>/` | **Scheduled posts.** A post that goes live on a future date is staged OUTSIDE the repo (so it cannot be reached early): `<slug>.html`, `img/*`, `golive.json` (card + sitemap metadata). The Mini's `~/Library/Scripts/Atlas/otl_blog_golive.py <slug>` (one-shot cron on the go-live date) pulls, copies it in, adds the rewrite, sitemap entry and index card, commits, pushes over the Mini's deploy key, verifies the live URL, and writes `GOLIVE-DONE.json` (or `GOLIVE-FAILED.json`) into the staged folder. Rehearse with `--dry-run` (throwaway clone, no push). Each blog post also gets a carousel in `pipeline/output/<date>/<slug>/` with `status: approved` and `scheduledAt` so the 7:00 publisher posts it the same morning. |
| `photos/` | Site photos |
| `robots.txt` | SEO |
| `sitemap.xml` | SEO sitemap |

```bash
git add -p && git commit -m "feat: <what changed>" && git push origin main
# Auto-deploys to crossfit-otl.com
```

---

## Instagram Content Pipeline

**Full ASOP:** `Firm/asops/asop-otl-content-pipeline.md` — read this before touching the pipeline.

### How It Works

One post per day. Content is generated 7 days ahead so every post has a review window before going live.

```
7:00am daily  → publish-overdue-otl.js (launchd) → posts today's approved post to Instagram
7:05am daily  → generate-next.js (launchd) → generates post for today + 7 days
Days 1–6      → review in queue UI → approve
Day 7 7:00am  → posts automatically
```

### Weekly Editorial Pattern

| Day | Track | Content |
|---|---|---|
| Mon / Wed / Fri | Educational | CCFT topic rotation (18 topics, ccft-tracker.json) |
| Tue / Thu | Campaign | Alternating rotation of 5 campaigns |
| Saturday | Campaign | `lifestyle-reset` (always) |
| Sunday | Campaign | `join-our-culture` (always) |

### Pipeline Files

| File | What It Does |
|---|---|
| `pipeline/generate.js` | Main generator — reads brain, calls Claude Sonnet, renders PNGs via Puppeteer |
| `pipeline/generate-next.js` | Daily auto-generator — reads calendar for today+7, invokes generate.js |
| `pipeline/extend-calendar.js` | Extends content-calendar.json 60 days ahead — run monthly |
| `pipeline/publish-overdue-otl.js` | Daily publisher — posts approved posts at 7:00am |
| `pipeline/server.js` | Queue review UI at localhost:3001 |
| `pipeline/queue.js` | Supabase queue operations |
| `pipeline/photo-library.js` | Cloudinary photo selection |
| `pipeline/post_to_instagram.js` | Instagram Graph API wrapper |
| `pipeline/content-plan.json` | Weekly rules + campaign rotation index (source of editorial truth) |
| `pipeline/content-calendar.json` | Pre-generated flat date map (60 days ahead) |
| `pipeline/ccft-topics.json` | 18 CCFT methodology topics |
| `pipeline/ccft-tracker.json` | Which CCFT topics have been used this cycle |
| `pipeline/templates.jsx` | React/JSX slide templates rendered by Puppeteer |
| `pipeline/vendor.*.js` | Local React/Babel — do NOT replace with CDN URLs |

### Generator Usage

```bash
cd pipeline

# What launchd runs daily (recommended path)
node generate-next.js
node generate-next.js --dry-run    # see what would generate without running

# Manual — educational post
node generate.js --track educational --slug edu_virtuosity --date 2026-05-10 \
  --scheduled-at 2026-05-10T12:00:00.000Z

# Manual — campaign post
node generate.js --campaign crossfit-is-the-cure --slug citc_may10 --date 2026-05-10 \
  --scheduled-at 2026-05-10T12:00:00.000Z

# Extend the calendar (run monthly)
node extend-calendar.js
```

### Template System

Three templates, always in this order:

| Template | Slide | Purpose |
|---|---|---|
| **HookSlide** | Slide 1 | Stop the scroll. Bold/contrarian claim. Full-bleed photo. |
| **ValueSlide** | Slides 2–N | One true thing per slide. `variant: "a"` (photo + text) or `"b"` (type-dominant, no photo). |
| **CarouselCTA** | Last slide | FOLLOW FOR MORE + Save It + CTA. Photo required. |

Output size: **1080×1350px** always. Do not use `element.screenshot()` — use `page.screenshot({ clip: { x, y, width: 1080, height: 1350 } })`.

### Photo System

Cloudinary at `crossfit-otl/library`. Tagged: `intensity`, `barbell`, `pull-ups`, `kettlebell`, `rowing`, `group`, `community`, `coach`, `quality:1`–`quality:5`. Pipeline selects via tag chain (specific → general → any). HookSlide + CarouselCTA always get quality ≥ 4. ValueSlide variant `"b"` never gets a photo.

Photo intake process: `Firm/asops/asop-otl-photo-intake.md`

### Review Queue

**Local:** `node pipeline/server.js` → http://localhost:3001

**Remote (ngrok):**
```bash
# Check if running
curl -s http://localhost:4040/api/tunnels | python3 -c \
  "import sys,json; t=json.load(sys.stdin)['tunnels']; [print(x['public_url']) for x in t if 'https' in x['public_url']]"

# Start
nohup ngrok http 3001 > /tmp/ngrok.log 2>&1 &
```

Note: ngrok URL changes on each restart. Permanent remote access is via the OTL Queue view in the Atlas app (`atlas-app-nine-mauve.vercel.app` → OTL Queue nav item).

### launchd Agents (Mac mini)

**Runtime lives OUTSIDE OneDrive (2026-09-03).** `node_modules` cannot live in the sync tree (the August upload wedge), so the wrappers in `~/Library/Scripts/Atlas/run-*.sh` rsync this `pipeline/` folder to `~/otl-pipeline/` on the Mini and run there; `~/otl-pipeline/output` is a symlink back to `pipeline/output/` in OneDrive. Edit code here; the wrappers sync it before every run. To install or update dependencies: `cd ~/otl-pipeline && PUPPETEER_SKIP_DOWNLOAD=1 npm install`. **The daily generator is OFF by GP decision (2026-09-03): only blog posts and their companion carousels are published; do not extend the calendar or revive `generate-next.js` without a fresh ruling.** From 2026-07-23 to 2026-09-03 the publisher crashed on `ERR_MODULE_NOT_FOUND` every morning and `content-calendar.json` had run out; nothing was generated or posted in that window.

| Agent | Fires | Runs |
|---|---|---|
| `com.otl.generate-next` | 7:05am daily | `generate-next.js` |
| `com.otl.publish-scheduled` | 7:00am daily | `publish-overdue-otl.js` |
| `com.otl.photo-intake` | Scheduled | `intake.js` |

```bash
# Verify agents are loaded
launchctl list | grep otl

# Check logs
cat /tmp/otl-generate-next.log
cat /tmp/otl-generate-next.err
cat /tmp/otl-publish-scheduled.log
cat /tmp/otl-publish-scheduled.err

# Reload after plist edit
launchctl unload ~/Library/LaunchAgents/com.otl.generate-next.plist
launchctl load ~/Library/LaunchAgents/com.otl.generate-next.plist
```

### Publisher Note

Two publishers exist — only one is active:

- **`publish-overdue-otl.js` (launchd) — AUTHORITATIVE.** Reads local `output/` dirs, posts `status: "approved"` posts.
- **`api/publish-scheduled-otl.ts` (Vercel cron) — NOT ACTIVE.** Reads Supabase for `status: "pending"` — misaligned with queue UI which sets `"approved"`. Status values must be reconciled before this path is usable.

### Output Structure

```
pipeline/output/
  2026-05-10/
    edu_virtuosity/
      slide_1.png    slide_2.png    slide_3.png    slide_4.png
      slides.json    caption.txt    meta.json
```

`meta.json` key fields: `status` (draft → approved → posted), `scheduledAt` (ISO UTC), `queueId` (Supabase row ID), `cloudinaryUrls`, `postedAt`, `igPostId`, `track`, `campaign`.

---

## Related Repos

| Repo | Location | What It Is |
|---|---|---|
| `crossfit-otl-pricing/` | `GitHub/crossfit-otl-pricing/` | Pricing + consultation pages (Vercel) |
| `ccft-study-app/` | `GitHub/ccft-study-app/` | DECOMMISSIONED 2026-07-19 — replaced by NotebookLM; Vercel delete + repo archive pending |

---

## Firm ASOPs — Read Before Working on Pipeline

| ASOP | Covers |
|---|---|
| `Firm/asops/asop-otl-content-pipeline.md` | **Start here** — full OTL pipeline end to end |
| `Firm/asops/asop-carousel-creation.md` | Template system + design principles |
| `Firm/asops/asop-social-publishing.md` | Fleet publishing mechanics + ship configs |
| `Firm/asops/asop-otl-photo-intake.md` | iPhone → Cloudinary photo intake |
