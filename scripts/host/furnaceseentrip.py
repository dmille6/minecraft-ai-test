#!/usr/bin/env python3
# furnaceseentrip.py --since ISO --version SHA8 [--hours-before H] | --selftest -- the FLEET TRIPWIRE for furnaceseen-01's
# OWNER-DIRECT tier-1 rollout (OWNER 10-23: "ships as an owner-direct TIER-1 rollout after ledger-01 is KEPT and promoted, with
# the read's replay check as the tripwire, not as a canary"). READ ONLY. Run on 10.0.0.31 every 30-60 min after the rollout:
#
#     cd ~/mcai-analysis && nice -n 19 python3 furnaceseentrip.py --since <rollout ISO> --version <sha8>
#
# It walks every bot's skill log (/var/log/mcai/*/skill-*.jsonl and the rotated .gz) WHOLE (CLAUDE.md: full walks only), keeping
# the few row kinds it needs; rows of --version are judged (restart lag on another build skipped); all builds give the context.
#   T1 SKIP WITHOUT A VALID EMPTY (BREACH -> roll back): a `_furnace_seen_skip` row whose LOGGED inputs, replayed through
#        seen_skip (furnaceseenread.py: the port bound to smeltjob.mjs seenSkip by the golden table), do NOT say skip -- the drain
#        passed over a furnace without a valid townmate empty finding. This is the defect the owner named.
#   W1 A WALK THE RULE SHOULD HAVE SAVED (WATCH, never a breach: a missed saving harms nothing): a drain of the version whose
#        logged inputs replay to skip.
#   BLIND: no rows of the version; no `_furnace_seen_mode on=on` of the version; no `_ledger_station` row at all (ledger-01 is
#        not on the fleet: the rule has nothing to read); replays unresolved > 5% of tries.
#   NOT EXPOSED (OK-PARTIAL, never OK): no skip row of the version yet.
#   CONTEXT (reported; WATCH only when it collapses, never a breach): drain BODY-TIME per bot-h by stop class (empty, drained,
#        unreachable, lit, busy, other) and repeat empty drains per bot-h (another bot's empty < 60 min before, no load between),
#        the window after --since against the same length before it (all builds). A fleet before/after: world drift is NOT
#        separated (as with plinth-02's and matset-01's owner-direct reads). WATCH if, after >= 6 h, the drains that DRAINED
#        something fall below 0.5x per bot-h (the skip must not stop real drains).
# LAST LINE: `TRIPWIRE BREACH ...` | `TRIPWIRE BLIND ...` | `TRIPWIRE WATCH ...` | `TRIPWIRE OK-PARTIAL ...` | `TRIPWIRE OK`.
# Rollback = redeploy the previous fleet sha (the rollout's notes name it); FURNACE_SEEN=off is the one-setting alternative.
import argparse, datetime as dt, glob, gzip, json, os, re, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from furnaceseenread import fields, num, seen_skip, logged_inputs, d1_check, repeat_empties, stop_class, STOP_CLASSES   # noqa: E402

