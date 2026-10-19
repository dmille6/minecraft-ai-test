# Fleet world backups — what is kept and how to restore

Set up 2026-10-19 (owner approved ~13:15Z). Live on block2-worlds (10.0.0.30).

## What runs

| What | Where |
|---|---|
| Nightly job | `15 3 * * * /home/mike/bin/world-backup.sh >> /var/log/mcai-monitor/world-backup.log 2>&1` (mike's crontab on 10.0.0.30) |
| Alarm | `25 * * * * /usr/bin/python3 /home/mike/bin/check-world-backup.py >> /var/log/mcai-monitor/backup-alarm.log 2>&1` |
| Archives | `mike@10.0.0.5:/volume1/homes/mike/world-backups/<YYYY-MM-DD>/<world>.tar.zst` |
| Per-day files | `SHA256SUMS`, `MANIFEST.tsv` (bytes, file count, region count, residual, sha256), and `_OK`, which is written only after all 16 archives pass |
| Freshness stamp | `world-backups/.last-good`. The alarm reads this. |
| Local staging | `/srv/world-backup/staging/<world>/` on 10.0.0.30 (root, mode 700). This is a copy of last night's backup. |
| Retention | The newest 7 good days, plus the newest good day of each of the 4 most recent ISO weeks that are older than those 7 |

The job covers the 16 fleet worlds only. It picks them by `server-port` 25570–25585 and refuses to run unless it finds exactly 16. The sandboxes (25599–25602) are never included.

**Contents of each archive.** Each archive holds `<world>/`, which includes `world/` (with `level.dat`, `region/`, `entities/`, `poi/`, `playerdata/`, `data/` and the rest), `world_the_end/`, `server.properties`, `TOWN-PLACED*.json`, `PAPER-BUILD.txt`, the `*.yml` files, `config/`, `plugins/`, and the whitelist and ops files.

**Left out on purpose:** `libraries/`, `versions/`, `cache/`, `logs/`, `crash-reports/`, `paper.jar`, `*.jar.bak`, `world.pre-reseed-*/`, `world*.pre-restore-*/` and `session.lock`. Paper regenerates the first three when it starts. The jar comes from `/srv/block2/template/paper.jar`, and the build number is in `PAPER-BUILD.txt`.

## How the copy stays consistent without touching the server

No RCON is used: no `save-off` and no `save-all`. The job does not restart anything or edit any world.

Each world is copied with rsync in two passes into the staging copy:

1. A full pass, capped at 40 MB/s.
2. A second pass straight away, which re-copies only what changed during pass 1.

A third, dry-run pass then counts the files that changed even during pass 2 and logs that count as `residual=`. rsync writes each file to a temporary name and then renames it, so a staged file is never half-written.

The tarball is built from the staging copy and streamed to the NAS. It is then read back from the NAS and checked:

- the sha256 sent matches the sha256 stored;
- zstd's frame checksum passes;
- `tar -t` lists it cleanly;
- `level.dat` is present;
- the region count and full file list match the staging copy.

**Why not a snapshot.** A ZFS snapshot of `vmdata/vm-201-disk-1` on pve1 would give a better point-in-time copy. But root on pve1 has no route to the NAS or to this VM, and this VM has no key for pve1. Making that work needs a new SSH trust path, and that is an owner decision. The snapshot approach is the upgrade if one is approved.

**Residual risk.** A region file that Paper rewrites during pass 2 can be up to a few seconds out of step with the other files in the same world. The first run measured `residual` 0–2 files per world. A test restore of all 16 worlds decompressed every chunk in every `.mca` file: 316,865 chunks, 0 bad. A corrupted chunk planted as a control was detected.

## Restore one world

A restore changes the world, so it needs the owner's decision. It is for disaster recovery only, never to fix a bot. It also stops one world's server, so stop that pool's bots on 10.0.0.31 first (stagger the restarts, as for any pool).

```bash
# on 10.0.0.30 as mike
W=hive-a; DAY=2026-10-19
NAS="ssh -i ~/.ssh/id_esbackup -o BatchMode=yes mike@10.0.0.5"
D=/volume1/homes/mike/world-backups/$DAY

# 1. verify the archive on the NAS
$NAS "cd $D && sha256sum -c SHA256SUMS" | grep "^$W"

# 2. stop the world's server
sudo systemctl stop block2@$W

# 3. move the current world aside (keep it until the restore is confirmed)
T=$(date -u +%Y%m%dT%H%M%SZ)
sudo mv /srv/block2/$W/world         /srv/block2/$W/world.pre-restore-$T
sudo mv /srv/block2/$W/world_the_end /srv/block2/$W/world_the_end.pre-restore-$T

# 4. extract the world dirs only (add server.properties / TOWN-PLACED.json etc. if those are also lost)
$NAS "cat $D/$W.tar.zst" | zstd -dc | sudo tar -C /srv/block2 --numeric-owner -xpf - $W/world $W/world_the_end
sudo chown -R minecraft:minecraft /srv/block2/$W/world /srv/block2/$W/world_the_end

# 5. start the server and check it
sudo systemctl start block2@$W
sudo tail -f /srv/block2/$W/logs/latest.log    # wait for "Done (...)! For help, type "help""
```

**Rebuilding a whole world directory** (for example on a new VM): extract the full archive with `... | sudo tar -C /srv/block2 --numeric-owner -xpf -`. Then copy `/srv/block2/template/paper.jar` to `/srv/block2/$W/` and run `sudo chown -R minecraft:minecraft /srv/block2/$W`. The `block2@.service` unit uses `WorkingDirectory=/srv/block2/%i`. Do NOT run `place-town.py`: `TOWN-PLACED.json` comes back with the archive, and that is what stops a second town being stamped.

**To test a restore without touching the server:** extract the archive into a temporary directory instead of `/srv/block2`.

## Checks

- Log: `/var/log/mcai-monitor/world-backup.log`. One `ok <world>` line per world, then `good <day>` and `OK`. Any failure is logged as `ALARM:` and that day is not marked good.
- Alarm: `backup-alarm.log` gets `world backups OK -- ...` every hour. It gets `WORLD BACKUP ALARM` when the newest good backup is more than 36 h old (`WorldBackupStale`), when there is none (`WorldBackupMissing`), when the newest good day holds fewer than 16 archives (`WorldBackupIncomplete`), or when the NAS cannot be read. Nothing pages on this log yet. The ES alarm in the same file has the same gap.
- On-demand verify: `$NAS "cd $D && sha256sum -c SHA256SUMS"`.
