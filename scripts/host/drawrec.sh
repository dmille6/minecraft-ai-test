#!/bin/bash
# HOST COPY (10.0.0.31): identical to the Mac drawrec.sh except the remote part runs locally. canary-loop.sh calls this;
# the loop's first real draw (16 Sep 23:50Z) found no such file on the host -- the --no-act run had skipped the draw phase.
# Deploy-time draw: rule v5 band on the 5080 half + exposure. The built-in exposure filter (>= 20 entombed+marooned rows
# OR >= 8 livelock_escape rows in the prior 3 h) was written for recovery-ladder-01 and is BLIND TO EVERY OTHER MECHANISM.
# 17 Sep it drew board-b,hive-b for the pocket-rung + death-site bundle: both had 0 sealed pockets and 0 deaths in 6 h, the
# only such pair available, and the canary reached +360 with 60 bot-h and zero exposure on BOTH halves -- unmeasurable by
# construction. So: pass a run_id and, if its registration declares `draw_exposure`, drawexposure.py narrows the eligible
# list to pools that can actually expose THAT change. With no run_id, behaviour is exactly as before.
# A pool with a trapped bot is preferred but not required.
RUN=${1:-}
export DRAW_RUN="$RUN"
bash -c 'cd /opt/minecraft-ai; POOLS=1 python3 /tmp/immobiledid.py 2>/dev/null; python3 /tmp/poolrank2.py 2>/dev/null; echo "=== LEDGER"; tail -40 /var/log/mcai/_canary-decisions.jsonl; echo "=== MANIFEST"; cat /srv/mcbots/trial-manifest.json' > /tmp/drawrec.txt 2>&1
python3 - <<'PY'
import re, secrets, datetime as dt, os, sys
txt = open('/tmp/drawrec.txt').read()
expo = {m.group(1): (int(m.group(2)), int(m.group(3)), int(m.group(4))) for m in re.finditer(r'^\s+(\S+)\s+livelock\s+(\d+) climbs\s+(\d+) immobile>=30m (\d+)', txt, re.M)}
band = {m.group(1): (m.group(2), float(m.group(3))) for m in re.finditer(r'^(\S+)\s+(5080|3090)\s+bots \d+\s+items/bh\s+([\d.]+)', txt, re.M)}
# THE BAND CENTRE MUST COVER THE POOLS THE BAND JUDGES.
# When the 5080-half restriction came out of elig() at 19:51Z the centre was left
# as poolrank2's 5080-half median, so the three -d pools were judged for band
# eligibility against a median they do not contribute to -- silently, and biasing
# exactly the pools the change had just enfranchised. Caught in review 21:0xZ,
# ninety minutes later. The in-file justification for leaving it ("33.4 vs 31.7,
# inside the rounding of the band") was a ONE-DAY SNAPSHOT of a quantity measured
# to move 53% in 2.3 hours, which is not a reason, it is a coincidence.
med5080 = float(re.search(r'5080-half median items/bh: ([\d.]+)', txt).group(1))
_all = sorted(ibh for _p, (_h, ibh) in band.items())
med = _all[len(_all) // 2] if _all else med5080
print('band centre: all-pool median %.1f (5080-half median %.1f, %+.0f%%)'
      % (med, med5080, 100 * (med - med5080) / med5080 if med5080 else 0))
now = dt.datetime.now(dt.timezone.utc)
# EXCLUSIONS COME FROM THE LEDGER AND THE MANIFEST, NEVER FROM A TYPED LIST (2026-09-14: a typed dict with duplicate
# keys let stale times overwrite fresh ones and the draw offered pools that were still excluded). A pool is excluded
# for 12 h after its last canary DECISION (the ledger's ts; conservative, later than declared_at) and while it is the
# manifest's live canary.
import json
ledger = txt.split('=== LEDGER')[1].split('=== MANIFEST')[0] if '=== LEDGER' in txt else ''
excl = set()
_hard = set()   # v37: the exclusions the fun-mode fallback draw keeps (brain subset, live canary, manual); the 12-h ledger one is not
for line in ledger.strip().splitlines():
    try: row = json.loads(line)
    except Exception: continue
    ts = dt.datetime.fromisoformat(row['ts'])
    if (now - ts).total_seconds() < 12 * 3600:
        for p in str(row.get('canary_pool') or '').split(','):
            if p.strip(): excl.add(p.strip())
# SIX HOURS, NOT TWELVE, FOR A STEADY KEEP+PROMOTED POOL (OPERATOR + CODEX 2026-10-10, owner's delegation; throughput).
# ~/mcai-analysis/drawsteady.py releases a pool only when EVERY decision naming it in 12 h (it reads the whole ledger,
# not this tail) is a KEEP promoted fleet-wide >= 6 h ago, every live bot of it ran ONLY the fleet version for the last
# hour, and its bag fill is inside the control pools' range. The release is taken from the ledger exclusion only:
# the live canary and the manual exclusions below are added after it. drawsteady failing, timing out or printing no
# RELEASE line releases nothing -- 12 h, exactly as before.
import subprocess as _sp, ast as _ast2
_early = set()
try:
    _sr = _sp.run(['python3', os.path.expanduser('~/mcai-analysis/drawsteady.py')], capture_output=True, text=True, timeout=600)
    for _l in _sr.stdout.splitlines():
        if _l.startswith('STEADY '):
            print(_l[:300])
        if _l.startswith('STEADY RELEASE '):
            _early = set(_ast2.literal_eval(_l[len('STEADY RELEASE '):]))
    _refused = [l for l in _sr.stdout.splitlines() if l.startswith('STEADY inputs unreadable') or l.startswith('STEADY measurement failed')]
    if not any(l.startswith('STEADY RELEASE ') for l in _sr.stdout.splitlines()):
        _refused.append('STEADY gave no RELEASE line (exit %s): %s' % (_sr.returncode, ' '.join((_sr.stdout + _sr.stderr).split())[-160:]))
except Exception as _e:
    _early = set(); print('STEADY not answered (%s): 12 h for every pool' % type(_e).__name__)
    _refused = ['STEADY not answered (%s)' % type(_e).__name__]
# A REFUSAL IS PAGED (v35.1, round 1 Claude: v35's refusal ran SILENTLY for 8.5 h and cost an idle slot). Once per 6 h,
# deduplicated by ~/digest/steady-refusal.stamp; the page goes to the loop's own ~/digest/page.jsonl. A normal "no candidate"
# is not a refusal and never pages. Paging failures are printed, never fatal: the draw goes on at 12 h.
if _refused:
    try:
        _st = os.path.expanduser('~/digest/steady-refusal.stamp')
        _last = float(open(_st).read().strip()) if os.path.exists(_st) else 0.0
        if now.timestamp() - _last > 6 * 3600:
            with open(os.path.expanduser('~/digest/page.jsonl'), 'a') as _pf:
                _pf.write(json.dumps({'ts': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'run': os.environ.get('DRAW_RUN') or 'drawrec',
                                      'level': 'error', 'msg': 'drawsteady REFUSED: the 6-h steady release is OFF (12 h for every '
                                      'pool) until fixed: ' + _refused[0][:240]}) + '\n')
            open(_st, 'w').write(str(now.timestamp()))
            print('STEADY refusal PAGED')
    except Exception as _pe:
        print('STEADY refusal could not be paged (%s)' % type(_pe).__name__)
excl -= _early
# brain-01 (staged): pools KEPT on a fixed remote brain are a different population; never drawn again. AFTER the steady release
# above (Codex/Claude r1 10-19): a 6 h steady release must never re-admit a subset pool.
try:
    for _p in json.load(open('/srv/mcbots/brain-subset.json')).get('pools') or []:
        excl.add(_p); _hard.add(_p); print('brain subset (never drawn):', _p)
except FileNotFoundError:
    pass
try:
    man = json.loads(txt.split('=== MANIFEST')[1]) if '=== MANIFEST' in txt else {}
    for p in str(man.get('canary_pool') or '').split(','):
        if p.strip(): excl.add(p.strip()); _hard.add(p.strip())
except Exception: pass
# Registration-driven exposure. This MUST be a term inside elig(), not a filter applied to its
# result: the `len(e) < 2` widening below recomputes e from scratch, and an earlier narrowing was
# silently discarded by it (caught in test, 17 Sep -- the widened draw offered two pools that
# could not expose the change at all). A pool that cannot expose the change under test is not
# eligible, however busy it looks on the v8 livelock/climb filter.
import os, subprocess, ast as _ast
RUN = os.environ.get('DRAW_RUN', '')
ALLOWED = None
# v37 FUN MODE (OWNER 2026-10-28): draw_exposure and draw_require_pools are LAB-ONLY launch requirements. A registration
# that does not say `"lab": true` is drawn without them. An unreadable registration counts as lab (the old, stricter draw).
_LAB = True
if RUN:
    for _rp0 in (os.path.expanduser('~/mcai-analysis/registrations/%s.json' % RUN), '/tmp/registrations/%s.json' % RUN):
        try:
            _LAB = json.load(open(_rp0)).get('lab') is True; break
        except Exception:
            pass
    if not _LAB:
        print('fun mode: draw_exposure and draw_require_pools are not applied (lab-only)')
if RUN and _LAB:
    _r = subprocess.run(['python3', os.path.expanduser('~/mcai-analysis/drawexposure.py'), RUN,
                         '--registrations', os.path.expanduser('~/mcai-analysis/registrations')],
                        capture_output=True, text=True)
    _l = [x for x in _r.stdout.splitlines() if x.startswith('eligible on exposure:')]
    # FAIL CLOSED (2026-10-08, canary scheduler review): a crash used to read as "no requirement".
    try:
        _rp = os.path.expanduser('~/mcai-analysis/registrations/%s.json' % RUN)
        if not os.path.exists(_rp):
            _rp = '/tmp/registrations/%s.json' % RUN
        _declared = bool(json.load(open(_rp)).get('draw_exposure'))
    except Exception:
        _declared = True
    if _l and _r.returncode in (0, 2):
        _v = _l[0].split(':', 1)[1].strip()
        ALLOWED = [] if _v == 'NONE' else _ast.literal_eval(_v)
        print('draw_exposure:', RUN, 'pools able to expose this change:', ALLOWED)
    elif _declared:
        ALLOWED = []
        print('draw_exposure: REFUSED for', RUN, '-- it declares draw_exposure (or its registration is unreadable) and '
              'drawexposure.py gave no usable answer (exit %s): %s' % (_r.returncode, ' '.join((_r.stdout + _r.stderr).split())[-200:]))
    else:
        print('draw_exposure: no requirement declared for', RUN, '-- v8 filter only')
# MANUAL EXCLUSIONS (18 Sep 2026): ~/mcai-analysis/draw-exclude.txt on the host, lines "<pool> <until ISO-8601 UTC> <why>".
# reseed-pool.sh writes the two re-seeded pools here for the seed canary's 72-h read, so no code canary lands on them
# and changes their arm under the read. Expired lines are ignored; malformed lines refuse the draw (a silent skip
# would be a widened draw nobody registered).
import datetime as _dt, os as _os
_xf = _os.path.expanduser('~/mcai-analysis/draw-exclude.txt')
if _os.path.exists(_xf):
    for _line in open(_xf):
        _line = _line.strip()
        if not _line or _line.startswith('#'): continue
        try: _p, _until = _line.split()[:2]; _u = _dt.datetime.fromisoformat(_until.replace('Z', '+00:00'))
        except Exception: raise SystemExit(f'draw-exclude.txt: malformed line {_line!r}; refusing to draw')
        if _u > now: excl.add(_p); _hard.add(_p); print('manual exclusion:', _p, 'until', _until)
# THE INFERENCE HALF IS NO LONGER HELD CONSTANT -- IT IS RECORDED AS A COVARIATE.
#
# This term used to read `h == '5080' and`. It made 3 of 12 pools permanently
# control and was the single filter that failed today's draw: with 6 of the 9
# 5080 pools inside their 12 h exclusion, the eligible set was 2, and the band
# then took it to 0. Dropping the half term alone made it 2 (board-d, placebo-d).
#
# It was dropped on a measurement, not an argument (halfdid.py, 2026-09-19, 360
# placebo canaries on windows where nothing was deployed, so the true effect is
# zero and every number is noise):
#
#     canary drawn from      n    null sd   null median
#     5080 half (allowed)  231       0.89         -8.6%
#     3090 half (banned)   129       0.70         +0.2%
#
# The forbidden half is BETTER behaved, not worse. That matches the harness env:
# every pool lists BOTH endpoints in OLLAMA_BASE_URLS with the same
# qwen2.5:7b-instruct on each, so the "half" only names which is tried first. It
# was never an isolation boundary. Two positive controls gate that study -- the
# aggregator matches poolrank2 exactly, and a planted +30% recovers as +30.0%.
#
# The BAND STAYS. The same study says it buys almost nothing on spread (sd 0.81
# inside vs 0.84 outside) but it does remove a -10% median bias -- regression to
# the mean, the hazard in argmax-pool-guarantees-reversion. Widening it would be
# the wrong move, and this comment exists so nobody reads "the half came out" as
# "the matching came out".
#
# `med` is the ALL-POOL median, computed above from the same table elig() draws
# from. It used to be the 5080-half median, which was a leftover from when the
# draw could only pick 5080 pools; see the note at the parse site.
# THE ENDPOINT IS READ FROM THE BOTS' OWN ENV FILES, NOT FROM A TABLE (10-22; Codex ops audit 10-21, low). The "half" in the
# band table is poolrank2.py's static rule (`-d` pools = 3090), which went stale at 10-21 13:42Z when the 20 -d bots moved to
# 10.0.0.72 first (.16 fallback), and this draw kept telling the read to record a 5080/3090 covariate that no longer existed.
# A pool's endpoint is now the FIRST entry of what its bots will actually try first, resolved exactly as bots/src/config.mjs
# does (OLLAMA_BASE_URLS, else OLLAMA_BASE_URL, else its default; the last assignment in a file wins, as systemd's
# EnvironmentFile reads it). A pool whose five bots disagree is `mixed:...`; one that cannot be read is `unknown:...`. Drop-ins
# are not read: a draw runs into an empty slot, where no canary drop-in exists (canary-sched S1-S8). DISPLAY ONLY -- nothing
# below the band uses it, the DRAW line is unchanged, and the number of lines after it is unchanged (canary-loop.sh reads the
# last four lines). The band's own half column is still parsed (poolrank2.py's format) but no longer printed as a fact.
_ENV_DIR = os.environ.get('DRAWREC_ENV_DIR', '/srv/mcbots/harness/env')
POOL_BOTS = 5                        # every pool is five bots; fewer or more env files is not agreement (Codex r1)
def _env_value(v):
    v = v.strip()
    if v[:1] in ('"', "'"):
        if len(v) < 2 or v[-1] != v[0]:
            raise ValueError('unbalanced quote')     # -> unknown: never a guessed value
        v = v[1:-1]
    return v
def _env_first_endpoint(path):
    """The endpoint the bot will try FIRST, as a normalized URL (scheme://host:port/path): two services on one host differ
    (Codex r1). Lines ending in a backslash are joined, as systemd's EnvironmentFile does."""
    _kv, _acc = {}, ''
    for _ln in open(path, errors='replace').read().split('\n'):
        if _ln.rstrip().endswith('\\'):
            _acc += _ln.rstrip()[:-1]; continue
        _ln, _acc = (_acc + _ln).strip(), ''
        if _ln.startswith('export '):
            _ln = _ln[7:].strip()
        if not _ln or _ln.startswith(('#', ';')) or '=' not in _ln:
            continue
        _k, _v = _ln.split('=', 1)
        _kv[_k.strip()] = _env_value(_v)
    if _acc:
        raise ValueError('a continuation runs off the end of the file')
    # config.mjs: req('OLLAMA_BASE_URLS', '') || req('OLLAMA_BASE_URL', default) -- `??` inside req, so a PRESENT but empty
    # OLLAMA_BASE_URL gives no endpoint at all, never the default (Claude r1 P3-10)
    _urls = _kv.get('OLLAMA_BASE_URLS') or (_kv['OLLAMA_BASE_URL'] if 'OLLAMA_BASE_URL' in _kv else 'http://studio.lan:11434')
    _first = [u.strip().rstrip('/') for u in _urls.split(',') if u.strip()]
    if not _first:
        return 'unknown:empty'
    from urllib.parse import urlsplit as _us
    _u = _us(_first[0])
    if not _u.scheme or not _u.hostname:
        return _first[0].lower()
    _port = _u.port or {'http': 80, 'https': 443}.get(_u.scheme.lower(), '')
    return '%s://%s:%s%s' % (_u.scheme.lower(), _u.hostname.lower(), _port, _u.path.rstrip('/'))
def pool_endpoint(pool):
    try:
        _fs = sorted(f for f in os.listdir(_ENV_DIR) if f.startswith(pool + '-') and f.endswith('.env')
                     and '-' not in f[len(pool) + 1:-4] and f[len(pool) + 1:-4])
    except Exception as _ex:
        return 'unknown:%s' % type(_ex).__name__
    if len(_fs) != POOL_BOTS:
        return 'unknown:%d-of-%d-env' % (len(_fs), POOL_BOTS)
    _eps = set()
    for _f in _fs:
        try:
            _eps.add(_env_first_endpoint(os.path.join(_ENV_DIR, _f)))
        except Exception as _ex:
            _eps.add('unknown:%s' % type(_ex).__name__)
    return _eps.pop() if len(_eps) == 1 else 'mixed:' + '+'.join(sorted(_eps))
ENDPOINT = {p: pool_endpoint(p) for p in band}
# v37 FUN-MODE FALLBACK (OWNER 2026-10-28, W4): canary-loop.sh sets DRAW_FUN_FALLBACK=1 once a fun-mode draw has waited
# FUN_DRAW_CAP_MIN (30). The draw then takes any pool outside the HARD exclusions (isolated-*, placebo-c, the live canary,
# the brain subset, draw-exclude.txt): no 12-h ledger exclusion, no productivity band, no livelock/climb filter, no
# draw_exposure. Those were measurement controls; fun mode reads harm, which needs bots, not a matched band.
FUN_FALLBACK = os.environ.get('DRAW_FUN_FALLBACK') == '1'
if FUN_FALLBACK:
    excl = set(_hard)
    print('FUN FALLBACK draw (the 30-min cap passed): hard exclusions only:', sorted(_hard))
def elig(w):
    if FUN_FALLBACK:
        return [p for p in band if p != 'placebo-c' and not p.startswith('isolated') and p not in excl]
    return [p for p, (h, ibh) in band.items() if p != 'placebo-c' and not p.startswith('isolated') and p not in excl and abs(ibh - med) / med <= w and p in expo and (expo[p][0] >= 8 or expo[p][1] >= 20) and (ALLOWED is None or p in ALLOWED)]
e = elig(0.25); w = '±25%'
# TWO pools are needed, so widen when the ±25% band yields FEWER THAN TWO, not only when it yields none: on 16 Sep 21:13Z the
# loop's first draw found one pool at ±25% and slept instead of stating the ±40% band the rule allows.
# Widen toward the FOUR-pool target, not the two-pool floor: the band is there to
# match productivity, and taking four at +-40% is a better read than two at +-25%
# (sd 0.313 vs 0.443) for a matching criterion measured to cost almost nothing on
# spread (0.81 inside vs 0.84 outside).
if len(e) < 4: e = elig(0.40); w = '±40% (widened, stated)'
trapped = [p for p in e if expo.get(p, (0, 0, 0))[2] >= 1]
print('median', round(med, 1), 'excluded(12h; released at 6h as steady KEEP+promoted: %s)' % sorted(_early), sorted(excl), 'band', w)
print('eligible', [(p, ENDPOINT[p], band[p][1], expo.get(p)) for p in e], '| with a trapped bot:', trapped)
_fleet_eps = sorted(set(ENDPOINT.values()))
_offer = {_h: sum(1 for p in e if ENDPOINT[p] == _h) for _h in sorted(set(ENDPOINT[p] for p in e))}
if len(_fleet_eps) == 1 and not _fleet_eps[0].startswith(('unknown:', 'mixed:')):
    print('endpoint mix on offer:', _offer, '-- every pool (%d) asks %s first: no endpoint covariate to record'
          % (len(ENDPOINT), _fleet_eps[0]))
else:
    print('endpoint mix on offer:', _offer, '-- pools differ in first endpoint (%s): RECORD THE FIRST ENDPOINT OF EACH DRAWN POOL '
          'AS A READ COVARIATE' % {_h: sum(1 for v in ENDPOINT.values() if v == _h) for _h in _fleet_eps})
# DRAW AS MANY POOLS AS THE BAND WILL GIVE, UP TO FOUR. TWO IS A FLOOR, NOT A TARGET.
#
# MEASURED 2026-09-21, 300 random splits per cell of the real 80 bots, null sd of
# the pool-mean ratio-DiD on items/bot-hour:
#
#         k=5      k=10     k=20     k=40
#   3h    0.608    0.443    0.313    0.292
#   6h    0.600    0.395    0.276    0.219
#   9h    0.411    0.318    0.222    0.196
#
# k=20 at 3 h (0.313) BEATS k=5 at 24 h (0.326) at one eighth the wall clock, and
# past k=20 the gain stalls (0.292) because the control set starts shrinking. Four
# pools is the optimum. Fitting sd^2 = a^2/W + c^2 at k=5 gives a floor sd of
# 0.262 -- MDE ~51% at ANY window -- so a five-bot draw, not a short read, is what
# made the committed endpoint unreadable. 55 decisions in 17 days produced 15 KEEPs
# and a flat endpoint, exactly what a 119% MDE predicts.
#
# CLAUDE.md says "randomize five bots per change". That five was a choice, and this
# is the change to it: the rigor it protects is difference-in-differences, which is
# untouched.
#
# Throughput is NOT the price. The binding constraint measured on 19 Sep is the 12 h
# per-pool exclusion plus the band, which already caps the fleet at about two
# canaries per twelve hours. Asking for four pools instead of two consumes the same
# exclusion budget per canary-day; it spends surplus CONTROL pools, which are the
# thing in surplus.
#
# It degrades rather than refusing: four if four are in band, else three, else two,
# and it SAYS WHICH -- so the read knows its own power instead of assuming it.
TARGET_K = 4
MIN_K = 2
# brain-01 (staged 2026-10-12): a registration may CAP the draw with `draw_k` (pools). A model/env canary on the
# Studio may take two pools (10 bots) and no more -- the Studio serves ~10-12 bots. Absent = 4, as above.
if RUN:
    # FAIL CLOSED (Codex r1): a registration that cannot be read, or a model-env one without a valid draw_k, draws
    # NOTHING rather than the default four pools -- a Studio canary on 20 bots is exactly the failure this cap prevents.
    _r, _x = None, None
    for _rp in (os.path.expanduser('~/mcai-analysis/registrations/%s.json' % RUN), '/tmp/registrations/%s.json' % RUN):   # the same two places as above
        try:
            _r = json.load(open(_rp)); break
        except Exception as _e:
            _x = _e
    if _r is None:
        print('draw_k: REGISTRATION UNREADABLE for', RUN, '(%s) -- drawing nothing' % _x)
    _dk = (_r or {}).get('draw_k')
    if _r is None or (_r.get('class') == 'model-env' and not (isinstance(_dk, int) and 1 <= _dk <= 2)):
        TARGET_K = 0; MIN_K = 1
        print('draw_k: refusing to draw for', RUN, '(model-env needs draw_k 1..2)')
    elif isinstance(_dk, int) and 1 <= _dk < TARGET_K:
        TARGET_K = _dk; MIN_K = min(MIN_K, _dk)
        print('draw_k: registration caps the draw at %d pool(s)' % _dk)
rng = secrets.SystemRandom()
npick = min(TARGET_K, len(e))
if npick < MIN_K:
    pick = None
else:
    _tr = rng.sample(trapped, min(npick, len(trapped)))
    _rest = [p for p in e if p not in _tr]
    pick = _tr + rng.sample(_rest, npick - len(_tr))
_none_why = 'fewer than %d eligible' % MIN_K
# REQUIRED POOLS (gate v35, coordinator 10-10; ~/mcai-analysis/drawrequire.py). A registration's draw_require_pools
# must ALL be in the draw, or nothing is drawn and the loop waits -- never a substitute. Required pools obey every
# exclusion above (12 h / 6 h, the live canary, draw-exclude.txt) but not the band or exposure filters; the rest of the
# draw comes from the ordinary eligible set. A malformed field, or a registration/module that cannot be read, draws
# nothing (fail closed). No field = exactly the draw above.
if RUN and _LAB:
    try:
        sys.path.insert(0, os.path.expanduser('~/mcai-analysis'))
        import drawrequire as _DRQ
        _rq = os.path.expanduser('~/mcai-analysis/registrations/%s.json' % RUN)
        if not os.path.exists(_rq):
            _rq = '/tmp/registrations/%s.json' % RUN
        _REQ, _bad = _DRQ.parse(json.load(open(_rq)))
    except Exception as _e:
        _REQ, _bad = None, 'registration or drawrequire.py unreadable (%s)' % type(_e).__name__
    if _REQ is None:
        pick = None; _none_why = 'draw_require_pools REFUSED: %s' % _bad
    elif _REQ:
        pick, _rwhy = _DRQ.pick(_REQ, e, excl, set(band), TARGET_K, MIN_K, rng.sample)
        print('draw_require_pools:', _rwhy)
        if not pick:
            _none_why = 'draw_require_pools: %s' % _rwhy
print('DRAW (%s, owner C):' % ('%d pools = %d bots' % (len(pick), 5 * len(pick)) if pick else 'none'),
      pick or 'NONE (%s)' % _none_why)
if pick:
    _k = 5 * len(pick)
    _sd = {5: 0.608, 10: 0.443, 15: 0.360, 20: 0.313}.get(_k, 0.313)
    print('drawn endpoints:', {p: ENDPOINT.get(p, 'unknown:not-in-band') for p in pick})
    print('k = %d bots; measured null sd on items/bot-h at 3 h is %.3f -> MDE ~%.0f%% at 1.96 sigma.'
          % (_k, _sd, 100 * (pow(2.718281828, 1.96 * _sd) - 1)))
    if len(pick) < TARGET_K:
        print('NOTE: drew %d of the %d-pool target -- the band had no more. The read is '
              'correspondingly weaker and must say so.' % (len(pick), TARGET_K))
PY
