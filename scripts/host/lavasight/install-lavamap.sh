#!/usr/bin/env bash
# install-lavamap.sh -- lavasight-01's publisher on 10.0.0.31, STAGED: the operator runs it, as mike, from a checkout of the
# lavasight branch, BEFORE the canary is drawn (the read's `mapped` gate needs the files). Docs:
# docs/reports/lavasight-01-design-2026-10-24.md 2.1.
#
#   bash scripts/host/lavasight/install-lavamap.sh --rehearse      # trial copy, trial root, as mike: writes nothing real
#   bash scripts/host/lavasight/install-lavamap.sh --install       # app copy + tests + one real publish + cron + header line
#   bash scripts/host/lavasight/install-lavamap.sh --rollback      # cron line out, header line reverted, files removed
#
# The base build never opens lava-map.json, so the files are harmless to every control pool. One publish writes
# /var/lib/mcai/_pool-<world>/lava-map.json as mcbot for every world on the hazard map whose pool dir exists.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
D=/home/mike/lavasight
FS=/home/mike/estel/scripts/host/fleetstatus.py
CRON='40 * * * * /bin/bash /home/mike/lavasight/lavamap-cron.sh # lavamap'
[ "$(id -un)" = mike ] || { echo "run as mike"; exit 2; }
[ "$(hostname)" = block2-bots ] || { echo "run on 10.0.0.31 (block2-bots)"; exit 2; }
case "${1:-}" in
  --rehearse)
    T=$(mktemp -d /home/mike/lavasight-trial.XXXX); mkdir -p "$T/app" "$T/root"
    cp "$HERE/lavamap_publish.py" "$T/app/"; cp "$HERE/lavamap-cron.sh" "$T/"
    for d in /var/lib/mcai/_pool-*; do n=$(basename "$d"); case "$n" in *.pre-reseed-*|_pool-self-*) ;; *) mkdir "$T/root/$n";; esac; done
    python3 -B "$HERE/test_lavamap_publish.py" | tail -2
    LM_DIR="$T" LM_ROOT="$T/root" LM_SELF=1 bash "$T/lavamap-cron.sh"; tail -1 "$T/out/publish.log"
    python3 -B "$T/app/lavamap_publish.py" check --root "$T/root" --map /home/mike/hazardmap/out/hazardmap.json
    cp "$FS" "$T/fs.py"; cp "$FS" "$T/fs.orig"
    python3 -B "$HERE/patch_fleetstatus.py" "$T/fs.py" && python3 -B "$HERE/patch_fleetstatus.py" "$T/fs.py" --revert && cmp "$T/fs.py" "$T/fs.orig" && echo "header patch: patch + revert byte-identical"
    echo "rehearsal in $T (remove it when done)";;
  --install)
    python3 -B "$HERE/test_lavamap_publish.py" | tail -2
    mkdir -p "$D/app" "$D/out"
    cp "$HERE/lavamap_publish.py" "$D/app/"; cp "$HERE/lavamap-cron.sh" "$D/"
    bash "$D/lavamap-cron.sh"; tail -1 "$D/out/publish.log"
    python3 -B "$D/app/lavamap_publish.py" check --root /var/lib/mcai --map /home/mike/hazardmap/out/hazardmap.json
    crontab -l > "$D/crontab.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    if ! crontab -l | grep -q '# lavamap$'; then { crontab -l; echo "$CRON"; } | crontab -; fi
    python3 -B "$HERE/patch_fleetstatus.py" "$FS"
    echo "installed: cron '$CRON'; header line patched into $FS";;
  --rollback)
    crontab -l | grep -v '# lavamap$' | crontab - || true
    python3 -B "$HERE/patch_fleetstatus.py" "$FS" --revert || true
    for f in /var/lib/mcai/_pool-*/lava-map.json; do [ -f "$f" ] && sudo -n -u mcbot rm -f "$f"; done
    echo "rolled back (the app copy stays in $D)";;
  *) echo "usage: $0 --rehearse | --install | --rollback"; exit 2;;
esac
