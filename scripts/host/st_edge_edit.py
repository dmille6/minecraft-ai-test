#!/usr/bin/env python3
"""st_edge_edit.py <out_dir>  -- stocktarget-01's queued registrations with the gate-v35 three-pool edge (READ-ONLY on live).
Each queued variant's live file must match its queued sha256; the copy adds bag_fix.primary_by_pools["3"] (stonecap-01's
3x32 edge, identical draw filter -- docs/reports/stocktarget-01.*.json on main carry the same) and bag_fix.keep_rule,
nothing else. Writes the copies and <out_dir>/stocktarget-01.queue-entry.json with the new sha256s (replace-variant)."""
import hashlib, json, os, sys
OUT = sys.argv[1]; H = os.path.expanduser('~'); os.makedirs(OUT, exist_ok=True)
E3 = {'value': -1.598, 'n': 220, 'cuts': 22, 'days': 7, 'median': -0.101,
      'source': "REUSED from stonecap-01's 3 pools x 32 h no-change null (bagnull-3x32-2026-10-10.bands.json, stonecap-01.slots_did): "
                "this fix's draw_exposure filter is mechanically identical to stonecap-01's (hours 3, kind deposit, min 8; only the "
                "label differs), the same reuse its four-pool edge already follows (both engines fold-r1/r2: valid only under that "
                "same filter). Gate v35: a three-pool final uses this edge; the four-pool primary.value is never applied to it."}
KR = ("A-prime (owner delegation 2026-10-08 to operator + Codex; gate v35, bagfixrule.keep_early): drawn at FOUR pools, this canary "
      "may KEEP at its +180 read when every gate and guard passes (no WATCH, no blocked line), exposure is ready, no bag-fix "
      "extension is in force, every registered read is readable (bagread's primary not None) and the cumulative canary death rate "
      "is <= the control's (point estimate); otherwise it continues to +360 under the existing rules. The bag metric (bagread) is "
      "REPORTED at the KEEP read, never gated on there.")
q = json.load(open(os.path.join(H, 'canary-queue.json')))
ent = [e for e in q['entries'] if e.get('run') == 'stocktarget-01']
assert len(ent) == 1
ent = json.loads(json.dumps(ent[0]))
for base, v in ent['variants'].items():
    raw = open(v['registration'], 'rb').read()
    assert hashlib.sha256(raw).hexdigest() == v['registration_sha256'], 'live %s does not match its queued sha256' % v['registration']
    r = json.loads(raw); bf = r['bag_fix']
    de = r['draw_exposure']
    assert de.get('hours') == 3 and [(x.get('kind'), x.get('min')) for x in de.get('require', [])] == [('deposit', 8)], 'filter changed'
    assert bf['primary']['field'] == 'slots_did' and bf['primary']['op'] == '<='
    bf.setdefault('primary_by_pools', {})['3'] = E3
    bf['keep_rule'] = KR
    body = (json.dumps(r, indent=1) + '\n').encode()
    open(os.path.join(OUT, os.path.basename(v['registration'])), 'wb').write(body)
    v['registration_sha256'] = hashlib.sha256(body).hexdigest()
    print('%s -> %s' % (os.path.basename(v['registration']), v['registration_sha256']))
open(os.path.join(OUT, 'stocktarget-01.queue-entry.json'), 'w').write(json.dumps(ent, indent=1) + '\n')
print('entry: %s' % os.path.join(OUT, 'stocktarget-01.queue-entry.json'))
