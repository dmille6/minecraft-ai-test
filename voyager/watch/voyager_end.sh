#!/bin/bash
# voyager-01: the scheduled reads and the end of the 48-h run (design §8-9). Run as root on the worlds host.
#   voyager_end.sh day <N> <since-ISO>   write /srv/voyager/reports/day-<N>.txt (+ .json) from voyager_metrics.py
#   voyager_end.sh end <since-ISO>       the success-bar read: final metrics, then stop every voyager bot and server,
#                                        and unload the pilot's models (Studio three, Blackwell coder:32b only)
set -u
R=/srv/voyager/reports; mkdir -p "$R"
M=/srv/voyager/code/voyager/watch/voyager_metrics.py
case "$1" in
day)
  python3 "$M" --since "$3" --arms a,b,c,ctl > "$R/day-$2.txt" 2>&1
  python3 "$M" --since "$3" --arms a,b,c,ctl --json > "$R/day-$2.json" 2>&1 ;;
end)
  python3 "$M" --since "$2" --arms a,b,c,ctl > "$R/final.txt" 2>&1
  python3 "$M" --since "$2" --arms a,b,c,ctl --json > "$R/final.json" 2>&1
  rm -f /srv/voyager/RUNNING-*
  for a in a b c ctl; do systemctl stop "voyager-bot@$a"; done
  for a in a b c ctl; do systemctl stop "voyager-paper@$a"; done
  # unload ONLY a model that is resident: keep_alive 0 on a model that is not loaded makes Ollama LOAD it first (which on
  # the Blackwell could evict someone else's pinned model). Studio: the pilot's three; Blackwell: qwen2.5-coder:32b ONLY.
  unload () {   # host model
    if curl -s -m 10 "$1/api/ps" | python3 -c "import sys,json; sys.exit(0 if any(m['name']=='$2' for m in json.load(sys.stdin)['models']) else 1)"; then
      curl -s -m 30 "$1/api/generate" -d "{\"model\":\"$2\",\"keep_alive\":0}" > /dev/null && echo "unloaded $2 on $1"
    else echo "not resident: $2 on $1 (nothing sent)"; fi
  }
  { for m in qwen3.6:35b-a3b qwen2.5-coder:32b qwen2.5:7b-instruct; do unload http://ai.ticrcorp.com:11436 "$m"; done
    unload http://ai.ticrcorp.com:11438 qwen2.5-coder:32b; } > "$R/unload.txt" 2>&1
  curl -s -m 10 http://ai.ticrcorp.com:11436/api/ps > "$R/studio-ps-after.json"
  curl -s -m 10 http://ai.ticrcorp.com:11438/api/ps > "$R/blackwell-ps-after.json"
  date -u +%FT%TZ > "$R/ENDED" ;;
esac
