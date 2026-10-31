#!/bin/bash
# canary-loop.sh <run_id> [--no-act] -- the canary loop on the bots host (docs/reports/canary-loop-design.md v3).
# One run per canary, under an exclusive lock, journaled, idempotent; pages via ~/digest/page.jsonl (the operator's
# session tails it). The registration ~/mcai-analysis/registrations/<run_id>.json binds sha, reads, rules, promotion.
# --no-act: everything but deploy/promote/teardown (prints what it would do). Phases resume from the journal.
set -u; RUN=${1:?run_id}; NOACT=${2:-}; H=$HOME; REG=$H/mcai-analysis/registrations/$RUN.json; J=$H/canary-journal.jsonl; PAGE=$H/digest/page.jsonl; MAN=${CANARY_MANIFEST:-/srv/mcbots/trial-manifest.json}
# REPLAY OVERRIDES (v33, 2026-10-07; tests only, production sets none): CANARY_MANIFEST above, CANARY_LOCK so a
# replay never takes the live loop's lock, CANARY_READ_DIR for the read scripts (default /tmp) and CANARY_READ_CWD
# for their working directory (default /opt/minecraft-ai/scripts), and
# CANARY_FAKE_CLOCK -- a file holding epoch seconds that _now reads and _sleep advances, so a 24-h extension can be
# driven end to end in seconds against a recorded journal. Unset, _now is `date +%s` and _sleep is `sleep`.
RD=${CANARY_READ_DIR:-/tmp}; POLL_S=${CANARY_POLL_S:-300}   # CANARY_POLL_S: replay only (fewer polls over a 24-h fake clock)
_now() { if [ -n "${CANARY_FAKE_CLOCK:-}" ]; then cat "$CANARY_FAKE_CLOCK"; else date +%s; fi; }
_sleep() { if [ -n "${CANARY_FAKE_CLOCK:-}" ]; then echo $(( $(cat "$CANARY_FAKE_CLOCK") + $1 )) > "$CANARY_FAKE_CLOCK"; else sleep "$1"; fi; }
exec 9>${CANARY_LOCK:-/tmp/mcai-canary.lock}; flock -n 9 || { echo "another loop holds the lock"; exit 3; }
jf() { python3 -c "import json,sys; print(json.load(open('$REG')).get('$1',''))"; }
mf() { python3 -c "import json; print(json.load(open('$MAN')).get('$1') or '')"; }
journal() { printf '{"ts":"%s","run":"%s","phase":"%s","note":%s}\n' "$(date -u +%FT%TZ)" "$RUN" "$1" "$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$2")" >> $J; }
page() { printf '{"ts":"%s","run":"%s","level":"%s","msg":%s}\n' "$(date -u +%FT%TZ)" "$RUN" "$1" "$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$2")" >> $PAGE; echo "PAGE[$1] $2"; }
lastphase() { grep "\"run\":\"$RUN\"" $J 2>/dev/null | tail -1 | python3 -c "import sys,json; l=sys.stdin.read().strip(); print(json.loads(l)['phase'] if l else 'none')"; }
SHA=$(jf sha); [ -n "$SHA" ] || { page error "registration $RUN has no sha"; exit 2; }
# v33 BAG-FIX DEATH RULE (OWNER DECISION 2026-10-07): a registration with "class": "bag-fix" is drawn at FOUR pools
# (20 bots) and, if the all-cause death gate trips with ZERO mechanism-linked deaths, EXTENDS to 24 h under
# bagfixgate.py instead of reverting. Exactly the string; anything else is an ordinary canary and every line
# below behaves as before.
# v37 FUN MODE (OWNER 2026-10-28, docs/PROCESS-fun-mode.md; W4). Every registration that does NOT say `"lab": true` runs
# in fun mode: no lab preflights (v19 change rows, v31 licence, v33 bag fix, v34 underground safety, NEXT-SLOT, v30), a
# draw that waits at most FUN_DRAW_CAP_MIN before the fallback draw, the GENERIC read (~/mcai-analysis/funread.py: death
# gate with the two-death floor, crash loops, own defect lines if their evidence exists) at +90 and +180 with no per-change
# read script required, a KEEP (goal-verified or goal-unverified) that PROMOTES fleet-wide unless the registration says
# otherwise, and a REVERT or INCONCLUSIVE that tears the whole canary sha down. `"lab": true` = every line as before.
FUN=$(python3 -c "import json; print('' if json.load(open('$REG')).get('lab') is True else '1')")
FUN_READS="90 180"; FUN_DEADLINE=240; FUN_DRAW_CAP_MIN=30   # FUN_READS must match funread.py FUN_READS
BAGFIX=$(python3 -c "import json; r=json.load(open('$REG')); print('1' if r.get('class') == 'bag-fix' and r.get('lab') is True else '')")
BAGFIX_POOLS=4
# brain-01 (staged 2026-10-12): a MODEL/ENV canary carries `canary_env`, a list of KEY=VALUE strings, written into the
# canary pool's canary.env by mcai-canary-tree (via fleet-deploy's CANARY_ENV, which survives the sudo and is checked
# in a live bot's /proc/<pid>/environ: FLAG MISSING exits 4). Unset or empty = every line below behaves as before.
# Values may hold `|` and `:` (verified through mcai-canary-tree and a real systemd EnvironmentFile, 10-12) but no
# whitespace and no glob characters: mcai-canary-tree word-splits CANARY_ENV UNQUOTED, so `*`, `?` or `[` would glob.
CENV=$(python3 -c "import json,re,sys; e=json.load(open('$REG')).get('canary_env') or []; bad=[x for x in e if not re.fullmatch(r'[A-Z_][A-Z0-9_]*=[^\s*?\[\]]+', x)]; print('BAD:'+' '.join(bad) if bad else ' '.join(e))")
case "$CENV" in BAD:*) page error "registration $RUN canary_env entries are not KEY=VALUE without spaces or glob characters: ${CENV#BAD:}"; exit 2;; esac
CENV_KEYS=$(for kv in $CENV; do printf '%s ' "${kv%%=*}"; done)
# CLASS AND ENV MUST AGREE (Claude r1 10-19): a model-env registration with no canary_env would deploy INERT code that
# its own read then reverts as a "defect"; a canary_env on any other class would ship an env no reader expects. The
# scheduler checks this at `queue add`; the loop checks it again, because the loop can be started by hand.
case "$(jf class)" in
  model-env) [ -n "$CENV" ] || { page error "registration $RUN is class model-env with no canary_env: it would deploy inert"; exit 2; };;
  *) [ -z "$CENV" ] || { page error "registration $RUN sets canary_env but is class '$(jf class)', not model-env"; exit 2; };;
esac
# THE WRITER OF canary.env IS PINNED (Claude r1): an env canary deploys only through the mcai-canary-tree whose CANARY_ENV
# handling was read and tested (snapshot: infra/brain/host-snapshot/mcai-canary-tree in the brain-01 branch).
if [ -n "$CENV" ] && [ "$(md5sum /usr/local/sbin/mcai-canary-tree 2>/dev/null | cut -d' ' -f1)" != "26da45dabfa8830b361d09b6a7dd236e" ]; then
  page error "registration $RUN sets canary_env, but /usr/local/sbin/mcai-canary-tree is not the pinned build (md5 26da45da...): re-verify its CANARY_ENV handling first"; exit 2
