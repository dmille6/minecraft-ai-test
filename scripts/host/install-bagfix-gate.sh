#!/bin/bash
# install-bagfix-gate.sh [--dry-run] -- installs gate generation v33 on the bots host (10.0.0.31), BETWEEN CANARIES ONLY.
#
# v33 = the BAG-FIX death rule (OWNER DECISION 2026-10-07 ~19:45Z) + the changerowcheck baseline-build fix (10-07):
#   ~/verdict.py                      death-gate REVERT carries by=death_gate; --bagfix-extended; bundle += 3 modules
#   ~/mcai-analysis/bagfixrule.py     NEW: the pure decisions + the value-weighted output measure (in the bundle)
#   ~/mcai-analysis/bagfixgate.py     NEW: extend-check / poll / final, run by the loop (in the bundle)
#   ~/mcai-analysis/changerowcheck.py counts declared rows from the BASELINE build only (in the bundle from v33)
#   ~/canary-loop.sh                  bag fixes drawn at 4 pools; the 24-h extension phase; replay overrides
#   ~/canarywatch.py                  a recorded extension moves a bag fix's STALE deadline
# and RE-REGISTERS the gate bundle digest in ~/digest/RULES-IN-FORCE.md (gatedigest.py refuses every launch until the
# recorded digest equals `verdict.py --gate-digest`, so the digest line and the code must change together).
#
# STAGE FIRST (from the repo, on the Mac, at the commit being installed):
#   ssh mike@10.0.0.31 'mkdir -p ~/bagfix-v33'
#   scp scripts/{verdict.py,bagfixrule.py,bagfixgate.py,changerowcheck.py,deathgate.py,test_bagfix.py,\
#       test_changerowcheck.py,test_verdict_acceptance.py} scripts/host/{canary-loop.sh,canarywatch.py,\
#       install-bagfix-gate.sh,v33-rules-paragraph.md,ugsafe2_value.py} mike@10.0.0.31:bagfix-v33/
#   ssh mike@10.0.0.31 'cd ~/bagfix-v33 && md5sum verdict.py bagfixrule.py bagfixgate.py changerowcheck.py \
#       canary-loop.sh canarywatch.py > STAGED.md5'   # compare against `md5` of the same files on the Mac
# THEN:  bash ~/bagfix-v33/install-bagfix-gate.sh --dry-run     (touches nothing live; prints the predicted digest)
#        bash ~/bagfix-v33/install-bagfix-gate.sh               (only with NO loop, NO chain and NO canary declared)
#
# WHY IT REFUSES WHILE ANYTHING RUNS. bash reads a running script by byte offset, so replacing canary-loop.sh under a
# live loop makes it execute from the middle of a different file. A chain/launch script waiting to exec the loop is
# the same hazard a few minutes later. And verdict.py/bagfixgate.py changing mid-canary would make one canary read
# by two gates. So: no canary-loop process, no chain-*/launch-* process, the loop's lock free, canary_pool null.
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
  [changerowcheck.py]=$H/mcai-analysis/changerowcheck.py
  [canary-loop.sh]=$H/canary-loop.sh
  [canarywatch.py]=$H/canarywatch.py
)

say "1. nothing may be running"
for f in "${!TGT[@]}" deathgate.py test_bagfix.py test_changerowcheck.py test_verdict_acceptance.py v33-rules-paragraph.md ugsafe2_value.py; do
  [ -f "$S/$f" ] || die "staged file missing: $S/$f"
done
L=$(pgrep -af '^bash /home/mike/canary-loop.sh' | grep -v pgrep || true)
C=$(pgrep -af 'chain-[a-z0-9-]*\.sh|launch-[a-z0-9-]*\.sh|chain-after' | grep -v -e pgrep -e install-bagfix || true)
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
bash -n canary-loop.sh || die "canary-loop.sh does not parse"
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
parts = {'verdict.py': m(S + '/verdict.py'), 'bagfixrule.py': m(S + '/bagfixrule.py'), 'bagfixgate.py': m(S + '/bagfixgate.py'),
         'changerowcheck.py': m(S + '/changerowcheck.py'), 'deathgate.py': m(H + '/mcai-analysis/deathgate.py'),
         'singledeath.py': m(H + '/mcai-analysis/singledeath.py'), 'arms.py': arms}
inner = ' '.join('%s=%s' % p for p in sorted(parts.items()))
print(hashlib.md5(inner.encode()).hexdigest())
for k, v in sorted(parts.items()):
    print('    %-17s %s' % (k, v))
