"""
WHICH BOTS ARE RUNNING CODE THEY SHOULD NOT BE.

A PURE CLASSIFIER, deliberately. The guard this serves can stop systemd units,
and tonight it twice did the wrong thing for reasons no test could have caught,
because the logic was tangled up with discovering logs, the wall clock and the
manifest. Everything here is arguments in, verdicts out.

THE IDENTITY IS THE FULL VERSION STRING. `<sha>+<digest>`: the sha is a label
written into an env file, the DIGEST is the hash of the .mjs actually loaded.
A control that restarts during a canary comes back running canary code while
still carrying the baseline label -- `16e7e77+d12017` -- and comparing shas
calls that clean. It is not clean; it is the contamination.

WHY DIGESTS MUST BE DECLARED. With only bare shas in the manifest, these two
facts are indistinguishable:

    16e7e77+d12017   a control that restarted onto stale canary source
    16e7e77+d12017   somebody edited the source under the baseline label

The first is contamination and should stop two bots. The second is an
undeclared change and should stop everything. Telling them apart requires
knowing which digests have ever been deployed as a canary, so the manifest
records them and this refuses to guess.
"""

ALL_UNDECLARED = "undeclared code change"
CANARY_OUTSIDE_POOL = "canary build outside canary pool"
POOL_NOT_CANARY = "canary pool bot not on canary build"
CONTAMINATION = "stale canary digest under baseline sha"


def digest_of(version):
    return version.split("+", 1)[1] if version and "+" in version else ""


def classify(seen, decl):
    """`seen` is {bot: (timestamp, version)} or {bot: version}. Returns
    [(who, reason)]; `who` is a bot name, or "ALL" when the whole fleet is
    uninterpretable.

    A fresh declaration (a rolling restart in progress) suppresses everything:
    bots restart one at a time because the server throttles connections, so a
    split IS the expected state for about a minute.
    """
    if not seen:
        return []
    if getattr(decl, "fresh", False):
        return []

    def ver(v):
        return v[1] if isinstance(v, (tuple, list)) else v

    baseline = f"{decl.base_sha}+{decl.base_digest}" if decl.base_digest else None
    canary = (f"{decl.canary_sha}+{decl.canary_digest}"
              if decl.canary_sha and decl.canary_digest else None)
    pool = set(decl.canary_pool or ())
    known_canary = set(decl.known_canary_digests or ())
    if canary:
        known_canary.add(digest_of(canary))

    out, unknown = [], []
    for bot in sorted(seen):
        v = ver(seen[bot])
        in_pool = bot in pool
        if canary and v == canary:
            # Right code, wrong bot: a control on the canary build.
            if not in_pool:
                out.append((bot, CANARY_OUTSIDE_POOL))
            continue
        if baseline and v == baseline:
            # Right code, wrong bot the other way: a pool member left behind.
            if in_pool:
                out.append((bot, POOL_NOT_CANARY))
            continue
        if digest_of(v) in known_canary:
            # A digest we have deployed as a canary, on a build string we did
            # not declare. That is a control that restarted onto canary source.
            out.append((bot, CONTAMINATION))
            continue
        unknown.append(f"{bot}@{v}")

    if unknown:
        # NOT per-bot. Code nobody declared makes every aggregate a blend, and
        # which bots carry it is not the point -- the trial is uninterpretable.
        return [("ALL", f"{ALL_UNDECLARED}: {', '.join(sorted(unknown)[:6])}")]
    return out


# ---------------------------------------------------------------------------
# CONSOLIDATED 2026-09-19. These two lived INLINE in infra/guard/death-tripper.py
# while `classify` above lived here, so the same rules had two homes and only
# one of them had tests. The tripper's own comment records what that cost:
# "duplicating it here made the same state trip twice -- once correctly, naming
# two contaminated controls, and once as ("ALL", ...) which would have stopped
# eighty bots to correct two."
#
# `canary_split_ok` is the gate that decides whether a two-version fleet is a
# DECLARED canary or an undeclared split. It ran before `classify`, it can stop
# systemd units, and until this move it had no test of any kind.
#
# Moved verbatim. No behaviour change is intended and the existing cases must
# stay green; the new cases below it are the first this gate has ever had.
# ---------------------------------------------------------------------------

def in_canary_pool(bot, canary_pool):
    """`canary_pool` is one pool name or a comma-separated list of them (two pools of five since 2026-09-13);
    a bot is in the canary when its pool prefix is any of them. Exact prefix match, never a substring."""
    return any(bot.startswith(p.strip() + "-") for p in str(canary_pool or "").split(",") if p.strip())


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
        in_pool = in_canary_pool(bot, canary_pool)
        on_canary = v in canary_full
        if in_pool != on_canary:
            wrong.append(f"{bot}@{v.split('+')[0]}"
                         + (" (in pool, not on canary)" if in_pool else " (on canary, not in pool)"))
    if wrong:
        return False, "canary membership does not match the split: " + ", ".join(wrong[:6])
    n = sum(1 for b in seen if in_canary_pool(b, canary_pool))
    return True, f"declared canary: {n} bot(s) of pool {canary_pool} on {canary_version}"
