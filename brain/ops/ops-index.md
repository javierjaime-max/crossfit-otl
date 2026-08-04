---
type: brain/ops
last-updated: 2026-07-18
tags:
  - otl
  - otl/brain
  - otl/ops
---

# CrossFit OTL — Operational Knowledge Index

This directory captures how we actually run the gym — the institutional knowledge that lives in Javier's and Deanie's heads and needs to exist in writing so any coach can operate independently.

Each file is an atom. When a role-specific SOP is needed (e.g., "Opening Coach Protocol" or "New Member Check-In"), it is generated from these atoms on demand.

## Atoms

| File | Covers | Status |
|---|---|---|
| `facility.md` | Location, space layout, rent, landlord | Partial — gaps flagged |
| `door-protocols.md` | Open/close sequences, access codes, alarm | Skeleton — needs Javier |
| `screen-sequences.md` | TV, tablet, app sequences for class setup | Skeleton — needs Javier |
| `ordering.md` | Equipment and supply ordering — what, from where, how often | Skeleton — needs Javier |
| `vendors.md` | All vendor contacts — equipment, supplies, services | Skeleton — needs Javier |
| `service-standards.md` | Member experience, greeting, class start/end protocol | Partial — extracted from brain |

## Liability & HR Documents (Added 2026-07-18 — Bob Douglas cardiac event)

| File | Covers | Status |
|---|---|---|
| `emergency-action-plan.md` | EAP: cardiac, injury, fire, tornado, active threat, AED, incident reporting | Draft — needs Javier review + NEEDS_JAVIER gaps filled |
| `employee-manual.md` | Coach handbook: employment, standards, safety, conduct, discipline | Draft — needs attorney review before distributing |
| `sop-library.md` | 10 SOPs: opening, closing, pre-class, equipment inspection, incidents, class management, new member, drop-in, cleaning, equipment failure | Draft — needs Javier to fill NEEDS_JAVIER placeholders |

## How to Use These

To generate a role-specific SOP (e.g., "what does the opening coach do from 4:30am to 5am"), ask Atlas: "Generate the opening coach protocol using the ops atoms." Atlas will pull the relevant atoms and produce a step-by-step doc.

To fill in a gap, capture it by voice and route to crossfit-otl. Atlas will atomize it here.

- [safety-and-emergency.md](safety-and-emergency.md) — AED, 911 address, first aid, kids flooring, barbell drops
- [member-experience.md](member-experience.md) — Committed Club, programs, front of house, naming/voice rules