fi
# THE TEARDOWN PROOF COMPARES VALUES, NOT KEY NAMES (qwen35-01, 10-30). brain-01's keys were new (OLLAMA_BRAIN_PRIMARY),
# so "the key is absent" proved the canary env was gone. A model swap overrides keys EVERY bot's own env file already sets
# (OLLAMA_MODEL, OLLAMA_BASE_URLS): a key test can never pass for them, and every teardown would end teardown-incomplete
# with the slot held open. The proof is that no live process still carries a canary KEY=VALUE pair, exactly as
# fleet-deploy proves the deploy (grep -qxF on the same pairs). Prints the keys whose canary value is still live.
_env_still_canary() { local kv; for kv in $CENV; do printf '%s\n' "$1" | grep -qxF -- "$kv" && printf '%s ' "${kv%%=*}"; done; return 0; }
# A MODEL-ENV STALL GUARD (qwen35-01): `poll_read` names one of the registration's own `reads` whose `--poll` answers
# `MODELPOLL <OK|REVERT|UNREADABLE> :: ...` every 5 min beside the death poll. A model canary has no fallback endpoint
# (a fallback would mix models inside the arm), so a dead or stalled endpoint must end the run at the next poll, not at
# +90. Only REVERT acts; it cannot stand in for the death gate, which runs first and is unchanged.
POLLR=$(python3 -c "import json,re; r=json.load(open('$REG')); p=r.get('poll_read') or ''; print(p if not p else (p if re.fullmatch(r'[a-z0-9_]+', p) and p in (r.get('reads') or []) else 'BAD:'+str(p)))")
case "$POLLR" in BAD:*) page error "registration $RUN poll_read ${POLLR#BAD:} is not a plain name listed in its reads"; exit 2;; esac
PH=$(lastphase); echo "loop $RUN sha $SHA resumes from phase: $PH"
_jhas() { grep -q "\"run\":\"$RUN\".*\"phase\":\"$1\"" $J 2>/dev/null; }
_guards() { python3 -c "import json,sys; print(bool(json.load(open(sys.argv[1])).get('guards')))" $H/digest/reads/$RUN-verdict-$1.json 2>/dev/null; }
# v33 (round 2, both reviewers): A RUN ID IS ONE DEPLOYMENT. If the journal already shows this run deployed or decided
# and the manifest no longer names its sha, the canary was torn down (possibly half-way: teardown clears the manifest
# before the restarts finish). Relaunching would DRAW AND DEPLOY a sha that was already decided, and every journal
# resume below (read-M, bagfix-*, recorded) would then answer for the old deployment. Refuse; a re-run needs a new
# run id. (A loop resumed while the manifest still names the sha is unaffected.)
if [ "$(mf canary_code_version)" != "$SHA" ] && { _jhas deployed || _jhas recorded || _jhas bagfix-decided; }; then
  page error "$RUN was already deployed or decided (journal) and the manifest no longer names $SHA: NOT redeploying. If a teardown was interrupted, finish it by hand (drop-ins, canary_pool, restarts); a re-run needs a new run id."
  journal refused-redeploy "journal holds a deployment/decision for $RUN; manifest canary_code_version '$(mf canary_code_version)'"
  exit 2
fi
# ---- v19 preflight, BEFORE the draw: a declared change/linkage row that the BASELINE already
# emits cannot show the change acted on the bot that died, yet it licenses a REVERT from a
# single death. Two canaries were lost to exactly that (-13 `death_site_recorded`, a row the
# death handler writes; -13b `flooded_pocket_rung`, which is fleet-wide on 1d6c97d and which a
# CONTROL death carried at 00:01:45 while -13b was being reverted for it). Refuse the
# registration here -- before the draw, before the deploy, before three hours of fleet time.
# the stall guard must be staged before anything is deployed (a resumed run only pages, below: it never strands a deploy)
if [ "$(mf canary_code_version)" != "$SHA" ] && [ -n "$POLLR" ] && [ ! -f "$RD/$POLLR.py" ]; then
  page error "registration $RUN names poll_read $POLLR but $RD/$POLLR.py is absent: its stall guard would be down -- not launching"; exit 2
fi
if [ "$(mf canary_code_version)" != "$SHA" ] && [ -n "$FUN" ]; then
  journal funmode "fun mode (no \"lab\": true): lab preflights not required (v19 change rows, v31 licence, v33 bag fix, v34 underground safety, NEXT-SLOT, v30); generic read at +${FUN_READS// /, +}; draw wait capped at ${FUN_DRAW_CAP_MIN} min"
fi
if [ "$(mf canary_code_version)" != "$SHA" ]; then
  if [ -z "$FUN" ]; then
  if ! sudo python3 $H/mcai-analysis/changerowcheck.py "$RUN" --hours 6 --registrations $H/mcai-analysis/registrations > $H/digest/changerowcheck-$RUN.log 2>&1; then
    page error "change-row preflight REFUSED $RUN; not drawing or deploying. $(grep -A3 '^REFUSED' $H/digest/changerowcheck-$RUN.log | tail -3 | tr '\n' ' ')"
    journal preflight-refused "$(tail -5 $H/digest/changerowcheck-$RUN.log | tr '\n' ' ')"
    exit 2
  fi
  journal preflight-ok "$(grep 'positive control' $H/digest/changerowcheck-$RUN.log)"
  # ---- v31 preflight: A CANARY MUST NAME THE INSTRUMENT THAT WILL READ IT, AND ITS CLASS.
  # licencecheck.py was written on 2026-09-25 and its own docstring says it "refuses at launch" --
  # and it was never wired to anything, so that refusal did not exist. Found 2026-09-26: the loop
  # invoked changerowcheck.py and v30check.py and NOT this (positive control: the same grep finds
  # both of those), and 2 of 20 registrations on file declare a `licence` at all. `changerowcheck.py`
  # PASSES ITS OWN NULL CASE -- 9 of 18 registrations declared no change_rows and all nine passed --
  # which is the hole this closes, and it is exactly the defect class CLAUDE.md names: a remedy that
  # is printed but not reachable. verdict.py can only SAY "no licence declared" (v31); this is the
  # only place it is preventable, before the draw and before three hours of fleet time.
  if ! sudo python3 $H/mcai-analysis/licencecheck.py "$RUN" --hours 6 --registrations $H/mcai-analysis/registrations > $H/digest/licencecheck-$RUN.log 2>&1; then
    page error "licence preflight REFUSED $RUN; not drawing or deploying. $(grep -A3 '^REFUSED' $H/digest/licencecheck-$RUN.log | tail -3 | tr '\n' ' ')"
    journal refused-v31 "$(tail -5 $H/digest/licencecheck-$RUN.log | tr '\n' ' ')"
    exit 2
  fi
  journal licence-ok "$(tail -2 $H/digest/licencecheck-$RUN.log | tr '\n' ' ')"
  fi   # lab-only preflights (v19, v31)
  # ---- v32 preflight: THE LIVE GATE CODE MUST BE THE REGISTERED GATE CODE.
  # Three days running a gate generation shipped live and in no registration (v25-v28c, v29, v31).
  # The standing wake-up said to diff verdict.py against the last registered md5 and was followed on
  # none of the three days, because it asks a person to remember a comparison. No sudo: gatedigest.py
  # reads $HOME paths and sudo would resolve them to root's.
  if ! python3 $H/mcai-analysis/gatedigest.py --verdict $H/verdict.py --rules $H/digest/RULES-IN-FORCE.md > $H/digest/gatedigest-$RUN.log 2>&1; then
    page error "gate-digest preflight REFUSED $RUN; the live gate is not the registered gate. $(tail -4 $H/digest/gatedigest-$RUN.log | tr '\n' ' ')"
    journal refused-v32 "$(tail -6 $H/digest/gatedigest-$RUN.log | tr '\n' ' ')"
    exit 2
  fi
  journal gatedigest-ok "$(tail -1 $H/digest/gatedigest-$RUN.log)"
  # ---- v33 preflights (OWNER DECISION 2026-10-07), before the draw:
  # (1) a bag-fix registration must be well-formed (bag_fix.own_kinds, a primary bag metric bound to a registered read,
  #     an extended deadline) -- a malformed one would burn 24 h of 20 bots and close INCONCLUSIVE;
  # (2) a bag fix needs a 4-pool draw, so the host's drawrec.sh must target four;
  # (3) after a KEEP under the extended rule the NEXT slot belongs to an underground-safety fix: while
  #     ~/digest/NEXT-SLOT.json is pending, only a registration declaring "class": "underground-safety" may launch,
  #     and launching one consumes it. The owner's ordering is enforced here, not merely paged.
  if [ -n "$BAGFIX" ]; then
    RC=$(python3 $H/mcai-analysis/bagfixgate.py check-registration "$RUN" 2>&1 | tail -1)
    case "$(echo "$RC" | awk '$1 == "BAGFIX" {print $2}')" in
      OK) journal bagfix-registration-ok "$RC";;
      *) page error "bag-fix registration REFUSED $RUN: $RC"; journal refused-v33 "$RC"; exit 2;;
    esac
    grep -qE '^TARGET_K = [4-9]' $H/mcai-analysis/drawrec.sh || { page error "bag fix $RUN needs a 4-pool draw and $H/mcai-analysis/drawrec.sh does not target 4 (TARGET_K)"; journal refused-v33 "drawrec.sh TARGET_K < 4"; exit 2; }
  fi
  # v34: an underground-safety registration must be well-formed for its DiD death gate (usafegate.py); a malformed one
  # (e.g. a dict in linkage_extra, which crashes verdict.py and changerowcheck.py) is refused before the draw.
  if [ -z "$FUN" ] && [ "$(jf class)" = "underground-safety" ]; then
    RC=$(python3 $H/mcai-analysis/usafegate.py check-registration "$RUN" 2>&1 | tail -1)
    case "$(echo "$RC" | awk '$1 == "USAFE" {print $2}')" in
      OK) journal usafe-registration-ok "$RC";;
      *) page error "underground-safety registration REFUSED $RUN: $RC"; journal refused-v34 "$RC"; exit 2;;
    esac
  fi
  if [ -z "$FUN" ] && [ -f $H/digest/NEXT-SLOT.json ]; then
    if [ "$(jf class)" = "underground-safety" ]; then
      journal next-slot-ok "underground-safety fix $RUN may take the reserved slot (consumed only after a verified deploy)"
    else
      page error "NEXT SLOT is reserved for an underground-safety fix ($(cat $H/digest/NEXT-SLOT.json)); $RUN is class '$(jf class)' -- refusing"
      journal refused-v33 "next slot reserved for underground-safety: $(cat $H/digest/NEXT-SLOT.json)"
      exit 2
    fi
  fi
