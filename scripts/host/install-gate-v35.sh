#!/bin/bash
# install-gate-v35.sh [--dry-run] -- installs gate generation v35 on the bots host (10.0.0.31), BETWEEN CANARIES ONLY.
#
# v35 = rule A' (OWNER DELEGATION 2026-10-08 to operator + Codex): a bag fix drawn at FOUR pools may KEEP at +180 when
# every gate and guard passes, exposure is ready, no extension is in force, all reads are readable and its cumulative
# death rate is <= the control's; otherwise +360 as before (docs/reports/keep180-2026-10-08.md).
#   ~/verdict.py                      the A' branch before section 9's NOT_YET; bag metric reported at a bag-fix KEEP;
#                                     VERDICT_MODULE_DIR (tests/staging only) put first on sys.path
#   ~/mcai-analysis/bagfixrule.py     keep_early + death_rate_ok (pure; in the bundle); THREE-POOL rules below
# and THROUGHPUT (OPERATOR + CODEX 2026-10-10, owner's delegation; docs/reports/threepool-2026-10-10.md):
#   ~/mcai-analysis/bagfixrule.py     extend_min/bands by pool count (4: 1440, -3.21/-0.127; 3: 1920, -4.09/-0.173),
#                                     three_pool_ok, draw_decision (pure)
#   ~/mcai-analysis/bagfixgate.py     draw-decide and ext-min CLIs; extend-check/poll/final follow the pool count
#   ~/canary-loop.sh                  the bag-fix draw acts on draw-decide (three pools after > 1 h blocked solely by
#                                     the four-pool minimum; never two); EXTMIN/EXTDL from ext-min
#   ~/mcai-analysis/drawrec.sh        subtracts drawsteady's 6-h release from the 12-h ledger exclusion
#   ~/mcai-analysis/drawsteady.py     NEW: the 6-h release for steady KEEP+promoted pools (fail closed: 12 h)
# and RE-REGISTERS the gate bundle digest in ~/digest/RULES-IN-FORCE.md. Everything else must equal the live files.
#
# STAGE FIRST (from the repo, on the Mac, at the commit being installed):
#   ssh mike@10.0.0.31 'mkdir -p ~/gate-v35'
#   scp scripts/{verdict.py,bagfixrule.py,usaferule.py,usafegate.py,bagfixgate.py,changerowcheck.py,deathgate.py,drawsteady.py,\
#       test_keep180.py,test_usafe.py,test_bagfix.py,test_changerowcheck.py,test_verdict_acceptance.py,test_holdtoken.py,\
#       test_threepool.py} scripts/host/{canary-loop.sh,drawrec.sh,bagread.py,holdtoken.py,test_bagfix_loop.py,\
#       canarywatch.py,install-gate-v35.sh,v35-rules-paragraph.md,ugsafe2_value.py} \
#       docs/reports/airpocket-01.{ee21207,dbb4d78}.json mike@10.0.0.31:gate-v35/
# THEN:  bash ~/gate-v35/install-gate-v35.sh --dry-run     (touches nothing live; prints the predicted digest)
#        bash ~/gate-v35/install-gate-v35.sh               (only with NO loop, NO chain and NO canary declared)
#
# WHY IT REFUSES WHILE ANYTHING RUNS. bash reads a running script by byte offset, so replacing canary-loop.sh under a
# live loop makes it execute from the middle of a different file; a chain/launch script waiting to exec the loop is the
# same hazard minutes later; and verdict.py changing mid-canary would make one canary read by two gates.
set -u
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MAN=/srv/mcbots/trial-manifest.json; RULES=$H/digest/RULES-IN-FORCE.md
say() { echo "== $*"; }; die() { echo "REFUSED: $*"; exit 2; }
# source (staged) -> live target
declare -A TGT=(
  [verdict.py]=$H/verdict.py
  [bagfixrule.py]=$H/mcai-analysis/bagfixrule.py
  [bagfixgate.py]=$H/mcai-analysis/bagfixgate.py
  [canary-loop.sh]=$H/canary-loop.sh
  [drawrec.sh]=$H/mcai-analysis/drawrec.sh
  [drawsteady.py]=$H/mcai-analysis/drawsteady.py
)
# THE BASE these were built against (round 1, Claude): a live file that has moved since is not overwritten blind.
# v34 as installed 10-08 07:26Z (bundle 97abe762).
declare -A BASE=(
  [verdict.py]=9dfdac6d6d639ff186ffc91b11ce3f10
  [bagfixrule.py]=1560c53ec9ffb4d3cea5cd8b64e5c2ea
  [bagfixgate.py]=e8291c15632f660fa5af4d74689a1113
  [canary-loop.sh]=4a0d3670499cefabdd11ebb51260002f
  [drawrec.sh]=c95a981192b633735c9ec01c5c4cfb7b
  [drawsteady.py]=ABSENT
)
REGS=""
# unchanged by v35; staged only so the tests can run, and must equal the live files
SAME="usaferule.py:$H/mcai-analysis/usaferule.py usafegate.py:$H/mcai-analysis/usafegate.py changerowcheck.py:$H/mcai-analysis/changerowcheck.py canarywatch.py:$H/canarywatch.py deathgate.py:$H/mcai-analysis/deathgate.py bagread.py:$H/mcai-analysis/bagread.py"

