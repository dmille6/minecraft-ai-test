# The queued bag fixes as `"class": "bag-fix"` (owner D1, 2026-10-08)

**Status: registrations updated on `main`; `bagread.py` and the installer staged on the host, NOT installed.** The
install is between canaries and sequenced by the coordinator.

## Decisions this follows

**D1 (owner, delegated to operator + Codex).** The queued bag fixes are `"class": "bag-fix"` and are drawn at four
pools from the start. The criterion is that a change frees usable bag capacity. The existing eligibility constraints
stay, and the slower draw is accepted.

**Bamboo (operator + Codex, 10-08).** bamboo-01 and bamboocraft-01 run as **ORDINARY canaries**:
- no bag-fix class, so a death-gate trip reverts as before, with no extension;
- no thresholds relaxed;
- bamboo-01 first, and bamboocraft-01 only after bamboo-01 is KEPT.

Why: only 2–3 pools ever expose bamboo, and v33's KEEP needs ≥ 400 canary bot-h. That is about 240 bot-h at 2 pools
or 360 at 3 pools in 24 h, so the extension could never KEEP. Their registrations are unchanged from `main`.

**The five bag-fix runs** have 18 registration variants on `main` at c24d4a0: toolhygiene-01 ×2, peacefulkit-01 ×2,
junkwell-02 ×4 (including the variants on peacefulkit's heads, 39fbcde / 40046b8), gridfix-01 ×4, and stonecap-01 ×6
(including the well-coupled 1db3fcd, 7d5095d, cf4192e, e2ea50a). Each variant now has:
- `"class": "bag-fix"`;
- a `bag_fix` block: `own_kinds`, `primary`, `extended_deadline_min` 1560, and a note;
- `bagread` added to `reads`.

Every variant passes `bagfixrule.registration_problems`, the installed v33 rule.

## 1. The primary: each fix's own bag metric, banded under its own draw filter

v33 KEEPs an extended bag fix only if "the fix's own bag metric" moved beyond its no-change band at the +1440 read.

**`scripts/host/bagread.py`** measures bag occupancy directly. It is light: about 300 s and 50 MB at W = 1440 (§3).
It reports time-weighted slots per bot as a DiD, in total and per item group: pickaxes, swords, cobble (cobblestone +
cobbled_deepslate) and bamboo.

Round 1 changed four things:
- **Minimum-stack proxy (Codex).** The logs carry counts by item name, not slots, so a bag's slots are
  Σ ceil(count / stack size), the fewest it could occupy. Every bag read here uses this proxy. It is not the sole
  condition of a KEEP: v33's final also needs exposure, coverage and the value-weighted output DiD.
- **Skill rows retimed to completion (Codex).** logger.mjs stamps a skill row at its start; runner.mjs snapshots the bag
  at its end. Events are instantaneous.
- **Corruption counted before the timestamp filter (Codex).** A complete line that does not parse counts when its
  timestamp is in the window or unreadable. The read emits no primary above 0.1% of rows, or on any unreadable file.
- **Death censoring (round 2, Claude).** The primary is consulted only on the extension path, i.e. on canaries that
  died more. "Emptier because it died" must never read as "freed by the fix", so each bot's accrual is dropped for
  60 min after each of its deaths, in both arms.
  - **Measured, 10-05..10-07, 166 deaths:** on these worlds bags largely survive death. 80% of the pre-death bag was
    back within 0.01 h at the 90th percentile, and 100% within 1.02 h at the 90th percentile.
  - 60 min therefore covers the refill where one happens, at about 5% of the exposure.
- **Bagless rows do not renew a stale bag (round 2, Codex).** A bag observed at t accrues at most 120 s past t,
  whatever event rows follow it.
- **One validity rule (round 2, Codex).** `bagread.blind()` decides both whether the live read emits a primary and
  whether a calibration window counts.
- **Tests:** `scripts/test_bagread.py` 25/25. They cover:
  - retiming;
  - NUL lines without a timestamp;
  - the item groups;
  - canary deaths that empty bags, which must read as no change;
  - the stale-bag cap;
  - 10 mutants, after an unmutated runner control.

**The bands (round 1, Claude: a band from random pools is lenient, because full-bag pools regress in POST):**
- `scripts/host/bagnull.py` draws each fix the way the loop would. At every cut (each 6 h), it evaluates the fix's
  registered `draw_exposure` with drawexposure.py's own scan/count, and draws up to 10 random 4-pool sets from the
  pools that pass.
- Each bot's rows are accrued once per cut with bagread's own functions, so the band and the read share one estimator.
- Not replicated: drawrec's productivity band and its 12-h per-pool exclusion.
- `scripts/host/bagbands.py` reports, per fix, the 2.5th percentile (floor(0.025 n), the repository convention) with
  n, cuts and distinct days. The days are the effective sample.

**The registered primaries.** All bands are measured at +1440 (24 h POST vs 24 h PRE), death-censored, under the
live read's validity rule (0 of 803 draw windows invalid; deaths up to 60 min before the window censor into it; ~/bfnull/bagnull5.jsonl), on any build, over cuts from 10-03 00Z to 10-07 06Z.

| fix | primary (`op <=`) | edge = 2.5th pct | n draws / cuts / days | median | same fix, total slots edge |
|---|---|---:|---|---:|---:|
| toolhygiene-01 | `pick_slots_did` | **−0.842** | 180 / 18 / 5 | −0.013 | −1.478 |
| peacefulkit-01 | `sword_slots_did` | **−0.059** | 95 / 10 / 3 | +0.005 | −1.366 |
| junkwell-02 | `slots_did` | **−1.653** | 53 / 9 / 3 | −0.099 | — |
| gridfix-01 | `slots_did` | **−1.366** | 120 / 13 / 4 | +0.218 | — |
| stonecap-01 | `slots_did` | **−1.366** | 175 / 18 / 5 | −0.097 | |
| *(random 4-pool draws)* | `slots_did` | −1.275 | 180 / 18 / 5 | −0.003 | |

**Reading the bands:**
- **The draw filter moved the edges little** (for total slots: −1.28 random against −1.37 to −1.65 filtered). The
  regression Claude predicted is not large at 24 h. The edges are now the right population all the same.
- **The item metrics make the KEEP reachable for the targeted fixes:**
  - toolhygiene's pickaxe band is −0.84, against its own estimate of about 1 slot;
  - swords barely move without a fix, so peacefulkit's band is about ±0.06, against its expected −1.5 on depositing
    bots.
- **stonecap uses TOTAL slots, deliberately.** Its town cap leaves surplus cobble in the bag, so cobble slots may rise.
  Whether stonecap frees capacity at all is exactly what its primary asks.
- **Effective n is 3–5 days**, because the cuts overlap. peacefulkit and junkwell only became drawable from 10-05, when
  their exposure rows appeared on the fleet. The edges are rough, and are stated as such in each registration.
- **Death censoring changed the edges by at most 0.06 slots** (uncensored run: −0.879 / −0.064 / −1.621 / −1.303 /
  −1.445). That fits the measured fact that bags mostly survive death on these worlds. The censoring is there for the
  extension path, where the canary dies more.

**Residual (Claude, round 3).** About 10% of deaths take more than 1 h to refill fully, so a small death-driven
negative remains on canaries with excess deaths. It is not material at these edges.

**Peacefulkit and the extension (Claude, round 2).** With `_sword_fuel` as its only action row, peacefulkit's positive
control (own rows on ≥ 2 canary bots) will often be unmet when the gate trips. The extension is then not granted and
the REVERT stands. That is fail-closed, but D1's leniency may rarely reach peacefulkit.

## 2. Linkage: own_kinds are action rows only

bagfixgate's positive control asks for the fix's own rows on ≥ 2 canary bots. It is what makes "zero linked deaths"
meaningful. Round 1 found two problems.

**Claude: two status rows made the control vacuous.** Status rows were satisfying it on every bot at spawn:
- toolhygiene-01: `_redundant_craft`, `_craft_admit`, `_worn_first`. The `_tool_hygiene` licence row is dropped.
- peacefulkit-01: `_sword_fuel` only. `_peaceful_kit` is the mode row, and `_compost` is also written by the fleet's
  own composter. Sword burns are rare, so the control may not be met; then v33 does not extend, and the REVERT stands.
  That fails closed.

**Codex: the stonecap well-coupled variants missed a linkage row.** These are 1db3fcd, 7d5095d, cf4192e and e2ea50a,
re-registered on main at c24d4a0; they replace 2bd1452 / b446f4d. They also throw surplus cobble down the well at the
town cap, so `_well_dispose` is added to their `own_kinds`.

**Unchanged:** junkwell-02, gridfix-01 and the plain stonecap variants keep their vetted `change_rows`.

## 3. The +1440 reads fit the loop: measured on the host, one at a time, W = 1440

At +1440 the loop runs every registered read serially, each under `timeout 900`. Each read was run once as a dry run
(nothing emitted), one at a time, capped at 25 GB:

| read | wall time | peak RSS |
|---|---:|---:|
| immobiledid | 288 s | 17.5 GB |
| toolhygieneread | 428 s | 0.7 GB |
| peacefulkitread | **567 s** | 15.8 GB |
| wellread | 233 s | 15.8 GB |
| gridfixread | 220 s | 15.8 GB |
| stonecapread | 231 s | 15.8 GB |
| bagread | 295 s | 0.05 GB |

**Timeout:** every read finishes inside the 900-s timeout. peacefulkitread is closest, at 63%.

**Memory:** the heavy reads take about 16–18 GB each (lib.telemetry `Events.load` over 48 h of 80 bots). One at a time
that fits on the 46-GB host beside the bots, which use about 15 GB. Two at once would not.

**For the multi-lane canary system, two concurrent lanes must not run their +1440 reads (or any two heavy reads) at
the same time.** At 01:23Z four such reads in parallel were OOM-killed by the kernel. The bots survived, but that is
the failure mode.

## 4. Four pools

v33 already enforces four pools:
- canary-loop.sh `BAGFIX_POOLS=4` refuses a shorter draw and waits, paging after 3 h;
- drawrec.sh `TARGET_K = 4`.

**Probe 10-08 ~01:30Z.** This was the live drawrec logic in a scratch copy, read-only. Recent canaries excluded board-b,
board-c, placebo-a and placebo-b at the time.

| change | pools able to expose it | eligible then | four-pool draw then? |
|---|---|---|---|
| toolhygiene-01 | 7–8 | board-d, hive-a, placebo-d | no (3) |
| peacefulkit-01 | 10 | board-d, hive-a, hive-c, placebo-d | **yes** |
| junkwell-02 | 4–5 | hive-c | no (1) |
| gridfix-01 | 6–9 | board-d, hive-a | no (2) |
| stonecap-01 | 6 | board-a, board-d, hive-a, hive-c | **yes** |

Exclusions lapse 12 h after each canary. junkwell-02 is the tight one: with 4–5 exposing pools, a four-pool draw needs
nearly all of them out of exclusion at once.

## 5. Install (between canaries only; the coordinator sequences it)

```
python3 scripts/host/stage-bagfix-regs.py /tmp/bagfix-regs && scp -r /tmp/bagfix-regs mike@10.0.0.31:/home/mike/   # refuses a dirty tree
ssh mike@10.0.0.31 'python3 ~/bagfix-regs/install-bagfix-regs.py --dry-run'
ssh mike@10.0.0.31 'python3 ~/bagfix-regs/install-bagfix-regs.py'
```

**Before installing, it:**
- takes the scheduler's `install-hold` first (`canary-sched.py install-hold`). That stops new launches and requires its
  own slot checks to pass (manifest, processes, the loop lock, canary drop-ins, unit freshness, open runs). The hold is
  released at exit (round 2, Codex);
- refuses canary drop-ins itself, too;
- holds the loop's own `/tmp/mcai-canary.lock` throughout (a dry run only probes it);
- refuses while a loop or a chain/launch script runs, while a canary is declared, or while the manifest does not
  explicitly state `canary_pool`;
- re-checks all of that under the lock before replacing anything;
- validates every registration with the installed `bagfixrule`;
- refuses a live copy that matches no version ever committed to main (`BASE-MD5.txt`, generated by
  `stage-bagfix-regs.py` from `git log`).

**Then it:**
- writes a manifest and re-verifies every hash;
- backs up, verifies the backups, and replaces each file by rename, rolling back on failure.

It does not touch the gate bundle (no digest change) or any `registrations/<run>.json`.
