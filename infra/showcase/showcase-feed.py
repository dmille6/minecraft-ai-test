#!/usr/bin/env python3
"""ON THE BENCH BOT HOST (10.0.0.31, ~mike/showcase-feed.py). READ-ONLY. The only thing the showcase VM can run
here: its key sits in ~mike/.ssh/authorized_keys as
    restrict,command="/usr/bin/python3 /home/mike/showcase-feed.py" ssh-ed25519 ... showcase-feed
so it can read this one JSON document and nothing else. It writes nothing, restarts nothing, and takes no lock.

Prints: the trial manifest; the journal rows that decide a release (promoted, owner-direct, recorded, poll-revert,
contained, torn-down); a census (each bench bot's newest skill row: bot, ts, code.version); and ONE control bot's
env file -- a bot outside every declared canary pool whose newest row reports the majority control build -- so the
showcase copies the fleet's policy knobs from a bot verifiably running them.
Design: docs/reports/showcase-2026-10-20.md section 3.
"""
import glob, json, os, sys

MANIFEST = '/srv/mcbots/trial-manifest.json'
JOURNAL = os.path.expanduser('~mike/canary-journal.jsonl')
ENV_DIR = '/srv/mcbots/harness/env'
PHASES = {'promoted', 'owner-direct', 'recorded', 'poll-revert', 'contained', 'torn-down'}


def newest_row(path, chunk=65536):
    """The last complete JSON line of a log file, read from the end (never the whole file)."""
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - chunk))
            lines = f.read().splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        try:
            return json.loads(line)
        except ValueError:
            continue
    return None


def main():
    out = {'feed': 'showcase-feed 1', 'errors': []}
    try:
        out['manifest'] = json.load(open(MANIFEST))
    except (OSError, ValueError) as e:
        out['manifest'], _ = None, out['errors'].append(f'manifest: {e}')
    rows = []
    try:
        for line in open(JOURNAL):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get('phase') in PHASES:
                rows.append({k: r.get(k) for k in ('ts', 'run', 'phase', 'note')})
    except OSError as e:
        out['errors'].append(f'journal: {e}')
    out['journal'] = rows
    census = []
    for d in sorted(glob.glob('/var/log/mcai/*-*/')):
        bot = os.path.basename(d.rstrip('/'))
        r = newest_row(os.path.join(d, f'skill-{bot}.jsonl'))
        if r:
            census.append({'bot': bot, 'ts': r.get('@timestamp') or r.get('ts'),
                           'version': (r.get('code') or {}).get('version')})
    out['census'] = census
    m = out.get('manifest') or {}
    cpools = [p.strip() for p in str(m.get('canary_pool') or '').split(',') if p.strip()]
    ctrl = [c for c in census if c.get('version') and not any(c['bot'].startswith(p + '-') for p in cpools)]
    counts = {}
    for c in ctrl:
        counts[c['version']] = counts.get(c['version'], 0) + 1
    out['control_env'] = None
    if counts:
        major = max(counts, key=counts.get)
        for c in sorted(ctrl, key=lambda c: c['bot']):
            p = os.path.join(ENV_DIR, c['bot'] + '.env')
            if c['version'] == major and c['bot'].startswith('board-') and os.path.isfile(p):
                out['control_env'] = {'bot': c['bot'], 'version': major, 'text': open(p).read()}
                break
    json.dump(out, sys.stdout)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
