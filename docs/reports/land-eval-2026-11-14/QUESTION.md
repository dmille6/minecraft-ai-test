# Evaluation brief: is the land-cleanup code built the right way? (2026-11-14)

The same brief goes to two independent evaluators (Claude and Codex). Neither sees the other's answer.

## The owner's question

"I want you to evaluate our current code for filling in holes, removing trash pillars and dirt that doesn't belong before
we do any actual work ... figure out if we are doing this the right way or we should start fresh with a new approach. This
would be the time to get this code and this logic correct."

So: for (1) filling holes, (2) removing trash pillars, floating blocks and leftover scaffold, (3) removing dirt and
cobblestone that does not belong, is the present design sound and worth fixing, or is its model wrong and a new core
needed? No work on this code starts until that is answered. Levelling plots for buildings and making land pretty are
related and you may comment on them, but the three items above are the question.

## What you may read

- **The code:** the live showcase release, checked out at `.wt-roofclimb/` in this repository (commit 46286e9e3). Read
  there, not in the main checkout, which lacks this code. Start with `.wt-roofclimb/bots/src/`: `tidy.mjs`,
  `roughground.mjs`, `cleanzone.mjs`, `groundskeeper.mjs`, `grounds2.mjs`, `tidyrefresh.mjs`, `buildsite.mjs`,
  `siteprep.mjs`, `terrace.mjs`, `landplan.mjs`, and whatever calls them (`skills.mjs` is very large: search it). Tests are
  in `.wt-roofclimb/bots/test/`.
- **The evidence pack:** `docs/reports/land-eval-2026-11-14/evidence.md` in the main checkout. It holds the measured state
  of the town (the time-capsule scorecard), 30 hours of the bots' own log rows for land work, and the project's notes
  written at the time about each cleanup feature. The notes can be stale or wrong; the measurements are what they are.
- Anything else in the repository.

Read only. Do not edit, commit, run the test suite, run npm, or reach any host.

## Facts about the project that bound a design

- The bots are mineflayer clients. Everything they change, they change by playing: walk, dig, place, carry. **No admin
  world edits** (no /fill, /setblock, WorldEdit or world-file edits) is a standing owner rule.
- A small local model (4B to 7B) picks each bot's next high-level action from a menu; deterministic "work orders" and
  project records drive town work. Bots have limited inventory, must survive, and can get stuck.
- Reading the world from outside is allowed and already done: the server's save files can be read on the host
  (`scripts/host/regiondump.py`), the server keeps a block-history database (CoreProtect: who placed and broke which
  block, when), and the town keeps its own records of what each project built. An offline planner that reads these and
  hands bots a plan is observation, not an edit.
- Two repeatable test courses will exist: A, a restored copy of today's messy town (the time capsule; baseline in the
  evidence pack); B, copies of untouched raw terrain with marked plots. A change can be run on a fresh copy and measured.

## What to deliver

1. **How the present approach works**, in under a page: how it decides a cell is a hole or junk (detection), how it turns
   that into work (planning), how a bot carries it out (execution), how it knows it is finished or gives up (stopping),
   and what stops new mess being made (prevention). Cite file:line.
2. **Assessment against the evidence:** what works; what fails; and for each failure, whether it is a bug or a limit that
   can be fixed in place, or a consequence of the model itself. Say which evidence shows it.
3. **The design you would choose starting fresh**, concretely: the data it reads, how it defines the ground that should
   exist, how it tells natural blocks from bot-made ones, how work is cut into jobs a bot can finish, how a job is
   accepted, and how new mess is prevented. Say what it would reuse from the present code.
4. **A verdict, one of:** KEEP AND FIX / RESTRUCTURE AROUND A NEW CORE / START FRESH. Give the three strongest reasons, and
   the strongest argument against your own verdict.
5. **The first three things to build**, in order, each with how it would be proven on course A or B.
6. **What you could not establish.**

Plain words and full sentences. Every claim about what the code does carries a file:line. About 1,500 to 2,000 words.
