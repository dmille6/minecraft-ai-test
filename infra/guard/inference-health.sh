#!/usr/bin/env bash
# inference-health.sh -- notice when Ollama is WEDGED, not merely busy, and
# restart it. Runs ON the inference host, so the restart needs no SSH hop.
#
# WHY THIS EXISTS. Twice on 2026-08-10 the endpoint entered a state it never
# recovered from on its own:
#
#     GPU utilisation 0%, our model absent from /api/ps, only the pinned
#     qwen2.5-coder:7b resident, and every request answered in ~80ms with
#     503 {"error":"server busy, please try again. maximum pending requests
#     exceeded"}
#
# The second time it lasted 90 minutes and produced 519 rejections. Ten bots
# went on deciding into a void the whole time. Nothing noticed, because every
# dashboard was watching SKILL metrics -- and a fleet whose inference is dead
# looks exactly like a fleet that is bad at its job.
#
# BUSY IS NOT WEDGED, and the difference decides whether restarting is right:
#   busy   -- requests complete, slowly. The GPU is doing work.
#   wedged -- requests are refused instantly or never return, the GPU is idle,
#             and the queue drains at zero. It does not resolve with time.
# So the probe is a real generation request with a generous timeout. Anything
# that answers is healthy, however slow. Only silence or refusal counts.
#
# It restarts rather than alerting because the cost is asymmetric: a restart
# costs a few seconds of a shared host, and NOT restarting cost 90 minutes of
# ten bots' work. The cooldown below is what stops that judgement running away.
set -uo pipefail

HOST="${OLLAMA_HOST_URL:-http://localhost:11434}"
MODEL="${PROBE_MODEL:-qwen2.5:7b-instruct}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-45}"      # generous: slow is healthy
STATE="${STATE_FILE:-/var/lib/mcai-inference-health}"
FAILS_BEFORE_ACTION="${FAILS_BEFORE_ACTION:-2}"   # ~2 consecutive checks
RESTART_COOLDOWN="${RESTART_COOLDOWN:-900}"       # never more than once per 15m
DRY_RUN="${DRY_RUN:-0}"
SIMULATE_FAIL="${SIMULATE_FAIL:-0}"

mkdir -p "$STATE"
FAIL_FILE="$STATE/consecutive_failures"
LAST_RESTART="$STATE/last_restart_epoch"
now=$(date +%s)
say() { echo "[$(date -u +%H:%M:%SZ)] $*"; }

# ---------------------------------------------------------------- the probe --
# A real generation, not /api/tags or /api/ps. Those answer instantly from
# memory while the scheduler is deadlocked -- during both incidents /api/ps
# returned 200 in 31 MICROseconds while every chat request was being refused.
# Only asking the model to actually produce a token proves the path works.
probe() {
  [ "$SIMULATE_FAIL" = "1" ] && return 1
  local code
  code=$(curl -s -o /tmp/.inference-probe.json -w '%{http_code}' \
         --max-time "$PROBE_TIMEOUT" \
         "$HOST/api/chat" \
         -d "{\"model\":\"$MODEL\",\"stream\":false,\"keep_alive\":-1,
              \"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],
              \"options\":{\"num_predict\":1}}" 2>/dev/null)
  [ "$code" = "200" ] && grep -q '"message"' /tmp/.inference-probe.json 2>/dev/null
}

if probe; then
  prev=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
  [ "${prev:-0}" -gt 0 ] && say "healthy again after $prev failed check(s)"
  echo 0 > "$FAIL_FILE"
  exit 0
fi

# ------------------------------------------------------------- not answering --
fails=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$FAIL_FILE"
say "probe FAILED ($fails consecutive) model=$MODEL"

# One failure is a blip -- a model load, a burst, a dropped packet. Requiring
# consecutive failures is what separates a hiccup from the wedge.
if [ "$fails" -lt "$FAILS_BEFORE_ACTION" ]; then
  say "below the action threshold ($FAILS_BEFORE_ACTION); waiting for the next check"
  exit 0
fi

last=$(cat "$LAST_RESTART" 2>/dev/null || echo 0)
since=$(( now - last ))
if [ "$since" -lt "$RESTART_COOLDOWN" ]; then
  # Restarting again would not be a fix, it would be a loop. Say so loudly:
  # if the endpoint is still dead after a restart, the cause is not the wedge
  # this script knows how to clear, and a human needs to look.
  say "ALREADY RESTARTED ${since}s ago (cooldown ${RESTART_COOLDOWN}s) and it is STILL failing"
  say "this is not the scheduler wedge -- escalate, do not restart again"
  exit 2
fi

# --------------------------------------------------------------- the remedy --
say "restarting ollama (idle GPU + refused requests is the wedge signature)"
if [ "$DRY_RUN" = "1" ]; then
  say "DRY_RUN: would have restarted ollama"
  exit 0
fi
echo "$now" > "$LAST_RESTART"
systemctl restart ollama || { say "RESTART FAILED"; exit 3; }
sleep 15

# A restart that did not fix it must not be recorded as a fix.
if probe; then
  say "recovered: model answers again"
  echo 0 > "$FAIL_FILE"
  exit 0
fi
say "STILL FAILING after restart -- escalate"
exit 2
