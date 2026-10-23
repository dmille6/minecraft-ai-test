"""Deploy churn from ~/canary-journal.jsonl (read-only): deploy / promote / owner-direct / teardown events whose
timestamp falls in BASE (10-08..10-10) and END (10-20..10-22), and every fleet-wide change 10-08..10-23."""
import json, os

J = os.path.expanduser('~/canary-journal.jsonl')
PH = ('deployed', 'promoted', 'owner-direct', 'torn-down')
win = {'BASE': ('2026-10-08', '2026-10-11'), 'END': ('2026-10-20', '2026-10-23')}
rows = []
for l in open(J):
    try:
        r = json.loads(l)
    except ValueError:
        continue
    t = r.get('ts') or ''
    if t >= '2026-10-08' and r.get('phase') in PH:
        rows.append((t[:16], r.get('run'), r.get('phase')))
for lab, (a, b) in win.items():
    ev = [x for x in rows if a <= x[0] < b]
    print(f'{lab}: {len(ev)} events, of which promoted {sum(x[2] == "promoted" for x in ev)}, deployed '
          f'{sum(x[2] == "deployed" for x in ev)}, torn-down {sum(x[2] == "torn-down" for x in ev)}, owner-direct '
          f'{sum(x[2] == "owner-direct" for x in ev)}')
    for x in ev:
        print('   ', *x)
print('\nfleet-wide changes (promoted), 10-08 .. 10-23:')
for x in rows:
    if x[2] == 'promoted':
        print('   ', *x)
