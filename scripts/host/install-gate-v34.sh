#!/bin/bash
# install-gate-v34.sh [--dry-run] -- installs gate generation v34 on the bots host (10.0.0.31), BETWEEN CANARIES ONLY.
#
# v34 = the UNDERGROUND-SAFETY death gate (docs/reports/usafe-death-gate-2026-10-08.md): a canary registered
# "class": "underground-safety" is drawn on the pools that drown, so its death gate is a DiD of death rates, each arm
# against its own 24-h PRE, at a threshold calibrated on the five-pool null; mechanism-linked deaths still revert.
#   ~/verdict.py                      v34 block (usafegate measures, usaferule decides); bundle += usaferule, usafegate
#   ~/mcai-analysis/usaferule.py      NEW: the pure decisions (in the bundle)
#   ~/mcai-analysis/usafegate.py      NEW: the measurement + check-registration (in the bundle)
#   ~/canary-loop.sh                  underground-safety registration preflight; a poll that answers UNREADABLE pages
#   ~/mcai-analysis/airpocket-01.{ee21207,dbb4d78}.json
#                                     the airpocket registrations, now "class": "underground-safety" with link_rules (the
#                                     launch copies one of them to registrations/airpocket-01.json; this does not launch)
# and RE-REGISTERS the gate bundle digest in ~/digest/RULES-IN-FORCE.md. v33's files (bagfixrule, bagfixgate,
# changerowcheck, canarywatch) are NOT changed: the staged copies must equal the live ones (checked), because the staged
# tests run on them.
#
# STAGE FIRST (from the repo, on the Mac, at the commit being installed):
#   ssh mike@10.0.0.31 'mkdir -p ~/gate-v34'
#   scp scripts/{verdict.py,usaferule.py,usafegate.py,bagfixrule.py,bagfixgate.py,changerowcheck.py,deathgate.py,\
#       test_usafe.py,test_bagfix.py,test_changerowcheck.py,test_verdict_acceptance.py} scripts/host/{canary-loop.sh,\
#       canarywatch.py,install-gate-v34.sh,v34-rules-paragraph.md,ugsafe2_value.py} \\
#       docs/reports/airpocket-01.{ee21207,dbb4d78}.json mike@10.0.0.31:gate-v34/
# THEN:  bash ~/gate-v34/install-gate-v34.sh --dry-run     (touches nothing live; prints the predicted digest)
#        bash ~/gate-v34/install-gate-v34.sh               (only with NO loop, NO chain and NO canary declared)
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
  [usaferule.py]=$H/mcai-analysis/usaferule.py
  [usafegate.py]=$H/mcai-analysis/usafegate.py
  [canary-loop.sh]=$H/canary-loop.sh
)
# THE BASE these were built against (round 1, Claude): a live file that has moved since is not overwritten blind.
# usaferule.py / usafegate.py are NEW: a live copy of either must not exist yet.
declare -A BASE=(
  [verdict.py]=07ad5e0939c430e395c53b2e51c864ce
  [canary-loop.sh]=19a06267a492845632cfc39eea454fb5
  [usaferule.py]=ABSENT
  [usafegate.py]=ABSENT
)
# the registrations: live = the original commit (278a1a7) or already this version
REGS="airpocket-01.ee21207.json:c615facfa340276e206f02e3b0a7d0fc airpocket-01.dbb4d78.json:4c70b21aaa933157ed41299cbbe9a361"
# unchanged by v34; staged only so the tests can run, and must equal the live files
SAME="bagfixrule.py:$H/mcai-analysis/bagfixrule.py bagfixgate.py:$H/mcai-analysis/bagfixgate.py changerowcheck.py:$H/mcai-analysis/changerowcheck.py canarywatch.py:$H/canarywatch.py deathgate.py:$H/mcai-analysis/deathgate.py"

