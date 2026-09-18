"""
A canary that was deployed and never read is indistinguishable from work that
never happened.

Measured 2026-09-04: 100 memory entries, 25 mentioning that anything shipped,
17 correcting an earlier finding. Five commits sat on `main` undeployed --
including all three drowning fixes -- while that same day produced six fresh
analyses and one commit. None of those analyses were wrong. That is the point.

So this is the mechanism under the "Done means read on the fleet" rule, built
the way `ZeroLooksWrong` is built: it does not ask anyone to remember, it
raises.

FAIL CLOSED, and this is the one deliberate inversion in the codebase.

`drownRescueSuppressed` fails OPEN -- junk input means rescue the bot, because
the cost of a false "suppress" is a death. Here the costs point the other way:
a false "all clear" is exactly the failure being guarded, and the cost of a
false alarm is that somebody looks at a manifest. An unreadable decisions file
is therefore an OPEN loop, never a closed one.
"""

import datetime as _dt

#: The three ways a canary may be closed. INCONCLUSIVE is a legitimate close and
#: is frequently the honest one -- two readings inside the 2.36x between-pool
#: noise band is not a result. What is forbidden is closing nothing at all.
VERDICTS = ('KEEP', 'REVERT', 'INCONCLUSIVE')


class OpenLoop(Exception):
    """Raised when a canary is deployed and no decision has been recorded."""


def _pool(manifest):
    """`canary_pool` is a scalar in the shell scripts and a set in the classifier."""
    p = manifest.get('canary_pool')
    if p is None or p == '':
        return []
    return [p] if isinstance(p, str) else [x for x in p if x]


def canary_sha(manifest):
    """
    The declared canary version, under either of its two names.

    `deploy-fleet.sh` writes `canary_code_version`; the classifier and the
    analysis scripts say `canary_sha`. Both name the same thing. This exists as
    ONE function because the reader and the recorder disagreed about it once --
    the reader was taught both names and the recorder was not, so a genuinely
    open trial could be detected and then not closed.
    """
    if not isinstance(manifest, dict):
        return ''
    return manifest.get('canary_code_version') or manifest.get('canary_sha') or ''


def _ts(value):
    """
    Parse an ISO-8601 stamp to an aware datetime, or None when it cannot be.

    Both the manifest's `declared_at` and the ledger's `ts` are written by
    `datetime.isoformat()`, but the manifest's carries a trailing `Z` that
    `fromisoformat` refused before Python 3.11. Naive stamps are read as UTC:
    every writer here is UTC, and refusing them would make the guard useless on
    exactly the hand-written manifest it most needs to judge.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        t = _dt.datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def _norm_pool(value):
    """
    A pool list as a comparable set, whatever shape it was written in.

    The shell scripts write `"board-b,hive-a"`; the classifier writes a list.
    Order is not meaningful and whitespace is accidental, so neither may decide
    whether two deployments are the same one.
    """
    if value is None:
        return frozenset()
    parts = value.split(',') if isinstance(value, str) else list(value)
    return frozenset(x.strip() for x in parts if str(x).strip())


def open_loop(manifest, decisions):
    """
    Return a reason string when a loop is open, or None when nothing is open.

    `manifest` is the trial manifest as a dict. `decisions` is an iterable of
    recorded decisions, or None when the ledger could not be read at all --
    which is an open loop, not an absent one.
    """
    if not isinstance(manifest, dict):
        # Missing counts as unreadable. On this guard's first live run it was
        # pointed at a path that did not exist while placebo-b was mid-trial,
        # and it answered "clear to start something new" -- the precise failure
        # it exists to prevent.
        return 'manifest is missing or unreadable — cannot prove no canary is deployed'

    pool = _pool(manifest)
    if not pool:
        return None                      # no canary declared: nothing is open

    sha = canary_sha(manifest)
    if not sha:
        # A pool with no sha cannot be closed by any decision, because a
        # decision names a sha. Deploy declares both or neither.
        return ('canary_pool is set to %s with no canary_sha — the trial cannot '
                'be closed, and every fleet-recycle is blocked until it is'
                % ', '.join(pool))

    if decisions is None:
        return ('canary %s is deployed on %s and the decision ledger could not '
                'be read — treating that as OPEN' % (sha[:7], ', '.join(pool)))

    # A DECISION CANNOT CLOSE A DEPLOYMENT THAT CAME AFTER IT.
    #
    # Measured 2026-09-18. owner-01 (aa44514) shipped inert, was recorded
    # INCONCLUSIVE at 12:59:51Z and torn down. The identical sha was redeployed
    # 13:04:27Z as owner-01b, and this guard -- which keys on the sha alone --
    # answered "no open canary, clear to start something new" while that canary
    # was live on board-b,hive-a. So the one tripwire under "Done means read on
    # the fleet" was pre-satisfied by the previous trial's own verdict, and it
    # would have green-lit a SECOND canary, which is three versions and a halted
    # fleet. A redeploy of the same sha is routine -- a flag fix, an env fix, a
    # bad pool draw -- so this is not an exotic case.
    #
    # Ordering, not identity, is what makes a decision belong to a deployment.
    declared = _ts(manifest.get('declared_at'))
    if manifest.get('declared_at') and declared is None:
        # Present but unparseable means somebody edited it. Fail closed: that is
        # precisely when a human should look. An ABSENT declared_at is a manifest
        # older than this check, and falls back to matching on the sha alone.
        return ('canary %s is deployed on %s and declared_at (%r) cannot be '
                'parsed — the ledger cannot be ordered against it, treating as OPEN'
                % (sha[:7], ', '.join(pool), manifest.get('declared_at')))

    for d in decisions:
        if not isinstance(d, dict):
            continue
        if (d.get('canary_sha') or '') != sha:
            continue                     # a decision about some other trial
        # ORDERING IS NOT IDENTITY. Found by the ChatGPT review 2026-09-18, which
        # exercised this function: after the ordering fix, a LATER decision
        # carrying the wrong trial still closed the deployment, exactly as the
        # right one would. Today that was survivable only because owner-01 and
        # owner-01b drew different pools; a redeploy to the SAME pools would have
        # been closed by its predecessor's verdict with the ordering check green.
        # The ledger records `canary_pool`, so identity is available -- use it,
        # and fail closed when the two disagree.
        dpool, mpool = d.get('canary_pool'), manifest.get('canary_pool')
        if dpool and mpool and _norm_pool(dpool) != _norm_pool(mpool):
            continue                     # same sha, different deployment
        if (d.get('decision') or '').upper() not in VERDICTS:
            continue
        if declared is not None:
            when = _ts(d.get('ts'))
            # No timestamp, or one predating this deployment, cannot prove the
            # decision is ABOUT this deployment. Fail closed, as the module does
            # everywhere else.
            if when is None or when < declared:
                continue
        return None

    return ('canary %s is deployed on %s with no KEEP/REVERT/INCONCLUSIVE '
            'recorded — read it before starting anything new'
            % (sha[:7], ', '.join(pool)))


def assert_closed(manifest, decisions):
    """Raise `OpenLoop` when a canary is deployed and unread."""
    why = open_loop(manifest, decisions)
    if why:
        raise OpenLoop(why)
