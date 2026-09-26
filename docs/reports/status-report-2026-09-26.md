# Status — Saturday 26 September 2026 (daily operator session)

_Session opened 11:08 UTC, closed ~12:30 UTC. Fleet `efa2853+c7b045`, 80 bots, one version
(881,375 rows / 80 bots over the 24 h to 12:11Z). Ledger 65. No canary live at open or at close.
A separate session had run 06:00–09:50 UTC before this one._

## What the day produced, stated plainly

**Apparatus shipped and verified live on the fleet.** No bot-behaviour change and no canary — the
queue's largest lever is one day older, and that is the honest cost. What shipped is the mechanism
that ends a failure this project has repeated on three consecutive days, plus the closure of a
latent false-revert route and one genuine reordering of the queue.

The overnight loop closed two canaries unattended, both correctly. **Both are KEEP and unpromoted,
which makes three kept-and-unpromoted changes in total, and that is now the largest thing blocking
the endpoint.** It is owner call 0 in `STATE.md`.

## 1. Open loop: there was none, and that was verified four ways

`falls-02` (`37a68c3`, 4 pools / 20 bots) closed **KEEP** at 03:31Z; `vetob2-01` (`efabf13`, a
degraded 2-pool draw / 10 bots) closed **KEEP** at 09:08Z. Both recorded through
`check-open-loop.py --record` **before** the manifest was cleared, both torn down, both
`promotion: none`. `check-open-loop.py` says "no open canary"; `canary_pool` and
`canary_code_version` are null; the anchored `pgrep` finds nothing; the census says one version.

`vetob2-01`'s KEEP is a **gate** keep, not an effect: `primary` sits in `_ADVISORY`, so KEEP means
"nothing objected". Its effect read INCONCLUSIVE by hand.

## 2. The finding: a third consecutive unregistered gate generation — now mechanically impossible

`~/verdict.py` was md5 `e9a81408` against the `6dda048d` `STATE.md` recorded as registered.
`b01b1e7` added the v31 licence-class gate at **2026-09-25 15:21Z, four hours after v29 and v30 were
registered for precisely this reason.** The sequence is v25–v28c, then v29 (`faf7cf7`, 23 h after its
own lesson was written), then v31.

**It decided nothing in the 20 hours it was unregistered**, and that is measured with a positive
control: `falls-02` and `vetob2-01` both ran under it, both declared a `licence`, and `licence`
appears in both reads' NOT-evaluated list beside `mechanism_check` and `null_calibration`.

Registered prospectively as **v31**. The mechanism is **v32**: `RULES-IN-FORCE.md` carries exactly
one column-0 `GATE DIGEST verdict-bundle md5 …` line, `gatedigest.py` **refuses a launch** when the
live bundle disagrees, and `verdict.py` annotates on every read, report-only. Verified live on .31 —
exit 0 against the real gate, **exit 2 with a named remedy on a wrong record and on no record**, and
a real read prints `UNREADABLE` with no advisory because the digest matches.

The standing wake-up had already said the right thing. It was followed on none of the three days,
because it asked a person to remember a comparison. `ZeroLooksWrong` is the model: it raises.

## 3. `licencecheck.py`'s launch refusal did not exist

Its docstring says it refuses before the draw and before three hours of fleet time.
**`canary-loop.sh` never invoked it.** Positive control in the same grep: the loop called
`changerowcheck.py` and `v30check.py`. **2 of 20 registrations declare a `licence` at all** — what
an unwired refusal looks like from outside. Wired today, with the wiring asserted in *executable*
text (comments stripped) and proved by mutants.

## 4. A latent false-revert route, found and closed

The **death-poll** arm of the loop matched `case "$V" in *REVERT*)` on the **whole verdict line**,
while the scheduled-read arm has always taken `awk '{print $2}'`. **8 of 42 `why.append` sites carry
the literal "REVERT"**; six are on the same statement as `out('REVERT')`, and two print it while the
verdict is INCONCLUSIVE — but both sit past the poll's `out('POLL_OK')` exit, **so the route was
latent, not live.** The v32 advisory *is* reachable under `--poll`, which is why it was closed rather
than written down. The poll arm now reads the field, and `out()` flattens every reason to one line,
since the loop takes `tail -1` then `awk` with no check that the line is a verdict at all.

## 5. Queue item 2 is not a banking bucket, and it makes item 1 three times bigger

`skill_error` is **819 of 4,160 deposit rows (19.7%) in 24 h on 65 of 80 bots**, and it is entirely
pathfinder prose: `No path to the goal!` 420, `Took to long to decide path to goal!` 205, `The goal
was changed before it could be completed!` 192, PathStopped 2. None of it is deposit logic; the third
group is the interrupt tax.

