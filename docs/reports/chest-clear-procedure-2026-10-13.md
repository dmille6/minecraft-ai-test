# Town chest clear #2: run procedure

**Status: PREPARED. Run it ONLY on the owner's explicit go.**

What it removes is in `docs/reports/chest-clear-manifest-2026-10-13.md`. The owner sees that first; that is the
standing rule from 10-04.

Tools:
- `scripts/host/chestclear3/`: regionscan, forceload3, census3, cc_clear3, summary3, recountcheck, fleetversion, rcon3,
  and positions3 (optional)
- `scripts/host/chestclear2/plan3.py`
- the caps, `docs/reports/stocktarget-clear-caps-2026-10-10.json`
- the journal fence, `bots/scripts/stockreset.mjs` in the promoted fleet tree (`/opt/minecraft-ai`, fleet `48b093c`)

Run from the operator's machine at a `main` checkout. `W` is the worlds host and `B` is the bots host:

```bash
W() { ssh -o BatchMode=yes mike@10.0.0.30 "$@" < /dev/null; }
B() { ssh -o BatchMode=yes mike@10.0.0.31 "$@" < /dev/null; }
T=$(date -u +%Y%m%dT%H%MZ)       # the SESSION tag: discovery (positions-run-$T), chunk tickets (forceload-$T), units
A=1                              # the ATTEMPT tag: census, plan, summary, trial, result (a retry sets A=2; Codex r3)
```

## Two kinds of STOP

### STOP-A: no edit has been attempted yet

This covers anything before `trial --execute` in step 8.
1. Do not continue.
2. Remove the chunk tickets (step 10b).
3. If the bots are stopped, restart them (step 12), then do steps 13 and 14.
4. Report.

Chests and journals are untouched, so no fence is needed.

### STOP-B: an edit was attempted

This applies once `trial --execute` has run, whatever it printed, and to every later step.
1. Do not continue the clear.
2. Do NOT restart before the fence.
3. Re-census for the record:
   `W "cd ~/chestclear3 && sudo python3 census3.py positions-run-$T.json census-after-$T-a$A.json && sudo chown mike census-after-$T-a$A.json"`.
   Then run the PARTIAL verify of this attempt (Claude r2 S2):
   `W "cd ~/chestclear3 && python3 cc_clear3.py verify census-before-$T-a$A.json plan-$T-a$A.json census-after-$T-a$A.json result-$T-a$A.json trial-$T-a$A.json"`
   If only the trial ran, pass `-` for the result file. Its problems should be exactly the slot(s) named in the failure.
   Report anything else.
4. Then do step 10b, step 11 (fence every journal), and steps 12-14.

The fence is harmless on a partial clear: the bots just recount. Keep every file of the run.

## 0. Preconditions (read-only)

1. **The owner's explicit GO in chat**, given after seeing the manifest. Nothing else authorises this.
2. **The fleet is on one build that has stocktarget-01, and NO canary is live.**
   `B 'head -c 400 /srv/mcbots/trial-manifest.json; python3 ~/canary-sched.py status | tail -1'`
   - Expect `canary_pool: ""`.
   - Expect a DECISION line that names no live run: no S1, S2, S5 or S7.
   - Never stop bots during a canary. If one is live, write the hold now (step 1) and wait for the run to close.
3. **The fence exists in the deployed tree:**
   `B 'git -C /opt/minecraft-ai log -1 --format=%h; test -f /opt/minecraft-ai/bots/scripts/stockreset.mjs && echo OK'`
4. **No fleet recycle is running:** `B 'systemctl is-active fleet-recycle.service'` must print `inactive`.
   - A recycle runs `restart` on every unit, and that STARTS a stopped bot.
   - Step 1 suspends the recycle timer and step 14 restores it.
5. **Copy the tools to both hosts.** They live in `~/chestclear3`; `/tmp` does not survive a reboot.
   ```bash
   W 'mkdir -p ~/chestclear3'; B 'mkdir -p ~/chestclear3'
   scp scripts/host/chestclear3/*.py scripts/host/chestclear2/plan3.py docs/reports/stocktarget-clear-caps-2026-10-10.json \
       docs/reports/census/positions-union-2026-10-13.json mike@10.0.0.30:chestclear3/
   scp scripts/host/chestclear3/{positions3,recountcheck,fleetversion}.py mike@10.0.0.31:chestclear3/
   ```

