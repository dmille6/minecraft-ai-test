#!/usr/bin/env python3
# fixesbundleread.py [window_min] -- the AGGREGATE read of the fixes bundle (owner 09-29: "bundle the small fixes").
# Runs LAST among the bundle's reads and reads their emitted evidence for the same window. A registration carries ONE
# exposure field; a bundle is exposed only when EVERY member can be judged -- otherwise a member whose correctness line
# reads "not judged (0)" would pass vacuously into a KEEP. This read says which member is still pending.
import sys, os, json
import datetime as dt
sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')

MEMBERS = ['stalestopread', 'craftadviceread']   # each emits exposure_ready; digsync joins below when listed
man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00')); RUN = os.environ.get('DRY_RUN_ID', 'none')
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); RUN = man.get('run_id') or 'none'
elapsed = (dt.datetime.now(dt.timezone.utc) - CUT).total_seconds() / 60
W = int(min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180))
# prereq-usable rides in the bundle only when lastswing-01 was promoted (09-30); when the registration lists its read,
# it is a member like the others -- it must not pass vacuously either.
# FAIL CLOSED (Codex review of fixes-03): membership comes from the registration, so a registration that cannot be read,
# names another run, or carries no reads list must hold exposure at 0 -- never fall back to a guessed member list.
_reg_err = None
try:
    _reg = json.load(open(os.path.expanduser(f'~/mcai-analysis/registrations/{RUN}.json')))
    _reads = _reg['reads']
    if _reg.get('run_id') != RUN:
        _reg_err = 'registration run_id %r != %r' % (_reg.get('run_id'), RUN)
    elif not isinstance(_reads, list) or not _reads or not all(isinstance(x, str) for x in _reads):
        _reg_err = 'registration reads list missing, empty or malformed'
except Exception as e:
    _reads, _reg_err = [], 'registration unreadable: %s' % e
# digsync (ghost blocks) was a fixed member until fixes-03 (10-02) dropped it: fixes-02 reverted on climbs +123% (the
# historic canary range is -56%..+63%), and climbs ran 2.3-5.1x faster in the 2 min after a rollback. When a registration
# lists digsyncread it is a member like the others; when it does not, a missing digsync file must not hold exposure.
# An unreadable registration does not guess: it fails closed below.
if 'digsyncread' in _reads:
    MEMBERS.insert(0, 'digsyncread')
if 'prequsableread' in _reads:
    MEMBERS.append('prequsableread')
if 'toolsaferead' in _reads:   # tool-safe (09-30): the pickaxe-toss fix joins the bundle's 8ed9450+ variants
    MEMBERS.append('toolsaferead')
if 'bankwhyread' in _reads:   # bank-why (10-01): the deposit refusal names which rule held the item back
    MEMBERS.append('bankwhyread')
D = os.environ.get('READS_DIR') if ovr and os.environ.get('READS_DIR') else os.path.expanduser('~/digest/reads')   # dry-run tests only
ready, pending, missing = [], [], []
for m in MEMBERS:
    p = os.path.join(D, f'{RUN}-{m}-{W}.json')
    try:
        f = json.load(open(p))['fields']
    except Exception:
        missing.append(m); continue
    (ready if f.get('exposure_ready') == 1 else pending).append(m)
if _reg_err:
    missing.append('registration')
    print('REGISTRATION REFUSED:', _reg_err, '-- exposure held at 0')
print('bundle %s window +%d: exposure ready %s | pending %s | evidence missing %s' % (RUN, W, ready, pending, missing))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    from readjson import emit
    emit('fixesbundleread', W, {'exposure_ready': int(not pending and not missing), 'members_ready': len(ready),
                                'members_pending': ','.join(pending) or None, 'members_missing': ','.join(missing) or None})
except Exception as e:
    print('emit failed:', e)
