"""busytime.py -- where a bot's seconds go (OWNER 11-03 item 6: "measure bot busy time"). PURE: no files, no clock.

Every second of a bot's window gets exactly ONE class; the classes sum to the window (asserted). Built from the two
streams the logger writes (bots/src/logger.mjs):

  skill stream   logSkill rows (a real skill, name without '_') are stamped at the START, with duration_ms
                 -> [t, t + duration]. logEvent rows (name '_...') are stamped at the END (`new Date()`); the few that
                 carry duration_ms (_build_visit, _craft_sync, _toolkit, _kit_search ...) are sub-steps of a skill and
                 cover [t - duration, t]. Every other '_' row is a point event (duration 0): it covers nothing, but it
                 proves the bot was up and logging at t.
  llm stream     logLlm rows are stamped at the START of the model call, with llm.latency_ms -> [t, t + latency].

PRIORITY (a second covered by several intervals takes the first class that covers it):
  productive   a real skill that is not travel (gather, mine, craft, smelt, build_*, deposit, ...), and the '_' sub-steps
               with a duration. CAVEAT: the walk INSIDE gather / mine / build visits is counted here -- the telemetry has
               no pathing spans to split it out.
  walking      a travel skill (WALK below): goto, explore, home, surface, ...
  llm_wait     a model call in flight.
  paused       the runner's failure pause as announced by `_decision_skipped rule=pausewait ... wake in Ns` -> [t, t+N].
  dead         from a `_death` row to the bot's next row.
  between      uncovered time in the BETWEEN_CAP seconds before a model call starts: the decision cooldown and the tick
               wait (the cooldown is 30 s, cognitive.mjs; measured spacing median ~34 s, 11-03).
  unobserved   two consecutive rows (either stream) more than UNOBSERVED_GAP apart with nothing covering the stretch:
               the bot was down, disconnected or not logging. EXCLUDED from the denominator.
  idle         everything else: observed, alive, not in a skill, not near a decision.

The owner's four shares are productive, walking, decision (= llm_wait + paused + between) and idle (+ dead), each over
OBSERVED seconds.
"""
import bisect

WALK = frozenset({'goto', 'explore', 'home', 'surface', 'sky_descend', 'wander', 'return_home', 'follow', 'come',
                  'flee', 'stair_walk', 'travel'})
CLASSES = ('productive', 'walking', 'llm_wait', 'paused', 'dead', 'between', 'unobserved', 'idle')
PRIO = {c: i for i, c in enumerate(CLASSES)}
BETWEEN_CAP = 45.0
UNOBSERVED_GAP = 600.0
MAX_SKILL_S = 3600.0      # a longer duration is a logger bug; clipped
INF = float('inf')


def skill_interval(t, name, duration_ms):
    """-> (start, end, class) in epoch seconds, or None for a point event. `t` is the row's @timestamp in epoch s."""
    try:
        d = max(0.0, min(float(duration_ms or 0) / 1000.0, MAX_SKILL_S))
    except (TypeError, ValueError):
        return None
    if d <= 0:
        return None
    if name.startswith('_'):
        return (t - d, t, 'productive')            # logEvent: stamped at the END
    return (t, t + d, 'walking' if name in WALK else 'productive')


def pause_seconds(detail):
    """`rule=pausewait runner paused; wake in 31s` -> 31.0, else None."""
    s = str(detail or '')
    if 'pausewait' not in s:
        return None
    i = s.find('wake in ')
    if i < 0:
        return None
    num = ''
    for ch in s[i + 8:]:
        if ch.isdigit() or ch == '.':
            num += ch
        else:
            break
    try:
        return min(float(num), 600.0)
    except ValueError:
        return None


def classify(start, end, skills, llms, pauses=(), deaths=(), stamps=(), cap=BETWEEN_CAP, gap=UNOBSERVED_GAP):
    """PURE. Seconds per class in [start, end).
    skills: [(start, end, cls)] from skill_interval; llms: [(t, latency_s)]; pauses: [(t, seconds)]; deaths: [t];
    stamps: every row time of either stream, INCLUDING rows outside the window (read a margin: a row just past each edge
    is what proves the bot was up at the edge; with none, the stretch to the edge is unobserved when it exceeds `gap`).
    -> {class: seconds} over CLASSES, summing to end - start."""
    span = end - start
    out = {c: 0.0 for c in CLASSES}
    if span <= 0:
        return out
    iv = [(a, b, PRIO[c]) for a, b, c in skills]
    for t, lat in llms:
        iv.append((t, t + max(0.0, lat), PRIO['llm_wait']))
        iv.append((t - cap, t, PRIO['between']))
    for t, s in pauses:
        iv.append((t, t + s, PRIO['paused']))
    st = sorted(set(stamps) | {t for t, _ in llms} | {a for a, _, _ in skills} | {b for _, b, _ in skills})
    for t in deaths:
        j = bisect.bisect_right(st, t)
        iv.append((t, st[j] if j < len(st) else end, PRIO['dead']))
    pts = [-INF] + st + [INF]
    for a, b in zip(pts, pts[1:]):
        if b - a > gap and a < end and b > start:
            iv.append((a, b, PRIO['unobserved']))
    live = sorted((max(a, start), min(b, end), p) for a, b, p in iv if a < end and b > start and b > a)
    cuts = sorted({start, end} | {a for a, _, _ in live} | {b for _, b, _ in live})
    for x, y in zip(cuts, cuts[1:]):
        best = PRIO['idle']
        for a, b, p in live:
            if a > x:
                break
            if b > x and p < best:
                best = p
        out[CLASSES[best]] += y - x
    tot = sum(out.values())
    assert abs(tot - span) < 1e-6 * max(1.0, span), (tot, span)
    return out


def shares(sec):
    """{class: seconds} (summed over any number of bot-hours) -> the owner's shares of OBSERVED time, plus the
    denominators. None when nothing was observed."""
    obs = sum(v for k, v in sec.items() if k != 'unobserved')
    if obs <= 0:
        return None
    dec = sec.get('llm_wait', 0) + sec.get('paused', 0) + sec.get('between', 0)
    return {'productive': sec.get('productive', 0) / obs, 'walking': sec.get('walking', 0) / obs,
            'decision': dec / obs, 'llm_wait': sec.get('llm_wait', 0) / obs, 'paused': sec.get('paused', 0) / obs,
            'between': sec.get('between', 0) / obs, 'idle': (sec.get('idle', 0) + sec.get('dead', 0)) / obs,
            'observed_h': obs / 3600.0, 'unobserved_h': sec.get('unobserved', 0) / 3600.0}


def line(sec, label='busy'):
    s = shares(sec)
    if s is None:
        return f'!! {label}: NOTHING OBSERVED'
    p = lambda k: f'{100 * s[k]:.1f}%'
    return (f'{label}: skills {p("productive")} walking {p("walking")} decision {p("decision")} '
            f'(model call {p("llm_wait")}, runner pause {p("paused")}, no skill + a decision within 45 s {p("between")}) '
            f'idle {p("idle")} '
            f'| {s["observed_h"]:,.0f} bot-h observed, {s["unobserved_h"]:,.0f} unobserved')