## 1. Hold the canary slot and suspend the recycle timer

```bash
B 'python3 ~/canary-sched.py install-hold chestclear3 120'      # must print "the slot is free now" (exit 0)
B 'nohup flock -n /tmp/mcai-canary.lock sleep 7200 >/dev/null 2>&1 & echo $! > ~/chestclear3/lock.pid; sleep 1; \
   flock -n /tmp/mcai-canary.lock true && echo "LOCK NOT HELD -- STOP-A" || echo "loop lock held by $(cat ~/chestclear3/lock.pid)"'
B 'systemctl is-active fleet-recycle.timer; sudo systemctl stop fleet-recycle.timer; systemctl is-active fleet-recycle.timer fleet-recycle.service'
```
- **install-hold.** Exit 2 means the slot is not free. The hold is still written, so no new launch can start. Wait
  until the live run closes, then re-run the command until it exits 0.
- **Timer.** Expect `active` first, then `inactive` and `inactive`. If the timer was not active to begin with, write
  that down and do not start it in step 14.
- **Retry.** If step 9 needs its retry, extend the hold: run `install-hold chestclear3 120` again, and start a new
  `flock ... sleep` before the first one expires.

## 2. Refresh container discovery, and keep every bank chunk loaded

Run this with the bots still online.

```bash
W "cd ~/chestclear3 && sudo nice -n 10 python3 regionscan.py positions-union-2026-10-13.json positions-run-$T.json"
W "cd ~/chestclear3 && sudo python3 forceload3.py positions-run-$T.json query /dev/null \
   && sudo python3 forceload3.py positions-run-$T.json add forceload-$T.json"
```

**regionscan** must end with `DISCOVERY PASS`.
- That means every chunk of every bank box was read. Any unread chunk makes it exit 1, which is STOP-A.
- It adds any chest or barrel saved in the region files since 10-13, and prints `region-only` per town. On 10-13 it
  found 0 in every town, and its container counts equalled the RCON census in all 16.
- Optional, for chests placed within the last autosave: run
  `B "cd ~/chestclear3 && nice -n 19 ionice -c3 python3 positions3.py positions-$T.json <census files>"`. It reads the
  log mentions, takes about 5 minutes and runs under nice. Copy its output to W and give it to regionscan in place of
  the union file.
- A container that both instruments miss is simply not cleared. That is the safe direction.

**forceload3** must end with `FORCELOAD add PASS`.
- Why: with nobody online, a world keeps only its spawn chunks loaded (`spawnChunkRadius` 2). Seven bank containers in
  four towns sit 2-3 chunks from home and would read as "not loaded" (Claude r1 1). On the sandbox, a chest in such a
  chunk read "That position is not loaded" 2 s after its ticket went; after `add` it read normally.
- What it adds: a chunk ticket for each bank-box chunk that is not already force-loaded. Existing tickets are recorded
  in `forceload-$T.json` and never removed. A ticket changes no blocks.
- Fleet query on 10-13: 0-22 chunks were already force-loaded per world, and 27-49 of the 49 bank chunks per world
  would be added.

## 3. Stop all 80 bots

```bash
B 'systemctl list-units --all "mcbot@*" --no-legend --plain | awk "{print \$1}" > ~/chestclear3/units.txt; wc -l < ~/chestclear3/units.txt'   # expect 80
B 'sudo systemctl stop $(cat ~/chestclear3/units.txt); sleep 5; \
   for u in $(cat ~/chestclear3/units.txt); do systemctl is-active $u; done | sort | uniq -c'          # expect "80 inactive"
```

`systemctl stop` is honoured despite `Restart=always`. The reseed tooling stops bots the same way.

## 4. Fresh census with the bots stopped (read-only)

```bash
W "cd ~/chestclear3 && sudo nice -n 10 python3 census3.py positions-run-$T.json census-before-$T-a$A.json; sudo chown mike census-before-$T-a$A.json"
```

- **Required:** `worlds 16 with problems 0`. A position that cannot be read, for example "not loaded", counts as a
  problem.
- **Required:** every line ends `There are 0 of a max of 20 players online`.
- If a bot is still listed, that is STOP-A: it is not stopped, and you must find it before anything else.

