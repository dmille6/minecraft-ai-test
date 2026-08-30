#!/usr/bin/env python3
"""
The cases that would have caught both of tonight's mistakes.

Case list designed with ChatGPT and adopted essentially as given; the two marked
REGRESSION are the ones that reproduce errors I actually made on a live fleet.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from version_split import (classify, ALL_UNDECLARED, CANARY_OUTSIDE_POOL,
                           POOL_NOT_CANARY, CONTAMINATION)

B = "16e7e77+eb2342"    # declared baseline
C = "2705838+c2468a"    # declared current canary
SC = "16e7e77+d12017"   # STALE canary digest under the baseline sha
WC = "16e7e77+c2468a"   # CURRENT canary digest under the baseline sha
U1 = "9999999+aaaaaa"   # unknown sha
U2 = "16e7e77+zzzzzz"   # declared sha, unknown digest
U3 = "2705838+zzzzzz"   # canary sha, unknown digest


class D:
    def __init__(self, base=B, canary=None, pool=(), known=(), fresh=False):
        self.base_sha, self.base_digest = base.split("+")
        if canary:
            self.canary_sha, self.canary_digest = canary.split("+")
        else:
            self.canary_sha = self.canary_digest = ""
        self.canary_pool = set(pool)
        self.known_canary_digests = set(known)
        self.fresh = fresh


CANARY = dict(canary=C, pool={"c1", "c2"}, known={"c2468a", "d12017"})
CASES = [
    ("clean baseline", {"a1": (1, B), "a2": (1, B)}, D(), []),
    ("unknown sha is still a GLOBAL trip", {"a1": (1, B), "a2": (1, U1)}, D(),
     [("ALL", ALL_UNDECLARED)]),
    ("declared sha with UNKNOWN DIGEST is still global — R2 not weakened",
     {"a1": (1, B), "a2": (1, U2)}, D(), [("ALL", ALL_UNDECLARED)]),
    ("canary sha with unknown digest is global",
     {"a1": (1, B), "c1": (1, U3)}, D(**CANARY), [("ALL", ALL_UNDECLARED)]),
    ("clean canary", {"a1": (1, B), "c1": (1, C), "c2": (1, C)}, D(**CANARY), []),
    ("canary build outside the pool",
     {"a1": (1, B), "a2": (1, C), "c1": (1, C), "c2": (1, C)}, D(**CANARY),
     [("a2", CANARY_OUTSIDE_POOL)]),
    ("pool member left on baseline",
     {"a1": (1, B), "c1": (1, B), "c2": (1, C)}, D(**CANARY),
     [("c1", POOL_NOT_CANARY)]),
    ("REGRESSION — the live state: 2 contaminated controls, NOT the whole fleet",
     {**{f"a{i}": (1, B) for i in range(1, 74)},
      **{f"c{i}": (1, C) for i in (1, 2)},
      "bad1": (1, SC), "bad2": (1, SC)},
     D(**CANARY), [("bad1", CONTAMINATION), ("bad2", CONTAMINATION)]),
    ("REGRESSION — sha-only comparison: baseline sha, CURRENT canary digest",
     {"a1": (1, B), "a2": (1, WC), "c1": (1, C), "c2": (1, C)}, D(**CANARY),
     [("a2", CONTAMINATION)]),
    ("a rolling restart is not a fault", {"a1": (1, B), "a2": (1, C)},
     D(canary=C, pool={"c1"}, known={"c2468a"}, fresh=True), []),
    ("no bots seen is not a pass and not a trip", {}, D(), []),
    ("REGRESSION — plain {bot: version} is accepted, not grouped as a tuple",
     {"a1": B, "a2": SC}, D(**CANARY), [("a2", CONTAMINATION)]),
]

fails = 0
for name, seen, decl, want in CASES:
    got = classify(seen, decl)
    ok = (len(got) == len(want)
          and all(g[0] == w[0] and w[1] in g[1] for g, w in zip(got, want)))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        fails += 1
        print(f"        want {want}\n        got  {got}")
print(f"\n  {len(CASES)-fails} passed, {fails} failed")
sys.exit(1 if fails else 0)
