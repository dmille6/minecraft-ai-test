#!/bin/bash
# install-brain01-host.sh [--dry-run] -- the brain-01 HOST prerequisites (owner "test now", 10-19), BETWEEN CANARIES ONLY.
# Three files, as approved by both engines for brain-01 (docs/reports/brain01-staging/*.patch on the brain-01 branch,
# re-staged 10-19 against the live host files; design s.13), applied unchanged:
#   ~/canary-loop.sh               reads `canary_env` (model-env class <-> canary_env must agree; pinned mcai-canary-tree);
#                                  the env teardown proof; keep-subset paging
#   ~/canary-sched.py              accepts class `model-env` (canary_env, draw_k 1..2, promotion keep-subset|none)
#   ~/mcai-analysis/drawrec.sh     `draw_k` caps a draw (a model-env one at 2 pools, fail closed); brain-subset pools
#                                  never drawn, excluded AFTER the steady release
# NOT installed (deliberately, design s.13): the verdict.py and immobiledid.py brain-01 patches.
# None of the three is a gate-bundle part, so the registered GATE DIGEST is unchanged (verified before and after).
# Composition with gate v36 (canary tiers): a model-env registration has a class, so tierrule.tier_of is 3 for it --
# no +180 tier-2 KEEP, no early release for its draw -- and its draw_k cap applies whatever the tier.
#
# Run inside the same install window as install-gate-v36.sh (that script calls this one with --then while it still
# holds the scheduler's install-hold and /tmp/mcai-canary.lock: HOLD_TOKEN is exported and fd 8 is inherited), or
# standalone, when it claims both itself.
set -u
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
H=/home/mike; S=$(cd "$(dirname "$0")" && pwd); B=$S/brain01; STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MAN=/srv/mcbots/trial-manifest.json; RULES=$H/digest/RULES-IN-FORCE.md
say() { echo "== [brain01] $*"; }; die() { echo "REFUSED [brain01]: $*"; exit 2; }
W() { if [ -n "$DRY" ]; then echo "  (dry run) WOULD REFUSE: $*"; else die "$*"; fi; }
declare -A TGT=([canary-loop.sh]=$H/canary-loop.sh [canary-sched.py]=$H/canary-sched.py [drawrec.sh]=$H/mcai-analysis/drawrec.sh)
declare -A BASE=([canary-loop.sh]=6f5f13b5c0103eb47444044fdfebf752 [canary-sched.py]=dee491d6460abf3f024a5ae8eb6f8ed4 [drawrec.sh]=792a7cfdfac37825522d55d841f24eff)
declare -A WANT=([canary-loop.sh]=344b10740b3de9bb8025a14bf4bbb1d3 [canary-sched.py]=0d9a87f3372fe88718a324117edfea6b [drawrec.sh]=986e18d2a36d168d2afdc91f75e59682)

# STAGE (into the same dir as install-gate-v36.sh, after its own STAGE list):
#   scp scripts/host/{install-brain01-host.sh,test_canary_sched.py} mike@10.0.0.31:gate-v36/
#   scp <brain-01 patched canary-loop.sh,canary-sched.py,drawrec.sh> docs/reports/brain01-staging/{canary-loop.sh,canary-sched.py,drawrec.sh}.patch \
#       mike@10.0.0.31:gate-v36/brain01/
KEEP_HOLD=""
say "1. staged = the approved patch applied to the live base; live = the base"
for f in test_canary_sched.py test_threepool.py test_bagfix_loop.py test_drawrequire.py test_holdtoken.py canarywatch.py holdtoken.py bagread.py; do
  [ -f "$S/$f" ] || die "staged $S/$f missing"
