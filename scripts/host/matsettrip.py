#!/usr/bin/env python3
# matsettrip.py --since ISO --version SHA8 [--hours-before H] | --selftest -- the FLEET TRIPWIRE for matset-01's owner-direct
# rollout (building tier §3.4, tier 1: constants only). READ ONLY. Run on 10.0.0.31 every 30-60 min after the rollout:
#
#     cd ~/mcai-analysis && nice -n 19 python3 matsettrip.py --since <rollout ISO> --version <sha8>
#
# It walks every bot's skill log (/var/log/mcai/*/skill-*.jsonl and the rotated .gz) whole (CLAUDE.md: full walks only),
# keeps rows of --version for the judged lines (restart lag skipped), and all rows for the before/after context.
#   T1 PART DISPOSED  a `_well_dispose` row whose offlist_items name a building part (stocktarget.mjs PROJECT_PARTS). A part
#                     is no longer junk, a stock group or cobble, so the well's own accounting files any throw of one under
#                     offlist (offlist_items comes before the 300-char cut; items= is often truncated away, so it is not used).
#   T2 PART PRUNED    a `_stock_prune_visit` row whose `pruned a:n,...` names a part, or a `_stock_prune` row with name=<part>.
#   T3 SAND NOT BANKED (after >= 24 h, only where sand was carried in town): 0 sand left a bag in a successful `town_deposit`
#                     or `deposit` (inventory_delta) while >= 1 bot of the version carried MORE than its kept 8 -> WATCH (the design's tripwire
#                     "sand banked > 0 in 24 h"). No bot carrying sand = NOT EXPOSED, never OK.
#   CONTEXT (WATCH only, never a breach): gather successes, _milestone_complete rows and _death rows per bot-hour, the window
#                     after --since against the same length before it (all builds). A fleet before/after: world drift is NOT
#                     separated (as with plinth-02's owner-direct read). WATCH when gather or rungs fall below 0.7x after >= 6 h.
#   INSTRUMENT        rows of the version > 0, >= 1 `_well_dispose` row of the version that threw something (n > 0), and
#                     a prune row that does not parse is BLIND; no prune that took anything = T2 NOT EXPOSED (OK-PARTIAL).
#                     A well throw counts only when READABLE: unnamed=0 and offlist_items names exactly offlist items.
#                     No rows before --since = CONTEXT unassessed (OK-PARTIAL, never OK).
# LAST LINE: `TRIPWIRE BREACH <line> <bot> <detail>` | `TRIPWIRE BLIND <what>` | `TRIPWIRE WATCH <what>` | `TRIPWIRE OK-PARTIAL <what>` | `TRIPWIRE OK`.
# Rollback = redeploy the previous fleet sha (the rollout's notes name it).
import argparse, datetime as dt, glob, gzip, json, re, sys
from collections import Counter, defaultdict

LOGS = '/var/log/mcai'
COPPER = ['', 'exposed_', 'weathered_', 'oxidized_']
PARTS = frozenset(['stone_bricks', 'stone_brick_slab', 'stone_brick_stairs', 'stone_brick_wall', 'glass', 'glass_pane',
                   'copper_block', 'waxed_copper_block']
                  + [f'{w}{o}{n}' for w in ('', 'waxed_') for o in COPPER for n in ('cut_copper', 'cut_copper_slab', 'cut_copper_stairs', 'copper_door')]
                  + [f'{w}{o}_copper' for w in ('', 'waxed_') for o in ('exposed', 'weathered', 'oxidized')])
assert len(PARTS) == 46
SAND = ('sand', 'red_sand')
# skills.mjs pruneTown's no-take rows (6e1afb52): nothing left a chest
PRUNE_NO_TAKE = ('no usable junk well in town', 'no town container holds a full stack', 'the container at ', 'took nothing at ')
KEEP = (b'"_well_dispose"', b'"_stock_prune', b'"town_deposit"', b'"deposit"', b'"gather"', b'"_milestone_complete"', b'"_death"')


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def pairs(s):
    """'a:1,b:2' -> {'a': 1, 'b': 2}; '-' or junk -> {}."""
    out = {}
    for part in (s or '').split(','):
        m = re.match(r'^([a-z0-9_]+):(\d+)$', part.strip())
        if m:
            out[m.group(1)] = out.get(m.group(1), 0) + int(m.group(2))
    return out


