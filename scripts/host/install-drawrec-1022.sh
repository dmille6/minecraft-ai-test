#!/bin/bash
# install-drawrec-1022.sh [--dry-run] -- drawrec.sh's endpoint lines (10-22; Codex ops audit 10-21, low), BETWEEN CANARIES ONLY.
# ONE file changes:
#   ~/mcai-analysis/drawrec.sh   the per-pool endpoint is read from the bots' env files (OLLAMA_BASE_URLS, first entry, as
#                                bots/src/config.mjs resolves it) instead of poolrank2.py's static half; the read covariate is
#                                instructed only when pools differ. DISPLAY ONLY: the DRAW line, the band, the exposure and
#                                every exclusion are unchanged, and so is the number of lines after DRAW (the loop reads
#                                `tail -4`).
# drawrec.sh is NOT a gate-bundle part (verdict.py --gate-digest hashes verdict.py, its imports and bagfixgate/changerowcheck/
# usafegate), so RULES-IN-FORCE.md is NOT re-registered: the GATE DIGEST is verified unchanged before and after, exactly as
# install-brain01-host.sh did for its drawrec.sh change (gate-installs.log 2026-10-19T16:27:20Z).
#
# STAGE (from the repo at the commit being installed):
#   ssh mike@10.0.0.31 'mkdir -p ~/drawrec-1022'
#   scp scripts/host/{drawrec.sh,test_drawrec_endpoint.py,install-drawrec-1022.sh} scripts/{test_drawrequire.py,drawrequire.py} \
#       mike@10.0.0.31:drawrec-1022/
# THEN:  bash ~/drawrec-1022/install-drawrec-1022.sh --dry-run
#        bash ~/drawrec-1022/install-drawrec-1022.sh
# It takes the scheduler's install-hold (holdtoken.py claim: the scheduler's own slot checks under its tick lock) and
# /tmp/mcai-canary.lock (flock -n) for the whole run, refuses on a declared canary, a running loop, chain or drawrec, or any
# canary drop-in, and releases its own hold on exit. NEVER wrap canary-sched.py in flock ~/sched.lock (it deadlocks).
set -u
DRY=""
while [ $# -gt 0 ]; do case "$1" in --dry-run) DRY=1;; *) echo "unknown arg $1"; exit 2;; esac; shift; done
KEEP_HOLD=""
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ); TAG=drawrec1022
MAN=/srv/mcbots/trial-manifest.json; RULES=$H/digest/RULES-IN-FORCE.md; HT=$H/gate-v36/holdtoken.py
T=$H/mcai-analysis/drawrec.sh
BASE=986e18d2a36d168d2afdc91f75e59682        # the live drawrec.sh this change was written against (brain-01, 10-19)
WANT=d0d4d51ce2837906453119a43714b578        # the reviewed result (hostfix-1022, Codex + Claude r4 APPROVE)
say() { echo "== [drawrec-1022] $*"; }; die() { echo "REFUSED [drawrec-1022]: $*"; exit 2; }
W() { if [ -n "$DRY" ]; then echo "  (dry run) WOULD REFUSE: $*"; else die "$*"; fi; }

say "1. precheck (read-only): staged set complete, live on its base, staged = the reviewed result, digest registered"
for f in drawrec.sh test_drawrec_endpoint.py test_drawrequire.py drawrequire.py; do [ -f "$S/$f" ] || die "staged $S/$f missing"; done
[ -f "$HT" ] || die "$HT missing"
LM=$(md5sum < "$T" | cut -c1-32); SM=$(md5sum < "$S/drawrec.sh" | cut -c1-32)
[ "$SM" = "$WANT" ] || die "staged drawrec.sh is $SM, not the reviewed result $WANT"
if [ "$LM" = "$WANT" ]; then echo "  live $T is ALREADY the reviewed result: nothing to install"; exit 0; fi
[ "$LM" = "$BASE" ] || die "live $T is $LM, not the base $BASE this change was written against (re-stage on the live file)"
cmp -s "$S/drawrequire.py" "$H/mcai-analysis/drawrequire.py" || die "staged drawrequire.py differs from the live ~/mcai-analysis copy (stage the live one)"
DG=$(python3 $H/verdict.py --gate-digest | head -1)
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null || die "gatedigest.py does not pass BEFORE the install (not this change's to fix)"
echo "  live $T $LM (base), staged $SM (reviewed); gate bundle $DG registered"