fi
# ---- v30 AS A PREFLIGHT, BEFORE THE DRAW. Measured 2026-10-01: the only v30 check sat AFTER the deploy,
# so fixes-01 went live on 20 bots at 02:02Z, was refused at 02:05Z, and ran ~2 h with no reader and no
# death poll (canarywatch's heal budget relaunched it three times into the same refusal). A schedule
# defect must refuse before a single bot is touched; the later check stays for resumed runs.
if [ -z "$FUN" ] && [ "$(mf canary_code_version)" != "$SHA" ]; then
  _DL=$(jf deadline_min); [ -n "$_DL" ] || _DL=780
  if ! python3 "$HOME/v30check.py" "$REG" "$_DL"; then
    page error "canary-loop refused $RUN BEFORE the draw: v30 schedule invariant (deadline_min $_DL vs read_minutes)"
    journal refused-v30 "deadline_min $_DL vs read_minutes: the final read would be unreachable (preflight, nothing deployed)"
    exit 1
  fi
fi
# ---- phase DRAW + DEPLOY (skipped when the manifest already names this sha)
if [ "$(mf canary_code_version)" != "$SHA" ]; then
  if [ -n "$(mf canary_pool)" ]; then page error "manifest names another canary ($(mf canary_pool) $(mf canary_code_version)); refusing to start"; exit 2; fi
  if [ -n "$FUN" ]; then journal draw "waiting for two pools (fun mode: at most ${FUN_DRAW_CAP_MIN} min, then the fallback draw)"; else journal draw "waiting for two pools"; fi
  _D0=$(_now); FB=""
  while true; do
    # FUN MODE: once FUN_DRAW_CAP_MIN has passed, drawrec.sh draws with DRAW_FUN_FALLBACK=1 (the 12-h ledger exclusion,
    # the band and the livelock filter are dropped; isolated/placebo-c, the live canary, the brain subset and the manual
    # exclusions still hold). A fallback that finds nothing ends the loop (paged) instead of waiting for hours.
    [ -n "$FUN" ] && [ $(( $(_now) - _D0 )) -ge $(( FUN_DRAW_CAP_MIN * 60 )) ] && FB=1
    D=$(DRAW_FUN_FALLBACK=$FB bash $H/mcai-analysis/drawrec.sh "$RUN" 2>&1 | tail -4); P=$(echo "$D" | grep -o "DRAW (.*owner C): \[.*\]" | grep -o "'[a-z-]*'" | tr -d "'" | paste -sd, -)
    # v33: WIDENING MID-RUN IS NOT DONE (a second deploy rewrites the one declared_at, restarts the pools already on
    # canary and rebuilds the canary tree under them). Its safe equivalent: a bag fix starts at 20 bots, or waits.
    # THREE-POOL BAG FIXES (OPERATOR + CODEX 10-10, owner's delegation). The decision is bagfixrule.draw_decision, asked
    # through `bagfixgate.py draw-decide` (tested there); this block only acts on its one line:
    #   DRAW DEPLOY  four pools; or THREE once the draw has been blocked > 1 h SOLELY by the four-pool minimum (this run's
    #                journal: an unbroken streak of draw-short rows). Never two.
    #   DRAW SHORT   journalled draw-short; waits. Any other answer (a crash, a timeout, garbage) is treated as SHORT.
    #   DRAW NONE    the band gave fewer than two pools: journalled as `draw`, which RESTARTS the three-pool clock, so
    #                blocking by the band itself never counts toward the hour.
    # A three-pool run's extension reads to +1920 with its own (c) bands (bagfixrule.EXTEND_MIN_BY_POOLS / BANDS_BY_POOLS).
    if [ -n "$BAGFIX" ]; then
      _DD=$(timeout 120 python3 $H/mcai-analysis/bagfixgate.py draw-decide "$RUN" "$P" 2>&1 | tail -1)
      case "$_DD" in
        "DRAW DEPLOY "*)
          [ "$(echo "$P" | tr ',' '\n' | grep -c .)" -lt "$BAGFIX_POOLS" ] && { journal draw-three "$P :: ${_DD#DRAW DEPLOY }"; page flag "bag fix $RUN deploys on THREE pools ($P): ${_DD#DRAW DEPLOY }"; };;
        "DRAW NONE "*)
          journal draw "${_DD#DRAW NONE } :: $(echo "$D" | tail -1 | cut -c1-160)"; P="";;
        "DRAW SHORT "*)
          journal draw-short "${_DD#DRAW SHORT } -- the band gave ${P:-nothing}; waiting 20 min"; P=""
          _SHORT=$(( ${_SHORT:-0} + 1 ))
          # bounded in attention, not in time: after 3 h of short draws the operator is told once
          [ "$_SHORT" -eq 9 ] && page flag "bag fix $RUN has waited 3 h for its draw (last band: $(echo "$D" | head -1 | cut -c1-160)); still waiting";;
        *)
          # an unreadable decision (crash, timeout, garbage, DRAW ERROR) is its OWN phase: it BREAKS the three-pool
          # streak, because unknown time is not time blocked solely by the four-pool minimum (round 3, both)
          journal draw-error "draw decision unreadable: $(echo "${_DD:-EMPTY}" | cut -c1-200) -- the band gave ${P:-nothing}; waiting 20 min"; P="";;
      esac
    fi
    [ -n "$P" ] && break
    if [ -n "$FB" ]; then
      journal draw-failed "fun mode: the fallback draw after ${FUN_DRAW_CAP_MIN} min found no pools: $(echo "$D" | tail -2 | tr '\n' ' ' | cut -c1-240)"
      page error "$RUN: no pools after the ${FUN_DRAW_CAP_MIN}-min draw cap, fallback included -- nothing deployed; rearm when pools are free"
      exit 2
    fi
    if [ -n "$FUN" ]; then _sleep 600; else sleep 1200; fi
  done
  [ -n "$FB" ] && journal draw-fallback "fun mode: drawn by the fallback after the ${FUN_DRAW_CAP_MIN}-min cap"
  journal drawn "$P :: $(echo "$D" | head -2 | tr '\n' ' ')"
  if [ "$NOACT" = "--no-act" ]; then echo "would deploy $SHA to $P"; exit 0; fi
  # v34-HYB (Codex launch condition 2): the matched-pool control is FROZEN after the draw and BEFORE the deploy, and
  # journalled; the gate only ever LOADS this record (<reads>/<run>-usafe-pre.json.matched) and is UNREADABLE without it.
  # A freeze that fails refuses the deploy: nothing has been deployed yet.
  if [ -z "$FUN" ] && [ "$(jf class)" = "underground-safety" ]; then
    FZ=$(python3 $H/mcai-analysis/usafegate.py freeze "$RUN" "$P" 2>&1 | tail -1)
    case "$(echo "$FZ" | awk '$1 == "USAFE" {print $2}')" in
      FROZEN) journal usafe-matched-frozen "$FZ";;
      *) journal refused-v34 "matched control not frozen: $FZ"; page error "underground-safety $RUN NOT DEPLOYED: the matched control could not be frozen: $FZ (an earlier record for other pools is never overwritten; a re-run needs a new run id)"; exit 2;;
    esac
  fi
  CANARY_ENV="$CENV" $H/bin/fleet-deploy "$SHA" "$RUN" "$(jf notes) pools $P drawn at deploy by the canary loop" --pool "$P" > $H/digest/deploy-$RUN.log 2>&1 || { page error "deploy launch failed"; exit 2; }
  grep -q "VERIFIED" $H/digest/deploy-$RUN.log || { page error "deploy not verified: $(tail -2 $H/digest/deploy-$RUN.log | tr '\n' ' ')"; exit 2; }
  journal deployed "$P $(mf declared_at)"; page info "canary $RUN $SHA deployed to $P at $(mf declared_at)"
