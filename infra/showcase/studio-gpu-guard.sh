# ON THE STUDIO: ~/showcase/studio-gpu-guard.sh, SOURCED by every Studio GPU consumer that is not the showcase
# (mbench's run_model.sh and lms_factor.sh; a future brain canary's launch). Design: showcase-2026-10-20.md s.2.
#
#   . ~/showcase/studio-gpu-guard.sh && showcase_gpu_acquire "mbench-$LABEL" || exit 1
#   trap showcase_gpu_release EXIT
#
# acquire drops a UNIQUELY named file in ~/showcase/pause.d (the showcase proxy then answers 503 to everything, finishes what is in
# flight, waits its grace, unloads the fallback model it loaded) and WAITS for ~/showcase/QUIESCED to NAME it (`RESV <token>`;
# the ack is built from the reservation set the proxy validated, so it cannot name a later one; no mtime test: the
# Studio's bash 3.2 compares -nt in whole seconds). No proxy running = nothing to wait
# for (the guard says so and proceeds). A proxy that never acknowledges = refuse, with the remedy.
SHOWCASE_PAUSE_DIR=${SHOWCASE_PAUSE_DIR:-$HOME/showcase/pause.d}
SHOWCASE_QUIESCED=${SHOWCASE_QUIESCED:-$HOME/showcase/QUIESCED}
SHOWCASE_PAUSE_FILE=""

# No proxy is running: nothing of the showcase's is in flight. Before this consumer touches the GPU, unload the fallback
# model a dead proxy may have left resident (keep_alive 0; the consumer has loaded nothing yet, it waits for this), then
# persist the HANDOFF marker so a proxy that launchd restarts mid-run restores the handoff and never unloads the
# consumer's models. A marker that cannot be written = refuse (the restart case would otherwise be unprotected).
_showcase_handoff_without_proxy() {
  curl -s -m 15 -o /dev/null http://127.0.0.1:11434/api/generate \
    -d '{"model": "qwen2.5:7b-instruct", "keep_alive": 0}' 2>/dev/null || true
  if ! { mkdir -p "$(dirname "$SHOWCASE_QUIESCED")" && date -u +%FT%TZ > "$SHOWCASE_QUIESCED.handoff"; }; then
    echo "showcase guard: REFUSING -- no proxy running and the handoff marker $SHOWCASE_QUIESCED.handoff cannot be" \
         "written. Remedy: check ~/showcase (permissions, disk) and rerun." >&2
    return 1
  fi
  echo "showcase guard: no showcase proxy running -- nothing to quiesce (fallback unloaded, handoff marker written)"
}

showcase_gpu_acquire() {
  local label=${1:-gpu} waited=0 max=${SHOWCASE_QUIESCE_WAIT_S:-180}
  mkdir -p "$SHOWCASE_PAUSE_DIR"
  SHOWCASE_PAUSE_FILE="$SHOWCASE_PAUSE_DIR/$label-$$-$(date +%s)"   # unique: the ack is matched on this token alone
  date -u +%FT%TZ > "$SHOWCASE_PAUSE_FILE"
  if ! pgrep -f 'showcaseproxy[.]py' >/dev/null 2>&1; then
    # No proxy running: nothing to quiesce NOW -- but launchd may restart it mid-run. Persist the HANDOFF marker so a
    # restarting proxy restores the handoff (never unloads this run's models); a stale marker with no pause is removed
    # by the proxy at startup.
    _showcase_handoff_without_proxy || return 1
    return 0
  fi
  while [ "$waited" -lt "$max" ]; do
    if [ -e "$SHOWCASE_QUIESCED" ] && grep -qxF "RESV $(basename "$SHOWCASE_PAUSE_FILE")" "$SHOWCASE_QUIESCED"; then
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
    # No proxy running: nothing to quiesce NOW -- but launchd may restart it mid-run. Persist the HANDOFF marker so a
    # restarting proxy restores the handoff (never unloads this run's models); a stale marker with no pause is removed
    # by the proxy at startup.
    _showcase_handoff_without_proxy || return 1
    return 0
  fi
  while [ "$waited" -lt "$max" ]; do
    if [ -e "$SHOWCASE_QUIESCED" ] && grep -qxF "RESV $(head -n 1 "$resv" 2>/dev/null)" "$SHOWCASE_QUIESCED"; then
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
