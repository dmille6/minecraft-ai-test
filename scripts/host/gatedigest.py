#!/usr/bin/env python3
"""Pre-deploy guard (v32): THE LIVE GATE CODE MUST BE THE REGISTERED GATE CODE.

    gatedigest.py [--verdict PATH] [--rules PATH] [--quiet]

WHY THIS EXISTS, AND WHY IT IS A MECHANISM RATHER THAN A RULE. Three days running, a gate
generation shipped LIVE IN THE DECISION PATH AND IN NO REGISTRATION:

  v25-v28c  live 2026-09-23/24, registered retrospectively in `a9e13e1`.
  v29       `faf7cf7` 2026-09-24 12:11Z, ~23 h after that registration was written for exactly
            this reason. Registered retrospectively in `3a1fd0d`.
  v31       `b01b1e7` 2026-09-25 15:21Z, four hours after v29/v30 were registered. Found
            2026-09-26 11:20Z, in `~/verdict.py` md5 `e9a81408` against the `6dda048d` the state
            file recorded as registered. THE THIRD CONSECUTIVE DAY.

The standing wake-up already said the right thing -- "A GATE CAN BE LIVE WITHOUT SPELLING ITS OWN
NAME: do not grep for `vNN`; diff `~/verdict.py` against the last registered md5" -- and it was
followed on none of the three days, because it asks a person to remember a comparison.
`ZeroLooksWrong` is the model this repo already trusts: it does not ask you to remember, it RAISES.

THE DIGEST IS A BUNDLE, AND THAT CORRECTION CAME FROM A REVIEW PASS. The first draft hashed
`verdict.py` alone. But `deathgate.py` holds the v21 lower-bound test -- the acceptance mutant
runner MUTATES THAT FILE to flip a case from KEEP to REVERT -- and `singledeath.py` holds v23's
two-death floor. Either could be rewritten with `verdict.py` untouched, and the draft would have
called that registered. So the digest is computed BY THE GATE ITSELF (`verdict.py --gate-digest`)
over the files its own imports resolved to, via `sys.modules`. This file never re-derives that
resolution: `arms.py` is on none of the paths verdict.py's docstring lists, so a hand-written path
list here would have recorded it MISSING and passed anyway.

WHERE THE HARD STOP LIVES. At LAUNCH, before the draw and before any fleet time is spent -- the
placement v30 and v31 both argued for, and for the same reason: at read time it is already too
late, and refusing a read would make every historical registration and replay fixture unreadable.
verdict.py ANNOTATES a mismatch on every read (report-only, and it carries no verdict token because
the loop's death-poll arm used to match `*REVERT*` on the whole line).

THE ENCLOSING CONDITION IS PART OF THE CONTRACT. canary-loop.sh runs this preflight only when the
manifest does not already name this sha, i.e. on a fresh launch and on a resume whose sha differs --
NOT on a resume at the same sha, and never again at the second or third read. The launch refusal
therefore binds the gate AT LAUNCH ONLY; what binds it at every read is verdict.py's annotation.
Neither half is sufficient and both are wired, which is the honest description.

NO RECORD AT ALL IS A REFUSAL, NOT A PASS. `changerowcheck.py` passing its own null case is what
`licencecheck.py` was written to fix (9 of 18 registrations declared nothing and all nine passed);
a digest checker that exits 0 when the record is absent would repeat that defect in the one place
meant to catch it. Two DIFFERENT records also refuse. Two IDENTICAL records are not a conflict.

Exit 0 = the live gate bundle is the registered gate bundle. Exit 2 = refused, for a stated reason.
"""
import argparse, os, re, subprocess, sys

DEFAULT_VERDICT = os.environ.get('VERDICT_PATH') or os.path.expanduser('~/verdict.py')
DEFAULT_RULES = os.environ.get('VERDICT_RULES') or os.path.expanduser('~/digest/RULES-IN-FORCE.md')
MAX_RULES_BYTES = 4 << 20

# Anchored at column 0: this exact format is quoted in the registration document and in docstrings,
# and an indented example must not read as the authoritative record. The trailing boundary is what
# stops the first 32 digits of a 33-digit hex string matching.
DIGEST_RE = re.compile(r'(?m)^GATE DIGEST verdict-bundle md5 ([0-9a-fA-F]{32})(?![0-9a-fA-F])')


