#!/usr/bin/env python3
"""v23: no single canary death may licence a REVERT by any path."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from singledeath import licence_reverts, DEATH_FLOOR

ROW = ('hive-a-Bravo', '16:33:01', 'escape_rung')   # the row that reverted owner-01b
T = []
def t(name, got, want):
    ok = got == want; T.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}\n        -> {got!r}")

# THE LIVE CASE
r, why = licence_reverts([ROW], 1)
t("owner-01b: one death + a licensed row must NOT revert", r, False)
assert 'REPORTED, not a verdict' in why and '1 canary death' in why, why

t("two deaths + a licensed row MAY revert", licence_reverts([ROW], 2)[0], True)
t("three deaths + a licensed row MAY revert", licence_reverts([ROW], 3)[0], True)
t("zero deaths never reverts", licence_reverts([ROW], 0)[0], False)
t("no licensed row never reverts, even with many deaths", licence_reverts([], 9)[0], False)

# FAIL CLOSED toward not reverting
t("None death count holds", licence_reverts([ROW], None)[0], False)
t("garbage death count holds", licence_reverts([ROW], 'two')[0], False)
t("a float death count is read, not refused", licence_reverts([ROW], 2.0)[0], True)

# the floor is the owner's, and is not silently local
t("DEATH_FLOOR is the owner's two", DEATH_FLOOR, 2)
t("an explicit floor is honoured", licence_reverts([ROW], 2, floor=3)[0], False)

# a hold must SAY something -- silence is how this path stayed invisible
for n in (0, 1, None, 'x'):
    _, w = licence_reverts([ROW], n)
    assert w and 'v23' in w or n == 0, f"empty/unlabelled why for ndeaths={n!r}: {w!r}"
t("every hold explains itself", True, True)

print(f"\n{sum(T)}/{len(T)} passed")
sys.exit(0 if all(T) else 1)
