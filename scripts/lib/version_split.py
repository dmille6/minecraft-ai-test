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
