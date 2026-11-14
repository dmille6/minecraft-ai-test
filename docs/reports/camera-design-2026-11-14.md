# Cameras and timelapses: design for the two-world setup (2026-11-14)

Owner, 2026-11-14: cameras "from the very first moment the world is created to monitor and showcase the world building";
some that "focus on whatever project or projects are going on, but once those projects are complete we can stop those
timelapses since nothing will change"; "some top down and isometric, some 4k really beautiful rendering timelapses so i
can showcase this process". Part of the consolidation plan: [`docs/decisions/consolidation-2026-11-14.md`](../decisions/consolidation-2026-11-14.md).

This is a design. Nothing in it is built or installed.

## Summary

**What the owner gets**
1. **A world recorder.** Every world keeps a copy of itself every 15 minutes from before the first bot joins. Any camera,
   angle or resolution can be rendered later for any moment, including views nobody thought of at the time.
2. **A start gate.** A world's bots cannot start until its recorder has taken frame zero. A missed first day cannot happen
   again by forgetting.
3. **Four always-on world cameras:** top-down, true isometric, a wide angled view, and a 4K hero view.
4. **Project cameras that manage themselves.** A camera appears when a project starts, films while it is open, and at
   completion takes a final frame set, one 4K beauty render and cuts the project's clip. Then it stops.
5. **Beauty renders:** the nightly 4K still that exists today, plus one at every project completion, plus a job that
   renders a 4K sequence for any stretch of the record on request.

**What it costs**
- Recorder: an estimated 0.1 to 0.6 GB a day per world before thinning (measured basis in section 3.1). The NAS has 45 TB free.
- Pictures: less than today. On 11-13 the showcase wrote 4.8 GB of frames, and 2.1 GB of that (45%) came from nine cameras
  whose projects are complete or retired.
- Server load: lower once rendering moves off the world VMs. Today the capture may use up to 690 s of every 900 s slot on
  the showcase VM itself.

**Build steps, in order**

| Step | What | Size | Needed by |
|---|---|---|---|
| B1 | World recorder and the start gate | medium | before the test world is born (plan step C3) |
| B2 | Project cameras from the project records, stopping at completion; retire the nine finished ones now | medium | any time |
| B3 | True isometric view and the standard four-camera set for a new world | small | with B1 |
| B4 | Rendering and capture move to the ops VM | medium | before the worlds host is retired (C4) |
| B5 | Completion beauty render and the render-from-the-record job | medium | after B1 |

**Owner decisions, 2026-11-14 ~17:45Z ("for all three questions do what you recommend or think is best")**
1. **Rehearsal-0 is being recorded.** `infra/freshworld/worldrec.sh`, installed on VM 118 as `~/worldrec/worldrec.sh`, in
   mike's crontab every 15 minutes since 17:47Z. It reads the world's region files and `level.dat` and writes only under
   `~/worldrec/snaps` (unchanged files are hard links); no save hold, no command to the server. First copy: 36 files in
   1 s; the second, 20 s later, copied 3 changed files. It stops itself after 2026-11-16T15:00Z or below 25 GB free.
   Owed after the run: move the snapshot tree to the NAS, remove the crontab line, render frame zero from the day-0
   snapshot. Not recorded: 14:46Z to 17:47Z.
2. **The nine cameras on finished projects are off** on the showcase since 17:48:36Z (`"off": true` in `tl.conf`, a switch
   the capture already supports; backup `tl.conf.bak-20261114-finishedcams`; journalled in the showcase ops journal). Ten
   cameras stay on. No frame or video was deleted.
3. **Retention for the record:** every 15 minutes for 14 days, hourly to 90 days, daily forever.

## 1. What exists today (read 11-14 on the showcase VM)

- **Mechanism:** every 15 minutes, with saving held, the world is copied to a mirror; the BlueMap command-line renderer
  updates a map from the mirror; a headless browser takes one picture per camera. Events (a project step) trigger extra
  frames on a 2-minute timer. Config: `/srv/showcase/timelapse/tl.conf`.