fi
# v33: the reserved next slot is CONSUMED only once an underground-safety canary is verifiably deployed (journal
# `deployed`, manifest naming its sha) -- on a fresh launch and on a resume alike, so a refused or failed launch keeps it.
if [ -z "$FUN" ] && [ -f $H/digest/NEXT-SLOT.json ] && [ "$(jf class)" = "underground-safety" ] && _jhas deployed && [ "$(mf canary_code_version)" = "$SHA" ] && [ "$NOACT" != "--no-act" ]; then
  journal next-slot-consumed "$(head -1 $H/digest/NEXT-SLOT.json)"
  mv $H/digest/NEXT-SLOT.json $H/digest/NEXT-SLOT.consumed-$RUN.json
fi
DECL=$(mf declared_at); T0=$(python3 -c "import datetime as dt; print(int(dt.datetime.fromisoformat('$DECL'.replace('Z','+00:00')).timestamp()))")
if [ -n "$FUN" ]; then
  READS="$FUN_READS"; DEADLINE=$FUN_DEADLINE
  SCRIPTS=$(python3 -c "import json; print(' '.join(json.load(open('$REG')).get('reads') or []))")
else
READS=$(python3 -c "import json; r=json.load(open('$REG')); m=r['read_minutes']+ (r.get('extension',{}).get('extra_reads',[]) if r.get('extension',{}).get('until_exposure') else []); print(' '.join(str(x) for x in sorted(m)))")
SCRIPTS=$(python3 -c "import json; print(' '.join(json.load(open('$REG'))['reads']))"); DEADLINE=$(jf deadline_min); [ -n "$DEADLINE" ] || DEADLINE=780
fi
# v30 REFUSAL: A SCHEDULE WHOSE LAST READ MINUTE IS NOT STRICTLY INSIDE THE DEADLINE CANNOT BE READ.
# drop5-01, 2026-09-25: read_minutes [30,90,180,360] AND deadline_min 360. The deadline test further
# down lives INSIDE the read loop, so the loop reached the +360 read at 362 min elapsed, fired
# containment and recorded INCONCLUSIVE -- with no drop5read-360.json and no immobiledid-360.json ever
# written. Exposure 101 against a floor of 60 was met, linkage was clean, safety was clean, and the
# primary was never evaluated. 3 of 18 registrations on file carry this pattern, all from the last two
# days. THIS IS THE ONLY PLACE THE LOSS IS PREVENTABLE: verdict.py can annotate the violation, but by
# the deadline it is already too late -- the same defect as a remedy the bot cannot perform from where
# it is.
if [ -z "$FUN" ] && ! python3 "$HOME/v30check.py" "$REG" "$DEADLINE"; then
  page error "canary-loop refused to launch $RUN: v30 schedule invariant (deadline_min vs read_minutes)"
  journal refused-v30 "deadline_min $DEADLINE vs read_minutes: the final read would be unreachable"
  exit 1
fi
# ---- phase READS: at each registered minute run the scripts, then verdict.py; death poll every 5 min in between
FINAL=""; FINALV=""
# TEARDOWN IS THREE STEPS AND HALF OF IT IS SILENTLY WRONG (CLAUDE.md). These are factored so the
# KEEP-without-promotion path and the REVERT/INCONCLUSIVE path cannot drift apart -- two copies of
# a teardown is how five bots were left running canary code after a "complete" one.
_restart_assigned() {
  # IT ONLY RESTARTED UNITS ALREADY `running`, so a stopped or failed bot was skipped and came
  # back on CANARY code -- a teardown that looks complete and is not. Every assigned unit is
  # restarted now, whatever state it is in, and the ones that were not running are named.
  # Bot names are enumerated from the log directories of the assigned pools rather than from a
  # hardcoded Alpha/Bravo/Comet/Delta/Echo list, which is wrong the moment a roster is partial.
  local skipped=""
  for pool in ${P//,/ }; do
    for d in /var/log/mcai/$pool-*; do
      [ -d "$d" ] || continue
      local b=$(basename "$d")
      systemctl list-units "mcbot@$b.service" --no-legend | grep -q running || skipped="$skipped $b"
      sudo systemctl restart "mcbot@$b.service" 2>/dev/null || skipped="$skipped $b(restart-failed)"
      sleep 12
    done
  done
  [ -n "$skipped" ] && journal teardown-note "units not running before restart (still restarted):$skipped"
  return 0
}

_teardown() {
  sudo /usr/local/sbin/mcai-canary-tree teardown | tail -1
  sudo python3 -c 'import json; p="/srv/mcbots/trial-manifest.json"; m=json.load(open(p)); m["canary_pool"]=None; m["canary_code_version"]=None; json.dump(m, open(p,"w"), indent=2)'
  _restart_assigned
  sleep 90
  local LIVE=$(for pool in ${P//,/ }; do for d in /var/log/mcai/$pool-*; do f=$(ls -t $d/skill-*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -1 $f | python3 -c 'import sys,json; print(json.loads(sys.stdin.readline())["code"]["version"][:7])' 2>/dev/null; done; done | sort | uniq -c | tr '\n' ' ')
  # AN ENV CANARY IS TORN DOWN ONLY WHEN EVERY BOT OF THE POOLS IS PROVEN FREE OF ITS ENV (Codex r1). The version labels
  # cannot show it, so read each live process's environment AS ROOT (`sudo cat`: the open itself is privileged). A bot
  # with no running process, or an environ that cannot be read, is NOT proof -- it is named, and the teardown is not
  # journalled as done: the scheduler keeps the slot open and the operator restarts the named units.
  if [ -n "$CENV_KEYS" ]; then
    local BAD="" N=0
    # THE ROSTER, not log dirs (Claude r3): 16 pools carry a stale `-Charlie` log dir from a rename, which has no unit
    # and would read as "no-process" on every teardown.
    for pool in ${P//,/ }; do for e in /srv/mcbots/harness/env/$pool-*.env; do [ -f "$e" ] || continue; b=$(basename "$e" .env); N=$((N+1))
      pid=$(systemctl show -p MainPID --value "mcbot@$b.service" 2>/dev/null)
      if [ -z "$pid" ] || [ "$pid" = 0 ]; then BAD="$BAD $b:no-process"; continue; fi
      envtxt=$(sudo cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n') || { BAD="$BAD $b:unreadable"; continue; }
      [ -n "$envtxt" ] || { BAD="$BAD $b:unreadable"; continue; }
      for k in $(_env_still_canary "$envtxt"); do BAD="$BAD $b:$k"; done
    done; done
    if [ -n "$BAD" ] || [ "$N" = 0 ]; then
      journal teardown-incomplete "env not proven cleared on ${N} bot(s):${BAD:- no bots found}"
      page error "TEARDOWN INCOMPLETE $RUN: canary env not proven cleared:${BAD:- no bots found} -- restart those units, then journal torn-down by hand"
      return 1
    fi
    journal env-cleared "the canary values of $CENV_KEYS proven absent on $N bot(s)"
  fi
  journal torn-down "$LIVE"
  page verdict "$FINAL $RUN; torn down; pools live: $LIVE"
}

# The registered read scripts at minute $1, exit status checked (factored v33 so the bag-fix extension runs the same code).
_run_reads() {
  local M=$1
  # THE READ SCRIPTS LIVE IN /tmp AND NOTHING PUTS THEM THERE. (See the note at the base read below.)
  local _miss=""
  for s in $SCRIPTS; do [ -f "$RD/$s.py" ] || _miss="$_miss $s"; done
  # FUN MODE: registered reads are optional evidence for own lines; a missing one is noted and skipped, never fatal.
  if [ -n "$FUN" ]; then
    [ -n "$_miss" ] && journal reads-skipped "+$M fun mode: registered read(s) absent from $RD:$_miss (own lines on them are not evaluated)"
    local _have=""; for s in $SCRIPTS; do [ -f "$RD/$s.py" ] && _have="$_have $s"; done
    [ -n "$_have" ] || return 0
    [ -f $H/mcai-analysis/heavyread.sh ] || { journal reads-skipped "+$M fun mode: heavyread.sh missing, registered reads not run"; return 0; }
    local SCRIPTS="$_have"; _miss=""
  fi
  if [ -n "$_miss" ]; then
    page error "registered read script(s) missing from $RD:$_miss -- nothing copies them in and a reboot empties /tmp. Restore them before this canary can be read."
    journal "reads-missing" "missing from $RD:$_miss"
    exit 4
  fi
  # SERIALIZED AND MEMORY-CAPPED (gate v35, coordinator 10-10): every read runs through heavyread.sh -- the shared
  # heavy-read lock (no read overlaps another read or a calibration job) and a MemoryMax scope (min(32G, MemTotal - 24G)), so a memory shortfall
  # kills the READ, never a bot. A killed, refused or failed read is journalled read-failed; its evidence is absent, so
  # verdict.py answers UNREADABLE for it, never a pass. heavyread.sh missing = no read runs (fail closed).
  [ -f $H/mcai-analysis/heavyread.sh ] || { page error "$H/mcai-analysis/heavyread.sh missing: reads are never run uncapped"; journal reads-missing "heavyread.sh missing"; exit 4; }
  # the probe is journalled at every read minute: which cap, in which mode -- or why no read will run (round 4, Claude)
  local _hp; _hp=$(bash $H/mcai-analysis/heavyread.sh --probe 2>&1 | tail -1)
  journal heavyread-mode "+$M $_hp"
  case "$_hp" in "HEAVYREAD UNAVAILABLE"*) page error "reads at +$M cannot run capped ($_hp): each will fail closed";; esac
  # the timeout follows the window: +1920 reads were measured at up to 14 min (peacefulkitread 846 s; round 4, Claude)
  local _to=900; [ "$M" -ge 1440 ] && _to=1800
  for s in $SCRIPTS; do
    # ONLY THIS ATTEMPT'S EVIDENCE MAY DECIDE (round 4, Codex): a killed, refused or failed rerun must not leave an
    # earlier attempt's bound evidence behind for verdict.py to accept (readjson.emit writes <run>-<read>-<M>.json).
    rm -f $H/digest/reads/$RUN-$s-$M.json
    (cd ${CANARY_READ_CWD:-/opt/minecraft-ai/scripts} && HEAVYREAD_ROLE=loop bash $H/mcai-analysis/heavyread.sh $_to $H/digest/reads/$RUN-$s-$M.txt -- python3 $RD/$s.py $M)
    local _rc=$?
    [ $_rc -ne 0 ] && rm -f $H/digest/reads/$RUN-$s-$M.json
    if [ $_rc -ne 0 ]; then
      local _what
      case $_rc in
        124) _what="TIMED OUT after ${_to}s";;
        137) _what="KILLED (heavyread's memory cap, or the timeout's kill)";;
        75) _what="NOT RUN: the heavy-read lock stayed busy (another loop read?)";;
        77) _what="NOT RUN: no memory-capped scope could be created";;
        *) _what="exited $_rc";;
      esac
      journal read-failed "$s +$M $_what: $(tail -2 $H/digest/reads/$RUN-$s-$M.txt 2>/dev/null | tr '\n' ' ' | cut -c1-260)"
      page error "read $s +$M $_what -- its evidence is absent or partial, so this read cannot decide"
    fi
  done
}

