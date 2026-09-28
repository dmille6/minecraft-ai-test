"""DID THE DEPLOY LAND ON EXACTLY THE BOTS IT DECLARED?

WHAT THE VERIFIER COULD NEVER SEE. deploy-fleet.sh's verifier counts DISTINCT VERSION STRINGS and
compares that count to 1, or to 2 for a canary. That count is blind to identity, and a canary is
exactly where identity is the question:

    canary-tree.sh writes one drop-in per treated bot, in a loop, with no per-bot check. If one of
    two drop-ins silently fails to apply, the world still shows one canary build and one baseline
    build. Two distinct versions. The verifier passes. The canary is running on half the bots it
    declared, and the manifest says otherwise.

With a whole-pool canary the count check was a weak proxy for this, because a bot left behind on
baseline was a pool member on the wrong build and the TRIPPER would report POOL_NOT_CANARY on its
next run -- minutes later, in a different place, as a fleet fault rather than a failed deploy. With
a within-world canary even that proxy is gone: three bots per world are DELIBERATELY on baseline,
so a fourth one being there is indistinguishable by prefix. Nothing but an exact roster can see it,
and the roster is the reason this module exists.

The same shape as the rest of this file's history: an observation that does not reach the decision
it exists to inform. So the check moved out of an inline heredoc and into a pure function with
cases, and it now asks the question the deploy actually needs answered -- is every bot I declared
reporting the build I declared for it -- instead of a countable proxy for it.

SILENCE IS NOT A VERDICT, EXCEPT ON A TREATED BOT. A bot that has not logged since the restart is
"not reporting yet", never "still on the old code": taking a pre-restart line as a bot's current
version reported a converged fleet as split, and the tripper had to be taught the same lesson where
a stopped bot's final line outvoted the living. That stays. But a bot in the ROSTER is different in
kind, because its drop-in is the thing being verified -- an unreported treated bot is an
unverified drop-in, and reporting it as merely quiet would let exactly the failure above through.
So control silence is reported and treated silence FAILS, and the asymmetry is the finding.
"""

FAIL, WARN, OK = 'FAIL', 'WARN', 'OK'


def latest_per_bot(rows, since=None):
    """{bot: version} from (bot, ts, version) triples, keeping the newest per bot.

    `since` drops anything at or before the restart mark. Comparison is on whatever `ts` is, so
    the caller chooses the type; passing datetimes or ISO strings both order correctly, and mixing
    them is the caller's bug rather than a silent one.
    """
    seen = {}
    for bot, ts, version in rows:
        if not (bot and version):
            continue
        if since is not None and ts is not None and ts <= since:
            continue
        if bot not in seen or ts > seen[bot][0]:
            seen[bot] = (ts, version)
    return {b: v for b, (_, v) in seen.items()}


