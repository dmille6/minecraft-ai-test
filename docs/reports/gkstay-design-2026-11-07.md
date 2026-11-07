# gkstay-01: the keeper lease stops churning (2026-11-07)

Ledger row `gkstay-1107`. Source: the coordinator, 11-06 ~24:00Z. After gklease-01, the keeper lease changed hands 5 times in an
hour on the showcase, 4 of them `keeper_release why=underground`, and the forest got 1 visit.

## Measured (`lib.telemetry`, main's copy, full walks)

| | Showcase 9dfa85b9, 1.25 h, 13 bots | Fleet e447b65b, 1.18 h, 80 bots / 16 towns |
|---|---|---|
| Rows walked | 15,142 | 109,699 |
| Keeper takes | 6 (4.8/h) | 102 (2.5 to 8.5 per town-hour) |
| `keeper_release why=underground` | 5 | 91 |
| Other releases | 1 no_work_visit | 9 stuck, 4 away, 3 no_work_visit |
| Grounds visits | 1 (forest) | 251 (tidy) |
| How the holder went below | `gather dirt`, chosen by the model (llm:idle), down to y 50-54: Bravo, Haven, Iris, Juno. Kite: `gather iron_ore`, then walled in. The showcase release has no idle_work rung. | The first skill below, in the 22 terms where it could be traced: `mine y=16` 9 (idle_work's iron hint "mine down to y=16"), `deep_mine` 3, other mines 5, dirt 3 |

## The change

- **Both trees, the persistence rule** (`groundskeeper.mjs unfitPersist`): a holder is released as unfit only after 5 min of
  being unfit without a break. A dirt pit or the stepwell's descent is no longer a hand-off. A take still needs the bot fit now.
- **Fleet only, the holder's lap stays on the surface** (`idlework.mjs holderMeans`):
  - While a bot holds the keeper lease, its idle_work lap opens no iron or coal batch. The order is grounds, else logs, else
    scout, never a mine batch.
  - A bot with an open below-surface batch never takes the lease. The check is in `keeperOrder` and, after Codex r1, in
    `takeKeeper` too, so it also covers buildTidy's visit start.
  - A holder whose open batch goes below gives the lease up deliberately: `keeper_release why=handoff`.
  - `GKSTAY=0` is the rollback for the lap rule.
- **The showcase has no idle_work rung.** Its between-visit choices are the model's (protected code: `cognitive.mjs`, and
  `skills.mjs::gather`), so only the persistence rule applies there.

## Reviews, tests, suites, tripwire

- **Tier 2**, not protected (hunk-level `protected.py`), so one engine.
- **Codex r1** found 1 blocker: buildTidy's takeKeeper bypassed the below-batch guard. Fixed. **Codex r2:** NO BLOCKERS.
- **Tests:** `gkstay.test.mjs`:
  - the live Juno dip, and the release after 5 min below;
  - on the fleet, a holder's lap over 16 cycles never opens iron or coal;
  - 3 anchored mutants, and the wiring.
  - I updated the wiring regexes in `gklease.test` and `gkhelpers.test` to follow the changed lines.
- **Tripwire:** no rule needed. `_keeper` rows are not judged. `replaygate.py shapes` (old 9dfa85b9, new branch, the installed
  reader) found no unknown shapes (`[]`).
- **Suites** (`suite-run.py --ref`, ci2):
  - showcase 60828536: 456/457. The one FAIL is nothing-important-is-orphaned, from the known untracked `bagdiet.test.mjs` on
    the base.
  - fleet a4fe5358: 406/408. `well.test` also fails on the base e447b65b (checked in a temporary worktree). `lavastep` is the known
    flake and passes alone.
- **Fleet registration** and a draft queue entry: `docs/reports/gkstay-01/`. The registration is also at
  `~/mcai-analysis/gkstay-01.a4fe5358.json` on .31.