FROM=""   # the verdict minute whose REVERT ended the base phase (0 = the death poll): bagfixgate.py reads that artifact
EXT=""; grep -q "\"run\":\"$RUN\".*\"phase\":\"bagfix-extend\"" $J 2>/dev/null && EXT=1
[ -n "$EXT" ] && echo "bag-fix extension already recorded for $RUN: resuming it, not the base reads"
# ---- v33 phase BAG-FIX EXTENSION (OWNER DECISION 2026-10-07; docs/reports/bagfix-death-rule-2026-10-07.md).
# A REVERT on a bag fix is handed to bagfixgate.py extend-check, which EXTENDS only when verdict.py's REVERT artifact
# says by=death_gate (the all-cause gate, not any other line) with its counts, the re-measurement sees at least those
# deaths in both arms and measured exposure in both, the fix's own rows are visible on >= 2 canary bots (positive
# control), ZERO canary deaths are linked, and the ceiling (b) is not already met. Anything else -- including a crash
# or an empty line -- leaves the REVERT standing: the old behaviour is the fallback, never an extension.
# RESUME SAFETY (round 2): every step is journalled BEFORE it is acted on and restored from the journal on a resume:
#   bagfix-pending FROM=M   a REVERT was handed to extend-check (a crash during it re-runs it, fail closed: a stale
#                           verdict artifact makes extend-check REVERT)
#   bagfix-extend (+M)      the extension, with the tripping minute M (its gate-off re-run is redone if missing)
#   bagfix-decided W :: ..  a terminal decision (the standing REVERT included), resumed straight into ACT
BF="$H/mcai-analysis/bagfixgate.py"
_decide() { FINAL=$1; FINALV="$2"; journal bagfix-decided "$1 :: $2"; page verdict "$2"; }
_last() { grep "\"run\":\"$RUN\".*\"phase\":\"$1\"" $J 2>/dev/null | tail -1 | python3 -c "import sys,json; l=sys.stdin.read().strip(); print(json.loads(l)['note'] if l else '')"; }
if [ -n "$BAGFIX" ]; then
  _D=$(_last bagfix-decided)
  if [ -n "$_D" ]; then FINAL=${_D%% *}; FINALV="${_D#* :: }"; echo "bag-fix decision already recorded for $RUN: $FINAL (resuming into ACT)"; fi
  if [ -z "$FINAL" ] && [ -z "$EXT" ] && _jhas bagfix-pending; then
    _P=$(_last bagfix-pending); FROM=${_P#FROM=}; FROM=${FROM%% *}; FINAL=REVERT; echo "resuming an interrupted extend-check from +$FROM"
  fi
fi
EXTFROM=0
if [ -n "$EXT" ]; then _E=$(_last bagfix-extend); EXTFROM=$(echo "$_E" | sed -n 's/^BAGFIX EXTEND (+\([0-9]*\)).*/\1/p'); EXTFROM=${EXTFROM:-0}; fi
for M in $READS; do
  { [ -n "$EXT" ] || [ -n "$FINAL" ]; } && break     # an extension or a journalled decision is resumed, not re-read
  grep -q "\"run\":\"$RUN\".*\"phase\":\"read-$M\"" $J 2>/dev/null && { echo "read +$M already done"; continue; }   # scoped to THIS run: the unscoped grep matched the previous run and skipped every read (16 Sep 22:25Z)
  while [ $(( $(_now) - T0 )) -lt $(( M * 60 )) ]; do
    _sleep $POLL_S
    # THE POLL IS THE DEATH GATE, AND ITS STDERR WAS BEING THROWN AWAY (`2>/dev/null`).
    # A poll that cannot run is a safety check that is down, and it would have been silent here
    # every five minutes for hours -- the same class of defect as the empty read verdicts on
    # banktruth-01, at the one site where it matters most.
    V=$(python3 $H/verdict.py $RUN 0 --poll 2>$H/digest/poll-err-$RUN.log | tail -1)
    if [ -z "$V" ]; then
      journal poll-failed "$(tail -3 $H/digest/poll-err-$RUN.log 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
      page error "DEATH POLL PRODUCED NO VERDICT -- the safety gate is not running: $(tail -2 $H/digest/poll-err-$RUN.log 2>/dev/null | tr '\n' ' ' | cut -c1-200)"
    fi
    # READ THE FIELD, NOT THE LINE. This arm used `case "$V" in *REVERT*)` and set FINAL=REVERT from
    # a SUBSTRING of the whole verdict line -- while the scheduled-read arm below has always taken
    # `awk '{print $2}'`. Two rules about the same question, and the loose one ran on the death poll.
    # MEASURED 2026-09-26: 8 of 42 why.append sites in verdict.py carry the literal "REVERT"; six are
    # on the same statement as out('REVERT'), and the other two (v28's "MORE THAN ONE calibrated
    # REVERT line declared", v25's "does not license a REVERT") print it while the verdict is
    # INCONCLUSIVE. Both sit past the poll's out('POLL_OK') exit, so this was LATENT rather than live
    # -- and the v32 advisory added today IS reachable under --poll, which is what made a latent
    # false-revert route worth closing instead of documenting. 7 of 23 reverts on file are already
    # confirmed false; this is the one class of them that needed no calibration to remove.
    case "$(echo "$V" | awk '{print $2}')" in
      REVERT) [ -n "$BAGFIX" ] && journal bagfix-pending "FROM=0"; journal poll-revert "$V"; page verdict "$V"; FINAL=REVERT; FINALV="$V"; FROM=0; break 2;;
      # v34: a poll that answers UNREADABLE is a death gate that is NOT running (e.g. unreadable logs under the DiD gate);
      # it used to fall through silently. Journalled each time, paged on the first and every 6th (30 min) in a row.
      UNREADABLE) PU=$(( ${PU:-0} + 1 )); journal poll-unreadable "($PU in a row) $V"
        [ $(( PU % 6 )) -eq 1 ] && page error "DEATH POLL UNREADABLE ($PU in a row) -- the death gate is not deciding: $V";;
      "") ;;      # an empty poll is already paged above as DEATH POLL PRODUCED NO VERDICT; it does not reset the count
      *) PU=0;;
    esac
    if [ -n "$POLLR" ]; then
      MP=$(cd ${CANARY_READ_CWD:-/opt/minecraft-ai/scripts} && timeout 120 python3 $RD/$POLLR.py --poll 2>$H/digest/modelpoll-err-$RUN.log | tail -1)
      case "$(echo "$MP" | awk '$1 == "MODELPOLL" {print $2}')" in
        REVERT) journal poll-revert "$MP"; page verdict "$MP"; FINAL=REVERT; FINALV="$MP"; FROM=0; break 2;;
        OK) MPF=0;;
        *) MPF=$(( ${MPF:-0} + 1 )); journal modelpoll-failed "($MPF in a row) ${MP:-EMPTY: $(tail -2 $H/digest/modelpoll-err-$RUN.log 2>/dev/null | tr '\n' ' ' | cut -c1-200)}"
           [ $(( MPF % 6 )) -eq 1 ] && page error "MODEL POLL NOT DECIDING ($MPF in a row): the stall guard is down -- ${MP:-no output}";;
      esac
    fi
    if [ $(( $(_now) - T0 )) -gt $(( DEADLINE * 60 )) ]; then journal deadline "no verdict by +$DEADLINE"; page error "deadline +$DEADLINE reached without a verdict: containment"; FINAL=INCONCLUSIVE; FINALV="deadline +$DEADLINE reached without a verdict (containment)"; break 2; fi
  done
  # THE READ SCRIPTS LIVE IN /tmp AND NOTHING PUTS THEM THERE.
  # This runs /tmp/$s.py, but no step in this loop copies them in -- they are placed by hand
  # when a canary is prepared. /usr/lib/tmpfiles.d/tmp.conf carries `D /tmp 1777 root root
  # 30d`, and the D directive EMPTIES /tmp on boot. The host has been up two weeks so it has
  # not bitten, but a reboot would leave every registered read missing and the failure would
  # surface only as "no evidence object", several steps from the cause.
  #
  # It deliberately does NOT copy them in from /opt or ~/mcai-analysis. The /tmp copies are
  # frequently NEWER than the tree ones -- on 2026-09-23 /tmp held fixes that /opt did not --
  # so auto-copying would silently downgrade the instrument mid-canary, which is worse than
  # the outage it would paper over. It refuses and names what is missing instead.
  _run_reads $M
  # A CRASH USED TO BE INDISTINGUISHABLE FROM A QUIET READ.
  # This captured stdout only, so when verdict.py raised, the traceback went to a stderr
  # nobody kept and $V became the EMPTY STRING -- which was then journalled as the verdict.
  # banktruth-01 recorded {"phase":"read-30","note":""}, {"read-90","note":""} and
  # {"read-180","note":""} on 2026-09-23: three scheduled reads, three empty notes, four and
  # a half hours into a canary due that night, with the loop alive and journalling the whole
  # time. verdict.py now refuses instead of raising, but the loop must not be able to swallow
  # the next one either.
  if [ -n "$FUN" ]; then
    V=$(python3 $H/mcai-analysis/funread.py $RUN $M 2>$H/digest/verdict-err-$RUN-$M.log | tail -1)
  else
    V=$(python3 $H/verdict.py $RUN $M 2>$H/digest/verdict-err-$RUN-$M.log | tail -1)
  fi
  [ -z "$V" ] && V="CRASH (no verdict on stdout): $(tail -3 $H/digest/verdict-err-$RUN-$M.log 2>/dev/null | tr '\n' ' ' | cut -c1-400)"
  # v33: for a bag fix a REVERT is journalled as PENDING before the read is marked done, so no crash window can lose
  # it (round 3, Codex): a resume finds the pending REVERT and re-runs extend-check, fail closed.
  [ -n "$BAGFIX" ] && [ "$(echo "$V" | awk '$1 == "VERDICT" {print $2}')" = "REVERT" ] && journal bagfix-pending "FROM=$M"
  journal "read-$M" "$V"
  # THE VERDICT WORD, NOT THE LINE (2026-09-29): `*KEEP*` matched the PROSE of a NOT_YET line -- deathfix-01's +180 read
  # said "... this blocks KEEP rather than reverting", so FINAL became NOT_YET, which has no act branch, and the canary
  # was contained as INCONCLUSIVE and torn down at its FIRST read, with its registered extension reads never taken.
  # verdict.py prints `VERDICT <word> (+M) :: ...`; only the word decides. A WATCH note inside a line still pages.
  W=$(echo "$V" | awk '$1 == "VERDICT" {print $2}')
  # v33: a bag fix's read is EVALUATED (journal eval-read-M) only when verdict.py got past the catastrophe guards
  # (its artifact's `guards`); an extension re-runs every due minute that never evaluated (round 4, Codex).
  # The SAME allowlist as _ext_read: UNREADABLE can follow the guards (an undefined own line), and is not evaluated
  # (round 5, both reviewers).
  case "$W" in NOT_YET|KEEP|KEEP_ON_SAFETY|INCONCLUSIVE|WATCH)
    [ -n "$BAGFIX" ] && [ "$(_guards $M)" = "True" ] && journal "eval-read-$M" "$V";; esac
  case "$W" in
    REVERT|KEEP|KEEP_ON_SAFETY|INCONCLUSIVE) FINAL=$W; FINALV="$V"; FROM=$M; page verdict "$V"; break;;
    UNREADABLE) page error "$V (HOLD: death poll continues)";;
    *) case "$V" in *WATCH*) page flag "$V";; *) echo "$V";; esac;;
  esac
  # FUN MODE: the final read must close the run. No decision there (a crash, UNREADABLE, garbage) cannot rule out harm,
  # so it is INCONCLUSIVE and torn down -- never left deployed waiting for a deadline.
  if [ -n "$FUN" ] && [ "$M" = "${FUN_READS##* }" ]; then
    FINAL=INCONCLUSIVE; FINALV="fun mode: no decision at the final read +$M -> INCONCLUSIVE (torn down) :: $V"; FROM=$M
    journal contained "$FINALV"; page verdict "$FINALV"
  fi
