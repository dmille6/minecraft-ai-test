#!/usr/bin/env python3
"""
The first tests `canary_split_ok` has ever had.

It decides whether a two-version fleet is a DECLARED canary or an undeclared
split, it runs BEFORE the tested classifier, and it can stop systemd units.
It lived inline in the tripper until 2026-09-19 and nothing exercised it.

Every case below is a rule the function's own docstring claims, or an incident
its comments record. The four invariants it states:
  * the manifest names the canary pool AND its version, in advance
  * exactly two distinct builds are running, no more
  * every bot on the canary version is IN that pool
  * every bot in that pool is ON the canary version
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from version_split import canary_split_ok, in_canary_pool

B = "16e7e77+eb2342"     # declared baseline
C = "2705838+c2468a"     # declared canary
SC = "16e7e77+d12017"    # a control that restarted onto STALE canary source
WC = "16e7e77+c2468a"    # baseline sha carrying the CURRENT canary digest
POOL = "board-a"
def fleet(pool_v=C, ctrl_v=B, pools=("board-a",), controls=("hive-b", "hive-c")):
    s = {}
    for p in pools:
        for n in ("Alpha", "Bravo"): s[f"{p}-{n}"] = pool_v
    for p in controls:
        for n in ("Alpha", "Bravo"): s[f"{p}-{n}"] = ctrl_v
    return s

T = []
def t(name, got, want):
    ok = got == want; T.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok: print(f"        got {got!r}\n        want {want!r}")

# --- in_canary_pool: prefix matching, never substring
t("pool membership is an exact prefix", in_canary_pool("board-a-Alpha", "board-a"), True)
t("board-a does NOT match board-ab", in_canary_pool("board-ab-Alpha", "board-a"), False)
t("a comma list matches any member", in_canary_pool("hive-c-Echo", "board-a,hive-c"), True)
t("whitespace in the list is tolerated", in_canary_pool("hive-c-Echo", "board-a , hive-c"), True)
t("a non-member is not in the pool", in_canary_pool("placebo-d-Alpha", "board-a,hive-c"), False)
t("an empty pool contains nobody", in_canary_pool("board-a-Alpha", ""), False)

# --- the happy path
ok, why = canary_split_ok(fleet(), "16e7e77", "2705838", POOL)
t("a correctly split fleet is a declared canary", ok, True)

# --- invariant 1: declaration required
ok, why = canary_split_ok(fleet(), "16e7e77", "", POOL)
t("no canary version declared -> not a canary", ok, False)
# ASSERT THE REASON, NOT JUST THE BOOLEAN. A mutant that dropped the
# canary_version half of this guard still refused -- the later sha comparison
# caught it -- but reported "running [...] but the canary declares [...]"
# instead of "no canary declared". The tripper PRINTS this line, and a refusal
# that misdescribes itself is how an operator misdiagnoses a halted fleet.
t("...and it says WHY: no declaration, not a version mismatch",
  "no canary declared" in why, True)
t("no canary pool declared -> not a canary",
  canary_split_ok(fleet(), "16e7e77", "2705838", "")[0], False)

# --- invariant 2: exactly two builds
t("one build running is not a canary split",
  canary_split_ok(fleet(pool_v=B), "16e7e77", "2705838", POOL)[0], False)
three = fleet(); three["hive-c-Alpha"] = "9999999+aaaaaa"
t("THREE builds is never a declared canary", canary_split_ok(three, "16e7e77", "2705838", POOL)[0], False)

# --- THE 2026-08-30 INCIDENT: the digest is the discriminator
contaminated = fleet(); contaminated["hive-b-Alpha"] = WC
ok, why = canary_split_ok(contaminated, "16e7e77", "2705838", POOL)
t("REGRESSION (board-d-Bravo, 2026-08-30): a control carrying the canary DIGEST "
  "under the baseline sha is refused, not called clean", ok, False)

# --- invariant 3 and 4: membership in BOTH directions
outside = fleet(); outside["hive-b-Alpha"] = C
t("a control on the canary build is refused (canary outside the pool)",
  canary_split_ok(outside, "16e7e77", "2705838", POOL)[0], False)
left_behind = fleet(); left_behind["board-a-Alpha"] = B
t("a pool member left on baseline is refused (pool bot not on canary)",
  canary_split_ok(left_behind, "16e7e77", "2705838", POOL)[0], False)

# --- the reason is always populated: a refusal that says nothing cannot be read
for nm, args in [("no declaration", (fleet(), "16e7e77", "", POOL)),
                 ("three builds", (three, "16e7e77", "2705838", POOL)),
                 ("contamination", (contaminated, "16e7e77", "2705838", POOL))]:
    _, w = canary_split_ok(*args)
    T.append(bool(w and w.strip()))
    print(f"{'PASS' if w else 'FAIL'}  the refusal for {nm} explains itself")

# --- two pools, which is the live shape since 2026-09-13
two = fleet(pools=("board-a", "hive-c"), controls=("hive-b", "placebo-d"))
t("a TWO-pool canary is accepted (the shape used since 2026-09-13)",
  canary_split_ok(two, "16e7e77", "2705838", "board-a,hive-c")[0], True)
t("...and one of those two pools left behind is still refused",
  canary_split_ok({**two, "hive-c-Alpha": B}, "16e7e77", "2705838", "board-a,hive-c")[0], False)

print(f"\n{sum(T)}/{len(T)} passed")
sys.exit(0 if all(T) else 1)
