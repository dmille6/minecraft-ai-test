#!/usr/bin/env python3
"""
Raise when a canary is deployed and unread. See the "Done means read on the
fleet, not merged" rule in CLAUDE.md.

    ./check-open-loop.py                  # exits 1 and prints why, if open
    ./check-open-loop.py --record KEEP    # closes the loop for the deployed sha

Record a verdict only after you have actually read the fleet. INCONCLUSIVE is a
real close; nothing recorded is not.
"""
import argparse, json, os, sys, datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from openloop import open_loop, VERDICTS          # noqa: E402

MANIFEST = os.environ.get('MCAI_MANIFEST', '/etc/mcai/trial-manifest.json')
LEDGER = os.environ.get('MCAI_DECISIONS', '/var/log/mcai/_canary-decisions.jsonl')


def load_manifest(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}                                  # no manifest: no canary
    except Exception:
        return None                                # unreadable: fail closed


def load_decisions(path):
    try:
        out = []
        with open(path, errors='replace') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue                       # one bad line is not a verdict
        return out
    except FileNotFoundError:
        return []                                  # never written: nothing closed
    except Exception:
        return None                                # unreadable: fail closed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--record', choices=VERDICTS,
                    help='close the deployed canary with this verdict')
    ap.add_argument('--note', default='', help='one line on what you read')
    ap.add_argument('--manifest', default=MANIFEST)
    ap.add_argument('--ledger', default=LEDGER)
    a = ap.parse_args()

    manifest = load_manifest(a.manifest)

    if a.record:
        sha = (manifest or {}).get('canary_sha') or ''
        if not sha:
            print('no canary_sha in %s — nothing to close' % a.manifest, file=sys.stderr)
            return 2
        row = {'canary_sha': sha,
               'canary_pool': (manifest or {}).get('canary_pool'),
               'decision': a.record,
               'note': a.note,
               'ts': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        with open(a.ledger, 'a') as fh:
            fh.write(json.dumps(row) + '\n')
        print('recorded %s for %s' % (a.record, sha[:7]))
        return 0

    why = open_loop(manifest, load_decisions(a.ledger))
    if why:
        print('OpenLoop: %s' % why, file=sys.stderr)
        return 1
    print('no open canary — clear to start something new')
    return 0


if __name__ == '__main__':
    sys.exit(main())
