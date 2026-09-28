# REGISTRATION — the two-week program read, 24–27 Sep 2026

Registered **2026-09-21 07:5x UTC**, three days before the window opens, because a
read specified after its data exists is not a read, it is a selection.

The reliability program (owner directive 2026-09-13) is judged at two weeks on five
committed numbers. This declares how that judgement is taken, and freezes it now.

---

## The window

**72 hours continuous: 2026-09-24 00:00Z → 2026-09-27 00:00Z.**

**No promotion, no canary, and no world change may land inside it.** The fleet must
sit on ONE `declared_code_version` for the whole 72 h. `programread.py` splits by
`code.version` precisely so a version change cannot blur the read — but a split read
is a damaged read, not a valid one, so the rule is that the split must come back
with a single version.

Consequences that follow, and are accepted:
- Any canary must be **decided and torn down before 24 Sep 00:00Z**, or be held
  until after the 27th. `needsdrop-01` (declared 21 Sep 07:24Z, deadline +660 min)
  closes far inside that.
- `keepInventory` stays **ON** through the window. It is turned off fleet-wide only
  after 27 Sep, as its own registered program change — never as a canary.
- `canarywatch.py` STALE will fire if anything is still open at the boundary. That
  is intended.

## What is read

`~/programread.py 72`, which prints denominators on every line. The five committed
numbers:

| # | number | the 27 Sep gate |
|---|---|---|
| 1 | **gather success** | **≥ 40%** |
| 2 | stock returned per bot-hour | reported, no gate |
| 3 | deaths per bot-hour, split lava / drown / fall | reported, no gate |
| 4 | immobile bot-hour share | reported, no gate |
| 5 | iron-pickaxe bot-hour share | reported, no gate |

Only **gather success carries a pass/fail**. The other four are reported with their
denominators and are the context in which it is judged. This is stated in advance so
that a miss on gather cannot later be rescued by pointing at a number that was never
a gate.

## Pre-registered expectation

Fleet gather success has been running **19–22%** (20.3% on 18 Sep, 23.8% on the
control arm at 21 Sep 07:24Z). **On the current fleet the 40% gate is expected to
FAIL**, and that expectation is recorded here so the failure is a result rather than
a disappointment.

The one measured thing that clears 40% is a re-seeded world: placebo-a read **42.7%**
and placebo-b **43.1%** at their +24/+48 h reads, against control 20.7%. Which leads
to the confound below.

## THE CONFOUND THAT MUST BE STATED IN THE RESULT

**Two of the sixteen pools are running on fresh terrain**, re-seeded 19 Sep, and they
gather at roughly twice the fleet rate. Their registered 72-h seed windows close
**22 Sep 00:00Z and 11:25Z**, i.e. before this window opens — so they are clear as
*canary* windows, but the WORLDS STAY FRESH. placebo-a and placebo-b will still be
young, un-excavated worlds throughout 24–27 Sep.

So the program read must be reported **three ways**:

1. **All 16 pools** — the headline, because it is the fleet as it exists.
2. **The 14 un-reseeded pools** — the honest read of the fleet the program has been
   working on for two weeks.
3. **placebo-a and placebo-b alone** — because if (1) passes only on the strength of
   (3), the program has measured terrain, not reliability.

If (1) and (2) disagree by more than 3 pp on gather success, **(2) is the number that
judges the program** and the difference is reported as a world-age effect.

## What is NOT a valid read here

- **A pooled read across a version change.** If a deploy lands inside the window, the
  window is void and restarts; it does not get stitched.
- **items/bot-hour as a headline.** The program explicitly retired it, and it is
  separately measured to be 73% dirt and cobblestone with a null sd of 0.313 even at
  k=20. It is reported and never gated.
- **A canary-style DiD.** This is a fleet-level before/after against the two-week
  target, not a difference-in-differences. It carries the world-drift weakness that
  CLAUDE.md names (pools moved −45% to +77% in six hours with no code change), which
  is exactly why the 72 h is continuous rather than sampled, and why (2) above exists.

## Instruments, and their known gaps

- `~/programread.py 72` — the five numbers, split by `code.version`, denominators
  printed. Deposit is printed BOTH ways (with and without `no_effect` in the
  denominator: 11.2% vs 22.7%), because a silent switch between them would
  manufacture a regression or hide one.
- `~/mcai-analysis/seedread.py` for the per-pool split, with `SEED_CONTROL_EXCLUDE`
  available if any pool is contaminated.
- **Known gap:** `programread.py` computes `bot_h` as `len(bots) * HOURS`, i.e. it
  assumes every bot observed was up for the whole window. Over 72 h with restarts
  that overstates the denominator and therefore understates the per-bot-hour rates.
  Before the window opens, this must either be changed to OBSERVED bot-hours (distinct
  bot × clock-hour cells, the way `seedread.py` already does it) or the read must
  state the assumption. **Logged as the one blocking fix.**

## Positive control

The read is refused rather than printed if the walk looks broken — `programread.py`
already exits non-zero on `rows==0`, `kinds<10` or `bots<2`. Additionally, the result
must quote rows, bots, kinds and bot-hours for the full 72 h, because every number
above is a rate whose denominator is the thing most likely to be wrong.
