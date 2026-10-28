#!/bin/bash
# install-funmode-w4.sh [--dry-run] -- gate v37 (FUN MODE, OWNER 2026-10-28, W4) on the bots host, BETWEEN CANARIES ONLY.
# Files (staged next to this script, from the repo at the commit being installed):
#   canary-loop.sh    -> ~/canary-loop.sh                 fun mode: no lab preflights, 30-min draw cap, generic read +90/+180
#   canary-sched.py   -> ~/canary-sched.py                R10/H5/H6 lab-only, R11 2-h expiry, reviewer-name approval
#   drawrec.sh        -> ~/mcai-analysis/drawrec.sh       DRAW_FUN_FALLBACK; draw_exposure/draw_require_pools lab-only
#   verdict.py        -> ~/verdict.py                     fun-mode registration defaults; funread.py in the gate bundle
#   funread.py        -> ~/mcai-analysis/funread.py       NEW: the generic read
#   RULES-IN-FORCE.md -> ~/digest/RULES-IN-FORCE.md       the v37 paragraph + the new GATE DIGEST line
# STAGE:  ssh mike@10.0.0.31 'mkdir -p ~/gate-v37'
#         scp scripts/{verdict.py,funread.py,test_funread.py} scripts/host/{canary-loop.sh,canary-sched.py,drawrec.sh,\
#             RULES-IN-FORCE.md,heavyread.sh,test_canary_sched.py,test_funmode_loop.py,install-funmode-w4.sh} mike@10.0.0.31:gate-v37/
# THEN:   bash ~/gate-v37/install-funmode-w4.sh --dry-run    then    bash ~/gate-v37/install-funmode-w4.sh
# It takes the scheduler's install-hold (`canary-sched.py install-hold`, which itself takes the tick lock: NEVER wrap it in
# flock) and /tmp/mcai-canary.lock (flock -n) for its whole run, refuses on a declared canary, a running loop or any canary
# drop-in, verifies the installed bundle against the staged RULES digest (gatedigest.py), rolls back on any failure, and
# releases its hold on exit.
set -u
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MAN=/srv/mcbots/trial-manifest.json
say() { echo "== $*"; }; die() { echo "REFUSED: $*"; exit 2; }
W() { if [ -n "$DRY" ]; then echo "  (dry run) WOULD REFUSE: $*"; else die "$*"; fi; }
declare -A TGT=([canary-loop.sh]=$H/canary-loop.sh [canary-sched.py]=$H/canary-sched.py [drawrec.sh]=$H/mcai-analysis/drawrec.sh
                [verdict.py]=$H/verdict.py [funread.py]=$H/mcai-analysis/funread.py [RULES-IN-FORCE.md]=$H/digest/RULES-IN-FORCE.md)
# the live files this was built against (10-28 13:20Z); a target that is neither its base nor the staged copy refuses
declare -A BASE=([canary-loop.sh]=344b10740b3de9bb8025a14bf4bbb1d3 [canary-sched.py]=0d9a87f3372fe88718a324117edfea6b
                 [drawrec.sh]=d0d4d51ce2837906453119a43714b578 [verdict.py]=36c8e2876c197e6aa197559ae79f4900
                 [funread.py]=ABSENT [RULES-IN-FORCE.md]=__ANY__)

say "1. staged files present; targets on their base (or already the staged copy)"
for f in "${!TGT[@]}" heavyread.sh test_funread.py test_canary_sched.py test_funmode_loop.py; do
  [ -f "$S/$f" ] || die "staged file missing: $S/$f"
done
grep -q '^GATE DIGEST verdict-bundle md5 ' "$S/RULES-IN-FORCE.md" || die "staged RULES-IN-FORCE.md has no GATE DIGEST line"
grep -q 'v37' "$S/RULES-IN-FORCE.md" || die "staged RULES-IN-FORCE.md has no v37 paragraph"
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}; b=${BASE[$f]}
  if cmp -s "$S/$f" "$t" 2>/dev/null; then echo "  $f: already the staged copy"; continue; fi
  case "$b" in
    ABSENT) [ ! -e "$t" ] || die "$t exists and is not the staged copy";;
    __ANY__) [ -f "$t" ] || die "$t missing";;
    *) [ "$(md5sum < "$t" | cut -c1-32)" = "$b" ] || die "live $t is $(md5sum < "$t" | cut -c1-32), not the base v37 was built on ($b)";;
  esac
done
bash -n "$S/canary-loop.sh" && bash -n "$S/drawrec.sh" || die "a staged shell script does not parse"
python3 -m py_compile "$S/canary-sched.py" "$S/verdict.py" "$S/funread.py" || die "a staged python file does not compile"

