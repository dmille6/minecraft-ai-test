#!/usr/bin/env python3
"""
A TIME SERIES OF WHAT EACH POOL BELIEVES.

WHY THIS EXISTS. 26 of 80 bots are permanently immobile, and hive pools freeze
at 55% against 20-30% elsewhere (exact permutation on 16 pool rates,
p = 0.0137). Hive stores hold a median 42 avoid-rules against 18-25, so each
hive bot inherits ~2.3x more prohibitions -- the Zollman mechanism exactly.

But the DIRECTION is unresolved and cannot be resolved from what we keep. A
frozen bot fails ~2,000 times per two hours into a shared store, so freezing may
PRODUCE the rules rather than follow them. Rule `since` timestamps hint
rules-first, but 87% of hive rules are younger than the freezes they would have
to explain.

Everything else needed for that analysis is already in the logs: position,
failures, outcomes and arm are on every record, so they are recoverable
retrospectively. STORE STATE IS NOT. The files are overwritten in place, so
every sample not taken is gone forever. That is the whole job of this script.

WHAT IT IS NOT. It changes nothing and reads nothing the bots write to. If this
process dies the fleet does not notice.

NO-DATA IS NOT ZERO. Every row carries an explicit `status`. A missing store, an
unreadable one and a genuinely empty one are three different facts, and this lab
has shipped a gate that exited 0 on an empty table, a status tool that called
healthy bots stalled, and a counter that could only ever return zero. A row with
`status != "ok"` must never be read as a count of zero.
"""
import argparse, collections, datetime, glob, hashlib, json, os, re, sys

STATE = os.environ.get('MCAI_STATE', '/var/lib/mcai')
OUT = os.environ.get('MCAI_SAMPLES', '/var/log/mcai/_store-samples.jsonl')
SEEN = os.environ.get('MCAI_SEEN', '/var/lib/mcai/_sampler-seen.json')

STORE_RE = re.compile(r'^(lessons|world-facts|board)-(.+)\.json$')


def rule_id(key, entry):
    """Stable identity for a rule, independent of its mutable counters.

    Keyed on the ACTION it prohibits, not on fails/last/where, so a rule that is
    merely re-incremented is the same rule and does not read as a new one. That
    distinction is the entire point: new rules appearing is the exposure
    variable, re-incrementing is the pressure variable.
    """
    return hashlib.sha1(key.encode('utf-8', 'replace')).hexdigest()[:16]


def read_store(path):
    try:
        with open(path) as fh:
            return json.load(fh), 'ok'
    except FileNotFoundError:
        return None, 'missing'
    except json.JSONDecodeError:
        return None, 'parse_error'
    except OSError:
        return None, 'unreadable'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--seen', default=SEEN)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    now = datetime.datetime.now(datetime.timezone.utc)
    ts = now.isoformat()
    try:
        seen = json.load(open(a.seen))
    except Exception:
        seen = {}

    paths = sorted(glob.glob(f'{STATE}/*/*.json'))
    if not paths:
        # LOUD. An empty run is a fault, not a quiet zero.
        row = {'@timestamp': ts, 'status': 'no_stores_found', 'root': STATE}
        print(json.dumps(row))
        if not a.dry_run:
            with open(a.out, 'a') as fh:
                fh.write(json.dumps(row) + '\n')
        return 4

    rows = []
    for path in paths:
        m = STORE_RE.match(os.path.basename(path))
        if not m:
            continue
        kind, owner = m.group(1), m.group(2)
        holder = os.path.basename(os.path.dirname(path))
        pooled = holder.startswith('_pool-')
        # POOL, NOT BOT. A private store is held by one bot but BELONGS to a
        # pool, and the pool is the unit of analysis -- bots inside one share a
        # world and, in hive, a memory. Reading `pool` as `placebo-d-Echo` would
        # silently split every private arm into 20 singleton groups and make the
        # arms incomparable.
        raw = holder[len('_pool-'):] if pooled else owner
        parts = raw.split('-')
        pool = '-'.join(parts[:2]) if len(parts) >= 2 else raw
        arm = parts[0] if parts else None
        bot = None if pooled else owner
        data, status = read_store(path)

        row = {'@timestamp': ts, 'path': path, 'kind': kind, 'holder': holder,
               'pool': pool, 'arm': arm, 'bot': bot, 'pooled': pooled,
               'status': status}
        try:
            row['mtime'] = datetime.datetime.fromtimestamp(
                os.path.getmtime(path), datetime.timezone.utc).isoformat()
            row['bytes'] = os.path.getsize(path)
        except OSError:
            pass

        if status == 'ok':
            avoid = (data or {}).get('avoid') or {}
            worked = (data or {}).get('worked') or {}
            row['avoid_n'] = len(avoid)
            row['worked_n'] = len(worked)
            row['fails_total'] = sum((e or {}).get('fails', 0) for e in avoid.values())
            row['reporters_max'] = max(
                [len((e or {}).get('reporters') or []) for e in avoid.values()] or [0])
            # Rule identity, so "a new prohibition appeared" is distinguishable
            # from "an existing one was hit again".
            ids = {rule_id(k, e) for k, e in avoid.items()}
            prev = set(seen.get(path, []))
            row['avoid_new'] = len(ids - prev)
            row['avoid_gone'] = len(prev - ids)
            row['first_sample'] = path not in seen
            seen[path] = sorted(ids)
        rows.append(row)

    for r in rows:
        print(json.dumps(r))
    if not a.dry_run:
        with open(a.out, 'a') as fh:
            for r in rows:
                fh.write(json.dumps(r) + '\n')
        tmp = a.seen + '.tmp'
        with open(tmp, 'w') as fh:
            json.dump(seen, fh)
        os.replace(tmp, a.seen)

    bad = [r for r in rows if r['status'] != 'ok']
    if bad:
        print(f'# {len(bad)} store(s) unreadable this sample', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
