#!/usr/bin/env python3
"""canarywatch -- notice when a canary is live and NOBODY IS READING IT.

Why this exists. On 2026-09-20 digwatch-02 ran **15 hours against a 420-minute
deadline with no read**, because the loop that was supposed to read it had died
and nothing checked. The deadline half of the analyst's test fired; the liveness
half did not, because `pgrep -f canary-loop` SELF-MATCHES -- the check's own
command line contains the string it searches for, so it always finds "a loop".
That trap bit four separate times on 2026-09-19 before it was written down.

Two independent alarms, because either one alone has already failed:

  STALE     the manifest declares a canary, its age exceeds the registered
            deadline_min, and no decision is recorded against that sha+pool.
  ORPHANED  the manifest declares a canary and no loop process is alive. A
            canary with no reader is not a canary, it is an unmonitored deploy.

Liveness uses the anchored form from ~/canaryloop.sh (`^bash /home/mike/canary-loop.sh`)
which excludes both the self-match and the setsid launcher.

`--selftest` builds synthetic states and asserts each alarm fires and each clean
state stays quiet. A watchdog nobody has watched fail is not a watchdog -- that
is the rule this file is an instance of, and the reason the loop's death was
invisible is that its monitor had never been seen to fire.
"""
import sys, os, json, glob, subprocess, datetime as dt

MANIFEST = "/srv/mcbots/trial-manifest.json"
LEDGER = "/var/log/mcai/_canary-decisions.jsonl"
REGS = "/home/mike/mcai-analysis/registrations"
ANCHOR = "^bash /home/mike/canary-loop.sh"
MARKER = "/home/mike/digest/CANARY-UNREAD.txt"
HEALS = "/home/mike/digest/canarywatch-heals.json"
LOOP = "/home/mike/canary-loop.sh"
TMPREADS = "/tmp"
SRCREADS = "/home/mike/mcai-analysis"
MAX_HEALS = 3


def loop_alive(_probe=None):
    if _probe is not None:
        return _probe
    try:
        r = subprocess.run(["pgrep", "-f", ANCHOR], capture_output=True, text=True)
        return r.returncode == 0 and bool(r.stdout.strip())
    except Exception:
        return False


def deadline_for(run_id, regs=REGS, default=420):
    p = os.path.join(regs, "%s.json" % run_id)
    if os.path.exists(p):
        try:
            return int(json.load(open(p)).get("deadline_min") or default)
        except Exception:
            pass
    return default


def decided(sha, pool, ledger_rows):
    """A decision closes THIS deployment only: same sha AND same pool set."""
    want = {x.strip() for x in str(pool or "").split(",") if x.strip()}
    for r in ledger_rows:
        if not str(r.get("canary_sha") or r.get("canary_code_version") or "").startswith(str(sha or "")[:7]):
            continue
        got = {x.strip() for x in str(r.get("canary_pool") or "").split(",") if x.strip()}
        if got == want:
            return True
    return False


SENTINEL = "/home/mike/MANUAL-READS-UNTIL"


def manual_reader(now, path=SENTINEL):
    """A named, TIME-BOUNDED acknowledgement that a human or agent is doing the
    reads instead of the loop.

    Without this, ORPHANED fires continuously whenever anyone reads by hand, and
    an alarm that cries wolf every ten minutes gets ignored -- which is how the
    loop's death stayed invisible in the first place. The expiry is mandatory and
    is NOT extended on use: a forgotten sentinel must go stale and let the alarm
    come back, because the failure this guards against is precisely somebody
    intending to read and then not doing it.

    STALE is never suppressed. Whoever is reading, past the deadline with no
    decision is the thing that actually went wrong on 2026-09-20."""
    try:
        until = dt.datetime.fromisoformat(open(path).read().strip().replace("Z", "+00:00"))
    except Exception:
        return False, None
    return (until > now), until


def evaluate(manifest, ledger_rows, now, alive, regs=REGS, manual=False):
    """-> (list of alarms, age_min). Pure, so the selftest can drive it."""
    pool = str(manifest.get("canary_pool") or "").strip()
    sha = manifest.get("canary_code_version") or manifest.get("canary_sha")
    if not pool or not sha:
        return [], None
    declared = dt.datetime.fromisoformat(str(manifest["declared_at"]).replace("Z", "+00:00"))
    age = (now - declared).total_seconds() / 60
    dl = deadline_for(str(manifest.get("run_id") or ""), regs)
    alarms = []
    if not decided(sha, pool, ledger_rows) and age > dl:
        alarms.append("STALE: canary %s on %s is %.0f min old against a %d min deadline "
                      "with NO decision recorded" % (sha, pool, age, dl))
    if not alive and not manual:
        alarms.append("ORPHANED: canary %s on %s is live and NO canary-loop process is "
                      "running -- nothing is reading it" % (sha, pool))
    return alarms, age


