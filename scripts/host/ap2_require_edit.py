#!/usr/bin/env python3
"""ap2_require_edit.py <out_dir>  -- the airpocket-02 registrations with v35's `draw_require_pools` (READ-ONLY on live).

The live registrations (~/mcai-analysis/airpocket-02.{70cb0d41,71032630}.json) carry `draw_exposure.draw_pools_required:
["hive-d"]`, a field NO code reads (grep, 10-12): the draw would not force hive-d. v35's drawrequire.py reads a TOP-LEVEL
`draw_require_pools`. This writes edited copies to <out_dir>: the top-level field added, the inert nested one removed
(one name, no ambiguity), nothing else changed; then checks each copy with the STAGED v35 code (~/gate-v35):
drawrequire.parse, usafegate check-registration, and prints the new sha256 and the queue entry to replace-variant."""
import hashlib, json, os, shutil, subprocess, sys, tempfile

OUT = sys.argv[1]; H = os.path.expanduser('~'); G = os.path.join(H, 'gate-v35')
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, G)
import drawrequire
queue = json.load(open(os.path.join(H, 'canary-queue.json')))
entry = [e for e in queue['entries'] if e.get('run') == 'airpocket-02']
assert len(entry) == 1, 'airpocket-02 queue entry not found exactly once'
entry = json.loads(json.dumps(entry[0]))
for base, v in entry['variants'].items():
    src = v['registration']
    raw = open(src, 'rb').read()
    assert hashlib.sha256(raw).hexdigest() == v['registration_sha256'], 'live %s does not match its queued sha256' % src
    r = json.loads(raw)
    assert (r.get('draw_exposure') or {}).get('draw_pools_required') == ['hive-d'], src
    assert 'draw_require_pools' not in r, src
    r['draw_require_pools'] = ['hive-d']
    del r['draw_exposure']['draw_pools_required']
    body = (json.dumps(r, indent=1) + '\n').encode()
    dst = os.path.join(OUT, os.path.basename(src))
    open(dst, 'wb').write(body)
    req, bad = drawrequire.parse(json.loads(body))
    d = tempfile.mkdtemp(); shutil.copy(dst, os.path.join(d, 'airpocket-02.json'))
    ck = subprocess.run([sys.executable, os.path.join(G, 'usafegate.py'), 'check-registration', 'airpocket-02'],
                        capture_output=True, text=True, env=dict(os.environ, USAFE_REG_DIR=d))
    before = {k for k in json.loads(raw)}; after = {k for k in json.loads(body)}
    print('%s: draw_require_pools -> %r (%s); usafegate: %s; keys added %s removed %s; draw_exposure keys now %s'
          % (os.path.basename(src), req, bad or 'ok', (ck.stdout.strip().splitlines() or ['?'])[-1][:120],
             sorted(after - before), sorted(before - after), sorted(json.loads(body)['draw_exposure'])))
    v['registration_sha256'] = hashlib.sha256(body).hexdigest()
    v['approved'] = v['approved'] + ' | 10-12: draw_require_pools ["hive-d"] (gate v35 field; the inert draw_exposure.draw_pools_required removed) -- replace-variant after the v35 install'
old_note = '(registration draw_exposure.draw_pools_required)'
assert entry['note'].count(old_note) == 1, 'note anchor'
entry['note'] = entry['note'].replace(old_note, '(registration draw_require_pools, gate v35 drawrequire.py: all required pools or no draw)')
ep = os.path.join(OUT, 'airpocket-02.queue-entry.json')
open(ep, 'w').write(json.dumps(entry, indent=1) + '\n')
print('\nQUEUE ENTRY written to %s (registration paths unchanged; replace the live files with the copies in %s):' % (ep, OUT))
print(json.dumps({b: {'registration': v['registration'], 'registration_sha256': v['registration_sha256']} for b, v in entry['variants'].items()}, indent=1))