def judge(rows, since, version, now, hours_before=None):
    """PURE. rows: dicts with t (ISO), bot, v (code version), name, status, detail, delta, inv. -> (lines, verdict)."""
    t0 = dt.datetime.fromisoformat(since.replace('Z', '+00:00'))
    after_h = (now - t0).total_seconds() / 3600
    hb = hours_before if hours_before is not None else after_h
    b0 = (t0 - dt.timedelta(hours=hb)).isoformat().replace('+00:00', 'Z')
    breaches, lines = [], []
    seen = Counter()
    sand_banked = 0
    sand_carriers = set()
    bots = {'before': set(), 'after': set()}
    ctx = {'before': Counter(), 'after': Counter()}
    for r in rows:
        t = r['t']
        if t < b0:
            continue
        side = 'after' if t >= since else 'before'
        bots[side].add(r['bot'])
        if r['name'] == 'gather' and r['status'] == 'success':
            ctx[side]['gather'] += 1
        elif r['name'] == '_milestone_complete':
            ctx[side]['rungs'] += 1
        elif r['name'] == '_death':
            ctx[side]['deaths'] += 1
        if side != 'after' or not str(r.get('v') or '').startswith(version):
            continue
        seen['rows'] += 1
        if sum((r.get('inv') or {}).get(s, 0) for s in SAND) > 8:      # above the gather rung's kept 8 (Claude light r1 P3)
            sand_carriers.add(r['bot'])
        d = r.get('detail') or ''
        if r['name'] == '_well_dispose':
            f = kv(d)
            thrown = int(f['n']) if f.get('n', '').isdigit() else None    # None: the row's own count is missing (cut) -> unreadable
            off = int(f['offlist']) if f.get('offlist', '').isdigit() else None
            named = pairs(f.get('offlist_items'))
            # READABLE (Codex light r1 P2): the row's own accounting names its off-list throws -- offlist and unnamed parse,
            # unnamed=0, and offlist_items is '-' for offlist=0, or names at least one and at most `offlist` kinds (offlist
            # counts thrown ENTITIES, offlist_items their item counts; measured 10-23: offlist=1 offlist_items=cobblestone:62).
            readable = (off is not None and f.get('unnamed') == '0' and
                        ((off == 0 and f.get('offlist_items') == '-') or (off > 0 and 0 < len(named) <= off)))
            if thrown is None:
                seen['well_unreadable'] += 1                    # Codex light r2 P2: unknown throw accounting is unreadable
            elif thrown > 0 and readable:
                seen['well_threw'] += 1
            elif thrown > 0:
                seen['well_unreadable'] += 1
            hit = sorted(n for n in named if n in PARTS)
            if hit:
                breaches.append(('T1', r['bot'], 'well threw %s at %s' % (','.join(hit), t)))
        elif r['name'] == '_stock_prune_visit':
            seen['prune_visits'] += 1
            m = re.match(r'^pruned (\S+) from ', d)
            # Codex light r2 P2: the WHOLE list must parse, whatever the status (a failed throw can follow a real take); a row
            # that is neither a parsed take nor one of pruneTown's no-take sentences is unreadable
            whole = bool(m) and all(re.match(r'^[a-z0-9_]+:\d+$', x) for x in m.group(1).split(','))
            if whole:
                seen['prune_took'] += 1                         # a prune that TOOK something, every name parsed
            elif not d.startswith(PRUNE_NO_TAKE):
                seen['prune_unreadable'] += 1
            hit = sorted(n for n in pairs(m.group(1) if m else '') if n in PARTS)
            if hit:
                breaches.append(('T2', r['bot'], 'pruned %s at %s' % (','.join(hit), t)))
        elif r['name'] == '_stock_prune':
            if kv(d).get('name') in PARTS:
                breaches.append(('T2', r['bot'], 'stock_prune name=%s at %s' % (kv(d).get('name'), t)))
        elif r['name'] in ('town_deposit', 'deposit') and r['status'] == 'success':
            seen['deposits'] += 1
            sand_banked += sum(-int(v) for k, v in (r.get('delta') or {}).items() if k in SAND and int(v) < 0)
    lines.append('rows of %s since %s: %d (deposits %d, readable well throws %d, unreadable %d, prune visits %d, prunes that took %d, unreadable %d); %.1f h after' % (
        version, since, seen['rows'], seen['deposits'], seen['well_threw'], seen['well_unreadable'], seen['prune_visits'], seen['prune_took'],
        seen['prune_unreadable'], after_h))
    lines.append('T1 parts down the well: %d   T2 parts pruned: %d' % (sum(b[0] == 'T1' for b in breaches), sum(b[0] == 'T2' for b in breaches)))
    lines.append('T3 sand banked %d (bots of the version carrying sand: %d)' % (sand_banked, len(sand_carriers)))
    watch = []
    for side in ('before', 'after'):
        n = max(1, len(bots[side]))
        lines.append('CONTEXT %-6s %.1f h, %d bots: gather %d (%.2f/bot-h), rungs %d (%.2f/bot-h), deaths %d (%.3f/bot-h)' % (
            side, hb if side == 'before' else after_h, len(bots[side]), ctx[side]['gather'], ctx[side]['gather'] / n / max(hb if side == 'before' else after_h, 1e-9),
            ctx[side]['rungs'], ctx[side]['rungs'] / n / max(hb if side == 'before' else after_h, 1e-9),
            ctx[side]['deaths'], ctx[side]['deaths'] / n / max(hb if side == 'before' else after_h, 1e-9)))
    partial = []
    if not bots['before']:
        partial.append('CONTEXT unassessed: no rows before --since')
    elif after_h < 6:
        partial.append('CONTEXT not judged before 6 h')
    else:
        for k in ('gather', 'rungs'):
            rb = ctx['before'][k] / max(1, len(bots['before'])) / max(hb, 1e-9)
            ra = ctx['after'][k] / max(1, len(bots['after'])) / max(after_h, 1e-9)
            if rb > 0 and ra < 0.7 * rb:
                watch.append('%s %.2f -> %.2f /bot-h (< 0.7x; a fleet before/after, drift not separated)' % (k, rb, ra))
    if after_h >= 24 and sand_carriers and sand_banked == 0:
        watch.append('sand carried by %d bots and 0 banked in %.0f h' % (len(sand_carriers), after_h))
    for b in breaches:
        lines.append('BREACH %s %s %s' % b)
    if breaches:
        return lines, 'TRIPWIRE BREACH %s %s %s' % breaches[0]
    blind = [w for w, ok in (('rows of the version', seen['rows'] > 0), ('T1: no READABLE well throw of the version', seen['well_threw'] > 0),
                             ('T2: prune rows that could not be parsed', seen['prune_unreadable'] == 0)) if not ok]
    if blind:
        return lines, 'TRIPWIRE BLIND ' + '; '.join(blind)
    if seen['well_unreadable']:
        watch.append('T1: %d well throws whose accounting does not name every off-list item' % seen['well_unreadable'])
    if not seen['prune_took']:
        partial.append('T2 NOT EXPOSED: no prune took anything in the window')
    if after_h >= 24 and not sand_carriers:
        watch.append('T3 NOT EXPOSED: no bot of the version carried sand')
    if watch:
        return lines, 'TRIPWIRE WATCH ' + '; '.join(watch + partial)
    if partial:
        return lines, 'TRIPWIRE OK-PARTIAL ' + '; '.join(partial)     # never an unqualified OK with a line unjudged
    return lines, 'TRIPWIRE OK'


