#!/usr/bin/env python3
"""Re-run the CURRENT per-bot GET_WOOD rule over RECORDED shadow snapshots. Offline: reads files only.

    python3 scripts/mayor/wood_replay.py --snaps '/var/lib/mcai-mayor/snap-*.jsonl'

Recorded snapshots carry every field the rule reads (fresh, pick_state, logs, planks, sticks, cobble,
has_table), so shortages and candidates are recomputed from the snapshot itself; no telemetry needed.
It prints counts, per recorded mayor_rev ('unstamped' = before revisions were stamped):
  old_world_rule_fired         snapshots whose RECORDED shortages held a world-scope GET_WOOD
  new_rule_fired               snapshots where the current rule finds >= 1 short bot
  new_fired_where_old_quiet    ... of which the recorded world rule had stayed quiet
  per_bot_wood_shortages       short bots, summed over snapshots
  feasible_get_wood_candidates of those, assignable now (log near, room, not trapped)
  restore_pick_no_ingredients  RESTORE_PICK candidates blocked for want of wood
  restore_pick_vs_wood_disagreements  must be 0: both read core.pick_ingredients
This is a COUNT of what the rule would flag, not an outcome: nothing here says a bot would have gathered.
"""
import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mayor_core as core  # noqa: E402

KEYS = ('snapshots', 'old_world_rule_fired', 'new_rule_fired', 'new_fired_where_old_quiet', 'per_bot_wood_shortages',
        'feasible_get_wood_candidates', 'restore_pick_no_ingredients', 'restore_pick_vs_wood_disagreements')


def replay_one(s, acc):
    acc['snapshots'] += 1
    old = any(x['duty'] == 'GET_WOOD' and x.get('scope') == 'world' for x in s.get('shortages') or [])
    acc['old_world_rule_fired'] += old
    cfg = dict(core.DEFAULTS, **{k: v for k, v in (s.get('cfg') or {}).items() if k in core.DEFAULTS})
    s2 = dict(s)
    s2['shortages'] = core.shortages(s2, cfg)
    s2['candidates'] = core.candidates(s2, cfg)
    wood = [x for x in s2['shortages'] if x['duty'] == 'GET_WOOD']
    acc['new_rule_fired'] += bool(wood)
    acc['new_fired_where_old_quiet'] += bool(wood) and not old
    acc['per_bot_wood_shortages'] += len(wood)
    acc['feasible_get_wood_candidates'] += sum(c['feasible'] for c in s2['candidates'] if c['duty'] == 'GET_WOOD')
    short_bots = {x['bot'] for x in wood}
    for c in s2['candidates']:
        if c['duty'] == 'RESTORE_PICK':
            blocked = any(b['code'] == 'no_ingredients' for b in c['blockers'])
            acc['restore_pick_no_ingredients'] += blocked
            acc['restore_pick_vs_wood_disagreements'] += blocked != (c['bot'] in short_bots)


def main(argv=None):
    ap = argparse.ArgumentParser(description='replay the per-bot GET_WOOD rule over recorded snapshots')
    ap.add_argument('--snaps', default='/var/lib/mcai-mayor/snap-*.jsonl')
    args = ap.parse_args(argv)
    by_rev, bad = {}, 0
    for p in sorted(glob.glob(args.snaps)):
        with open(p) as f:
            for line in f:
                try:
                    s = json.loads(line)
                except ValueError:
                    bad += 1
                    continue
                if not isinstance(s, dict) or not isinstance(s.get('bots'), list):
                    bad += 1
                    continue
                rev = s.get('mayor_rev') or 'unstamped'
                replay_one(s, by_rev.setdefault(rev, dict.fromkeys(KEYS, 0)))
    if not by_rev:
        print('NO SNAPSHOTS matched %s (%d unreadable lines) -- nothing replayed (this is not a zero).' % (args.snaps, bad))
        return 2
    print(json.dumps({'by_recorded_rev': by_rev, 'unreadable_lines': bad, 'rule_rev': core.MAYOR_REV}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