say "2. the staged tests pass (in the staging dir, against the staged copies)"
( cd "$S" && python3 test_funread.py > $S/test_funread.out 2>&1 ) || die "test_funread.py failed: $(tail -3 $S/test_funread.out)"
( cd "$S" && python3 test_canary_sched.py > $S/test_canary_sched.out 2>&1 ) || die "test_canary_sched.py failed: $(tail -3 $S/test_canary_sched.out)"
mkdir -p $S/host && cp $S/canary-loop.sh $S/heavyread.sh $S/test_funmode_loop.py $S/host/ && cp $S/funread.py $S/host/funread.py
( cd "$S/host" && python3 test_funmode_loop.py > $S/test_funmode_loop.out 2>&1 ) || die "test_funmode_loop.py failed: $(tail -3 $S/test_funmode_loop.out)"
echo "  $(tail -1 $S/test_funread.out) | $(tail -1 $S/test_canary_sched.out) | $(tail -1 $S/test_funmode_loop.out)"

say "3. the slot is free"
python3 -c "import json,sys; m=json.load(open('$MAN')); sys.exit(1 if (m.get('canary_pool') or m.get('canary_code_version')) else 0)" || W "the manifest declares a canary"
ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf >/dev/null 2>&1 && W "canary drop-ins present"
for p in /proc/[0-9]*; do a=$(tr '\0' ' ' < $p/cmdline 2>/dev/null); case "$a" in "bash $H/canary-loop.sh "*|"bash /home/mike/canary-loop.sh "*) W "a canary loop is running: $a";; esac; done
if [ -n "$DRY" ]; then
  flock -n /tmp/mcai-canary.lock true || echo "  (dry run) WOULD REFUSE: /tmp/mcai-canary.lock is held"
  [ -f $H/digest/INSTALL-HOLD ] && echo "  (dry run) note: an INSTALL-HOLD exists: $(cat $H/digest/INSTALL-HOLD)"
  say "dry run OK: nothing installed"; exit 0
fi
python3 $H/canary-sched.py install-hold w4-funmode 30 || die "install-hold refused (the slot is not free)"
INSTALLED=""; ROLLED=""
rollback() {
  for f in "${!TGT[@]}"; do t=${TGT[$f]}
    if [ -f "$t.bak-v37-$STAMP" ]; then cp -p "$t.bak-v37-$STAMP" "$t"; elif [ "${BASE[$f]}" = ABSENT ]; then rm -f "$t"; fi
  done; ROLLED=1; echo "ROLLED BACK to the pre-v37 files"
}
trap 'rc=$?; [ -n "$INSTALLED" ] && [ $rc -ne 0 ] && [ -z "$ROLLED" ] && rollback; python3 $H/canary-sched.py install-release >/dev/null 2>&1; echo "install-hold released"' EXIT
exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
python3 -c "import json,sys; m=json.load(open('$MAN')); sys.exit(1 if (m.get('canary_pool') or m.get('canary_code_version')) else 0)" || die "the manifest declares a canary (under the lock)"
ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf >/dev/null 2>&1 && die "canary drop-ins present (under the lock)"

say "4. back up and install"
for f in "${!TGT[@]}"; do t=${TGT[$f]}; [ -f "$t" ] && cp -p "$t" "$t.bak-v37-$STAMP"; done
INSTALLED=1
for f in "${!TGT[@]}"; do t=${TGT[$f]}
  cp "$S/$f" "$t.v37-tmp" && chmod --reference="$S/$f" "$t.v37-tmp" && mv "$t.v37-tmp" "$t" || { echo "copy of $f failed"; exit 3; }
done
chmod +x $H/canary-loop.sh $H/mcai-analysis/drawrec.sh

say "5. verify"
for f in "${!TGT[@]}"; do cmp -s "$S/$f" "${TGT[$f]}" || { echo "VERIFY: ${TGT[$f]} is not the staged copy"; exit 3; }; done
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $H/digest/RULES-IN-FORCE.md || { echo "VERIFY: gatedigest refused the installed bundle"; exit 3; }
python3 $H/verdict.py --gate-digest | grep -q 'funread.py' || { echo "VERIFY: funread.py is not in the live bundle"; exit 3; }
python3 $H/canary-sched.py status > $S/status-after.txt 2>&1 || { echo "VERIFY: canary-sched.py status failed: $(tail -3 $S/status-after.txt)"; exit 3; }
echo "  $(grep '^DECISION' $S/status-after.txt | cut -c1-200)"
printf '%s v37 fun mode installed by install-funmode-w4.sh (backups *.bak-v37-%s); digest %s\n' "$STAMP" "$STAMP" \
  "$(python3 $H/verdict.py --gate-digest | head -1)" >> $H/digest/gate-installs.log
say "INSTALLED v37 (fun mode). Backups: *.bak-v37-$STAMP"
exit 0
