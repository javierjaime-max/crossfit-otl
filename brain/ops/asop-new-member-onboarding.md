---
type: brain/ops
source: built 2026-08-04 alongside the welcome packet
last-updated: 2026-08-04
tags:
  - otl
  - otl/brain
  - otl/ops
  - otl/onboarding
---

# CrossFit OTL — New Member Onboarding

Where the welcome packet lives inside the new member process, and who does what at each step.

**The packet is not a sales tool.** It carries no pricing, by decision. It is for someone who has already said yes. The consultation sells; the packet orients.

**One artifact, two forms:**
- **The page** — <https://crossfit-otl.com/welcome> — always current, linkable, reads on a phone. This is the primary form.
- **The PDF** — printed from the identical file. For the physical hand-off and the front desk copy.

They cannot drift apart: both are generated from `welcome.html` in this repo. Edit once.

---

## The sequence

| # | Step | Owner | Packet's role |
|---|---|---|---|
| 1 | **Consultation** | Javier | **None.** No packet, no link. The consult is its own conversation — see `../coaching/consultation-process.md`. |
| 2 | **They sign up** | Javier / Deanie | **Send the link.** This is the primary hand-off. |
| 3 | **Waiver + release forms** | Front desk | None — the forms are the legal record. The packet deliberately restates none of it. |
| 4 | **InBody scan + nutrition walk-through** | Coach | Packet already told them this is coming and that it's free. |
| 5 | **On-Ramp session 1** | Coach | **The floor walk** — see checklist below. This is the step that makes the safety page real. |
| 6 | **On-Ramp sessions 2–3** | Coach | None. |
| 7 | **First group class** | Class coach | Coach should know a new member is in the room. |
| 8 | **Day 30 / 60 / 90** | ⚠️ NEEDS_JAVIER | The packet promises the first ninety days are the gate. Nothing currently follows up on that promise. |

---

## Step 2 — the send

The moment someone signs up they get the link. Email copy is in `asop-new-member-onboarding-email.md`.

**Preferred:** an automated welcome email from **PushPress** on new-member creation, so it never depends on someone remembering.
**Fallback:** send manually at signup.

⚠️ **NEEDS_JAVIER:** confirm whether PushPress automation sends this or whether it is manual today.

---

## Step 5 — the On-Ramp floor walk (coach checklist)

The emergency page ends with: *"Point out the AED and the door address to the next new person who walks in. That's how this actually gets known — member to member, not from a packet."*

**That line only pays off if a coach does it in session 1.** Four physical stops, under two minutes:

1. **Walk to the front door.** Show them the address posted inside it. Say why: a dispatcher cannot send anyone until they have an address.
2. **Walk to the back door.** Show them the address at eye level there. Say why: running days and any time class is outside.
3. **Walk to the water fountains.** Put a hand on the AED. Tell them it talks out loud once opened and needs no training.
4. **Point at the floor line.** Brown wooden floor is where kids stay; black rubber is the training floor.

Then: "Everything else is in the welcome packet — read the first ninety days page tonight."

---

## What the packet does that nothing else does

Worth protecting when the process changes:

- **The first ninety days page** names soreness (week 1), ego (week 4), impatience (week 4), and the fade (month 3) *before* the member hits them. Naming an attrition moment in advance is what turns it from a reason to quit into a thing they were told about.
- **The methodology page** points members at the L1 Training Guide and the CrossFit Journal so they can go learn the *why* without waiting to ask a coach.
- **The Committed Club** is stated as a predictor, never a promise.
- **The emergency page** exists because a member had a heart attack and nobody could give 911 the address.

---

## Rules that govern the packet

Full list in `member-experience.md`. The load-bearing ones:

- **No membership pricing.** The packet is post-sale.
- **No legal or release language.** The signed forms are the source of truth.
- **No routing by name** — "ask a coach," never "ask Javier or Deanie."
- **It is CrossFit OTL — On The Line Fitness.** Never bare "OTL," never the Fit4 DBA.

---

## Open questions

⚠️ **NEEDS_JAVIER** — these block a complete onboarding ASOP:

1. Is there a **free trial class**, or does everyone go consult → on-ramp?
2. **Who sends the welcome link** — PushPress automation, or a person?
3. Is the class coach **told in advance** that a new member is coming to their first class?
4. Is there a **30/60/90 check-in**? The packet makes a promise about the first ninety days that nothing currently follows up on.