The part that matters is that all four failure buckets are full of bots **already carrying a chest**:
`no_path` 269 of 419 (64.2%), `path_timeout` 179 of 205 (87.3%), `goal_changed` 176 of 193 (91.2%),
`storage_full` 283 of 328 (86.3%) — median 3–5 chests held. **907 deposit failures in 24 h where the
bot held a chest it could have placed, against the 283 `storage_full` alone accounts for: a 3.2x
larger addressable population than queue item 1 scopes.** The remedy is identical in all four and is
executable from where the bot stands, which is the test CLAUDE.md sets.

**No new items/bot-h ceiling is claimed from this read.** The same query produced "median bankable
carried ~300", but on a looser definition of bankable than queue item 1's 55, so it is an upper bound
and not comparable. The **count** is the robust finding, and its denominator is 4,160 deposit rows /
80 bots / 24 h on `efa2853+c7b045`.

## Process notes worth keeping

**Two Codex passes changed the design, not the prose.** Pass 1 killed the first draft in one line:
hashing `verdict.py` alone misses `deathgate.py`, which *the acceptance mutant runner edits to flip a
verdict from KEEP to REVERT*. The digest is now a bundle resolved through `sys.modules`, because
`arms.py` is on none of the paths `verdict.py`'s docstring lists and a hand-written path list would
have recorded it MISSING and passed anyway. Pass 2 found five more, all acted on: a blocking `open()`
on a non-regular file, a truncating read that would have defeated the two-record refusal, an
`UNRESOLVED` part being registerable, `'--gate-digest' in sys.argv` swallowing positional arguments,
and a BOM defeating the column-0 anchor. No third pass.

**Three mutants were nearly scored wrong, and each taught something.** The null-case mutant asserts
the *diagnosis*, not the exit code — removing the branch still refuses, via `IndexError`, so the
branch buys the remedy rather than the refusal. The one-line mutant asserts *one line*, not a flipped
verdict, because this suite's harness rejects a non-`VERDICT` last line as CRASH while the loop does
not, so the obvious phrasing measured the harness and survived. And a third draft of that case was
**vacuous** — it checked the already-split last line for a newline it could never contain.

**Two self-inflicted losses, both recorded because both will recur.** `open(p,'w').write(x)` with a
non-string `x` truncates the file before it raises; `test_verdict_acceptance_mutants.py` was zeroed that
way and restored from HEAD.

And the worse one: **I destroyed `~/digest/RULE.md` and restored it.** `cat >> scripts/host/RULE.md`
created a *new* 1,847-byte repo file — RULE.md had never been tracked, so there was nothing to append
to — and the scp then replaced the host's real 103 KB file with that fragment. `## v14c` went with it, so
`analyst.py`'s slice fell back to the whole tiny file and handed the model v31/v32 as the entire rule tail.

The tell was **`prompt_tokens` 8034 → 3631** after I had made both rule files *longer*. The wrong direction
is the whole signal: the obvious check — "does the analyst still run?" — passed (`fleet_healthy` and
`versions_ok` both True) and would have missed it completely.

**Blast radius, with the denominator: one analyst run (12:30Z), with no canary live, which still answered
correctly. No decision rested on it.** `RULES-IN-FORCE.md` — the half `analyst.py` calls authoritative, and
the only half that names WITHDRAWN rules — was correct throughout. Restored at 12:27Z from the previous
session's timestamped backup plus v29–v32 re-appended; **v29 and v30 are reconstructed and say so in their
own text**, because the 25 Sep append's wording is unrecoverable. Host and repo now agree at `746c65e4`.

Two things follow. **The previous session took a `.bak` before editing that file and I did not — that
backup is the only reason this was recoverable.** And RULE.md cannot be regenerated from the registration
document: 0.58 line similarity, with 139 lines existing nowhere else. A 103 KB hand-maintained duplicate
with no tracked source is the real defect, and it is now queue item 16.

## Suites

`test_verdict_acceptance.py` **83/83** (7 new), `test_verdict_acceptance_mutants.py` **33/33** (4
new), new `test_launch_guards.py` (v31/v32 wiring, the comparison, 3/3 mutants), v30 schedule
invariant green. `~/verdict.py` and `scripts/verdict.py` byte-identical at `b3179121`, and all four
bundle files identical on host and repo at `863a7259` — which v32 now enforces rather than asking
anyone to maintain.

## What did not happen

- **No canary.** Queue item 1 needs a build, a sandbox mechanism proof and dual Claude + ChatGPT
  review before it may be proposed; it is now better specified than it was this morning but it is not
  built.
- **The owner is un-notified for a fifth day.** PushNotification fails with "Remote Control
  inactive". `STATE.md` remains the only channel, and it now carries five owner calls.
- The five orphan `*-Charlie` units were not deleted (queue 4); the stale second copy of
  `canary-loop.sh` in `scripts/` was found and recorded (queue 6) but not removed.
