#!/bin/bash
# servea-waiter.sh -- serving A, OWNER 11-02 ~13:40Z "do what you recommend": run servea-01 (the round-3 4B on the
# 5080, 10 bots) when it reaches the head; if it is KEPT, put the oai+ client on the fleet (llmoai-01) and stage the 4B
# to 20/40/60/80 bots with modelrollout (load test before each stage, per-decision fallback to qwen2.5, the existing
# stops); if every stage passes, the 4B is the fleet's model. Nothing here waits on a person.
#
# Runs on the MAC (launchd com.mcai.servea-waiter, every 3 min): it is the only controller that can reach the 5080 as
# root (llama-server start/stop). Everything on the canary host goes through ssh; it never wraps canary-sched.py in
# flock, never edits the queue file (only `queue release` / `queue cancel`), never pkills by pattern.
#
#   servea-waiter.sh            one tick (what launchd runs)
#   servea-waiter.sh status     print the state and the last log lines
#   servea-waiter.sh set STATE  operator override (e.g. `set halt`, `set wait_head`)
#
# STATES (file ~/.servea-waiter/state; every transition is journalled on the canary host as run "servea" and paged)
#   install       servea-install.sh on the canary host between canaries (exit 75 = busy: retry next tick)
#   wait_head     servea-01 is next at the head (everything before it terminal), the slot is free, the fix installed
#   preflight     start the 5080 llama-server for the registration's alias; /health from the canary host; a 3-min
#                 load check at 16/min (servea-01's 10 bots x 1.33 x 1.2; servea-check.sh, with the LIVE-FLEET GUARD:
#                 the 5080-served fleet's p95 > 5 s for 2 min kills it) must pass p50 <= 2.5 s, p95 <= 5 s, >= 99 %
#                 valid; then `queue release servea-01`, VERIFIED (the hold must be gone on a re-read). A failed check
#                 stops the server and retries in 30 min, 3 tries.
#   canary        servea-01 runs (the server stays up). recorded KEEP + torn-down -> release llmoai-01; any other
#                 outcome -> stop the server, cancel llmoai-01 (the owner's rollout is conditional on the KEEP).
#   llmoai        llmoai-01 runs (inert client code). promoted -> rollout_wait; any other outcome -> stop, page.
#   rollout_wait  the Blackwell A/B's 05-model.conf drop-ins are gone, the slot is free, the server answers ->
#                 modelrollout.py run --run servea-01 --first-pools 4 from ~/servea-rollout (it takes the install-hold
#                 and the canary lock itself; REFUSED = retry next tick, 20 tries).
#   rollout       the stages run (ROLL_FLEET_GUARD on: the live-fleet guard during every stage's load test).
#                 complete -> done-complete (the 4B is the fleet's model; the server stays up).
#                 stopped / rolled-back with stages still rolled -> `rollback --all` (the 4B is the fleet model only if
#                 ALL stages pass); the server is stopped ONLY once the rollback is proven (state rolled-back, nothing
#                 rolled); a failed rollback keeps the server up and retries every tick, 5 tries, then halts (paged).
#                 refused -> back to rollout_wait; no state yet -> wait.
# Odd scheduler states (blocked/refused/...) must hold for 3 ticks (~9 min) before the waiter acts on them: a loop that
# canarywatch relaunches looks `blocked` for a moment. Warnings are paged at most once per 30 min per kind.
#   halt / done-*  terminal: nothing more happens until an operator `set`s a state.
set -u
W=$HOME/.servea-waiter; mkdir -p "$W"; LOG=$W/waiter.log
C31=mike@10.0.0.31; C72=root@10.0.0.72; SSH="ssh -o ConnectTimeout=15 -o BatchMode=yes"
# where transitions are recorded on the canary host (overridable for a dry run: SERVEA_NJ=/tmp/x SERVEA_NPG=/tmp/y)
NJ=${SERVEA_NJ:-/home/mike/canary-journal.jsonl}; NPG=${SERVEA_NPG:-/home/mike/digest/page.jsonl}
SRV='source /root/servea/env.sh; /root/servea/servea-llama.sh'
state () { cat "$W/state" 2>/dev/null || echo install; }
log () { echo "$(date -u +%FT%TZ) [$(state)] $*" >> "$LOG"; }
# one JSON line to the canary host's journal (run "servea") and page file (run "servea-roll"); the message goes in on
# stdin so no quoting can break the row (notes-break-the-manifest)
note () {  # note <level> <msg>
  log "$1: $2"
  printf '%s' "$2" | $SSH $C31 "NJ=$NJ NPG=$NPG LV=$1 python3 -c 'import json,os,sys,time
m=sys.stdin.read(); t=time.strftime(\"%Y-%m-%dT%H:%M:%SZ\",time.gmtime())
open(os.environ[\"NJ\"],\"a\").write(json.dumps({\"ts\":t,\"run\":\"servea\",\"phase\":\"waiter\",\"note\":m})+chr(10))
open(os.environ[\"NPG\"],\"a\").write(json.dumps({\"ts\":t,\"run\":\"servea-roll\",\"level\":os.environ[\"LV\"],\"msg\":m})+chr(10))'" 2>> "$LOG" || log "note failed"
}
go () { log "-> $1 ($2)"; echo "$1" > "$W/state"; note info "servea waiter: -> $1: $2"; }
warn () {  # warn <key> <msg>: page at most once per 30 min per key
  local f="$W/warned-$1"
  [ -f "$f" ] && [ $(( $(date +%s) - $(cat "$f") )) -lt 1800 ] && { log "warn(quiet) $1: $2"; return; }
  date +%s > "$f"; note warn "$2"
}
odd () {  # odd <key>: true once the same odd state has been seen on 3 ticks in a row (the count resets elsewhere)
  local n=$(( $(cat "$W/odd-$1" 2>/dev/null || echo 0) + 1 )); echo $n > "$W/odd-$1"; [ $n -ge 3 ]
}
q () { $SSH $C31 'python3 ~/servea/servea-q.py' < /dev/null 2>> "$LOG"; }
release_entry () {  # release_entry <run>: queue release, then PROVE the hold is gone on a fresh read
  local out; out=$($SSH $C31 "python3 ~/canary-sched.py queue release $1" < /dev/null 2>&1 | tail -1)
  local J2; J2=$(q)
  [ "$(qf "$J2" "next((e['held'] for e in d['entries'] if e['run']=='$1'), None)")" = False ] && { echo "$out"; return 0; }
  echo "$out"; return 1
}
qf () { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2], {}, {'d': d}))" "$1" "$2" 2>/dev/null; }
health () { $SSH $C31 "curl -sf -m 5 http://10.0.0.72:18080/health" < /dev/null > /dev/null 2>&1; }
# AUTOSTART on the 5080 = "the server should be up": servea-boot.service (5080) restarts it after a reboot while
# the file exists; stop_server removes it, so a stopped server stays stopped across reboots.
stop_server () { $SSH $C72 "rm -f /root/servea/AUTOSTART; $SRV stop" < /dev/null >> "$LOG" 2>&1; }

if [ "${1:-}" = status ]; then echo "state: $(state)"; tail -15 "$LOG" 2>/dev/null; exit 0; fi
if [ "${1:-}" = set ]; then echo "${2:?state}" > "$W/state"; log "operator set ${2}"; exit 0; fi

# one tick at a time (launchd does not overlap a job, this guards a hand run); a lock older than 2 h is stale
if ! mkdir "$W/lock.d" 2>/dev/null; then
  [ -n "$(find "$W/lock.d" -maxdepth 0 -mmin +120 2>/dev/null)" ] && rm -rf "$W/lock.d" && mkdir "$W/lock.d" || exit 0
fi
trap 'rm -rf "$W/lock.d"' EXIT

S=$(state)
case "$S" in halt|done-*) exit 0;; esac
J=$(q); [ -n "$J" ] && [ -z "$(qf "$J" "d.get('error','')")" ] || { log "canary host query failed: ${J:0:200}"; exit 0; }
phases () { qf "$J" "' | '.join(p[0]+':'+p[1][:40] for p in d['journal']['$1'])"; }
has () { qf "$J" "any(p[0]=='$2' and ('$3' in p[1]) for p in d['journal']['$1'])"; }
ent () { qf "$J" "next((e['$2'] for e in d['entries'] if e['run']=='$1'), None)"; }

case "$S" in
install)
  out=$($SSH $C31 'bash ~/servea/stage/servea-install.sh' < /dev/null 2>&1); rc=$?
  log "install rc=$rc: $(echo "$out" | tail -1)"
  if [ $rc -eq 0 ]; then go wait_head "probe fix installed: $(echo "$out" | tail -1)"
  elif [ $rc -ne 75 ]; then
    n=$(( $(cat "$W/install-fails" 2>/dev/null || echo 0) + 1 )); echo $n > "$W/install-fails"
    [ $n -ge 3 ] && go halt "servea-install.sh failed 3 times; last: $(echo "$out" | tail -1)" || note warn "servea-install.sh failed ($n/3): $(echo "$out" | tail -1)"
  fi ;;

wait_head)
  st=$(ent servea-01 state); held=$(ent servea-01 held)
  case "$st" in ready) rm -f "$W/odd-wait" ;;
    None|'') odd wait && go halt "servea-01 is not in the queue any more"; exit 0;;
    *) odd wait && go halt "servea-01 is $st before the waiter released it (someone else acted): a human decides"; exit 0;; esac
  if [ "$held" = False ]; then go preflight "servea-01 was released by someone else: start the server NOW"; exit 0; fi
  [ "$(qf "$J" "d['head_ready']['servea-01'] and not d['busy'] and d['installed']")" = True ] || exit 0
  [ -f "$W/retry-after" ] && [ "$(date +%s)" -lt "$(cat "$W/retry-after")" ] && exit 0
  go preflight "servea-01 is next at the head and the slot is free" ;;