## 5. Plan, and compare it with what the owner approved

```bash
W "cd ~/chestclear3 && python3 plan3.py census-before-$T-a$A.json stocktarget-clear-caps-2026-10-10.json plan-$T-a$A.json \
   && python3 summary3.py census-before-$T-a$A.json plan-$T-a$A.json summary-$T-a$A.json"
```

**Compare it with the manifest:**
- The same categories.
- The total (removed + reduced) within 10% of 255,058. On a retry after an abort, use round one's removed + reduced
  items (from `result-$T-a1.json` + `trial-$T-a1.json`) plus the new plan.
- Only `iron_diamond_netherite_tool`, `abbreviated` and `has_components` may appear as pinned.
- `caps exceeded by pinned items alone: none`, or a short list that you then report.

A new category, or a total outside the band, is STOP-A. Re-show the owner, and restart the bots meanwhile.

## 6. Offline check

`W "cd ~/chestclear3 && python3 cc_clear3.py check census-before-$T-a$A.json plan-$T-a$A.json"` must print `problems 0`.

## 7. Validate (read-only RCON, with positive and negative controls)

`W "cd ~/chestclear3 && sudo python3 cc_clear3.py validate census-before-$T-a$A.json plan-$T-a$A.json"`

It must print `VALIDATE PASS`, with:
- `world_nobody_online` = 16;
- `planned_pass` = the number of actions, so every predicate passes with the census count;
- `neg_wrong_count_fail(ok)`, `neg_wrong_id_fail(ok)` and `neg_kept_tool_spentpred_fail(ok)`, and no keys that end
  in `_PASSED` or `_FAIL`;
- `pos_kept_tool_usablepred_pass(ok)`.

**Read-only dry run on the live fleet, 10-13 20:13Z:**
- 6,623 of 6,623 planned predicates passed.
- The 128 + 128 + 64 negative controls all failed, as required.
- The 64 polarity controls passed.
- It refused only because 80 bots were online, as it must.

## 8. Trial: one remove and one reduce

```bash
W "cd ~/chestclear3 && sudo python3 cc_clear3.py trial census-before-$T-a$A.json plan-$T-a$A.json trial-$T-a$A.json"            # dry: prints the 2 commands
W "cd ~/chestclear3 && sudo python3 cc_clear3.py trial census-before-$T-a$A.json plan-$T-a$A.json trial-$T-a$A.json --execute"
```

- **Required:** both `readback OK`, and `TRIAL PASS`.
- **Pre-read.** Before each edit, the slot is read and compared with the census, on the element's full text.
- **Receipt.** `trial-$T-a$A.json` is bound to this census and plan: their sha256 and the exact two commands. It is written
  after every step.
- **In `run`.** It refuses a receipt that does not match, and re-reads both trial slots before skipping them.
- **Failure.** Any trial failure is STOP-B.

## 9. Run

```bash
W "cd ~/chestclear3 && sudo python3 cc_clear3.py run census-before-$T-a$A.json plan-$T-a$A.json trial-$T-a$A.json result-$T-a$A.json"          # dry
W "cd ~/chestclear3 && sudo python3 cc_clear3.py run census-before-$T-a$A.json plan-$T-a$A.json trial-$T-a$A.json result-$T-a$A.json --execute"
```

**Required:** `RUN COMPLETE`.

**How the run works:**
- It goes container by container.
- First it reads each container once. Every planned slot must still be exactly what the census saw, compared on full
  text, so an added name or enchantment shows.
- Then it sends one atomic `execute if items <exact id+count[+damage]> run <edit>` per slot.

**`RUN ABORTED`** comes from any of:
- a pre-read difference;
- a failed predicate;
- an unexpected reply;
- an exception;
- latency.

After an abort:
- In the failing world, nothing after the failing point was sent.
- The other worlds stopped after their current command.
- `result-$T-a$A.json` lists every action that landed (`done_keys`). It is written before the first edit, after every
  container and at the end (`final: true`), so a dropped ssh session or a crash still leaves it. A long run can also be
  launched with `setsid nohup ... &` and polled.