LOGS = '/var/log/mcai'
KEEP = (b'"_furnace_seen_skip"', b'"_furnace_seen_mode"', b'"_furnace_drain"', b'"furnace_drain"', b'"_ledger_station"', b'"_furnace_session"')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def judge(rows, since, version, now, hours_before=None, unreadable=(), spans=None):
    """PURE. rows: dicts t (ISO), ms, bot, v, name, status, detail, dur; unreadable: log files the walk could not read.
    -> (lines, verdict). ANY unreadable log makes the verdict BLIND (Codex light r1 P2-1): an unseen skip is never an OK."""
    t0 = dt.datetime.fromisoformat(since.replace('Z', '+00:00'))
    since_ms = int(t0.timestamp() * 1000)
    after_h = (now - t0).total_seconds() / 3600
    hb = hours_before if hours_before is not None else after_h
    b0_ms = since_ms - int(hb * 3600_000)
    entries, n = {}, Counter()
    skips, walks = [], []
    drains = {'before': defaultdict(list), 'after': defaultdict(list)}
    loads = defaultdict(list)
    runs = []
    span = {'before': {}, 'after': {}}
    for r in sorted(rows, key=lambda x: x['ms']):
        ms, b, k, d = r['ms'], r['bot'], r['name'], r.get('detail') or ''
        if k == '_ledger_station':
            n['stations'] += 1
            f = fields(d)
            if f.get('outcome') == 'entry':
                entries[f.get('id')] = {'id': f.get('id'), 'at': num(f.get('at')) or ms, 'bot': b, 'state': f.get('state')}
            if f.get('phase') == 'load':
                loads[pool_of(b)].append((ms, f.get('f')))
        if ms < b0_ms:
            continue
        side = 'after' if ms >= since_ms else 'before'
        sp = span[side].setdefault(b, [ms, ms]); sp[1] = ms
        if k == '_furnace_session' and fields(d).get('by') in ('smelt', 'smelt_town'):
            loads[pool_of(b)].append((ms, fields(d).get('furnace')))
        if k == '_furnace_drain':
            f = fields(d)
            drains[side][pool_of(b)].append((ms, b, f.get('furnace'), f.get('stop')))
        if k == 'furnace_drain':
            runs.append((ms, r.get('dur') or 0, b, side))
        if side != 'after' or not str(r.get('v') or '').startswith(version):
            continue
        n['rows'] += 1
        if k == '_furnace_seen_mode' and ' on=on ' in f' {d} ':
            n['mode'] += 1
        elif k == '_furnace_seen_skip':
            skips.append((ms, b, fields(d)))
        elif k == '_furnace_drain':
            walks.append((ms, b, fields(d)))
    d1 = d1_check(walks, skips, entries)
    t1 = [x for x in d1['defects'] if x[0] == 'skipped_a_walk']
    w1 = [x for x in d1['defects'] if x[0] == 'walked_a_skip']
    # bot-hours: from EVERY row's presence when the reader supplied it (Claude light r1 P3-1), else from the kept rows' spans
    src = spans if spans is not None else span
    bh = {s: sum(max(0, e - a) for a, e in src.get(s, {}).values()) / 3600_000 for s in ('before', 'after')}
    stop_at = defaultdict(list)
    for s in drains:
        for xs in drains[s].values():
            for ms, b, _, st in xs:
                stop_at[b].append((ms, st))
    secs = Counter()
    for st0, dur, b, side in runs:
        m = [st for tt, st in stop_at[b] if st0 <= tt <= st0 + dur + 2000]
        secs[(side, stop_class(m[0] if m else None))] += dur / 1000.0
    rep = {s: sum(repeat_empties(xs, loads[p]) for p, xs in drains[s].items()) for s in drains}
    drained = {s: sum(1 for xs in drains[s].values() for _, _, _, st in xs if stop_class(st) == 'drained') for s in drains}
    per = lambda v, s: v / bh[s] if bh[s] else float('nan')
    lines = ['rows of %s since %s: %d (mode on %d, skips %d, drains %d); %.1f h after; _ledger_station rows %d'
             % (version, since, n['rows'], n['mode'], len(skips), len(walks), after_h, n['stations']),
             'T1 skips without a valid logged empty: %d   W1 walks the rule should have saved: %d   replayed walks %d skips %d unresolved %d'
             % (len(t1), len(w1), d1['walks_replayed'], d1['skips_replayed'], d1['unresolved'])]
    for s in ('before', 'after'):
        lines.append('CONTEXT %-6s %.1f bot-h: repeat empty drains %d (%.3f/bot-h), drains that drained %d (%.3f/bot-h); body-s/bot-h by stop %s'
                     % (s, bh[s], rep[s], per(rep[s], s), drained[s], per(drained[s], s),
                        {c: round(per(secs[(s, c)], s), 2) for c in STOP_CLASSES + ('other',)}))
    if unreadable:
        lines.append('UNREADABLE logs %d: %s' % (len(unreadable), ', '.join(sorted(unreadable)[:5])))
    for x in t1:
        lines.append('BREACH T1 %s' % (x,))
    if t1:
        return lines, 'TRIPWIRE BREACH T1 %s' % (t1[0],)
    if unreadable:
        return lines, 'TRIPWIRE BLIND %d skill log(s) could not be read' % len(unreadable)
    tried = d1['walks_replayed'] + d1['skips_replayed'] + d1['unresolved']
    blind = [w for w, ok in (('rows of the version', n['rows'] > 0), ('no _furnace_seen_mode on=on of the version', n['mode'] > 0),
                             ('no _ledger_station row at all (ledger-01 not on the fleet)', n['stations'] > 0),
                             ('replays unresolved %d of %d (> 5%%)' % (d1['unresolved'], tried), d1['unresolved'] <= 0.05 * max(1, tried))) if not ok]
    if blind:
        return lines, 'TRIPWIRE BLIND ' + '; '.join(blind)
    watch, partial = [], []
    if w1:
        watch.append('W1: %d walks whose logged inputs say skip -- a CODE DISAGREEMENT (the pick and seenSkip differ): investigate '
                     'before the next rollout (a missed saving, not harm; the canary read counted it a defect, tier 1 demotes it to WATCH)' % len(w1))
    if after_h >= 6 and bh['before'] and bh['after'] and drained['before'] and per(drained['after'], 'after') < 0.5 * per(drained['before'], 'before'):
        watch.append('drains that drained something %.3f -> %.3f /bot-h (< 0.5x; a fleet before/after, drift not separated)'
                     % (per(drained['before'], 'before'), per(drained['after'], 'after')))
    if not skips:
        partial.append('NOT EXPOSED: no skip row of the version yet')
    if drained['before'] < 5:
        partial.append('harm guard unassessed: %d drains that drained something before --since (< 5)' % drained['before'])
    if not bh['before']:
        partial.append('CONTEXT unassessed: no rows before --since')
    if watch:
        return lines, 'TRIPWIRE WATCH ' + '; '.join(watch + partial)
    if partial:
        return lines, 'TRIPWIRE OK-PARTIAL ' + '; '.join(partial)
    return lines, 'TRIPWIRE OK'