def heal_decision(alarms, run_id, heals_done, max_heals=MAX_HEALS, manual=False):
    """(should_heal, why). PURE, so the selftest can drive it. (2026-09-25)

    WHY THIS EXISTS AND WHY IT IS NOT JUST ANOTHER ALARM. On 2026-09-24 blindstep-01 deployed
    at 12:27:52Z, its loop died at the first read because a registered read script was absent
    from /tmp, and this watchdog then wrote ORPHANED **21 consecutive times** into
    ~/digest/canarywatch.log between 14:40 and 18:00 while 20 bots ran an unread canary for
    5.6 hours. Detection was never the problem. The alarm had no route to anybody: the marker
    file is not read either, and the owner's push channel has failed three days running
    ("Remote Control inactive").

    So the watchdog now RELAUNCHES the loop. That is safe for a specific reason rather than by
    hope: the loop is idempotent, resumes from its journal phase, and holds an exclusive lock,
    and relaunching it by hand is exactly what closed blindstep-01.

    IT IS BOUNDED, because a self-healing watchdog against a crash-looping loop is a restart
    storm. At most `max_heals` attempts per canary; after that ORPHANED stands and a human is
    required. A manual-reader sentinel stays the hand entirely -- somebody is already on it.
    """
    if manual:
        return False, "manual reads acknowledged; leaving it alone"
    if not any(a.startswith("ORPHANED") for a in alarms):
        return False, "no ORPHANED alarm"
    if not run_id:
        return False, "no run_id in the manifest, so there is nothing to relaunch"
    if heals_done >= max_heals:
        return False, ("heal budget exhausted (%d of %d) -- the loop is not staying up and a "
                       "human is required; ORPHANED stands" % (heals_done, max_heals))
    return True, "relaunching the loop (attempt %d of %d)" % (heals_done + 1, max_heals)


def stage_reads(run_id, regs=REGS, src=SRCREADS, dst=TMPREADS):
    """Copy the registration's reads into /tmp. Returns (copied, missing).

    THE CAUSE, not the symptom. canary-loop.sh refuses to read when a registered read script is
    absent from /tmp, and its own message says it: "nothing copies them in and a reboot empties
    /tmp". That is what killed blindstep-01's loop. Nothing else in the apparatus populates
    /tmp, so this does.
    """
    import shutil
    copied, missing = [], []
    try:
        reg = json.load(open(os.path.join(regs, "%s.json" % run_id)))
    except Exception as e:
        return [], ["<registration unreadable: %s>" % e]
    for name in (reg.get("reads") or []):
        d = os.path.join(dst, "%s.py" % name)
        if os.path.exists(d):
            continue
        srcp = os.path.join(src, "%s.py" % name)
        if os.path.exists(srcp):
            try:
                shutil.copy(srcp, d); copied.append(name)
            except Exception as e:
                missing.append("%s (copy failed: %s)" % (name, e))
        else:
            missing.append("%s (not in %s either)" % (name, src))
    return copied, missing


def bump_heal(key, path=HEALS):
    d = {}
    try:
        d = json.load(open(path))
    except Exception:
        pass
    d[key] = int(d.get(key, 0)) + 1
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(d, open(path, "w"), indent=1)
    except Exception:
        pass
    return d[key]


def heals_for(key, path=HEALS):
    try:
        return int(json.load(open(path)).get(key, 0))
    except Exception:
        return 0


def relaunch(run_id):
    """setsid so it outlives this cron process; `bash <path>` so the ANCHOR above matches it
    (a shebang-launched loop has argv[0]=/bin/bash and is invisible to the liveness check --
    that mismatch once refused every deploy for a whole run)."""
    try:
        subprocess.Popen(["setsid", "nohup", "bash", LOOP, run_id],
                         stdout=open("/home/mike/digest/%s.heal.log" % run_id, "a"),
                         stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         start_new_session=True)
        return True, "relaunched"
    except Exception as e:
        return False, "relaunch failed: %s" % e


