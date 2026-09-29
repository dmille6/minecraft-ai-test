# Status 2026-09-29 — scheduled daily operator session (b7afbdf5)

Written 2026-09-29 ~18:30Z. A second, interactive operator session (5e1eb303) was active all day and owns
STATE.md, so this session did NOT rewrite STATE.md (it holds uncommitted edits in both checkouts; a full
rewrite from here would have overwritten a live record). These are the facts this session verified.

## toolkeeper-01 — CLOSED, KEEP (promotion none), torn down
- `canary-loop.sh` read +1560 at 14:10:26Z: **VERDICT KEEP**; recorded in the ledger; torn down 14:16:30Z.
- Death gate held: 8 canary deaths / 520 bot-h (0.015) vs 30 control / 1,040 bot-h (0.029); ratio 0.53x,
  lower bound 0.25x. One rung-linked death reported for operator review (placebo-b-Bravo 22:35:38, entombed).
- **Teardown verified independently:** all 20 canary-pool units re-entered `active` 14:10:27–14:14:47Z,
  12 s apart; newest `code.version` per bot over all `/var/log/mcai/*` = **80 of 80 `80b3bbd+8b910b`**
  (the 80 is the positive control: every bot answered). `check-open-loop.py`: no open canary.
- As expected at +360: correct and mostly inert because the chests are full. Bank fix remains the lever.

## deathfix-01 — ended at its FIRST read by a loop defect (recorded INCONCLUSIVE)
- Launched by session 5e1eb303 at ~14:18Z; deployed 15:09:19Z to hive-a, board-a (10 bots).
- +180 read 18:13:53Z was **NOT_YET** (fall_deaths_canary = 0 < 1; exposure not reached). The loop's
  scheduled-read arm matched `*KEEP*` on the WHOLE verdict line; the line's prose said "this blocks KEEP
  rather than reverting", so FINAL=NOT_YET -> "no promotion path" -> contained as INCONCLUSIVE, torn down.
  Its registered extension reads (short-canary shape, to exposure, deadline 1680) were never taken.
- Reproduced here: the pre-fix case statement on the real +180 line yields `FINAL=NOT_YET`. It is the only
  such line in the whole journal (all read-* phases scanned).
- **Fixed on the host by session 5e1eb303 at 18:19:13Z** (matches `$1=="VERDICT"`'s word only; md5
  `eae6e6f4`, = `scripts/host/canary-loop.sh` in the main checkout, UNCOMMITTED there at 18:30Z). This
  session wrote an equivalent patch at 18:18Z (backup `~/canary-loop.sh.bak-20260929T181855Z`); it was
  overwritten by theirs, which is correct. Nothing of mine is live.
- Teardown verified: 80 of 80 on `80b3bbd+8b910b` at 18:18Z.
- **The TDZ fix still needs its canary** — as deathfix-02 (new run_id; deathfix-01 is in the ledger).

## Two small defects for whoever owns the loop next
1. **Phantom `*-Charlie` units.** `_restart_assigned` enumerates `/var/log/mcai/<pool>-*`, and eight retired
   `*-Charlie` log dirs exist (board-a/b, hive-a/b, isolated-a/b, placebo-a/b). Every teardown on those pools
   "restarts" a unit with no env file (`Failed to load environment files`), systemd marks it failed, and the
   journal says `restart-failed`. Real bots are unaffected (the fifth bot is `Comet`). Fix: skip a dir with no
   `/srv/mcbots/harness/env/<bot>.env`. This session ran `systemctl reset-failed` on the four it saw.
2. **Concurrent launch.** Both sessions launched `canary-loop.sh deathfix-01` at ~14:18Z. The flock held
   (one loop ran), but the losing launch's `> ~/canary-loop-deathfix-01.out` truncated the winner's stdout
   file. The journal is intact; the .out is not a complete record. The scheduled daily session and an
   interactive session should not both run the day's queue — see the owner note below.

## Owner note
The scheduled daily session and an interactive session both acted as operator today. Nothing broke (the
flock and the ledger held), but it doubles work and risks two STATE rewrites. Suggest: when an interactive
session is live, the scheduled run should only verify and report.
