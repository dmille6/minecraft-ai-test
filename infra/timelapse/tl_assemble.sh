#!/usr/bin/env bash
# Turn one world's frames into an MP4 (H.264, 15 fps, 1920x1080) and a smaller GIF (960 wide, 10 fps),
# stamping each frame's UTC capture time (from its filename) in the corner.
#   tl_assemble.sh <world> [--from YYYYmmddTHHMMZ] [--to YYYYmmddTHHMMZ]
# Output: /var/tmp/timelapse/video/<world>.mp4 and <world>.gif
set -euo pipefail
W=${1:?usage: tl_assemble.sh <world> [--from STAMP] [--to STAMP]}; shift
FROM=""; TO="99999999T9999Z"
while [ $# -gt 0 ]; do case $1 in --from) FROM=$2; shift 2;; --to) TO=$2; shift 2;; *) echo "bad arg $1"; exit 1;; esac; done
OUT=${TL_OUT:-/var/tmp/timelapse}
FR=$OUT/frames/$W
VD=$OUT/video; mkdir -p "$VD"
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf
[ -f "$FONT" ] || FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
TMP=$(mktemp -d /var/tmp/timelapse/asm.XXXXXX); trap 'rm -rf "$TMP"' EXIT
n=0
for f in $(ls "$FR"/*.png 2>/dev/null | sort); do
  s=$(basename "$f" .png)
  [[ "$s" < "$FROM" ]] && continue
  [[ "$s" > "$TO" ]] && continue
  # 20261015T0520Z -> 2026-10-15 05:20 UTC
  label="$W  ${s:0:4}-${s:4:2}-${s:6:2} ${s:9:2}\\:${s:11:2} UTC"
  n=$((n+1))
  nice -n 19 ffmpeg -loglevel error -y -i "$f" -vf \
    "drawtext=fontfile=$FONT:text='$label':x=w-tw-28:y=h-th-28:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12" \
    "$TMP/$(printf '%06d' $n).png"
done
[ $n -gt 0 ] || { echo "no frames for $W in $FR"; exit 1; }
# hold the last frame ~2 s so the finished state is readable
last=$(printf '%06d' $n)
for i in $(seq 1 30); do n=$((n+1)); ln -s "$TMP/$last.png" "$TMP/$(printf '%06d' $n).png"; done
nice -n 19 ffmpeg -loglevel error -y -framerate 15 -i "$TMP/%06d.png" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$VD/$W.mp4"
nice -n 19 ffmpeg -loglevel error -y -framerate 15 -i "$TMP/%06d.png" \
  -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  "$VD/$W.gif"
echo "$W: $((n-30)) frames -> $VD/$W.mp4 ($(du -h "$VD/$W.mp4" | cut -f1)), $VD/$W.gif ($(du -h "$VD/$W.gif" | cut -f1))"