def selftest():
    now = dt.datetime(2026, 9, 21, 12, 0, tzinfo=dt.timezone.utc)
    mk = lambda mins: {"run_id": "t", "canary_pool": "board-d,placebo-d",
                       "canary_code_version": "abc1234",
                       "declared_at": (now - dt.timedelta(minutes=mins)).isoformat()}
    dec = [{"canary_sha": "abc1234", "canary_pool": "board-d,placebo-d", "decision": "KEEP"}]
    cases = [
        ("no canary declared",       {"run_id": "t", "canary_pool": "", "declared_at": now.isoformat()}, [], True,  set()),
        ("fresh, loop alive",        mk(60),  [],   True,  set()),
        ("past deadline, loop alive", mk(900), [],  True,  {"STALE"}),
        ("fresh, loop DEAD",        mk(60),   [],   False, {"ORPHANED"}),
        ("past deadline, loop DEAD", mk(900), [],   False, {"STALE", "ORPHANED"}),
        ("past deadline but DECIDED", mk(900), dec, True,  set()),
        ("decided, loop dead -> still orphaned? no: decided closes it",
                                     mk(900), dec, False, {"ORPHANED"}),
        ("decision for a DIFFERENT pool must not close it",
                                     mk(900),
                                     [{"canary_sha": "abc1234", "canary_pool": "hive-a", "decision": "KEEP"}],
                                     True, {"STALE"}),
    ]
    bad = 0
    for name, man, led, alive, want in cases:
        alarms, _ = evaluate(man, led, now, alive, regs="/nonexistent")
        got = {a.split(":")[0] for a in alarms}
        ok = got == want
        bad += 0 if ok else 1
        print("  %-4s %-58s expected %-22s got %s"
              % ("ok" if ok else "FAIL", name, sorted(want) or "quiet", sorted(got) or "quiet"))
    # THE SENTINEL MUST SUPPRESS ORPHANED AND MUST NOT SUPPRESS STALE.
    sent = [
        ("manual sentinel silences ORPHANED",        mk(60),  [], False, True,  set()),
        ("manual sentinel does NOT silence STALE",   mk(900), [], False, True,  {"STALE"}),
        ("no sentinel, loop dead -> ORPHANED back",  mk(60),  [], False, False, {"ORPHANED"}),
    ]
    for name, man, led, alive, manual, want in sent:
        alarms, _ = evaluate(man, led, now, alive, regs="/nonexistent", manual=manual)
        got = {a.split(":")[0] for a in alarms}
        ok = got == want
        bad += 0 if ok else 1
        print("  %-4s %-58s expected %-22s got %s"
              % ("ok" if ok else "FAIL", name, sorted(want) or "quiet", sorted(got) or "quiet"))
    # THE HEAL DECISION MUST BE SEEN TO FIRE *AND* SEEN TO REFUSE. An auto-relaunch that
    # cannot decline is a restart storm against a crash-looping loop; one that cannot fire is
    # what let blindstep-01 sit unread for 5.6 hours while this file wrote ORPHANED 21 times.
    ORPH = ["ORPHANED: canary x on y is live and NO canary-loop process is running"]
    STALE_ONLY = ["STALE: canary x on y is 900 min old against a 420 min deadline"]
    heal_cases = [
        ("ORPHANED, budget free       -> HEAL", ORPH,       "r1", 0, False, True),
        ("ORPHANED, 2 of 3 used       -> HEAL", ORPH,       "r1", 2, False, True),
        ("ORPHANED, budget exhausted  -> refuse", ORPH,     "r1", 3, False, False),
        ("ORPHANED, over budget       -> refuse", ORPH,     "r1", 9, False, False),
        ("ORPHANED but manual sentinel-> refuse", ORPH,     "r1", 0, True,  False),
        ("STALE only, loop alive      -> refuse", STALE_ONLY, "r1", 0, False, False),
        ("ORPHANED but no run_id      -> refuse", ORPH,     "",   0, False, False),
        ("no alarms at all            -> refuse", [],       "r1", 0, False, False),
    ]
    hbad = 0
    print("\n  heal decision:")
    for name, al, rid, done, man, want in heal_cases:
        got, why = heal_decision(al, rid, done, manual=man)
        ok = got is want
        hbad += 0 if ok else 1
        print("  %-4s %-40s expected %-5s got %-5s :: %s"
              % ("ok" if ok else "FAIL", name, want, got, why[:46]))
    bad += hbad
    n = len(cases) + len(sent) + len(heal_cases)
    print("\n  %d/%d cases pass" % (n - bad, n))
    print("  Both alarms have now been SEEN to fire, and each clean state has been seen quiet.")
    print("  The heal has been seen to FIRE and to REFUSE on budget, sentinel and missing run_id.")
    return 1 if bad else 0


def main():
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    now = dt.datetime.now(dt.timezone.utc)
    man = json.load(open(MANIFEST))
    rows = []
    for line in open(LEDGER):
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
    manual, until = manual_reader(now)
    alarms, age = evaluate(man, rows, now, loop_alive(), manual=manual)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if not alarms:
        if os.path.exists(MARKER):
            os.remove(MARKER)
        who = "reader alive" if not manual else "manual reads acknowledged until %s" % until
        print("%s canarywatch OK (%s)" % (stamp, "no canary" if age is None else "canary %.0f min old, %s" % (age, who)))
        raise SystemExit(0)
    body = "\n".join("%s  %s" % (stamp, a) for a in alarms)
    print(body)
    # ACT, do not merely narrate. See heal_decision.
    run_id = str(man.get("run_id") or "")
    key = "%s:%s" % (man.get("canary_code_version") or "?", str(man.get("canary_pool") or "?"))
    do, why = heal_decision(alarms, run_id, heals_for(key), manual=manual)
    print("%s  HEAL: %s" % (stamp, why))
    if do:
        copied, missing = stage_reads(run_id)
        if copied:
            print("%s  HEAL: staged reads into /tmp: %s" % (stamp, ", ".join(copied)))
        if missing:
            print("%s  HEAL: reads STILL missing: %s" % (stamp, ", ".join(missing)))
        n = bump_heal(key)
        ok, msg = relaunch(run_id)
        print("%s  HEAL: attempt %d -- %s" % (stamp, n, msg))
    try:
        os.makedirs(os.path.dirname(MARKER), exist_ok=True)
        open(MARKER, "w").write(body + "\n")
    except Exception:
        pass
    raise SystemExit(2)


if __name__ == "__main__":
    main()
