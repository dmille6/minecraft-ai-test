# Town chest clear #2 — run procedure (PREPARED; run ONLY on the owner's explicit go)

What it removes: `docs/reports/chest-clear-manifest-2026-10-13.md` (the owner sees that first; standing rule from 10-04).
Tools: `scripts/host/chestclear3/` (census3, regionscan, positions3, cc_clear3, summary3, recountcheck, fleetversion,
rcon3) + `scripts/host/chestclear2/plan3.py` + the caps `docs/reports/stocktarget-clear-caps-2026-10-10.json`.
Journal fence: `bots/scripts/stockreset.mjs` in the promoted fleet tree (`/opt/minecraft-ai`, fleet `48b093c`).

Run from the operator's machine at a `main` checkout. `W` = the worlds host, `B` = the bots host:

```bash
W() { ssh -o BatchMode=yes mike@10.0.0.30 "$@" < /dev/null; }
B() { ssh -o BatchMode=yes mike@10.0.0.31 "$@" < /dev/null; }
T=$(date -u +%Y%m%dT%H%MZ)       # one tag for every file of this run
```

Every STOP below means: do not continue; if bots are already stopped go to step 12 (restart) and report.

## 0. Preconditions (read-only)

1. The owner's explicit GO in chat, given after seeing the manifest. Nothing else authorises this.
2. Fleet is one build with stocktarget-01 and NO canary:
   `B 'head -c 400 /srv/mcbots/trial-manifest.json; python3 ~/canary-sched.py status | tail -1'`
   -> `canary_pool: ""`, and the DECISION line names no live run (no S1/S2/S5/S7). If a canary is live: do not stop
   bots during it. Either wait for its close, or write the install hold now (step 1) so the slot is free when it ends.
3. The fence exists in the deployed tree: `B 'git -C /opt/minecraft-ai log -1 --format=%h; test -f /opt/minecraft-ai/bots/scripts/stockreset.mjs && echo OK'`.
4. `fleet-recycle.timer` is not due within 60 min (a recycle `restart`s every unit, which STARTS a stopped bot):
   `B 'systemctl list-timers fleet-recycle.timer --no-legend'`. If it is due sooner, wait until it has run.
5. Copy the tools (they live in ~/chestclear3 on both hosts; /tmp does not survive a reboot):
   ```bash
   W 'mkdir -p ~/chestclear3'; B 'mkdir -p ~/chestclear3'
   scp scripts/host/chestclear3/*.py scripts/host/chestclear2/plan3.py docs/reports/stocktarget-clear-caps-2026-10-10.json \
       docs/reports/census/positions-union-2026-10-13.json mike@10.0.0.30:chestclear3/
   scp scripts/host/chestclear3/{positions3,recountcheck,fleetversion}.py mike@10.0.0.31:chestclear3/
   ```

## 1. Hold the canary slot (no new launch until released)

```bash
B 'python3 ~/canary-sched.py install-hold chestclear3 90'      # must print "the slot is free now" (exit 0)
B 'nohup flock -n /tmp/mcai-canary.lock sleep 5400 >/dev/null 2>&1 & echo $! > ~/chestclear3/lock.pid; sleep 1; \
   flock -n /tmp/mcai-canary.lock true && echo "LOCK NOT HELD -- STOP" || echo "loop lock held by $(cat ~/chestclear3/lock.pid)"'
```
Exit 2 from install-hold = the slot is not free: the hold is written (blocks new launches) but STOP here until the live
run closes, then re-run the command until it exits 0.

## 2. Refresh container discovery (read-only; may run before step 1)