- **19 cameras:**
  - World views: `topdown` and `town` (flat, orthographic), `angled`, `iso`, `expeditions`, `grounds`, `patina`.
  - 4K: `hero4k` (town) and `project4k` (follows the active project), both 1920x1080 at pixel ratio 2, every 30 minutes.
  - Event camera: `projectev`, follows project events only.
  - Nine fixed project cameras, each tied to project names: `workshop`, `house1`, `ziggurat`, `paths`, `wall`,
    `treefarm`, `storehouse`, `copperhall`, `stair`.
- **Cadence rule that exists:** each camera has `interval_min` (15 or 30) and `idle_min` (60 or 240), with
  `active_hours: 3`. So a slow-down when idle exists in the config.
- **Volume on 11-13:** 4,786 MB in 2,266 frames. Per camera: hero4k 710 MB, project4k 455, angled 383, treefarm 331,
  town 326, grounds 317, wall 309, paths 306, copperhall 282, house1 207, stair 203, ziggurat 187, iso 186, storehouse 182,
  expeditions 141, workshop 139, topdown 81, projectev 34, patina 6.
- **On the worlds host (10.0.0.30), from its crontab:** the video builds (`tl2run.py`: daily, before/after, projects every
  20 minutes, beauty, weekly film), the nightly Chunky beauty render, the BlueMap timelapse cycle, and the pull of frames
  to the NAS.
- **Local disk:** `/srv/showcase/timelapse` is 50 GB. The NAS side was not measured.

## 2. Where this falls short of the request

- **Nothing records a new world.** Rehearsal-0 was started 11-14 14:46Z with no capture, no map plugin and no block
  history. Only its day-0 snapshot exists. The 11-10 camera plan for fresh worlds was never installed.
- **Finished projects are still filmed at near full rate.** On 11-13 the nine fixed project cameras took 96 to 194 frames
  each. Their projects (shop, house1, monument, paths, wall, storehouse, hall, shaft) are `complete` in the town records
  and treefarm is `retired`. The idle slow-down did not slow them because `cam_active()` in
  `infra/showcase/tl_showcase.py` counts a changed frame as activity: a bot walking past or the light changing keeps a
  finished project's camera "active". Section 3.3 replaces that with the project's recorded state.
- **The isometric camera is a perspective view** at a 45 degree turn, not a true (orthographic) isometric.
- **Project cameras are made by hand,** one config entry at a time (the config has 30-odd dated backups from adding them).
- **The pipeline lives on two VMs,** one of which the plan retires, and renders on the same VM the bots play on.

## 3. Design

### 3.1 The world recorder

Keep what the capture already produces. The consistent mirror made every 15 minutes is thrown away today; instead each
one is added to a block-deduplicating store on the NAS, where an unchanged part of a file costs nothing.

- **Measured basis.** The showcase's world is 180 MB in 36 region files; 4 of them (39 MB, the town) change all day.
  Comparing the 15:50:17Z save with the live files 108 minutes later, in 4 KiB blocks: 1,605 of 44,008 blocks differed,
  **6.6 MB of 180 MB** (591 of 5,120 chunks rewritten). If every 15-minute copy differed by that much it would be about
  0.6 GB a day; if change simply accumulates it is about 0.1 GB a day. One comparison is not a rate: B1 starts by
  measuring a real day.
- **Tool:** an existing deduplicating backup tool (restic or borg), not home-made code. Neither is confirmed installed.
- **Also from minute zero:** the block-history plugin (CoreProtect), which the showcase has and rehearsal-0 does not. With
  a snapshot every 15 minutes plus the block log, the world can be reconstructed for any instant between snapshots.
