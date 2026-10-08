#!/bin/bash
# backtest.sh <name> <run> <M|poll> <T_iso> <exclude_pools|-> <base_sha> <pools> <declared_at> [reads...]
# Replays canary <run>'s registered reads + verdict.py at minute M, as of instant T, in a private mount namespace:
#   /var/log/mcai            -> a time-travel copy truncated at T (ttbuild.py), MINUS the bot dirs of <exclude_pools>
#   /srv/mcbots/trial-manifest.json -> a reconstructed single-canary manifest (run, base, pools, declared_at, sha)
#   clock                    -> frozen at T (fakeclock/sitecustomize.py via PYTHONPATH)
#   HOME                     -> a fixture home (evidence objects land there, never in ~/digest/reads)
# Nothing live is written: the live manifest, logs, journal and reads dir are only READ (bind mounts are private to the
# namespace and vanish with it). Prints the verdict line.
set -u
NAME=$1; RUN=$2; M=$3; T=$4; EXCL=$5; BASE=$6; POOLS=$7; DECL=$8; shift 8
W=$HOME/lanes-work; V=$W/views/$NAME; TT=$W/tt/$(echo "$T" | tr -dc '0-9')
FROM=$(python3 -c "import datetime as d,sys; print((d.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00'))-d.timedelta(hours=30)).isoformat())" "$T")
nice -n 19 python3 $W/ttbuild.py "$T" "$FROM" "$TT" >&2 || exit 2
rm -rf "$V"; mkdir -p "$V/logs" "$V/home/digest/reads" "$V/regs"
for d in "$TT"/*/; do
  b=$(basename "$d"); p=${b%-*}
  case ",$EXCL," in *",$p,"*) continue;; esac
  ln -s "$TT/$b" "$V/logs/$b"
done
# copies, not symlinks: a link into /var/log/mcai would point into the overmounted view itself (Codex r1, A3)
for f in /var/log/mcai/_*; do [ -f "$f" ] && cp "$f" "$V/logs/$(basename "$f")"; done
ln -s $HOME/readjson.py "$V/home/readjson.py"; ln -s $HOME/mcai-analysis "$V/home/mcai-analysis"
ln -s $HOME/digest/RULE.md "$V/home/digest/RULE.md"; ln -s $HOME/digest/RULES-IN-FORCE.md "$V/home/digest/RULES-IN-FORCE.md"
cp $HOME/mcai-analysis/registrations/$RUN.json "$V/regs/$RUN.json"
SHA=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sha'])" "$V/regs/$RUN.json")
[ $# -gt 0 ] || set -- $(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))['reads']))" "$V/regs/$RUN.json")
python3 - "$V/manifest.json" "$RUN" "$BASE" "$DECL" "$POOLS" "$SHA" <<'PY'
import json, sys
p, run, base, decl, pools, sha = sys.argv[1:]
json.dump({'trial': 'instance-1', 'run_id': run, 'declared_code_version': base, 'declared_at': decl,
           'canary_pool': pools, 'canary_code_version': sha, 'notes': 'backtest'}, open(p, 'w'), indent=2)
PY
python3 - "$V/home/canary-journal.jsonl" "$T" <<'PY'
import json, sys
out, T = sys.argv[1], sys.argv[2][:19]
with open(out, 'w') as w:
    for l in open('/home/mike/canary-journal.jsonl'):
        try:
            if json.loads(l)['ts'][:19] <= T: w.write(l)
        except Exception: pass
PY
VFLAG=""; MM=$M; [ "$M" = poll ] && { VFLAG="--poll"; MM=0; }
{ echo "cd /opt/minecraft-ai/scripts"
  if [ "$M" != poll ]; then
    for s in "$@"; do echo "timeout 900 python3 /tmp/$s.py $MM > $V/out-$s.txt 2>&1 || echo 'read $s failed' >&2"; done
  else
    # the live poll reads the newest immobiledid artifact (the last scheduled read's); take it at T
    echo "timeout 900 python3 /tmp/immobiledid.py 180 > $V/out-immobiledid.txt 2>&1 || echo 'read immobiledid failed' >&2"
  fi
  echo "python3 /home/mike/verdict.py $RUN $MM $VFLAG 2>$V/verdict.err | tail -1"; } > "$V/inner.sh"
sudo -n unshare -m --propagation private bash -c "mount --bind '$V/logs' /var/log/mcai && mount --bind '$V/manifest.json' /srv/mcbots/trial-manifest.json || exit 9
exec setpriv --reuid=mike --regid=mike --init-groups env -i PATH=/usr/bin:/bin HOME='$V/home' PYTHONPATH='$W/fakeclock' LANE_FAKE_NOW='$T' VERDICT_READS_DIR='$V/home/digest/reads' VERDICT_REG_DIR='$V/regs' VERDICT_JOURNAL='$V/home/canary-journal.jsonl' bash '$V/inner.sh'"
