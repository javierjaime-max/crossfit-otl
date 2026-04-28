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

## Ecosystem Context

CrossFit OTL is one of several ships in the Firm. See root `CLAUDE.md` for the full ecosystem map. The Atlas app (`atlas-app/`) is the GP's office — it reports on all ships but does not own ship content. Ship brains and content pipelines are owned by the ship repo.

**Related repos:**
- `crossfit-otl-pricing/` — pricing + consultation pages (Vercel)
- `ccft-study-app/` — CCFT study tool
