#!/usr/bin/env python3
"""C2 smoke gate: is every link of the directive path alive in the smoke runs (tag b<SB>, default b91)? Exit 0 = PASS.
Checks, per run, with the totals printed first (positive control: the bots wrote rows at all):
  bot_code is the bench-c2 tree; the Mayor said lines and was never kicked; nothing was too long; the director
  logged no errors; the bots logged `requested` AND `dispatched` directive rows and no parse failures; the LLM
  arm made at least one overseer call that came back valid.   python3 c2_smoke_check.py results/runs.jsonl
"""
import json, subprocess, sys
BOTS = 'mike@10.0.0.31'
def ssh(c):
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', BOTS, c], stdin=subprocess.DEVNULL, capture_output=True, text=True).stdout
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
SB = sys.argv[2] if len(sys.argv) > 2 else '91'
rows = [r for r in rows if r.get('c2_arm') and r['run_id'].endswith('-b' + SB) and not r.get('flag')]
fails = []
missing = {'det', 'ov+esc'} - {r['c2_arm'] for r in rows}
if missing: fails.append('smoke arms missing from runs.jsonl (cut or crashed): %s' % sorted(missing))
for r in rows:
    rid = r['run_id']; tag = '%s (%s)' % (rid, r['c2_arm'])
    allrows = int(ssh('cat ~/mbench-cl/runs/%s/*/skill-*.jsonl 2>/dev/null | wc -l' % rid).strip() or 0)
    drows = [json.loads(l) for l in ssh("cat ~/mbench-cl/runs/%s/*/skill-*.jsonl 2>/dev/null | grep -a '\"_directive\"' || true" % rid).splitlines() if l.startswith('{')]
    st = {}
    for d in drows:
        k = ((d.get('skill') or {}).get('detail') or '').split(' ', 1)[0]; st[k] = st.get(k, 0) + 1
    dl = [json.loads(l) for l in ssh('cat ~/mbench-c2/%s/director.jsonl 2>/dev/null' % rid).splitlines() if l.startswith('{')]
    ch = [json.loads(l) for l in ssh('cat ~/mbench-c2/%s/chat.jsonl 2>/dev/null' % rid).splitlines() if l.startswith('{')]
    kinds = {}
    for x in dl + ch: kinds[x['kind']] = kinds.get(x['kind'], 0) + 1
    print(tag, 'bot rows', allrows, '| directive rows', st, '| director+chat', kinds, '| bot_code', r.get('bot_code'))
    if allrows < 100: fails.append(tag + ': the bots barely logged (%d rows)' % allrows)
    if not str(r.get('bot_code', '')).startswith('bench-c2@'): fails.append(tag + ': bot_code is not the bench-c2 tree')
    if not kinds.get('mayor_spawn'): fails.append(tag + ': the Mayor never spawned')
    if kinds.get('mayor_disconnect', 0) > 1: fails.append(tag + ': the Mayor was disconnected %d times' % kinds['mayor_disconnect'])
    if kinds.get('too_long') or kinds.get('bad_outbox_line'): fails.append(tag + ': too_long/bad_outbox_line rows')
    if kinds.get('director_error'): fails.append(tag + ': director errors')
    if not kinds.get('said'): fails.append(tag + ': the Mayor said nothing')
    if not st.get('requested') or not st.get('dispatched'): fails.append(tag + ': no requested/dispatched rows from the bots')
    if st.get('parse_failed'): fails.append(tag + ': %d parse failures' % st['parse_failed'])
    if 'ov' in r['c2_arm']:
        ok = [x for x in dl if x['kind'] == 'overseer_call' and x.get('ok') and x.get('valid')]
        if not ok: fails.append(tag + ': no valid overseer call')
print('SMOKE', 'PASS' if not fails else 'FAIL'); [print('  -', f) for f in fails]
sys.exit(1 if fails else 0)