done
for f in "${!TGT[@]}"; do
  [ -f "$B/$f" ] || die "staged $B/$f missing"
  [ -f "$B/$f.patch" ] || die "the approved patch $B/$f.patch is missing"
  LM=$(md5sum < "${TGT[$f]}" | cut -c1-32)
  [ "$LM" = "${BASE[$f]}" ] || cmp -s "$B/$f" "${TGT[$f]}" || die "live ${TGT[$f]} is $LM, not the base the patch was re-staged on (${BASE[$f]})"
  SM=$(md5sum < "$B/$f" | cut -c1-32)
  [ "$SM" = "${WANT[$f]}" ] || die "staged $f is $SM, not the reviewed result ${WANT[$f]}"
  T=$(mktemp -d); cp -p "${TGT[$f]}" "$T/$f"
  if [ "$LM" = "${BASE[$f]}" ]; then
    (cd "$T" && patch -p1 -s -i "$B/$f.patch") || die "the approved patch does not apply to the live $f"
    cmp -s "$T/$f" "$B/$f" || die "the approved patch applied to the live $f is not the staged file"
  fi
  rm -rf "$T"
done
DG=$(python3 $H/verdict.py --gate-digest | head -1)
python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null || die "gatedigest.py does not pass before the install"

_busy() {
  local DROPINS L CP
  DROPINS=$(ls /etc/systemd/system/mcbot@*.service.d/10-canary.conf 2>/dev/null | head -4 | tr '\n' ' ')
  [ -z "$DROPINS" ] || W "canary drop-ins present: $DROPINS"
  L=$(pgrep -af '^bash /home/mike/canary-loop[.]sh' | grep -v pgrep || true)
  [ -z "$L" ] || W "a canary loop is running: $L"
  CP=$(python3 -c "
import json, sys
m = json.load(open('$MAN'))
print('ACTIVE' if (m.get('canary_pool') or m.get('canary_code_version')) else 'INACTIVE')" 2>&1) || CP="unreadable"
  [ "$CP" = "INACTIVE" ] || W "a canary is declared or the manifest is unreadable ($CP)"
}
_busy
if [ -n "$DRY" ]; then :
elif [ -n "${HOLD_TOKEN:-}" ]; then
  # INSIDE THE v36 WINDOW: the hold must be the caller's, and fd 8 must be the caller's lock (flock on the inherited
  # descriptor succeeds only for the holder or a free lock; a free lock is then held here)
  [ "$(python3 $S/holdtoken.py owner 2>&1)" = "$HOLD_TOKEN" ] || die "the install-hold is not the caller's ($HOLD_TOKEN)"
  flock -n 8 || die "/tmp/mcai-canary.lock is held by someone else"
else
  TOKEN="install-brain01-host:$$:$(date +%s%N)"
  CL=$(python3 $S/holdtoken.py claim "$TOKEN" 90 2>&1) || die "install-hold not claimed: $(echo "$CL" | tr '\n' ' ' | cut -c1-400)"
  trap '[ -n "$KEEP_HOLD" ] && echo "INSTALL-HOLD KEPT ($TOKEN): restore by hand" || python3 $S/holdtoken.py release "$TOKEN" >/dev/null 2>&1' EXIT
  exec 8>/tmp/mcai-canary.lock; flock -n 8 || die "/tmp/mcai-canary.lock is held"
  _busy
fi

say "2. the patched files pass the suites that exercise them (a staging copy, nothing live)"
# UNDER $S, never /tmp (found in the dry run 10-19): test_bagfix_loop resolves bagfixgate.py from its parent directory
# first, and /tmp holds a stale v34 bagfixgate.py (no ext-min) that failed 15 of its 21 cases for a reason unrelated to brain-01
T=$(mktemp -d "$S/brain01-stage-XXXXXX")
cp -p $S/*.py $S/*.sh "$T"/ 2>/dev/null; cp -p "$S"/airpocket-01.*.json "$T"/ 2>/dev/null
for f in "${!TGT[@]}"; do cp -p "$B/$f" "$T/$f"; done
cd "$T" || die "cannot cd $T"
bash -n canary-loop.sh || die "canary-loop.sh does not parse"; bash -n drawrec.sh || die "drawrec.sh does not parse"
python3 -m py_compile canary-sched.py || die "canary-sched.py does not compile"
grep -qE '^TARGET_K = 4$' drawrec.sh && grep -qE '^MIN_K = 2$' drawrec.sh || die "the patched drawrec.sh changed TARGET_K/MIN_K"
for tt in test_threepool test_bagfix_loop test_drawrequire test_holdtoken; do
  python3 $tt.py > $tt.out 2>&1 || die "$tt.py failed with the brain-01 files: $(grep -E '^FAIL|pass' $tt.out | tail -4 | tr '\n' ' ')"
  echo "  $tt: $(tail -1 $tt.out)"
done
# MANDATORY (Claude, install window): the one suite for canary-sched.py's model-env change
python3 test_canary_sched.py > test_canary_sched.out 2>&1 || die "test_canary_sched.py failed: $(tail -3 test_canary_sched.out | tr '\n' ' ')"
echo "  test_canary_sched: $(tail -1 test_canary_sched.out)"
python3 canarywatch.py --selftest > canarywatch.out 2>&1 || die "canarywatch selftest: $(tail -2 canarywatch.out)"
cd "$S"; rm -rf "$T"

if [ -n "$DRY" ]; then
  say "DRY RUN: nothing live was changed. Would install:"
  for f in "${!TGT[@]}"; do echo "    $B/$f (${WANT[$f]:0:8}) -> ${TGT[$f]} (${BASE[$f]:0:8})"; done
  exit 0
fi

# THE HOLD MUST STILL BE OURS right before anything is replaced (Claude, install window)
[ -n "${HOLD_TOKEN:-}" ] && OWN=$HOLD_TOKEN || OWN=$TOKEN
[ "$(python3 $S/holdtoken.py owner 2>&1)" = "$OWN" ] || die "the install-hold is no longer ours: nothing installed"
_busy
say "3. install: backups verified first, then each file replaced by rename"
for f in "${!TGT[@]}"; do
  t=${TGT[$f]}
  cp -p "$t" "$t.bak-brain01-$STAMP" && cmp -s "$t" "$t.bak-brain01-$STAMP" || die "backup of $t failed; nothing installed"
  cp "$B/$f" "$t.new-brain01" && cmp -s "$B/$f" "$t.new-brain01" && chmod --reference="$t" "$t.new-brain01" \
    || { rm -f "$t.new-brain01"; die "staging $t.new-brain01 failed; nothing installed"; }
done
_rollback() {
  # CHECKED (Codex): each restore verified against its backup (kept); a failure exits 6 and the hold is KEPT
  trap - INT TERM HUP; local bad=""
  for f in "${!TGT[@]}"; do
    t=${TGT[$f]}
    cp -p "$t.bak-brain01-$STAMP" "$t.rb-brain01" && mv -f "$t.rb-brain01" "$t" && cmp -s "$t.bak-brain01-$STAMP" "$t" || bad="$bad $t"
    rm -f "$t.new-brain01"
  done
  if [ -n "$bad" ]; then KEEP_HOLD=1; echo "ROLLBACK INCOMPLETE:$bad -- backups *.bak-brain01-$STAMP kept"; exit 6; fi
  echo "ROLLED BACK brain-01 host files (verified against the backups)"
}
trap '_rollback; exit 4' INT TERM HUP
for f in "${!TGT[@]}"; do mv -f "${TGT[$f]}.new-brain01" "${TGT[$f]}" || { _rollback; exit 4; }; echo "  installed ${TGT[$f]}"; done
LIVE=$(python3 $H/verdict.py --gate-digest | head -1)
if [ "$LIVE" != "$DG" ] || ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $RULES >/dev/null; then
  _rollback; echo "the gate digest moved ($DG -> $LIVE)"; exit 3
fi
python3 $H/canary-sched.py status > /dev/null 2>&1 || { _rollback; echo "the installed canary-sched.py does not run its status"; exit 3; }
trap - INT TERM HUP
echo "$(date -u +%FT%TZ) brain-01 host prerequisites installed: canary-loop.sh $(md5sum < ${TGT[canary-loop.sh]} | cut -c1-8), canary-sched.py $(md5sum < ${TGT[canary-sched.py]} | cut -c1-8), drawrec.sh $(md5sum < ${TGT[drawrec.sh]} | cut -c1-8) (verdict.py/immobiledid.py brain patches NOT installed); bundle $DG unchanged; backups *.bak-brain01-$STAMP" >> $H/digest/gate-installs.log || echo "WARNING: the gate-installs.log line could not be written"
echo "INSTALLED brain-01 host files; bundle $DG unchanged; backups *.bak-brain01-$STAMP"
