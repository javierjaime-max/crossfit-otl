# CLAUDE.md — CrossFit OTL

CrossFit OTL is one ship in the Fit4 Associates portfolio. This repo contains the public website **and the OTL ship brain** — the canonical knowledge base for content generation, coaching context, and Atlas-driven automation.

---

## Ship Brain — Canonical Location

**`brain/` in this repo is the source of truth for OTL knowledge.**

| File | What It Is |
|------|-----------|
| `brain/people.md` | Full coach roster — credentials, backstory, personality |
| `brain/origin-story.md` | How OTL was built — Javier's story, the garage years, why the gym exists |
| `brain/philosophy.md` | OTL values, voice, what we do and don't do |
| `brain/campaigns/` | All active CrossFit HQ campaigns + OTL-specific angles |

**Architecture decision (2026-04-27):** Ship brains live in GitHub repos as markdown, not in the Obsidian Vault. The Obsidian Vault is legacy — no new ship brain content goes there. Supabase `vault_documents` is the query layer; this repo is the authoring layer.

**Always `git pull` before editing brain files. Always `git push` after.**

---

## OTL at a Glance

- **Location:** North Richland Hills, TX (DFW Mid-Cities)
- **Opened:** February 2022 (30 founding members from garage gym)
- **Current size:** ~120+ members (adults + teens + kids + PT)
- **Price:** $180/4 weeks flat — no tiers, no upsells
- **Programs:** CrossFit classes, CrossFit Kids/Teens, personal training
- **Corporate structure:** Fit4 Associates Inc. (S Corp) — CrossFit OTL is a DBA
- **Instagram:** @crossfitotl (IG User ID: 17841448179180217)
- **Programming:** CAP (CrossFit Affiliate Programming) — James Hobart
- **Business framework:** Two-Brain Business

---

## Coaching Team

| Coach | Role | Cert |
|-------|------|------|
| Javier Jaime | Founder / Head Coach | L2, on path to L3 |
| Deanie Jaime | Co-Founder / GM | L2 |
| Isabel Butler | Coach / CrossFit Kids Lead | L2, on path to L3 |
| Nicholas Jaime | Coach | L2 |
| Clay Butler | Coach | L2 |
| Lamar DeOreo | Coach | L2 |
| Ava Jaime | Coach | L1 |
| Maci Osborn | Coach | L1 |
| Nichole Ward | Coach | L1 |
| Christi Chaka | Coach | L2 (recent) |

Full detail in `brain/people.md`.

---

## Website

Public-facing static HTML at crossfit-otl.com.

| File | What It Is |
|------|-----------|
| `index.html` | Full site — single page, all sections inline |
| `photos/` | Site photos |
| `robots.txt` | SEO |
| `sitemap.xml` | SEO sitemap |

No build step. Static HTML served directly.

---

## Deploy Pipeline

```bash
git add -p
git commit -m "feat: <what changed>"
git push origin main
# Auto-deploys to crossfit-otl.com
```

---

## Session Protocol

```bash
cd ~/Library/CloudStorage/OneDrive-OnTheLineFitness/GitHub/crossfit-otl
git config user.email "javier.jaime@me.com"
git pull
# Edit files
git push origin main
```

---

## Instagram Content Pipeline

**Location:** `pipeline/` directory in this repo.

The pipeline generates Instagram carousel posts autonomously — from Claude content generation through Puppeteer rendering to a review queue served by a local server.

### Template System (canonical — updated 2026-05-01)

OTL carousels use exactly **three templates** in this order. No other templates are used for carousel posts.

| Template | Position | Purpose | Key fields |
|---|---|---|---|
| **HookSlide** | Slide 1 | Stop the scroll. Bold/contrarian claim. Full-bleed photo. | `headline`, `curiosity`, `photo: null` |
| **ValueSlide** | Slides 2–N | One true thing per slide. Numbered badge + nugget. | `variant` (`"a"` or `"b"`), `slideLabel`, `headline`, `body`, `nugget`, `photo: null` |
| **CarouselCTA** | Last slide | Fixed close. FOLLOW FOR MORE + Save It + CTA. Photo required. | `cta.action`, `cta.detail`, `photo: null` |