say "1. nothing may be running"
for f in "${!TGT[@]}" usaferule.py usafegate.py changerowcheck.py canarywatch.py deathgate.py bagread.py test_threepool.py test_bagfix_loop.py \
         test_keep180.py test_usafe.py test_bagfix.py test_changerowcheck.py test_verdict_acceptance.py v35-rules-paragraph.md \
         ugsafe2_value.py holdtoken.py test_holdtoken.py airpocket-01.ee21207.json airpocket-01.dbb4d78.json; do
  [ -f "$S/$f" ] || die "staged file missing: $S/$f"
done
for pair in $SAME; do cmp -s "$S/${pair%%:*}" "${pair#*:}" || die "staged ${pair%%:*} differs from the live ${pair#*:} (v35 does not change it)"; done
for f in "${!BASE[@]}"; do
  t=${TGT[$f]}
  if [ "${BASE[$f]}" = ABSENT ]; then
    [ ! -e "$t" ] || cmp -s "$S/$f" "$t" || die "$t exists and is not the staged copy: v35 expected it NEW (another install?)"
  else
    LM=$(md5sum < "$t" | cut -c1-32)
    [ "$LM" = "${BASE[$f]}" ] || cmp -s "$S/$f" "$t" || die "live $t is $LM, not the base v35 was built on (${BASE[$f]}): rebuild on it"
  fi
done
for pair in $REGS; do
  f=${pair%%:*}; t=$H/mcai-analysis/$f
  [ -e "$t" ] || die "$t missing (the airpocket build put it there)"
  LM=$(md5sum < "$t" | cut -c1-32)
  [ "$LM" = "${pair#*:}" ] || cmp -s "$S/$f" "$t" || die "live $t is $LM: neither the original registration nor this version"