say "1. nothing may be running"
for f in "${!TGT[@]}" bagfixrule.py bagfixgate.py changerowcheck.py canarywatch.py deathgate.py test_usafe.py test_bagfix.py \
         test_changerowcheck.py test_verdict_acceptance.py v34-rules-paragraph.md ugsafe2_value.py \
         airpocket-01.ee21207.json airpocket-01.dbb4d78.json; do
  [ -f "$S/$f" ] || die "staged file missing: $S/$f"
done
for pair in $SAME; do cmp -s "$S/${pair%%:*}" "${pair#*:}" || die "staged ${pair%%:*} differs from the live ${pair#*:} (v34 does not change it)"; done
for f in "${!BASE[@]}"; do
  t=${TGT[$f]}
  if [ "${BASE[$f]}" = ABSENT ]; then
    [ ! -e "$t" ] || cmp -s "$S/$f" "$t" || die "$t exists and is not the staged copy: v34 expected it NEW (another install?)"
  else
    LM=$(md5sum < "$t" | cut -c1-32)
    [ "$LM" = "${BASE[$f]}" ] || cmp -s "$S/$f" "$t" || die "live $t is $LM, not the base v34 was built on (${BASE[$f]}): rebuild on it"
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
  b=$(basename "$f"); case "$b" in verdict.py|test_*.py|ugsafe2_value.py) continue;; esac
  [ ! -e "$H/mcai-analysis/$b" ] || cmp -s "$f" "$H/mcai-analysis/$b" || die "staged $b differs from ~/mcai-analysis/$b, which SHADOWS it in the staged verdict tests"
done
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
bash -n canary-loop.sh || die "canary-loop.sh does not parse"
RD=$(mktemp -d); cp airpocket-01.ee21207.json airpocket-01.dbb4d78.json "$RD"/
for r in airpocket-01.ee21207 airpocket-01.dbb4d78; do
  USAFE_REG_DIR=$RD python3 usafegate.py check-registration $r | grep -q '^USAFE OK' || die "$r.json does not pass check-registration"
  python3 -c "import json,sys; r=json.load(open('$RD/$r.json')); assert r.get('class')=='underground-safety' and all(isinstance(x,str) for x in r.get('linkage_extra') or [])" \
    || die "$r.json: class or linkage_extra wrong"