**One retry is allowed:**
1. Keep `A=1` for now (Codex r4 2). Take the attempt-2 census by its explicit name:
   `W "cd ~/chestclear3 && sudo nice -n 10 python3 census3.py positions-run-$T.json census-before-$T-a2.json; sudo chown mike census-before-$T-a2.json"`
   (the same requirements as step 4).
2. Verify round one as a partial run:
   `W "cd ~/chestclear3 && python3 cc_clear3.py verify census-before-$T-a1.json plan-$T-a1.json census-before-$T-a2.json result-$T-a1.json trial-$T-a1.json"`.
   Its problems must be exactly the slot(s) named in the abort, with nothing else changed. Any other problem is
   STOP-B, with no retry: an RCON exception after a command was sent can land an edit that `done_keys` does not list,
   and this check is what catches it.
3. Only after that verify is accepted, set `A=2`. Then do steps 5-9, which give a new plan and a new trial receipt. If
   the verify is not accepted, STOP-B runs with `A=1`, whose files all exist. Keep the forceload state
   `forceload-$T.json` from step 2. Do not run `forceload3 add` again; it refuses an existing state file.

A second abort is STOP-B.

## 10. Re-census and verify

```bash
W "cd ~/chestclear3 && sudo python3 census3.py positions-run-$T.json census-after-$T-a$A.json && sudo chown mike census-after-$T-a$A.json \
   && python3 cc_clear3.py verify census-before-$T-a$A.json plan-$T-a$A.json census-after-$T-a$A.json \
   && python3 plan3.py census-after-$T-a$A.json stocktarget-clear-caps-2026-10-10.json replan-$T-a$A.json | head -6"
```

**Required: `VERIFY PASS`.**
- The counts must add up: `kept_unchanged` = every slot that was not planned, `removed_empty` = the removals, and
  `reduced_exact` = the reductions.
- There must be 0 problems:
  - No kept slot changed. Slots are compared on the element's full text, so a changed name, enchantment or count shows.
  - No slot appeared.
  - No container was lost.
- verify also refuses a census that has any error or incomplete read.
- `kept_abbreviated_partially_verified` counts the kept elements the server shortens. Those are compared on id, count
  and slot only.

**Required: the re-plan** prints `full after 0` and `total slots freed 0 items 0`. That shows the clear reached the caps,
and that running it again would change nothing.

A FAIL is STOP-B: fence, then restart, and report the mismatch. After a retry, `A=2` here, so verify compares
census-before-a2 with census-after-a2; round one was already verified in step 9.

## 10b. Remove the chunk tickets the clear added

`W "cd ~/chestclear3 && sudo python3 forceload3.py positions-run-$T.json remove forceload-$T.json"`

- It must end `FORCELOAD remove PASS`, with every world back to exactly the force-loaded set it had before the clear.
- It removes only the tickets this run added.
- A ticket that someone else already removed is reported but is not a failure. The end-state check decides.

## 11. Fence the town journals

```bash
B 'D=$(ls -d /var/lib/mcai/_pool-* | grep -v pre-reseed); echo "$D" | wc -l; \
   sudo -u mcbot node /opt/minecraft-ai/bots/scripts/stockreset.mjs --check $D'                   # 32 dirs, 32 journal lines
TFENCE=$(date -u -v-1M +%FT%TZ 2>/dev/null || date -u -d '-1 min' +%FT%TZ)   # a minute of slack for clock skew
B 'D=$(ls -d /var/lib/mcai/_pool-* | grep -v pre-reseed); \
   sudo -u mcbot node /opt/minecraft-ai/bots/scripts/stockreset.mjs $D; echo exit=$?'
```

- **The dirs.** There are 32 pool dirs: 12 shared pools plus 20 isolated per-bot dirs. The dry run on 10-13 19:55Z
  found 32 journals.
- **Required:** exit 0, and every line reads `written=true ... counts_left_from_before=0`.
- **Exit 1 is a stop.** Do not start the bots on a town whose fence did not land. Re-run the command; an extra `reset`
  is harmless.

## 12. Restart, 12 s apart

The order is interleaved by bot name, so every town gets a bot back early.

