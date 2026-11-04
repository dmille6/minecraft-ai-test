# siteprep-01: PIECES note for the showcase release (2026-11-04)

For the control session, which owns showcase releases. Nothing here is staged, activated, queued or deployed.

- **Run:** `siteprep-01`. **Kind:** `building` (tier 2; no protected file).
- **Branch:** `siteprep-01` (origin). **Base:** `4e559e0b6ddcb1940d5cb201cb9fe010b6ca7796` (cropfarm-02fix, the live release since
  11-04 08:13Z). **Code final:** `cc3d148d` (both engines APPROVE, r7); the docs-only commits after it carry the reviews and this note.
- **Design and record:** [`siteprep-design-2026-11-04.md`](siteprep-design-2026-11-04.md) (sections 13-14: the blocker rounds, the
  tests, the offline proof).
- **Switch / rollback:** `SITEPREP=off` (unset: on in `SITEPREP_POOLS`, default `showcase`; it also needs the keeper's grounds and
  the sinks on). A request's zone is a reservation only while it is prepping or prepared; with the switch off nothing reads or
  writes `project-<home>.siteprep`, and the prep cells already on the tidy record are ordinary tidy cells. Code rollback: the
  previous release `4e559e0b`.
- **Paper:** none run (no Paper driver for the chain; the proof is the fake server with the keeper's real `runVisit` plus the
  showcase region copy). The progress-lane rule asks for a Paper PASS before a piece stages; the control session decides whether
  the fake-server chain and the offline region proof stand in, or a Paper driver is written first.

## Draft PIECES.jsonl line (fill the suite summary from the ci2 run named in the agent's report; the sha the line names)

```json
{"run": "siteprep-01", "sha": "<the branch tip: cc3d148d or its docs-only descendant>", "base": "4e559e0b6ddcb1940d5cb201cb9fe010b6ca7796",
 "kind": "building",
 "tests": {"result": "<PASS|FAIL>", "sha": "<sha>", "runner": "npm test", "summary": "npm test via suite-run on ci2 at cc3d148d <n/m>: <failures>"},
 "reviews": [{"engine": "codex", "verdict": "APPROVE", "sha": "cc3d148d...", "reviewer": "codex-exec siteprep-01 r7 APPROVE (code r1-r6 blockers fixed)"},
             {"engine": "claude", "verdict": "APPROVE", "sha": "cc3d148d...", "reviewer": "claude subagent siteprep-01 r7 APPROVE"}],
 "paper": null, "tripwire_extra": null, "owner": "11-04 siteprep-1104",
 "notes": "siteprep-01 on cropfarm-02fix 4e559e0b: a tower/shrine no_site files a request; the keeper prepares the plot; the requester claims it"}
```

## Stacking

- Independent of `sinkfix-03` (`showcase-sinkfix3-on-4e559e0b` 305057d0), which also edits `shop.mjs` and `skills.mjs` (a failed
  siting holds only its own plot). Recommended: stage sinkfix-03 first. Without it, a bot whose last stop was a sink `no_site` has
  every build order held 24 h (SHOP_SITE_RETRY_MS), which also delays the claim of a prepared plot to the bots that did not fail.
- `skills.mjs` conflicts with the fleet line (STATE: the showcase sits behind swimcentre-01 / bagdiet-01); this piece adds to that.

## The read (+60 min, +2 h; the showcase has no control: a mechanism read)

1. `_siteprep` rows: `op=filed` per sink `no_site` row (denominator), then `chosen` / `pending` / `refused`, `prepared`,
   `handed`; `retired` / `expired` / `abandoned` named with their `why`.
2. Cobble placed as fill: `_build project=tidy op=place` rows on cells of `SP*` segments, `block=cobblestone`. Never counted as
   building done.
3. The requester sited after prep: `_sink op=sited` whose `tried` starts `prep=SP<n>`, then that instance's own `_build op=place`
   rows and its `_build_visit outcome=complete`.
4. Positive controls before any zero: the window's rows, bots and span; `_sink op=pick` and `op=no_site`; the tidy's own place rows.
5. Tripwires: deaths (showcase rule), `stuck_on_cell`, in-town walk failures against the 2 h before; H1-H6 = 0 for project=tidy
   (prep placements are on the head record) and for project=shrine|tower.
6. Expected on today's showcase: one shrine request (`apron_low`), prepared at about -69,68,-28 (offline: cut 50, fill 122, seal
   18), Z2 sited and built; the towers need no prep. A second shrine request is refused (offline), refiling after 24 h.
