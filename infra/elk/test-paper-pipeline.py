#!/usr/bin/env python3
"""Behaviour test for the mcai-paper ingest pipeline. Run on the ELK host.

WHY THIS EXISTS. The pipeline is the only thing standing between 16 Paper servers'
logs and a queryable archive, and every way it can fail is silent:

  - `mcai-mc-*` is `dynamic: false`, so a field the pipeline emits that the template
    does not map is accepted, stored in _source, and is NOT aggregatable. The
    document count looks perfect and the field cannot be read. Nothing errors.
  - every grok in the pipeline is `ignore_failure: true` (it must be -- most lines
    match no pattern), so a grok that matches NOTHING is indistinguishable from a
    grok that was never meant to fire.

So this test asserts BEHAVIOUR on real log lines, and it carries mutants, because
a pipeline test that has never been seen to fail is not a test.

The corpus in fixtures/paper-log-corpus.txt is 268 REAL lines pulled from
/srv/block2/*/logs/*.gz on 10.0.0.30 -- not hand-written examples. That matters:
the hand-written version of this test passed while the real one failed. Paper
writes the `moved too quickly` delta in SCIENTIFIC NOTATION
(`3.3454718277425854E-4`), which `%{NUMBER}` does not match, so 10 of 15 real
lines silently lost their player and their delta. Mutant 2 pins that.

Usage:  sudo ./test-paper-pipeline.py          # on 10.0.0.186
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.join(HERE, 'pipeline-mcai-paper.json')
CORPUS = os.path.join(HERE, 'fixtures', 'paper-log-corpus.txt')
ES = os.environ.get('MCAI_ES_URL', 'http://localhost:9200')
ENV_FILE = os.environ.get('MCAI_ELK_ENV', '/opt/docker-elk/.env')

WORLDS = [f'{p}-{s}' for p in ('board', 'hive', 'isolated', 'placebo') for s in 'abcd']

# The retired instance #1 ships from a path OUTSIDE /srv/block2. Its documents must
# come through with NO mc.world rather than a wrong one -- this is the negative
# control for the world grok, and it is the reason the grok is anchored on the
# block2 prefix instead of just taking the second-to-last path segment.
NEG_CONTROL = {
    'message': '[06:04:25] [ForkJoinPool.commonPool-worker-1/INFO]: '
               '[squaremap] squaremap is 6 version(s) out of date.',
    'path': '/srv/minecraft/server/logs/latest.log',
}

# Events for which a player name is the whole point. If any of these classifies
# without an mc.player, the row is useless for per-bot attribution.
NEEDS_PLAYER = {'moved_wrongly', 'moved_too_quickly', 'floating_kick',
                'death', 'keepalive_kick', 'joined', 'left'}


def _password():
    with open(ENV_FILE) as fh:
        for line in fh:
            if line.startswith('ELASTIC_PASSWORD='):
                return line.split('=', 1)[1].strip()
    raise SystemExit(f'no ELASTIC_PASSWORD in {ENV_FILE}')


def simulate(pipeline, docs):
    body = json.dumps({'pipeline': pipeline, 'docs': docs})
    out = subprocess.run(
        ['curl', '-s', '-m', '120', '-u', f'elastic:{_password()}',
         '-H', 'Content-Type: application/json',
         '--data-binary', '@-', f'{ES}/_ingest/pipeline/_simulate'],
        input=body, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f'curl failed: {out.stderr[:300]}')
    d = json.loads(out.stdout)
    if 'error' in d:
        raise SystemExit('pipeline rejected: ' + json.dumps(d['error'])[:600])
    return d['docs']


def build_docs():
    lines = [l.rstrip('\n') for l in open(CORPUS) if l.strip()]
    docs = []
    for i, line in enumerate(lines):
        w = WORLDS[i % len(WORLDS)]
        docs.append({'_source': {
            'message': line,
            'host': {'name': 'block2-worlds'},
            'log': {'file': {'path': f'/srv/block2/{w}/logs/latest.log'}},
            '_expect_world': w}})
    docs.append({'_source': {
        'message': NEG_CONTROL['message'], 'host': {'name': 'mcai'},
        'log': {'file': {'path': NEG_CONTROL['path']}}, '_expect_world': None}})
    return lines, docs


def score(results):
    """-> (counts, world_mismatches, missing_player, rcon_dropped)"""
    counts, bad, nop, dropped = {}, 0, [], 0
    for r in results:
        if not r or not r.get('doc'):
            dropped += 1
            continue
        src = r['doc']['_source']
        mc = src.get('mc') or {}
        ev = mc.get('event')
        counts[ev] = counts.get(ev, 0) + 1
        exp, got = src.get('_expect_world'), mc.get('world')
        if (exp is None and got is not None) or (exp is not None and got != exp):
            bad += 1
        if ev in NEEDS_PLAYER and not mc.get('player'):
            nop.append((ev, src.get('message')))
    return counts, bad, nop, dropped


def mutate(pipeline, anchor, replacement, drop_defs=False):
    """Return a copy of the pipeline with one grok's patterns swapped.

    Asserts the anchor is PRESENT and UNIQUE. A mutant that fails to apply reads
    as 'killed' and scores a broken test as a passing one.
    """
    mut = json.loads(json.dumps(pipeline))
    hits = [p for p in mut['processors']
            if p.get('grok') and anchor in p['grok']['patterns']]
    if len(hits) != 1:
        raise SystemExit(f'ANCHOR MISSING OR NOT UNIQUE ({len(hits)}): {anchor}')
    hits[0]['grok']['patterns'] = [replacement]
    if drop_defs:
        hits[0]['grok'].pop('pattern_definitions', None)
    return mut


WORLD_ANCHOR = '/srv/block2/%{DATA:mc.world}/logs/'
MTQ_ANCHOR = ('^%{USERNAME:mc.player} moved too quickly! '
              '%{SCINUM:mc.dx:float},%{SCINUM:mc.dy:float},%{SCINUM:mc.dz:float}$')


def main():
    pipeline = json.load(open(PIPELINE))
    lines, docs = build_docs()
    print(f'corpus: {len(lines)} real Paper log lines, {len(docs)} docs '
          f'(incl. 1 negative control), spread over {len(WORLDS)} worlds')

    counts, bad, nop, dropped = score(simulate(pipeline, docs))
    print(f'\nRCON-dropped: {dropped}')
    print('mc.event distribution:')
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f'    {k:<20} {v}')

    fails = []
    if bad:
        fails.append(f'{bad} documents got the wrong mc.world (or a world they should not have)')
    if nop:
        fails.append(f'{len(nop)} classified events carry no mc.player, e.g. {nop[0]}')

    # Every classifier must actually fire on the corpus. A classifier that matches
    # nothing is the failure mode ignore_failure:true is designed to hide.
    for ev in sorted(NEEDS_PLAYER | {'chat', 'join', 'disconnect', 'lag'}):
        if not counts.get(ev):
            fails.append(f'classifier "{ev}" fired ZERO times -- it matches nothing')

    # Positive control for the whole instrument: if `other` swallowed everything,
    # the numbers above would look fine and mean nothing.
    classified = sum(v for k, v in counts.items() if k not in ('other', 'warn', 'parse_failed'))
    if classified < 0.6 * sum(counts.values()):
        fails.append(f'only {classified}/{sum(counts.values())} lines classified -- '
                     f'the pipeline is mostly falling through to other/warn')

    print('\n--- mutants (each must be KILLED) ---')
    m1 = mutate(pipeline, WORLD_ANCHOR, '/srv/BLOCK9/%{DATA:mc.world}/logs/')
    _, bad1, _, _ = score(simulate(m1, docs))
    print(f'  M1 world-prefix broken      -> world mismatches {bad1} '
          f'({"KILLED" if bad1 > 0 else "SURVIVED"})')
    if bad1 == 0:
        fails.append('MUTANT 1 SURVIVED: the world assertion cannot fail, so it is not a test')

    m2 = mutate(pipeline, MTQ_ANCHOR,
                '^%{USERNAME:mc.player} moved too quickly! '
                '%{NUMBER:mc.dx:float},%{NUMBER:mc.dy:float},%{NUMBER:mc.dz:float}$',
                drop_defs=True)
    _, _, nop2, _ = score(simulate(m2, docs))
    print(f'  M2 SCINUM -> NUMBER          -> events missing player {len(nop2)} '
          f'({"KILLED" if nop2 else "SURVIVED"})')
    if not nop2:
        fails.append('MUTANT 2 SURVIVED: scientific-notation deltas are not actually '
                     'being covered by the corpus')

    print()
    if fails:
        for f in fails:
            print('FAIL:', f)
        sys.exit(1)
    print('PASS: world attributed on every block2 line, no classified event without a '
          'player, every classifier fires, both mutants killed.')


if __name__ == '__main__':
    main()