preflight)
  # the registration servea-01 will launch with (the learning-loop agent may have replaced it): alias + endpoint
  R=$($SSH $C31 "python3 -c '
import json; q=json.load(open(\"/home/mike/canary-queue.json\")); e=[x for x in q[\"entries\"] if x[\"run\"]==\"servea-01\"][0]
r=json.load(open(list(e[\"variants\"].values())[0][\"registration\"])); env=dict(kv.split(\"=\",1) for kv in r[\"canary_env\"])
u=env.get(\"OLLAMA_BASE_URLS\",\"\").split(\",\")[0]
print(env.get(\"OLLAMA_MODEL\",\"\"), u.split(\"|\")[0], r.get(\"draw_k\"))'" < /dev/null 2>> "$LOG")
  set -- $R; ALIAS=${1:-}; EP=${2:-}; K=${3:-2}
  [ "$EP" = "oai+http://10.0.0.72:18080" ] || { go halt "servea-01's registration does not serve from the 5080 llama-server (first endpoint '$EP'): not this waiter's job"; exit 0; }
  echo "$ALIAS" | grep -Eq '^[A-Za-z0-9._-]+$' || { go halt "bad alias '$ALIAS'"; exit 0; }
  $SSH $C72 "test -f /root/servea/models/$ALIAS.gguf" < /dev/null || { go halt "no /root/servea/models/$ALIAS.gguf on the 5080 (copy the GGUF there under that name)"; exit 0; }
  health || $SSH $C72 "$SRV start /root/servea/models/$ALIAS.gguf $ALIAS 6 6144" < /dev/null >> "$LOG" 2>&1
  health || { stop_server; go halt "the 5080 llama-server for $ALIAS did not answer /health from the canary host"; exit 0; }
  $SSH $C72 "echo /root/servea/models/$ALIAS.gguf $ALIAS 6 6144 > /root/servea/AUTOSTART" < /dev/null >> "$LOG" 2>&1
  RATE=$(python3 -c "print(round($K*5*1.33*1.2))"); N=$((RATE * 3)); OFF=$(( $(date +%s) % 600 ))
  full=$($SSH $C31 "bash ~/servea/servea-check.sh $ALIAS $RATE $N $OFF" < /dev/null 2>&1)
  out=$(echo "$full" | tail -1); guard=$(echo "$full" | grep -m1 '^GUARD' || echo 'GUARD ?')
  ok=$(python3 -c "
import json,sys; l=sys.argv[1]; d=json.loads(l.split(' ',1)[1])
print(d['p50']<=2500 and d['p95']<=5000 and d['valid_share']>=0.99 and d['n']>=$N)" "$out" 2>/dev/null)
  [ "$guard" = "GUARD OK" ] || ok=False
  log "load check $RATE/min: $guard :: $out"
  if [ "$ok" = True ]; then
    # ONCE A RELEASE IS ATTEMPTED the canary may launch at the next scheduler tick, so the waiter moves on and the
    # server stays up whatever the verification says (Codex r2); `canary` reconciles an entry that is still held.
    rel=$(release_entry servea-01) && v=verified || v="NOT verified yet (canary reconciles)"
    rm -f "$W/retry-after" "$W/preflight-fails" "$W/release-fails"
    go canary "load check PASS at $RATE/min on $ALIAS ($(echo "$out" | cut -c1-160)); release $v: $rel"
  else
    stop_server
    n=$(( $(cat "$W/preflight-fails" 2>/dev/null || echo 0) + 1 )); echo $n > "$W/preflight-fails"
    if [ $n -ge 3 ]; then go halt "load check FAILED 3 times at $RATE/min; last: $(echo "$out" | cut -c1-200)"
    else echo $(( $(date +%s) + 1800 )) > "$W/retry-after"; go wait_head "load check FAILED ($n/3) at $RATE/min ($guard), server stopped, retry in 30 min: $(echo "$out" | cut -c1-200)"; fi
  fi ;;

canary)
  health || warn health "servea-01 is running and the 5080 llama-server does not answer /health (the bots fall back to qwen2.5; the supervisor restarts a crash)"
  st=$(ent servea-01 state)
  case "$st" in
    refused|blocked|cancelled|abandoned)
      odd canary && { stop_server; go halt "servea-01 has been $st for 3 ticks: server stopped; a human decides (llmoai-01 stays held)"; }
      exit 0 ;;
    None|'') odd gone && warn gone "servea-01 is not in the queue any more (canary state): the server stays up; a human decides"; exit 0 ;;
    *) rm -f "$W/odd-canary" ;;
  esac
  # a release whose verification failed (or that did not take): re-issue it every 3rd tick; the server stays UP
  if [ "$st" = ready ] && [ "$(ent servea-01 held)" = True ]; then
    if odd held-servea; then
      rm -f "$W/odd-held-servea"
      n=$(( $(cat "$W/release-fails" 2>/dev/null || echo 0) + 1 )); echo $n > "$W/release-fails"
      rel=$(release_entry servea-01) || { [ $n -ge 3 ] && go halt "servea-01 is still HELD after 3 releases ($rel): the 5080 server stays up; a human decides" \
                                          || warn release "servea-01 is still held; release re-issued ($n/3): $rel"; }
    fi
    exit 0
  fi
  rm -f "$W/odd-held-servea"
  if [ "$(has servea-01 recorded KEEP)" = True ] && [ "$(has servea-01 torn-down '')" = True ]; then
    rel=$(release_entry llmoai-01) && v=verified || v="NOT verified yet (llmoai reconciles)"
    rm -f "$W/release-fails"
    go llmoai "servea-01 KEPT (the 4B on the 5080, 10 bots): llmoai-01 release $v ($rel); the 5080 server stays up"
  elif [ "$(has servea-01 recorded '')" = True ] && [ "$(has servea-01 torn-down '')" = True ]; then
    stop_server
    can=$($SSH $C31 "python3 ~/canary-sched.py queue cancel llmoai-01 'servea-01 was not KEPT; OWNER 11-02: the rollout is conditional on the KEEP'" < /dev/null 2>&1 | tail -1)
    go done-notkept "servea-01 closed without a KEEP ($(phases servea-01 | tail -c 160)): server stopped, llmoai-01 cancelled ($can)"
  fi ;;

llmoai)
  health || warn health "llmoai-01 phase: the 5080 llama-server does not answer /health"
  if [ "$(has llmoai-01 promoted '')" = True ]; then
    go rollout_wait "llmoai-01 KEPT and promoted: the fleet's code speaks oai+"
  elif [ "$(has llmoai-01 recorded '')" = True ] && [ "$(has llmoai-01 torn-down '')" = True ]; then
    stop_server; go done-notkept "llmoai-01 closed without a promotion ($(phases llmoai-01 | tail -c 160)): server stopped; no rollout"
  else
    st=$(ent llmoai-01 state)
    case "$st" in
      refused|blocked|cancelled|abandoned) odd llmoai && { stop_server; go halt "llmoai-01 has been $st for 3 ticks: server stopped; a human decides"; } ;;
      None|'') odd gone && warn gone "llmoai-01 is not in the queue any more (llmoai state): the server stays up; a human decides" ;;
      ready) rm -f "$W/odd-llmoai"
        if [ "$(ent llmoai-01 held)" = True ] && odd held-llmoai; then
          rm -f "$W/odd-held-llmoai"
          n=$(( $(cat "$W/release-fails" 2>/dev/null || echo 0) + 1 )); echo $n > "$W/release-fails"
          rel=$(release_entry llmoai-01) || { [ $n -ge 3 ] && go halt "llmoai-01 is still HELD after 3 releases ($rel); the server stays up" \
                                              || warn release "llmoai-01 is still held; release re-issued ($n/3): $rel"; }
        fi ;;
      *) rm -f "$W/odd-llmoai" "$W/odd-held-llmoai" ;;
    esac
  fi ;;

rollout_wait)
  rs=$(qf "$J" "d['roll']['status']")
  if [ "$rs" = running ]; then rm -f "$W/roll-tries"; go rollout "modelrollout run started"; exit 0; fi
  [ "$(qf "$J" "d['model_dropins']")" = 0 ] || { log "waiting: 05-model.conf drop-ins exist ($(qf "$J" "d['model_dropins']"); the Blackwell A/B)"; exit 0; }
  [ "$(qf "$J" "d['busy']")" = False ] || exit 0
  health || { warn health "rollout_wait: the 5080 llama-server does not answer; not starting the rollout"; exit 0; }
  n=$(( $(cat "$W/roll-tries" 2>/dev/null || echo 0) + 1 )); echo $n > "$W/roll-tries"
  [ $n -gt 20 ] && { go halt "modelrollout run was REFUSED 20 times (see ~/servea-rollout/run.log on the canary host); the server stays up"; exit 0; }
  $SSH $C31 'cd ~/servea-rollout && ROLL_HOME=$HOME/servea-rollout/state ROLL_ITEMS=$HOME/servea/live-pc.jsonl ROLL_FLEET_GUARD=10.0.0.72 nohup python3 -B modelrollout.py run --run servea-01 --first-pools 4 >> run.log 2>&1 < /dev/null & echo started' < /dev/null >> "$LOG" 2>&1
  log "modelrollout run launched (try $n); the next tick reads its state" ;;

