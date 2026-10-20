#!/usr/bin/env python3
"""ON THE SHOWCASE VM, as root (via .30's forced-command key for user showbak): make a CONSISTENT local copy of
everything the nightly backup keeps, for .30 to pull. Design: docs/reports/showcase-2026-10-20.md section 8.

Under the one save-pause lock (rcon.SaveHold, shared with the timelapse) with saving off and flushed:
  /srv/showcase/server/          -> /srv/showcase/backup-stage/showcase/          (world, properties, whitelist)
  /var/lib/mcai/                 -> /srv/showcase/backup-stage/showcase/state/    (bot + shared town state)
  FRAME0.json, town-site.json, releases/*/RELEASE.json, ops/*.jsonl -> .../showcase/meta/
then a dry-run pass counts what changed during the copy (`residual`, expected 0 with saving off). Prints one JSON line.
Exit 0 ok, 1 failed (the pull then refuses to archive).
"""
import json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rcon  # noqa: E402

STAGE = '/srv/showcase/backup-stage/showcase'
EXCL = ['--exclude=/libraries/', '--exclude=/versions/', '--exclude=/cache/', '--exclude=/logs/',
        '--exclude=/crash-reports/', '--exclude=/paper.jar', '--exclude=session.lock']
NICE = ['nice', '-n', '19', 'ionice', '-c3']


def rs(src, dst, extra=(), dry=False):
    cmd = NICE + ['rsync', '-a', '--delete'] + list(extra) + (['--dry-run', '--itemize-changes'] if dry else []) + [src, dst]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(f'rsync {src} rc={p.returncode}: {p.stderr.strip()[:200]}')
    return p.stdout


def main():
    t0 = time.time()
    os.makedirs(f'{STAGE}/state', exist_ok=True)
    os.makedirs(f'{STAGE}/meta', exist_ok=True)
    try:
        with rcon.SaveHold(wait_s=900) as h:
            if not h.held:
                print(json.dumps({'ok': False, 'why': 'save-pause lock held for 15 min by another owner'}))
                return 1
            rs('/srv/showcase/server/', f'{STAGE}/', EXCL + ['--exclude=/state/', '--exclude=/meta/'])
            rs('/var/lib/mcai/', f'{STAGE}/state/')
            residual = sum(1 for l in rs('/srv/showcase/server/', f'{STAGE}/', EXCL + ['--exclude=/state/', '--exclude=/meta/'],
                                         dry=True).splitlines() if l.startswith('>f'))
        metas = ['/srv/showcase/timelapse/FRAME0.json', '/srv/showcase/town-site.json'] + \
            [os.path.join(dp, f) for dp, _, fs in os.walk('/srv/showcase/releases') for f in fs if f == 'RELEASE.json'] + \
            [os.path.join('/srv/showcase/ops', f) for f in os.listdir('/srv/showcase/ops') if f.endswith('.jsonl')]
        for m in metas:
            if os.path.exists(m):
                rel = os.path.relpath(m, '/srv/showcase').replace('/', '__')
                subprocess.run(['cp', '-p', m, f'{STAGE}/meta/{rel}'], check=True)
        if not os.path.exists(f'{STAGE}/world/level.dat'):
            raise RuntimeError('staged copy has no world/level.dat')
        print(json.dumps({'ok': True, 'residual': residual, 'secs': round(time.time() - t0, 1),
                          'meta_files': len(os.listdir(f'{STAGE}/meta'))}))
        return 0
    except Exception as e:
        print(json.dumps({'ok': False, 'why': f'{type(e).__name__}: {str(e)[:200]}'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
