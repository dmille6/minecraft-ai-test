#!/bin/bash
# autorebase-relay.sh -- runs on the MAC (launchd com.mcai.autorebase-relay, every 2 min). The canary host builds
# autorebase variants (canary-sched.py v39) but has no GitHub push credential; it writes one request file per branch,
# ~/autorebase/push/<branch with / as __>.req = "<branch> <40-hex sha>". This relay fetches that one ref from the host's
# scratch repo into a local bare repo and pushes it to GitHub. The host confirms by `git ls-remote` on its own.
#
# What it will push: only refs/heads/autorebase/<run>-on-<8 hex>, only a NEW branch (never a force, never main), only the
# exact sha requested, and only when the fetched ref IS that sha. Lightweight (a fetch and a push): controller-only job.
#
# Install (Mac):  cp scripts/host/autorebase-relay.sh ~/bin/ && chmod 755 ~/bin/autorebase-relay.sh
#                 bash scripts/host/autorebase-relay.sh --install-launchd
set -u
HOST=mike@10.0.0.31
GH=git@github.com:dmille6/minecraft-ai-test.git
R=$HOME/mcai-autorebase-relay.git
LABEL=com.mcai.autorebase-relay
log() { echo "$(date -u +%FT%TZ) $*"; }

if [ "${1:-}" = "--install-launchd" ]; then
  PL=$HOME/Library/LaunchAgents/$LABEL.plist
  cat > "$PL.tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HOME/bin/autorebase-relay.sh</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/autorebase-relay.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/autorebase-relay.log</string>
</dict></plist>
EOF
  mv "$PL.tmp" "$PL"
  launchctl unload "$PL" 2>/dev/null; launchctl load "$PL" && log "loaded $PL"
  exit 0
fi

SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"
reqs=$($SSH $HOST 'cat ~/autorebase/push/*.req 2>/dev/null' </dev/null) || exit 0
[ -n "$reqs" ] || exit 0
[ -d "$R" ] || git init -q --bare "$R"
# origin first, so a push sends only the new commits (the host ref alone would make the first push the whole history)
git -C "$R" fetch -q --prune "$GH" "+refs/heads/*:refs/remotes/origin/*" </dev/null || { log "fetch of origin failed"; exit 0; }
echo "$reqs" | while read -r branch sha; do
  [ -n "${branch:-}" ] || continue
  if ! [[ "$branch" =~ ^autorebase/[a-z0-9][a-z0-9._-]*-on-[0-9a-f]{8}$ ]] || ! [[ "${sha:-}" =~ ^[0-9a-f]{40}$ ]]; then
    log "REFUSED malformed request: $branch $sha"; continue
  fi
  flat=${branch//\//__}
  remote=$(git ls-remote "$GH" "refs/heads/$branch" </dev/null | cut -f1)
  if [ -n "$remote" ]; then
    [ "$remote" = "$sha" ] && log "already on origin: $branch $sha" || log "REFUSED: origin has $branch at $remote, request says $sha"
    $SSH $HOST "mv -f ~/autorebase/push/$flat.req ~/autorebase/push/$flat.done" </dev/null
    continue
  fi
  git -C "$R" fetch -q "ssh://$HOST/home/mike/autorebase/repo.git" "+refs/heads/$branch:refs/heads/$branch" </dev/null \
    || { log "fetch of $branch failed"; continue; }
  got=$(git -C "$R" rev-parse "refs/heads/$branch")
  [ "$got" = "$sha" ] || { log "REFUSED: the host's $branch is $got, request says $sha"; continue; }
  if git -C "$R" push -q "$GH" "$sha:refs/heads/$branch" </dev/null; then
    log "pushed $branch $sha"
    $SSH $HOST "mv -f ~/autorebase/push/$flat.req ~/autorebase/push/$flat.done" </dev/null
  else
    log "push of $branch failed"
  fi
done