TS_RE = re.compile(rb'"@timestamp":"([^"]+)"')
BOT_RE = re.compile(rb'"bot":\{"name":"([^"]+)"')


def rows(since, hours_before, unreadable=None, spans=None):
    """Every kept row of every skill log; a file that cannot be opened OR read to its end is appended to `unreadable`; `spans`
    ({'before'|'after': {bot: [first ms, last ms]}}) collects every row's presence, kept or not (the bot-hour denominator)."""
    unreadable = [] if unreadable is None else unreadable
    spans = {'before': {}, 'after': {}} if spans is None else spans
    t0 = dt.datetime.fromisoformat(since.replace('Z', '+00:00'))
    since_ms = int(t0.timestamp() * 1000)
    pb0 = (t0 - dt.timedelta(hours=hours_before or 0)).isoformat().replace('+00:00', 'Z')   # presence: the context window only
    # the entries a skip names can be up to 60 min older than the window: read an hour more than the context needs
    b0 = (t0 - dt.timedelta(hours=(hours_before or 0) + 1)).isoformat().replace('+00:00', 'Z')
    for f in sorted(glob.glob('%s/*/skill-*.jsonl*' % LOGS)):
        opener = gzip.open if f.endswith('.gz') else open
        try:
            fh = opener(f, 'rb')
        except Exception:
            unreadable.append(f); continue
        with fh:
          try:
            for raw in fh:
                mt, mb = TS_RE.search(raw), BOT_RE.search(raw)
                if mt and mb:
                    tt = mt.group(1).decode()
                    if tt >= pb0:
                        try:
                            pms = int(dt.datetime.fromisoformat(tt.replace('Z', '+00:00')).timestamp() * 1000)
                            sp = spans['after' if pms >= since_ms else 'before'].setdefault(mb.group(1).decode(), [pms, pms])
                            sp[0] = min(sp[0], pms); sp[1] = max(sp[1], pms)
                        except ValueError:
                            pass
                if not any(k in raw for k in KEEP):
                    continue
                try:
                    r = json.loads(raw)
                except Exception:
                    continue
                t = r.get('@timestamp') or ''
                if t < b0:
                    continue
                sk = r.get('skill') or {}
                try:
                    ms = int(dt.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp() * 1000)
                except ValueError:
                    continue
                yield {'t': t, 'ms': ms, 'bot': (r.get('bot') or {}).get('name'), 'v': (r.get('code') or {}).get('version'),
                       'name': sk.get('name'), 'status': sk.get('status'), 'detail': sk.get('detail'), 'dur': sk.get('duration_ms')}
          except Exception:
            unreadable.append(f)            # a read that failed part-way (a truncated .gz, an I/O error): not a quiet zero