```bash
TSTART=$(date -u +%FT%TZ)
B 'for n in Alpha Bravo Comet Delta Echo; do grep -- "-$n.service" ~/chestclear3/units.txt; done > ~/chestclear3/order.txt; \
   cat ~/chestclear3/units.txt >> ~/chestclear3/order.txt; awk "!s[\$0]++" ~/chestclear3/order.txt > ~/chestclear3/order1.txt; \
   wc -l < ~/chestclear3/order1.txt; \
   for u in $(cat ~/chestclear3/order1.txt); do sudo systemctl start $u; sleep 12; done; \
   for u in $(cat ~/chestclear3/units.txt); do systemctl is-active $u; done | sort | uniq -c'       # 80 / "80 active"
```

- This takes about 16 minutes.
- `order1.txt` is the name order first, then every unit in `units.txt` that is not yet listed, so all 80 are always
  started (Claude r1 7).

## 13. Confirm the fleet version

```bash
B "cd ~/chestclear3 && python3 fleetversion.py $TSTART units.txt; python3 ~/canary-sched.py status | tail -1"
```

**Required:**
- `bots 80`;
- ONE version, the fleet build (`48b093c+...`);
- `no row since: 0`. If a bot has not logged yet, re-run after a minute.
- no S5 in the DECISION line.

## 14. Release

```bash
B 'pkill -P $(cat ~/chestclear3/lock.pid); kill $(cat ~/chestclear3/lock.pid); sleep 1; \
   flock -n /tmp/mcai-canary.lock true && echo "loop lock FREE" || echo "STILL HELD: pgrep -af sleep"; systemctl list-timers fleet-recycle.timer --all --no-legend; \
   sudo systemctl start fleet-recycle.timer; systemctl is-active fleet-recycle.timer; \
   systemctl list-timers fleet-recycle.timer --no-legend; python3 ~/canary-sched.py install-release'
```

**The loop lock is held by flock's CHILD.** Killing only the flock pid leaves `sleep` holding the lock; this happened
on the 10-14 run. Kill the child too (`pkill -P`), and confirm `loop lock FREE`.

**The timer may fire at once.** The timer is `OnUnitActiveSec=6h`. If 6 h have passed since the last recycle, starting
it fires a recycle right away. That restarts every bot again, 6 s apart. This is harmless, but read NEXT first. If the
due time has passed and you want to avoid a second restart, start the timer after the next 6-h mark is safely ahead.
Never leave the timer stopped.

**The next canary.** The clear is a fleet-wide step change in town stock, so a canary whose pre-period straddles it
compares pools across the clear. Choose one, and record which:
- keep the hold until one read pre-window of post-clear time has passed; or
- record the clear (its time and this file) in the next run's notes, so its read can exclude the straddle.

This is the operator's call; the scheduler cannot see the clear.

## 15. Recount verification (+60 min, read-only)

```bash
W "cd ~/chestclear3 && sudo python3 census3.py positions-run-$T.json census-recount-$T-a$A.json && sudo chown mike census-recount-$T-a$A.json"
scp mike@10.0.0.30:chestclear3/census-recount-$T-a$A.json . && scp census-recount-$T-a$A.json mike@10.0.0.31:chestclear3/
B "cd ~/chestclear3 && sudo python3 recountcheck.py census-recount-$T-a$A.json --reset-after $TFENCE \$(ls -d /var/lib/mcai/_pool-* | grep -v pre-reseed)"
```

**Required:** `RESET PASS`, meaning all 32 dirs carry a reset at or after the fence.

**Expect:**
- COVERAGE above 0 in every world, rising over the hours as bots visit. This counts containers with a nonzero recount.
- `match` far above `partial`. Each container is compared as ONE consistent view, and every name counts, zeros
  included. A recount that is all zeros is listed as `zero-only`, not as a match.
- **A finding:** many partials, or a world still at 0 coverage after 2 h. A few partials right after a deposit are
  honest.

**Instrument check, 10-13 20:1xZ, before the clear and with live bots:** 60 matches and 7 partials over 67 recounted
containers. The partials were drift since the census.

Then run the design's tripwire reads on the promoted fleet: stocktargetread and stonecapread. This is the first
exposure of near-cap banking.

## 16. Record

1. Copy these files to `docs/reports/census/` with the run tag: census-before and census-after, the plan, the summary,
   the trial, the result, the forceload state and the recount census.
2. Write a STATE entry: DONE, plus the verify line, the fence line and the version line.
3. Write a memory note.

**Undo, if it is ever needed.** census-before records every removed stack: its id, count, damage, chest and slot.
Putting the stacks back would be a separate world edit that the owner approves.

