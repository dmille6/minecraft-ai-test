#!/usr/bin/env python3
"""Drop movement avoid-rules that a classifier we now know was wrong produced.

Commit ad08201 stopped goto from deciding WHY a walk failed by regexing its own
error prose. Before it, two things were systematically mislabelled:

  * our own 25s travel budget expiring matched /exceeded/ and was recorded as
    `no_path` -- "no route exists" -- 393 times. The pathfinder reported noPath
    from goto() zero times in that window.
  * the reflex layer stopping a path made goto reject with PathStopped rather
    than our AbortError, so 596 interruptions WE caused were charged to the
    skill as failures.

Four recorded failures and the admission gate blocks an action. So the gate is
currently enforcing conclusions derived from corrupted labels -- the fleet
taught itself that walking home is impossible.

Fixing the classifier only stops NEW bad rules. The existing ones keep gating
until they are removed, and their fail counts only ever rise. This removes the
movement rules so they can be relearned under labels that mean something.

Deliberately ALL movement rules, not just the obviously-bad ones: every one of
them was scored by the broken classifier, so none carries trustworthy evidence.
Re-earning a true rule costs four attempts; keeping a false one costs forever.
Non-movement rules (crafting, missing ingredients) came from other code paths
and are left alone.
"""
import json, glob, os, shutil, sys, time

MOVEMENT = {'goto', 'home', 'explore', 'gather'}

# STOP THE FLEET FIRST. The lessons store is held in memory and flushed
# periodically, so purging a running bot's file is overwritten by that bot
# within seconds -- and the restart then loads the version the bot wrote, not
# yours. Done wrong once, verified wrong by the class counts coming back
# identical, and done right by stopping first:
#
#   for i in scout scout2 miner gatherer gather2; do systemctl stop mcbot@$i; done
#   ./purge-corrupt-movement-lessons.py --apply
#   for i in ...; do systemctl start mcbot@$i; done
stamp = time.strftime('%Y%m%d-%H%M%S')
dry = '--apply' not in sys.argv
total_removed = total_blocking = 0

for path in sorted(glob.glob('/srv/mcbots/state/lessons-*.json')):
    data = json.load(open(path))
    avoid = data.get('avoid') or {}
    doomed = {k: v for k, v in avoid.items() if v.get('skill') in MOVEMENT}
    blocking = sum(1 for v in doomed.values() if v.get('fails', 0) >= 4)
    name = os.path.basename(path)[len('lessons-'):-len('.json')]
    print(f"  {name:10} removing {len(doomed):>3} movement rules "
          f"({blocking} were actively blocking), keeping {len(avoid)-len(doomed)}")
    for k, v in sorted(doomed.items(), key=lambda kv: -kv[1].get('fails', 0))[:3]:
        print(f"      {v.get('fails',0):>3} fails  {k[:64]}  {v.get('classes')}")
    total_removed += len(doomed); total_blocking += blocking
    if not dry:
        shutil.copy2(path, f"{path}.bak-{stamp}")
        for k in doomed: del avoid[k]
        data['avoid'] = avoid
        json.dump(data, open(path, 'w'), indent=1)

print(f"\n  {total_removed} movement rules, {total_blocking} of them blocking.")
print("  DRY RUN -- pass --apply to write (originals are backed up)." if dry
      else f"  applied; originals saved as *.bak-{stamp}")
