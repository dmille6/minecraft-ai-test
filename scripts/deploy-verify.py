#!/usr/bin/env python3
"""Did the deploy -- or the teardown -- land on exactly the bots it declared?

This is the IO shell around lib/deployverify.py. Everything decidable lives in that module as pure
functions with cases; this file finds the logs, parses them and prints.

IT REPLACES AN INLINE HEREDOC. deploy-fleet.sh carried this as a python -c inside a command
substitution, which is why it was never tested and why the only thing it could compute was a COUNT
of distinct version strings. A count cannot see identity, and identity is the entire question for a
canary -- see the module docstring in lib/deployverify.py.

WHERE THE LOGS ARE, IN ONE PLACE. The version never appears on stdout, so a journal scrape finds
nothing and reports it as agreement. The evidence is the JSONL skill logs, whose directory comes
from each bot's own LOG_DIR. Getting that wrong is not hypothetical: the verifier read instance
#1's layout (/srv/mcbots/logs/skill-*.jsonl) for the whole of Block 2, matched nothing, and printed
"40 bot(s) have not logged since the restart yet" on every deploy. canary-loop.sh separately
open-codes `/var/log/mcai/$pool-*` for its post-teardown check, which is a third copy of the same
fact. Both now call this.

  deploy-verify.py --since <iso8601Z> [--manifest P] [--live "a b c"] [--log-glob G] [--teardown]

Exit: 0 verified, 1 a finding failed, 2 nothing observed at all (UNKNOWN, not confirmed).
"""
import argparse
import glob as globmod
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))

import canary_manifest                                                    # noqa: E402
import deployverify                                                       # noqa: E402

DEFAULT_MANIFEST = os.environ.get('TRIAL_MANIFEST', '/srv/mcbots/trial-manifest.json')
DEFAULT_HARNESS = os.environ.get('MCAI_HARNESS', '/srv/mcbots/harness')


def log_globs(harness=DEFAULT_HARNESS):
    """Every bot's skill-log glob, from the LOG_DIR each bot's env file declares.

    Falls back to the Block 2 default only when no env file names one, and the fallback is reported
    by the caller rather than used silently -- a verifier that passes when it can see nothing is
    worse than no verifier.
    """
    dirs = set()
    for f in sorted(globmod.glob(os.path.join(harness, 'env', '*.env'))):
        try:
            with open(f) as fh:
                for line in fh:
                    if line.startswith('LOG_DIR='):
                        d = line.split('=', 1)[1].strip()
                        if d:
                            dirs.add(d)
        except OSError:
            continue
    if not dirs:
        return ['/var/log/mcai/*/skill-*.jsonl'], True
    return [os.path.join(d, 'skill-*.jsonl') for d in sorted(dirs)], False


def read_reports(globs, tail=200):
    """(bot, timestamp, version) from the tail of every matching log."""
    rows = []
    for g in globs:
        for path in sorted(globmod.glob(g)):
            try:
                with open(path, 'rb') as fh:
                    lines = fh.readlines()[-tail:]
            except OSError:
                continue
            for raw in lines:
                try:
                    d = json.loads(raw.decode('utf-8', 'replace'))
                except Exception:
                    continue
                v = (d.get('code') or {}).get('version')
                b = (d.get('bot') or {}).get('name')
                ts = d.get('@timestamp')
                if not (v and b and ts):
                    continue
                try:
                    ts = datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
                except Exception:
                    continue
                rows.append((b, ts, v))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', help='ISO8601 restart mark; only later records count')
    ap.add_argument('--manifest', default=DEFAULT_MANIFEST)
    ap.add_argument('--harness', default=DEFAULT_HARNESS)
    ap.add_argument('--live', default='', help='space- or comma-separated active unit names')
    ap.add_argument('--log-glob', action='append', default=[])
    ap.add_argument('--teardown', action='store_true',
                    help='assert the post-teardown state instead: ONE declared build')
    ap.add_argument('--stdin-jsonl', action='store_true', help='read records from stdin instead')
    a = ap.parse_args(argv)

    try:
        with open(a.manifest) as fh:
            man = json.load(fh)
    except Exception as e:
        print(f'   ! cannot read the manifest {a.manifest}: {e}')
        return 2
    try:
        decl = canary_manifest.load(man)
    except canary_manifest.InvalidManifest as e:
        # A manifest this script cannot interpret is not a deploy that succeeded. The whole point of
        # the contract is that an ambiguous declaration stops here rather than downstream.
        print(f'   ! the declaration is INVALID: {e}')
        return 1
    print(f'   * declaration: {decl.describe()}')

    since = None
    if a.since:
        try:
            since = datetime.fromisoformat(a.since.replace('Z', '+00:00'))
        except ValueError:
            print(f'   ! --since {a.since!r} is not an ISO8601 timestamp')
            return 2

    if a.stdin_jsonl:
        rows = []
        for raw in sys.stdin:
            try:
                d = json.loads(raw)
            except Exception:
                continue
            v = (d.get('code') or {}).get('version')
            b = (d.get('bot') or {}).get('name')
            ts = d.get('@timestamp')
            if not (v and b and ts):
                continue
            try:
                rows.append((b, datetime.fromisoformat(str(ts).replace('Z', '+00:00')), v))
            except Exception:
                continue
    else:
        globs = a.log_glob
        fellback = False
        if not globs:
            globs, fellback = log_globs(a.harness)
        if fellback:
            print('   * no env file names a LOG_DIR; using the default layout '
                  '/var/log/mcai/*/skill-*.jsonl')
        rows = read_reports(globs)

    seen = deployverify.latest_per_bot(rows, since=since)
    live = [x for x in a.live.replace(',', ' ').split() if x]

    if a.teardown:
        ok, findings = deployverify.teardown_ok(seen, decl)
    else:
        ok, findings = deployverify.verify(seen, decl, live=live)

    for level, msg in findings:
        mark = {'OK': '   *', 'WARN': '   ~'}.get(level, '   !')
        print(f'{mark} {msg}')

    # MACHINE-READABLE, because a caller two hops away parses this by string.
    # fleet-deploy.sh polls the deploy log for the literal "canary split confirmed:" (and requires
    # the canary sha on that same line) or "all live bots on <sha>", and times out after 30 minutes
    # if neither appears -- that timeout already fired once on a canary that had verified fine.
    # Those lines therefore stay in deploy-fleet.sh, which composes them from this one. Emitting
    # them here instead would put a poller's grep contract inside the verifier.
    print('VERSIONS ' + ' '.join(sorted(set(seen.values()))))
    if ok:
        print('VERIFIED')
    return 0 if ok else (2 if not seen else 1)


if __name__ == '__main__':
    sys.exit(main())
