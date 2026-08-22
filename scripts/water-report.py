#!/usr/bin/env python3
"""water-report.py -- how is the water competence actually doing, by code version.

    ssh mike@10.0.0.31 'python3 -' < scripts/water-report.py          # all today
    ssh mike@10.0.0.31 'python3 - 120' < scripts/water-report.py      # last 120 min

Run on the BOT host (10.0.0.31), where /var/log/mcai/*/ lives.

WHY VERSIONS AND NOT A TIME WINDOW. The skill logs were never rotated across the
Paper migration or any deploy since, so a naive window mixes code that behaves
differently -- and on 2026-08-22 five versions shipped in three hours. Every row
here is split on `code.version`, which is the only axis that separates them.

WHY IT DISCOVERS VERSIONS RATHER THAN LISTING THEM. The first draft of this query
carried a hardcoded list of shas. A version not in the list contributed nothing
and printed nothing, which is indistinguishable from "that version had no
events" -- the same shape as the unloaded-chunk probe that answered "not water"
for the entire map, and the measurement window accidentally set two minutes in
the future. A detector that cannot say "I do not know" will eventually lie.
"""
import json, glob, re, sys, collections, datetime

MINS = int(sys.argv[1]) if len(sys.argv) > 1 else None
NOW = datetime.datetime.now(datetime.timezone.utc)
CUT = NOW - datetime.timedelta(minutes=MINS) if MINS else NOW.replace(hour=0, minute=0, second=0, microsecond=0)

DROWN = {'_drowning_escaped', '_drowning_released_timeout', '_drowning_surfaced_stranded',
         '_drowning_reentry', '_drowning_no_shore', '_drowning_yielded_to_swim'}
SWIM = {'swim_to', '_swim_started', '_swim_completed', '_swim_progress', '_swim_ended'}
PATH = {'_path_reset', '_path_noPath', '_path_timeout'}

ev = collections.defaultdict(collections.Counter)
span = collections.defaultdict(lambda: [None, None])
bots = collections.defaultdict(set)
onland = collections.Counter()
crossings = collections.defaultdict(list)

for f in glob.glob('/var/log/mcai/*/skill-*.jsonl'):
    try:
        with open(f, errors='replace') as fh:
            for line in fh:
                if 'drowning' not in line and 'swim' not in line and '_path' not in line:
                    continue
                try: d = json.loads(line)
                except Exception: continue
                sk = d.get('skill') or {}
                n = sk.get('name', '')
                if n not in DROWN and n not in SWIM and n not in PATH: continue
                try: t = datetime.datetime.fromisoformat(d.get('@timestamp', '').replace('Z', '+00:00'))
                except Exception: continue
                if t < CUT: continue
                v = (d.get('code') or {}).get('version', '?').split('+')[0]
                ev[v][n] += 1
                s = span[v]
                if s[0] is None or t < s[0]: s[0] = t
                if s[1] is None or t > s[1]: s[1] = t
                bots[v].add((d.get('bot') or {}).get('name'))
                det = sk.get('detail') or ''
                if n == 'swim_to' and 'not in water' in det: onland[v] += 1
                if n == '_swim_started':
                    m = re.search(r'crossing (\d+)b', det)
                    if m: crossings[v].append(int(m.group(1)))
    except Exception:
        pass

if not ev:
    print("NO EVENTS in window — check the clock, not the fleet: a window set in "
          "the future returns exactly this.")
    sys.exit(2)

# Oldest-first, so the table reads as a history.
order = sorted(ev, key=lambda v: span[v][0])
print(f"  now {NOW:%H:%M:%S}Z   window {'last %d min' % MINS if MINS else 'since 00:00Z'}\n")
hdr = ("version", "hrs", "bots", "esc", "tmo", "strnd", "all%", "win%", "reent", "swims", "land", "yield")
print("  %-9s %5s %4s %5s %5s %6s %6s %6s %6s %6s %5s %5s" % hdr)
for v in order:
    c, s = ev[v], span[v]
    hrs = max(0.01, (s[1] - s[0]).total_seconds() / 3600)
    e, t_, st = c['_drowning_escaped'], c['_drowning_released_timeout'], c['_drowning_surfaced_stranded']
    den, win = e + t_ + st, e + t_
    print("  %-9s %5.2f %4d %5d %5d %6d %6s %6s %6d %6d %5d %5d" % (
        v, hrs, len(bots[v]), e, t_, st,
        ("%.1f" % (100 * e / den)) if den else "-",
        ("%.1f" % (100 * e / win)) if win else "-",
        c['_drowning_reentry'], c['_swim_started'], onland[v], c['_drowning_yielded_to_swim']))

print("\n  per bot-hour (40 bots)")
print("  %-9s %11s %9s %9s %9s" % ("version", "path_reset", "noPath", "strand", "reentry"))
for v in order:
    c, s = ev[v], span[v]
    bh = 40 * max(0.01, (s[1] - s[0]).total_seconds() / 3600)
    print("  %-9s %11.1f %9.1f %9.1f %9.1f" % (
        v, c['_path_reset'] / bh, c['_path_noPath'] / bh,
        c['_drowning_surfaced_stranded'] / bh, c['_drowning_reentry'] / bh))

print("\n  crossings started (blocks)")
for v in order:
    ds = sorted(crossings.get(v, []))
    if not ds: continue
    real = [x for x in ds if x >= 8]
    print("  %-9s n=%-3d  >=8b: %-3d  median %-5s max %-6s  completed %d  progress %d" % (
        v, len(ds), len(real),
        ds[len(ds) // 2] if ds else '-', ds[-1] if ds else '-',
        ev[v]['_swim_completed'], ev[v]['_swim_progress']))
print("\n  esc% = escaped/(escaped+timeout+stranded)   win% = escaped/(escaped+timeout)")
print("  A stranded bot is in open water with nowhere to stand; it is terrain, not a fault.")
