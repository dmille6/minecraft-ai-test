#!/usr/bin/env python3
r"""brainwatch.py -- the MODEL-DARK ALARM (OWNER 2026-11-14, loop item 1: "what worked and does not work now").

WHY. LIVE showcase 11-14 08:31:13Z: the ssh tunnel to the model host dropped and every one of the 14 bots answered every
decision with "all 1 llm endpoint(s) failed". Model decisions went from about 100 in ten minutes to 0; the bots went on by
reflex and work order alone. NOTHING PAGED for an hour: haltwatch saw 14 of 14 units running, and stopwatch's two-hour window
still held the successes from before the break. It was found by a read that looked oddly quiet.

WHAT IT READS. The bots' own service journal for the last WINDOW (10) minutes -- the bots' own account, not a probe of a
port the watcher guessed:
  a model decision    `LLM -> <skill> ... ms=<n>` with n > 0 (the model answered in n ms)
  a work order        the same line with ms=0 (the scheduler chose; no model was asked) -- counted, never a decision
  an endpoint failure `decision rejected why=all <n> llm endpoint(s) failed; last: <error>`
  the endpoint        `llm endpoint failing ... endpoint=<url>` (named in the page)
One bot is one systemd unit (the journal's own _SYSTEMD_UNIT: a bot that restarts ten times is still one bot, Codex r1).

THE VERDICT, with its denominators in the line:
  dark:model     endpoint failures >= FAIL_MIN (20), by >= FAIL_UNITS (2) bots, and they are >= DARK_SHARE (75 %) of
                 failures + model decisions. PAGES (an unknown source pages in lib/alarm; the key is stable, so a long
                 outage is one page, re-pushed until acked, and one CLEARED when the model answers again).
                 IT STAYS UP UNTIL THE MODEL ANSWERS (the latch, Codex r1): a window with too few failures, a silent
                 journal, a host with too few units or a read that failed is not a recovery. It is released by a window
                 in which the model decided at least once and failures are under DARK_SHARE of the tries. A state file
                 that cannot be read is said under the watcher's own key, and the page it held is taken back from the
                 push state rather than cleared.
  blind:journal  bots are running and the journal shows neither a decision nor a failure: the read is not a finding
                 (digest tier by its key).
A HOST THAT IS NOT RUNNING IS NOT JUDGED: fewer than MIN_UNITS active bot units is haltwatch's page, not this one's.
A journal that cannot be read fails the run under its own key (brainwatch:<label>), which pages.
THE POSITIVE CONTROL is printed every run: lines read, decisions, work orders, failures, units seen.

    python3 -B brainwatch.py --label showcase --hint "systemctl status showcase-studio-tunnel" \
        --ship /var/log/showcase/heartbeat.jsonl                                  (cron */5 on 10.0.0.40)
    python3 -B brainwatch.py --label showcase --no-state                          (a dry look: prints, pushes nothing)

Writes <state-dir>/brainwatch-<label>.json, appends NEW/STILL/CLEARED events to ~/digest/ALARMS.log and pushes through
lib/alarm. READ ONLY: the journal and the unit list, nothing else.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL  # noqa: E402

UTC = dt.timezone.utc
WINDOW_MIN = 10
FAIL_MIN = 20           # endpoint failures in the window before "dark" means anything
FAIL_UNITS = 2          # ... by this many different bots (one bot with a bad config is not the town)
DARK_SHARE = 0.75       # ... and this share of failures + model decisions
MIN_UNITS = {'showcase': 8, 'fleet': 40}
UNITS = {'showcase': 'mcshow@*.service', 'fleet': 'mcbot@*.service'}
GREP = r'LLM -> |llm endpoint\(s\) failed|llm endpoint failing'

DECIDED = re.compile(r' LLM -> \S+ .*\bms=(\d+)\s*$')
FAILED = re.compile(r'decision rejected why=all \d+ llm endpoint\(s\) failed; last: (.*?)(?: raw=.*)?$')
ENDPOINT = re.compile(r'llm endpoint failing .*?\bendpoint=(\S+)')


def rows_of(text):
    """PURE. `journalctl -o json` text -> [{'unit', 'msg', 't'}]. A MESSAGE that is not UTF-8 arrives as a list of bytes."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        msg = d.get('MESSAGE')
        if isinstance(msg, list):
            msg = bytes(int(b) & 255 for b in msg).decode('utf-8', 'replace')
        out.append({'unit': str(d.get('_SYSTEMD_UNIT') or '?'), 'msg': str(msg or ''), 't': str(d.get('__REALTIME_TIMESTAMP') or '')})
    return out


