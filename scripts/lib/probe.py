"""Probing a world that is allowed to answer "I don't know".

WHY THIS EXISTS

`telemetry.py` guards one half of a mistake I made six times in a day: a COUNT
of zero that was a query bug rather than a finding. This module guards the other
half, which is the same mistake one layer lower -- a PROBE that returns false
when the truthful answer was "I could not see".

The motivating case is in place-town.py. Minecraft's `execute if block` answers
"Test passed" or "Test failed", and the check was:

    return "Test passed" in rcon.run(f"execute if block {x} {y} {z} {spec}")

An unloaded chunk does not answer either one. It answers the SENTENCE

    That position is not loaded

which contains neither "passed" nor "failed", so it collapsed into False --
"this block is not water". An entire ocean survey came back dry, and nothing
about the result looked wrong, because "not water" is a perfectly ordinary
thing for a block to be. The same helper feeds surface_y()'s binary search, so
an unloaded column does not merely mis-answer one probe: it returns a confident
wrong ground level that then scores the site.

    capability exists    != the model can see when to use it
    query returns zero   != the phenomenon is absent
    probe returns false  != the world condition is false

The third line is this file. Two rules enforce it:

  1. A source with three possible answers may not be typed as two. `Probe`
     carries yes | no | unknown, and `__bool__` RAISES -- always, not only on
     unknown. `if matches(...)` is then a crash at every call site rather than a
     silent False at the one call site that happened to hit an unloaded chunk.
     A tri-state you can accidentally treat as a bool is a bool.

  2. A negative measurement is not reportable without a positive control.
     `Survey` refuses to print a report until a probe with a known-yes answer
     has come back yes and a known-no answer has come back no. Six of my six
     confident zeros would have been caught by that one line of output.

    from probe import Probe, Survey, classify_execute_if

    s = Survey("water at ring 48")
    s.control("centre column is water", classify_execute_if(r.run(q_water(cx, cz))), "yes")
    s.control("bedrock is not water",   classify_execute_if(r.run(q_water(cx, -64))), "no")
    for x, z in ring:
        s.record(classify_execute_if(r.run(q_water(x, z))))
    print(s.report())      # queried / yes / no / unknown / controls, always
"""


class UnknownWorldState(LookupError):
    """The probe could not observe the thing it was asked about."""


class MustHandleUnknown(TypeError):
    """A tri-state was used where a bool was expected."""


class Probe:
    """yes | no | unknown, plus the raw text that decided it.

    `evidence` is not decoration. When a probe answers `unknown` the useful
    question is always "unknown how" -- an unloaded chunk, a permissions error
    and a truncated RCON read are three different problems wearing one word.
    """

    __slots__ = ("status", "evidence")

    YES, NO, UNKNOWN = "yes", "no", "unknown"

    def __init__(self, status, evidence=""):
        if status not in (self.YES, self.NO, self.UNKNOWN):
            raise ValueError(f"not a probe status: {status!r}")
        self.status = status
        self.evidence = str(evidence)

    # THE WHOLE POINT. Without this, a tri-state is a bool that occasionally
    # carries extra fields, and `if probe(...)` reads unknown as false -- the
    # exact collapse this module exists to prevent, reintroduced by a caller in
    # a hurry. Raising on yes and no as well as unknown is deliberate: a rule
    # that only fires on the unlucky path is a rule you find out about in
    # production. This one fires the first time anyone writes the bad line.
    def __bool__(self):
        raise MustHandleUnknown(
            f"a {self.status!r} probe was used as a boolean. Say which answer you "
            f"mean: .is_yes / .is_no / .is_unknown, or .require() to treat "
            f"unknown as an error. Evidence: {self.evidence[:120]!r}")

    @property
    def is_yes(self):
        return self.status == self.YES

    @property
    def is_no(self):
        return self.status == self.NO

    @property
    def is_unknown(self):
        return self.status == self.UNKNOWN

    def require(self, what=""):
        """The bool, when the caller has decided unknown is fatal here.

        This is the right handling for anything whose result feeds a search --
        a binary search over an unknown column returns a number, and numbers
        are believed.
        """
        if self.is_unknown:
            raise UnknownWorldState(
                f"cannot answer {what or 'this probe'}: {self.evidence[:160]!r}")
        return self.is_yes

    def otherwise(self, default):
        """The bool, with unknown deliberately folded into `default`.

        Provided so that the safe-by-default fold is a VISIBLE choice at the
        call site with a value attached, rather than the invisible one Python
        makes for you. Grep for it to find every place unknown is being
        swallowed on purpose.
        """
        return default if self.is_unknown else self.is_yes

    def __repr__(self):
        return f"Probe({self.status}, {self.evidence[:40]!r})"


