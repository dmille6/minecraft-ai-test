# ON THE STUDIO: ~/showcase/studio-gpu-guard.sh, SOURCED by every Studio GPU consumer that is not the showcase
# (mbench's run_model.sh and lms_factor.sh; a future brain canary's launch). Design: showcase-2026-10-20.md s.2.
#
#   . ~/showcase/studio-gpu-guard.sh && showcase_gpu_acquire "mbench-$LABEL" || exit 1
#   trap showcase_gpu_release EXIT
#
# acquire drops a file in ~/showcase/pause.d (the showcase proxy then answers 503 to everything, finishes what is in
# flight, waits its grace, unloads the fallback model it loaded) and WAITS for ~/showcase/QUIESCED to be newer than
# that file -- an acknowledgement given after this reservation, not a stale one. No proxy running = nothing to wait
# for (the guard says so and proceeds). A proxy that never acknowledges = refuse, with the remedy.
SHOWCASE_PAUSE_DIR=${SHOWCASE_PAUSE_DIR:-$HOME/showcase/pause.d}
SHOWCASE_QUIESCED=${SHOWCASE_QUIESCED:-$HOME/showcase/QUIESCED}
SHOWCASE_PAUSE_FILE=""

showcase_gpu_acquire() {
  local label=${1:-gpu} waited=0 max=${SHOWCASE_QUIESCE_WAIT_S:-180}
  mkdir -p "$SHOWCASE_PAUSE_DIR"
  SHOWCASE_PAUSE_FILE="$SHOWCASE_PAUSE_DIR/$label-$$"
  date -u +%FT%TZ > "$SHOWCASE_PAUSE_FILE"
  if ! pgrep -f 'showcaseproxy[.]py' >/dev/null 2>&1; then
    echo "showcase guard: no showcase proxy running -- nothing to quiesce"; return 0
  fi
  while [ "$waited" -lt "$max" ]; do
    if [ -e "$SHOWCASE_QUIESCED" ] && [ "$SHOWCASE_QUIESCED" -nt "$SHOWCASE_PAUSE_FILE" ] && grep -qxF "RESV $(basename "$SHOWCASE_PAUSE_FILE")" "$SHOWCASE_QUIESCED"; then
      echo "showcase guard: showcase quiesced ($(cat "$SHOWCASE_QUIESCED")) after ${waited}s"; return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  echo "showcase guard: REFUSING -- the showcase proxy did not acknowledge a pause within ${max}s." \
       "Remedy: check ~/showcase/proxy.jsonl and 'launchctl print gui/$(id -u)/com.mcai.showcase.proxy';" \
       "or stop it (launchctl bootout gui/$(id -u)/com.mcai.showcase.proxy) and rerun. The proxy last said:" \
       "$(tail -n 3 ~/showcase/proxy.jsonl 2>/dev/null | tr "\n" " ")" >&2
  rm -f "$SHOWCASE_PAUSE_FILE"; SHOWCASE_PAUSE_FILE=""
  return 1
}

# For a consumer that already holds ~/mbench/out/GPU_RESERVED (run_model.sh, lms_factor.sh): the proxy pauses on that
# file itself; this only WAITS for an acknowledgement newer than the reservation. Returns 1 (refuse) on timeout.
showcase_await_quiesced() {
  local resv=${1:?reservation file} waited=0 max=${SHOWCASE_QUIESCE_WAIT_S:-180}
  if ! pgrep -f 'showcaseproxy[.]py' >/dev/null 2>&1; then
    echo "showcase guard: no showcase proxy running -- nothing to quiesce"; return 0
  fi
  while [ "$waited" -lt "$max" ]; do
    if [ -e "$SHOWCASE_QUIESCED" ] && [ "$SHOWCASE_QUIESCED" -nt "$resv" ] && grep -qxF "RESV $(head -n 1 "$resv" 2>/dev/null)" "$SHOWCASE_QUIESCED"; then
      echo "showcase guard: showcase quiesced ($(cat "$SHOWCASE_QUIESCED")) after ${waited}s"; return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  echo "showcase guard: REFUSING -- no showcase pause acknowledgement within ${max}s of $resv." \
       "Remedy: check ~/showcase/proxy.jsonl; or stop the proxy (launchctl bootout gui/$(id -u)/com.mcai.showcase.proxy)" \
       "and rerun. The proxy last said (ack-withheld = another Ollama client holds the fallback model):" \
       "$(tail -n 3 ~/showcase/proxy.jsonl 2>/dev/null | tr "\n" " ")" >&2
  return 1
}

showcase_gpu_release() {
  [ -n "$SHOWCASE_PAUSE_FILE" ] && rm -f "$SHOWCASE_PAUSE_FILE"
  SHOWCASE_PAUSE_FILE=""
}