done
# SHADOWS (round 1, Codex): verdict.py puts ~/mcai-analysis FIRST on sys.path, so the staged tests that run the staged
# verdict.py import every module that ALSO exists there from the LIVE copy. Each staged module present live must therefore
# equal it, or the tests passed on code that is not the code being installed.
for f in "$S"/*.py; do
  b=$(basename "$f"); case "$b" in verdict.py|bagfixrule.py|bagfixgate.py|drawsteady.py|test_*.py|ugsafe2_value.py|holdtoken.py) continue;; esac   # targets: tested via VERDICT_MODULE_DIR
  [ ! -e "$H/mcai-analysis/$b" ] || cmp -s "$f" "$H/mcai-analysis/$b" || die "staged $b differs from ~/mcai-analysis/$b, which SHADOWS it in the staged verdict tests"
done
# THE SCHEDULER'S INSTALL-HOLD FIRST (round 1, Codex): no NEW launch while it exists, and canary-sched.py's own slot checks
# (manifest, processes, the loop lock, canary drop-ins, unit freshness, open runs) must pass; released at exit. Drop-ins
# are refused here too. A dry run writes no hold.
DROPINS=$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
[ -z "$DROPINS" ] || { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: canary drop-ins present: $DROPINS" || die "canary drop-ins present: $DROPINS"; }
[ -f $H/canary-sched.py ] || { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: $H/canary-sched.py missing (the install-hold is required)" || die "$H/canary-sched.py missing"; }
# OWNERSHIP (rounds 2-3, Codex P1): canary-sched.py's install-hold overwrites any hold and its install-release deletes
# any hold, so this installer calls NEITHER. holdtoken.py claims the hold AND runs the scheduler's own slot checks under
# ONE hold of its tick lock (refused if any hold exists; on a busy slot it withdraws only its own hold), with a token
# unique to this run. The EXIT trap is armed only after that claim succeeds and releases only a hold still owned by it.
if [ -n "$DRY" ]; then
  HO=$(python3 $S/holdtoken.py owner 2>&1)
  [ -z "$HO" ] || echo "  (dry run) WOULD REFUSE: an install-hold exists (owner $HO)"
else
  TOKEN="install-gate-v35:$$:$(date +%s%N)"
  CL=$(python3 $S/holdtoken.py claim "$TOKEN" 45 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-500)"
  trap 'python3 $S/holdtoken.py release "$TOKEN" >/dev/null 2>&1' EXIT
  echo "  $(echo "$CL" | tail -1 | cut -c1-200)"
fi
L=$(pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep || true)
C=$(pgrep -af 'chain-[a-z0-9-]*\.sh|launch-[a-z0-9-]*\.sh|chain-after' | grep -v -e pgrep -e install-gate || true)
[ -z "$L" ] || { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: canary loop running: $L" || die "a canary loop is running: $L"; }
[ -z "$C" ] || { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: chain/launch script running: $C" || die "a chain/launch script is running: $C"; }
# The manifest must PARSE and say "no canary" explicitly (canary_pool null/empty AND canary_code_version null/empty):
# an unreadable manifest is not an inactive one (round 1, Codex: a parse failure used to read as "no canary").
CP=$(python3 -c "
import json, sys
m = json.load(open('$MAN'))
if not isinstance(m, dict) or 'canary_pool' not in m: sys.exit(3)
print('ACTIVE ' + str(m.get('canary_pool')) + ' ' + str(m.get('canary_code_version')) if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')
" 2>&1); RCP=$?
[ $RCP -eq 0 ] || { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: manifest unreadable ($CP)" || die "manifest $MAN unreadable or malformed ($CP): cannot show that no canary is live"; }
[ "$CP" = "INACTIVE" ] || { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: $CP" || die "a canary is declared ($CP): teardown first"; }
grep -qE '^TARGET_K = [4-9]' $H/mcai-analysis/drawrec.sh || { [ -n "$DRY" ] && echo "  (dry run) WOULD REFUSE: drawrec.sh does not target 4 pools" || die "$H/mcai-analysis/drawrec.sh does not target 4 pools (TARGET_K): bag fixes could never draw"; }
if [ -n "$DRY" ]; then
  # a dry run only PROBES the lock (take and release): holding it for the minutes the tests take would make a loop
  # launched meanwhile exit 3
  flock -n /tmp/mcai-canary.lock true || echo "  (dry run) WOULD REFUSE: /tmp/mcai-canary.lock is held"
  LK="free (probed, not held)"
else
  exec 8>/tmp/mcai-canary.lock
  flock -n 8 || die "/tmp/mcai-canary.lock is held"
  # the real install HOLDS the loop's own lock until it exits: a loop started meanwhile exits 3
  LK="held by this installer"
fi
echo "  loop: ${L:-none}; chains: ${C:-none}; canary_pool: ${CP:-null}; lock: $LK"

say "2. the staged bundle passes its own tests (staging dir, nothing live)"
cd "$S" || die "cannot cd $S"
# every staged verdict.py run imports the STAGED decision modules first (bagfixrule differs from the live one)
export VERDICT_MODULE_DIR=$S
python3 test_changerowcheck.py > test_changerowcheck.out 2>&1 || die "test_changerowcheck.py failed: $(tail -3 test_changerowcheck.out)"
echo "  test_changerowcheck: $(tail -1 test_changerowcheck.out)"
python3 test_verdict_acceptance.py > test_verdict_acceptance.out 2>&1 || true
grep -q "83/83 acceptance cases pass" test_verdict_acceptance.out || die "acceptance suite: $(tail -1 test_verdict_acceptance.out)"
echo "  test_verdict_acceptance: $(tail -1 test_verdict_acceptance.out)"
python3 test_bagfix.py > test_bagfix.out 2>&1 || die "test_bagfix.py failed: $(grep -E '^FAIL|pass' test_bagfix.out | tail -5)"
grep -q "SKIPPED" test_bagfix.out && die "test_bagfix.py SKIPPED a section on the host: $(grep SKIPPED test_bagfix.out)"
echo "  test_bagfix: $(tail -1 test_bagfix.out)"
python3 test_usafe.py > test_usafe.out 2>&1 || die "test_usafe.py failed: $(grep -E '^FAIL|pass' test_usafe.out | tail -5)"
grep -q "SKIPPED" test_usafe.out && die "test_usafe.py SKIPPED a section on the host: $(grep SKIPPED test_usafe.out)"
echo "  test_usafe: $(tail -1 test_usafe.out)"
python3 test_keep180.py > test_keep180.out 2>&1 || die "test_keep180.py failed: $(grep -E '^FAIL|pass' test_keep180.out | tail -5)"
grep -q "SKIPPED" test_keep180.out && die "test_keep180.py SKIPPED a section on the host: $(grep SKIPPED test_keep180.out)"
echo "  test_keep180: $(tail -1 test_keep180.out)"
python3 test_holdtoken.py > test_holdtoken.out 2>&1 || die "test_holdtoken.py failed: $(grep -E '^FAIL|pass' test_holdtoken.out | tail -5)"
echo "  test_holdtoken: $(tail -1 test_holdtoken.out)"
python3 test_threepool.py > test_threepool.out 2>&1 || die "test_threepool.py failed: $(grep -E '^FAIL|pass' test_threepool.out | tail -5)"
grep -q "SKIPPED" test_threepool.out && die "test_threepool.py SKIPPED a section on the host: $(grep SKIPPED test_threepool.out)"
echo "  test_threepool: $(tail -1 test_threepool.out)"
python3 test_bagfix_loop.py > test_bagfix_loop.out 2>&1 || die "test_bagfix_loop.py failed: $(grep -E '^FAIL|pass' test_bagfix_loop.out | tail -5)"
echo "  test_bagfix_loop: $(tail -1 test_bagfix_loop.out)"
bash -n canary-loop.sh || die "canary-loop.sh does not parse"
bash -n drawrec.sh || die "drawrec.sh does not parse"
grep -qE '^TARGET_K = 4$' drawrec.sh && grep -qE '^MIN_K = 2$' drawrec.sh || die "staged drawrec.sh changed TARGET_K/MIN_K (v35 does not)"
RD=$(mktemp -d); cp airpocket-01.ee21207.json airpocket-01.dbb4d78.json "$RD"/
for r in airpocket-01.ee21207 airpocket-01.dbb4d78; do
  USAFE_REG_DIR=$RD python3 usafegate.py check-registration $r | grep -q '^USAFE OK' || die "$r.json does not pass check-registration"
  python3 -c "import json,sys; r=json.load(open('$RD/$r.json')); assert r.get('class')=='underground-safety' and all(isinstance(x,str) for x in r.get('linkage_extra') or [])" \
    || die "$r.json: class or linkage_extra wrong"
done
rm -rf "$RD"; echo "  airpocket registrations: class underground-safety, check-registration OK (both)"
python3 canarywatch.py --selftest > canarywatch.out 2>&1 || die "canarywatch selftest: $(tail -2 canarywatch.out)"
echo "  canarywatch selftest: $(grep 'cases pass' canarywatch.out)"
# the staged-module override is for the staged TESTS only: every digest, interlock and rollback check below resolves
# modules exactly as production does (round 1, Codex)
unset VERDICT_MODULE_DIR

say "3. the digest the installed bundle WILL have (predicted from the files, before anything is copied)"
# Parts exactly as verdict.py's _gate_bundle resolves them once installed: verdict.py at ~, everything else from
# ~/mcai-analysis (first on its sys.path) -- staged copies for the files this install replaces, live ones otherwise.
# arms.py is whatever the LIVE gate resolves today (it is not changed here).
ARMS=$(python3 $H/verdict.py --gate-digest | awk '$1 == "arms.py" {print $2}')
[ -n "$ARMS" ] && [ "$ARMS" != "UNRESOLVED" ] || die "cannot resolve arms.py from the live gate"
PRED=$(python3 - "$S" "$H" "$ARMS" <<'PY'
import hashlib, sys
S, H, arms = sys.argv[1:4]
m = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
parts = {'verdict.py': m(S + '/verdict.py'), 'usaferule.py': m(H + '/mcai-analysis/usaferule.py'), 'usafegate.py': m(H + '/mcai-analysis/usafegate.py'),
         'bagfixrule.py': m(S + '/bagfixrule.py'), 'bagfixgate.py': m(S + '/bagfixgate.py'),
         'changerowcheck.py': m(H + '/mcai-analysis/changerowcheck.py'), 'deathgate.py': m(H + '/mcai-analysis/deathgate.py'),
         'singledeath.py': m(H + '/mcai-analysis/singledeath.py'), 'arms.py': arms}
inner = ' '.join('%s=%s' % p for p in sorted(parts.items()))
print(hashlib.md5(inner.encode()).hexdigest())
for k, v in sorted(parts.items()):
    print('    %-17s %s' % (k, v))
PY
)
PD=$(echo "$PRED" | head -1)
echo "  predicted bundle digest: $PD"; echo "$PRED" | tail -n +2

say "4. the rules file, re-registered (written to a scratch copy first)"
NEWRULES=$S/RULES-IN-FORCE.md.v35
python3 - "$RULES" "$NEWRULES" "$PD" "$S/v35-rules-paragraph.md" "$PRED" <<'PY' || die "could not rewrite the rules file"
import re, sys
src, dst, digest, para, pred = sys.argv[1:6]
t = open(src).read()
n = len(re.findall(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', t))
assert n == 1, 'expected exactly one GATE DIGEST line, found %d' % n
t = re.sub(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', 'GATE DIGEST verdict-bundle md5 ' + digest, t)
t, nh = re.subn(r'(?m)^## THE REGISTERED GATE CODE \(.*\)$', '## THE REGISTERED GATE CODE (v35, 2026-10-08; the interlock is v32)', t, count=1)
assert nh == 1, 'header not found'
old = re.search(r'(?ms)^  parts \d{4}-\d\d-\d\d.*?\n\n', t)
assert old, 'parts block not found'
lines = pred.splitlines()[1:]
t = t.replace(old.group(0), '  parts 2026-10-08 (v35; verdict.py + its imports + the three loop-run decision modules):\n'
              + '\n'.join(l.replace('    ', '    ', 1) for l in lines) + '\n\n', 1)
anchor = '## Rules in force (docs/reports/recovery-ladder-registration.md)\n'
assert t.count(anchor) == 1, 'rules anchor not found once'
t = t.replace(anchor, anchor + open(para).read().rstrip('\n') + ' ', 1)
open(dst, 'w').write(t)
PY
python3 - "$NEWRULES" "$PD" <<PY || die "the rewritten rules file does not carry exactly the predicted digest"
import sys, importlib.util
spec = importlib.util.spec_from_file_location('gd', '$H/mcai-analysis/gatedigest.py'); gd = importlib.util.module_from_spec(spec); spec.loader.exec_module(gd)
rec = [m.group(1).lower() for m in gd.DIGEST_RE.finditer(gd.read_rules(sys.argv[1]))]
assert rec == [sys.argv[2]], rec
print('  gatedigest.DIGEST_RE finds exactly one record in the rewritten file: %s' % rec[0])
PY
diff <(cat "$RULES") "$NEWRULES" | cut -c1-240 | head -40
# THE MANIFEST (coordinator 10-08: a later installer -- the multi-lane canary system -- diffs against it). Exact md5 of
# every staged input, of each live target BEFORE this install (or ABSENT), each destination, the unchanged pairs and the
# predicted digest. Written by Python with checked writes (round 9, Codex: shell echo failures inside a { } block were
# masked), re-read and checked against the COMPLETE expected inventory before it replaces any earlier manifest.
MF=$S/MANIFEST-v35.txt
_TL=""; for f in "${!TGT[@]}"; do _TL="$_TL$f=${TGT[$f]}"$'\n'; done
for pair in $REGS; do _TL="$_TL${pair%%:*}=$H/mcai-analysis/${pair%%:*}"$'\n'; done
_SL=""; for pair in $SAME; do _SL="$_SL${pair%%:*}=${pair#*:}"$'\n'; done
python3 - "$MF" "$S" "$PD" "$RULES" "$NEWRULES" "${DRY:+(dry run)}" "$_TL" "$_SL" <<'PY' || die "the manifest could not be written and verified"
import hashlib, os, sys, datetime as dt
mf, S, pd, rules, newrules, dry, tl, sl = sys.argv[1:9]
md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
targets = [l.split('=', 1) for l in tl.splitlines() if l.strip()]
same = [l.split('=', 1) for l in sl.splitlines() if l.strip()]
skip = lambda n: n.startswith('MANIFEST-v35.txt') or n == 'RULES-IN-FORCE.md.v35' or n.endswith('.out')
staged = sorted(n for n in os.listdir(S) if os.path.isfile(os.path.join(S, n)) and not skip(n))
lines = ['# gate v35 staged install manifest, written %s by install-gate-v35.sh %s' % (dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), dry),
         'predicted_bundle_digest %s' % pd]
for f, dest in sorted(targets):
    lines.append('target %s %s -> %s (live before: %s)' % (f, md5(os.path.join(S, f)), dest, md5(dest) if os.path.isfile(dest) else 'ABSENT'))
lines.append('target RULES-IN-FORCE.md.v35 %s -> %s (live before: %s)' % (md5(newrules), rules, md5(rules)))
for f, live in sorted(same):
    lines.append('unchanged %s %s == %s' % (f, md5(os.path.join(S, f)), live))
for n in staged:
    lines.append('staged %s %s' % (n, md5(os.path.join(S, n))))
tmp = mf + '.tmp'
with open(tmp, 'w') as fh:
    fh.write('\n'.join(lines) + '\n'); fh.flush(); os.fsync(fh.fileno())
# re-read what is on disk and require EVERY expected record, each hash matching its file
got = {}
for line in open(tmp):
    w = line.split()
    if len(w) >= 3 and w[0] in ('staged', 'target', 'unchanged'):
        got[(w[0], w[1])] = w[2]
want = {('target', f) for f, _ in targets} | {('target', 'RULES-IN-FORCE.md.v35')} | {('unchanged', f) for f, _ in same} | {('staged', n) for n in staged}
missing = want - set(got)
assert not missing, 'manifest incomplete: %s' % sorted(missing)
for (kind, name), h in got.items():
    path = newrules if name == 'RULES-IN-FORCE.md.v35' else os.path.join(S, name)
    assert md5(path) == h, 'manifest hash for %s is stale' % name
os.replace(tmp, mf)
print('  manifest: %s' % mf)
print('  manifest verified: %d records, the complete expected inventory, every hash matching its file' % len(got))
PY

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install:"
  for f in "${!TGT[@]}"; do echo "    $S/$f -> ${TGT[$f]}  ($(md5sum < "$S/$f" | cut -c1-8) replacing $( [ -f "${TGT[$f]}" ] && md5sum < "${TGT[$f]}" | cut -c1-8 || echo NEW))"; done
  for pair in $REGS; do f=${pair%%:*}; echo "    $S/$f -> $H/mcai-analysis/$f  ($(md5sum < "$S/$f" | cut -c1-8) replacing $(md5sum < "$H/mcai-analysis/$f" | cut -c1-8))"; done
  echo "    $NEWRULES -> $RULES"
  echo "  then: gatedigest.py must print OK for $PD, or every file is restored from its .bak-v35-$STAMP"
  exit 0
fi

say "5. install: every backup made and VERIFIED first, then each file replaced by rename (never edited in place)"
for pair in $REGS; do f=${pair%%:*}; TGT[$f]=$H/mcai-analysis/$f; done
# Round 1 (Codex): unchecked backups and a mid-loop `die` could leave a half-installed gate, and a failed backup could
# make the rollback DELETE an originally existing file. Now: (a) record which targets existed; (b) back up all of
# them and cmp each backup before touching anything; (c) stage every replacement beside its target; (d) only then
# rename; any failure or interruption from (d) on runs _rollback, which restores exactly what existed.
declare -A EXISTED=()
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  if [ -e "$t" ]; then
    EXISTED[$f]=1
    cp -p "$t" "$t.bak-v35-$STAMP" && cmp -s "$t" "$t.bak-v35-$STAMP" || die "backup of $t failed or differs; nothing installed"
  fi
  cp "$S/$f" "$t.new-v35" && cmp -s "$S/$f" "$t.new-v35" || { rm -f "$t.new-v35"; die "staging $t.new-v35 failed; nothing installed"; }
  [ "$f" = canary-loop.sh ] && chmod 755 "$t.new-v35"
  [ -n "${EXISTED[$f]:-}" ] && [ "$f" != canary-loop.sh ] && chmod --reference="$t" "$t.new-v35"
done
cp -p "$RULES" "$RULES.bak-v35-$STAMP" && cmp -s "$RULES" "$RULES.bak-v35-$STAMP" || die "backup of $RULES failed; nothing installed"
_rollback() {
  trap - INT TERM HUP
  echo "ROLLING BACK v35"
  for f in "${!TGT[@]}"; do
    t=${TGT[$f]}
    if [ -n "${EXISTED[$f]:-}" ]; then mv -f "$t.bak-v35-$STAMP" "$t"; else rm -f "$t"; fi
    rm -f "$t.new-v35"
  done
  mv -f "$RULES.bak-v35-$STAMP" "$RULES"
  python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES
}
trap '_rollback; exit 4' INT TERM HUP
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  mv -f "$t.new-v35" "$t" || { echo "mv failed for $t"; _rollback; exit 4; }
  echo "  installed $t"
done
mv -f "$NEWRULES" "$RULES" || { echo "mv failed for $RULES"; _rollback; exit 4; }
echo "  re-registered $RULES"

say "6. the interlock agrees, or everything is rolled back"
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
if [ "$LIVE" != "$PD" ] || ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES; then
  echo "MISMATCH: live $LIVE vs predicted $PD"
  _rollback
  exit 3
fi
trap - INT TERM HUP
echo "$(date -u +%FT%TZ) gate v35 installed: bundle $PD; backups *.bak-v35-$STAMP" >> $H/digest/gate-installs.log
echo "INSTALLED v35: bundle $PD registered; backups *.bak-v35-$STAMP."
echo "Underground-safety canaries need \"class\": \"underground-safety\" and an underground_safety block (usafegate.py check-registration <run>)."