done
# ---- v33 phase BAG-FIX EXTENSION, part 2 (part 1, the resume state, sits before the base reads above).
if [ "$FINAL" = "REVERT" ] && [ -n "$BAGFIX" ] && [ -z "$EXT" ] && [ -n "$FROM" ] && ! _jhas bagfix-decided; then
  _jhas bagfix-pending || journal bagfix-pending "FROM=$FROM"
  X=$(timeout 900 python3 "$BF" extend-check "$RUN" "$FROM" 2>$H/digest/bagfix-err-$RUN.log | tail -1)
  XW=$(echo "$X" | awk '$1 == "BAGFIX" {print $2}')
  journal bagfix-check "${X:-EMPTY (bagfixgate crashed or timed out: $(tail -2 $H/digest/bagfix-err-$RUN.log 2>/dev/null | tr '\n' ' ' | cut -c1-200))}"
  if [ "$XW" = "EXTEND" ]; then
    journal bagfix-extend "$X"; page verdict "BAG-FIX EXTENSION $RUN: the death gate tripped with 0 linked deaths; NOT reverted, read to its extension window (+1440 at four pools, +1920 at three) under (a)/(b)/(c) :: $X"
    EXT=1; EXTFROM=$FROM; FINAL=""; FINALV=""; JUSTEXT=1
  else
    # the REVERT stands -- journalled as decided BEFORE acting, so a crash here resumes into ACT, not into reads
    _decide REVERT "${FINALV:-REVERT} | bag-fix rule: ${X:-no answer}"
  fi