rollout)
  rs=$(qf "$J" "d['roll']['status']"); alive=$(qf "$J" "d['roll']['pid_alive']")
  live=$(qf "$J" "sum(1 for s in d['roll']['stages'] if s[0] in ('applying','applied','passed','rollback-unproven'))")
  health || warn health "the 5080 llama-server does not answer /health during the rollout (bots fall back to qwen2.5; the rollout's own polls decide)"
  RB='cd ~/servea-rollout && ROLL_HOME=$HOME/servea-rollout/state python3 -B modelrollout.py'
  case "$rs" in
    running) [ "$alive" = True ] || warn dead "modelrollout says running but its process is gone: in ~/servea-rollout (ROLL_HOME=~/servea-rollout/state) \`run --resume\` or \`rollback --all\`" ;;
    complete) go done-complete "ALL STAGES PASSED: the round-3 4B on the 5080 is the fleet's model (80 bots, per-decision fallback qwen2.5); the server stays up" ;;
    refused) go rollout_wait "modelrollout run refused (a lock race): back to waiting" ;;
    None|'') odd nostate && warn nostate "rollout state: no state file for 3+ ticks after the run started (~/servea-rollout/state/state.json); check ~/servea-rollout/run.log" || log "no rollout state yet" ;;
    *) if [ "${live:-1}" = 0 ]; then
         stop_server; rm -f "$W/rb-tries"; go done-stopped "the rollout ended '$rs' with nothing rolled (rollback proven by the rollout): server stopped"
       else
         n=$(( $(cat "$W/rb-tries" 2>/dev/null || echo 0) + 1 )); echo $n > "$W/rb-tries"
         out=$($SSH $C31 "$RB rollback --all --run servea-01" < /dev/null 2>&1 | tail -2 | tr '\n' ' ')
         if [ $n -ge 5 ]; then go halt "the rollout STOPPED ($rs) with $live stage(s) rolled and rollback --all has not been proven after 5 tries: the 5080 server STAYS UP (bots on the 4B need it; qwen2.5 is their fallback); last: $out"
         else warn rollback "the rollout STOPPED ($rs) with $live stage(s) rolled: rollback --all try $n (the 4B is the fleet model only if ALL stages pass); the server stays up until the rollback is proven: $out"; fi
       fi ;;
  esac ;;
esac
exit 0
