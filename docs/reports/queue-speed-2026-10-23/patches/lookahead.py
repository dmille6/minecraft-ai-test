#!/usr/bin/env python3
"""lookahead.py -- DESIGN 2 (queue-speed-1023): the HEAD-BLOCKED LOOKAHEAD decision. PURE. Proposed, NOT installed.

docs/reports/queue-speed-2026-10-23/queue-speed-design.md, section 2. canary-sched.py would import it (host: ~/).

OWNER 2026-10-23 ~13:30Z (acceptance criteria): the next ready entry may launch once the head has been DRAW-BLOCKED for
30 min; the skipped head goes first at the next opening and is NEVER SKIPPED TWICE IN A ROW; every guard stays -- no
looking past a HOLD, a refusal, an unmet `after`, a missing variant, or an R11 death-hold.

THE DECISION, in order (the first that applies wins; anything not listed means: no lookahead, today's behaviour):
  L0 the slot must be free by every S-check (the caller asks only when decide() of today's scheduler said `wait` for the
     head and nothing else), there is no R11 death-hold, no SCHED-PAUSE/INSTALL-HOLD, no NEXT-SLOT reservation;
  L1 the head's ONLY obstacle is the draw: R10 WAIT (fewer than two pools can expose it) or the R12 draw probe (drawrec
     for the head, read-only, drew fewer than its minimum) -- a head with ANY other blocker (hold, not_before, unmet
     after, missing variant, a refusal / blocked attempt, H3-H6) is never looked past;
  L2 the head has been draw-blocked CONTINUOUSLY for >= WAIT_MIN (30) minutes (a non-draw reason, or a probe that
     drew, ends the episode; the clock restarts);
  L3 the head was not the head skipped by the LAST lookahead launch: once skipped, it goes first at the next opening
     and may not be skipped again until it has launched (never twice in a row; starvation is bounded by ONE run);
  L4 the candidate is the entry IMMEDIATELY behind the head (depth 1; done/cancelled entries are not positions). It must
     be `ready` with no blocker of its own -- not held, not_before passed, every `after` closed, a variant keyed by the
     full fleet base, no refusal, H3-H6 clean -- and its own R10 + R12 (with the head's pools RESERVED) must pass.
     A candidate with any hard blocker STOPS the lookahead; nothing further back is considered (depth 1 by design: the
     replay found nothing a deeper scan would have launched, and every extra position is one more run the head waits on).
The caller journals the launch with `lookahead_past: <head>` and `reserve: [...]` in its sched-state `launching` row;
that row is what L3 reads, so the rule survives a restart of the scheduler."""
from collections import namedtuple

WAIT_MIN = 30
Entry = namedtuple('Entry', 'run state hold after_unmet has_variant klass other_blockers')
Head = namedtuple('Head', 'run hard_blockers draw_blocked_since skipped_last')
HARD_STATES = ('blocked', 'launching', 'running')


def entry_blockers(e):
    """PURE. The hard blockers of a queue entry (L1 for the head, L4 for the candidate)."""
    out = []
    if e.hold:
        out.append('held')
    if e.state in HARD_STATES:
        out.append('state %s (a refusal or an open attempt: a human decides)' % e.state)
    if e.after_unmet:
        out.append('after %s not closed' % ','.join(e.after_unmet))
    if not e.has_variant:
        out.append('no variant for the fleet base')
    out.extend(e.other_blockers or [])
    return out


def draw_blocked_since(state_rows, run, now):
    """PURE. The start of the head's CURRENT continuous draw-blocked episode, from the scheduler's own sched-state rows
    ({'state': 'drawwait', 'run', 'at'} written on every tick the head is draw-blocked; any other decision for the head
    writes {'state': 'drawclear', ...}). None when the head is not draw-blocked now."""
    since = None
    for r in state_rows or []:
        if r.get('run') != run:
            continue
        if r.get('state') == 'drawwait':
            since = since or r.get('at')
        elif r.get('state') in ('drawclear', 'launching'):
            since = None
    return since


def skipped_last(state_rows, head_run):
    """PURE. L3: True when the most recent scheduler launch was a lookahead past THIS head (it has not launched since)."""
    last = None
    for r in state_rows or []:
        if r.get('state') == 'launching':
            last = r
    return bool(last and last.get('lookahead_past') == head_run)


def decide(head, behind, now, slot_free, death_hold, next_slot, depth=1, wait_min=WAIT_MIN):
    """PURE. -> ('lookahead', candidate_run, why) | ('no', why). `behind`: Entry list in queue order after the head.
    depth=1 is the proposed rule; depth=0 ('first ready, stopping at the first hard blocker') exists for the replay."""
    if not slot_free:
        return ('no', 'L0 the slot is not free')
    if death_hold:
        return ('no', 'L0 R11 death-hold: nothing launches until `continue`')
    if next_slot:
        return ('no', 'L0 NEXT-SLOT is reserved for an underground-safety fix')
    if head.hard_blockers:
        return ('no', 'L1 the head has a non-draw blocker (%s): never looked past' % '; '.join(head.hard_blockers))
    if head.draw_blocked_since is None:
        return ('no', 'L2 the head is not draw-blocked')
    mins = (now - head.draw_blocked_since).total_seconds() / 60
    if mins < wait_min:
        return ('no', 'L2 the head has been draw-blocked %.0f min (< %d)' % (mins, wait_min))
    if head.skipped_last:
        return ('no', 'L3 %s was skipped by the last launch: it goes first at this opening' % head.run)
    seen = 0
    for e in behind:
        if e.state in ('done', 'cancelled'):
            continue
        seen += 1
        hb = entry_blockers(e)
        if hb:
            return ('no', 'L4 %s (position %d behind the head) is blocked: %s -- never looked past'
                    % (e.run, seen, '; '.join(hb)))
        if e.state == 'ready':
            return ('lookahead', e.run, 'L4 %s is ready; %s draw-blocked %.0f min, not skipped last' % (e.run, head.run, mins))
        if depth and seen >= depth:
            break
    return ('no', 'L4 no ready entry within depth %s' % (depth or 'any'))
