#!/usr/bin/env python3
"""Record the three conditions that would justify breaking the code freeze.

RECORDS ONLY. It does not halt the fleet and it does not restart anything.
The death tripper on this project halts a fleet, and a tripper firing at 03:00
on a metric nobody has validated is a worse outcome than the thing it fires on.
What this produces is a row every thirty minutes, so the question "did anything
break overnight" is answered by reading a file rather than by reconstructing it
from raw logs the morning after.

The three tripwires, agreed 2026-08-26 with the fleet uniform on 16e7e77:

  1. drowning deaths per bot-hour sustained >50% above the 0.044 baseline
  2. bots not staying up, or host load past ~14
  3. a bot terminally stuck in a NEW way -- the descent rescue went fleet-wide
     without ever being tested at fleet scale, so it is the least-proven part
     of the frozen bundle

Baseline is 04:00Z-21:00Z on 2026-08-26: a stable-ish build over 17 hours, 61
drowning deaths, and the window in which drowning rose 51%.
"""
import json, glob, datetime, os, collections, math

STATE = os.environ.get('MCAI_STATE', '/var/lib/mcai')
LOGS = os.environ.get('MCAI_LOGS', '/var/log/mcai')
OUT = os.path.join(STATE, '_freeze-watch.jsonl')
BASELINE_DROWN_PER_BOT_HOUR = 0.044
WINDOW_H = 2.0


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    cut = now - datetime.timedelta(hours=WINDOW_H)
    deaths = collections.Counter()
    versions = collections.Counter()
    bots, high, lastpos = set(), {}, {}

    for f in glob.glob(f'{LOGS}/*/skill-*.jsonl'):
        bot = f.split('/')[4]
        try:
            fh = open(f, errors='replace')
            fh.seek(max(0, fh.seek(0, 2) - 2_000_000)); fh.readline()
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    d = json.loads(line)
                    t = datetime.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                except Exception:
                    continue
                if t < cut:
                    continue
                bots.add(bot)
                sk = d.get('skill') or {}
                p = (d.get('bot') or {}).get('pos')
                if p:
                    lastpos[bot] = (p.get('x'), p.get('y'), p.get('z'))
                if sk.get('name') == '_death':
                    det = sk.get('detail') or ''
                    deaths['drown' if 'drown' in det else
                           'fall' if 'high place' in det else
                           'lava' if 'lava' in det else 'other'] += 1
                if sk.get('name') == '_ride_floor_down':
                    high[bot] = (sk.get('status'), (sk.get('detail') or '')[:80])

    for f in glob.glob(f'{LOGS}/*/llm-*.jsonl'):
        try:
            fh = open(f, errors='replace')
            fh.seek(max(0, fh.seek(0, 2) - 120_000)); fh.readline()
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    d = json.loads(line)
                    t = datetime.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                except Exception:
                    continue
                if t >= cut:
                    versions[(d.get('code') or {}).get('version')] += 1

    nb = max(1, len(bots))
    drown_rate = deaths['drown'] / nb / WINDOW_H
    try:
        load = os.getloadavg()[0]
    except OSError:
        load = None
    # Stranded is the descent rescue's blast radius: bots left above the climb
    # ceiling are what it exists to prevent, so a RISE is the signal.
    stranded = sorted(b for b, p in lastpos.items() if (p[1] or 0) >= 200)

    row = {
        't': now.isoformat(),
        'bots_reporting': len(bots),
        'versions': dict(versions),
        'split': len(versions) > 1,
        'deaths_2h': dict(deaths),
        'drown_per_bot_hour': round(drown_rate, 4),
        'drown_vs_baseline': round(drown_rate / BASELINE_DROWN_PER_BOT_HOUR, 2)
                             if BASELINE_DROWN_PER_BOT_HOUR else None,
        'load1': load,
        'stranded_above_200': stranded,
        'ride_floor_down_2h': len(high),
    }
    row['tripwires'] = [k for k, hit in (
        ('drowning_up_50pct', drown_rate > BASELINE_DROWN_PER_BOT_HOUR * 1.5),
        ('bots_missing', len(bots) < 70),
        ('load_high', bool(load and load > 14)),
        ('fleet_split', len(versions) > 1),
        ('stranded_bots', len(stranded) > 3),
    ) if hit]

    with open(OUT, 'a') as fh:
        fh.write(json.dumps(row) + '\n')
    print(json.dumps(row, indent=1))
    # Exit 0 always: this is a recorder. A non-zero exit would make the timer
    # look failed and would eventually get it disabled, which is how a watch
    # stops watching.
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
