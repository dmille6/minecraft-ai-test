# airpocket-02: the rescue's window handoff (2026-10-09)

**Status:** built on airpocket's own line, reviewed, Paper-proven. NOT deployed, NOT queued.
**Branch:** `ap2win-on-cd4eb7a` = ap2-on-dbb4d78 @ cd4eb7a + 5 commits; tip **see `git log`** (r5 d2df552 + this report).
**For:** the operator. Composition ports and the drain guard are follow-ups (section 7).

## 1. The defect, reproduced on Paper

- The drowning rescue's dig step calls `runner.interrupt('air_pocket')` and then equips at once.
  - `interrupt` only aborts the signal. The interrupted skill unwinds later, and smelt's `finally` drains the furnace for up to 12 s.
- mineflayer clicks `bot.currentWindow || bot.inventory` using player-inventory slot numbers. So the equip clicks inside the furnace window.
- **Scene SM** (new, `sandbox/craft/airpocket-ab.cjs`):
  - a sealed 1x1x2 water pocket with a furnace in the wall;
  - the pickaxe in the main inventory (container.9), so the equip has to click;
  - the scripted brain answers `smelt raw_iron` every decision.
- **The live build `dbb4d78` hit the race in 2 of 4 trials** (all on the same server, alternating arms):
  - The trace shows the step's equip clicking `win=1 slot=9` and `win=1 slot=37`, interleaved with the drain's `win=1 slot=0`.
  - The pickaxe never reached the hand: `tool=hand predicted_ms=187500`, step failed, 60-s cooldown, **the bot drowned at 104 s**.
  - In the other 2 trials the window had closed 0.35 s before the step started, so there was no race, and the bot survived.
- **A second dead end, in the airpocket-02 base itself (`cd4eb7a`), also seen on Paper:**
  - ap2's admission priced only the held item while a window was open, so it refused with "needs 284250 ms".
  - A refusal never reaches the interrupt. The smelt held the window for 80 s and **the bot drowned at 104 s**.
  - Both of this branch's first two rounds had the same dead end. Round 2's pilot found it.

## 2. The fix (bots/src/airpocket.mjs, bots/src/reflex.mjs)

All decisions are pure, exported and tested by behaviour.

- **`windowHandoff`** waits while a window is open and also while the interrupted skill is still busy (`runner.isBusy()`: its promise, `finally` included, has not settled).
  - The bound is 1.5 s.
  - A window still open at the bound: `skip`.
  - A busy skill with no window at the bound: `unsettled`, and the equip goes ahead as in airpocket-01.
  - The 250-ms settle applies only if a window was seen.
  - The wait pokes the guard, so a skill that cognition starts meanwhile is interrupted.
  - The wait re-asserts the step's jump, because `haltPath` clears every control.
- **`equipClicks`:** with no window open, a quick-bar tool is a selection (`held_item_slot`). It needs no click and no wait.
- **`windowOwned` / `admissionTools`:** admission prices what the step will be able to use.
  - Owned window (a busy runner or a withdraw hold): every tool. The step's interrupt or the survival release closes the window.
  - Unowned window (an open that timed out and was granted late, so nothing ever closes it): only the held item. The step digs with it and equips nothing (`window=unowned`).
- **Step, if the window is still open after the wait:**
  - owned: no equip, no dig. mineflayer refreshes `bot.inventory` only at the close, so any price taken through the window is stale.
  - unowned: dig with the held item.
  - After any wait, the step picks again from the refreshed inventory.
- **`airPocketPreemptDecision`:** with an *owned* window open it returns `'window'`.
  - The reflex then interrupts the window's owner and leaves the escape alone. A cancelled escape does not come back for 15–60 s.
  - The next tick decides with the window shut.
  - An unowned window falls through to the held-only admission.
