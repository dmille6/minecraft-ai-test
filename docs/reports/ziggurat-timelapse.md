# Ziggurat timelapse pipeline (2026-10-15)

A fixed-camera timelapse of each shared world's ziggurat site. Every 2 hours the world host
copies the site's region files read-only, renders them with BlueMap into a private map, takes a
1920x1080 screenshot from the same camera, and keeps the PNG. `tl_assemble.sh` turns a world's
frames into an MP4 and a GIF with the UTC time stamped on each frame.

Owner approval (10-15): the pipeline, and the installs ("yes, lets do it" to ffmpeg and a
headless Chromium via Puppeteer).

It does not touch bot code, the Paper servers, `/srv/block2`, or the live BlueMap in
`~/bluemap` (port 8100). Everything lives in `~/bluemap-tl` and `/var/tmp/timelapse` on
10.0.0.30. Source: `infra/timelapse/`.

## What was installed on 10.0.0.30

- **apt**, 158 new packages, nothing upgraded or removed (simulated first; the dpkg lists are in
  `~/pkgs-before-timelapse.txt` and `~/pkgs-after-timelapse.txt`). Run with
  `NEEDRESTART_SUSPEND=1`, so no service was restarted. All 20 `block2*` servers stayed up.
  - `ffmpeg` 7:6.1.1-3ubuntu5 (Ubuntu noble)
  - `nodejs` 18.19.1+dfsg-6ubuntu5 (no apt `npm`: it pulls about 350 more `node-*` packages)
  - `fonts-dejavu-core`, used by the date stamp
  - Chrome runtime libraries: `libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0
    libcairo2 libasound2t64 libxshmfence1`. `ldd` on the Chrome binary shows nothing missing.
- **Puppeteer 23.11.1**, the last major version that supports Node 18 (24+ needs Node 22).
  It is in `~/bluemap-tl/capture/node_modules`, and its Chrome 131.0.6778.204 plus
  chrome-headless-shell are in `~/bluemap-tl/capture/.cache` (581 MB). The npm tree was fetched
  on the controller and copied over, then `node node_modules/puppeteer/install.mjs` downloaded
  Chrome on the host. Nothing is installed globally.
- **BlueMap**: no new download. `setup.sh` copies the live `bluemap-cli.jar` (5.16) and the
  cached `minecraft-client-26.3.jar` into `~/bluemap-tl`. That pins the series to one renderer.

## Layout

```
~/bluemap-tl/                       (the live ~/bluemap is untouched)
  sites.json                        the config: world -> site box, camera
  bin/tl.py                         snapshot | frame | report
  bin/tl_cycle.sh                   cron entry: snapshot, then frame (flock, never stacked)
  bin/tl_assemble.sh                frames -> MP4 + GIF with the UTC stamp
  capture/capture.mjs               Puppeteer fixed-camera screenshot
  config/                           private BlueMap config; webserver 127.0.0.1:8101, only up during a capture
  bluemap-cli.jar, data/, web/, logs/
/var/tmp/timelapse/
  snapshots/<world>/<YYYYmmddTHHMMZ>/{level.dat, region/r.X.Z.mca, COMPLETE}
  frames/<world>/<YYYYmmddTHHMMZ>.png
  video/<world>.mp4, <world>.gif
  logs/tl.log, logs/cycle.log
```

## Commands (on 10.0.0.30 as mike)

```bash
# install / update from a checkout (idempotent; keeps an existing sites.json)
scp -r infra/timelapse mike@10.0.0.30:/tmp/tl-src && ssh mike@10.0.0.30 bash /tmp/tl-src/setup.sh

python3 ~/bluemap-tl/bin/tl.py snapshot                 # all sites; --world W to limit
python3 ~/bluemap-tl/bin/tl.py frame                    # latest snapshot per world, if it has no frame yet
python3 ~/bluemap-tl/bin/tl.py frame --all-missing      # backfill every snapshot without a frame
python3 ~/bluemap-tl/bin/tl.py frame --world hive-c --stamp 20261015T0516Z --redo
python3 ~/bluemap-tl/bin/tl.py report                   # counts, sizes, free disk
~/bluemap-tl/bin/tl_assemble.sh hive-c [--from 20261016T0000Z] [--to ...]
```

## Cron