```bash
W "cd ~/chestclear3 && sudo nice -n 10 python3 regionscan.py positions-union-2026-10-13.json positions-run-$T.json"
```
Required. It adds any chest or barrel saved in the region files since 10-13 (it prints `region-only` per town; 10-13:
0 in every town, and its container counts equalled the RCON census's in all 16). Optional, for chests placed in the
last autosave interval: `B "cd ~/chestclear3 && nice -n 19 ionice -c3 python3 positions3.py positions-$T.json <census
files>"` (log mentions, ~5 min, under nice), copy its output to W and give it to regionscan instead of the union file.
A container missed by both is simply not cleared (the safe direction).

## 3. Stop all 80 bots

```bash
B 'systemctl list-units --all "mcbot@*" --no-legend --plain | awk "{print \$1}" > ~/chestclear3/units.txt; wc -l < ~/chestclear3/units.txt'   # expect 80
B 'sudo systemctl stop $(cat ~/chestclear3/units.txt); sleep 5; \
   for u in $(cat ~/chestclear3/units.txt); do systemctl is-active $u; done | sort | uniq -c'          # expect "80 inactive"
TSTOP=$(date -u +%FT%TZ)
```
(`systemctl stop` is honoured despite `Restart=always`; the reseed tooling stops bots the same way.)

## 4. Fresh census with the bots stopped (read-only)

```bash
W "cd ~/chestclear3 && sudo nice -n 10 python3 census3.py positions-run-$T.json census-before-$T.json; sudo chown mike census-before-$T.json"
```
Required: `worlds 16 with problems 0`, and every line ends `There are 0 of a max of 20 players online`. A bot still
listed = STOP (it is not stopped; find it before anything else).

## 5. Plan and compare with what the owner approved

```bash
W "cd ~/chestclear3 && python3 plan3.py census-before-$T.json stocktarget-clear-caps-2026-10-10.json plan-$T.json \
   && python3 summary3.py census-before-$T.json plan-$T.json summary-$T.json"
```
Compare with the manifest: the same categories, and the total (removed + reduced) within 10% of 256,176. Pinned must be
only `iron_diamond_netherite_tool` and `abbreviated`. A new category, or a total outside the band = STOP and re-show the
owner (restart the bots meanwhile).

## 6. Offline check

`W "cd ~/chestclear3 && python3 cc_clear3.py check census-before-$T.json plan-$T.json"` -> `problems 0`.

## 7. Validate (read-only RCON; positive and negative controls)

`W "cd ~/chestclear3 && sudo python3 cc_clear3.py validate census-before-$T.json plan-$T.json"`
Required `VALIDATE PASS` with: `world_nobody_online` 16; `planned_pass` = number of actions (every predicate passes with the
census count); `neg_wrong_count_fail(ok)`, `neg_wrong_id_fail(ok)`, `neg_kept_tool_spentpred_fail(ok)` present and NO
`_PASSED`/`_FAIL` keys; `pos_kept_tool_usablepred_pass(ok)` present. (Dry run on the live fleet 10-13 19:55Z: 6,643/6,643
planned predicates passed, 128 + 128 + 64 negative controls failed as required, 64 polarity controls passed; it
refused only because 80 bots were online -- as it must.)

## 8. Trial (one remove + one reduce)

```bash
W "cd ~/chestclear3 && sudo python3 cc_clear3.py trial census-before-$T.json plan-$T.json trial-$T.json"            # dry: prints the 2 commands
W "cd ~/chestclear3 && sudo python3 cc_clear3.py trial census-before-$T.json plan-$T.json trial-$T.json --execute"
```
Required: both `readback OK` and `TRIAL PASS`.

## 9. Run

```bash
W "cd ~/chestclear3 && sudo python3 cc_clear3.py run census-before-$T.json plan-$T.json trial-$T.json result-$T.json"          # dry
W "cd ~/chestclear3 && sudo python3 cc_clear3.py run census-before-$T.json plan-$T.json trial-$T.json result-$T.json --execute"
```
Required `RUN COMPLETE`. On `RUN ABORTED` (a slot differed from the census, an unexpected reply, a dropped connection or
latency): nothing after the failing command was sent in that world, and the other worlds stopped after their current
command. Do not retry blindly: repeat steps 4-9 once with new file names (the plan is rebuilt from the world as it now
is, so finished actions are not repeated). A second abort = STOP.

## 10. Re-census and verify

```bash
W "cd ~/chestclear3 && sudo python3 census3.py positions-run-$T.json census-after-$T.json && sudo chown mike census-after-$T.json \
   && python3 cc_clear3.py verify census-before-$T.json plan-$T.json census-after-$T.json \
   && python3 plan3.py census-after-$T.json stocktarget-clear-caps-2026-10-10.json replan-$T.json | head -6"
```
Required: `VERIFY PASS` (`kept_unchanged` = every slot not planned, `removed_empty` = removals, `reduced_exact` = reduces, 0
problems: no kept slot changed, no slot appeared, no container lost), and the re-plan prints `full after 0` with
`total slots freed 0 items 0` (the clear is at cap; idempotent). A FAIL = STOP before the restart and report (the bots
stay stopped only as long as it takes to read the mismatch).

## 11. Fence the town journals

```bash
B 'D=$(ls -d /var/lib/mcai/_pool-* | grep -v pre-reseed); echo "$D" | wc -l; \
   sudo -u mcbot node /opt/minecraft-ai/bots/scripts/stockreset.mjs --check $D'                   # 32 dirs, 32 journal lines
B 'D=$(ls -d /var/lib/mcai/_pool-* | grep -v pre-reseed); \
   sudo -u mcbot node /opt/minecraft-ai/bots/scripts/stockreset.mjs $D; echo exit=$?'
```
32 pool dirs (12 shared pools + 20 isolated per-bot dirs; dry run 10-13 19:55Z: 32 journals). Required: exit 0 and every
line `written=true ... counts_left_from_before=0`. Exit 1 = STOP (do not start the bots on a town whose fence did not
land; re-run the command -- an extra `reset` is harmless).

## 12. Restart, 12 s apart, interleaved so every town gets a bot back early

```bash
TSTART=$(date -u +%FT%TZ)
B 'for n in Alpha Bravo Comet Delta Echo Charlie; do grep -- "-$n.service" ~/chestclear3/units.txt; done | awk "!s[\$0]++" > ~/chestclear3/order.txt; \
   wc -l < ~/chestclear3/order.txt; \
   for u in $(cat ~/chestclear3/order.txt); do sudo systemctl start $u; sleep 12; done; \
   for u in $(cat ~/chestclear3/units.txt); do systemctl is-active $u; done | sort | uniq -c'       # 80 / "80 active"
```
(~16 min. order.txt must also be 80 lines; a unit name outside the list would be started by nobody -- check the count.)

## 13. Confirm the fleet version

```bash
B "cd ~/chestclear3 && python3 fleetversion.py $TSTART units.txt; python3 ~/canary-sched.py status | tail -1"
```
Required: `bots 80`, ONE version (the fleet build, `48b093c+...`), `no row since: 0` (re-run after a minute if a bot has not
logged yet), and no S5 in the DECISION line.

## 14. Release the slot

```bash
B 'kill $(cat ~/chestclear3/lock.pid); python3 ~/canary-sched.py install-release'
```
NOTE for the next canary: the clear is a fleet-wide step change in town stock. A canary whose pre-period straddles it
compares pools across the clear. Either keep the hold until one read pre-window of post-clear time has passed, or
record the clear (time + this file) in the next run's notes so its read can exclude the straddle. Operator's call;
the scheduler cannot see it.

## 15. Recount verification (+60 min, read-only)

```bash
W "cd ~/chestclear3 && sudo python3 census3.py positions-run-$T.json census-recount-$T.json && sudo chown mike census-recount-$T.json"
scp mike@10.0.0.30:chestclear3/census-recount-$T.json /tmp/ && scp /tmp/census-recount-$T.json mike@10.0.0.31:chestclear3/
B "cd ~/chestclear3 && sudo python3 recountcheck.py census-recount-$T.json \$(ls -d /var/lib/mcai/_pool-* | grep -v pre-reseed)"
```
Expect: `with_reset` 32 of 32; `counts_after` > 0 for every shared pool and for at least one bot dir of each isolated
world; `agree` >> `differ` (a few differences right after a deposit are honest; a container whose every count
differs is a finding). Instrument check, 10-13 19:56Z (pre-clear, no reset): 193 of 193 bot counts matched the census
(double chests and usable-tool copies handled). Then run the design's tripwire reads (stocktargetread + stonecapread on
the promoted fleet: first exposure of near-cap banking).