done
rm -rf "$RD"; echo "  airpocket registrations: class underground-safety, check-registration OK (both)"
python3 canarywatch.py --selftest > canarywatch.out 2>&1 || die "canarywatch selftest: $(tail -2 canarywatch.out)"
echo "  canarywatch selftest: $(grep 'cases pass' canarywatch.out)"

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
parts = {'verdict.py': m(S + '/verdict.py'), 'usaferule.py': m(S + '/usaferule.py'), 'usafegate.py': m(S + '/usafegate.py'),
         'bagfixrule.py': m(H + '/mcai-analysis/bagfixrule.py'), 'bagfixgate.py': m(H + '/mcai-analysis/bagfixgate.py'),
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
NEWRULES=$S/RULES-IN-FORCE.md.v34
python3 - "$RULES" "$NEWRULES" "$PD" "$S/v34-rules-paragraph.md" "$PRED" <<'PY' || die "could not rewrite the rules file"
import re, sys
src, dst, digest, para, pred = sys.argv[1:6]
t = open(src).read()
n = len(re.findall(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', t))
assert n == 1, 'expected exactly one GATE DIGEST line, found %d' % n
t = re.sub(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', 'GATE DIGEST verdict-bundle md5 ' + digest, t)
t, nh = re.subn(r'(?m)^## THE REGISTERED GATE CODE \(.*\)$', '## THE REGISTERED GATE CODE (v34, 2026-10-08; the interlock is v32)', t, count=1)
assert nh == 1, 'header not found'
old = re.search(r'(?ms)^  parts \d{4}-\d\d-\d\d.*?\n\n', t)
assert old, 'parts block not found'
lines = pred.splitlines()[1:]
t = t.replace(old.group(0), '  parts 2026-10-08 (v34; verdict.py + its imports + the three loop-run decision modules):\n'
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
MF=$S/MANIFEST-v34.txt
_TL=""; for f in "${!TGT[@]}"; do _TL="$_TL$f=${TGT[$f]}"$'\n'; done
for pair in $REGS; do _TL="$_TL${pair%%:*}=$H/mcai-analysis/${pair%%:*}"$'\n'; done
_SL=""; for pair in $SAME; do _SL="$_SL${pair%%:*}=${pair#*:}"$'\n'; done
python3 - "$MF" "$S" "$PD" "$RULES" "$NEWRULES" "${DRY:+(dry run)}" "$_TL" "$_SL" <<'PY' || die "the manifest could not be written and verified"
import hashlib, os, sys, datetime as dt
mf, S, pd, rules, newrules, dry, tl, sl = sys.argv[1:9]
md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
targets = [l.split('=', 1) for l in tl.splitlines() if l.strip()]
same = [l.split('=', 1) for l in sl.splitlines() if l.strip()]
skip = lambda n: n.startswith('MANIFEST-v34.txt') or n == 'RULES-IN-FORCE.md.v34' or n.endswith('.out')
staged = sorted(n for n in os.listdir(S) if os.path.isfile(os.path.join(S, n)) and not skip(n))
lines = ['# gate v34 staged install manifest, written %s by install-gate-v34.sh %s' % (dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), dry),
         'predicted_bundle_digest %s' % pd]
for f, dest in sorted(targets):
    lines.append('target %s %s -> %s (live before: %s)' % (f, md5(os.path.join(S, f)), dest, md5(dest) if os.path.isfile(dest) else 'ABSENT'))
lines.append('target RULES-IN-FORCE.md.v34 %s -> %s (live before: %s)' % (md5(newrules), rules, md5(rules)))
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
want = {('target', f) for f, _ in targets} | {('target', 'RULES-IN-FORCE.md.v34')} | {('unchanged', f) for f, _ in same} | {('staged', n) for n in staged}
missing = want - set(got)
assert not missing, 'manifest incomplete: %s' % sorted(missing)
for (kind, name), h in got.items():
    path = newrules if name == 'RULES-IN-FORCE.md.v34' else os.path.join(S, name)
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
  echo "  then: gatedigest.py must print OK for $PD, or every file is restored from its .bak-v34-$STAMP"
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
    cp -p "$t" "$t.bak-v34-$STAMP" && cmp -s "$t" "$t.bak-v34-$STAMP" || die "backup of $t failed or differs; nothing installed"
  fi
  cp "$S/$f" "$t.new-v34" && cmp -s "$S/$f" "$t.new-v34" || { rm -f "$t.new-v34"; die "staging $t.new-v34 failed; nothing installed"; }
  [ "$f" = canary-loop.sh ] && chmod 755 "$t.new-v34"
done
cp -p "$RULES" "$RULES.bak-v34-$STAMP" && cmp -s "$RULES" "$RULES.bak-v34-$STAMP" || die "backup of $RULES failed; nothing installed"
_rollback() {
  trap - INT TERM HUP
  echo "ROLLING BACK v34"
  for f in "${!TGT[@]}"; do
    t=${TGT[$f]}
    if [ -n "${EXISTED[$f]:-}" ]; then mv -f "$t.bak-v34-$STAMP" "$t"; else rm -f "$t"; fi
    rm -f "$t.new-v34"
  done
  mv -f "$RULES.bak-v34-$STAMP" "$RULES"
  python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES
}
trap '_rollback; exit 4' INT TERM HUP
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  mv -f "$t.new-v34" "$t" || { echo "mv failed for $t"; _rollback; exit 4; }
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
echo "$(date -u +%FT%TZ) gate v34 installed: bundle $PD; backups *.bak-v34-$STAMP" >> $H/digest/gate-installs.log
echo "INSTALLED v34: bundle $PD registered; backups *.bak-v34-$STAMP."
echo "Underground-safety canaries need \"class\": \"underground-safety\" and an underground_safety block (usafegate.py check-registration <run>)."
