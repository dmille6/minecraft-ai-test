
## v31 — a canary must NAME its instrument, and the CLASS decides what it may do
PROSPECTIVE from 2026-09-26. `licencecheck.py` refuses a canary that names no discriminating
instrument. `kind` = a row the baseline cannot emit; `text` = a substring one arm logically cannot
write; `rate` = only the rate of a shared row moves, and that class is **REPORT-ONLY BY
CONSTRUCTION** — it may not revert on an own_line, a friction rule, or the change-row linkage, only
on the calibrated catastrophe gates. Enforced in `verdict.py` (`_LIC_REPORT_ONLY`).
**It was written 2026-09-25 and WIRED 2026-09-26** — the loop had never invoked it, and 2 of 20
registrations declared a licence at all.

## v32 — the LIVE gate code must be the REGISTERED gate code
PROSPECTIVE from 2026-09-26. `RULES-IN-FORCE.md` carries exactly one column-0 line
`GATE DIGEST verdict-bundle md5 <32 hex>`. `gatedigest.py` REFUSES A LAUNCH when
`python3 ~/verdict.py --gate-digest` does not match it; `verdict.py` annotates a mismatch, an absent
record, or two conflicting records on **every read, report-only**.
A BUNDLE, not `verdict.py` alone: `deathgate.py` holds the v21 lower bound and `singledeath.py`
holds v23's two-death floor, so either could be rewritten with `verdict.py` untouched.
**Three generations (v25–v28c, v29, v31) shipped live and unregistered on three consecutive days**,
each found only by a human remembering to compare md5s. Do NOT grep for a `vNN` label — the v29 gate
never spelled its own name. **Change the gate, change the digest line, register the generation, in
the same commit.**
Also closed here: `canary-loop.sh`'s death-poll arm matched `*REVERT*` on the WHOLE verdict line and
now reads the field, and `out()` flattens every reason to one line — the loop takes `tail -1` then
`awk '{print $2}'` with no check that the line is a verdict at all.
