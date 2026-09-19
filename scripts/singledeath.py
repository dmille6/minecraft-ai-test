"""
v23 — NO SINGLE CANARY DEATH MAY LICENCE A REVERT BY ANY PATH.

WHY THIS IS A FUNCTION AND NOT AN `and` IN THE CALLER.
-------------------------------------------------------------------------------
The owner's two-death floor (2026-09-11) was written for the AGGREGATE death
gate, and v21 (2026-09-18) gave that gate an honest test -- the lower bound of
the rate ratio, calibrated 43.7% -> 5.0% false revert. Both of those live in one
branch of `verdict.py`.

The change-row LICENCE path is a different branch, and it bypassed both. On
2026-09-18 at 16:38:45Z it reverted owner-01b at +0 on ONE death, while the
aggregate gate in the same file was — correctly, at that same moment — HOLDING a
10.00x point ratio because its lower bound was 0.78x. Two rules about the same
question, in the same file, disagreeing, and the stricter one never ran.

The rule now has ONE implementation that every path calls, so a third path
cannot be added without meeting it. That is the difference between a rule and a
habit.

WHAT THE REVERTED CANARY ACTUALLY SHOWED
-------------------------------------------------------------------------------
Every rung inside the fatal episode was `outcome=refused` or
`outcome=preempted blocks=0`: the change placed nothing and moved nothing while
the air reflex held the body at priority 100. A control bot died the same way
four minutes earlier, and all three fleet deaths in that two-hour window were
drownings-while-idle across both arms. A single death cannot separate that from
a change that kills, and no amount of row-matching makes one death into two.

A single death is REPORTED and NAMED in every read, as it always has been. It is
not a verdict.
"""

#: The owner's floor, 2026-09-11. Two canary deaths before ANY path may revert.
DEATH_FLOOR = 2


def licence_reverts(licensed, ndeaths, floor=DEATH_FLOOR):
    """
    May a licensed change row revert, given the canary's death count?

    `licensed` is the list of rows v19's discrimination test allowed through;
    `ndeaths` is canary deaths since `declared_at`. Returns
    `(revert: bool, why: str)`. `why` is always populated, because a hold that
    says nothing is indistinguishable from a rule that did not run -- which is
    how the licence path stayed invisible until it burned a canary.

    FAIL CLOSED TOWARD NOT REVERTING. A death count that is missing or not a
    number is not evidence of two deaths, and this is the deciding direction:
    the cost of a wrong REVERT is a lost trial and a false mechanism claim,
    which is what happened. The cost of a wrong hold is one more read.
    """
    if not licensed:
        return False, 'no licensed change row'
    try:
        n = int(ndeaths)
    except (TypeError, ValueError):
        return False, ('v23: canary death count is unreadable (%r), so it is not '
                       'evidence of %d deaths — holding' % (ndeaths, floor))
    if n < floor:
        return False, ('v23: %d canary death(s) with a licensed change row %s — '
                       'below the %d-death floor, so this is REPORTED, not a verdict'
                       % (n, _name(licensed[0]), floor))
    return True, ('v23: %d canary deaths (floor %d) with a licensed change row %s'
                  % (n, floor, _name(licensed[0])))


def _name(row):
    """A licensed row is a tuple like (bot, hh:mm:ss, kind); print it compactly."""
    try:
        return str(tuple(row)[:3])
    except Exception:
        return repr(row)
