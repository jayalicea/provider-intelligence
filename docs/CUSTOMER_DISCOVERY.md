# Customer Discovery: Credentialing / Exclusion Screening

Status: draft, 2026-09-27. Validates target #1 in `docs/TARGET_MARKETS.md`
before building roadmap Phase B/C. Goal: 5–10 conversations with people who
run provider exclusion screening.

The interview asks about past behavior ("the last time you…"), not opinions
about the idea. People are polite about ideas and accurate about what they did.

## Outreach

**LinkedIn connection note** (under 300 characters):

> Hi [Name], I'm building a tool that screens provider rosters against OIG
> and state Medicaid exclusion lists. I'm not selling anything yet. I'd
> value 20 minutes to learn how your team handles monthly screening today.
> Open to a quick call?

**Email / LinkedIn message:**

> **Subject:** 20 minutes on how you handle exclusion screening?
>
> Hi [Name],
>
> I'm building a tool for credentialing and compliance teams. You upload a
> provider roster and it screens every NPI against the OIG LEIE, state
> Medicaid exclusion lists, and NPPES in one pass, with results you can keep
> for audit.
>
> Before I build further, I'm talking to people who do this work every
> month. I'm not selling anything. I'd like to learn how you handle
> screening today and where it's painful.
>
> Would you have 20 minutes in the next two weeks? Happy to share what I
> learn from others in return.
>
> Thanks,
> [Your name]

**Follow-up after 5–7 days** (once only):

> Hi [Name], just bumping this in case it got buried. Even 15 minutes would
> help. If you're not the right person, who on your team owns monthly
> exclusion checks?

**Where to find them:**
- LinkedIn: "credentialing specialist", "credentialing manager",
  "compliance officer" combined with "medical group", "ASC", "home health"
  or "hospice".
- NAMSS (National Association Medical Staff Services) members and local
  chapters.
- Expect roughly 10–20% response on cold outreach: message 40–60 people to
  get 5–10 calls.

## Interview guide (20 minutes)

**Opening (1 min)**

> "Thanks for making time. I'm here to learn, not pitch. There are no wrong
> answers. I'll show you something at the end only if there's time."

**Current process (8 min).** Ask about the last time, not what usually happens.

1. Walk me through the last time you ran exclusion screening. What did you
   do, step by step?
2. How many providers were on that roster?
3. Which lists do you check: OIG, SAM, state Medicaid, licensing boards?
   How do you get each one?
4. How long did it take, start to finish?
5. How often do you do it? Monthly, at credentialing, at recredentialing?
6. Where do the results go afterwards? Who has asked to see them, and when?

**Pain and stakes (5 min)**

7. What was the most annoying part of that last run?
8. Tell me about a time something slipped through or almost did: a false
   match, a missed exclusion, a lapsed license.
9. Has an auditor or payer ever asked for proof of screening? What did you
   have to produce?

**Current spending (3 min).** The strongest signal of willingness to pay.

10. Do you pay for a tool or service for this today? Which one, and roughly
    what does it cost?
11. If you don't, why not? Too expensive, not worth it, or never looked?
12. What would a tool have to do for you to switch, or to start paying?

**Demo, only if time allows (3 min).** Show the Upload Roster → screening
report flow.

13. What's the first thing you'd want to know from this screen?
14. What's missing that would stop you from using it for real?

**Close (1 min)**

15. Who else should I talk to?
16. Can I follow up when there's something you could try?

## After each call

| Field | Notes |
|---|---|
| Role / org type / roster size | |
| Current method (manual / tool / vendor) | |
| Tool and price, if any | |
| Time per screening cycle | |
| Strongest pain (their words) | |
| Would try it? Would pay? (only if said unprompted) | |

## Reading the results (after 5–10 calls)

- **Build signal:** several people already pay a vendor or spend hours a
  month on this, and describe a specific pain in their own words. Next:
  roadmap Phase B (saved rosters, scheduled re-screening, alerts) and the
  Phase C auth it requires.
- **Kill signal:** most say "it's fine" or "the vendor handles it", or
  can't describe the last time. Next: test target #2 (MIPS consultants).

## Cautions

- Don't overclaim license monitoring. Verified license status currently
  covers only Texas and Colorado (`src/config/migrations/20260918_license_status.sql`).
- The app's own disclaimer says it is "not a credentialing decision". Frame
  the demo as a screening aid.
