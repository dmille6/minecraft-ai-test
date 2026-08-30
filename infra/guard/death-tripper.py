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
import glob, json, os, re, subprocess, sys, time
from collections import defaultdict
from datetime import datetime, timezone, timedelta

# LOCAL mode: instance #1 has no evidence host, so the tripper runs on the bot
# host and reads its own logs. Less isolated than reading an archive on a machine
# that runs no agent code -- but the thing it stops lives on this host too, so if
# this host is gone the bots are gone with it.
LOCAL     = os.environ.get("TRIPPER_LOCAL", "") == "1"
# THE LOGS MOVED AND THIS DID NOT. `/srv/mcbots/logs/*.jsonl` matches ZERO files
# on the current bot host; the fleet writes `/var/log/mcai/<bot>/skill-*.jsonl`
# (84 files). Combined with the manifest being read over ssh from a host
# decommissioned on 2026-08-20, the version guard could not see the fleet OR its
# declaration -- it returned "nothing running yet; not a fault" on every run.
LOGS      = os.environ.get("LOG_GLOB", "/var/log/mcai/*/skill-*.jsonl")
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

def canary_split_ok(seen, declared, canary_version, canary_pool):
    """Is this two-version fleet a DECLARED canary rather than a partial deploy?

    A CANARY IS A SPLIT FLEET ON PURPOSE, FOR HOURS.
    ---------------------------------------------------------------------------
    The rolling-restart exemption above lasts only while the declaration is
    fresh, because a rolling restart is over in a minute. A canary is the same
    observation -- two versions running at once -- with the opposite intent and
    a much longer life: one pool of five bots carries a change while the other
    thirty-five stay on the baseline, so the change can be measured against a
    control that is running right now in an identical world.

    That is worth having. Six fleet-wide deploys and two reverts in one day cost
    roughly 80 bot-hours of degraded fleet; the same mistakes caught on one pool
    in twenty minutes cost under two. But an undeclared split is still the
    failure this rule exists for -- half the fleet quietly on old code makes
    every aggregate a blend -- so the exemption has to be narrow, and it is:

      * the manifest must name the canary pool AND its version, in advance;
      * exactly two versions may be running, no more;
      * every bot on the canary version must be IN that pool;
      * every bot in that pool must be on the canary version.

    The last clause is the one that matters and it is easy to leave out. Without
    it a canary declaration would excuse any split that happened to include the
    canary version -- including a failed rollout that stranded four random bots
    on the new code. Membership has to be exact in both directions, or this is
    a licence rather than a rule.

    THE DIGEST IS THE DISCRIMINATOR, AND THIS THREW IT AWAY.
    ---------------------------------------------------------------------------
    `base` used to strip `+digest` and compare bare shas. deploy-fleet.sh copies
    the new source over $H/src for EVERY bot and relies on the controls not being
    restarted, so a control that restarts for its own reasons -- a crash, the
    watchdog, an operator -- comes back running CANARY CODE under a BASELINE
    label: `16e7e77+71154f`. Stripping the digest collapses that to `16e7e77`,
    identical to a real baseline bot, and the check passed.

    deploy-fleet.sh's own comment asserts the opposite: "such a bot reports
    baseline-sha with the CANARY digest, so it is a third distinct version
    string, canary_split_ok refuses anything that is not exactly two." The digest
    exists for exactly this case and the comparison discarded it -- a comment
    describing behaviour the code never had.

    Observed 2026-08-30: board-d-Bravo running canary code as a control, for
    hours, while this returned ok. Full strings are compared now.

    `seen` is {bot: version}; versions carry the +digest suffix, the manifest
    holds bare shas.
    """
    if not (canary_version and canary_pool):
        return False, "no canary declared"
    full = set(seen.values())
    if len(full) != 2:
        return False, (f"{len(full)} distinct builds running, a canary is exactly "
                       f"two: {sorted(full)}")
    base = {v.split("+")[0] for v in seen.values()}
    if len(base) != 2:
        return False, (f"two builds but {len(base)} sha(s): a control is running "
                       f"canary code under a baseline label -- {sorted(full)}")
    if base != {declared, canary_version}:
        return False, (f"running {sorted(base)} but the canary declares "
                       f"{sorted({declared, canary_version})}")
    # Membership is checked on the FULL string too, so a bot carrying the canary
    # digest under a baseline sha is counted as being on the canary build --
    # which is what it actually is, and what makes it a membership violation.
    canary_full = {v for v in full if v.split("+")[0] == canary_version}
    wrong = []
    for bot, v in sorted(seen.items()):
        in_pool = bot.startswith(canary_pool + "-")
        on_canary = v in canary_full
        if in_pool != on_canary:
            wrong.append(f"{bot}@{v.split('+')[0]}"
                         + (" (in pool, not on canary)" if in_pool else " (on canary, not in pool)"))
    if wrong:
        return False, "canary membership does not match the split: " + ", ".join(wrong[:6])
    n = sum(1 for b in seen if b.startswith(canary_pool + "-"))
    return True, f"declared canary: {n} bot(s) of pool {canary_pool} on {canary_version}"


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
    # LOCAL FIRST, for the same reason as the manifest: EVD is on the retired
    # instance-#2 network. Only the NEWEST lines are wanted here (what is running
    # right now), so a bounded tail is legitimate -- unlike a baseline walk.
    if glob.glob(LOGS):
        r = sh(f"tail -q -n 400 {LOGS} 2>/dev/null")
    else:
        r = ssh(EVD, f"tail -q -n 400 {(LOGS if LOCAL else ARCHIVE + '/*.jsonl')} 2>/dev/null")
    seen, stale = {}, {}
    for line in r.stdout.splitlines():
        try:
            d = json.loads(line)
        except Exception:
            continue
        v = (d.get("code") or {}).get("version")
        b = (d.get("bot") or {}).get("name")
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
            seen[b] = (ts, v)
        stale.pop(b, None)
    for b, v in sorted(stale.items()):
        if b not in seen:
            print(f"    ignoring {b} @ {v}: no log line in {fresh_min}m (not running)")
    if not seen:
        return []                      # nothing running yet; not a fault
    problems = []
    versions = {v for _, v in seen.values()}
    # Read the manifest before the disagreement rule: whether a split fleet is a
    # fault depends on whether we are mid-deploy, and only the manifest knows.
    man, declared, fresh_declaration = _declaration()
    canary_ok = False
    if len(versions) > 1:
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
        converging = fresh_declaration and declared and \
            any(v.split("+")[0] == declared for v in versions)
        canary_ok, canary_why = canary_split_ok(
            {b: v for b, (_, v) in seen.items()}, declared,
            man.get("canary_code_version", ""), man.get("canary_pool", ""))
        if canary_ok:
            print(f"    {canary_why} -- split is declared, not judging")
        elif converging:
            print(f"    {len(versions)} versions but the declaration is fresh and "
                  f"{declared} is already running: deploy in progress, not judging")
        else:
            if man.get("canary_pool"):
                print(f"    a canary is declared but does not explain this split: {canary_why}")
            # SCOPE THE STOP TO THE OFFENDERS, NOT THE FLEET.
            #
            # "ALL" is right for a genuine undeclared split -- half the fleet on
            # old code makes every aggregate a blend. It is disproportionate for
            # the case that actually happens: a declared canary where one or two
            # CONTROLS restarted onto the canary source and now carry its digest
            # under a baseline label. Stopping 80 bots to correct 2 is an outage
            # in response to a contamination.
            #
            # And it cannot be corrected by restarting them: while a canary is
            # live, $H/src holds the canary build, so a restarted control comes
            # back contaminated again. Stopping the offenders keeps them out of
            # the data, which is the actual harm.
            # `seen` maps bot -> (timestamp, version), NOT bot -> version. The
            # first version of this grouped on the whole tuple, which is unique
            # per bot, so every group had size one and it selected an arbitrary
            # HEALTHY control to stop. Caught by running it non-destructively
            # before installing -- which is the only reason it never ran.
            def _ver(x):
                return x[1] if isinstance(x, (tuple, list)) else x
            minority = None
            if declared and man.get("canary_pool"):
                by_ver = {}
                for b, v in seen.items():
                    by_ver.setdefault(_ver(v), []).append(b)
                small = sorted(by_ver.values(), key=len)[0]
                if len(small) <= 3 and len(small) < len(seen) / 4:
                    minority = small
            if minority:
                others = sorted({_ver(v) for b, v in seen.items() if b not in minority})
                for b in minority:
                    problems.append((b, f"running {_ver(seen[b])} while the fleet runs "
                                        f"{others} -- a control restarted onto canary "
                                        f"source; stopping it keeps it out of the comparison"))
            else:
                problems.append(("ALL", f"bots disagree on code version {sorted(versions)} "
                                    f"-- partial deploy, aggregates are a blend of two systems"))
    # The manifest holds the sha; the fleet reports sha+digest.
    # The canary version is DECLARED code, so it is not an undeclared change --
    # but only when the split itself checked out above. A canary named in the
    # manifest whose membership is wrong must not launder the version past this
    # rule as well; that would turn one bad declaration into two silent holes.
    allowed = {declared}
    if canary_ok:
        allowed.add(man.get("canary_code_version", ""))
    if declared and not fresh_declaration and versions and \
       not all(v.split("+")[0] in allowed for v in versions):
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
    # LOCAL FIRST. This read `ssh(LAB, ...)` unconditionally, and LAB defaults to
    # 192.168.193.40 -- a host on the old instance-#2 network that was
    # decommissioned on 2026-08-20. The ssh fails, the except returns empty, and
    # so `declared` is "" and `canary_pool` is None on every run.
    #
    # THE CONSEQUENCE, unnoticed until 2026-08-30: canary_split_ok returns
    # immediately on "no canary declared", so the ENTIRE version-disagreement
    # guard has been inert. Two control bots ran canary code for hours while this
    # reported clean, and a correctness fix I made to the split comparison
    # changed nothing in production because the function it lives in never runs.
    #
    # The tripper now runs on the bot host itself -- it stops units there -- so
    # the manifest is a local file. The remote read is kept as a fallback for the
    # two-host topology this was written for, but it is no longer the only path.
    TRIAL = os.environ.get("TRIAL_MANIFEST", "/srv/mcbots/trial-manifest.json")
    man = None
    try:
        with open(TRIAL) as fh:
            man = json.load(fh)
    except Exception:
        try:
            man = json.loads(ssh(LAB, f"cat {TRIAL}").stdout)
        except Exception:
            man = None
    if not man:
        # NOT a silent pass. An unreadable declaration means this guard cannot
        # do its job, and saying so is the difference between "clean" and "blind"
        # -- the distinction that let this sit broken.
        print("    cannot read the trial manifest -- version rules are BLIND")
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
