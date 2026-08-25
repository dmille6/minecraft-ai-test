# What we did on 25 August 2026, in plain terms

## The headline

We doubled the size of the experiment, made the bots think about ten times
faster, and discovered that the main reason they never made progress wasn't the
bots at all — it was the to-do list we'd given them.

---

## 1. The bots were never asked to improve

For 20 days, not one of 80 bots ever made anything better than a stone pickaxe.
Everyone assumed the AI was too weak.

Every bot was assigned a job description that said, in full: *"collect dirt,
wood, sand, and stone."* There was no line saying "then make better tools." A
different job description exists in the code that **does** say that — and it was
assigned to nobody.

**Fixed:** every bot now gets a short ladder of goals — workbench, wooden
pickaxe, stone pickaxe, furnace. Built so a bot with no materials skips a rung
rather than wasting attempts failing at it.

**Hoped for:** bots climb the tech tree instead of endlessly collecting dirt.

## 2. Bots could get permanently stuck while looking healthy

One bot spent 83 minutes frozen. Everything monitoring it said "fine" — process
running, logs flowing. It had started a job, that job hung, and nothing could
interrupt it. The bot was effectively dead for the rest of its life.

**Fixed:** if a job ignores its stop signal, the system takes the bot back by
force after 30 seconds.

**Hoped for:** we stop quietly losing bots to a bug that hides from every health
check.

## 3. We doubled the experiment

Two groups running the *same* setup were producing results 2× apart — too noisy
to prove anything. More independent groups means less noise.

**Fixed:** 8 worlds → 16, 40 bots → 80. This needed no new hardware: one memory
setting had been reserving three times what the servers actually used.

**Hoped for:** enough statistical power to answer the research question rather
than collect anecdotes.

## 4. We made them ten times faster

The bots shared one graphics card that couldn't keep up. Moving them to the 5080
dropped thinking time from 11 seconds to 1.

**Hoped for:** 80 bots now act faster than 40 used to, so more data per hour.

## 5. We built a safety net for changes

Previously every change went to all 80 bots at once. Twice this week that broke
things and had to be undone.

**Fixed:** changes can go to 5 bots first and be compared against the other 75.

**Hoped for:** a bad idea costs 20 minutes and 5 bots instead of hours and the
whole fleet.

## 6. We measured where the time actually goes

We had argued all week about whether drowning consumed half the fleet's effort.
It didn't — that was a counting illusion. Drowning writes a log line every half
second; useful work writes one per attempt.

**Measured:** drowning is about **25%** of real time, not 51%. The surprise:
**60% of the time bots are doing nothing at all**, waiting for their next
scheduled decision.

**Hoped for:** we aim at the actual biggest problem instead of the loudest one.

---

## Not yet deployed

Three fixes for water behaviour are written and tested but waiting on a
measurement baseline that today's other changes reset.

## The honest part

A recurring theme: **several of our measuring tools were quietly broken.** A
deploy checker reading a folder that doesn't exist. A fleet monitor missing a
fifth of the bots. A safety supervisor installed but never switched on. And one
of today's own experiments turned out to be comparing a change against *itself* —
reported as a success before the mistake was caught.

Most of today's real progress came from checking instruments rather than writing
features.
