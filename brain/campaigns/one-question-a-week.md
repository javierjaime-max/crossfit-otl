---
campaign: "One Question a Week"
source: "OTL original — Javier, 2026-08-02"
status: draft
captured: 2026-08-02
tags:
  - otl
  - otl/campaign
  - otl/story-harvest
---

# One Question a Week — The Story Harvest

## The Thesis

There is no demand shortage for CrossFit. There is a story shortage. People do not need to be taught what CrossFit is — they need to hear from someone who felt exactly the way they feel right now and walked in anyway.

This campaign replaces education with testimony. It does not add a channel; it takes slots away from the educational rotation.

## The Mechanic

**One question. One week. Whole gym at once.** Nobody gets interviewed. The question goes out Monday in every channel simultaneously and answers come back all week.

Two parts, always:

1. **The question** — surfaces the *before* state. Short enough to answer sweaty, on a phone, in thirty seconds.
2. **The bridge** — *"What would you say to someone who feels that way right now?"*

The bridge is the entire campaign. Part 1 gets you a member's memory. Part 2 turns that member into the person speaking directly to the prospect sitting in the parking lot. That second answer is the ad. It was written by a member, about a stranger, for free.

### Design rules for any new question

- **Ask about the before, not the after.** The prospect is living in the before. "How has CrossFit changed your life" is an after-question and it returns clichés.
- **One sentence must be a complete answer.** If it needs a paragraph, it's an interview, not a harvest.
- **Never ask anything that can be answered with a number or a result.** Weight lost, PRs hit, and body composition are not the barrier. Fear is the barrier.
- **The bridge never changes.** Same follow-up every week. It's the format, and the format is what makes the answers usable.

### Weekly loop

| Day | What happens |
|---|---|
| Monday | Question goes out — whiteboard at the door, IG story with the question sticker, one text to the roster, coaches ask it out loud at the end of every class |
| Mon–Sat | Answers land. Text reply is the primary channel. Coaches who hear a good one in person text it in themselves. |
| Sunday | Harvest — pick 3–5. Each becomes a post: the answer is the image, the bridge answer is the caption. |

Nothing routes through Javier except the Sunday pick. That is the whole point — the previous system ([`lead-gen/04-testimonial-capture-system.md`](../../../../Fit4/CrossFit%20OTL/lead-gen/04-testimonial-capture-system.md)) put him in every step and consequently never ran once.

### Consent

One blanket ask when the program launches, plus a standing line under every weekly prompt:

> Answers may show up on our page. First name only. Tell us if you'd rather we didn't.

FTC 16 CFR Part 255 still governs paid use. Verbatim, unedited in substance, no fabrication. Keep the text thread. Full compliance detail lives in the testimonial capture system doc — that document's *legal* section survives; its *workflow* section is superseded by this one.

---

## The Question Bank — 52 Weeks

Every question below carries the same follow-up: **"What would you say to someone who feels that way right now?"**

### Arc 1 — The Door (weeks 1–10)
*The barrier before walking in. This is the highest-value arc and it is where the campaign starts. Intimidation is the enemy — this arc attacks it directly.*

1. Were you intimidated or scared to try CrossFit for the first time?
2. How long did you think about joining before you actually walked in?
3. What did you think CrossFit was before you tried it?
4. What almost stopped you from coming in?
5. Did you think you needed to get in shape first, before you could start?
6. Who or what finally got you through the door?
7. What were you afraid people here would think of you?
8. What did you believe you had to be able to *do* before you were allowed to start?
9. What did people in your life say when you told them you were doing CrossFit?
10. What was the excuse you used the longest?

### Arc 2 — The First Days (weeks 11–18)
*What actually happened versus what they braced for.*

11. What surprised you most about your first class?
12. What did you get completely wrong about what it would be like?
13. Who was the first person here to learn your name?
14. What did a coach do in your first week that you still remember?
15. How sore were you after the first one — and did you come back?
16. What were you sure was going to happen that never happened?
17. When did you stop feeling like the new person?
18. What's the first thing you couldn't do that you can do now?

### Arc 3 — The Grind (weeks 19–28)
*Staying. This arc is what separates real testimony from a highlight reel.*

19. When did you almost quit?
20. What keeps you coming back on the days you don't want to?
21. What's the longest you've been away — and what brought you back?
22. What's the hardest part that nobody warns you about?
23. Have you ever cried here?
24. What movement did you hate that you now actually like?
25. What did you fail at here for months?
26. What got you through an injury or a setback?
27. What do you tell yourself in the last two minutes of a workout?
28. What's the workout you were most scared of — did you do it?

### Arc 4 — What Actually Changed (weeks 29–38)
*Deliberately excludes appearance and numbers. The things that keep people are never the things that get them in the door.*

29. What changed that had nothing to do with how you look?
30. What can you do outside this gym now that you couldn't before?
31. How is your sleep different?
32. What did your doctor say?
33. What did your family notice before you did?
34. How did this change the way you handle stress?
35. What are you no longer afraid of?
36. What did you *stop* doing after you started?
37. What's different about how you eat now — and how did that happen?
38. How has this changed what you think you're capable of?

### Arc 5 — The People (weeks 39–46)
*The retention story. Also the hardest thing for a competitor to copy.*

39. Who here has changed your life?
40. Who noticed when you were gone?
41. What did a coach say to you that stuck?
42. Who did you meet here that you'd call at 2am?
43. What happened here on your worst day?
44. Who did you bring here — and why them?
45. What do we do here that your last gym didn't?
46. What would you miss most if this place closed tomorrow?

### Arc 6 — The Contrast (weeks 47–52)
*The switcher/returner material. Highest-converting testimony there is, because it's comparative.*

47. Where did you train before — and what felt different when you got here?
48. Have you trained somewhere else since? What did you notice?
49. What did you not realize you had here until you thought about leaving?
50. What do you say when someone asks you what CrossFit is?
51. If you could talk to yourself the day before your first class, what would you say?
52. Why are you still here?

---

## Wiring Into the Pipeline

This campaign only works if it takes slots, not adds them. Recommended change to `pipeline/content-plan.json`:

| Day | Current | Proposed |
|---|---|---|
| Mon / Wed / Fri | Educational (CCFT rotation) | **Mon: story harvest.** Wed/Fri educational (cut from 3 to 2) |
| Tue / Thu | Campaign rotation (4 of 5 educational) | **Tue: story harvest.** Thu: free-consultation (unchanged) |
| Saturday | lifestyle-reset | **Saturday: story harvest** |
| Sunday | join-our-culture | unchanged |

That's three story posts a week against one week's worth of harvested answers — which is the right ratio, since a single question typically yields 5–15 usable answers.

`content-calendar.json` is dead as of 2026-07-23 and has to be regenerated regardless.

## Open Items

- **Public-facing name.** "One Question a Week" is the internal slug. The name members and followers see should be Javier's call — not invented here.
- **Answer collection channel.** Text-to-roster is assumed as primary. Needs to be confirmed against what's actually wired in GoHighLevel.
- **Question 1 launch date.** The bank is ordered deliberately; Arc 1 Week 1 is the intimidation question Javier named.