- **Short cooldown (5 s), not 60 s,** for any over-budget refusal after the handoff waited, and for any equip that throws. withdraw's `ownInventory` refuses every equip.
- **Row tail:** `window=<none|closed|settled|unsettled|open|unowned>:<ms>`. The new pre-empt hold logs `_air_pocket_refused reason=a container window is open (…)`, throttled to once per 30 s. airpocket2read.py does not parse either today (Codex: keep `window=` optional).
- **Why `unsettled` may equip (both engines verified):**
  - In mineflayer 4.37.1 on 1.21, `clickWindow` awaits nothing from the network for container or ordinary inventory slots.
  - Its quick-bar dig delay never sleeps: it compares `new Date()` with `performance.now()`.
  - So an equip's clicks go out in one macrotask, and the synchronous re-check covers them.
  - Exception: a skill wrapper around `bot.equip` that awaits first (craftsync's lockstep). A mineflayer that fixed that clock would reopen a gap of up to 500 ms after a dig.

## 3. Tests

- `bots/test/airpocket.test.mjs` grew from 128 checks (ap2) to **171**:
  - P1–P15, K9–K11, and the G wiring with G4 mutants.
  - Every decision line has an anchored mutant (`withMutant`/`withMutantsAll` assert the anchor present and unique), each seen to fail for its intended reason.
  - Codex r4 caught one mutant that both arms passed (P15c); it is fixed and now seen to kill.
- **npm test:** 237/237 on cd4eb7a (baseline), 237/237 on r4 dafc276, 237/237 on r5 d2df552.
- **Lint:** only the known `withinBody`.

## 4. Paper (sandbox + sandbox2; lock taken over from a stale holder, released at the end)

| scene | build | trials | alive | notes |
|---|---|---|---|---|
| SM | dbb4d78 (live airpocket-01) | 4 | 2 | 2 equipped inside the furnace window, tool=hand, drowned |
| SM | cd4eb7a (ap2 base) | 1 | 0 | admission dead end, 5 refusals |
| SM | 39ac212 (r2) | 1 | 0 | same admission dead end (pilot) |
| SM | 978c887 (r3) | 1 | 1 | equip 345 ms after step start, in win=0 |
| SM | dafc276 (r4) | 3 | 3 | the pre-empt's 'window' interrupted the smelt; the step ran 6 s later; equips in win=0 only |
| SM | d2df552 (r5) | 2 | 2 | the 'window' decision interrupted the smelt; equips in win=0 only (slots 9->37) |
| A / AF / F | dafc276 | 3 | 3 | no regression |
| A / AF | d2df552 | 2 | 2 | no regression |

- **Denominators:** each trial is one fresh bot. "Alive" is read from the server: the deathCount scoreboard and Health.
- **"Inside the furnace window"** is read off the wire: trace.cjs logs each click with its window id.
- **Tooling:** driver `sandbox/craft/airpocket-ab.cjs` (scene SM, kit `smelt`, `AP_BRAIN_SKILL`, window events); reader `scripts/host/sm-read.py`.

## 5. Reviews (Codex `codex exec` + Claude subagent, five rounds)

| round | Codex | Claude |
|---|---|---|
| r1 | CHANGE | CHANGE |
| r2 | CHANGE (P1 withdrawn after tracing mineflayer) | APPROVE (P3s) |
| r3 | CHANGE | CHANGE |
| r4 | CHANGE | APPROVE |
| r5 | APPROVE (P3s) | APPROVE (P3s) |

What each round's findings led to:
- **r1:** jump during the wait, the wait on the common path, and a 60-s cooldown after a wait-caused refusal → fixed. The drain guard collided with peacefulkit → removed.
- **r2:** withdraw refuses every equip → short cooldown. The inventory is stale through an open window → refuse.
- **r3 (Paper pilot found the admission dead end):** unowned windows → ownership. No pre-empt through an open window.
- **r4:** only owned windows hold off the pre-empt. P15c fixed.

## 6. Residuals (accepted, bounded)

- **Hung skill holding an owned window:** the step refuses on a 5-s cycle until the hard-stop (≤ 210 s). Rare: drains and opens are bounded.
- **Hung skill with no window:** each step waits 1.5 s once, then equips.
- **The `'window'` interrupt:** a skill's finally runs `setGoal(null)` during an escape. This is pre-existing in kind; r5 review notes no dead end: pillarOut/digStraightUp re-set jump on the next iteration (one block of budget per clear); escapeStairUp's 1.5-s stroke can be lost and the rescue restarts it (both r5).
- **craftsync's lockstep `equip` wrapper** awaits before the clicks; documented, not handled.
- **An unrelated busy skill counts as the owner of an unowned window:** admission prices every tool, the step then digs with what is held. One short-cooldown cycle at worst.
- **Codex r5: the 210-s hard-stop bounds the stall, not mortality.** A hung skill that holds an owned window can outlast a drowning bot.

## 7. Follow-ups (not in this change)

1. **Composition ports.** th-on-dbb4d78 (4970c91), pk-on-4970c91 (6f1921a) and pk-on-2f38f69 (4be1a29) are built on airpocket-01. Porting the handoff means porting airpocket-02 itself.
   - A dry-run cherry-pick of dbb4d78..d2df552 conflicts at ap2's first commit (62b31c6) in airpocket.mjs and reflex.mjs, against toolhygiene's `airPocketTools`. That is not this change's commits.
   - th's test anchor `const items = airPocketTools(...)   // the step's own candidates` must be re-anchored (Claude r2 P3-4).
2. **Smelt drain guard.** Take and close only while `bot.currentWindow === furnace`. Built in r1 and removed.
   - It is a smelt hazard after a server-side close, independent of the rescue.
   - It belongs on peacefulkit's rewritten drain: `drainFurnace(furnace, ms, bot)`, `settleFurnaceCursor` clicks unguarded, and pk's fake `openFurnace` sets no `currentWindow`.
3. **The escape's own scaffold equip** (Claude r5): `pillarOut` calls `bot.equip` with no window handoff. While an owned window is open during an escape (the `'window'` branch's state), it can click the container window with player-inventory slots. Pre-existing; it needs its own small fix.
4. **airpocket2read.py** is still untracked in the ap2 builder's worktree, along with the design doc and the freeze-probe drivers. Accept `settled|unsettled|unowned` there if the read ever parses `window=`.
