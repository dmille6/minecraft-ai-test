#!/usr/bin/env python3
"""Drop avoid rules that the current classification policy would never have written.

RUN THIS ONLY WITH THE FLEET STOPPED.

    stop -> purge -> verify on disk -> start

Bots hold their lessons in memory and flush on write. Purging a RUNNING fleet
has silently failed twice here: the file is edited, the bot writes its in-memory
copy back over the edit, and the rules reappear within minutes looking like they
"rebuilt themselves". Verify on disk before starting anything.

WHAT IT REMOVES AND WHY

The gate blocked the entire early tech tree on instance #1 -- craft
wooden_pickaxe 54 fails, craft oak_planks 47, craft stick 37 -- while 100% of
the underlying failures were `missing_ingredients`: the right action attempted
before its inputs existed. Those counters are not evidence about the actions.
They are a record of the agent being asked to bootstrap.

As of f6d0dcf those classes are no longer written unconditionally. But existing
entries are inert to that fix -- clearing 54 by decrement needs 50 successes --
so they have to be removed once, explicitly.

An entry is dropped when the classes that are no longer action-evidence account
for the MAJORITY of its recorded failures. Mixed entries that are mostly genuine
(no_path, nothing_found, buried) are kept and merely have the situational share
subtracted, because throwing away real evidence to fix a bookkeeping bug trades
one wrong belief for another.
"""
import argparse, json, os, shutil, sys, time

# Mirrors cognitive.mjs. Anything not in EVIDENCE_ABOUT_THE_ACTION there is not
# evidence here -- listed explicitly rather than inverted, so a rename in one
# file cannot silently widen the purge in the other.
NOT_EVIDENCE = {
    "missing_ingredients", "missing_tool", "needs_station", "inventory",
    "hazard_interrupt", "stagnation", "stuck", "preempted", "timeout",
    "path_timeout", "path_interrupted", "path_budget", "collect_budget",
    "goal_changed", "died", "other",
}
STILL_EVIDENCE = {"no_path", "path_incomplete", "nothing_found", "buried", "bad_target"}


def purge_file(path, apply):
    try:
        with open(path) as fh:
            data = json.load(fh)
    except Exception as e:
        print(f"    {os.path.basename(path)}: unreadable ({e})")
        return 0, 0
    avoid = data.get("avoid") or {}
    dropped, trimmed, kept = [], [], 0
    for k, e in list(avoid.items()):
        classes = e.get("classes") or {}
        total = sum(classes.values())
        bad = sum(n for c, n in classes.items() if c in NOT_EVIDENCE)
        if not total:
            # No class breakdown at all: written before classes were recorded, so
            # its provenance is unknowable. Unknowable provenance is exactly what
            # this whole incident was about -- drop it.
            dropped.append((k, e.get("fails", 0), "no class breakdown"))
            avoid.pop(k)
            continue
        if bad * 2 > total:
            dropped.append((k, e.get("fails", 0), f"{bad}/{total} situational"))
            avoid.pop(k)
        elif bad:
            before = e.get("fails", 0)
            e["fails"] = max(0, before - bad)
            for c in list(classes):
                if c in NOT_EVIDENCE:
                    classes.pop(c)
            e.pop("since", None)          # restart the decay clock honestly
            trimmed.append((k, before, e["fails"]))
            kept += 1
        else:
            kept += 1

    name = os.path.basename(path)
    if not dropped and not trimmed:
        print(f"    {name}: nothing to do ({kept} kept)")
        return 0, 0
    print(f"    {name}: dropping {len(dropped)}, trimming {len(trimmed)}, keeping {kept}")
    for k, fails, why in sorted(dropped, key=lambda r: -r[1])[:6]:
        print(f"        drop  {k[:52]:<52} fails={fails}  ({why})")
    for k, b, a in trimmed[:4]:
        print(f"        trim  {k[:52]:<52} {b} -> {a}")

    if apply:
        # OWNERSHIP IS PART OF THE FILE. This script runs as root; os.replace()
        # swaps in a root-owned temp file, and the bots run as `mcbot`. The
        # first version stat'd the file AFTER the replace -- reading back the
        # ownership it had just destroyed -- so every bot on both fleets logged
        # `EACCES ... lessons-*.json` twice per decision and silently stopped
        # persisting anything it learned. The fleet looked healthy: deciding,
        # moving, shipping telemetry, and unable to remember a thing.
        st = os.stat(path)                # BEFORE, while it is still the truth
        shutil.copy2(path, f"{path}.bak-{int(time.time())}")
        data["avoid"] = avoid
        tmp = f"{path}.tmp"
        with open(tmp, "w") as fh:
            json.dump(data, fh, indent=2)
        os.chmod(tmp, st.st_mode)
        try:
            os.chown(tmp, st.st_uid, st.st_gid)
        except PermissionError:
            pass                          # not root: ownership was never ours to change
        os.replace(tmp, path)             # atomic, and now indistinguishable from before
        after = os.stat(path)
        if (after.st_uid, after.st_gid) != (st.st_uid, st.st_gid):
            print(f"        WARNING: {os.path.basename(path)} changed owner "
                  f"{st.st_uid}:{st.st_gid} -> {after.st_uid}:{after.st_gid}")
    return len(dropped), len(trimmed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state-dir", default="/srv/mcbots/state")
    ap.add_argument("--apply", action="store_true", help="without this, nothing is written")
    a = ap.parse_args()

    files = sorted(f for f in os.listdir(a.state_dir)
                   if f.startswith("lessons") and f.endswith(".json"))
    if not files:
        print(f"no lessons files in {a.state_dir}")
        return 1
    print(f"{'APPLYING' if a.apply else 'DRY RUN'} over {len(files)} file(s) in {a.state_dir}")
    d = t = 0
    for f in files:
        dd, tt = purge_file(os.path.join(a.state_dir, f), a.apply)
        d += dd; t += tt
    print(f"\n  total: {d} rules dropped, {t} trimmed")
    if not a.apply:
        print("  (dry run -- re-run with --apply, and only with the fleet stopped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