# The strings Minecraft actually answers with. `execute if` reports a pass/fail
# sentence; everything else it can say -- an unloaded position, an unknown tag,
# a malformed selector -- is NOT a negative result about the world.
_UNKNOWN_MARKERS = (
    "not loaded",              # "That position is not loaded"
    "unknown",                 # unknown block/biome/tag id
    "expected",                # parse error, caret-marked
    "incorrect argument",
    "unable",
    "failed to execute",
)


def classify_execute_if(response):
    """Turn an `execute if ...` RCON response into a Probe.

    Anything that is not one of the two sentences Minecraft promises is
    `unknown`, including the empty string -- an RCON call that returned nothing
    observed nothing. The default must never be `no`, because `no` is a claim
    about the world and this function has no grounds to make one.
    """
    text = "" if response is None else str(response)
    low = text.lower()
    if "test passed" in low:
        return Probe(Probe.YES, text)
    if "test failed" in low:
        return Probe(Probe.NO, text)
    return Probe(Probe.UNKNOWN, text or "<empty rcon response>")


class ControlFailed(AssertionError):
    """A probe with a known answer gave the wrong one, so nothing else counts."""


class Survey:
    """A set of probes that cannot report a negative without a positive control.

    A count of "0 water" is only evidence when the same probe, in the same run,
    against the same server, said "water" about somewhere known to be wet. That
    line costs one RCON round trip and would have caught most of a day's worth
    of confidently wrong measurements.
    """

    def __init__(self, name, require_controls=True):
        self.name = name
        self.require_controls = require_controls
        self.yes = self.no = self.unknown = 0
        self.controls = []            # (label, expected, actual Probe)
        self.unknown_evidence = {}    # first example of each distinct reason

    def record(self, probe):
        if probe.is_yes:
            self.yes += 1
        elif probe.is_no:
            self.no += 1
        else:
            self.unknown += 1
            key = probe.evidence[:80]
            self.unknown_evidence.setdefault(key, 0)
            self.unknown_evidence[key] += 1
        return probe

    def control(self, label, probe, expect):
        """Assert a probe whose answer is known before trusting the rest."""
        if expect not in (Probe.YES, Probe.NO):
            raise ValueError("a control must expect yes or no, never unknown")
        self.controls.append((label, expect, probe))
        return probe

    @property
    def queried(self):
        return self.yes + self.no + self.unknown

    def controls_ok(self):
        return bool(self.controls) and all(
            p.status == expect for _, expect, p in self.controls)

    def report(self, strict=None):
        """The denominators, always, whatever the answer turned out to be.

        Raises when the controls did not pass, because a report whose own
        instrument failed is worse than no report: it is a wrong number with a
        provenance line under it.
        """
        strict = self.require_controls if strict is None else strict
        lines = [f"  {self.name}:",
                 f"    queried  {self.queried}",
                 f"    yes      {self.yes}",
                 f"    no       {self.no}",
                 f"    unknown  {self.unknown}"]
        for ev, n in sorted(self.unknown_evidence.items(), key=lambda kv: -kv[1])[:3]:
            lines.append(f"             {n:>5}x {ev!r}")
        if self.controls:
            for label, expect, p in self.controls:
                mark = "ok  " if p.status == expect else "WRONG"
                lines.append(f"    control  {mark} {label}: expected {expect}, got {p.status}")
        else:
            lines.append("    control  NONE RUN — this survey proves nothing")
        out = "\n".join(lines)
        if strict and not self.controls_ok():
            raise ControlFailed(
                f"{self.name}: the instrument did not pass its own controls, so "
                f"its {self.no} negatives are not evidence.\n{out}")
        return out
