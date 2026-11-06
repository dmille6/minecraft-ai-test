#!/bin/bash
# Build VoyagerGuard.jar. Run on a host with javac 21 (ci2), given a copy of a Paper 1.21.8 server's libraries/ dir.
#   ./build.sh <paper-libraries-dir> <out.jar>
set -euo pipefail
LIBS="$1"; OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
CP="$(find "$LIBS" -name '*.jar' | tr '\n' ':')"
javac --release 21 -nowarn -cp "$CP" -d "$W/classes" "$HERE"/src/main/java/ai/mcai/voyager/*.java
cp "$HERE/src/main/resources/plugin.yml" "$W/classes/"
(cd "$W/classes" && jar cf "$OUT" .)
echo "built $OUT ($(stat -c %s "$OUT") bytes, sha256 $(sha256sum "$OUT" | cut -c1-16))"
