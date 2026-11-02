#!/bin/bash
# PROMOMERGE (Mac LaunchAgent com.mcai.promomerge, every 15 min): merge each fleet promotion into main, or page.
# The logic is scripts/host/promomerge.py (its docstring); this wrapper only gives launchd a PATH and the installed copy.
#   ~/promomerge/app/promomerge.py   the installed code (copied from a checkout of main by --install)
#   ~/promomerge/repo                the private scratch clone it merges in (never the user's checkout)
#   ~/Library/Logs/promomerge.log    one line per tick; a tick that runs the suite on the test host takes ~20-40 min (locked)
# Light on the Mac: a fetch, a merge, node --check, a bundle + scp, a push. The suite runs on the test host.
#
# Install (Mac, from a checkout of main):  bash scripts/mac/promomerge.sh --install
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
LABEL=com.mcai.promomerge
APP=$HOME/promomerge/app
if [ "${1:-}" = "--install" ]; then
  SRC=$(cd "$(dirname "$0")/../.." && pwd)
  python3 -B "$SRC/scripts/host/test_promomerge.py" || { echo "tests FAILED: not installed"; exit 1; }
  mkdir -p "$APP" "$HOME/bin"
  cp "$SRC/scripts/host/promomerge.py" "$APP/promomerge.py"
  cp "$SRC/scripts/mac/promomerge.sh" "$HOME/bin/promomerge.sh"; chmod 755 "$HOME/bin/promomerge.sh"
  PL=$HOME/Library/LaunchAgents/$LABEL.plist
  cat > "$PL.tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HOME/bin/promomerge.sh</string></array>
  <key>StartInterval</key><integer>900</integer>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/promomerge.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/promomerge.log</string>
</dict></plist>
PLIST
  mv "$PL.tmp" "$PL"
  launchctl unload "$PL" 2>/dev/null; launchctl load "$PL" && echo "loaded $PL"
  exit 0
fi
exec python3 -B "$APP/promomerge.py" tick
