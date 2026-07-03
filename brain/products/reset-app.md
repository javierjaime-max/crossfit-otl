---
product: "reset-app"
status: draft-prd
captured: 2026-07-03
source: "Pocket capture 2026-07-03 — Trainerize replacement app planning (recording d66b52a7)"
tags:
  - otl
  - otl/product
---

# Reset App — PRD (Trainerize + Microsoft Forms Replacement)

## The Problem

The Lifestyle Reset program runs on fragmented tooling and none of it talks to each other:

| Today | Pain |
|---|---|
| Trainerize (white-labeled) | Client app exists, but consultation data never makes it in. Deanie must transpose manually — usually doesn't. |
| Microsoft Form #1 — nutrition consultation questionnaire | Lives outside the app entirely. |
| Microsoft Form #2 — per-meeting notes | Output is an Excel file on Deanie's OneDrive. That spreadsheet is the only "client record." |
| iMessage | Where the actual coach–client conversations happen. Zero capture. |
| PushPress | Scheduling/calendar, separate from everything above. |

**Consequence:** No single place where either Deanie or the client can see the full history. When a client walks in the door, situational awareness depends on Deanie's memory.

## The Premise

> "The whole premise of the app is to create the one place that the coach and the client have to source their knowledge and to share and transfer information."

The Reset sells as nutrition to most buyers, but it's a high-touch drift-prevention system. The app's job is to maximize touch points and keep the client anchored to the goals they walked in with. Both coach AND client see the same record.

## Requirements (from 2026-07-03 capture)

1. **Client profile** — identity, fitness profile, goals, program status. The single source of truth.
2. **Consultation questionnaire in-app** — replaces MS Form #1. Answers land on the client record, not in a spreadsheet.
3. **Meeting notes with full history** — replaces MS Form #2. Visible to both coach and client. Deanie is "situationally aware when people walk in the door about any prior conversations" — and so is the client.
4. **Meeting recorder → transcript → summary** — Pocket-style: record the consult, transcribe, summarize, send summary to coach + client, accumulate on the client record. (We already run mlx-whisper + Claude classification for voice memos — same pattern.)
5. **In-app messaging** — replace iMessage as the conversation channel. Structural change is easy; this one is a *behavioral* change and needs deliberate adoption push.
6. **Scheduling** — book/manage consults in-app. (PushPress is OTL's membership management tool and stays independent — out of scope for this app, per Javier 2026-07-03.)
7. **Macros** — set and manage macro targets per client.
8. **Wearable integration (Apple Watch / Garmin / Apple Health)** — step counts + calorie expenditure feed a deficit calculator: target 1 lb fat/week → 500 cal/day deficit → given average daily expenditure, recommend the calorie/macro goal. Explicitly "not a deal breaker" — do not let this block v1.

## Recommended Stack

Same stack as everything else in the fleet — zero new operational surface:

- **React / Vite / TypeScript on Vercel** — installable PWA so clients get an "app" on their home screen without App Store friction.
- **Supabase** — Postgres + Auth (coach and client roles via RLS) + Storage (audio recordings).
- **Anthropic API** — meeting summarization, macro recommendation drafting.
- **Whisper transcription** — reuse the existing voice-memo pipeline pattern (mlx-whisper local or API).

## Build Phases

| Phase | Ships | Kills |
|---|---|---|
| **1 — Client record** | Profile, goals, in-app consultation questionnaire, meeting notes with history, macro targets. Coach view + basic client view. | Both Microsoft Forms and the Excel "database" on day one. |
| **2 — Communication** | In-app messaging, in-app consult scheduling, client notifications. | iMessage as system-of-record. |
| **3 — Recorder** | Record consult → transcript → Claude summary → emailed to coach + client → stored on client record. | Manual note-taking entirely. |
| **4 — Wearables** | Apple Health / Garmin data → expenditure averages → deficit/surplus calculator → macro recommendations. | The last Trainerize dependency. |

**Trainerize cancel point:** end of Phase 2 (or Phase 4 if Deanie considers the watch data essential in practice).

## Open Decisions

- **Wearables approach:** PWA cannot read HealthKit. Options: (a) aggregator API (Terra/Spike — subscription cost, fastest), (b) thin native iOS wrapper (Capacitor) with HealthKit — more build, no per-user fees, (c) manual weekly entry as stopgap. Decide at Phase 4, not before.
- **App name/brand:** unnamed. It is the OTL client app — bigger than just the Reset if PT/membership clients use it later.
- **Repo:** proposed `GitHub/otl-reset-app/` (own repo, own Vercel project), pending confirmation.
