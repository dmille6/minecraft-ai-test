#!/usr/bin/env python3
"""The walk cap must price the window the caller asked for, not the whole disk.

2026-09-18: 1124 rotated generations (0.44 GB, counted at 25x) put the estimate
at 11.4 GB while 1.9 GB was on disk, so every Events.load() raised WalkTooWide
-- including since_minutes=30. Every read script died at once. These tests hold
the two halves of the fix: a window excludes files that predate it, and the cap
still refuses a walk that is genuinely too big.

2026-11-04: main never carried that fix (it lived on recovery-ladder-03,
c79d57b4); this file did, and failed at import. The estimate half is now on
main (predates_window + one frozen list). c79d57b4's other changes -- naive-bound
refusal, the runtime decompressed budget, bad-line-costs-a-line -- are NOT on
main and their cases were removed here rather than left failing.

Behavioural, not source-matching: each case builds real files with real mtimes
and calls the real loader.
"""
import base64, datetime, gzip, json, os, shutil, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from lib import telemetry
from lib.telemetry import Events, WalkTooWide, predates_window


class cap:
    """Shrink the cap instead of writing gigabytes.

    The first draft padded files until they breached the real 6 GB cap. gzip
    compressed a run of one character ~1000:1, so the files stayed tiny and two
    cases silently passed for the wrong reason. Moving the cap tests exactly the
    same branch at a size a test can afford.
    """

    def __init__(self, n):
        self.n = n

    def __enter__(self):
        self.was = telemetry.MAX_WALK_BYTES
        telemetry.MAX_WALK_BYTES = self.n

    def __exit__(self, *a):
        telemetry.MAX_WALK_BYTES = self.was

FAILS = []