**ValueSlide variants:**
- `variant: "a"` — photo top half + text bottom. Photo crops `top center` — faces always visible.
- `variant: "b"` — type-dominant, no photo. Black background + red left rail + ghost number. Pure textual force.

**Note:** The LOS pipeline (`lifestyle-os-site/pipeline/`) uses a completely different format system (`short/depth/gap`). Do NOT apply LOS formats to OTL content or vice versa.

### Pipeline Files

| File | What It Is |
|---|---|
| `pipeline/generate.js` | Main generator — reads brain, calls Claude, renders PNGs via Puppeteer |
| `pipeline/templates.jsx` | React/JSX templates rendered by Puppeteer at 1080×1350px |
| `pipeline/photo-library.js` | Cloudinary photo selection — tag chain fallback, quality filter, deduplication |
| `pipeline/server.js` | Local review server — queue UI at localhost:3000 |
| `pipeline/queue.js` | Supabase post queue — stage → approve → post |
| `pipeline/ccft-topics.json` | 18 educational topics from CrossFit methodology |
| `pipeline/ccft-tracker.json` | Cycle tracker — ensures all topics are used before repeating |
| `pipeline/render.html` | Puppeteer render harness — loads vendor JS locally (no CDN) |

### Generator Usage

```bash
cd pipeline

# Campaign post
node generate.js --campaign crossfit-is-the-cure --slug citc_may01 --date 2026-05-01

# Educational post (auto-picks unused CCFT topic)
node generate.js --track educational --slug edu_aerobic --date 2026-05-01

# Preview only (no render)
node generate.js --campaign forging-elite-fitness --preview

# Available campaigns (brain/campaigns/):
#   crossfit-is-the-cure | forging-elite-fitness | join-our-culture
#   coaches-who-compete | community-not-clients | constantly-varied-means-something
#   murph-host | the-crossfit-template
```

### Photo System

Photos come from Cloudinary library at `crossfit-otl/library`. Tagged with:
- Movement/equipment tags: `intensity`, `barbell`, `pull-ups`, `kettlebell`, `rowing`, etc.
- Theme tags: `group`, `community`, `coach`, `murph`, `kids-class`
- Quality tags: `quality:1` through `quality:5`

Pipeline selects photos via a tag chain (specific → general → any). HookSlide and CarouselCTA always get high-intensity photos (quality ≥ 4). ValueSlide variant `"b"` never gets a photo.

**Photo intake:** iPhone → iCloud → nightly osxphotos script → Claude Vision triage → Cloudinary upload.
Full process: `Firm/asops/asop-otl-photo-intake.md`

### Vendor Scripts (local — no CDN)

The render harness loads React, ReactDOM, and Babel from local files (`pipeline/vendor.*.js`). These must NOT be replaced with CDN URLs — headless Chrome cannot load CDN scripts in file:// mode.

---

## Ecosystem Context

CrossFit OTL is one of several ships in the Firm. See root `CLAUDE.md` for the full ecosystem map. The Atlas app (`atlas-app/`) is the GP's office — it reports on all ships but does not own ship content. Ship brains and content pipelines are owned by the ship repo.

**Related repos:**
- `crossfit-otl-pricing/` — pricing + consultation pages (Vercel)
- `ccft-study-app/` — CCFT study tool

**Firm ASOPs (read when working on pipeline or content):**
- `Firm/asops/asop-carousel-creation.md` — canonical template system + design principles
- `Firm/asops/asop-social-publishing.md` — how posts go from queue to Instagram
- `Firm/asops/asop-otl-photo-intake.md` — how community photos get into Cloudinary