def rows(since, hours_before):
    t0 = dt.datetime.fromisoformat(since.replace('Z', '+00:00'))
    b0 = (t0 - dt.timedelta(hours=hours_before)).isoformat().replace('+00:00', 'Z') if hours_before is not None else None
    for f in sorted(glob.glob('%s/*/skill-*.jsonl*' % LOGS)):
        opener = gzip.open if f.endswith('.gz') else open
        try:
            fh = opener(f, 'rb')
        except Exception:
            continue
        with fh:
            for raw in fh:
                if not any(k in raw for k in KEEP):
                    continue
                try:
                    r = json.loads(raw)
                except Exception:
                    continue
                t = r.get('@timestamp') or ''
                if b0 and t < b0:
                    continue
                sk = r.get('skill') or {}
                yield {'t': t, 'bot': (r.get('bot') or {}).get('name'), 'v': (r.get('code') or {}).get('version'), 'name': sk.get('name'),
                       'status': sk.get('status'), 'detail': sk.get('detail'), 'delta': sk.get('inventory_delta'),
                       'inv': (r.get('bot') or {}).get('inventory')}


def selftest():
    since, V = '2026-10-24T00:00:00Z', 'abcdef12'
    now = dt.datetime(2026, 10, 25, 1, tzinfo=dt.timezone.utc)
    def row(t, name, status='success', detail='', delta=None, inv=None, v=V + '+cfg', bot='b-1'):
        return {'t': t, 'bot': bot, 'v': v, 'name': name, 'status': status, 'detail': detail, 'delta': delta, 'inv': inv}
    base = [row('2026-10-23T12:00:00Z', 'gather', v='old'), row('2026-10-24T02:00:00Z', 'gather'),
            row('2026-10-24T03:00:00Z', '_well_dispose', detail='slots=34->25 offlist=0 offlist_items=- unnamed=0 freed=9 tossed=9 n=298 items=white_wool:12'),
            row('2026-10-24T04:00:00Z', '_stock_prune_visit', detail='pruned oak_log:64 from 1,2,3 well_keeps=0; thrown 64; well: success'),
            row('2026-10-24T05:00:00Z', 'town_deposit', delta={'sand': -64, 'coal': -5}, inv={'sand': 64}),
            row('2026-10-23T13:00:00Z', '_milestone_complete', v='old'), row('2026-10-24T06:00:00Z', '_milestone_complete')]
    cases = []
    def case(name, rs, want):
        got = judge(rs, since, V, now)[1]
        cases.append((name, got.split(' ')[1] if ' ' in got else got, want, got))
    case('clean', base, 'OK')
    case('T1 a part down the well', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='slots=30->29 offlist=16 offlist_items=glass:16 unnamed=0 n=16')], 'BREACH')
    case('T1 positive control: a non-part offlist is no breach', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='offlist=3 offlist_items=egg:3 unnamed=0 n=3')], 'OK')
    case('T1 unnamed throws are not readable -> WATCH', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='offlist=3 offlist_items=- unnamed=3 n=3')], 'WATCH')
    case('T1 offlist with no names -> WATCH', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='offlist=2 offlist_items=- unnamed=0 n=5')], 'WATCH')
    case('T1 offlist counts entities: 1 entity of 62 cobble is readable (real row shape)', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='offlist=1 offlist_items=cobblestone:62 unnamed=0 n=184')], 'OK')
    case('T1 more kinds than entities -> WATCH', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='offlist=1 offlist_items=egg:1,flint:1 unnamed=0 n=2')], 'WATCH')
    case('BLIND: the only well throws are unreadable', [r for r in base if r['name'] != '_well_dispose'] + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='n=9 items=x:9')], 'BLIND')
    case('T2 a prune row that does not parse -> BLIND', base + [row('2026-10-24T08:00:00Z', '_stock_prune_visit', detail='pruned ??? from 1,2,3')], 'BLIND')
    case('T2 a partly parseable prune list -> BLIND', base + [row('2026-10-24T08:00:00Z', '_stock_prune_visit', detail='pruned oak_log:64,glass:??? from 1,2,3 well_keeps=0')], 'BLIND')
    case('T2 a FAILED unparseable prune -> BLIND', base + [row('2026-10-24T08:00:00Z', '_stock_prune_visit', status='failed', detail='pruned ??? from 1,2,3')], 'BLIND')
    case('T2 a failed take of a part still breaches', base + [row('2026-10-24T08:00:00Z', '_stock_prune_visit', status='failed', detail='pruned glass:64 from 1,2,3 well_keeps=0; thrown 0')], 'BREACH')
    case('T1 a well row cut before n= -> WATCH (unreadable)', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='slots=36->30 offlist=0 offlist_items=- unnamed=0 freed=6 tossed=6')], 'WATCH')
    case('T2 only "took nothing" visits -> OK-PARTIAL (not exposed), never OK', [r for r in base if r['name'] != '_stock_prune_visit'] + [row('2026-10-24T08:00:00Z', '_stock_prune_visit', status='no_effect', detail='took nothing at 1,2,3 well_keeps=0: no full stack')], 'OK-PARTIAL')
    case('CONTEXT no baseline rows -> OK-PARTIAL, never OK', [r for r in base if r['t'] >= since], 'OK-PARTIAL')
    case('T2 a part pruned', base + [row('2026-10-24T08:00:00Z', '_stock_prune_visit', detail='pruned stone_bricks:64 from 1,2,3 well_keeps=0')], 'BREACH')
    case('T2 a stock_prune of a part', base + [row('2026-10-24T08:00:00Z', '_stock_prune', detail='group=x name=waxed_cut_copper count=64')], 'BREACH')
    case('BLIND: no rows of the version', [dict(r, v='other') for r in base], 'BLIND')
    case('BLIND: no well throw seen', [r for r in base if r['name'] != '_well_dispose'], 'BLIND')
    case('no prune visit at all -> OK-PARTIAL (T2 not exposed)', [r for r in base if r['name'] != '_stock_prune_visit'], 'OK-PARTIAL')
    case('a part thrown on ANOTHER build is not judged', base + [row('2026-10-24T07:00:00Z', '_well_dispose', detail='offlist=1 offlist_items=glass:1 n=1', v='old')], 'OK')
    nosand = [dict(r, delta={'coal': -5}) if r['name'] == 'town_deposit' else r for r in base]
    case('T3 sand carried, none banked in 25 h -> WATCH', nosand, 'WATCH')
    case('T3 not exposed (no sand carried) -> WATCH, never OK', [dict(r, inv={}, delta={'coal': -5}) if r['name'] == 'town_deposit' else r for r in base], 'WATCH')
    case('CONTEXT gather fell below 0.7x -> WATCH', base + [row('2026-10-23T%02d:00:00Z' % h, 'gather', v='old') for h in range(1, 23)], 'WATCH')
    assert len(PARTS) == 46 and 'glass' in PARTS and 'mossy_stone_bricks' not in PARTS
    bad = [c for c in cases if c[1] != c[2]]
    for c in cases:
        print('%-55s %s' % (c[0], 'ok' if c[1] == c[2] else 'FAIL: %s' % c[3]))
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
        sys.exit('usage: matsettrip.py --since ISO --version SHA8 [--hours-before H] | --selftest')
    now = dt.datetime.now(dt.timezone.utc)
    hb = a.hours_before if a.hours_before is not None else (now - dt.datetime.fromisoformat(a.since.replace('Z', '+00:00'))).total_seconds() / 3600
    lines, verdict = judge(rows(a.since, hb), a.since, a.version, now, hb)
    print('\n'.join(lines))
    print(verdict)