def live_bundle(verdict_path):
    """Ask the gate for its own bundle digest. Raises RuntimeError with the reason.

    AN UNRESOLVED PART IS NOT CERTIFIABLE. `_gate_bundle()` hashes the sentinel `UNRESOLVED` for a
    decision module it cannot locate, which makes a perfectly valid digest -- and a review pass
    showed that once such a digest is recorded, every later change to that module preserves it. So
    the guard refuses to certify a bundle with an unresolved part rather than registering a hole.
    """
    p = subprocess.run([sys.executable, verdict_path, '--gate-digest'],
                       capture_output=True, text=True, timeout=120)
    first = (p.stdout or '').strip().splitlines()
    if p.returncode != 0 or not first or not re.fullmatch(r'[0-9a-f]{32}', first[0].strip()):
        raise RuntimeError('`%s --gate-digest` did not print a digest (exit %d): %s'
                           % (verdict_path, p.returncode,
                              ((p.stdout or '') + (p.stderr or '')).strip()[:400]))
    parts = '\n'.join(first[1:])
    if 'UNRESOLVED' in parts:
        raise RuntimeError('a decision module could not be located, so this bundle cannot be '
                           'certified -- registering it would freeze a digest that no longer tracks '
                           'that module:\n%s' % parts)
    return first[0].strip(), parts


def read_rules(path):
    """Bounded, and a REGULAR FILE ONLY.

    A review pass pointed out that the draft called open() on whatever the path named: a FIFO with
    no writer blocks forever and /dev/zero reads without end, and `except Exception` rescues
    neither. The path is operator-set rather than hostile, but an interlock that can hang the thing
    it protects is not an interlock. `utf-8-sig` because a BOM before the first record would
    otherwise defeat the column-0 anchor and read as "no record".
    """
    if not os.path.isfile(path):
        raise RuntimeError('%s is not a regular file' % path)
    with open(path, 'rb') as fh:
        raw = fh.read(MAX_RULES_BYTES + 1)
    if len(raw) > MAX_RULES_BYTES:
        # TRUNCATING WOULD BREAK THE CONFLICT REFUSAL: a matching record before the boundary and a
        # different one after it would pass the very check written to catch two records.
        raise RuntimeError('%s exceeds %d bytes; refusing to read a truncated rules document'
                           % (path, MAX_RULES_BYTES))
    return raw.decode('utf-8-sig', errors='replace')


def check(verdict_path, rules_path):
    """Returns (ok, message). Every refusal names a remedy that can be performed from here."""
    if not os.path.exists(verdict_path):
        return False, 'REFUSED: no gate file at %s -- nothing to compare' % verdict_path
    try:
        live, parts = live_bundle(verdict_path)
    except Exception as e:
        return False, 'REFUSED: could not compute the live gate bundle -- %s: %s' % (type(e).__name__, e)
    if not os.path.exists(rules_path):
        return False, ('REFUSED: no rules file at %s, so there is no registered digest to compare '
                       'the live gate against. The live gate bundle is %s:\n%s'
                       % (rules_path, live, parts))
    try:
        text = read_rules(rules_path)
    except Exception as e:
        return False, 'REFUSED: could not read %s -- %s: %s' % (rules_path, type(e).__name__, e)
    recorded = [m.group(1).lower() for m in DIGEST_RE.finditer(text)]
    if not recorded:
        return False, ('REFUSED: %s records NO line of the form\n'
                       '    GATE DIGEST verdict-bundle md5 <32 hex>\n'
                       'at column 0, so this check cannot pass its own null case and will not '
                       'pretend to. The live gate bundle is %s:\n%s\n'
                       'Read what changed in the gate, register the generation, then record that '
                       'digest.' % (rules_path, live, parts))
    if len(set(recorded)) > 1:
        return False, ('REFUSED: %s records %d DIFFERENT gate bundle digests (%s). Two records is '
                       'the two-copies-of-verdict.py failure in a new place -- those two were found '
                       'disagreeing about the death rule on 2026-09-18, and whichever a reader hit '
                       'first looked authoritative. Leave exactly one.'
                       % (rules_path, len(set(recorded)), ', '.join(sorted(set(recorded)))))
    want = recorded[0]
    if live != want:
        return False, ('REFUSED: THE LIVE GATE IS NOT THE REGISTERED GATE.\n'
                       '  live       %s\n%s\n'
                       '  registered %s  (%s)\n'
                       'A gate generation has shipped into the decision path without a registration '
                       'three days running (v25-v28c, v29, v31). Do NOT grep for a "vNN" label to '
                       'decide what changed -- the v29 gate never spelled its own name. Diff the '
                       'files above, register the generation PROSPECTIVELY, then record the new '
                       'digest on the GATE DIGEST line.' % (live, parts, want, rules_path))
    return True, 'OK: live gate bundle %s matches the digest registered in %s' % (live, rules_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verdict', default=DEFAULT_VERDICT)
    ap.add_argument('--rules', default=DEFAULT_RULES)
    ap.add_argument('--quiet', action='store_true', help='print only on refusal')
    a = ap.parse_args()
    ok, msg = check(a.verdict, a.rules)
    if not ok or not a.quiet:
        print(msg)
    return 0 if ok else 2


if __name__ == '__main__':
    sys.exit(main())