def tally(rows):
    """PURE. journal rows (rows_of) -> the counts. A row that matches nothing is counted as `other`."""
    t = {'lines': 0, 'decided': 0, 'ordered': 0, 'failed': 0, 'other': 0, 'units_decided': set(), 'units_failed': set(),
         'endpoints': Counter(), 'errors': Counter(), 'last_decided': None}
    for r in rows:
        line, pid = r['msg'].rstrip(), r['unit']
        if 'FIXTURE' in pid:
            continue
        t['lines'] += 1
        m = DECIDED.search(line)
        if m:
            if int(m.group(1)) > 0:
                t['decided'] += 1
                t['units_decided'].add(pid)
                t['last_decided'] = max(t['last_decided'] or '', r['t'])
            else:
                t['ordered'] += 1
            continue
        m = FAILED.search(line)
        if m:
            t['failed'] += 1
            t['units_failed'].add(pid)
            t['errors'][m.group(1).strip()[:80]] += 1
            continue
        m = ENDPOINT.search(line)
        if m:
            t['endpoints'][m.group(1)] += 1
            continue
        t['other'] += 1
    return t


def judge(t, units_up, label, hint='', since=None, window=WINDOW_MIN):
    """PURE. (tally, active bot units, label) -> ({alarm key: line}, summary line)."""
    need = MIN_UNITS.get(label, 8)
    control = (f"{t['lines']} journal lines in the last {window} min: {t['decided']} model decisions by {len(t['units_decided'])} bots, "
               f"{t['ordered']} work orders, {t['failed']} endpoint failures by {len(t['units_failed'])} bots; {units_up} bot units running")
    if units_up < need:
        return {}, f'{label} brainwatch: not judged, {units_up} bot units running (need {need}; haltwatch owns a stopped host); {control}'
    tries = t['failed'] + t['decided']
    if t['failed'] >= FAIL_MIN and len(t['units_failed']) >= FAIL_UNITS and t['failed'] >= DARK_SHARE * tries:
        ep = ', '.join(e for e, _ in t['endpoints'].most_common(2)) or 'endpoint not named in the window'
        err = (t['errors'].most_common(1) or [('?', 0)])[0][0]
        line = (f"{label.upper()} MODEL DARK{' since ' + since if since else ''}: {t['decided']} model decisions and {t['failed']} endpoint "
                f"failures by {len(t['units_failed'])} of {units_up} bots in the last {window} min ({ep}: {err}); the bots run on "
                f"reflexes and work orders only ({t['ordered']} orders){' -- ' + hint if hint else ''}")
        return {'dark:model': line}, f'{label} brainwatch: MODEL DARK; {control}'
    if tries == 0:
        return ({'blind:journal': f'{label} brainwatch could not judge: {units_up} bot units running and the journal shows neither a '
                                  f'model decision nor an endpoint failure in {window} min ({t["ordered"]} work orders, {t["lines"]} lines)'},
                f'{label} brainwatch: NOT JUDGED (no decision and no failure); {control}')
    return {}, f'{label} brainwatch: the model answers; {control}'


def recovered(t):
    """PURE. Is this window proof that the model answers again? At least one model decision, and failures under DARK_SHARE."""
    tries = t['failed'] + t['decided']
    return t['decided'] >= 1 and t['failed'] < DARK_SHARE * tries


def hold(alarms, summ, t, was, label):
    """PURE. THE LATCH. (this run's verdict, the tally, the `since` latched before or None) -> (alarms, summary, since).
    Dark stays dark until `recovered`: every other window (too few failures, a silent journal, too few units) keeps the page."""
    if 'dark:model' in alarms:
        return alarms, summ, was
    if not was or (t is not None and recovered(t)):
        return alarms, summ, None
    out = dict(alarms)
    seen = (f"{t['decided']} model decisions, {t['failed']} endpoint failures by {len(t['units_failed'])} bots, {t['lines']} journal lines"
            if t is not None else 'this run could not read the journal')
    out['dark:model'] = (f'{label.upper()} MODEL STILL DARK since {was}: no window since has shown the model answering '
                         f'(this one: {seen})')
    return out, f'{label} brainwatch: MODEL STILL DARK (latched since {was}); ' + summ, was


def read_since(path, push_path):
    """-> (since | None, problem | None). The latch is the state file's `dark_since` -- an explicit field, a string or null.
    A state file that is missing, cannot be read or does not carry it is NOT "nothing was dark": lib/alarm's own push state
    ({alarm key: ...}) is asked, and a dark page still up there is taken back (Codex r1, r2: a failed read after a lost state
    file would otherwise push CLEARED). A missing file with no page in the push state is a first run and says nothing."""
    held = False
    try:
        held = any(str(k) == 'dark:model' for k in json.load(open(push_path)))
    except (OSError, ValueError, TypeError):
        pass
    problem = None
    if not os.path.exists(path):
        problem = 'missing' if held else None
    else:
        try:
            d = json.load(open(path))
            if isinstance(d, dict) and 'dark_since' in d and (d['dark_since'] is None or isinstance(d['dark_since'], str)):
                if d['dark_since'] or not held:
                    return d['dark_since'], None
                problem = 'says nothing is dark while the push state holds the page'
            else:
                problem = 'no dark_since in it'
        except (OSError, ValueError) as e:
            problem = type(e).__name__
    if problem is None:
        return None, None
    return ('before a lost state file' if held else None), (f'state file {os.path.basename(path)}: {problem}; the dark page was '
                                                            f'{"taken back from the push state" if held else "not up in the push state"}')


