#!/usr/bin/env python3
"""Stop bots that are repeatedly dying the same way. No LLM, no judgement.

WHY THIS EXISTS
    The fleet once ran 16 hours unattended and produced 81 deaths, 80 of them
    falls, all at y20-39, while every liveness invariant reported healthy --
    telemetry flowing, decisions happening, all five bots alive. Liveness is not
    health. A fleet enthusiastically killing itself every twelve minutes passes
    every check that asks "is the machinery running?".

WHY IT READS RAW EVENTS AND NOT LABELS
    The same run proved this system can generate false evidence, persist it, and
    enforce it as policy: goto classified its own failures by regexing its error
    prose, matched its OWN wrapper timeout, and recorded 393 expired budgets as
    "no route exists" -- a verdict the pathfinder never returned. Those labels
    reached the lessons store and the admission gate blocked `home` on all five
    bots. Any supervisor built on derived labels would have agreed with all of
    it.

    So this reads only what cannot be faked by a broken classifier: the death
    events themselves, the server's own death message, position, and time.

WHY IT ONLY STOPS
    Stopping is the safe asymmetry. A stopped bot costs you data. A looping,
    dying bot costs you the day AND poisons the lessons store with failures that
    will gate its future behaviour. This never tunes, never edits config, never
    deploys -- those change the experiment, and a change mid-trial makes the
    trial uninterpretable, which is worse than losing it cleanly.
"""
import json, os, re, subprocess, sys, time
from collections import defaultdict
from datetime import datetime, timezone, timedelta

# LOCAL mode: instance #1 has no evidence host, so the tripper runs on the bot
# host and reads its own logs. Less isolated than reading an archive on a machine
# that runs no agent code -- but the thing it stops lives on this host too, so if
# this host is gone the bots are gone with it.
LOCAL     = os.environ.get("TRIPPER_LOCAL", "") == "1"
LOGS      = os.environ.get("LOG_GLOB", "/srv/mcbots/logs/*.jsonl")
MANIFEST  = os.environ.get("MANIFEST", "/srv/mcbots/bot-manifest.json")
EVD       = os.environ.get("EVD_HOST", "192.168.193.21")
LAB       = os.environ.get("LAB_HOST", "192.168.193.40")
KEY       = os.environ.get("AGENT_KEY", "/root/.ssh/id_ed25519_agent")
ARCHIVE   = "/srv/evidence/raw/lab01"
INCIDENTS = "/var/lib/mcai-tripper"
DRY       = "--apply" not in sys.argv

# Thresholds. Deliberately tight: a fall costs the bot its inventory and its
# progress, so two is already a pattern, not bad luck.
BOT_FALLS_30M    = 2
# Fleet threshold scales with population: 5 was set for a 5-bot fleet, and
# instance #1 now runs 8. Overridable so a bigger fleet does not trip on a rate
# that is proportionally lower than the per-bot rule it is meant to backstop.
FLEET_FALLS_30M  = int(os.environ.get("FLEET_FALLS_30M", "5"))
# 0 disables a rule. Instance #1 sits at ~6 fall deaths/hour at y30-39 and has
# for twelve hours straight -- a chronic, documented condition, not a new
# emergency. The fleet-wide rules exist to catch a mass-casualty EVENT; firing
# them on a known steady state stops eight bots and teaches nothing. The per-bot
# rule stays on, because that is the one that catches the failure mode which
# actually wastes a night: a single bot in a death loop.
DEPTH_FALLS_60M  = int(os.environ.get("DEPTH_FALLS_60M", "4"))   # y20-39
DEPTH_BAND       = (20, 39)

def sh(cmd):
    """Run locally. Used only in LOCAL mode, where the tripper is already root
    on the host whose services it stops."""
    return subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True, timeout=90)

def ssh(host, cmd, user="agent"):
    if LOCAL:
        return sh(cmd)
    return subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
         "-o", "StrictHostKeyChecking=accept-new", f"{user}@{host}", cmd],
        capture_output=True, text=True, timeout=90)

def unit_map():
    """Bot display name -> systemd instance, READ from the host, never assumed.

    Restarting `mcbot@Scout01` instead of `mcbot@scout` creates a phantom unit
    that fails forever while the real bot keeps running. That has happened twice,
    so lab01 PUBLISHES the mapping in a world-readable manifest rather than
    having the supervisor infer it -- and the supervisor cannot read the env
    files anyway, since those hold the Elasticsearch shipper password and a
    least-privilege account has no business with them.
    """
    r = ssh(LAB, f"cat {MANIFEST}")
    try:
        return json.loads(r.stdout)["bots"]
    except Exception as e:
        print(f"    cannot read bot manifest ({e}) -- refusing to stop units I cannot name")
        return {}