def selftest():
    since, V = '2026-10-24T00:00:00Z', 'abcdef12'
    S = int(dt.datetime(2026, 10, 24, tzinfo=dt.timezone.utc).timestamp() * 1000)
    now = dt.datetime(2026, 10, 24, 8, tzinfo=dt.timezone.utc)
    H = 3600_000
    def row(ms, name, detail='', v=V + '+c', bot='p-a-B', dur=None):
        return {'t': '', 'ms': ms, 'bot': bot, 'v': v, 'name': name, 'status': 'success', 'detail': detail, 'dur': dur}
    st = lambda ms, i, bot, state='empty', ph='open': row(ms, '_ledger_station', 'id=%s f=1,64,1 phase=%s by=drain state=%s outcome=entry in=0 fuel=0 out=0 lit=0 at=%d' % (i, ph, state, ms), v='x', bot=bot)
    skip = lambda ms, se, bot='p-a-B', **o: row(ms, '_furnace_seen_skip', 'f=1,64,1 why=townmate_empty now=%d changed=1 se=%s sl=%s so=%s off=1:99' % (ms, se, o.get('sl', '-'), o.get('so', '-')), bot=bot)
    drain = lambda ms, stop, bot='p-a-C', v=V + '+c', se='-': row(ms, '_furnace_drain', 'stop=%s furnace=1,64,1 lease=1 out=0 in=0 fuel=0 taken=0 left=- t0=%d ledger=x se=%s sl=- so=- off=1:9' % (stop, ms, se), bot=bot, v=v)
    base = [row(S - 2 * H, '_furnace_seen_mode', 'phase=mode on=on v=1', v='old'), row(S + 60_000, '_furnace_seen_mode', 'phase=mode on=on v=1'),
            st(S - 3 * H, 'old-1', 'p-a-A'), drain(S - 2 * H, 'empty', v='old'), drain(S - 2 * H + 600_000, 'empty', bot='p-a-D', v='old'),
            drain(S - H, 'drained', v='old'), drain(S + 2 * H, 'drained'),
            *[drain(S - 6 * H + i * 600_000, 'drained', v='old') for i in range(5)],     # enough drained history for the harm guard
            st(S + 3 * H, 'mate-1', 'p-a-A'), skip(S + 3 * H + 600_000, 'mate-1'), row(S + 4 * H, 'gather')] + \
           [drain(S + h * H, 'drained') for h in (3, 4, 5, 6, 7)]          # the drained rate holds after the rollout
    cases = []
    def case(name, rs, want, why=None):
        got = judge(rs, since, V, now)[1]
        ok_why = why is None or why in got
        cases.append((name, got.split(' ')[1] if ok_why else 'WRONG-REASON', want, got))
    case('a skip on a valid townmate empty -> OK', base, 'OK')
    case('T1 a skip on the bot\'s OWN entry -> BREACH', base + [st(S + 5 * H, 'own-1', 'p-a-B'), skip(S + 5 * H + 60_000, 'own-1')], 'BREACH')
    case('T1 a skip on an entry that HOLDS items -> BREACH', base + [st(S + 5 * H, 'h-1', 'p-a-A', state='holds'), skip(S + 5 * H + 60_000, 'h-1')], 'BREACH')
    case('T1 a skip on an EXPIRED empty -> BREACH', base + [st(S + 4 * H, 'e-1', 'p-a-A'), skip(S + 5 * H + 60_000, 'e-1')], 'BREACH')
    case('T1 a skip after the bot saw it LIT -> BREACH', base + [st(S + 5 * H, 'l-1', 'p-a-A'), skip(S + 5 * H + 60_000, 'l-1', sl=S + 5 * H + 30_000)], 'BREACH')
    case('a skip on another BUILD is not judged', base + [st(S + 5 * H, 'own-2', 'p-a-B'), dict(skip(S + 5 * H + 60_000, 'own-2'), v='old')], 'OK')
    case('W1 a walk whose inputs say skip -> WATCH (missed saving)', base + [drain(S + 3 * H + 900_000, 'empty', bot='p-a-B', se='mate-1')], 'WATCH')
    case('BLIND an unresolvable skip (its entry not found)', base + [skip(S + 6 * H, 'nowhere-%d' % i) for i in range(3)], 'BLIND', 'replays unresolved')
    case('BLIND no mode row of the version', [r for r in base if not (r['name'] == '_furnace_seen_mode' and r['v'].startswith(V))], 'BLIND', 'no _furnace_seen_mode')
    # no ledger rows AND no skip naming one: the ONLY reason left is the missing ledger
    case('BLIND no ledger at all', [r for r in base if r['name'] not in ('_ledger_station', '_furnace_seen_skip')], 'BLIND', 'ledger-01 not on the fleet')
    case('NOT EXPOSED: no skip yet -> OK-PARTIAL, never OK', [r for r in base if r['name'] != '_furnace_seen_skip'], 'OK-PARTIAL', 'NOT EXPOSED')
    case('harm guard unassessed (< 5 drained before) -> OK-PARTIAL, never OK', [r for r in base if not (r['name'] == '_furnace_drain' and 'drained' in r['detail'] and r['ms'] < S)], 'OK-PARTIAL', 'harm guard unassessed')
    case('drained drains collapse after 6 h -> WATCH', base + [drain(S - H + i * 60_000, 'drained', v='old') for i in range(20)], 'WATCH')
    got = judge(base, since, V, now, unreadable=['/var/log/mcai/p-a-B/skill-1.jsonl'])[1]
    cases.append(('an UNREADABLE log -> BLIND, never OK', got.split(' ')[1], 'BLIND', got))
    # the READER itself: a file that raises on open, and one that raises part-way, both land in `unreadable`
    import tempfile
    global LOGS
    keep, LOGS = LOGS, tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(LOGS, 'p-a-B')); os.makedirs(os.path.join(LOGS, 'p-a-C'))
        # logger.mjs logEvent's key order: @timestamp first, then bot: {name, ...} (JSON.stringify, compact)
        open(os.path.join(LOGS, 'p-a-B', 'skill-1.jsonl'), 'w').write(json.dumps({'@timestamp': '2026-10-24T01:00:00Z', 'bot': {'name': 'p-a-B-x', 'pos': {'x': 1}},
            'skill': {'name': '_furnace_drain', 'detail': 'stop=empty'}}, separators=(',', ':')) + '\n')
        open(os.path.join(LOGS, 'p-a-C', 'skill-1.jsonl.gz'), 'wb').write(b'not gzip at all')
        un, sp = [], {'before': {}, 'after': {}}
        got_rows = list(rows(since, 2, un, sp))
        # the PRESENCE regexes against the logger's real row shape (Claude light r2 P3-2): a format change fails here, loudly
        cases.append(('reader: presence spans read from the logger\'s row shape', 'x' if sp['after'].get('p-a-B-x') else 'y', 'x', sp))
        cases.append(('reader: a corrupt .gz is UNREADABLE, the good file still read', 'x' if (len(got_rows) == 1 and len(un) == 1 and un[0].endswith('.gz')) else 'y', 'x', (len(got_rows), un)))
    finally:
        LOGS = keep
    bad = [c for c in cases if c[1] != c[2]]
    for c in cases:
        print('%-58s %s' % (c[0], 'ok' if c[1] == c[2] else 'FAIL: %s' % c[3]))
    print('%d cases, %d failed' % (len(cases), len(bad)))
    return 1 if bad else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--since'); ap.add_argument('--version'); ap.add_argument('--hours-before', type=float)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if not a.since or not a.version or len(a.version) < 7:
        sys.exit('usage: furnaceseentrip.py --since ISO --version SHA8 [--hours-before H] | --selftest')
    now = dt.datetime.now(dt.timezone.utc)
    hb = a.hours_before if a.hours_before is not None else (now - dt.datetime.fromisoformat(a.since.replace('Z', '+00:00'))).total_seconds() / 3600
    unreadable, spans = [], {'before': {}, 'after': {}}
    rs = list(rows(a.since, hb, unreadable, spans))
    lines, verdict = judge(rs, a.since, a.version, now, hb, unreadable=unreadable, spans=spans)
    print('\n'.join(lines))
    print(verdict)