def units_up(pattern):
    """Active units matching pattern, FIXTURE units excluded. Raises when systemctl fails."""
    r = subprocess.run(['systemctl', 'list-units', '--all', '--no-legend', '--plain', pattern], capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise RuntimeError(f'systemctl rc {r.returncode}: {r.stderr.strip()[:120]}')
    return sum(1 for p in (l.split() for l in r.stdout.splitlines()) if len(p) > 2 and 'FIXTURE' not in p[0] and p[2] == 'active')


def read_journal(pattern, window=WINDOW_MIN):
    """The matching journal rows of the last `window` minutes, as JSON text. journalctl -g exits 1 with '-- No entries --'
    (or nothing at all) when nothing matched: that is an empty read, and anything else that is not 0 is a read that failed."""
    r = subprocess.run(['journalctl', '-u', pattern, '--since', f'-{window} min', '--no-pager', '-o', 'json',
                        '--output-fields=MESSAGE,_SYSTEMD_UNIT', '-g', GREP], capture_output=True, text=True, timeout=60)
    said = (r.stdout + r.stderr).strip()
    if r.returncode == 0 or (r.returncode == 1 and '{' not in r.stdout and (not said or 'No entries' in said)):
        return r.stdout
    raise RuntimeError(f'journalctl rc {r.returncode}: {(r.stderr or r.stdout).strip()[:160]}')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', required=True, choices=sorted(UNITS))
    ap.add_argument('--hint', default='', help='where to look first, said in the page (the tunnel unit, the model host)')
    ap.add_argument('--state-dir', default='~/digest')
    ap.add_argument('--ship', help='append a kind=<label>_brainwatch row to this filebeat-shipped file')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--no-state', action='store_true', help='print only: no state file read or written, no ALARMS.log, no push')
    ap.add_argument('--journal-file', help='TESTS: read this `journalctl -o json` text instead of journalctl')
    ap.add_argument('--units', type=int, help='TESTS: this many bot units are running')
    ap.add_argument('--now', help='TESTS')
    a = ap.parse_args(argv)
    now = (dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else dt.datetime.now(UTC)).replace(microsecond=0)
    sd = os.path.expanduser(a.state_dir)
    state = os.path.join(sd, f'brainwatch-{a.label}.json')
    push_state = os.path.join(sd, f'brainwatch-{a.label}.pushstate.json')
    was, lost = (None, None) if a.no_state else read_since(state, push_state)
    try:
        text = open(a.journal_file).read() if a.journal_file else read_journal(UNITS[a.label])
        up = a.units if a.units is not None else units_up(UNITS[a.label])
        t = tally(rows_of(text))
        alarms, summ = judge(t, up, a.label, a.hint, since=was or AL._iso(now))
        alarms, summ, since = hold(alarms, summ, t, was or (AL._iso(now) if 'dark:model' in alarms else None), a.label)
        if lost:
            alarms[f'brainwatch:{a.label}'] = f'brainwatch {a.label}: {lost}'
        rep = {'generated_at': AL._iso(now), 'label': a.label, 'summary': summ, 'alarms': alarms, 'dark_since': since,
               'counts': {k: (len(v) if isinstance(v, set) else dict(v) if isinstance(v, Counter) else v) for k, v in t.items()},
               'units_up': up}
    except Exception as e:      # a watcher that crashes must alarm, not go quiet -- and it keeps what it had said
        rep = {'generated_at': AL._iso(now), 'label': a.label, 'error': f'{type(e).__name__}: {str(e)[:300]}', 'dark_since': was,
               'alarms': {**hold({}, '', None, was, a.label)[0],
                          f'brainwatch:{a.label}': f'brainwatch {a.label} FAILED: {type(e).__name__}: {str(e)[:200]}'
                                                   + (f'; also: {lost}' if lost else '')}}
        rep['summary'] = f'{a.label} brainwatch: CHECK FAILED ({rep["error"][:120]})'
    print(rep['summary'])
    for line in rep['alarms'].values():
        print('  !! ' + line)
    if a.no_state:
        return 0
    try:
        AL.write_json_atomic(state, rep)
    except OSError as e:        # the page must still go out (Codex r2: a state path that cannot be written stopped every run here)
        rep['alarms'][f'brainwatch:{a.label}'] = (rep['alarms'].get(f'brainwatch:{a.label}', f'brainwatch {a.label}:') +
                                                  f' state file not written ({type(e).__name__})')
        print('  !! ' + rep['alarms'][f'brainwatch:{a.label}'])
    AL.raise_alarms(f'brainwatch-{a.label}', rep['alarms'], now, push_state,
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.ship:
        AL.ship_row(a.ship, {'kind': f'{a.label}_brainwatch', 't': AL._iso(now), 'ok': not rep['alarms'],
                             'event': 'model_dark' if 'dark:model' in rep['alarms'] else 'model_ok', 'why': rep['summary'],
                             'alarms': sorted(rep['alarms'].values())})
    return 0


if __name__ == '__main__':
    sys.exit(main())