def load_deaths(minutes):
    """Death events from the archive, newest window only."""
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    src = LOGS if LOCAL else f"{ARCHIVE}/*.jsonl"
    r = ssh(EVD, f"grep -h '\"_death\"' {src} 2>/dev/null | tail -2000")
    deaths = []
    for line in r.stdout.splitlines():
        try:
            d = json.loads(line)
        except Exception:
            continue
        if (d.get("skill") or {}).get("name") != "_death":
            continue
        try:
            ts = datetime.fromisoformat(d["@timestamp"].replace("Z", "+00:00"))
        except Exception:
            continue
        if ts < since:
            continue
        sk = d.get("skill") or {}
        bot = (d.get("bot") or {}).get("name")
        pos = (d.get("bot") or {}).get("pos") or {}
        detail = (sk.get("detail") or "").lower()
        # fail_class when present; otherwise the SERVER'S OWN death message.
        # That message is ground truth from the game, not a label this codebase
        # derived -- the distinction that makes it safe to read here.
        is_fall = sk.get("fail_class") == "fall" or "fell from a high place" in detail
        deaths.append({"ts": ts, "bot": bot, "y": pos.get("y"),
                       "fall": is_fall, "detail": sk.get("detail", "")})
    return deaths

def alert(subject, body):
    """Reach a human. Best-effort, never fatal.

    Transports are read from /etc/mcai-alert.conf so adding one is a config
    change, not a code change. Everything is attempted; one failing transport
    must not suppress the others, because the whole point is that this message
    arrives when other things are broken.

    A trip that stops the fleet silently at 3am is only marginally better than
    the fleet dying silently -- you still find it hours later, now with no bots
    running and no explanation.
    """
    conf = {}
    try:
        for line in open("/etc/mcai-alert.conf"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                conf[k.strip()] = v.strip().strip('"\'')
    except Exception:
        pass

    # Always: journald, so `journalctl -t mcai-tripper` is a complete record
    # even when every network transport is down.
    subprocess.run(["logger", "-t", "mcai-tripper", "-p", "user.err",
                    f"{subject} :: {body}"], check=False)

    url = conf.get("ALERT_WEBHOOK", "")
    if url:
        try:
            if "ntfy" in url:
                # ntfy takes a PLAIN body with metadata in headers. Posting the
                # Discord-shaped JSON to it "worked" -- 200, message delivered --
                # but rendered the raw JSON on the phone. A transport that
                # succeeds while producing something unreadable is worse than one
                # that fails, because nothing tells you it is broken.
                subprocess.run(["curl", "-s", "-o", "/dev/null", "--max-time", "15",
                                "-H", f"Title: {subject}", "-H", "Priority: high",
                                "-H", "Tags: warning,robot",
                                "--data-binary", "@-", url],
                               input=body, text=True, timeout=20)
            else:
                # One payload with several key names, so the same config works
                # for Discord, Slack and Home Assistant without per-service code.
                payload = json.dumps({"content": f"**{subject}**\n{body}",
                                      "text": f"{subject}\n{body}",
                                      "title": subject, "body": body})
                subprocess.run(["curl", "-s", "-o", "/dev/null", "--max-time", "15",
                                "-X", "POST", "-H", "Content-Type: application/json",
                                "--data-binary", "@-", url],
                               input=payload, text=True, timeout=20)
        except Exception:
            pass

    to = conf.get("ALERT_EMAIL", "")
    if to and os.path.exists("/usr/sbin/sendmail"):
        try:
            subprocess.run(["/usr/sbin/sendmail", "-t"], text=True, timeout=20,
                           input=f"To: {to}\nSubject: [mcai] {subject}\n\n{body}\n")
        except Exception:
            pass

def ship(trips, stopped, per_bot, falls30, depth, bundle=None):
    """Send the supervisor's own activity to Elasticsearch.

    EVERY run is shipped, not just the ones that trip. A dashboard that only
    shows interventions cannot distinguish "nothing is wrong" from "the
    supervisor has been dead for six hours" -- which is the same class of blind
    spot that let a fleet die 80 times while every liveness check reported
    healthy. The heartbeat IS the signal.

    Shipped as mcai_ship, an account that can append to mcai-* and do nothing
    else -- it cannot delete an index or read anything back.
    """
    try:
        pw = open("/root/.mcai_ship_password").read().strip()
    except Exception:
        return
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    docs = [{
        "@timestamp": now, "run_id": "supervisor",
        "host": {"name": os.uname().nodename},
        "supervisor": {
            "check": "death_tripper", "tripped": bool(trips),
            "reason": "; ".join(r for _, r in trips) or "no threshold tripped",
            "scope": sorted({sc for sc, _ in trips}) or ["none"],
            "action": "stop" if stopped else ("would_stop" if trips else "none"),
            "bots_stopped": stopped, "deaths_30m": len(falls30),
            "falls_30m": len(falls30), "falls_depth_60m": len(depth),
            "dry_run": DRY, "incident": os.path.basename(bundle) if bundle else "",
        }}]
    for bot, n in per_bot.items():
        docs.append({"@timestamp": now, "run_id": "supervisor",
                     "host": {"name": os.uname().nodename},
                     "bot": {"name": bot, "falls": n},
                     "supervisor": {"check": "per_bot_falls", "tripped": n >= BOT_FALLS_30M,
                                    "falls_30m": n, "dry_run": DRY}})
    body = "".join(json.dumps({"create": {}}) + "\n" + json.dumps(d) + "\n" for d in docs)
    try:
        subprocess.run(["curl", "-s", "-o", "/dev/null", "-u", f"mcai_ship:{pw}",
                        "-X", "POST", "http://192.168.193.30:9200/mcai-supervisor-lab/_bulk",
                        "-H", "Content-Type: application/x-ndjson", "--data-binary", "@-"],
                       input=body, text=True, timeout=20)
    except Exception as e:
        print(f"    (could not ship supervisor telemetry: {e})")

def version_check():
    """Are all bots running the same code, and is it the code the trial declares?

    Two distinct failures, both making the run uninterpretable:

      DISAGREEMENT  bots reporting different versions means a partial deploy --
                    half the fleet on old code. Any aggregate across them is a
                    blend of two systems.
      UNDECLARED    the fleet reporting something other than what the manifest
                    declares means somebody changed code without saying so.

    The reported version is `<sha>+<digest of the .mjs actually loaded>`, so a
    hand-copied file changes the digest even when the sha is untouched. That is
    the whole reason the digest exists: a stale CODE_VERSION misattributed
    eleven hours of documents to a commit that was not running.

    Only bots that logged inside VERSION_FRESH_MIN count. A bot's last log line
    survives the bot: a stopped bot keeps reporting whatever it was running when
    it died, forever. On 2026-08-07 that turned this rule into a suicide loop --
    the tripper stopped Gather02 on the old code, the deploy moved the other
    seven forward, and Gather02's corpse then outvoted the live fleet every five
    minutes, stopping all eight bots each time. A version is evidence about the
    RUNNING fleet only for as long as the bot reporting it is still running.
    """
    fresh_min = int(os.environ.get("VERSION_FRESH_MIN", "15"))
    since = datetime.now(timezone.utc) - timedelta(minutes=fresh_min)
    r = ssh(EVD, f"tail -q -n 400 {(LOGS if LOCAL else ARCHIVE + '/*.jsonl')} 2>/dev/null")
    seen, stale = {}, {}
    for line in r.stdout.splitlines():
        try:
            d = json.loads(line)
        except Exception:
            continue
        v = (d.get("code") or {}).get("version")
        b = (d.get("bot") or {}).get("name")
        # The arm is what makes a config difference legitimate or not. Records
        # have carried it since the exp block was added; older lines have none.
        arm = (d.get("exp") or {}).get("arm")
        if not (v and b):
            continue
        try:
            ts = datetime.fromisoformat(d["@timestamp"].replace("Z", "+00:00"))
        except Exception:
            continue
        # An unparseable or missing timestamp is not a licence to assume fresh.
        if ts < since:
            stale[b] = v
            continue
        # NEWEST BY TIMESTAMP, not last-encountered. `tail -q` concatenates
        # several files, so file order is not time order: a bot's pre-restart
        # line can arrive after its post-restart line and silently overwrite it,
        # which is a restarted fleet reporting itself as a partial deploy.
        if b not in seen or ts > seen[b][0]:
            seen[b] = (ts, v, arm)
        stale.pop(b, None)
    for b, v in sorted(stale.items()):
        if b not in seen:
            print(f"    ignoring {b} @ {v}: no log line in {fresh_min}m (not running)")
    if not seen:
        return []                      # nothing running yet; not a fault
    problems = []
    versions = {t[1] for t in seen.values()}
    # THE FLEET IS SUPPOSED TO RUN MORE THAN ONE CONFIG.
    #
    # Bots report `sha+config_digest`. This rule compared the whole string while
    # calling the result a disagreement about CODE, so any two bots differing
    # only in configuration read as a partial deploy. That was harmless until
    # the memory scope was folded into the config hash -- which was the point,
    # since the scope is this lab's independent variable and the arms have to be
    # distinguishable in telemetry. From that moment the fleet had two digests
    # permanently, and this rule stopped all eight bots every five minutes:
    #
    #     TRIP ALL: bots disagree on code version
    #               ['28a2cf9+7aeb0b', '28a2cf9+f64e58']
    #
    # Same sha. One code version, two arms -- isolated and private, exactly as
    # designed. Left alone it would also have made the crossover trial
    # impossible by construction, since running two arms at once IS the design.
    #
    # So: disagreement about CODE is a partial deploy and still trips.
    # Disagreement about CONFIG is only a fault WITHIN an arm, checked below.
    codes = {v.split("+")[0] for v in versions}
    # Read the manifest before the disagreement rule: whether a split fleet is a
    # fault depends on whether we are mid-deploy, and only the manifest knows.
    man, declared, fresh_declaration = _declaration()
    if len(codes) > 1:
        # A ROLLING RESTART IS A SPLIT FLEET, BRIEFLY, ON PURPOSE.
        #
        # Bots are restarted one at a time with a gap between them -- the
        # connection throttle on the Minecraft server requires it -- so for
        # roughly a minute half the fleet is genuinely on the old version. That
        # is indistinguishable from a partial deploy by inspection, and on
        # 2026-08-07 the tripper ticked inside that window and stopped all five
        # bots on instance #2 seconds after a correct deploy.
        #
        # Narrow exemption: only while the declaration is fresh, and only if
        # some bot is ALREADY on the declared version -- that is what makes it a
        # deploy in progress rather than a fleet that has drifted. If nobody is
        # on the declared version, nothing is converging and this trips.
        converging = fresh_declaration and declared and declared in codes
        if converging:
            print(f"    {len(codes)} code versions but the declaration is fresh and "
                  f"{declared} is already running: deploy in progress, not judging")
        else:
            problems.append(("ALL", f"bots disagree on code version {sorted(codes)} "
                                    f"-- partial deploy, aggregates are a blend of two systems"))

    # WITHIN AN ARM, the config must agree -- that is the check the rule above
    # was reaching for. Two bots in the same arm running different settings
    # really do blend two systems, and no amount of arm labelling excuses it.
    by_arm = {}
    for b, (_, v, arm) in seen.items():
        if arm:
            by_arm.setdefault(arm, {})[b] = v
    unlabelled = [b for b, t in seen.items() if not t[2]]
    if unlabelled:
        print(f"    no arm on {sorted(unlabelled)}: config split within an arm "
              f"is uncheckable for them")
    for arm, bots in sorted(by_arm.items()):
        digests = {v.split("+")[1] if "+" in v else "" for v in bots.values()}
        if len(digests) > 1 and not fresh_declaration:
            problems.append(("ALL", f"arm {arm} is split across configs "
                                    f"{sorted(set(bots.values()))} -- one arm, two systems"))
    # The manifest holds the sha; the fleet reports sha+digest.
    if declared and not fresh_declaration and versions and \
       not all(v.split("+")[0] == declared for v in versions):
        problems.append(("ALL", f"running {sorted(versions)} but the trial declares "
                                f"{declared} -- undeclared code change, trial uninterpretable"))
    return problems


def _declaration():
    """(manifest, declared sha, is the declaration fresh?).

    A DEPLOY IN PROGRESS IS NOT A FAULT, and two rules need to know it.

    The undeclared-change rule reads the evidence archive, which lags the fleet:
    for a few minutes after a deploy the newest lines available are still
    pre-deploy, so comparing them against a manifest updated seconds ago reports
    "running code nobody declared" about a fleet that is simply mid-restart.

    The disagreement rule has the same problem from the other side: bots restart
    one at a time (the server's connection throttle requires the gap), so a
    rolling restart IS a split fleet for about a minute.

    Both stopped instance #2 within an hour on 2026-08-07, each seconds after a
    correct deploy. So the declaration gets a grace period, keyed to when the
    DECLARATION moved -- not to any observation about the bots. The rules' real
    job is catching code that has been running wrong for a while, and that job
    is untouched by ignoring the first few minutes after a deploy starts.

    An unparseable or missing declared_at grants no grace: fail closed.
    """
    grace_min = int(os.environ.get("DECLARE_GRACE_MIN", "20"))
    try:
        man = json.loads(ssh(LAB, "cat /srv/mcbots/trial-manifest.json").stdout)
    except Exception:
        return {}, "", False
    declared = man.get("declared_code_version", "")
    declared_at = man.get("declared_at")
    fresh = False
    if declared_at:
        try:
            dt = datetime.fromisoformat(str(declared_at).replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - dt).total_seconds() / 60
            fresh = age < grace_min
            if fresh:
                print(f"    declaration is {age:.0f}m old (<{grace_min}m); "
                      f"not judging the fleet mid-deploy")
        except Exception:
            pass
    return man, declared, fresh

def main():
    os.makedirs(INCIDENTS, exist_ok=True)
    d30 = load_deaths(30)
    d60 = load_deaths(60)
    falls30 = [d for d in d30 if d["fall"]]
    falls60 = [d for d in d60 if d["fall"]]

    per_bot = defaultdict(int)
    for d in falls30:
        per_bot[d["bot"]] += 1
    depth = [d for d in falls60
             if d["y"] is not None and DEPTH_BAND[0] <= d["y"] <= DEPTH_BAND[1]]

    trips = []          # (scope, reason)
    for bot, n in per_bot.items():
        if n >= BOT_FALLS_30M:
            trips.append((bot, f"{n} fall deaths in 30m (limit {BOT_FALLS_30M})"))
    if FLEET_FALLS_30M and len(falls30) >= FLEET_FALLS_30M:
        trips.append(("ALL", f"fleet: {len(falls30)} fall deaths in 30m (limit {FLEET_FALLS_30M})"))
    trips.extend(version_check())
    if DEPTH_FALLS_60M and len(depth) >= DEPTH_FALLS_60M:
        trips.append(("ALL", f"{len(depth)} fall deaths at y{DEPTH_BAND[0]}-{DEPTH_BAND[1]} in 60m "
                             f"(limit {DEPTH_FALLS_60M}) -- the historical signature"))

    print(f"  window: {len(d30)} deaths/30m ({len(falls30)} falls), "
          f"{len(depth)} falls at y{DEPTH_BAND[0]}-{DEPTH_BAND[1]}/60m")
    for b, n in sorted(per_bot.items(), key=lambda x: -x[1]):
        print(f"    {b:10} {n} falls/30m")
    if not trips:
        print("  no threshold tripped")
        ship([], [], per_bot, falls30, depth)
        return 0

    units = unit_map()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bundle = os.path.join(INCIDENTS, f"incident-{stamp}.json")
    targets = set()
    for scope, reason in trips:
        print(f"  TRIP  {scope}: {reason}")
        targets |= set(units) if scope == "ALL" else {scope}

    stopped = []
    for bot in sorted(targets):
        unit = units.get(bot)
        if not unit:
            print(f"    {bot}: no systemd instance found -- NOT stopping something I cannot name")
            continue
        if DRY:
            print(f"    would stop mcbot@{unit} ({bot})")
        else:
            r = ssh(LAB, f"systemctl stop mcbot@{unit}" if LOCAL else f"sudo -n systemctl stop mcbot@{unit}")
            ok = r.returncode == 0
            print(f"    stop mcbot@{unit} ({bot}): {'ok' if ok else 'FAILED ' + r.stderr.strip()[:80]}")
            if ok:
                stopped.append(bot)

    # The incident bundle is the point: a fleet found stopped with no explanation
    # is barely better than one found dead.
    with open(bundle, "w") as f:
        json.dump({"at": stamp, "trips": trips, "stopped": stopped, "dry_run": DRY,
                   "falls_30m": [{"bot": d["bot"], "y": d["y"], "detail": d["detail"]}
                                 for d in falls30]}, f, indent=1, default=str)
    print(f"  incident: {bundle}")
    ship(trips, stopped, per_bot, falls30, depth, bundle)
    alert(f"fleet tripped: {len(stopped)} bot(s) stopped",
          "\n".join(f"- {sc}: {r}" for sc, r in trips)
          + f"\n\nstopped: {', '.join(stopped) or 'none'}"
          + f"\nincident: {bundle}"
          + f"\nfalls/30m: {len(falls30)}  falls y20-39/60m: {len(depth)}")
    return 1

if __name__ == "__main__":
    sys.exit(main())
