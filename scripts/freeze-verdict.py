#!/usr/bin/env python3
"""The freeze verdict: did the water work help, and by which denominator.

WALKS FULL LOG FILES. Every ad-hoc query in this investigation seeked to the
last N megabytes of each file to stay fast, and that quietly truncates the
OLDEST window as the files grow -- the pre-freeze drowning count moved from 42
to 33 between two runs of the same query, hours apart, because the baseline was
being eaten. A verdict computed that way understates the baseline and flatters
whatever came after.

BOTH DENOMINATORS, ALWAYS. Per bot-hour says the water work made things worse;
per water episode says it made them better. Both are true, and this project has
now twice reached a wrong conclusion by quoting one alone -- most recently on
2026-08-26, when a per-rescue improvement was announced as a win while deaths
per bot-hour rose 51%.

EXCLUDES THE OUTAGE. 2026-08-27 14:00-21:00Z: a power cut took the fleet host
down and the inference host stayed down five hours longer. Decision volume
looked NORMAL through it -- in fact slightly high, because failing decisions are
faster than real ones -- while 93% aborted on `all N llm endpoint(s) failed`.
freeze-watch recorded drown/bh = 0.0000 for the whole stretch, because bots that
cannot decide do not walk into water. Left in, it biases drowning downward and
looks like success.
"""
import json, glob, os, sys, datetime, collections

LOGS = os.environ.get('MCAI_LOGS', '/var/log/mcai')
FREEZE = datetime.datetime.fromisoformat('2026-08-26T22:30:00+00:00')
OUT_A = datetime.datetime.fromisoformat('2026-08-27T14:00:00+00:00')
OUT_B = datetime.datetime.fromisoformat('2026-08-27T21:00:00+00:00')
BASE_A = datetime.datetime.fromisoformat('2026-08-26T04:00:00+00:00')


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    wins = [('baseline (pre-freeze)', BASE_A, FREEZE),
            ('frozen', FREEZE, now)]
    acc = {w[0]: collections.Counter() for w in wins}
    bots = {w[0]: set() for w in wins}
    excluded = collections.Counter()
    scanned = lines = 0

    for f in glob.glob(f'{LOGS}/*/skill-*.jsonl'):
        bot = f.split('/')[4]
        scanned += 1
        try:
            fh = open(f, errors='replace')          # FULL FILE, no seek
        except OSError:
            continue
        with fh:
            for line in fh:
                lines += 1
                # THE DENOMINATOR MUST NOT COME FROM THE NUMERATOR.
                #
                # This `continue` used to sit above the `bots[name].add(bot)`
                # below, so the "bots" set only ever contained bots that DIED or
                # drowned. Every per-bot-hour rate in this report was therefore
                # divided by the number of casualties, not the number running --
                # a denominator the treatment itself moves, in the direction
                # that hides improvement. Measured: it read 71 and 68 against a
                # true roster of 80, and reported -1.4% where the truth was
                # -5.6%.
                #
                # Exposure is now established from ANY line the bot logged,
                # before the death filter, which is the only way a quiet healthy
                # bot counts as much as a dying noisy one.
                if '"@timestamp"' in line:
                    try:
                        td = json.loads(line)
                        tt = datetime.datetime.fromisoformat(
                            td['@timestamp'].replace('Z', '+00:00'))
                    except Exception:
                        tt = None
                    if tt is not None and not (OUT_A <= tt < OUT_B):
                        for wname, wa, wb in wins:
                            if wa <= tt < wb:
                                bots[wname].add(bot)
                if '"_death"' not in line and '"_reflex_drowning"' not in line:
                    continue
                try:
                    d = json.loads(line)
                    t = datetime.datetime.fromisoformat(
                        d['@timestamp'].replace('Z', '+00:00'))
                except Exception:
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name', '')
                det = sk.get('detail') or ''
                if OUT_A <= t < OUT_B:
                    excluded[n] += 1
                    continue
                for name, a, b in wins:
                    if not (a <= t < b):
                        continue
                    c = acc[name]
                    bots[name].add(bot)
                    if n == '_reflex_drowning':
                        c['episodes'] += 1
                    elif n == '_death':
                        c['deaths'] += 1
                        if 'drown' in det:
                            c['drown'] += 1
                            if 'idle' in det:
                                c['drown_idle'] += 1
                        elif 'high place' in det:
                            c['fall'] += 1
                        elif 'lava' in det:
                            c['lava'] += 1

    print(f'\n  FREEZE VERDICT — {scanned} files, {lines:,} lines, FULL walk')
    print(f'  excluded 08-27 14:00-21:00Z (outage): '
          f'{excluded["_death"]} deaths, {excluded["_reflex_drowning"]} episodes\n')
    print('  %-22s %6s %5s %7s %9s %11s %12s' % (
        'WINDOW', 'HOURS', 'BOTS', 'DROWN', 'EPISODES', 'per bot-h', 'per 1k epis'))

    base = {}
    for name, a, b in wins:
        c = acc[name]
        hrs = (b - a).total_seconds() / 3600
        if name == 'frozen':
            hrs -= (OUT_B - OUT_A).total_seconds() / 3600
        nb = len(bots[name]) or 1
        ph = c['drown'] / nb / hrs if hrs else 0
        pe = 1000 * c['drown'] / c['episodes'] if c['episodes'] else 0
        if not base:
            base = {'ph': ph, 'pe': pe}
        print('  %-22s %6.1f %5d %7d %9d %11.4f %12.2f' % (
            name, hrs, nb, c['drown'], c['episodes'], ph, pe))

    c, b0 = acc['frozen'], base
    ph = c['drown'] / (len(bots['frozen']) or 1) / max(
        1e-9, (now - FREEZE).total_seconds() / 3600 - 7)
    pe = 1000 * c['drown'] / (c['episodes'] or 1)
    print('\n  CHANGE vs baseline')
    print('   per bot-hour     %+.0f%%   %s' % (
        100 * (ph / b0['ph'] - 1), 'WORSE' if ph > b0['ph'] else 'better'))
    print('   per 1k episodes  %+.0f%%   %s' % (
        100 * (pe / b0['pe'] - 1), 'better' if pe < b0['pe'] else 'WORSE'))
    idle = c['drown_idle'] / (c['drown'] or 1)
    print('\n  idle at the moment of death: %.0f%% of drownings (%d of %d)' % (
        100 * idle, c['drown_idle'], c['drown']))
    print('   -> the ownership fix targets exactly this population')
    print('\n  other causes, frozen window: fall=%d lava=%d total deaths=%d' % (
        c['fall'], c['lava'], c['deaths']))
    print('\n  Neither number is the answer on its own. Quote both.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