PY
)
PD=$(echo "$PRED" | head -1)
echo "  predicted bundle digest: $PD"; echo "$PRED" | tail -n +2
cmp -s "$S/deathgate.py" "$H/mcai-analysis/deathgate.py" || die "staged deathgate.py differs from the live one (this install does not change deathgate.py)"

say "4. the rules file, re-registered (written to a scratch copy first)"
NEWRULES=$S/RULES-IN-FORCE.md.v33
python3 - "$RULES" "$NEWRULES" "$PD" "$S/v33-rules-paragraph.md" "$PRED" <<'PY' || die "could not rewrite the rules file"
import re, sys
src, dst, digest, para, pred = sys.argv[1:6]
t = open(src).read()
n = len(re.findall(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', t))
assert n == 1, 'expected exactly one GATE DIGEST line, found %d' % n
t = re.sub(r'(?m)^GATE DIGEST verdict-bundle md5 [0-9a-fA-F]{32}(?![0-9a-fA-F])', 'GATE DIGEST verdict-bundle md5 ' + digest, t)
t = t.replace('## THE REGISTERED GATE CODE (v32, 2026-09-26)', '## THE REGISTERED GATE CODE (v33, 2026-10-07; the interlock is v32)', 1)
old = re.search(r'(?ms)^  parts 2026-09-26.*?\n\n', t)
assert old, 'parts block not found'
lines = pred.splitlines()[1:]
t = t.replace(old.group(0), '  parts 2026-10-07 (v33; verdict.py + its imports + the two loop-run decision modules):\n'
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

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install:"
  for f in "${!TGT[@]}"; do echo "    $S/$f -> ${TGT[$f]}  ($(md5sum < "$S/$f" | cut -c1-8) replacing $( [ -f "${TGT[$f]}" ] && md5sum < "${TGT[$f]}" | cut -c1-8 || echo NEW))"; done
  echo "    $NEWRULES -> $RULES"
  echo "  then: gatedigest.py must print OK for $PD, or every file is restored from its .bak-v33-$STAMP"
  exit 0
fi

say "5. install: every backup made and VERIFIED first, then each file replaced by rename (never edited in place)"
# Round 1 (Codex): unchecked backups and a mid-loop `die` could leave a half-installed gate, and a failed backup could
# make the rollback DELETE an originally existing file. Now: (a) record which targets existed; (b) back up all of
# them and cmp each backup before touching anything; (c) stage every replacement beside its target; (d) only then
# rename; any failure or interruption from (d) on runs _rollback, which restores exactly what existed.
declare -A EXISTED=()
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  if [ -e "$t" ]; then
    EXISTED[$f]=1
    cp -p "$t" "$t.bak-v33-$STAMP" && cmp -s "$t" "$t.bak-v33-$STAMP" || die "backup of $t failed or differs; nothing installed"
  fi
  cp "$S/$f" "$t.new-v33" && cmp -s "$S/$f" "$t.new-v33" || { rm -f "$t.new-v33"; die "staging $t.new-v33 failed; nothing installed"; }
  [ "$f" = canary-loop.sh ] && chmod 755 "$t.new-v33"
done
cp -p "$RULES" "$RULES.bak-v33-$STAMP" && cmp -s "$RULES" "$RULES.bak-v33-$STAMP" || die "backup of $RULES failed; nothing installed"
_rollback() {
  trap - INT TERM HUP
  echo "ROLLING BACK v33"
  for f in "${!TGT[@]}"; do
    t=${TGT[$f]}
    if [ -n "${EXISTED[$f]:-}" ]; then mv -f "$t.bak-v33-$STAMP" "$t"; else rm -f "$t"; fi
    rm -f "$t.new-v33"
  done
  mv -f "$RULES.bak-v33-$STAMP" "$RULES"
  python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES
}
trap '_rollback; exit 4' INT TERM HUP
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  mv -f "$t.new-v33" "$t" || { echo "mv failed for $t"; _rollback; exit 4; }
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
echo "$(date -u +%FT%TZ) gate v33 installed: bundle $PD; backups *.bak-v33-$STAMP" >> $H/digest/gate-installs.log
echo "INSTALLED v33: bundle $PD registered; backups *.bak-v33-$STAMP. canarywatch.py is cron-run, so its next run uses the new file."
echo "Bag fixes now need \"class\": \"bag-fix\" and a bag_fix block (bagfixgate.py check-registration <run> checks one)."
