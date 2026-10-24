#!/usr/bin/env python3
"""rescue_line.py -- the fleetstatus header line for ceilescape-01's `_needs_rescue` flag. The block between the markers is
what patch_fleetstatus.py inserts into the INSTALLED fleetstatus.py (it relies on that file's `dt`, `re` and `EsEvents`).

    python3 rescue_line.py --selftest       # the pure decision against fixtures
    python3 rescue_line.py                  # print the line now (needs ES; run on 10.0.0.31 from ~/estel/scripts)
"""
import datetime as dt
import re
import sys

# >>> rescue_line (ceilescape-01)
# NEEDS RESCUE (ceilescape-01, docs/reports/ceilescape-01-design-2026-10-24.md section 5). A bot whose ramp found that no
# swing of its firing could finish even in a fresh firing writes `_needs_rescue`; this surfaces it where a human reads, not in
# a file nobody opens (the 10-20 ELK lesson). A bot is listed while its LATEST `_ceilescape` row in the window is
# action=escalate AND it has not moved more than 2 blocks from that row's `at` since (a freed or rescued bot drops off: Codex
# design r1 P2-10). Positive control: the rows read are printed. NEVER raises.
RESCUE_WINDOW = dt.timedelta(hours=3)
RESCUE_MOVED = 2.0
_RKV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')


def rescue_flags(ce_rows, latest_pos):
    """ce_rows: [(bot, iso_ts, detail)] of `_ceilescape` rows; latest_pos: {bot: (x, y, z)} -> [(bot, at, since_iso, reason)]."""
    last, first_esc = {}, {}
    for bot, ts, det in sorted(ce_rows, key=lambda r: r[1]):
        k = {m.group(1): m.group(2) for m in _RKV.finditer(det or '')}
        last[bot] = (ts, k, det)
        if k.get('action') == 'escalate':
            first_esc.setdefault((bot, k.get('at')), ts)
        else:
            first_esc = {key: v for key, v in first_esc.items() if key[0] != bot}
    out = []
    for bot, (ts, k, det) in sorted(last.items()):
        if k.get('action') != 'escalate':
            continue
        try:
            ax, ay, az = (float(v) for v in (k.get('at') or '').split(','))
        except ValueError:
            continue
        p = latest_pos.get(bot)
        if p is not None and max(abs(p[0] - ax - 0.5), abs(p[2] - az - 0.5), abs(p[1] - ay)) > RESCUE_MOVED + 0.5:
            continue
        reason = (det.split(' -- ', 1)[1] if ' -- ' in det else '')[:110]
        out.append((bot, k.get('at'), first_esc.get((bot, k.get('at')), ts), reason))
    return out


def rescue_line(now, client=None):
    """One header line. NEVER raises."""
    try:
        until = now - dt.timedelta(minutes=5)
        ev = EsEvents.load('skill', since=until - RESCUE_WINDOW, until=until, gaps='clip')
        names = ev.names()
        n_ce, n_nr = names.get('_ceilescape', 0), names.get('_needs_rescue', 0)
        if not n_ce:
            return f'needs rescue (ceilescape-01): no _ceilescape rows in {RESCUE_WINDOW.total_seconds() / 3600:.0f} h -- not deployed here, or not firing'
        rows = [((r.get('bot') or {}).get('name'), r.get('@timestamp'), (r.get('skill') or {}).get('detail') or '')
                for r in ev.rows('_ceilescape', fields=['bot.name', 'skill.detail', '@timestamp'], max_rows=50_000, allow_zero=True)]
        pos = {}
        try:
            for b, s in ev.latest(require='bot.pos.x', fields=['bot.pos'], allow_zero=True).items():
                q = (s.get('bot') or {}).get('pos') or {}
                if q.get('x') is not None:
                    pos[b] = (float(q['x']), float(q['y']), float(q['z']))
        except Exception:   # noqa: BLE001 -- without positions every escalated bot is listed: louder, never quieter
            pass
        flags = rescue_flags(rows, pos)
        ctl = f'(read {n_ce} _ceilescape, {n_nr} _needs_rescue rows in {RESCUE_WINDOW.total_seconds() / 3600:.0f} h)'
        if not flags:
            return f'needs rescue (ceilescape-01): none {ctl}'
        items = '; '.join(f'{b} at {at} since {str(s)[11:16]}Z ({why})' for b, at, s, why in flags)
        return f'!! needs rescue (ceilescape-01): {len(flags)} bot(s): {items} {ctl}'
    except Exception as e:   # noqa: BLE001 -- the fleet report must never fall over on this line
        return f'!! needs rescue (ceilescape-01): UNREADABLE ({type(e).__name__}: {str(e)[:80]}) -- not a quiet zero, an absent read'
# <<< rescue_line


def selftest():
    E = 'where=ceiling at=559,37,219 block=stone action=escalate -- no affordable ramp exit: stone 187.5s'
    W = 'where=ceiling at=559,37,219 block=stone action=wait -- a fresh firing would fit'
    L = 'where=ceiling at=359,40,187 block=copper_ore action=lateral -- take E'
    f = rescue_flags([('placebo-c-Bravo', '2026-10-24T01:00:00Z', E)], {'placebo-c-Bravo': (559.5, 37.2, 219.5)})
    assert [x[0] for x in f] == ['placebo-c-Bravo'] and f[0][2] == '2026-10-24T01:00:00Z', f
    assert rescue_flags([('placebo-c-Bravo', '2026-10-24T01:00:00Z', E), ('placebo-c-Bravo', '2026-10-24T01:10:00Z', W)], {}) == [], 'a later non-escalation clears'
    assert rescue_flags([('placebo-c-Bravo', '2026-10-24T01:00:00Z', E)], {'placebo-c-Bravo': (580.5, 64.0, 219.5)}) == [], 'a bot that moved away drops off'
    assert rescue_flags([('board-a-Comet', '2026-10-24T01:00:00Z', L)], {}) == []
    assert rescue_flags([('placebo-c-Bravo', '2026-10-24T01:00:00Z', E)], {})[0][0] == 'placebo-c-Bravo', 'no position: listed (louder, never quieter)'
    # the episode start is the first escalation of the current unbroken run at that cell
    run = [('b', '2026-10-24T01:00:00Z', E), ('b', '2026-10-24T01:05:00Z', W), ('b', '2026-10-24T01:20:00Z', E), ('b', '2026-10-24T01:40:00Z', E)]
    assert rescue_flags(run, {})[0][2] == '2026-10-24T01:20:00Z'
    print('SELFTEST ok')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    sys.path.insert(0, '.')
    from lib.estelemetry import EsEvents  # noqa: E402
    print(rescue_line(dt.datetime.now(dt.timezone.utc)))
