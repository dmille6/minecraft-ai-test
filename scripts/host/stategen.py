#!/usr/bin/env python3
"""STATE GENERATOR -- docs/reports/STATE.md built from the sources, so it cannot go stale (Codex ops audit 11-01 HIGH 1:
STATE contradicted completed events and owner decisions within a day of every hand refresh).

Runs hourly on the canary host (cron, install below). Reads, never writes anything but its outputs:
  the canary journal      ~/canary-journal.jsonl      fleet sha (newest `promoted`), KEEP/REVERT records, the slot, rollouts
  the scheduler           ~/canary-sched.py status    each queue entry's state, its hold, the DECISION line
  the ledger              origin/main config/owner-commitments.json (a private clone, fetched each run): rows with
                          `owner_pending` are the pending OWNER decisions; everything else blocked is a technical hold
  the showcase            Elasticsearch: the showcase skill stream's builds (code.version) and the newest
                          `showcase_restack` row from infra/showcase/restack_prep.py (protected tree vs the fleet KEEP)
  the alarms              ~/digest/ALARMS.log (active = newest event per key is NEW/STILL), stallcheck-latest.md,
                          opsaudit-latest.md, the death breaker's timer
  the NOTES block         origin/main docs/reports/STATE.md between the NOTES markers: hand-written, PRESERVED verbatim
Writes ~/digest/STATE.md (+ STATE.json). scripts/mac/state-relay.sh (Mac LaunchAgent, hourly) commits it to main as
docs/reports/STATE.md when the generated part changed, re-reading main's NOTES block at that moment.

Every source that cannot be read is a line that says so ('!! ... UNREADABLE'), never a blank or a zero.

    python3 -B scripts/host/stategen.py run [--out ~/digest/STATE.md] [--no-fetch]
    python3 -B scripts/host/stategen.py render --from STATE.json      # re-render (tests, debugging)

Install (canary host): ~/stategen/app/scripts = scripts/host/stategen.py + scripts/lib/{estelemetry,es,alarm}.py ...;
~/stategen/repo = a private clone; cron `20 * * * * cd ~/stategen/app/scripts && nice -n 10 python3 -B host/stategen.py run`.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

UTC = dt.timezone.utc
HOME = os.path.expanduser('~')
JOURNAL = f'{HOME}/canary-journal.jsonl'
SCHED = f'{HOME}/canary-sched.py'
REPO = f'{HOME}/stategen/repo'
DIGEST = f'{HOME}/digest'
NOTES_BEGIN = '<!-- NOTES:BEGIN (hand-written; stategen.py keeps this block verbatim) -->'
NOTES_END = '<!-- NOTES:END -->'
GEN_BEGIN = '<!-- GENERATED:BEGIN -->'
GEN_END = '<!-- GENERATED:END -->'
VERDICT = re.compile(r'^\s*(KEEP|REVERT|INCONCLUSIVE)\b', re.I)
HEX = re.compile(r'\b[0-9a-f]{40}\b')
STATUS_ROW = re.compile(r'^(\S+)\s+(done|running|ready|cancelled|blocked|waiting|held|parked|abandoned|closed)\s+(\S+)\s+hold=(.*?) not_before=')
QUEUE_SHOWN = 10


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None


def hm(t):
    return t.strftime('%m-%d %H:%MZ') if t else '?'


# ------------------------------------------------------------------------------------------- pure parts (tested)
def journal_facts(rows, now):
    """Journal rows (dicts, file order) -> the fleet line, the newest closes, the rollouts of the last 24 h. Pure."""
    promos, verdicts, deployed, torn = [], {}, {}, {}
    rollouts = {}
    for r in rows:
        ph, run, t = r.get('phase'), r.get('run'), ts(r.get('ts'))
        if not run or t is None:
            continue
        note = str(r.get('note') or '')
        if ph == 'promoted':
            m = HEX.search(note)
            if m:
                promos.append({'run': run, 'sha': m.group(0), 't': t})
        elif ph == 'recorded':
            m = VERDICT.match(note)
            if m:
                verdicts[run] = {'verdict': m.group(1).upper(), 't': t, 'note': note.strip()[:80]}
        elif ph == 'deployed':
            deployed[run] = t
        elif ph == 'torn-down':
            torn[run] = t
        elif ph.startswith('rollout-') or ph in ('owner-direct', 'owner-direct-check'):
            if now - t <= dt.timedelta(hours=24):
                rollouts[run] = {'phase': ph, 't': t, 'note': note[:110]}
    return {'promotions': promos, 'verdicts': verdicts, 'deployed': deployed, 'torn': torn, 'rollouts': rollouts}


def parse_status(text):
    """`canary-sched.py status` -> ([{run, state, cls, hold}], decision line or None). Pure."""
    out, decision = [], None
    for line in (text or '').splitlines():
        if line.startswith('DECISION:'):
            decision = line[len('DECISION:'):].strip()
            continue
        m = STATUS_ROW.match(line)
        if m:
            hold = m.group(4).strip()
            out.append({'run': m.group(1), 'state': m.group(2), 'cls': m.group(3), 'hold': None if hold == 'None' else hold})
    return out, decision


def active_alarms(lines):
    """ALARMS.log lines -> {key: (time, source, text)} whose NEWEST event is NEW or STILL. Pure."""
    last = {}
    for line in lines:
        m = re.match(r'^(\S+)\s+(NEW|STILL|CLEARED)\s+(\S+)\s+(\S+)\s+::\s*(.*)$', line.rstrip('\n'))
        if m:
            last[(m.group(3), m.group(4))] = (m.group(2), m.group(1), m.group(5))
    return {k: (v[1], k[0], v[2]) for k, v in last.items() if v[0] != 'CLEARED'}


def pending_owner(ledger):
    """Ledger rows still asking the OWNER something: an open/parked row with a non-empty `owner_pending`. Pure."""
    items = (ledger or {}).get('items') or []
    return [(i.get('id'), str(i['owner_pending'])) for i in items
            if i.get('owner_pending') and i.get('state') in ('open', 'parked')]


def split_notes(text):
    """A STATE.md -> its NOTES block content (between the markers), or None when it has no block. Pure."""
    if not text or NOTES_BEGIN not in text or NOTES_END not in text:
        return None
    return text.split(NOTES_BEGIN, 1)[1].split(NOTES_END, 1)[0].strip('\n')


def splice(state_md, generated, notes=None):
    """Put a freshly generated block into a STATE.md, keeping its NOTES (or `notes` when given). Pure."""
    keep = notes if notes is not None else (split_notes(state_md) or '')
    return render_page(generated, keep)


def render_page(generated, notes):
    return '\n'.join([
        '# STATE — one screen of current state (GENERATED hourly)',
        '',
        '_Built by `scripts/host/stategen.py` on the canary host from the journal, the queue, the ledger, the showcase stream '
        'and the alarms; `scripts/mac/state-relay.sh` commits it here. **Edit only the NOTES block**; everything else is '
        'overwritten. The live copy is `~/digest/STATE.md` on the canary host._',
        'Process: [`docs/PROCESS-fun-mode.md`](../PROCESS-fun-mode.md). History to 10-28: '
        '[`docs/archive/STATE-history-to-2026-10-28.md`](../archive/STATE-history-to-2026-10-28.md).',
        '',
        GEN_BEGIN,
        generated.rstrip('\n'),
        GEN_END,
        '',
        '## Notes',
        '',
        NOTES_BEGIN,
        notes.rstrip('\n'),
        NOTES_END,
        '',
    ])


def holdtext(h, n=90):
    h = re.sub(r'^(HELD|HOLD)\b[\s:-]*', '', h.strip(), flags=re.I)
    return 'HELD: ' + (h[:n] + '...' if len(h) > n else h)


def generated_block(f, now):
    """The facts dict (see collect()) -> the generated markdown table. Pure: every missing source is a '!!' cell."""
    rows = []
    J = f.get('journal')
    if J is None:
        rows.append(('Fleet', f'!! journal UNREADABLE ({f.get("journal_error")})'))
    else:
        p = J['promotions']
        if p:
            chain = []
            for x in reversed(p[-6:]):
                v = J['verdicts'].get(x['run'], {})
                chain.append(f'{x["run"]} `{x["sha"][:8]}` ({v.get("verdict", "?")} {hm(v.get("t"))}, promoted {hm(x["t"])})')
            rows.append(('Fleet', f'`{p[-1]["sha"][:8]}` = ' + ' on '.join(chain)
                         + (f'. Live builds: {f["builds"]}' if f.get('builds') else '')))
        else:
            rows.append(('Fleet', '!! no `promoted` row in the journal'))
    Q = f.get('queue')
    if Q is None:
        rows.append(('Canary in slot', f'!! scheduler status UNREADABLE ({f.get("queue_error")})'))
        rows.append(('Queue (front)', '!! scheduler status UNREADABLE'))
    else:
        running = [e for e in Q if e['state'] == 'running']
        if running and J is not None:
            cells = []
            for e in running:
                d = J['deployed'].get(e['run'])
                if d:
                    cells.append(f'**{e["run"]}** deployed {hm(d)}; reads +90 {hm(d + dt.timedelta(minutes=90))}, '
                                 f'+180 {hm(d + dt.timedelta(minutes=180))}; KEEP auto-promotes ~10 min after the +180 KEEP')
                else:
                    cells.append(f'**{e["run"]}** running (no `deployed` row yet: drawing or preflight)')
            rows.append(('Canary in slot', '; '.join(cells)))
        elif running:
            rows.append(('Canary in slot', ', '.join(e['run'] for e in running)))
        else:
            last = None
            if J is not None and J['verdicts']:
                r, v = max(J['verdicts'].items(), key=lambda kv: kv[1]['t'])
                last = f'last close {r} {v["verdict"]} {hm(v["t"])}'
            rows.append(('Canary in slot', 'EMPTY' + (f' ({last})' if last else '')))
        ready = [e for e in Q if e['state'] == 'ready' and not (e['hold'] or '').upper().startswith(('PARKED', 'OPERATOR'))]
        free = [e['run'] for e in ready if not e['hold']]
        held = [f'{e["run"]} ({holdtext(e["hold"])})' for e in ready if e['hold']]
        parked = [e['run'] for e in Q if e['state'] == 'ready' and (e['hold'] or '').upper().startswith(('PARKED', 'OPERATOR'))]
        cell = ' -> '.join(free[:QUEUE_SHOWN]) or '(nothing runnable)'
        if len(free) > QUEUE_SHOWN:
            cell += f' -> +{len(free) - QUEUE_SHOWN} more'
        if held:
            cell += '. Held: ' + '; '.join(held)
        if parked:
            cell += f'. Parked: {", ".join(parked)}'
        rows.append(('Queue (front)', cell))
        if f.get('decision'):
            rows.append(('Scheduler', ' / '.join(x.strip() for x in f['decision'].split('|') if not re.match(r'\s*S[2-5]\b', x))[:240]))
    S = f.get('showcase') or {}
    if S.get('error'):
        rows.append(('Showcase release', f'!! showcase stream UNREADABLE ({S["error"]})'))
    else:
        vers = S.get('versions') or {}
        cell = (', '.join(f'`{k[:8]}` ({v:,} rows)' for k, v in sorted(vers.items(), key=lambda kv: -kv[1]))
                if vers else '!! no showcase skill row in 3 h')
        cell += f'; {S.get("bots", 0)} bots in 3 h'
        R = S.get('restack')
        if R:
            rt = ts(R.get('t'))
            stale = rt is None or now - rt > dt.timedelta(hours=3)
            cell += (f'. Protected tree vs fleet KEEP: **{R.get("status")}** ({str(R.get("detail") or "")[:160]}; '
                     f'row {hm(rt)}{", STALE" if stale else ""})')
        else:
            cell += '. !! no `showcase_restack` row: the protected-follows-fleet check is not running (restack_prep.py)'
        rows.append(('Showcase release', cell))
    rows.append(('Death breaker', f.get('breaker') or '!! UNREADABLE'))
    if J is not None and J['rollouts']:
        rows.append(('Owner-direct / rollouts (24 h)', '; '.join(
            f'{r}: {v["phase"]} {hm(v["t"])}' for r, v in sorted(J['rollouts'].items(), key=lambda kv: kv[1]['t'])[-5:])))
    P = f.get('pending')
    if f.get('fetch_error'):
        rows.append(('Ledger', f'!! the ledger and NOTES are from a STALE clone ({f["fetch_error"]}): owner decisions may be newer on main'))
    if P is None:
        rows.append(('Pending owner decisions', f'!! ledger UNREADABLE ({f.get("ledger_error")})'))
    else:
        rows.append(('Pending owner decisions', '; '.join(f'**{i}**: {q}' for i, q in P) if P else
                     'none recorded (ledger rows with `owner_pending`); technical holds are under Queue'))
    A = f.get('alarms')
    al = []
    if f.get('stallcheck'):
        al.append(f['stallcheck'])
    if f.get('opsaudit'):
        al.append(f['opsaudit'])
    if A is None:
        al.append('!! ALARMS.log UNREADABLE')
    else:
        goal = sorted(k[1] for k in A if k[0].startswith('goalwatch'))
        other = sorted(f'{k[0]} {k[1]}' for k in A if not k[0].startswith('goalwatch'))
        al.append(f'{len(A)} active alarm(s)' + (f': stuck goals {len(goal)} ({", ".join(g.replace("goal:", "") for g in goal[:6])}'
                                                 f'{" ..." if len(goal) > 6 else ""})' if goal else '')
                  + (f'; {", ".join(other[:5])}' if other else ''))
    rows.append(('Open alarms', '. '.join(al)))
    out = [f'_Generated {iso(now)}._', '', '| | Now |', '|---|---|']
    out += [f'| **{k}** | {str(v).replace("|", "/")} |' for k, v in rows]
    return '\n'.join(out) + '\n'


# ------------------------------------------------------------------------------------------- impure collection
def sh(cmd, timeout=120):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def collect(now, fetch=True):
    f = {}
    try:
        rows = []
        with open(JOURNAL, errors='replace') as fh:
            for line in fh:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
        f['journal'] = journal_facts(rows, now)
    except OSError as e:
        f['journal'], f['journal_error'] = None, str(e)[:100]
    try:
        rc, out, err = sh(['python3', SCHED, 'status'], timeout=180)
        q, decision = parse_status(out)
        if not q:
            raise RuntimeError(f'rc={rc} no entry rows ({err.strip()[:80]})')
        f['queue'], f['decision'] = q, decision
        m = re.search(r'S5 \d+ builds on the active units: (\{[^}]*\})', decision or '')
        f['builds'] = m.group(1) if m else None
    except Exception as e:  # noqa: BLE001 -- a line that says so
        f['queue'], f['queue_error'] = None, str(e)[:120]
    try:
        if fetch:
            frc, _, ferr = sh(['git', '-C', REPO, 'fetch', '-q', 'origin', 'main'], timeout=180)
            if frc:   # Codex r1 BLOCK 3: a failed fetch is said, never a fresh-looking STATE from a stale ledger
                f['fetch_error'] = f'git fetch rc={frc}: {ferr.strip()[:80]}'
        rc, out, err = sh(['git', '-C', REPO, 'show', 'origin/main:config/owner-commitments.json'])
        if rc:
            raise RuntimeError(err.strip()[:100])
        f['pending'] = pending_owner(json.loads(out))
        rc, out, _ = sh(['git', '-C', REPO, 'show', 'origin/main:docs/reports/STATE.md'])
        f['notes'] = split_notes(out) if rc == 0 else None
    except Exception as e:  # noqa: BLE001
        f['pending'], f['ledger_error'], f['notes'] = None, str(e)[:120], None
    f['showcase'] = showcase_facts(now)
    try:
        with open(f'{DIGEST}/ALARMS.log', errors='replace') as fh:
            f['alarms'] = active_alarms(fh.readlines()[-5000:])
    except OSError:
        f['alarms'] = None
    for key, name in (('stallcheck', 'stallcheck-latest.md'), ('opsaudit', 'opsaudit-latest.md')):
        try:
            with open(f'{DIGEST}/{name}') as fh:
                f[key] = fh.readline().strip()[:160]
        except OSError:
            f[key] = f'!! {name} UNREADABLE'
    rc, out, _ = sh(['systemctl', 'is-active', 'mcai-tripper.timer'])
    f['breaker'] = ('ARMED (`mcai-tripper.timer` active, 5 min, `--apply`); ntfy alerts' if out.strip() == 'active'
                    else f'!! mcai-tripper.timer is {out.strip() or "unknown"}')
    return f


def showcase_facts(now):
    try:
        from lib.estelemetry import EsEvents
        from lib import estelemetry as est
        sk = EsEvents.load('showcase-skill', since=now - dt.timedelta(hours=3), until=now, gaps='allow')
        n = sk.total()
        vers = sk.terms('code.version', allow_zero=True) if n else {}
        vers = {k.split('+')[0]: v for k, v in vers.items() if k != est.MISSING}
        out = {'versions': vers, 'bots': len(sk.bots_present()) if n else 0}
        try:
            r = est.http('POST', 'mcai-showcase-ops/_search', {'size': 1, 'sort': [{'@timestamp': {'order': 'desc'}}],
                                                               'query': {'term': {'kind': 'showcase_restack'}}})
            hits = r['hits']['hits']
            out['restack'] = hits[0]['_source'] if hits else None
        except Exception:  # noqa: BLE001 -- no row is reported as such
            out['restack'] = None
        return out
    except Exception as e:  # noqa: BLE001
        return {'error': f'{type(e).__name__}: {str(e)[:100]}'}


def write_atomic(path, text):
    tmp = f'{path}.tmp'
    with open(tmp, 'w') as fh:
        fh.write(text)
    os.replace(tmp, path)


def jsonable(f):
    def conv(o):
        if isinstance(o, dt.datetime):
            return iso(o)
        if isinstance(o, dict):
            return {('|'.join(k) if isinstance(k, tuple) else k): conv(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [conv(x) for x in o]
        return o
    return conv(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run'])
    ap.add_argument('--out', default=f'{DIGEST}/STATE.md')
    ap.add_argument('--no-fetch', action='store_true')
    a = ap.parse_args()
    now = dt.datetime.now(UTC)
    f = collect(now, fetch=not a.no_fetch)
    notes = f.get('notes')
    if notes is None:
        notes = '!! the NOTES block could not be read from main (no markers yet, or the clone is unreadable)'
    page = render_page(generated_block(f, now), notes)
    write_atomic(a.out, page)
    write_atomic(os.path.splitext(a.out)[0] + '.json', json.dumps(jsonable({k: v for k, v in f.items() if k != 'notes'}),
                                                                   indent=1, default=str))
    print(f'{iso(now)} wrote {a.out} ({len(page.splitlines())} lines)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
