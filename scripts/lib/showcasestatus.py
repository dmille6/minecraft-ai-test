"""The showcase's one-line health summaries, shared by fleetstatus.py (from Elasticsearch) and the showcase VM's
own `tl_showcase.py status` (from the heartbeat file). Pure functions over rows (tested in
scripts/test_showcasestatus.py). Design: docs/reports/showcase-2026-10-20.md sections 4 and 6.

MISSING FRAMES ARE COUNTED FROM OUTSIDE THE JOB. A capture that is killed, hangs, or never starts cannot write
its own heartbeat, so the count here is: CAPTURE_MIN slots in the window (from frame 0 at the earliest) that hold
no ok heartbeat row -- not the job's own `missing_24h` claim. A job that never ran therefore reads as every slot
missing, not as zero.
"""
import datetime as dt

EPOCH = dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc)


def _t(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def _stamp_t(s):
    try:
        return dt.datetime.strptime(str(s)[:14], '%Y%m%dT%H%MZ').replace(tzinfo=dt.timezone.utc)
    except (TypeError, ValueError):
        return None


def missing_slots(ok_times, now, capture_min, since, window_h=24):
    """-> (missing, expected): slots [k*m,(k+1)*m) in [max(now-window, since), the open slot) with no ok time."""
    lo = max(now - dt.timedelta(hours=window_h), since)
    mins = lambda t: int((t - EPOCH).total_seconds() // 60)
    k0 = -(-mins(lo) // capture_min)
    k1 = mins(now) // capture_min
    have = {mins(t) // capture_min for t in ok_times}
    expected = list(range(k0, k1))
    return sum(1 for k in expected if k not in have), len(expected)


def timelapse_line(rows, now, frame0=None, capture_min=None, window_h=24):
    """rows: heartbeat dicts (kind showcase_timelapse) in any order. frame0: aware datetime of frame 0 (None -> the
    oldest row). -> one line starting 'SHOWCASE TIMELAPSE <OK|GAPS|STALE|NO HEARTBEAT>'."""
    rows = sorted((r for r in rows if r.get('t')), key=lambda r: r['t'])
    if not rows:
        return ('SHOWCASE TIMELAPSE NO HEARTBEAT: zero heartbeat rows -- the timer never ran, the log path is wrong, '
                'or filebeat is not shipping it (check `systemctl status showcase-tl.timer` on 10.0.0.40)')
    cm = capture_min or rows[-1].get('capture_min') or 15
    regular_ok = [r for r in rows if r.get('ok') and not r.get('event')]
    ok_times = [t for t in (_stamp_t(r.get('stamp')) for r in regular_ok) if t]
    since = frame0 or _t(rows[0]['t'])
    miss, exp = missing_slots(ok_times, now, cm, since, window_h)
    lo = now - dt.timedelta(hours=window_h)
    day = [r for r in rows if _t(r['t']) >= lo]
    fails = [r for r in day if not r.get('ok') and r.get('step') != 'skip']
    skips = [r for r in day if r.get('step') == 'skip']
    cpu = sorted((r.get('render_cpu_s') or 0) + (r.get('capture_cpu_s') or 0) for r in day if r.get('ok'))
    med = cpu[len(cpu) // 2] if cpu else None
    age = (now - max(ok_times)).total_seconds() / 60 if ok_times else None
    if age is None or age > 3 * cm:
        flag = 'STALE'
    elif miss or fails:
        flag = 'GAPS'
    else:
        flag = 'OK'
    last_fail = (f"; last failure {fails[-1]['t']} at {fails[-1].get('step')}: {str(fails[-1].get('why'))[:80]}"
                 if fails else '')
    return (f"SHOWCASE TIMELAPSE {flag}: newest frame {('%.0f min ago' % age) if age is not None else 'NEVER'}; "
            f"last {window_h} h: {exp - miss} of {exp} slots captured ({miss} missing), {len(fails)} failed runs, "
            f"{len(skips)} overrun skips; median {med if med is not None else '?'} CPU-s per capture; "
            f"every {cm} min{last_fail}")


def pause_line(rows, now):
    """From the newest heartbeat's `brain` field (the proxy's /healthz through the tunnel). -> a line or None."""
    rows = sorted((r for r in rows if r.get('t') and isinstance(r.get('brain'), dict)), key=lambda r: r['t'])
    if not rows:
        return None
    b = rows[-1]['brain']
    if b.get('fault'):
        return (f"SHOWCASE BRAIN FAULT: {b['fault']} -- admission is closed (every decision is refused); remedy: on the "
                f"Studio remove ~/showcase/QUIESCED.handoff by hand (check its permissions / the disk) -- not a pause")
    if b.get('paused_by'):
        since = b.get('paused_since')
        hrs = (now - _t(since)).total_seconds() / 3600 if since else None
        return (f"SHOWCASE BRAIN PAUSED by {b['paused_by']} since {since or '?'}"
                + (f' ({hrs:.1f} h)' if hrs is not None else '')
                + (' -- a stale holder? check it on the Studio' if hrs is not None and hrs > 6 else ''))
    if not b.get('ok'):
        return f"SHOWCASE BRAIN DOWN at {rows[-1]['t']}: {b.get('error')}"
    return None


BRAIN_SETTING_STALE = dt.timedelta(hours=2)     # a heartbeat row every capture_min (15): eight missed in a row is no setting


def brain_expected(rows, now, stale=BRAIN_SETTING_STALE):
    """The brain the showcase is SET to, as the newest heartbeat's `brain` object carries it (tl_showcase.brain_health puts
    make_env.load_brain's reading of /srv/showcase/BRAIN.json there: the tripwire's reading, tripbrain-01)
    -> ({'url', 'model', 'kind'}, None) or (None, why).
    NEVER A DEFAULT. No heartbeat with a brain object, one older than `stale`, or one that names no url and model (a
    BRAIN.json nobody could read, or a tl_showcase.py from before monfix-01) is (None, why): brain_line then judges nothing
    and says so. The reader before this one had the Studio proxy and gemma4 written into it and called every decision of
    the owner's permanent qwen2.5 on the 5080 a row "from a NON-showcase endpoint"."""
    rows = sorted((r for r in rows or [] if r.get('t') and isinstance(r.get('brain'), dict)), key=lambda r: r['t'])
    if not rows:
        return None, 'no heartbeat row carries a brain object'
    r = rows[-1]
    try:
        age = now - _t(r['t'])
    except (TypeError, ValueError):
        return None, f'the newest heartbeat has no readable time ({str(r["t"])[:30]!r})'
    if age > stale:
        return None, f'the newest heartbeat is {age.total_seconds() / 3600:.1f} h old ({r["t"]})'
    b = r['brain']
    url, model = b.get('url'), b.get('model')
    if not (isinstance(url, str) and url and isinstance(model, str) and model):
        return None, (f'the heartbeat of {r["t"]} names no brain setting'
                      + (f': {str(b["error"])[:120]}' if b.get('error') else
                         ' (tl_showcase.py on 10.0.0.40 is older than monfix-01, which put it there)'))
    return {'url': url, 'model': model, 'kind': b.get('kind')}, None


def _set_model(m, expect):
    """Is served model `m` the set one? The name itself; behind the designed proxy the family ('gemma4:26b' ~ gemma4), as
    the 10-20 check counted it (the proxy serves the tag it holds)."""
    m, want = str(m), str(expect['model'])
    return m == want or (expect.get('kind') == 'proxy' and m.split(':', 1)[0] == want.split(':', 1)[0])


def brain_off(models, endpoints, expect):
    """-> (rows served by a model other than the set one, rows at an endpoint other than the set one); (None, None) when
    the setting is unread -- unknown is not zero."""
    if not expect:
        return None, None
    return (sum(n for m, n in models.items() if not _set_model(m, expect)),
            sum(n for u, n in endpoints.items() if u != expect['url']))


def brain_line(models, unserved, total, endpoints, expect, unread=None):
    """models: {served model: rows}; unserved: rows that name no model; endpoints: {llm.endpoint: rows}, rows with NO
    endpoint left out (a work order: the scheduler chose, no model was asked -- latency 0, the model's name, no endpoint;
    11-16: 371 of 3,296 rows in 3 h, all with latency 0); expect / unread: brain_expected()'s pair. -> one line.
    '!! ' when the setting is unread (nothing is judged: an unread setting never passes) and when any row names a model
    or an endpoint other than the set one (must be 0)."""
    if not expect:
        why = f'the brain setting is UNREAD ({unread or "no reason given"})'
        if not total:
            return f'!! SHOWCASE BRAIN: no llm rows in the window (bots not started, or not shipping); {why}'
        return (f'!! SHOWCASE BRAIN: {why} -- {total} llm rows NOT JUDGED against it: models '
                f'{dict(sorted(models.items()))}, unserved {unserved}; endpoints '
                + (', '.join(f'{u} {n}' for u, n in sorted(endpoints.items())) or 'none')
                + f'; no endpoint {total - sum(endpoints.values())}')
    tag = f"[set: {expect.get('kind') or '?'} {expect['model']} at {expect['url']}]"
    if not total:
        return f'SHOWCASE BRAIN: no llm rows in the window (bots not started, or not shipping) {tag}'
    served = sum(models.values())
    other, foreign = brain_off(models, endpoints, expect)
    on, at = served - other, endpoints.get(expect['url'], 0)
    bad = []
    if other:
        bad.append(f'{other} rows by a model that is not the set one ('
                   + ', '.join(f'{m} x{n}' for m, n in sorted(models.items()) if not _set_model(m, expect)) + ')')
    if foreign:
        bad.append(f'{foreign} rows at an endpoint that is not the set one ('
                   + ', '.join(f'{u} x{n}' for u, n in sorted(endpoints.items()) if u != expect['url']) + ')')
    return (('!! ' if bad else '')
            + f"SHOWCASE BRAIN: {total} decisions; {expect['model']} {on} ({100 * on / total:.1f}%), "
              f"other models {other} ({100 * other / total:.1f}%) {dict(sorted(models.items()))}, "
              f"unserved {unserved} ({100 * unserved / total:.1f}%); at the set endpoint {at}, no endpoint "
              f"{total - sum(endpoints.values())} (work orders: no model asked), elsewhere {foreign} {tag}"
            + (' -- NOT THE SET BRAIN (must be 0): ' + '; '.join(bad) if bad else ''))
