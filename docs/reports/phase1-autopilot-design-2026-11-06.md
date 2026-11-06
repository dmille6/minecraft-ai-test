# Phase 1: the autopilot and the pager (2026-11-06)

Owner, 11-06: "do the phases sequentially with Claude + Codex designing, implementing, deploying and testing each element".
This is phase 1 items 1-3 of [codeeval-2026-11-06/README.md](codeeval-2026-11-06/README.md) (the fleet-side host tooling;
item 4, the showcase, is another agent's). Evidence: [pipeline.md](codeeval-2026-11-06/pipeline.md),
[tests-process.md](codeeval-2026-11-06/tests-process.md). Each item had a Claude design and an independent Codex design
(`codex exec -s read-only`, given the goal and the measurements, not the Claude design); the reconciliation is below each.

Owner gate: items that change **canary-sched.py's decisions or the owner-direct lane** (1, 3a, 3b) deploy only on the owner's
go after phase 0's canaries read. Deployable now: the alarm delivery check, tiers/acks, the page relay, slotwatch by cause,
stuckwatch, the hourly alarms, suite-run.py, merge=union.

## The numbers this rests on (14 days, 10-23..11-06, from the codeeval reads)

- The canary slot was idle **100.9 of 338.5 h** (30%); the head, not the queue, was the blocker for about 46 h; install-holds
  21.5 h; 7 of the 8 gaps of 3 h or more ended only at a human verb, 6 of 8 began overnight.
- `page.jsonl`: **71 error pages, 0 pushed** (11-05 "ROLLBACK INCOMPLETE" waited 10.4 h). ntfy: 852 pushes, 81% goalwatch or
  flowledger; no acks.
- slotwatch: a **live** install-hold read as busy, so 11-05 00:00-09:55Z (no canary deployed) never alarmed; one key
  `slot:idle` for every cause, so the 14:00Z cause change did not re-push.
- stuckwatch: 434 of 676 half-hour samples show 1-5 bots pinned >= 4 h (~700 bot-h); never pushed. **Rotation false pins,
  measured here:** mean pinned bots by hour of day over the last 700 samples = 4.57 at 00:xx (max 15) against 1.79-2.41 at
  every other hour; the walk read the live files only (`skill-*.jsonl`, no rotated `.gz`).
- `alarm.notify()` ran curl without checking its exit or the HTTP code, and `raise_alarms` saved the dedup state either way:
  a dead push was silent for 6 h.
- Value per bot-h fell 16.14 -> 9.90 on 11-05; driftwatch (daily) alarmed at 11-06 01:20Z. The idle lap took 83% of bot time
  (198.9 of 240 bot-h, 3 h on 11-06); 7 of 16 towns had no workable project.
- suite-run: **positive control by hand** -- main's `ship()` is still blocked after 30 s on 3,000 incompressible files (a
  ~190 KB NUL list); with compressible files it happens to pass, which is why it hung only sometimes. 27 of 179 ci2 logs
  incomplete; 121 of 152 ci2 runs red on exactly ceilescape, nothing-important-is-orphaned, protected-paths (no `.git`).
- The orphan manifest caused 10 of 12 promomerge conflicts.

## Item 2: one pager (deployable now)

**Claude design.**
- `lib/alarm.py` keeps its API and ALARMS.log's line format (stategen, stallcheck and the Grafana agent parse it), and adds:
  - **Tiers** (`tier_of`, pure): 1 PAGE (pushed now, re-pushed every **2 h** until acked or cleared), 2 DIGEST (logged, in the
    daily digest only), 3 LOG. goalwatch goals, flowledger, driftwatch, effectwatch and stallcheck are DIGEST; a **whole
    town blocked** (`town:<pool>`, new in goalwatch: every open project stuck) pages; an unknown source pages (fail loud).
  - **Acks** (`~/digest/alarm-acks.json`, `pager.py ack <source> <key-glob> <why> [--for 6h]`, at most 7 days): an acked
    tier-1 key is not re-pushed; its CLEARED always is.
  - **Delivery**: a push counts only when curl exits 0, the server answers 2xx and, for ntfy, the answer is the published
    message (JSON with an `id`). An undelivered push goes to `~/digest/alarm-outbox.jsonl`, retried by every later alarm run
    (5 min doubling to 60 min) for 24 h, then given up loudly (journald, `ALARMS-delivery.log`, the fleetstatus header).
  - **One message per run** (a batch of five pins is one push).
