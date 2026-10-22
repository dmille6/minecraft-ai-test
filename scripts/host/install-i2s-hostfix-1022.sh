#!/bin/bash
# install-i2s-hostfix-1022.sh [--dry-run] -- the isolated2shared rollout tool's 10-22 fixes into ~/isolated2shared on 10.0.0.31.
#   isolated2shared-direct.sh   tells the hold helper where QUIET came from, and uses the EFFECTIVE quiet it answers with
#   isolated2sharedhold.py      records and honours an accepted quiet (the 10-21 +420 refusal); every refused release extends
#                               the hold to last + quiet + 60 and checks it; HOLD.json and the hold extension written with a
#                               directory fsync
#   isolated2sharedtrip.py      I5 places a disposal whose at= was cut at the 300-char detail cap by bot.pos; --until replay
# isolated2shared.mjs is unchanged. This touches NO gate, loop, scheduler, queue, manifest, env file or bot: it is the rollout
# tool's own directory, so it takes THE ROLLOUT'S OWN LOCK ($D/rollout.lock, as every wrapper mode does) and refuses while a
# rollout hold is recorded (HOLD.json) -- install between phases, never inside one.
#
# STAGE:  ssh mike@10.0.0.31 'mkdir -p ~/hostfix-1022/i2s'
#         scp scripts/host/{isolated2shared-direct.sh,isolated2sharedhold.py,isolated2sharedtrip.py,install-i2s-hostfix-1022.sh} \
#             mike@10.0.0.31:hostfix-1022/i2s/
# THEN:   bash ~/hostfix-1022/i2s/install-i2s-hostfix-1022.sh --dry-run
#         bash ~/hostfix-1022/i2s/install-i2s-hostfix-1022.sh
set -u
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
H=/home/mike; D=$H/isolated2shared; S=$(cd "$(dirname "$0")" && pwd); STAMP=$(date -u +%Y%m%dT%H%M%SZ); TAG=hostfix1022
FILES="isolated2shared-direct.sh isolated2sharedhold.py isolated2sharedtrip.py"
# the installed copies are c6bea93b's (verified 10-22: byte-identical to origin/isolated2shared-on-9e7d998)
declare -A BASE=([isolated2shared-direct.sh]=fad7f3ceeff03fa71361160f39954052 [isolated2sharedhold.py]=0c4f60521faa195ec8ebe3563a9c7614 [isolated2sharedtrip.py]=ac422116effbf569ba66fd68a6ddb867)
declare -A WANT=([isolated2shared-direct.sh]=43ecb29d418a9e11fe6bee47442c4789 [isolated2sharedhold.py]=691423ec03688067613513424dbc8198 [isolated2sharedtrip.py]=540973f82985f70c2bb84f883a11a38c)
say() { echo "== [i2s-1022] $*"; }; die() { echo "REFUSED [i2s-1022]: $*"; exit 2; }

say "1. precheck: staged = reviewed, live = base, no rollout in progress"
exec 7>"$D/rollout.lock"; flock -n 7 || die "an isolated2shared run holds $D/rollout.lock"
for f in $FILES; do
  [ -f "$S/$f" ] || die "staged $S/$f missing"
  SM=$(md5sum < "$S/$f" | cut -c1-32); LM=$(md5sum < "$D/$f" | cut -c1-32)
  [ "$SM" = "${WANT[$f]}" ] || die "staged $f is $SM, not the reviewed ${WANT[$f]}"
  [ "$LM" = "${BASE[$f]}" ] || [ "$LM" = "${WANT[$f]}" ] || die "live $D/$f is $LM, neither the base ${BASE[$f]} nor the result"
done
[ ! -e "$D/HOLD.json" ] || die "$D/HOLD.json exists: a rollout hold is recorded (release or drop it first; never install mid-phase)"
P=$(pgrep -af 'isolated2shared(-direct\.sh|\.mjs|hold\.py|trip\.py)' | grep -v -e pgrep -e install-i2s || true)
[ -z "$P" ] || die "an isolated2shared process is running: $P"

say "2. the staged files pass their own checks (a copy; nothing live)"
X=$(mktemp -d "$S/stage-XXXXXX"); cp -p "$S"/isolated2shared* "$X"/
bash -n "$X/isolated2shared-direct.sh" || die "the wrapper does not parse"
python3 "$X/isolated2sharedhold.py" selftest || die "the hold helper's self-tests fail"
python3 "$X/isolated2sharedtrip.py" --help > /dev/null || die "the tripwire's self-tests fail"
rm -rf "$X"
if [ -n "$DRY" ]; then
  say "DRY RUN: nothing changed. Would install:"; for f in $FILES; do echo "    $S/$f (${WANT[$f]:0:8}) -> $D/$f"; done; exit 0
fi

say "3. install: backups verified, then each file replaced by rename"
for f in $FILES; do
  t=$D/$f
  cp -p "$t" "$t.bak-$TAG-$STAMP" && cmp -s "$t" "$t.bak-$TAG-$STAMP" || die "backup of $t failed; nothing installed"
  cp "$S/$f" "$t.new-$TAG" && cmp -s "$S/$f" "$t.new-$TAG" && chmod --reference="$t" "$t.new-$TAG" || { rm -f "$t.new-$TAG"; die "staging $t failed"; }
done
# THE THREE FILES ARE ONE UNIT (Codex r1 P2): the new wrapper calls the helper with six arguments, which the old helper
# refuses -- so any failure or signal after the first rename restores ALL THREE from the backups, verified, before this
# script (and its rollout.lock) ends. A rollback that cannot be verified says so and exits 6.
_rollback() {
  trap - INT TERM HUP; local bad=""
  for f in $FILES; do
    t=$D/$f
    cp -p "$t.bak-$TAG-$STAMP" "$t.rb-$TAG" && mv -f "$t.rb-$TAG" "$t" && cmp -s "$t.bak-$TAG-$STAMP" "$t" || bad="$bad $t"
    rm -f "$t.new-$TAG"
  done
  [ -z "$bad" ] || { echo "ROLLBACK INCOMPLETE:$bad -- backups $D/*.bak-$TAG-$STAMP kept; DO NOT run the wrapper until fixed"; exit 6; }
  echo "ROLLED BACK all three files (verified against $D/*.bak-$TAG-$STAMP)"
}
trap '_rollback; exit 4' INT TERM HUP
for f in $FILES; do mv -f "$D/$f.new-$TAG" "$D/$f" || { echo "rename of $f failed"; _rollback; exit 4; }; done
for f in $FILES; do cmp -s "$S/$f" "$D/$f" || { echo "$D/$f is not the staged file"; _rollback; exit 3; }; done
python3 "$D/isolated2sharedhold.py" selftest >/dev/null && python3 "$D/isolated2sharedtrip.py" --help >/dev/null && bash -n "$D/isolated2shared-direct.sh" \
  || { echo "the installed files fail their self-tests"; _rollback; exit 3; }
trap - INT TERM HUP
echo "INSTALLED isolated2shared 10-22 fixes: $(for f in $FILES; do printf '%s %s ' $f $(md5sum < $D/$f | cut -c1-8); done)backups *.bak-$TAG-$STAMP"