## Downtime

| Step | Time |
|---|---|
| 1-2 hold, discovery, chunk tickets (bots still online) | ~2 min |
| 3 stop | ~1 min |
| 4-11 census, plan, check, validate, trial, run, re-census, verify, tickets, fence | ~4-8 min. Each tool takes seconds (census 2 s, validate ~10 s, run ~15 s); the rest is reading the output |
| 12 restart, 80 x 12 s | ~16 min |
| 13-14 version, release | ~2-3 min |

- **Per bot:** down from about 5-8 min (the first restarted) to about 21-25 min (the last). The average is about 15
  min.
- **Canary slot:** held about 35-45 min. Add about 10 min for a retry.

## What the tools refuse

- **Grammar.** Every RCON command must match a grammar. The edit grammar back-references the block and slot it tested,
  so the test and the edit cannot name different slots.
- **One atomic command per slot:** `execute if items <exact id + exact count [+ exact damage and the spent/usable
  bound]> run <edit>`. A slot whose id, count or damage changed is not edited, and the run aborts.
- **Component changes are caught by the pre-read.** The predicate cannot see components other than damage. So `trial`
  and `run` first read each container and compare every planned slot's full text with the census. The bots are stopped
  and nobody is online, so the interval between that read and the edit is quiet.
- **Nobody online.** `validate`, `trial --execute` and `run --execute` refuse while anyone is online in the world.
- **Never acted on:**
  - iron, diamond and netherite tools;
  - any element whose data the server shortens (books, potions, enchanted items);
  - any element with a component other than damage;
  - any container whose read was incomplete;
  - anything outside the bank box (|dx|,|dz| <= 48, |dy| <= 12).

  Pinned items still count against their cap.
- **Dry run.** Without `--execute`, only read-only commands are sent. The exception is forceload3 `add`/`remove`: chunk
  tickets only, recorded in a state file.

## Proven on Paper 1.21.11

These ran on the sandbox world `sandbox` with `/tmp/mcai-sandbox.lock` held. The r2 and r3 logs are in
`docs/reports/census/chest-clear-sandbox-2026-10-13.txt`.

**r1, 19:54Z.** Census, plan (44 actions), check, validate PASS, trial PASS, run COMPLETE, verify PASS, then a re-plan
with 0 actions.

**r2, 20:08Z:**
- Positive end to end.
- A stale trial receipt is refused.
- A planned slot changed after the trial: the run ABORTED after 1 command with 0 items edited.
- A trial whose slot was gone was refused before any edit.

**r3, 20:13Z:**
- **(A) Unloaded chunk.** With nobody online, a chest in an unforced chunk read "That position is not loaded" after
  2 s, and census3 reported 1 problem.
- **(B) Chunk tickets.** `forceload3 add` added 48 tickets (18 already forced were left alone), and the census then
  read all 6 containers.
- **(C) A planned slot gained a NAME after the trial (same id and count).** The run aborted on the pre-read with 0
  commands sent, and the partial verify flagged exactly that slot.
- **(D) Full positive run** with a double chest and the far chest: 52 actions, verify PASS, and a re-plan with 0
  actions. Then a KEPT slot gained a name, and verify FAILED on exactly that slot.
- **(E) `forceload3 remove`.** The world went back to exactly its 18 pre-existing tickets. The run still printed FAIL
  (1) at r3, because the scene's own setup had removed one of the clear's tickets; r4 explains it.

**r4, forceload3 at HEAD:**
- `add` exits 0.
- A second `add` with the same state file is REFUSED (exit 2).
- `remove` exits 0 and reports PASS, with 18 tickets before and 18 after.
- With one ticket removed behind its back, `remove` reports it and still PASSes on the end state.

**r5, 20:22Z, the final scripts.** The md5s are in the log.
- A full positive run: the result file has `final: true` and 50 `done_keys`, and verify PASSes.
- Trial only: the partial verify with result `-` PASSes, and the full verify FAILs, as it must.

**Residual.** Chunk tickets are not reference-counted. If another tool removes a bank-chunk ticket during the clear,
that chunk can unload, and the next census or pre-read fails. That fails safe as STOP-A or STOP-B. Keep other agents
off forceload during the run.