def verify(seen, decl, base_version=None, canary_version=None, live=()):
    """(ok, [(level, message)]).

    `seen`  {bot: full version string} -- post-restart reports only.
    `decl`  a canary_manifest.Declaration.
    `base_version`/`canary_version` the full `sha+digest` strings when known. They are usually NOT
            known at deploy time -- the digest is computed by the bot from the source it loaded --
            so when they are None the builds are INFERRED from what the roster and the controls
            report, and an inference that cannot be made is a finding rather than a guess.
    `live`  every active unit, so bots that have not reported can be named.
    """
    from version_split import in_canary_pool

    findings = []
    ok = True

    def add(level, msg):
        nonlocal ok
        findings.append((level, msg))
        if level == FAIL:
            ok = False

    if not seen:
        add(FAIL, 'no bot has logged since the restart -- convergence is UNKNOWN, not confirmed')
        return False, findings

    live = list(live) if live else sorted(seen)
    versions = sorted(set(seen.values()))
    want_n = 2 if decl.has_canary else 1

    # ---- the count check, unchanged in meaning ------------------------------------------
    if len(versions) != want_n:
        add(FAIL, f'live bots report {len(versions)} version(s), expected {want_n}: '
                  f'{" ".join(versions)}')
        if decl.has_canary:
            add(FAIL, 'a canary that is not split is not a canary -- either the treated bots did '
                      'not restart, or the controls restarted too. Check before trusting any '
                      'comparison between them.')
        else:
            add(FAIL, 'the fleet is split -- aggregates blend two builds until this is one line')
    else:
        add(OK, ('all live bots on ' + versions[0]) if want_n == 1
                else 'two builds live: ' + ' '.join(versions))

    # ---- quiet bots: reported, not enforced ... unless they are treated -----------------
    quiet = [b for b in live if b not in seen]
    treated_quiet = [b for b in quiet if in_canary_pool(b, decl.canary_members)]
    control_quiet = [b for b in quiet if b not in treated_quiet]
    if control_quiet:
        add(WARN, f'{len(control_quiet)} bot(s) have not logged since the restart yet: '
                  + ' '.join(sorted(control_quiet)))

    if not decl.has_canary:
        return ok, findings

    # ---- MEMBERSHIP, per bot. Only reachable with a declared membership -----------------
    if treated_quiet:
        add(FAIL, f'{len(treated_quiet)} DECLARED canary bot(s) have not reported since the '
                  'restart, so their drop-in is unverified: ' + ' '.join(sorted(treated_quiet)))

    declared = [b for b in live if in_canary_pool(b, decl.canary_members)]
    if not declared:
        add(FAIL, 'the declaration names no live bot -- nothing was treated')
        return False, findings

    # Infer the builds when they were not passed. ORDER MATTERS AND IS THE POINT: the CONTROLS
    # define the baseline, and the canary build is then whatever a treated bot reports that is not
    # the baseline. Inferring the canary build from "what the treated bots agree on" instead looks
    # equivalent and is not -- when one drop-in of two fails, the treated bots agree on nothing, so
    # that inference gives up and reports "no single canary build", which is true but names the
    # whole roster instead of the one bot that failed. Anchoring on the controls keeps the failure
    # attributable to a bot, which is what somebody has to act on.
    treated_seen = {b: seen[b] for b in declared if b in seen}
    control_seen = {b: v for b, v in seen.items() if b not in declared}
    if base_version is None:
        bv = sorted(set(control_seen.values()))
        if len(bv) == 1:
            base_version = bv[0]
        elif len(bv) > 1:
            add(FAIL, 'the control bots report ' + str(len(bv)) + ' different builds, so there is '
                      'no baseline to compare against: ' + ' '.join(bv))
            # THE 2026-08-30 CASE, NAMED. A control that restarts during a canary comes back on
            # canary source, and with the baseline unknown the loop below cannot run. Name it from
            # the other direction instead: a build the TREATED bots agree on, showing up on a
            # control, is contamination and not a second baseline. board-d-Bravo ran canary code
            # as a control for hours while the count check returned ok.
            agreed = {v for v in treated_seen.values()}
            if len(agreed) == 1:
                carrying = sorted(b for b, v in control_seen.items() if v in agreed)
                if carrying:
                    add(FAIL, f'{len(carrying)} control(s) are running the canary build '
                              f'{agreed.pop()} -- contamination, not a baseline: '
                              + ' '.join(carrying))
        else:
            add(FAIL, 'no control bot has reported, so the baseline build is unknown')
    if canary_version is None:
        cv = sorted({v for v in treated_seen.values() if v != base_version})
        if len(cv) == 1:
            canary_version = cv[0]
        elif len(cv) > 1:
            add(FAIL, 'the declared canary bots report ' + str(len(cv)) + ' non-baseline builds, '
                      'so there is no single canary build: '
                      + ', '.join(f'{b}@{v}' for b, v in sorted(treated_seen.items())))
        else:
            add(FAIL, 'no declared canary bot reports a build different from the baseline '
                      f'{base_version} -- nothing was treated: '
                      + ', '.join(f'{b}@{v}' for b, v in sorted(treated_seen.items())))

    if canary_version is None or base_version is None:
        return ok, findings
    if canary_version == base_version:
        add(FAIL, f'the canary and the control report the same build {canary_version} -- '
                  'the split did not happen')
        return False, findings

    wrong = []
    for bot in sorted(seen):
        want = canary_version if in_canary_pool(bot, decl.canary_members) else base_version
        if seen[bot] != want:
            role = 'DECLARED canary' if in_canary_pool(bot, decl.canary_members) else 'control'
            wrong.append(f'{bot} is a {role} reporting {seen[bot]}, expected {want}')
    if wrong:
        add(FAIL, f'{len(wrong)} bot(s) are on the wrong build: ' + '; '.join(wrong[:8]))
    else:
        # `treated_seen`, NOT `declared`. `declared` counts bots that have not reported, so this
        # line read "every one of 4 declared bot(s) reports <canary>" on a fleet where three had
        # reported and the fourth was the unverified drop-in named in the FAIL just above it -- a
        # summary contradicting the finding it followed.
        add(OK, f'every one of {len(treated_seen)} reporting declared bot(s) is on '
                f'{canary_version}; all {len(control_seen)} reporting control(s) on {base_version}')
    # ONLY WHEN NOTHING FAILED. This line used to print unconditionally, so a deploy with a failed
    # drop-in ended on "within-world split verified by roster" -- a green last line over a red
    # finding, which is how the old verifier's `bad` calls got read past on six deploys in one day.
    if ok and decl.is_split:
        add(OK, f'within-world split verified by roster across {len(decl.pools)} world(s): '
                + ','.join(decl.pools))
    return ok, findings


