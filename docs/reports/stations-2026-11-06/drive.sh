#!/bin/bash
T=$(mktemp -d /tmp/stscan.XXXXXX); trap 'rm -rf $T' EXIT
cp "$(dirname "$0")"/scan.py "$(dirname "$0")"/townplan_blockdump.py $T/
R=136
while read p x y z; do
  mkdir -p $T/$p
  for rx in $(( (x-R)>>9 )) $(( (x+R)>>9 )); do for rz in $(( (z-R)>>9 )) $(( (z+R)>>9 )); do
    f=/srv/block2/$p/world/region/r.$rx.$rz.mca; [ -f $f ] && cp -n $f $T/$p/ ; done; done
  echo "$p $(nice -n 19 python3 -I $T/scan.py $T/$p $x $y $z $R)"
  rm -rf $T/$p
done < "$(dirname "$0")"/homes.txt
