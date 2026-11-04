# SH1 rule review, Claude subagent (second engine), round 1 -- 2026-11-04

Ran: shopread --selftest (with and without storehub.mjs beside it) ok; the 12 new mutants killed; showcase_trip.py selftest ok with
the new shopread (S6 checked, H1/H3/H6/H8 TRIP).

No blocker: a legitimate clerk flint throw does not trip; another bot's well row is not judged (via=clerk only); a sign op=edit is not
judged; rows before the hall carry no via=clerk; the hub rows that showcase_trip loads with `feet` are handled before G6 /
build_rows_with_pos; defect_items and h2_debris_split do not touch H6 items.

BLOCKER 1 -- a kept item thrown on an aborted clerk visit with a cut well row is missed: the well detail is cut to 300 before the
10-character `via=clerk ` prefix and again by the logger, so `items=` (the last field) is lost on a realistic 310-character row, or cut
part-way (`items=flint:10,iron_in` drops the kept name without even counting kept_unjudged); on the abort path disposeWell throws
before `lost` returns, so the clerk row's junked= is empty; kept_unjudged is not visible in the tripwire.
FIX (done): the bot writes `via=clerk lost=<name:n,...>` as the row's first two fields (skills.mjs disposeWell viaOf, the aborted row
too); the read judges lost= first, and a row with no lost= whose items= is missing or may be cut (>= 299 characters) is kept_unjudged
AND a bag_unjudged item (the tripwire's report). Selftest fixtures for both; two mutants.

BLOCKER 2 -- the copied lists can drift unnoticed: the selftest's copy check skips silently when storehub.mjs is not found, which is the
documented temp-dir run. FIX (done): the skip is a loud SKIPPED line, SHOPREAD_STOREHUB names the module explicitly, and
bots/test/storehub.test.mjs compares the shopread.py.txt on its own tree with the module whenever the read there has SH1 (main once the
code lands; any fold that carries both).
