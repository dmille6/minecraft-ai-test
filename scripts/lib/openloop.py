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


def open_loop(manifest, decisions):
    """
    Return a reason string when a loop is open, or None when nothing is open.

    `manifest` is the trial manifest as a dict. `decisions` is an iterable of
    recorded decisions, or None when the ledger could not be read at all --
    which is an open loop, not an absent one.
    """
    if not isinstance(manifest, dict):
        return 'manifest is unreadable — cannot prove no canary is deployed'

    pool = _pool(manifest)
    if not pool:
        return None                      # no canary declared: nothing is open

    sha = manifest.get('canary_sha') or ''
    if not sha:
        # A pool with no sha cannot be closed by any decision, because a
        # decision names a sha. Deploy declares both or neither.
        return ('canary_pool is set to %s with no canary_sha — the trial cannot '
                'be closed, and every fleet-recycle is blocked until it is'
                % ', '.join(pool))

    if decisions is None:
        return ('canary %s is deployed on %s and the decision ledger could not '
                'be read — treating that as OPEN' % (sha[:7], ', '.join(pool)))

    for d in decisions:
        if not isinstance(d, dict):
            continue
        if (d.get('canary_sha') or '') != sha:
            continue                     # a decision about some other trial
        if (d.get('decision') or '').upper() in VERDICTS:
            return None

    return ('canary %s is deployed on %s with no KEEP/REVERT/INCONCLUSIVE '
            'recorded — read it before starting anything new'
            % (sha[:7], ', '.join(pool)))


def assert_closed(manifest, decisions):
    """Raise `OpenLoop` when a canary is deployed and unread."""
    why = open_loop(manifest, decisions)
    if why:
        raise OpenLoop(why)