- `pager.py relay` (cron */5): `page.jsonl` -> the pager from a saved (inode, offset); a rotated or truncated file restarts
  at 0 and skips rows already relayed; the first run starts at the end. error / REVERT / ROLLBACK / STOPPED / INTERRUPTED /
  NOT PROMOTED / "has waited" pages; KEEP verdicts and other flags digest; info logs. Same (run, level, message shape)
  inside 2 h is not pushed twice.
- `pager.py digest` (cron 12:30Z = 06:30 CST, the owner's report time): one push: open pages with their acks, digest-tier
  alarms of 24 h by source (opened / cleared / open), relayed digest pages, delivery state.
- slotwatch (`alarmhead.slot_nodeploy`): **"no canary deployed for 60 min"** whatever the reason (a live hold, a building
  or refused autorebase, a drawing loop, a blocked head), key `slot:nodeploy:<decision>:<code>-<qualifier>`
  (e.g. `block:H2-refused`, `busy:S8-hold`), so a new cause pushes; a cause must hold 2 ticks to re-key (no flapping).
  The header line is unchanged.
- stuckwatch: loads rotated logs; judges a bot only when its rows cover the window (first row within 30 min of the start,
  newest within 15 min of now); pushes `pin:<bot>` (tier 1, one message per run).
- `hourwatch.py` (cron :25): value per active bot-h of the last 2 closed hours vs the 24 before (valuescore.measure per hour,
  cached; alarm at -25%); the idle-lap share of bot time over 1 h (llm `messages[0].milestone` in patrol/return/
  deposit_surplus, each decision owning the time to the next, capped 10 min; alarm > 40%); towns with no workable project
  (no open goal, or all stuck, from goalwatch-fleet.json; alarm > 2 of 16). Each has a denominator and NOT JUDGED rules; a
  blind check is `blind:<metric>` (digest), never a 0.

**Codex design (independent).** Same shape, heavier machinery: a per-host SQLite store for incidents, outbox, receipts, acks
and cursors; acks bound to an incident episode (a reopened or re-graded incident needs a new ack); delivery requires an ntfy
message id; digest at the first run after 13:00Z once per day after acceptance; the relay keyed by an event id or a row hash,
never by text, and ingesting retained history into the digest on install; pins need a bracketed 240-min history with no gap
over 10 min and a fresh newest sample; lap needs >= 95% milestone attribution; hourly ES extraction on ci2, not .31; a 1-h
value window.

**Reconciliation.**
- Adopted from Codex: the ntfy message-id check (a proxy's 200 is not a delivery); a freshness bound on pins (newest row
  within 15 min); milestone attribution >= 90% before a lap share is believed; an ack cap of 7 days; the owner-policy note
  below.
- Kept Claude's: JSON state + a locked jsonl outbox instead of SQLite (the existing watchers all use JSON state; one more
  store is one more thing to install and back up); ack by source + key glob until a time (the owner's typical ack is "this
  lap alarm until idlework-01 ships", which must cover a reopened key); dedup of page rows by shape within 2 h (the scheduler
  already dedups its own keys for 3 h; a hash of the row would push every 3-h repeat); the relay starts at the end (the 71
  old errors are history, not news); hourly on .31 at nice 19 (the work is an ES query plus a 1-h file walk; measured cost
  in the deploy notes); a 2-h value window (one hour of 80 bots is noisy).
- **Owner-policy change, recorded:** fun mode promised "stuck goal -> owner in 3 h"; single stuck goals now go to the daily
  digest, and only a whole town blocked (or > 2 towns without work, hourly) pages, as the owner asked on 11-06.

## Item 3 (deployable-now parts): merge=union, suite-run, the copied-tree tests