fi
# One guard read during the extension, gate report-only. Done (journalled $2) ONLY when the verdict evaluated the
# read; UNREADABLE / CRASH / empty is journalled as failed, paged, flagged (RFAIL) and retried next time (round 2).
# Read failures and poll failures are counted SEPARATELY (RBLIND, BLIND): a successful poll must not reset a read
# that keeps failing, nor the reverse.
# A REVERT is decided (journalled) BEFORE the read is marked done.
_ext_read() {
  local M=$1 TAG=$2 V W
  V=$(timeout 900 python3 $H/verdict.py $RUN $M --bagfix-extended 2>$H/digest/verdict-err-$RUN-$TAG.log | tail -1)
  W=$(echo "$V" | awk '$1 == "VERDICT" {print $2}')
  case "$W" in
    REVERT) _decide REVERT "$V"; journal "$TAG" "$V"; return 2;;
    NOT_YET|KEEP|KEEP_ON_SAFETY|INCONCLUSIVE|WATCH)
      # ...and only if the read got PAST the catastrophe guards (verdict.py's artifact `guards`): a NOT_YET from an
      # unreadable immobiledid exits before them and is a failed read, not an evaluated one (round 3, Codex)
      if [ "$(_guards $M)" != "True" ]; then
        RFAIL=1; journal "$TAG-failed" "guards not evaluated: $V"; page error "bag-fix guard read $TAG stopped before the guards: $V -- retrying"; return 1
      fi
      journal "$TAG" "$V"; journal "eval-read-$M" "$V"
      case "$V" in *WATCH*) page flag "$V (bag-fix extension: not final)";; *) echo "$V";; esac; return 0;;
    *) RFAIL=1
       journal "$TAG-failed" "(read failures in a row: $(( RBLIND + 1 )) of 3) ${V:-EMPTY: $(tail -3 $H/digest/verdict-err-$RUN-$TAG.log 2>/dev/null | tr '\n' ' ' | cut -c1-300)}"
       page error "bag-fix guard read $TAG did not evaluate: ${V:-no verdict} -- retrying next poll"
       return 1;;
  esac
}
if [ -n "$EXT" ] && [ -z "$FINAL" ]; then
  # THREE-POOL BAG FIXES (10-10): the final minute follows the manifest's pool count (4 -> 1440, 3 -> 1920), and the
  # registered containment deadline moves by the same amount. No calibrated window = the tripped gate stands.
  # (three tries 10 s apart, so one transient manifest read does not revert a canary)
  EXTMIN=""
  for _i in 1 2 3; do
    _EM=$(timeout 120 python3 "$BF" ext-min "$RUN" 2>/dev/null | tail -1)
    EXTMIN=$(echo "$_EM" | awk '$1 == "EXTMIN" && $2 ~ /^[0-9]+$/ {print $2}')
    [ -n "$EXTMIN" ] && break; sleep 10
  done
  if [ -z "$EXTMIN" ]; then _decide REVERT "bag-fix extension: no calibrated window for this draw ($_EM) -- the tripped gate stands"; fi
fi
if [ -n "$EXT" ] && [ -z "$FINAL" ]; then
  journal bagfix-window "+$EXTMIN ($_EM)"
  EXTDL=$(python3 -c "import json; b=json.load(open('$REG')).get('bag_fix') or {}; print(int(b.get('extended_deadline_min') or 1560) + $EXTMIN - 1440)")
  BLIND=0; RBLIND=0; RFAIL=0
  # THE TRIPPING READ STOPPED AT THE DEATH GATE: verdict.py exits there, so v15c, v11, deposit and the own lines never
  # ran on it. Re-run that same read with the gate report-only, at once (and again on a resume if it never evaluated).
  if [ "$EXTFROM" -gt 0 ] && ! _jhas "eval-read-$EXTFROM"; then
    [ -z "${JUSTEXT:-}" ] && _run_reads $EXTFROM      # on a RESUME the tripping read's evidence may be stale: refresh it
    _ext_read $EXTFROM "read-$EXTFROM-ext"
  fi
  while [ -z "$FINAL" ]; do
    _sleep $POLL_S
    RFAIL=0
    EL=$(( $(_now) - T0 ))
    if [ $EL -gt $(( EXTDL * 60 )) ]; then journal deadline "bag-fix extension: no verdict by +$EXTDL"; _decide INCONCLUSIVE "bag-fix extension deadline +$EXTDL reached without a verdict (containment)"; break; fi
    # a retry of the tripping read REFRESHES its evidence first (verdict.py refuses evidence older than 90 min)
    if [ "$EXTFROM" -gt 0 ] && ! _jhas "eval-read-$EXTFROM"; then _run_reads $EXTFROM; _ext_read $EXTFROM "read-$EXTFROM-ext"; [ $? -eq 2 ] && break; fi
    # The registered reads still due -- and a full read at +1440 -- with the all-cause gate REPORT-ONLY: any OTHER
    # REVERT (own-line defect, v15c, v11, a licensed change row) still ends the canary. KEEP/NOT_YET here are not final.
    _rr=0
    # every due minute that never EVALUATED -- including a base-phase read that was UNREADABLE or stopped before the
    # guards -- is refreshed and re-read here (round 4, Codex)
    for M in $READS $EXTMIN; do
      _jhas "eval-read-$M" && continue
      [ "$M" = "$EXTFROM" ] && continue
      [ $EL -ge $(( M * 60 )) ] || continue
      _run_reads $M
      _ext_read $M "read-$M-ext"; _rr=$?
      [ $_rr -eq 2 ] && break
    done
    [ $_rr -eq 2 ] && break
    if [ $RFAIL -eq 1 ]; then RBLIND=$(( RBLIND + 1 )); else RBLIND=0; fi
    if [ $RBLIND -ge 3 ]; then _decide REVERT "bag-fix extension BLIND: a due guard read failed to evaluate 3 polls in a row after the all-cause gate tripped"; break; fi
    # `final` only after the +1440 guard read EVALUATED (a missing immobiledid, v15c or own line must not reach KEEP)
    # `final` only when EVERY due guard read has evaluated -- the tripping read's re-run, each registered minute
    # already passed, and +1440 (round 3, Codex: one failed read must not be outvoted by a later success)
    _due_ok=1
    [ "$EXTFROM" -gt 0 ] && ! _jhas "eval-read-$EXTFROM" && _due_ok=0
    for M in $READS $EXTMIN; do [ $EL -ge $(( M * 60 )) ] && ! _jhas "eval-read-$M" && _due_ok=0; done
    if [ $EL -ge $(( EXTMIN * 60 )) ] && [ $_due_ok -eq 1 ]; then CMD=final; TMO=2400; else CMD=poll; TMO=600; fi
    V=$(timeout $TMO python3 "$BF" $CMD "$RUN" 2>$H/digest/bagfix-err-$RUN.log | tail -1)
    W=$(echo "$V" | awk '$1 == "BAGFIX" {print $2}')
    case "$CMD:$W" in
      poll:CONTINUE|final:NOT_YET) BLIND=0; PAUSEDN=0;;
      poll:PAUSED)
        # both arms stale reads as a fleet outage -- but a logging failure with bots running looks the same, so it is
        # PAGED at once and BOUNDED: 12 polls in a row (1 h at 5 min) closes the extension INCONCLUSIVE (round 3).
        PAUSEDN=$(( ${PAUSEDN:-0} + 1 ))
        journal bagfix-paused "($PAUSEDN of 12) $V"
        [ "$PAUSEDN" -eq 1 ] && page error "BAG-FIX EXTENSION PAUSED: both arms' telemetry is stale (outage, or logging down?) -- (a)/(b) cannot run: $V"
        if [ "$PAUSEDN" -ge 12 ]; then _decide INCONCLUSIVE "bag-fix extension: (a)/(b) blind for 12 polls with both arms stale (outage or logging failure): $V"; fi;;
      poll:REVERT) journal bagfix-poll-revert "$V"; _decide REVERT "$V";;
      final:KEEP|final:REVERT|final:INCONCLUSIVE)
        journal bagfix-final "$V"
        if [ "$W" = "KEEP" ]; then
          # OWNER 10-07: a KEEP under the extended rule hands the NEXT canary slot to an underground-safety fix. The
          # fresh-launch preflight refuses any other class while this file exists.
          printf '{"after":"%s","at":"%s","next":"underground-safety","why":"bag-fix KEEP under the extended rule (owner 2026-10-07)"}\n' "$RUN" "$(date -u +%FT%TZ)" > $H/digest/NEXT-SLOT.json
          journal next-slot "underground-safety (owner 2026-10-07): ~/digest/NEXT-SLOT.json; launches of any other class are refused until one deploys"
          page verdict "NEXT CANARY SLOT -> an underground-safety fix (airpocket, then lavaadmit), per the owner's 10-07 bag-fix rule"
        fi
        _decide "$W" "$V";;
      *)
        # (a)/(b) could not run (ERROR, empty, UNREADABLE). The all-cause gate has ALREADY tripped and is report-only
        # here, so a blind extension may not continue: three in a row and the canary is reverted.
        BLIND=$(( BLIND + 1 ))
        journal poll-failed "bag-fix $CMD ($BLIND of 3): ${V:-EMPTY} $(tail -2 $H/digest/bagfix-err-$RUN.log 2>/dev/null | tr '\n' ' ' | cut -c1-200)"
        page error "BAG-FIX $CMD PRODUCED NO USABLE ANSWER ($BLIND of 3) -- (a)/(b) are not running: ${V:-EMPTY}"
        if [ $BLIND -ge 3 ]; then _decide REVERT "bag-fix extension BLIND: 3 consecutive failures after the all-cause gate tripped (last: ${V:-EMPTY})"; fi;;
    esac
  done