## 16. Record

Copy census-before/after, plan, summary, trial, result and the recount census to `docs/reports/census/` with the run
tag; STATE entry (DONE, the verify line, the fence line, the version line); memory note. Undo, if ever needed:
census-before records every removed stack (id, count, damage, chest, slot); putting them back would be a separate,
owner-approved world edit.

## Downtime

| Step | Time |
|---|---|
| 3 stop | ~1 min |
| 4-11 census, plan, check, validate, trial, run, re-census, verify, fence | ~4-8 min (each tool takes seconds: census 2 s, validate ~10 s, run ~10 s; the rest is reading the output) |
| 12 restart, 80 x 12 s | ~16 min |
| 13-14 version, release | ~2-3 min |

Per bot: down ~5-8 min (the first restarted) to ~21-25 min (the last); ~15 min on average. Canary slot held ~30-40 min.

## Safety properties (what the tools refuse)

- Every RCON command matches a grammar (`rcon3.Rcon(..., grammar)`); the edit grammar back-references the tested block
  and slot, so the test and the edit cannot name different slots.
- Every edit is `execute if items <exact id + exact count [+ exact damage and spent/usable bound]> run <edit>`, one
  command, atomic in its tick. A slot that changed since the census is not edited, and the run aborts.
- `validate`, `trial --execute` and `run --execute` refuse while anyone is online in the world.
- Never acted on: iron/diamond/netherite tools, any element whose NBT the server abbreviates (books, potions, enchanted
  items), any container whose read was incomplete, anything outside the bank box (|dx|,|dz| <= 48, |dy| <= 12).
- Without `--execute`, nothing but read-only commands is sent.

Proven on Paper 1.21.11 (sandbox world `sandbox`, 10-13 19:54Z, lock held; fake town of 3 containers / 77 slots):
census -> plan (44 actions: 32 remove, 2 reduce, 1 junk, 6 surplus tools, 3 spent tools; enchanted book + spent iron
pickaxe pinned) -> check 0 problems -> validate PASS -> trial PASS -> run COMPLETE -> verify PASS (33 kept unchanged, 42
removed, 2 reduced exact) -> re-plan 0 actions. Negative: a planned slot changed after the trial -> run ABORTED after 1
command (`own predicate failed`, 0 items edited); verify then FAILs on the untouched slots (its sensitivity).
