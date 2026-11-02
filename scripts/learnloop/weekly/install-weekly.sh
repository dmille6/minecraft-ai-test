#!/bin/bash
# install-weekly.sh -- install (or update) the learning loop's WEEKLY pipeline. Run FROM THE MAC in a clean checkout of the
# commit being installed:   bash scripts/learnloop/weekly/install-weekly.sh [--dry-run]
#
#   10.0.0.31  ~/learnloop/r3/app/{scripts/{learnloop,lib,host/batchload.mjs},bench/models/score.py,config/learnloop-weekly.json}
#              ~/.ssh/id_llgpu (created once)                 the ONLY key that reaches the 3090, forced command below
#              crontab: */10 * * * *  weekly.py tick         (nice 19; log ~/learnloop/weekly-cron.log)
#   10.0.0.16  ~/learnloop-train/r3/{llgpu.sh,export_lora_gguf.py,train_sft.py}
#              ~/.ssh/authorized_keys += restrict,from="10.0.0.31",command="~/learnloop-train/r3/llgpu.sh --ssh" <key>
#   Mac        ~/Library/LaunchAgents/com.mcai.learnloop-referee.plist   referee.py tick every 6 h (paid referee, eval only)
# Idempotent. Tests gate the install. Never touches ~/ethan-gpu, the Blackwell or 10.0.0.72.
set -euo pipefail
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse HEAD)
[ -z "$(git status --porcelain scripts/learnloop scripts/lib scripts/host/batchload.mjs bench/models/score.py config/learnloop-weekly.json)" ] || { echo "REFUSED: uncommitted changes"; exit 2; }
run() { if [ -n "$DRY" ]; then echo "  (dry) $*"; else "$@"; fi; }
B=10.0.0.31; G=10.0.0.16
echo "== tests"
python3 scripts/learnloop/weekly/test_weekly.py > /tmp/ll-weekly-test.out 2>&1 || { tail -5 /tmp/ll-weekly-test.out; echo "REFUSED: tests fail"; exit 2; }
python3 scripts/learnloop/test_build_clean.py > /tmp/ll-bc-test.out 2>&1 || { tail -5 /tmp/ll-bc-test.out; echo "REFUSED: builder tests fail"; exit 2; }
tail -1 /tmp/ll-weekly-test.out
echo "== 1. app on $B at $SHA"
run ssh $B 'mkdir -p ~/learnloop/r3/app/scripts/host ~/learnloop/r3/app/bench/models ~/learnloop/r3/app/config'
run rsync -a --delete scripts/learnloop scripts/lib $B:learnloop/r3/app/scripts/
run scp -q scripts/host/batchload.mjs $B:learnloop/r3/app/scripts/host/
run scp -q bench/models/score.py $B:learnloop/r3/app/bench/models/
run scp -q config/learnloop-weekly.json $B:learnloop/r3/app/config/
run ssh $B "echo $SHA > ~/learnloop/r3/app/scripts/learnloop/VERSION"
echo "== 2. dispatcher on $G"
run ssh $G 'mkdir -p ~/learnloop-train/r3'
run scp -q scripts/learnloop/weekly/llgpu.sh scripts/learnloop/weekly/export_lora_gguf.py scripts/learnloop/train/train_sft.py $G:learnloop-train/r3/
run ssh $G 'chmod +x ~/learnloop-train/r3/llgpu.sh'
echo "== 3. key $B -> $G (forced command)"
run ssh $B '[ -f ~/.ssh/id_llgpu ] || ssh-keygen -q -t ed25519 -N "" -C llgpu-from-31 -f ~/.ssh/id_llgpu'
if [ -z "$DRY" ]; then
  K=$(ssh $B 'cat ~/.ssh/id_llgpu.pub')
  ssh $G "grep -q llgpu-from-31 ~/.ssh/authorized_keys || echo 'restrict,from=\"10.0.0.31\",command=\"/home/mike/learnloop-train/r3/llgpu.sh --ssh\" $K' >> ~/.ssh/authorized_keys"
  ssh $B 'ssh -i ~/.ssh/id_llgpu -o BatchMode=yes -o StrictHostKeyChecking=accept-new 10.0.0.16 status' | head -c 300; echo
fi
echo "== 4. cron on $B"
CRON='*/10 * * * * cd /home/mike/learnloop/r3/app/scripts/learnloop/weekly && PATH=/usr/bin:/bin /usr/bin/nice -n 19 /usr/bin/python3 -B weekly.py tick >> /home/mike/learnloop/weekly-cron.log 2>&1 # learnloop-weekly'
run ssh $B "crontab -l > ~/learnloop/crontab.bak-\$(date -u +%Y%m%dT%H%M%SZ); (crontab -l | grep -v '# learnloop-weekly'; echo '$CRON') | crontab -"
echo "== 5. referee launchd on the Mac"
PL=$HOME/Library/LaunchAgents/com.mcai.learnloop-referee.plist
REPO=$(pwd)
if [ -z "$DRY" ]; then
  mkdir -p "$HOME/learnloop/referee/app"; rsync -a --delete scripts/learnloop/ "$HOME/learnloop/referee/app/learnloop/"
  mkdir -p "$HOME/learnloop/referee/app/learnloop/train/bench"; cp bench/models/score.py "$HOME/learnloop/referee/app/learnloop/train/bench/"
  cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>com.mcai.learnloop-referee</string>
 <key>ProgramArguments</key><array><string>$HOME/learnloop/venv/bin/python</string><string>$HOME/learnloop/referee/app/learnloop/weekly/referee.py</string><string>tick</string></array>
 <key>StartInterval</key><integer>21600</integer>
 <key>RunAtLoad</key><false/>
 <key>StandardOutPath</key><string>$HOME/learnloop/referee/referee.log</string>
 <key>StandardErrorPath</key><string>$HOME/learnloop/referee/referee.log</string>
</dict></plist>
PLIST
  launchctl unload "$PL" 2>/dev/null || true; launchctl load "$PL"; echo "  loaded $PL"
fi
echo "INSTALLED $SHA"
