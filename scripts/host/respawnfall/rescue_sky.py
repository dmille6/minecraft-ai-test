#!/usr/bin/env python3
"""rescue_sky.py -- the fleetstatus header line for respawnfall-01's `_needs_rescue arm=sky_descend` flag (design section 8.4).
ceilescape-01's rescue_line.py lists `_ceilescape action=escalate` bots; this lists bots sky_descend is holding on a high
platform. When ceilescape-01 lands the two become one `needs rescue` line (the block between the markers is written to be
inserted beside rescue_line's, relying on the installed fleetstatus.py's `dt`, `re` and `EsEvents`).

    python3 rescue_sky.py --selftest       # the pure decision against fixtures
    python3 rescue_sky.py                  # print the line now (needs ES; run on 10.0.0.31 from ~/estel/scripts)
"""
import datetime as dt
import re
import sys

# >>> rescue_sky (respawnfall-01)
# A bot is listed while its LATEST `_sky_descend` row in the window is a stay (`stay:` or `stopped:`) AND it has not moved more
# than SKY_MOVED blocks from that row's position since (a bot that climbed down, was freed or died drops off). Positive
# control: the rows read are printed. NEVER raises.
SKY_WINDOW = dt.timedelta(hours=3)
SKY_MOVED = 2.0


def sky_flags(rows, latest_pos):
    """rows: [(bot, iso_ts, detail, (x, y, z) | None)] of `_sky_descend` rows; latest_pos: {bot: (x, y, z)}
    -> [(bot, at, since_iso, why)]. Pure."""
    last, first = {}, {}
    for bot, ts, det, pos in sorted(rows, key=lambda r: r[1]):
        stay = (det or '').startswith(('stay:', 'stopped:'))
        last[bot] = (ts, det, pos, stay)
        if stay:
            first.setdefault(bot, ts)
        else:
            first.pop(bot, None)
    out = []
    for bot, (ts, det, pos, stay) in sorted(last.items()):
        if not stay:
            continue
        p = latest_pos.get(bot)
        if p is not None and pos is not None and max(abs(p[0] - pos[0]), abs(p[1] - pos[1]), abs(p[2] - pos[2])) > SKY_MOVED:
            continue
        at = ','.join(str(int(v // 1)) for v in pos) if pos else '?'
        m = re.search(r'open below (\S+) onto (\w+); blocks have (\d+) need ([^;\s]+)', det or '')
        why = f'{m.group(1)} open onto {m.group(2)}, {m.group(3)} blocks of {m.group(4)}' if m else (det or '')[:80]
        out.append((bot, at, first.get(bot, ts), why))
    return out


def rescue_sky_line(now, client=None):
    """One header line. NEVER raises."""
    try:
        until = now - dt.timedelta(minutes=5)
        ev = EsEvents.load('skill', since=until - SKY_WINDOW, until=until, gaps='clip')
        names = ev.names()
        n_sd, n_nr = names.get('_sky_descend', 0), names.get('_needs_rescue', 0)
        if not n_sd:
            return f'needs rescue (respawnfall-01): no _sky_descend rows in {SKY_WINDOW.total_seconds() / 3600:.0f} h -- not deployed here, or no platform respawn'
        rows = []
        for r in ev.rows('_sky_descend', fields=['bot.name', 'bot.pos', 'skill.detail', '@timestamp'], max_rows=50_000, allow_zero=True):
            q = (r.get('bot') or {}).get('pos') or {}
            pos = (float(q['x']), float(q['y']), float(q['z'])) if q.get('x') is not None else None
            rows.append(((r.get('bot') or {}).get('name'), r.get('@timestamp'), (r.get('skill') or {}).get('detail') or '', pos))
        pos = {}
        try:
            for b, s in ev.latest(require='bot.pos.x', fields=['bot.pos'], allow_zero=True).items():
                q = (s.get('bot') or {}).get('pos') or {}
                if q.get('x') is not None:
                    pos[b] = (float(q['x']), float(q['y']), float(q['z']))
        except Exception:   # noqa: BLE001 -- without positions every held bot is listed: louder, never quieter
            pass
        flags = sky_flags(rows, pos)
        ctl = f'(read {n_sd} _sky_descend, {n_nr} _needs_rescue rows in {SKY_WINDOW.total_seconds() / 3600:.0f} h)'
        if not flags:
            return f'needs rescue (respawnfall-01): none {ctl}'
        items = '; '.join(f'{b} at {at} since {str(s)[11:16]}Z ({why})' for b, at, s, why in flags)
        return f'!! needs rescue (respawnfall-01): {len(flags)} bot(s) held on a platform: {items} {ctl}'
    except Exception as e:   # noqa: BLE001 -- the fleet report must never fall over on this line
        return f'!! needs rescue (respawnfall-01): UNREADABLE ({type(e).__name__}: {str(e)[:80]}) -- not a quiet zero, an absent read'
# <<< rescue_sky


def selftest():
    S = 'stay: y 181.0 -> 181.0; open below 108 onto solid; blocks have 0 need 105; placed 0 rode 0'
    G = 'grounded: y 181.0 -> 74.0; open below 108 onto solid; blocks have 288 need 105; placed 105 rode 3'
    P = (4353.5, 181.0, 4147.5)
    f = sky_flags([('isolated-a-Comet', '2026-10-24T01:00:00Z', S, P)], {'isolated-a-Comet': P})
    assert f == [('isolated-a-Comet', '4353,181,4147', '2026-10-24T01:00:00Z', '108 open onto solid, 0 blocks of 105')], f
    assert sky_flags([('b', '2026-10-24T01:00:00Z', S, P), ('b', '2026-10-24T01:10:00Z', G, P)], {}) == [], 'a later descent clears'
    assert sky_flags([('b', '2026-10-24T01:00:00Z', S, P)], {'b': (4353.5, 74.0, 4147.5)}) == [], 'a bot that came down drops off'
    assert sky_flags([('b', '2026-10-24T01:00:00Z', S, P)], {})[0][0] == 'b', 'no position: listed (louder, never quieter)'
    run = [('b', '2026-10-24T01:00:00Z', S, P), ('b', '2026-10-24T01:05:00Z', G, P), ('b', '2026-10-24T01:20:00Z', S, P), ('b', '2026-10-24T01:40:00Z', S, P)]
    assert sky_flags(run, {})[0][2] == '2026-10-24T01:20:00Z', 'the episode starts at the first stay of the current run'
    global EsEvents

    class FakeEv:
        def __init__(self, rows):
            self._rows = rows
        def names(self):
            return {'_sky_descend': len(self._rows), '_needs_rescue': 1} if self._rows else {}
        def rows(self, kind, fields=None, max_rows=None, allow_zero=False):
            assert kind == '_sky_descend' and 'skill.detail' in fields and 'bot.pos' in fields and allow_zero
            return iter({'bot': {'name': b, 'pos': {'x': p[0], 'y': p[1], 'z': p[2]}}, '@timestamp': ts, 'skill': {'detail': d}} for b, ts, d, p in self._rows)
        def latest(self, require=None, fields=None, allow_zero=False):
            return {}

    class FakeEs:
        nxt = None
        @classmethod
        def load(cls, kind, since=None, until=None, gaps=None):
            assert kind == 'skill' and gaps == 'clip'
            return cls.nxt
    EsEvents = FakeEs
    now = dt.datetime(2026, 10, 24, 3, 0, tzinfo=dt.timezone.utc)
    FakeEs.nxt = FakeEv([('isolated-a-Comet', '2026-10-24T01:00:00Z', S, P)])
    line = rescue_sky_line(now)
    assert line.startswith('!! needs rescue (respawnfall-01): 1 bot(s)') and '(read 1 _sky_descend' in line, line
    FakeEs.nxt = FakeEv([])
    assert 'no _sky_descend rows' in rescue_sky_line(now)
    FakeEs.nxt = None
    assert 'UNREADABLE' in rescue_sky_line(now)
    print('SELFTEST ok')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    sys.path.insert(0, '/home/mike/estel/scripts')
    from lib.estelemetry import EsEvents  # noqa: E402
    print(rescue_sky_line(dt.datetime.now(dt.timezone.utc)))
