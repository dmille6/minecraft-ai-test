#!/bin/bash
# Runs out/queue.txt top to bottom, one model at a time; a line is "engine model label brain-think slow-think [args]".
# Polls for appended lines; touch out/STOP to stop after the current model. Done labels go to out/done.txt.
cd "$(dirname "$0")"
touch out/done.txt
while [ ! -e out/STOP ]; do
  line=$(while read -r e m l b s rest; do [ -z "$e" ] || [[ "$e" == \#* ]] && continue; grep -qx "$l" out/done.txt || { echo "$e $m $l $b $s $rest"; break; }; done < out/queue.txt)
  if [ -z "$line" ]; then sleep 60; continue; fi
  set -- $line
  ./run_model.sh "$@"
  echo "$3" >> out/done.txt
done
echo "queue stopped $(date -u +%FT%TZ)" >> out/driver.log
