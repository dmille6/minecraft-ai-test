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
    if b.get('paused_by'):
        since = b.get('paused_since')
        hrs = (now - _t(since)).total_seconds() / 3600 if since else None
        return (f"SHOWCASE BRAIN PAUSED by {b['paused_by']} since {since or '?'}"
                + (f' ({hrs:.1f} h)' if hrs is not None else '')
                + (' -- a stale holder? check it on the Studio' if hrs is not None and hrs > 6 else ''))
    if not b.get('ok'):
        return f"SHOWCASE BRAIN DOWN at {rows[-1]['t']}: {b.get('error')}"
    return None


def brain_line(llm_rows_by_model, failed, total, fallback_endpoint_rows=0):
    """llm_rows_by_model: {served model: count}; failed: decisions nothing served. -> one line."""
    served = sum(llm_rows_by_model.values())
    if not total:
        return 'SHOWCASE BRAIN: no llm rows in the window (bots not started, or not shipping)'
    gem = sum(n for m, n in llm_rows_by_model.items() if str(m).startswith('gemma4'))
    other = served - gem
    return (f"SHOWCASE BRAIN: {total} decisions; gemma4 {gem} ({100 * gem / total:.1f}%), "
            f"fallback/other {other} ({100 * other / total:.1f}%) {dict(sorted(llm_rows_by_model.items()))}, "
            f"unserved {failed} ({100 * failed / total:.1f}%)"
            + (f'; {fallback_endpoint_rows} rows from a NON-showcase endpoint (must be 0)' if fallback_endpoint_rows else ''))
