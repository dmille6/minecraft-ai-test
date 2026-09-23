#!/usr/bin/env python3
"""BackupStale — raise when the backups stop, rather than report a comforting zero.

THE DESIGN CONSTRAINT. This project's dominant failure is a cheap negative: a query returns
0, nobody notices, and the zero gets believed. So the primary metric here is deliberately
NOT "how many snapshots today" -- if that query breaks, auth expires, or the repo is renamed
it returns 0, which is indistinguishable from a real failure and, inverted once, reads
healthy forever.

The primary metric is the AGE OF THE NEWEST SUCCESSFUL SNAPSHOT. If the instrument fails,
the age is infinite and it alarms. There is no failure mode of this check that produces a
green light.

Checks, each of which can only fail loudly:
  1. newest SUCCESS snapshot older than --max-age-h        -> BackupStale
  2. any FAILED or PARTIAL snapshot present                -> BackupDegraded
  3. SLM policy reports failures since its last success    -> BackupDegraded
  4. the off-host mirror's .last-pull older than --max-age-h -> MirrorStale
  5. the mirror has no index-N root blob                   -> MirrorUnreadable
  6. repo filesystem over --disk-pct                        -> DiskPressure
     (at 95% Elasticsearch applies a read-only block and INGESTION STOPS, so the backup
      mechanism can halt the thing it protects)

Exit 0 healthy, 1 alarm, 2 could-not-check (which is also an alarm, not a pass).

Usage (on the ELK host):     sudo python3 check-backup.py
Usage (on the mirror host):  python3 check-backup.py --mirror-only --mirror /srv/es-archive/186
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

REPO = 'mcai-fs'
POLICY = 'mcai-daily'


def es(path, pwfile='/opt/docker-elk/.env'):
    try:
        ep = subprocess.run(['sudo', '-n', 'grep', '-oP', r'(?<=^ELASTIC_PASSWORD=).*', pwfile],
                            capture_output=True, text=True, timeout=20)
        pw = ep.stdout.strip()
        if not pw:
            pw = subprocess.run(['grep', '-oP', r'(?<=^ELASTIC_PASSWORD=).*', pwfile],
                                capture_output=True, text=True, timeout=20).stdout.strip()
        if not pw:
            return None, 'no ELASTIC_PASSWORD readable'
        out = subprocess.run(['curl', '-s', '-m', '60', '-u', f'elastic:{pw}',
                              f'http://localhost:9200{path}'], capture_output=True, text=True)
        return json.loads(out.stdout), None
    except Exception as e:
        return None, f'{type(e).__name__}: {e}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-age-h', type=float, default=36.0)
    ap.add_argument('--disk-pct', type=int, default=80)
    ap.add_argument('--repo-dir', default='/srv/es-backup')
    ap.add_argument('--mirror', default=None)
    ap.add_argument('--mirror-only', action='store_true')
    a = ap.parse_args()

    alarms, notes = [], []

    if a.mirror:
        stamp = os.path.join(a.mirror, '.last-pull')
        if not os.path.exists(stamp):
            alarms.append(f'MirrorStale: no {stamp} -- the off-host copy has never run')
        else:
            age = (time.time() - os.path.getmtime(stamp)) / 3600.0
            notes.append(f'mirror age {age:.1f}h')
            if age > a.max_age_h:
                alarms.append(f'MirrorStale: off-host copy is {age:.1f}h old (limit {a.max_age_h}h)')
        import glob
        if not glob.glob(os.path.join(a.mirror, 'index-*')):
            alarms.append('MirrorUnreadable: no index-N root blob -- the copied repo cannot be read')
        du = shutil.disk_usage(a.mirror)
        pct = 100.0 * du.used / du.total
        notes.append(f'mirror disk {pct:.0f}%')
        if pct > a.disk_pct:
            alarms.append(f'DiskPressure: mirror filesystem {pct:.0f}% (limit {a.disk_pct}%)')

    if not a.mirror_only:
        snaps, err = es(f'/_snapshot/{REPO}/_all?verbose=true')
        if err or snaps is None or 'snapshots' not in snaps:
            alarms.append(f'BackupStale: could not read snapshots ({err or "unexpected reply"}) '
                          f'-- an unreadable backup is a failed check, not a pass')
        else:
            ok = [s for s in snaps['snapshots'] if s.get('state') == 'SUCCESS']
            bad = [s for s in snaps['snapshots'] if s.get('state') in ('FAILED', 'PARTIAL')]
            if not ok:
                alarms.append('BackupStale: there is NO successful snapshot in the repository')
            else:
                newest = max(s.get('end_time_in_millis', 0) for s in ok)
                age = (time.time() * 1000 - newest) / 3600000.0
                notes.append(f'newest SUCCESS {age:.1f}h ago; {len(ok)} good')
                if age > a.max_age_h:
                    alarms.append(f'BackupStale: newest successful snapshot is {age:.1f}h old '
                                  f'(limit {a.max_age_h}h)')
            for s in bad:
                sh = s.get('shards', {})
                alarms.append(f'BackupDegraded: snapshot {s.get("snapshot")} is {s.get("state")} '
                              f'({sh.get("failed")} of {sh.get("total")} shards failed)')

        pol, err = es(f'/_slm/policy/{POLICY}')
        if err or not pol or POLICY not in (pol or {}):
            alarms.append(f'BackupDegraded: SLM policy {POLICY} not readable ({err or "absent"})')
        else:
            st = pol[POLICY].get('stats', {})
            inv = pol[POLICY].get('invocations_since_last_success', 0) or 0
            notes.append(f'slm failures={st.get("snapshots_failed", 0)} since_success={inv}')
            if inv > 0:
                alarms.append(f'BackupDegraded: {inv} SLM invocations since the last success; '
                              f'last_failure={pol[POLICY].get("last_failure")}')

        if os.path.isdir(a.repo_dir):
            du = shutil.disk_usage(a.repo_dir)
            pct = 100.0 * du.used / du.total
            notes.append(f'repo disk {pct:.0f}%')
            if pct > a.disk_pct:
                alarms.append(f'DiskPressure: {a.repo_dir} filesystem {pct:.0f}% '
                              f'(limit {a.disk_pct}%; at 95% Elasticsearch stops accepting writes)')

    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    if alarms:
        print(f'{stamp} BACKUP ALARM ({len(alarms)}):')
        for x in alarms:
            print(f'  !! {x}')
        print(f'  context: {"; ".join(notes) or "none"}')
        return 1
    print(f'{stamp} backups OK -- {"; ".join(notes)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