Installed in mike's crontab on 10.0.0.30 at 2026-10-15 05:56Z. The first scheduled run is 06:07Z.

```
7 */2 * * * /home/mike/bluemap-tl/bin/tl_cycle.sh
```

The cycle runs at minute 7 of every even UTC hour. To change the interval, edit the hour field,
for example `7 * * * *` for hourly. A cycle takes about 8 minutes for 12 worlds: the snapshot
takes 2 s, one BlueMap pass about 1 min, and the frames about 33 s each because WebGL runs in
software (SwiftShader) and the host has no GPU. A cycle that overruns the next one is skipped,
not stacked (`flock`). `tl.py frame` also holds its own lock, so a manual render and the cron
render never share the webroot or port 8101. This was tested: a run while the lock is held logs
`frame SKIP`. Everything runs under `nice -n 19 ionice -c3`. Memory use is BlueMap
render `-Xmx3G`, then the webserver `-Xmx1G` and Chrome (~1 GB) during the capture. The host
had 13 GB available.

## Snapshot job (`tl.py snapshot`)

- For each site it copies only the region files that intersect the site box plus `region_pad`
  (16). They are copied with `rsync` from `/srv/block2/<world>/world/region`, and `level.dat` is
  copied with `sudo -n cat`, because it is mode 600 and owned by minecraft. The source is only
  ever read.
- `--link-dest` points at the previous snapshot, so an unchanged region file costs a hard link,
  not a copy. rsync runs twice: the second pass re-copies any region the server wrote to during
  the first.
- **Disk guard.** If `/var/tmp/timelapse` has less than `min_free_gb` (50) free, it copies
  nothing, logs `snapshot STOP`, and exits 2. The cycle then stops before rendering. This was
  tested by forcing the threshold to 99999: rc=2, nothing copied.
- **Retention.** A snapshot older than `snapshot_keep_days` (14) is deleted only once its frame
  exists. The newest snapshot is always kept. Frames are never pruned automatically.
- **Torn reads.** The servers are not paused (no `save-off`; we never touch them), so a chunk
  being written during the copy can be stale or unreadable. BlueMap skips such a chunk. The next
  frame, 2 h later, will normally have it.

## Render and frame (`tl.py frame`)

1. It writes `~/bluemap-tl/config/maps/<id>.conf` with the world set to the snapshot dir and the
   `render-mask` set to the site box. `min-y` is `y - slab_below` (24), so the frame shows the
   surface and the build instead of 130 blocks of stone wall. The visual settings match the live
   maps. There are no markers.
2. It deletes that map's old tiles and runs `bluemap-cli -r -f -m <ids>`. One pass covers every
   world with work.
3. It deletes the lowres tile levels (`tiles/1..n`). Lowres is a heightmap mesh that ignores
   `min-y` and drew green "legs" hanging under the slab. Every visible tile is hires at this
   camera distance anyway.
4. It starts the private webserver on 127.0.0.1:8101 and runs `capture.mjs`, which opens
   `http://127.0.0.1:8101/#<id>:x:y:z:distance:rotation:angle:0:0:perspective` and hides `#app`
   (all UI: control bar, compass, zoom buttons). It then sets the camera FOV to 35° (BlueMap's
   default of 75° gives a fisheye near edge), waits for the network to go idle plus 6 s, and
   takes the screenshot. If the FOV fails to set or drifts, the frame fails. Then it stops the
   webserver.

The camera comes entirely from `sites.json`, so every frame of a series uses the same view.
The settings are an angle of 45° from vertical, rotation 0, and distance = `half x 3.8`. The
target is placed `0.3 x half` beyond the centre, away from the camera. This centres the slab:
with a centred target, the frame had an empty band at the bottom. BlueMap snaps the target's y to
the terrain, so `y` in the hash is nominal. Frame the shot with `distance` and `aim_beyond`
instead.

## Assemble (`tl_assemble.sh`)

The script stamps `<world>  YYYY-MM-DD HH:MM UTC`, taken from each frame's filename, in the
bottom-right corner. It holds the last frame for 2 s and writes:

- `video/<world>.mp4`: H.264 (libx264, crf 20, yuv420p, faststart), 15 fps, 1920x1080.
- `video/<world>.gif`: 960 px wide, 10 fps, 128-colour palette.

