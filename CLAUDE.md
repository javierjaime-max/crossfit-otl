# CLAUDE.md — CrossFit OTL Website

Public-facing website for CrossFit OTL. Static HTML. Deployed via GitHub → Vercel (or direct hosting) at crossfit-otl.com.

---

## CrossFit OTL Ecosystem (under Fit4)

CrossFit OTL has three layers — this repo is the **External** layer.

| Layer | What | Where |
|-------|------|-------|
| **External** | Public website, social media (future) | `crossfit-otl/` ← YOU ARE HERE |
| **Prospect Engagement** | Pricing guide, explainer, leaderboard | `crossfit-otl-pricing/` → Vercel |
| **Internal / Coach Dev** | CCFT study app, CCFT-Brain (Obsidian) | `ccft-study-app/`, Obsidian vault |

Knowledge source: Javier's Obsidian brain → Atlas S3 vault when needed.

Social media (future): sourced from photo library + CCFT knowledge base.

---

## What's Here

| File | What It Is |
|------|-----------|
| `index.html` | Full site — single page, all sections inline |
| `photos/` | Site photos (storefront, members, gym) |
| `robots.txt` | SEO — allow all |
| `sitemap.xml` | SEO sitemap |

Single-file site. All HTML/CSS/JS is in `index.html`.

---

## Business Context

- **Location:** North Richland Hills, TX (DFW Mid-Cities)
- **Founded:** 2015
- **Price:** $180/4 weeks flat — no tiers, no upsells
- **Programs:** CrossFit classes, youth programs, personal training, lifestyle coaching
- **GHL:** Chat widget embedded — GoHighLevel handles lead capture and follow-up

---

## Ownership

- Deanie runs day-to-day operations
- Coaches: Nicholas, Ava, Clay
- Javier owns pricing strategy and digital presence
- Atlas owns go-to-market analysis — proposes, Javier approves

---

## Deploy Pipeline

```bash
git add -p
git commit -m "feat: <what changed>"
git push origin main
# Auto-deploys to crossfit-otl.com
```

No build step. Static HTML served directly.

---

## Session Protocol

```bash
cd ~/Library/CloudStorage/OneDrive-OnTheLineFitness/GitHub/crossfit-otl
git pull
# Edit index.html directly
# Preview: open index.html in browser
git push origin main
```

---

## Active Projects (as of Apr 2026)

- Social media presence — priority near-term (sourced from photo library + CCFT knowledge base)
- GHL funnel integration — near future
- Content refresh aligned with L·OS lifestyle coaching angle