fi
[ -n "$FINAL" ] || { journal end "no final verdict"; page error "loop ended without a verdict"; exit 2; }
# ---- phase ACT
# A RESUMED loop must not record a decision twice (v33: the extension resumes into its journalled decision, and a
# crash between `recorded` and teardown would otherwise write a second ledger row before tearing down).
_recorded() { grep -q "\"run\":\"$RUN\".*\"phase\":\"recorded\"" $J 2>/dev/null && echo "decision already recorded for $RUN; not recording twice"; }
# ...and `recorded` is journalled ONLY when the ledger write succeeded (round 2, Codex: a failed write used to be
# journalled as recorded, which the guard above would then have made permanent). A failure pages and the act continues
# (teardown must not wait on the ledger); check-open-loop.py will then report the open loop.
_record() {
  if (cd /opt/minecraft-ai && sudo python3 scripts/check-open-loop.py --record "$1" --note "$NOTE" > $H/digest/record-$RUN.log 2>&1); then
    tail -1 $H/digest/record-$RUN.log; journal recorded "$1"
  else
    journal record-failed "$1: $(tail -2 $H/digest/record-$RUN.log | tr '\n' ' ' | cut -c1-200)"; page error "LEDGER RECORD FAILED for $RUN $1 -- record it by hand: $(tail -1 $H/digest/record-$RUN.log)"
  fi
}
if [ "$NOACT" = "--no-act" ]; then echo "would act: $FINAL"; exit 0; fi
# Same guard on the closing note: an empty FINALV here would tear down on a blank verdict.
_FV="${FINALV:-$(python3 $H/verdict.py $RUN $M 2>$H/digest/verdict-err-$RUN-final.log | tail -1)}"
[ -z "$_FV" ] && _FV="CRASH (no verdict on stdout): $(tail -3 $H/digest/verdict-err-$RUN-final.log 2>/dev/null | tr '\n' ' ' | cut -c1-400)"
NOTE="$RUN: $_FV (canary loop)"; P=$(mf canary_pool)
# Containment for any verdict with no act branch. KEEP_ON_SAFETY is the live example: it
# matches *KEEP* in the read case above, so the loop stops reading and exits -- but it matched
# NEITHER branch below, so the loop recorded no ledger decision, neither promoted nor tore
# down, and left a DEPLOYED canary with the loop gone: an open loop found only the next
# morning. It never fired because 1011b reached exposure at +540. Contain as INCONCLUSIVE,
# which records and tears down, and is what the exposure interlock asks for on zero exposure.
case "$FINAL" in
  KEEP|REVERT|INCONCLUSIVE) ;;
  *) page error "verdict '$FINAL' has no promotion path; containing as INCONCLUSIVE and tearing down"; journal contained "$FINAL -> INCONCLUSIVE"; FINAL=INCONCLUSIVE ;;
esac
case "$FINAL" in
  KEEP)
    # KEEP WITHOUT A PROMOTION PATH USED TO `exit 2` AND LEAVE THE CANARY DEPLOYED.
    # The comment fifteen lines above describes exactly this failure -- "left a DEPLOYED canary
    # with the loop gone: an open loop found only the next morning" -- and the KEEP branch still
    # did it. It is not a corner case: a canary inside the 24-27 Sep program window MUST declare
    # promotion "none", because fleet-wide promotion is forbidden there, so every KEEP in that
    # window would have stranded its treatment. Record the KEEP, then tear down; the verdict is
    # preserved and the fleet is returned to baseline.
    # brain-01: KEEP ON A FIXED SUBSET is NOT done by the loop (Codex r1: a promote-then-apply inside the loop could close
    # the run before the subset was kept, and could not resume). The loop records the KEEP and tears the canary down
    # exactly like any non-fleet-wide KEEP below; then it pages the operator with the one verified command that makes
    # the env permanent on these pools (mcai-brain-subset: record first, exact-value verification, resumable). The code
    # is inert without the env and rides the next fleet-wide promotion.
    PROMO=$(jf promotion); [ -n "$FUN" ] && [ -z "$PROMO" ] && PROMO=fleet-wide   # fun mode: a KEEP is promoted
    if [ "$PROMO" = "keep-subset" ]; then
      journal subset-pending "operator: sudo /usr/local/sbin/mcai-brain-subset apply --run $RUN --pools $P --env \"$CENV\""
      page verdict "KEEP $RUN (keep-subset): after teardown, the operator applies the subset: sudo /usr/local/sbin/mcai-brain-subset apply --run $RUN --pools $P --env \"$CENV\""
    fi
    if [ "$PROMO" != "fleet-wide" ]; then
      page verdict "KEEP $RUN, promotion '$PROMO' -- recording and tearing down rather than promoting"
      journal keep-unpromoted "promotion=$PROMO; recording KEEP then restoring baseline"
      _recorded || _record KEEP
      FINAL=KEEP_TEARDOWN
    fi
    if [ "$FINAL" = "KEEP_TEARDOWN" ]; then _teardown; exit 0; fi
    _recorded || _record KEEP
    # a KEEP is PROMOTED only once it is in the ledger (round 3, Claude): otherwise the canary stays deployed, the loop
    # exits, and canarywatch's relaunch resumes into the journalled decision and retries the record
    _jhas recorded || { journal promote-held "KEEP not recorded in the ledger; not promoting"; page error "KEEP $RUN NOT PROMOTED: the ledger record failed (see $H/digest/record-$RUN.log); the canary stays deployed -- relaunch the loop to retry"; exit 2; }
    $H/bin/fleet-deploy "$SHA" "$RUN-promote" "PROMOTION of $RUN (KEEP by the canary loop)" > $H/digest/deploy-$RUN-promote.log 2>&1; grep -q "VERIFIED" $H/digest/deploy-$RUN-promote.log || { page error "promotion not verified"; exit 2; }
    journal promoted "$SHA fleet-wide"; page verdict "PROMOTED $RUN $SHA fleet-wide (operator: fast-forward main and keep main-pre-<date>)";;
  REVERT|INCONCLUSIVE)
    _recorded || _record "$FINAL"
    _teardown;;
esac
