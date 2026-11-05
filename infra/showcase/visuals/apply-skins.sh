#!/usr/bin/env bash
# visuals-1105: apply the 15 role skins with SkinsRestorer console commands (via RCON). NOT RUN YET: the PNGs must first be
# signed by MineSkin (owner decision: public URL + public/secret gallery, or the skinsrestorer.net/upload page).
# INPUTS file: one line per bot "<bot> <skin input>", where <skin input> is a public https PNG URL or a
# skinsrestorer-axolotl:// value from https://skinsrestorer.net/upload.  Usage: apply-skins.sh INPUTS
set -euo pipefail
R=/srv/showcase/bin/rcon.py
while read -r bot input; do
  [ -z "${bot:-}" ] || [ "${bot:0:1}" = "#" ] && continue
  name="mcai-$(echo "${bot#showcase-}" | tr A-Z a-z)"
  echo "== $bot -> $name"
  $R "sr createcustom $name \"$input\" classic"
  sleep 3
  $R "skin set $name $bot"
  sleep 1
done < "$1"
# verify: each bot's stored selection (SkinsRestorer file storage) names its mcai-* skin
sudo grep -l "mcai-" /srv/showcase/server/plugins/SkinsRestorer/players/*.player 2>/dev/null | wc -l
