#!/usr/bin/env python3
"""THE MONITOR: append a timestamped snapshot of the signals we could not see before.

Everything else in scripts/ answers a question ONCE. This records a series, because the
question that has cost this project the most -- "did that change anything?" -- needs a
before, and for a month there wasn't one. Fleet-wide before/after is not causal evidence
(pools moved -45% to +77% in six hours with no code change) but a series is the only way
to tell a step from a drift at all.

Two roles, because the data lives on two hosts:
  --role world   on the worlds host: per-world TPS/mspt over RCON + per-bot server stats
  --role bots    on the bots host:   fail_class histogram + which instruments are silent

Appends one JSON object per run to OUT (default /var/log/mcai-monitor/<role>.jsonl) and
prints a one-line human summary. Never raises into cron: a monitor that dies on a bad
sample stops being a monitor.

Usage: sudo python3 monitor.py --role world [--out PATH] [--quiet]
"""
import argparse
import datetime
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
sys.path.insert(0, HERE)

DEFAULT_DIR = '/var/log/mcai-monitor'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def collect_world():
    import worldhealth as W
    out = {'worlds': [], 'bots': []}
    for w in W.LIVE:
        out['worlds'].append(W.sample(w))
    tps = [r['tps'][0] for r in out['worlds'] if r.get('tps')]
    if tps:
        out['tps_min'], out['tps_max'] = min(tps), max(tps)
        out['tps_spread_pct'] = round(100.0 * (max(tps) - min(tps)) / max(tps), 2)
        out['c17_pass'] = out['tps_spread_pct'] <= W.C17_LIMIT_PCT
    msptmax = [max(r['mspt']) for r in out['worlds'] if r.get('mspt')]
    if msptmax:
        out['mspt_max_worst'] = max(msptmax)

    import botstats as B
    tm = tp = deaths = 0
    for w in B.LIVE:
        for s in B.SUFFIXES:
            bot = f'{w}-{s}'
            st = B.read(w, bot)
            if st is None:
                continue
            lm, lp = B.logs_of(st, 'mined'), B.logs_of(st, 'picked_up')
            d = B.g(st, 'custom', 'deaths')
            tm += lm; tp += lp; deaths += d
            out['bots'].append({'bot': bot, 'logs_mined': lm, 'logs_got': lp,
                                'deaths': d,
                                'walk_km': round(B.g(st, 'custom', 'walk_one_cm') / 100000.0, 2)})
    out['logs_mined_total'] = tm
    out['logs_got_total'] = tp
    out['deaths_total'] = deaths
    out['bots_with_stats'] = len(out['bots'])
    return out


def collect_bots(minutes=30):
    from telemetry import Events
    import vocabulary
    ev = Events.load(since_minutes=minutes)
    out = {'window_min': minutes, 'rows': len(ev.rows), 'bots': len(ev.bots()),
           'versions': ev.versions()}
    deaths, skills_ = {}, {}
    for r in ev.rows:
        fc = r.get('fail_class')
        if not fc:
            continue
        d = deaths if str(r['name']) in vocabulary.DEATH_CAUSE_KINDS else skills_
        k = str(fc).lower()
        d[k] = d.get(k, 0) + 1
    out['fail_class'] = skills_
    out['death_cause'] = deaths
    live = [v for v in out['versions'] if v and v != '?']
    if len(live) == 1:
        try:
            can = vocabulary.extract(os.environ.get('MCAI_REPO', '/opt/minecraft-ai'),
                                     live[0])['fail_class']
            out['can_emit'] = len(can)
            out['fired'] = len(skills_)
            out['silent'] = sorted(can - set(skills_))
            out['unexplained'] = sorted(set(skills_) - can)
        except Exception as e:
            out['registry_error'] = f'{type(e).__name__}: {e}'
    else:
        out['registry_error'] = f'{len(live)} builds in window; registry is per build'
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--role', required=True, choices=('world', 'bots'))
    ap.add_argument('--out')
    ap.add_argument('--minutes', type=int, default=30)
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args()

    rec = {'at': now(), 'role': a.role}
    try:
        rec.update(collect_world() if a.role == 'world' else collect_bots(a.minutes))
        rec['ok'] = True
    except Exception as e:
        # A monitor that dies on a bad sample stops being a monitor. Record the failure
        # AS a sample so a gap in the series is visible rather than silent.
        rec['ok'] = False
        rec['error'] = f'{type(e).__name__}: {e}'
        rec['traceback'] = traceback.format_exc()[-800:]

    path = a.out or os.path.join(DEFAULT_DIR, f'{a.role}.jsonl')
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'a') as f:
            f.write(json.dumps(rec) + '\n')
    except Exception as e:
        print(f'monitor: COULD NOT WRITE {path}: {e}', file=sys.stderr)
        return 1

    if not a.quiet:
        if not rec['ok']:
            print(f"{rec['at']} {a.role}: FAILED {rec['error'][:120]}")
        elif a.role == 'world':
            print(f"{rec['at']} world: tps {rec.get('tps_min','?')}-{rec.get('tps_max','?')} "
                  f"spread {rec.get('tps_spread_pct','?')}% C17={'PASS' if rec.get('c17_pass') else 'FAIL'} | "
                  f"mspt worst {rec.get('mspt_max_worst','?')} | "
                  f"logs mined {rec.get('logs_mined_total',0)} got {rec.get('logs_got_total',0)} | "
                  f"deaths {rec.get('deaths_total',0)} | bots {rec.get('bots_with_stats',0)}")
        else:
            print(f"{rec['at']} bots: {rec.get('rows',0)} rows/{rec.get('bots',0)} bots | "
                  f"classes fired {rec.get('fired','?')}/{rec.get('can_emit','?')} | "
                  f"silent {len(rec.get('silent',[]))} | unexplained {len(rec.get('unexplained',[]))}"
                  + (f" | REGISTRY: {rec['registry_error'][:60]}" if rec.get('registry_error') else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