def teardown_ok(seen, decl):
    """AFTER a teardown, is the fleet one declared build again?

    CLAUDE.md says to "confirm exactly two versions are live" after a teardown. That number is
    wrong for the case it is written about, and the difference matters because it is the assertion
    that decides whether a teardown is finished.

    Two is what a fleet runs while a canary IS declared. Teardown step 2 clears `canary_pool` and
    `canary_code_version`, so once it has run there is ONE declared build and the correct final
    state is ONE version live -- which is also what `deploy-fleet.sh` requires (`EXPECT=1` with no
    --pool) and what `canary_split_ok_n` requires, since with no canary it refuses any split as
    "no canary declared". Confirming two after a full teardown would confirm the exact failure
    CLAUDE.md is warning about: the drop-ins gone, the manifest clear, and five bots still running
    canary code from memory because nothing restarted them.

    So this asserts the DECLARATION rather than a remembered count: every live bot on the single
    declared build.
    """
    findings = []
    if not seen:
        return False, [(FAIL, 'no bot reported after the teardown restarts -- '
                              'the teardown is UNVERIFIED')]
    if decl.has_canary:
        return False, [(FAIL, 'the manifest still declares a canary '
                              f'({decl.describe()}) -- teardown step 2 did not happen')]
    versions = sorted(set(seen.values()))
    if len(versions) != 1:
        stragglers = {}
        for b, v in seen.items():
            stragglers.setdefault(v, []).append(b)
        worst = sorted(stragglers.items(), key=lambda kv: len(kv[1]))[0]
        return False, [(FAIL, f'{len(versions)} builds live after teardown, the declaration says '
                              f'ONE ({decl.base_sha}): {" ".join(versions)}'),
                       (FAIL, f'still on {worst[0]}: {" ".join(sorted(worst[1]))} -- these kept '
                              'running canary code from memory; restarting them is teardown '
                              'step 3')]
    if decl.base_sha and not versions[0].startswith(decl.base_sha):
        return False, [(FAIL, f'all bots agree on {versions[0]} but the manifest declares '
                              f'{decl.base_sha}')]
    findings.append((OK, f'teardown verified: all {len(seen)} reporting bot(s) on the single '
                         f'declared build {versions[0]}'))
    return True, findings