- **Retention:** every 15 minutes for 14 days, hourly to 90 days, daily forever (owner decision 3).
- **The gate:** the script that starts a world's bots refuses unless frame zero is in the store and the recorder's timer
  is active. Frame zero is taken of the generated world before the first bot joins. This is a mechanical check, like the
  showcase's one-change-at-a-time gate, not a rule to remember.

### 3.2 Always-on world cameras

Four per world, from frame zero, every 15 minutes while bots are active and hourly when the world is idle:

| Camera | View | Size |
|---|---|---|
| `topdown` | straight down, orthographic | 1920x1080 |
| `iso` | true isometric: orthographic, turned 45 degrees, tilted about 55 degrees | 1440x1440 |
| `angled` | wide perspective of the whole site | 1920x1080 |
| `hero4k` | the beauty angle | 3840x2160 |

The camera framing grows with the town: it is fitted to the recorded build cells plus a margin, re-fitted once a day, so
a camera set on day zero is not too tight on day thirty. True isometric needs one test frame to confirm the map renderer
draws orthographic at a tilt cleanly; if it does not, the isometric view is rendered by the beauty renderer instead.

### 3.3 Project cameras

One rule replaces the hand-made entries. The rule reads the town's project records (the same `state` field the capsule
scorecard reads):

- **Start:** a project record appears with state `plan` or `open`. A camera is created, fitted to the project's recorded
  box, at the isometric angle. The first frame is the empty site.
- **Film:** every 15 minutes while the state is `open`, plus the event frames that exist today.
- **Finish:** when the state becomes `complete` (or `retired`): a final frame from each angle, one 4K beauty render, and
  the project's clip is cut and published. Then the camera is removed from the active set. Its frames and clip are kept.
- **Reopen:** if a later record puts the project back to `open` (an extension, a repair), the camera returns and the clip
  gets a second part.

Applied to the showcase today this would run cameras for the 7 open projects and none for the 23 complete ones.

### 3.4 Beauty renders

- Kept: the nightly 4K golden-hour still (Chunky).
- New: one 4K still per project completion (3.3).
- New: a render-from-the-record job. Given a world, a camera and a time range, it restores each snapshot in turn to a
  scratch folder and renders it. This is how a 4K beauty timelapse of any stretch gets made, at any cadence, after the
  fact. The time per 4K frame was not measured; B5 measures it before promising a film length.

### 3.5 Where it runs

- **World VMs** (test world, showcase): make the mirror under the save hold and send the snapshot. Nothing else.
- **Ops VM:** the store's index, the map renders, the browser capture, the beauty renders, the video builds, the pull to
  the NAS. One pipeline serves both worlds. This takes the capture's CPU off the VMs the bots play on and removes the
  jobs from the worlds host before it is retired.

### 3.6 Pictures: retention

Frames at full cadence for 30 days, then hourly; clips and films forever. The record (3.1) is what makes thinning safe:
a thinned stretch can be rendered again.

## 4. Rehearsal-0

- **Recoverable now:** frame zero, from `/srv/rehearsal/snapshots/day0-fw-s12.tar.zst`. Whether nightly copies of that
  world exist was not checked (nothing was run on that VM for this design).
- **Not recoverable:** the hours since 14:46Z, and block-by-block history for the whole run (no block-history plugin; adding
  one needs a server restart, which a nobody-helping run should not get).
- **Option, owner decision 1:** pull a copy of its world files every 15 minutes from another host over read-only rsync,
  without a save hold. Cost on the VM: reading a few tens of MB every 15 minutes. Risk: a copy taken mid-save can hold a
  half-written chunk, which shows as one missing chunk in one frame. It changes nothing in the world. The run ends
  11-16 14:46Z, so this is worth doing today or not at all.

## 5. Not confirmed

- Whether restic or borg is installed anywhere, and the NAS-side frame inventory and size.
- The time for one 4K beauty frame, and for a full map render of a restored snapshot.
- Orthographic rendering at a tilt in the installed map renderer.