**Claude design.** (c) `.gitattributes`: `bots/test/nothing-important-is-orphaned.test.mjs merge=union`. promomerge merges
with `git merge --no-ff` in a checkout of main, so the attribute applies once main carries it; proven on a real merge in
`scripts/host/test_union_merge.py` (positive control: without the attribute the same merge conflicts). (d) suite-run: the
NUL list to a temp file (`tar -T file`), ssh started before anything is written, deadlines on every stage (upload 10 min,
prep 20, `flock -w` lock wait 60 -> rc 75 LOCK TIMEOUT, `timeout -k 60` suite 60 -> rc 124 SUITE DEADLINE, local wait = the
sum + 10 min, ssh down 10 min -> rc 2), and the remote log always ends `DONE rc=N`; old trees pruned after 3 days (ci2 held
40 GB of them, 12 GB free). (e) a real git context on the test host: the commit is pushed to a bare mirror there
(`~/ci/.git-mirror.git`), cloned `--shared` at that sha, the worktree laid over it (deleted files deleted, index additions
`git add`ed), so the three files PASS; `--no-git` (or a mirror failure) ships the bare tree and the git-only checks print
`SKIP (...)` and exit 77, which `run-tests.mjs` reports SKIPPED -- never a pass, never a failure (`bots/scripts/test-result.mjs`;
a bare 77 without the line is a failure; a FAIL line or a timeout always wins). protected-paths no longer needs a checkout at
all (its ROOT comes from the file's path; `test_protected.py` needs the git binary only).

**Codex design.** The same three fixes, plus: union covers the whole file (restrict it later to REQUIRED additions; replace it
with `config/required.d/<feature>.txt`); cherry-picks onto an older fleet base cannot rely on main's attributes (use the
scratch repo's `info/attributes`); a remote supervisor that kills the process group on a deadline; release admission should
require zero skips.

**Reconciliation.** Agreed on all three. The autorebase's cherry-pick does not get `info/attributes`: the autorebase's
diff-identity check compares context lines too, so a union-resolved hunk would refuse there anyway (the same outcome as the
conflict); the real fix for that is the per-change manifest, which is the follow-up named in `.gitattributes`. GNU `timeout`
signals its process group, which is the supervisor Codex asks for. Skips: the default path ships git and runs everything;
a SKIPPED line is printed in suite-run's summary, so a run with skips cannot be read as green by accident.

## Item 1: scheduler self-recovery (implemented; deploy waits for the owner's go)

**Claude design.**
- (a) **skip a blocked head**: `select_entry` walks the queue in order; an entry whose blockers are ALL of the skippable kinds
  -- H1 `held`, H3 blocked attempt (never deployed, no live loop), R10, H2 autorebase refused or dead -- is skipped, unless
  it is a **barrier**: an unfinished entry names it in `after` (owner rule: never past an entry another waits on). Any other
  blocker (not_before, a dependency wait, a variant check, a bundle failure, unknown evidence) stops the walk there, as
  today. Global gates (S1-S8, R11) first, unchanged. Every skip is a sched-state row `skipped` (run, blockers, the entry
  launched instead) and one info page.
- (b) **auto-release an install-hold** only when it expired or its recorded holder pid is dead (new holds record the
  installer's pid + starttime; legacy holds: expiry only) AND every other slot check passes with the hold removed (no slot
  process, the loop lock free, no canary drop-in, no canary declared, one build on every active unit = the declared one,
  enough fresh bots, no open run) AND no model-rollout process runs. Release = a `hold-auto-released` state row with the
  evidence, the hold file renamed aside, an info page.
- (c) **recompute a hand-set patch hash**: when the queued `diff_sha256` disagrees with `diff_hash(base, tip)` and the
  patch's base/tip are exactly the variant the reviewers approved (the variant keyed on `patch.base` has
  `canary_sha == patch.tip` and a non-empty `approved`), the autorebase replaces the hash (a `patch-hash-repaired` row with
  old and new) and goes on; anything else still refuses. The reviewed identity is the approved (base, tip) pair; the hash
  is derived from it, so repairing it reviews nothing new. The rebased diff must still equal it byte for byte.
- (d) **page only when nothing in the whole queue can run**: the BLOCK page fires only when the walk found nothing
  launchable; a skip is an info page.

**Codex design.** Typed blocker subtypes (never a whole code); the literal barrier rule even for unrelated successors;
expiry alone never releases while an installer runs or holds its lock; record the installer's pid/starttime/boot id; a
hash repair only with an independently recorded approval binding the exact base/tip; keep death, unread-canary,
registration-drift and rollback alarms; audit rows for every skip and release; the autorebase targets the SELECTED entry,
never the physical head; facts keyed by (run, base, variant).

**Reconciliation.** The same design; Codex's typing is what the implementation does (subtypes from the blocker text the
code itself writes, tested per subtype). The approval record for (c) is the queued variant itself (`approved` names the
reviewers and it is keyed by the exact full base sha with the exact tip): that is what `queue set-patch` already requires.
**Finding for the owner (both engines' barrier rule):** the live queue chains every entry `after` the previous one (all 20
ready entries on 11-06), so every entry is a barrier and (a) never fires until the control session drops `after` links that only
encode order (queue position already does). Recommended: keep `after` only for real dependencies.

## Item 3 (gated parts): the speculative build and the owner-direct lane

See the implementation notes in the branch; both change the scheduler's or the deploy path's decisions and wait for the
owner's go.

## Deploy and verification

Recorded per item in the deploy log at the end of this file as each one ships (backup, selftest, a dry-run, live).