_busy() {
  local DROPINS L C DR CP
  DROPINS=$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
  [ -z "$DROPINS" ] || W "canary drop-ins present: $DROPINS"
  L=$(pgrep -af '^bash /home/mike/canary-loop[.]sh' | grep -v pgrep || true)
  [ -z "$L" ] || W "a canary loop is running: $L"
  C=$(pgrep -af 'chain-[a-z0-9-]*\.sh|launch-[a-z0-9-]*\.sh|chain-after' | grep -v -e pgrep -e install-drawrec || true)
  [ -z "$C" ] || W "a chain/launch script is running: $C"
  DR=$(pgrep -af 'mcai-analysis/drawrec[.]sh' | grep -v -e pgrep -e install-drawrec || true)
  [ -z "$DR" ] || W "a drawrec.sh is running: $DR"
  CP=$(python3 -c "
import json, sys
m = json.load(open('$MAN'))
if not isinstance(m, dict) or 'canary_pool' not in m: sys.exit(3)
print('ACTIVE ' + str(m.get('canary_pool')) + ' ' + str(m.get('canary_code_version')) if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')" 2>&1) || CP="unreadable ($CP)"
  [ "$CP" = "INACTIVE" ] || W "a canary is declared or the manifest is unreadable ($CP)"
}
_busy
if [ -n "$DRY" ]; then
  HO=$(python3 $HT owner 2>&1); [ -z "$HO" ] || echo "  (dry run) WOULD REFUSE: an install-hold exists (owner $HO)"
  # NOT flock: a dry run must not take the live lock even for an instant (Claude r1 P3-9); report who holds it open
  LH=$(fuser /tmp/mcai-canary.lock 2>/dev/null | tr -s ' '); [ -z "$LH" ] || echo "  (dry run) /tmp/mcai-canary.lock is open by pid(s)$LH (a holder would refuse the install)"
else
  TOKEN="install-drawrec-1022:$$:$(date +%s%N)"
  CL=$(python3 $HT claim "$TOKEN" 60 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-500)"
  trap '[ -n "$KEEP_HOLD" ] && echo "INSTALL-HOLD KEPT ($TOKEN): a rollback was not verified -- restore by hand, then python3 $HT release $TOKEN" || python3 $HT release "$TOKEN" >/dev/null 2>&1' EXIT
  echo "  $(echo "$CL" | tail -1 | cut -c1-200)"
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  _busy      # re-checked UNDER the hold and the lock
fi

say "2. the staged drawrec.sh passes its suites (a staging copy under $S, nothing live is read or written by them)"
X=$(mktemp -d "$S/stage-XXXXXX")
cp -p "$S/drawrec.sh" "$S/test_drawrec_endpoint.py" "$S/test_drawrequire.py" "$S/drawrequire.py" "$X"/
cp -p "$H/canary-loop.sh" "$X/canary-loop.sh"            # the LIVE loop's pick pipeline is what both suites parse with
cp -p "$T" "$X/drawrec.live.sh"
cd "$X" || die "cannot cd $X"
bash -n drawrec.sh || die "drawrec.sh does not parse"
grep -qE '^TARGET_K = 4$' drawrec.sh && grep -qE '^MIN_K = 2$' drawrec.sh || die "the staged drawrec.sh changed TARGET_K/MIN_K"
diff <(grep -n -E '^print\(.DRAW \(|owner C' drawrec.live.sh | cut -d: -f2-) <(grep -n -E '^print\(.DRAW \(|owner C' drawrec.sh | cut -d: -f2-) >/dev/null \
  || die "the DRAW print changed"
# the endpoint suite WITH the live copy as OLD: byte-compatibility, the loop pipeline, the mutants
python3 test_drawrec_endpoint.py drawrec.sh drawrec.live.sh > endpoint.out 2>&1 || die "test_drawrec_endpoint.py failed: $(grep -E '^FAIL' endpoint.out | head -4 | tr '\n' ' ')"
grep -q '^PASS  COMPAT' endpoint.out || die "the byte-compatibility half did not run"
echo "  test_drawrec_endpoint: $(tail -1 endpoint.out)"
python3 test_drawrequire.py > drawrequire.out 2>&1 || die "test_drawrequire.py failed with the staged drawrec.sh: $(grep -E '^FAIL' drawrequire.out | head -4 | tr '\n' ' ')"
echo "  test_drawrequire: $(tail -1 drawrequire.out)"
# the scheduler's own H6 read of the file it will now see (bag fixes need TARGET_K >= 4)
SCHED_DRAWREC=$X/drawrec.sh python3 -c "
import importlib.util, os, re
s = importlib.util.spec_from_file_location('cs', '$H/canary-sched.py'); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
P = m.paths(); assert P['drawrec'] == '$X/drawrec.sh', P['drawrec']
assert re.search(r'(?m)^TARGET_K = [4-9]', open(P['drawrec']).read())
print('  canary-sched H6 reads TARGET_K >= 4 in the staged file')" || die "canary-sched.py's drawrec_k4 read fails on the staged file"
cd "$S"

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install $S/drawrec.sh (${WANT:0:8}) -> $T (${LM:0:8}); bundle $DG unchanged"
  rm -rf "$X"; exit 0
fi

# THE HOLD MUST STILL BE OURS right before anything is replaced
[ "$(python3 $HT owner 2>&1)" = "$TOKEN" ] || die "the install-hold is no longer ours: nothing installed"
_busy
[ "$(md5sum < "$T" | cut -c1-32)" = "$BASE" ] || die "live $T changed during the run: nothing installed"
say "3. install: backup verified first, then the file replaced by rename (a running bash keeps its own inode)"
cp -p "$T" "$T.bak-$TAG-$STAMP" && cmp -s "$T" "$T.bak-$TAG-$STAMP" || die "backup of $T failed; nothing installed"
cp "$S/drawrec.sh" "$T.new-$TAG" && cmp -s "$S/drawrec.sh" "$T.new-$TAG" && chmod --reference="$T" "$T.new-$TAG" \
  || { rm -f "$T.new-$TAG"; die "staging $T.new-$TAG failed; nothing installed"; }
_rollback() {
  trap - INT TERM HUP
  cp -p "$T.bak-$TAG-$STAMP" "$T.rb-$TAG" && mv -f "$T.rb-$TAG" "$T" && cmp -s "$T.bak-$TAG-$STAMP" "$T" \
    || { KEEP_HOLD=1; echo "ROLLBACK INCOMPLETE: $T -- backup $T.bak-$TAG-$STAMP kept"; rm -f "$T.new-$TAG"; exit 6; }
  rm -f "$T.new-$TAG"; echo "ROLLED BACK $T (verified against the backup)"
}
trap '_rollback; exit 4' INT TERM HUP
mv -f "$T.new-$TAG" "$T" || { _rollback; exit 4; }
echo "  installed $T"

say "4. verify: the installed file is the staged one, it parses, and the gate bundle did not move"
cmp -s "$S/drawrec.sh" "$T" || { echo "MISMATCH: $T is not the staged file"; _rollback; exit 3; }
bash -n "$T" || { echo "the installed drawrec.sh does not parse"; _rollback; exit 3; }
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
if [ "$LIVE" != "$DG" ] || ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null; then
  _rollback; echo "the gate digest moved ($DG -> $LIVE)"; exit 3
fi
python3 $H/canary-sched.py status > /dev/null 2>&1 || { _rollback; echo "canary-sched.py status does not run with the installed file"; exit 3; }
trap - INT TERM HUP
rm -rf "$X"
echo "$(date -u +%FT%TZ) drawrec-1022 installed (endpoint from env files; covariate only when pools differ): drawrec.sh $(md5sum < $T | cut -c1-8) (was ${BASE:0:8}); bundle $DG unchanged; backup $T.bak-$TAG-$STAMP" >> $H/digest/gate-installs.log || echo "WARNING: the gate-installs.log line could not be written -- add it by hand"
echo "INSTALLED drawrec-1022: $T $(md5sum < $T | cut -c1-8); bundle $DG unchanged; backup $T.bak-$TAG-$STAMP"
