#!/usr/bin/env python3
"""WorldBackupStale -- alarm when the nightly fleet-world backup stops.

Same design as check-backup.py: the primary metric is the AGE OF THE NEWEST GOOD BACKUP,
read from the NAS itself, so a broken check (NAS unreachable, key gone, path renamed) can
only alarm, never read healthy.

  1. NAS .last-good missing                                  -> WorldBackupMissing
  2. .last-good older than --max-age-h (default 36)          -> WorldBackupStale
  3. newest day marked _OK holds fewer than --expect archives -> WorldBackupIncomplete
  4. the NAS cannot be read                                  -> WorldBackupStale

Output lines match check-backup.py, so a grep for 'BACKUP ALARM' finds both.
Exit 0 healthy, 1 alarm.
"""
import argparse
import os
import subprocess
import sys
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nas', default='mike@10.0.0.5:/volume1/homes/mike/world-backups')
    ap.add_argument('--nas-key', default=os.path.expanduser('~/.ssh/id_esbackup'))
    ap.add_argument('--max-age-h', type=float, default=36.0)
    ap.add_argument('--expect', type=int, default=16)
    a = ap.parse_args()

    alarms, notes = [], []
    tgt, _, path = a.nas.partition(':')
    q = (f"cat '{path}/.last-good' 2>/dev/null || echo NONE; "
         f"d=$(ls -1d '{path}'/20*/_OK 2>/dev/null | sort | tail -1); "
         f"echo \"${{d:-NONE}}\"; "
         f"[ -n \"$d\" ] && ls -1 \"$(dirname \"$d\")\"/*.tar.zst 2>/dev/null | wc -l || echo 0; "
         f"ls -1d '{path}'/20*/_OK 2>/dev/null | wc -l")
    lines = []
    try:
        r = subprocess.run(['ssh', '-i', a.nas_key, '-o', 'BatchMode=yes',
                            '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20',
                            tgt, q], capture_output=True, text=True, timeout=120)
        lines = [x.strip() for x in r.stdout.strip().splitlines()]
        if len(lines) < 4:
            alarms.append(f'WorldBackupStale: the NAS replied with {len(lines)} lines, expected 4 '
                          f'(rc={r.returncode}, stderr={r.stderr.strip()[:120]!r}) -- '
                          f'an unreadable backup is a failed check, not a pass')
    except Exception as e:
        alarms.append(f'WorldBackupStale: cannot reach the NAS ({type(e).__name__}: {e})')

    if len(lines) >= 4:
        ts, newest, n_arch, n_good = lines[0], lines[1], lines[2], lines[3]
        if ts == 'NONE':
            alarms.append('WorldBackupMissing: no .last-good on the NAS -- no world backup has ever completed')
        else:
            try:
                age = (time.time() - time.mktime(time.strptime(ts, '%Y-%m-%dT%H:%M:%SZ'))
                       + time.timezone) / 3600.0
                notes.append(f'world backup age {age:.1f}h')
                if age > a.max_age_h:
                    alarms.append(f'WorldBackupStale: newest good world backup is {age:.1f}h old '
                                  f'(limit {a.max_age_h}h)')
            except ValueError:
                alarms.append(f'WorldBackupStale: unparseable .last-good {ts!r}')
        if newest != 'NONE':
            day = os.path.basename(os.path.dirname(newest))
            notes.append(f'newest {day} holds {n_arch} archives; {n_good} good days')
            if not n_arch.isdigit() or int(n_arch) < a.expect:
                alarms.append(f'WorldBackupIncomplete: {day} holds {n_arch} world archives, '
                              f'expected {a.expect}')

    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    if alarms:
        print(f'{stamp} WORLD BACKUP ALARM ({len(alarms)}):')
        for x in alarms:
            print(f'  !! {x}')
        print(f'  context: {"; ".join(notes) or "none"}')
        return 1
    print(f'{stamp} world backups OK -- {"; ".join(notes)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