Tested on the 2-frame series of all 12 worlds. ffprobe on board-a reads h264, 1920x1080, 15/1
and 32 frames. Each MP4 is 450-650 KB and each GIF 180-250 KB. The stamp is legible. The
outputs are in `/var/tmp/timelapse/video/`.

## Baseline (2026-10-15)

Two snapshots were taken of all 12 shared worlds, with home ±128 as the box: `20261015T0516Z`
(the baseline) and `20261015T0530Z` (the first run of `tl_cycle.sh`). Each has a frame per
world in `/var/tmp/timelapse/frames/<world>/`. A labelled 4x3 contact sheet of the baseline is
at `/var/tmp/timelapse/baseline-montage-20261015T0516Z.png`. Every frame was checked by eye: a clean terrain
slab with no UI, the bot-built paths visible, and a different image for each world even where
worlds share a home.

| Per snapshot (12 worlds, home ±128) | Size |
|---|---|
| Logical | 191 MB (1 region per world; 2 for placebo-a/b/d; 4 for hive-c, hive-d) |
| New on disk at the second snapshot, 14 min later | 152 MB (the rest were hard links) |
| One frame (PNG, 1920x1080) | 1.5-1.8 MB |

## Storage math

- **Snapshots.** The region holding home is rewritten at nearly every save, so expect about
  150 MB of new data per cycle: 12 cycles/day is ~1.8 GB/day, and 14-day retention holds a
  steady state of ~25 GB. A ziggurat box (half 64 + pad 16) usually needs one region per world,
  which is about 10 MB per world per cycle and gives a similar total.
- **Frames.** 12 worlds x 12/day x ~1.7 MB is ~250 MB/day, or ~7.5 GB per 30 days. They are
  never pruned.
- **Video.** Each MP4 is a few MB per week of frames, and each GIF somewhat more.
- **Total.** At 347 GB free and a 50 GB guard, that is many months of runway. The guard stops
  the job long before it matters.

## Pointing it at the real ziggurat sites

When the ziggurat agent's stage-1 offline check (Z0, `docs/reports/ziggurat-mineshaft-2026-10-15.md`)
names a site centre and base y for each world:

1. **Archive the home-framed series**, so frames with two different cameras never end up in one
   video:
   `mv /var/tmp/timelapse/frames/<world> /var/tmp/timelapse/frames/<world>.home-baseline`
2. **Edit `~/bluemap-tl/sites.json`** and the repo copy `infra/timelapse/sites.json`, for example:
   `"hive-c": {"center": [SX, SZ], "half": 64, "y": BASE_Y, "min_y": BASE_Y - 12}`.
   The ziggurat is 48 wide (half 24), and half 64 keeps the surroundings and the bots' work area
   in frame. Optional per-site keys are `distance`, `aim_beyond` and `rotation_deg`. A rotation of
   45 should show two faces of the pyramid, which reads better than square-on. Only rotation 0
   has been checked by eye. The `aim_beyond` direction for any other rotation is computed but
   unverified, so look at the frame.
3. **Run one cycle by hand and look at the frames**:
   `python3 ~/bluemap-tl/bin/tl.py snapshot && python3 ~/bluemap-tl/bin/tl.py frame`.
   Tune each site and re-shoot that frame with
   `tl.py frame --world W --stamp <stamp> --redo` until it is right. **Then stop changing the
   camera.** Every edit to a site's camera starts a new series.
4. Delete the site entries of worlds where Z0 says the lane is off, and their frames stop. Keep
   the archived baseline frames as the "before" shot.

## Operator notes

- The private webserver binds 127.0.0.1:8101 and only runs during a capture. If a frame logs
  `port 8101 already in use`, find the stray process with `pgrep -af 'bluemap-tl.*-w'`.
- Chrome runs with `--no-sandbox`. Ubuntu 24.04 blocks unprivileged user namespaces
  (`apparmor_restrict_unprivileged_userns=1`), and the only page it loads is our own
  localhost map.
- Logs are in `/var/tmp/timelapse/logs/{tl.log,cycle.log}` and
  `~/bluemap-tl/logs/{render.log,webserver.log}`.
- To remove everything: delete the crontab line, then
  `rm -rf ~/bluemap-tl /var/tmp/timelapse`. To remove the packages:
  `comm -13 ~/pkgs-before-timelapse.txt ~/pkgs-after-timelapse.txt` lists exactly what to purge.
