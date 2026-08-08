#!/usr/bin/env bash
# ab-model.sh -- run a concurrent A/B of the tactical decision model.
#
#   ./scripts/ab-model.sh start     assign arms and restart the fleet
#   ./scripts/ab-model.sh status    show which bot is in which arm
#   ./scripts/ab-model.sh stop      put every bot back on the control model
#
# DESIGN NOTES, because the point of this is evidence and the ways to get it
# wrong are not obvious:
#
# CONCURRENT, NOT SEQUENTIAL. The textbook design is identical world seeds per
# arm, which is not available here: this is one persistent world holding a
# colony that has been mined for days, and resetting it destroys the thing under
# study. Running both arms at the same wall-clock time in the same world
# controls for world state BETTER than sequential runs on fresh seeds -- both
# arms see the same weather, the same terrain, the same peers, the same server
# load.
#
# ONLY THE MODEL CHANGES. OLLAMA_BASE_URLS is deliberately left alone, so both
# arms use the same endpoint pool in the same order. Putting the 7B on the local
# 5080 and the 14B on the Mac would confound model size with hardware and
# network path, and any difference would be uninterpretable. The 5080 latency
# advantage is real and already measured; it is not what this experiment asks.
#
# ENDPOINT POOL EXCLUDES 10.0.0.72. That host runs a public-facing honeypot on a
# pinned model, and Ollama will evict a pinned model to make room: a control-arm
# bot failing over there loaded qwen2.5:14b-instruct and left 1.8GB free, having
# already evicted the honeypot's model once earlier the same day. The bots use
# the Studio and the mini only. Found by the GPU/model-residency telemetry
# within a minute of it existing.
#
# ROLE-PAIRED. Roles have different milestone chains, so comparing a scout
# against a miner measures the chain, not the model. Arms are paired within
# role: gatherer vs gather2, scout vs scout2. Miner01 is the only miner, so it
# stays on control and is EXCLUDED from the paired comparison -- recorded here
# rather than quietly averaged in.

set -euo pipefail

BOT_HOST="${BOT_HOST:-10.0.0.187}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
SSH="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=10 mike@$BOT_HOST"

CONTROL_MODEL="qwen2.5:14b-instruct"
TREATMENT_MODEL="qwen2.5:7b-instruct"

TREATMENT_INSTANCES="gatherer scout"          # arm A
CONTROL_INSTANCES="gather2 scout2 miner"      # arm B (miner unpaired)
ALL_INSTANCES="gatherer scout gather2 scout2 miner"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

set_model() {   # set_model <instance> <model>
  $SSH "sudo sed -i 's|^OLLAMA_MODEL=.*|OLLAMA_MODEL=$2|' /srv/mcbots/harness/env/$1.env"
}

case "${1:-status}" in
  start)
    say "Assigning arms"
    for i in $TREATMENT_INSTANCES; do set_model "$i" "$TREATMENT_MODEL"; echo "   A (treatment) $i -> $TREATMENT_MODEL"; done
    for i in $CONTROL_INSTANCES;   do set_model "$i" "$CONTROL_MODEL";   echo "   B (control)   $i -> $CONTROL_MODEL"; done

    say "Restarting fleet"
    for i in $ALL_INSTANCES; do $SSH "sudo systemctl restart mcbot@$i"; sleep 4; done
    sleep 15
    $SSH "for i in $ALL_INSTANCES; do printf '   %-9s %s\n' \"\$i\" \"\$(systemctl is-active mcbot@\$i)\"; done"

    # Stamp the start so the analysis window is not guesswork later.
    $SSH "date -u +'%Y-%m-%dT%H:%M:%SZ' | sudo tee /srv/mcbots/state/ab-started.txt >/dev/null"
    say "Started at $($SSH 'cat /srv/mcbots/state/ab-started.txt')"
    echo "   analyse with: ./scripts/ab-report.sh"
    ;;

  stop)
    say "Reverting every bot to the control model"
    for i in $ALL_INSTANCES; do set_model "$i" "$CONTROL_MODEL"; done
    for i in $ALL_INSTANCES; do $SSH "sudo systemctl restart mcbot@$i"; sleep 4; done
    echo "   all instances back on $CONTROL_MODEL"
    ;;

  status)
    say "Arm assignment"
    $SSH "for i in $ALL_INSTANCES; do printf '   %-9s %-24s %s\n' \"\$i\" \"\$(sudo grep -h '^OLLAMA_MODEL=' /srv/mcbots/harness/env/\$i.env | cut -d= -f2)\" \"\$(systemctl is-active mcbot@\$i)\"; done"
    $SSH "test -f /srv/mcbots/state/ab-started.txt && echo \"   started: \$(cat /srv/mcbots/state/ab-started.txt)\" || echo '   not started'"
    ;;

  *) echo "usage: $0 {start|status|stop}"; exit 1 ;;
esac