def check(name, cond, detail=''):
    print(('  ok   ' if cond else '  FAIL ') + name + (('  -- ' + detail) if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


def row(ts, bot='alpha', kind='mine'):
    return json.dumps({'@timestamp': ts, 'skill': {'name': kind},
                       'bot': {'name': bot, 'pos': [0, 64, 0]}, 'exp': {'pool': 'p'}})


def write(path, lines, age_days, pad=0, compressible=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not pad:
        filler = ''
    elif compressible:
        filler = 'x' * pad            # ~1000:1 under gzip: big read, small file
    else:
        filler = base64.b64encode(os.urandom(pad * 3 // 4 + 1)).decode()[:pad]
    body = '\n'.join(lines) + '\n' + filler
    if path.endswith('.gz'):
        with gzip.open(path, 'wt') as fh:
            fh.write(body)
    else:
        with open(path, 'w') as fh:
            fh.write(body)
    when = (datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(days=age_days)).timestamp()
    os.utime(path, (when, when))


def main():
    d = tempfile.mkdtemp(prefix='walkcap-')
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        live = os.path.join(d, 'w1', 'skill-alpha.jsonl')
        write(live, [row((now - datetime.timedelta(minutes=5)).isoformat().replace('+00:00', 'Z'))], age_days=0)

        # Rotated history far outside any short window, deliberately big enough
        # that counting it at 25x blows the cap on its own.
        for i in range(1, 5):
            write(os.path.join(d, 'w1', 'skill-alpha.jsonl-2026090%d.gz' % i),
                  [row('2026-09-0%dT00:00:00Z' % i)], age_days=10 + i, pad=8192,
                  compressible=False)

        glob = os.path.join(d, '*', 'skill-*.jsonl*')

        # THE FIXTURE MUST BE ABLE TO FAIL. If the rotated files priced whole
        # do not breach the cap under test, the regression case passes with or
        # without the fix and proves nothing (Codex pass 1, finding 7).
        import glob as _g
        whole = sum(os.path.getsize(f) * (25 if f.endswith('.gz') else 1)
                    for f in _g.glob(glob))
        check('the fixture priced whole really does breach the reduced cap',
              whole > 16 * 1024, 'whole=%d bytes' % whole)

        # 1. THE REGRESSION. A short window must load, and must see the live row.
        try:
            ev = Events.load(paths=glob, since_minutes=60)
            check('a 60-minute window loads despite huge rotated history', True)
            check('the window keeps the in-window row (positive control)',
                  len(ev.rows) == 1, 'rows=%d' % len(ev.rows))
        except WalkTooWide as e:
            check('a 60-minute window loads despite huge rotated history', False, str(e)[:70])
            check('the window keeps the in-window row (positive control)', False, 'never loaded')

        # 2. The guard still bites when the WINDOW itself is too big. Same
        #    files, same call, only the cap moved -- so this is the estimate's
        #    in-window branch, not a different code path.
        with cap(16 * 1024):
            try:
                Events.load(paths=glob, since_minutes=60 * 24 * 365)
                check('a window that really is too wide still raises', False, 'no raise')
            except WalkTooWide:
                check('a window that really is too wide still raises', True)

            # 3. No window means no skipping: the rotated files are priced too,
            #    so an unbounded walk still refuses.
            try:
                Events.load(paths=glob)
                check('an unbounded walk is still priced over every file', False, 'no raise')
            except WalkTooWide:
                check('an unbounded walk is still priced over every file', True)

            # 4. ...and the short window still loads under that same small cap,
            #    which is the whole claim: the skip, not a bigger budget. The
            #    first draft asserted only 'no exception', which an EMPTY result
            #    also satisfies, and it ran against the real 6 GB cap where the
            #    broken estimator passed too (Codex pass 1, finding 7). Both are
            #    fixed here: same reduced cap, and the row must come back.
            try:
                ev = Events.load(paths=glob, since_minutes=60)
                check('under the same small cap the short window still loads', True)
                check('...and still returns the in-window row, not an empty walk',
                      len(ev.rows) == 1, 'rows=%d' % len(ev.rows))
            except WalkTooWide as e:
                check('under the same small cap the short window still loads', False, str(e)[:60])
                check('...and still returns the in-window row, not an empty walk', False, 'never loaded')

        # 5. THE 11-04 SHAPE: many bots, many rotated generations each, a short
        #    window. 00:05Z: 1,200 files priced whole at 22.5 GB against a 6 h
        #    window whose 160 in-scope files were 2.0 GB, so the hourly
        #    flowledger raised. Here: 6 bots x 15 old .gz each plus one live file
        #    per bot, under a cap the old pricing breaches and the in-window
        #    pricing does not.
        many = os.path.join(d, 'many')
        stamp = (now - datetime.timedelta(minutes=5)).isoformat().replace('+00:00', 'Z')
        for b in range(6):
            write(os.path.join(many, 'w%d' % b, 'skill-b%d.jsonl' % b),
                  [row(stamp, bot='b%d' % b)], age_days=0)
            for g in range(1, 16):
                write(os.path.join(many, 'w%d' % b, 'skill-b%d.jsonl-202610%02d.gz' % (b, g)),
                      [row('2026-10-%02dT00:00:00Z' % g, bot='b%d' % b)],
                      age_days=g + 1, pad=2048, compressible=False)
        mglob = os.path.join(many, '*', 'skill-*.jsonl*')
        mfiles = _g.glob(mglob)
        mwhole = sum(os.path.getsize(f) * (25 if f.endswith('.gz') else 1) for f in mfiles)
        mlive = sum(os.path.getsize(f) for f in mfiles if not f.endswith('.gz'))
        MCAP = 64 * 1024
        check('many-gens fixture: 96 files, whole pricing breaches the cap, live does not',
              len(mfiles) == 96 and mwhole > MCAP > mlive,
              'files=%d whole=%d live=%d cap=%d' % (len(mfiles), mwhole, mlive, MCAP))
        with cap(MCAP):
            try:
                ev = Events.load(paths=mglob, since_minutes=360)
                check('many old rotated generations + a 6 h window: no raise', True)
                check('...and every bot\'s live row comes back (6 of 6)',
                      sorted((r['bot'] or {}).get('name') for r in ev.rows)
                      == ['b%d' % i for i in range(6)], 'rows=%d' % len(ev.rows))
            except WalkTooWide as e:
                check('many old rotated generations + a 6 h window: no raise', False, str(e)[:70])
                check('...and every bot\'s live row comes back (6 of 6)', False, 'never loaded')
            try:
                Events.load(paths=mglob, since_minutes=60 * 24 * 60)
                check('a 60-day window over the same files still raises', False, 'no raise')
            except WalkTooWide:
                check('a 60-day window over the same files still raises', True)

        # 6. MUTANT: price the whole glob again (the pre-fix estimate). Case 5
        #    must then raise, or case 5 is not testing the fix.
        tsrc = open(telemetry.__file__).read()
        old = '        est = 0\n        for f in files:\n'
        assert tsrc.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE'
        msrc = tsrc.replace(old, '        est = 0\n        for f in glob.glob(paths):\n')
        import types
        mut = types.ModuleType('telemetry_mutant')
        mut.__file__ = telemetry.__file__
        exec(compile(msrc, telemetry.__file__, 'exec'), mut.__dict__)
        mut.MAX_WALK_BYTES = MCAP
        try:
            mut.Events.load(paths=mglob, since_minutes=360)
            check('mutant (estimate over the whole glob) is killed by case 5', False, 'mutant survived')
        except mut.WalkTooWide:
            check('mutant (estimate over the whole glob) is killed by case 5', True)

        # 9. The shared decision itself.
        since = now - datetime.timedelta(hours=1)
        check('predates_window: the live file is in scope', not predates_window(live, since))
        check('predates_window: a 14-day-old generation is out of scope',
              predates_window(os.path.join(d, 'w1', 'skill-alpha.jsonl-20260901.gz'), since))
        check('predates_window: no window means nothing is skipped',
              not predates_window(live, None))
        check('predates_window: an unreadable mtime is never skipped',
              not predates_window(os.path.join(d, 'nope', 'gone.jsonl'), since))
    finally:
        shutil.rmtree(d, ignore_errors=True)

    print()
    if FAILS:
        print('FAILED: ' + ', '.join(FAILS))
        return 1
    print('all walk-cap tests pass')
    return 0


if __name__ == '__main__':
    sys.exit(main())
