#!/usr/bin/env python3
"""The BAG-FIX death rule (OWNER DECISION 2026-10-07 ~19:45Z), as pure functions. Part of the gate bundle.

THE RULE. A canary whose registration declares `"class": "bag-fix"` runs the normal canary. If the
ALL-CAUSE death gate trips (the owner's 09-11 gate: >= 2 canary deaths AND the one-sided 95% lower
bound of the rate ratio > 1.25, deathgate.py) AND ZERO canary deaths are mechanism-linked, the canary
is NOT reverted: it EXTENDS to 24 h and is then decided by section 7 of
docs/reports/underground-safety-phase2-2026-10-07.md:
  (a) linked deaths beyond chance  -> REVERT   (binomial P(X >= linked | deaths, p_link) < 0.01, any poll)
  (b) a confident doubling          -> REVERT   (>= 2 deaths and lower bound > 2.0, any poll)
  (c) value-weighted net output DiD below the null's 2.5th percentile at 24 h -> REVERT
      (and, separately, the iron net DiD below its own band)
  otherwise INCONCLUSIVE if the fix's own bag metric did not move or exposure < 400 canary bot-h,
  else KEEP -- and a KEEP under this rule hands the next canary slot to an underground-safety fix.
Non-bag canaries are unchanged: every function here returns the old answer for them.

FAIL CLOSED EVERYWHERE (reviews round 1, both engines): an extension is a LENIENCY, so every measurement that
cannot be shown sound -- missing exposure in either arm, unreadable logs, fewer deaths re-measured than the gate
counted, invisible own rows, missing value coverage, unbound primary evidence -- keeps today's answer (REVERT at
the trip) or refuses KEEP (INCONCLUSIVE at the end). Never the lenient branch by default.

WIDENING (the owner's "widen to 20 bots"): NOT done mid-run. A second deploy rewrites the manifest's one
`declared_at`, restarts the pools already on canary (which resets the gate state the read depends on), and
rebuilds the canary tree under running canary bots; every reader keys on that single field. The safe
equivalent implemented in canary-loop.sh: a bag fix is DRAWN at four pools (20 bots) from the start, so the
first 6 h and the extension run on the same bots and the same declared_at. See the report.

VALUE-WEIGHTED OUTPUT (precondition 2(c)). `bag_value()` scores a bag in log-equivalents; junk, ballast,
anything a disposal fix re-picks up, and cobble above the 64 reserve score 0. Output is the NET change in bag
value between consecutive snapshots, excluding transfers (chest in/out) and deaths (counted separately as value
carried into the death) -- so a placed-and-retaken table, a placed-and-broken chest or a scaffold block placed and
re-mined nets to 0 instead of counting the retake (round 1). Weights below, provenance in
docs/reports/bagfix-death-rule-2026-10-07.md section 2. The SAME accumulation (`accumulate`) produces the
calibration bins and the live 24-h read, so the band and the read cannot use different estimators.
"""
import math

# ---------------------------------------------------------------------------------------------------------
# 1. THE VALUE MEASURE
# Unit: one log (= 4 planks = 8 sticks). Iron is valued by ingot (10 log-eq: iron is the owner's ceiling and a
# stone-tier bot spends roughly ten logs' worth of time per ingot). Every name not listed is 0: dirt, sand,
# gravel, food (peaceful), flowers, seeds, the owner's junk list and the junk-well list (eggs, flint,
# decorations, ...), bone meal, bamboo, slabs.
# CAPS ("up to need"): a group counts only up to its cap per bot; past it, more of the same scores 0.
# TOOLS: every USABLE copy (uses left > 0) at MATERIAL cost, so crafting conserves value and wear-out (a tool
# reaching 0 uses) is consumption. Iron tools by ingot.
# ---------------------------------------------------------------------------------------------------------
IRON_INGOT = 10.0
WOOD_CAP = 64.0               # log-eq: one stack
SAPLING_CAP = 16.0            # the sapling reserve default (STATE 10-07)
STONE = ('cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite')
STONE_W, STONE_CAP = 0.1, 64  # the scaffold reserve; above it 0 (owner)
IRON = {'raw_iron': 1.0, 'iron_ingot': 1.0, 'iron_ore': 1.0, 'deepslate_iron_ore': 1.0, 'iron_nugget': 1 / 9,
        'iron_block': 9.0, 'raw_iron_block': 9.0}                       # ingot-eq per item, uncapped
COAL = ('coal', 'charcoal', 'coal_ore', 'deepslate_coal_ore')
COAL_W, COAL_CAP = 1.0, 32
OTHER = {'diamond': 20.0, 'raw_gold': 3.0, 'gold_ingot': 3.0, 'raw_copper': 0.5, 'copper_ingot': 0.5}
KIT = {'crafting_table': (1.0, 1), 'furnace': (1.0, 1), 'chest': (2.0, 2), 'torch': (0.25, 32), 'ladder': (0.3, 16)}
# material cost per usable copy (planks 1/4 log, stick 1/8, cobble 0.1, ingot 10, diamond 20)
TOOL = {'wooden_pickaxe': 1.0, 'wooden_axe': 1.0, 'wooden_shovel': 0.5, 'wooden_sword': 0.625, 'wooden_hoe': 0.75,
        'stone_pickaxe': 0.55, 'stone_axe': 0.55, 'stone_shovel': 0.35, 'stone_sword': 0.325, 'stone_hoe': 0.45,
        'iron_pickaxe': 30.25, 'iron_axe': 30.25, 'iron_shovel': 10.25, 'iron_sword': 20.125, 'iron_hoe': 20.25,
        'shears': 20.0, 'flint_and_steel': 10.0, 'bucket': 30.0, 'water_bucket': 30.0, 'lava_bucket': 30.0,
        'diamond_pickaxe': 60.25, 'diamond_axe': 60.25, 'diamond_shovel': 20.25, 'diamond_sword': 40.125}
IRON_TOOL_INGOTS = {'iron_pickaxe': 3, 'iron_axe': 3, 'iron_shovel': 1, 'iron_sword': 2, 'iron_hoe': 2,
                    'shears': 2, 'flint_and_steel': 1, 'bucket': 3, 'water_bucket': 3, 'lava_bucket': 3}
# TRANSFERS: a snapshot written by a chest transfer (the skill row, OR the events it emits with the post-transfer
# bag: `_withdraw_pick`, `_withdraw_settled`, `_deposit_*`, `_town_deposit`) moves value, it does not make or lose
# it. Matched by PREFIX on the name without its underscore (round 1: `_withdraw_pick`/`_withdraw_settled` were
# missed by an exact list and credited a withdrawn iron pickaxe as 30 log-eq of output).
TRANSFER_PREFIXES = ('withdraw', 'deposit', 'town_deposit')


def is_transfer(kind):
    return (kind or '').lstrip('_').startswith(TRANSFER_PREFIXES)


TRANSFER_INTERVAL = '_transfer_interval'     # is_transfer() is true of it ('transfer...' is not a prefix above):
TRANSFER_PREFIXES = TRANSFER_PREFIXES + ('transfer_interval',)


def to_obs(rows):
    """PURE. One bot's raw rows [(t_start, kind, duration_s, value|None, iron|None)] -> the observations accumulate()
    takes: sorted by RE-TIMED time (a skill row's snapshot is its END, t + duration; underscore rows are instantaneous),
    rows with no kind dropped, and any row whose re-timed time falls INSIDE a transfer skill's (start, end) marked
    as a transfer -- an event written mid-deposit carries the transfer's bag change, and attributing by row kind alone
    would count it (round 2, Claude). Shared by the calibration walk and the live read."""
    import bisect
    # A DEATH IS NEVER A TRANSFER, and a transfer interval ENDS at a death inside it (round 3, Claude): deposit and
    # withdraw skills include the walk to the chest, and a transit death relabelled as a transfer made the bag it
    # carried vanish from (c) -- exactly the harm a deposit/withdraw bag fix could add.
    deaths = sorted(t for t, k, _d, _v, _i in rows if k == '_death')
    iv = []
    for t, k, d, _v, _i in rows:
        if k and not k.startswith('_') and is_transfer(k):
            b = t + (d or 0.0)
            j = bisect.bisect_right(deaths, t)
            if j < len(deaths) and deaths[j] < b:
                b = deaths[j]
            iv.append((t, b))
    iv.sort()
    starts = [a for a, _b in iv]
    out = []
    for t, k, d, v, i in rows:
        if not k:
            continue
        to = t + ((d or 0.0) if not k.startswith('_') else 0.0)
        if not is_transfer(k) and k != '_death':
            j = bisect.bisect_left(starts, to) - 1
            if j >= 0 and iv[j][0] < to < iv[j][1]:
                k = TRANSFER_INTERVAL
        out.append((to, k, v, i))
    out.sort(key=lambda o: o[0])
    return out


def _wood_units(name):
    if name.endswith('_planks'):
        return 0.25
    if name == 'stick':
        return 0.125
    if (name.endswith('_log') or name.endswith('_wood') or name.endswith('_stem') or name.endswith('_hyphae')
            or name == 'bamboo_block'):
        return 1.0
    return 0.0


def _is_sapling(name):
    return name.endswith('_sapling') or name == 'mangrove_propagule'


def _num(c):
    return c if isinstance(c, (int, float)) and not isinstance(c, bool) and c > 0 else 0


def _usable_copies(name, count, tools):
    """Usable copies of a tool: from bot.tools when present (uses left > 0), else the inventory count."""
    copies = tools.get(name)
    if isinstance(copies, list) and copies:
        return sum(1 for e in copies if isinstance(e, dict) and (e.get('max', 0) - e.get('used', 0)) > 0)
    return count


def bag_value(inventory, tools=None):
    """PURE. Value of one bag snapshot in log-equivalents. `inventory` is bot.inventory (name -> count),
    `tools` is bot.tools (name -> [{used, max}])."""
    inv = inventory if isinstance(inventory, dict) else {}
    tl = tools if isinstance(tools, dict) else {}
    wood = sap = stone = coal = 0.0
    v = 0.0
    for name, c in inv.items():
        c = _num(c)
        if not c:
            continue
        w = _wood_units(name)
        if w:
            wood += w * c
        elif _is_sapling(name):
            sap += c
        elif name in STONE:
            stone += c
        elif name in COAL:
            coal += c
        elif name in IRON:
            v += IRON[name] * IRON_INGOT * c
        elif name in OTHER:
            v += OTHER[name] * c
        elif name in KIT:
            wt, cap = KIT[name]
            v += wt * min(c, cap)
        elif name in TOOL:
            v += TOOL[name] * _usable_copies(name, c, tl)
    return (v + min(wood, WOOD_CAP) + min(sap, SAPLING_CAP) + STONE_W * min(stone, STONE_CAP)
            + COAL_W * min(coal, COAL_CAP))


def iron_units(inventory, tools=None):
    """PURE. Iron held, in ingot-equivalents: raw/ore/ingots 1, nuggets 1/9, blocks 9, every USABLE iron tool or
    bucket by its ingot cost (spent 0) -- the same per-copy counting as bag_value."""
    inv = inventory if isinstance(inventory, dict) else {}
    tl = tools if isinstance(tools, dict) else {}
    n = 0.0
    for name, per in IRON.items():
        n += per * _num(inv.get(name))
    for name, ing in IRON_TOOL_INGOTS.items():
        c = _num(inv.get(name))
        if c:
            n += ing * _usable_copies(name, c, tl)
    return n


def value_delta(prev_value, value, kind, prev_kind):
    """PURE. The output credited to one snapshot step: the SIGNED change in bag value -- except 0 when there is no
    previous snapshot, on a death row (the bag at death is counted once, as value carried into the death), on the
    first step AFTER a death (the respawn empties the bag; that loss is the same death), and on a transfer."""
    if prev_value is None or value is None or kind == '_death' or prev_kind == '_death' or is_transfer(kind):
        return 0.0
    return value - prev_value


CAP_S = 120   # bot-seconds: gap to the next observation capped at 120 s (ugsafe2_analyse.py)


def accumulate(obs):
    """PURE. THE ONE ESTIMATOR for value output, used by the calibration (ugsafe2_value.py, per 5-min bin) and the
    live 24-h read (bagfixgate.py final, per window). `obs` is one bot's observations SORTED by re-timed time:
    (t, kind, value_or_None, iron_or_None) -- a skill row's snapshot is its END (t + duration), underscore rows are
    instantaneous; value None = the row carried no inventory. Yields, per observation,
      (t, sec, dv, di, vlost, ilost, death, death_with_inv, inv_obs)
    where sec is the capped gap to the NEXT observation, dv/di the credited deltas, vlost/ilost the bag carried into
    a death. The previous snapshot is carried across rows without an inventory and across window edges, so a
    window sum is exactly the calibration's bin sum over the same span."""
    pv = pi = None; pk = None
    n = len(obs)
    for k, (t, kind, v, i) in enumerate(obs):
        sec = max(0.0, min(obs[k + 1][0] - t, CAP_S)) if k + 1 < n else 0.0
        death = kind == '_death'
        if v is None:
            yield (t, sec, 0.0, 0.0, 0.0, 0.0, death, False, False)
            if death:
                pk = '_death'      # a death with no snapshot still empties the bag: skip the respawn step
            continue
        dv = value_delta(pv, v, kind, pk)
        di = value_delta(pi, i, kind, pk)
        yield (t, sec, dv, di, v if death else 0.0, i if death else 0.0, death, death, True)
        pv, pi, pk = v, i, kind


# ---------------------------------------------------------------------------------------------------------
# 2. THE DECISIONS
# ---------------------------------------------------------------------------------------------------------
LINK_WINDOW_S = 120          # section 7: a row of the fix's own kinds by the same bot in the 120 s before
LINK_ALPHA = 0.01            # (a): beyond coincidence, per poll
CEILING = 2.0                # (b): lower bound of the death-rate ratio above 2.0 = a confident doubling
FLOOR = 2                    # the owner's two-death floor, unchanged
EXTEND_MIN = 1440            # 24 h from declared_at
MIN_EXPOSURE_BH = 400.0      # section 7 step 5
MIN_POOLS = 4                # bag fixes are drawn at 20 bots (the safe equivalent of widening)
MIN_OWN_BOTS = 2             # positive control: the fix's own rows on at least this many canary bots
MIN_INV_PER_BH = 20.0        # value coverage: inventory snapshots per bot-h in every arm-window (fleet ~350 on 10-06; this detects MISSING telemetry, not thin)
MIN_DEATH_INV_SHARE = 0.9    # value coverage: deaths whose row carries the bag
MIN_FRESH = 0.5              # share of an arm's bots with a row in the last FRESH_S before the poll
FRESH_S = 900
BLIND_POLLS = 3              # consecutive unreadable extension polls before the canary is reverted as blind
NEXT_SLOT = 'underground-safety'
# (c)'s bands: the 2.5th percentile of the EMPIRICAL 24-h null, 4 pools x 24 h POST vs 24 h PRE, on THIS module's
# measure via accumulate() (scripts/host/ugsafe2_gaterule2.py over 10-02 17:00Z .. 10-07 17:45Z, 150 overlapping
# draws, ANY build -- a canary ran through every 48-h stretch, so real canaries sit on both sides and the band is
# WIDER than identical code would give; uniform pool draws, not drawrec's band-matched ones -- see the report).
# Re-measure whenever the weights or accumulate() change: the band belongs to the measure.
NET_P025 = -3.21             # log-eq per bot-h   (p50 +0.65, p97.5 +3.28)
IRON_P025 = -0.127           # ingot-eq per bot-h (p50 +0.013, p97.5 +0.153)


def is_bag_fix(reg):
    """The new registration field. Exactly the string 'bag-fix'; anything else is an ordinary canary."""
    return isinstance(reg, dict) and reg.get('class') == 'bag-fix'


def registration_problems(reg):
    """PURE. Launch preflight for a bag fix: [] when well-formed, else the reasons. A malformed bag_fix block would
    burn 24 h of 20 bots and close INCONCLUSIVE, so it is refused before the draw."""
    if not is_bag_fix(reg):
        return []
    bad = []
    bf = reg.get('bag_fix')
    if not isinstance(bf, dict):
        return ['class bag-fix but no bag_fix block']
    kinds = bf.get('own_kinds') or reg.get('change_rows') or []
    if not kinds or not all(isinstance(k, str) and k.strip('_') for k in kinds):
        bad.append('bag_fix.own_kinds (or change_rows) must name the rows the fix itself writes')
    p = bf.get('primary')
    if not isinstance(p, dict):
        bad.append('bag_fix.primary missing: the bag metric that must move for a KEEP')
    else:
        if p.get('read') not in (reg.get('reads') or []):
            bad.append('bag_fix.primary.read %r is not one of the registered reads %r' % (p.get('read'), reg.get('reads')))
        if not isinstance(p.get('field'), str) or not p.get('field'):
            bad.append('bag_fix.primary.field missing')
        if p.get('op') not in ('<=', '>='):
            bad.append("bag_fix.primary.op must be '<=' or '>='")
        if not isinstance(p.get('value'), (int, float)) or isinstance(p.get('value'), bool) or not math.isfinite(p.get('value')):
            bad.append('bag_fix.primary.value must be a finite number (the edge of its null band)')
    dl = bf.get('extended_deadline_min', 1560)
    if not isinstance(dl, int) or dl <= EXTEND_MIN + 60:
        bad.append('bag_fix.extended_deadline_min must be an int > %d' % (EXTEND_MIN + 60))
    return bad


def death_linked(death_t, own_rows, window_s=LINK_WINDOW_S):
    """PURE. Is one death mechanism-linked? `own_rows` are (start_t, duration_s) of the SAME bot's rows of
    the fix's own kinds. A skill row is stamped at its START and covers [t, t + duration]; it links when
    that interval meets [death_t - window, death_t]. Rows starting after the death never link."""
    lo = death_t - window_s
    for t, dur in own_rows:
        if t <= death_t and t + max(0.0, dur or 0.0) >= lo:
            return True
    return False


def p_link(own_rows_per_bot_h, window_s=LINK_WINDOW_S):
    """Coincidental-link probability per death if the fix's rows were a Poisson process independent of
    risk: 1 - exp(-rate * window). Section 7 caveat: rows bunch underground, so the true rate is higher;
    the caller measures the rate on the canary's own death-free time."""
    r = max(0.0, float(own_rows_per_bot_h or 0.0))
    return 1.0 - math.exp(-r * window_s / 3600.0)


def _binom_sf(k, n, p):
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


def linked_beyond_chance(linked, deaths, pl, alpha=LINK_ALPHA):
    """(beyond, p). P(X >= linked | Binomial(deaths, pl)) < alpha. Zero linked is never beyond chance."""
    if linked <= 0 or deaths <= 0:
        return False, 1.0
    p = _binom_sf(int(linked), int(deaths), min(1.0, max(0.0, pl)))
    return p < alpha, p


def ceiling_trips(cd, cbh, kd, kbh, lower_bound, ceiling=CEILING, floor=FLOOR):
    """(trips, lb). (b): >= floor canary deaths AND the one-sided 95% lower bound of the rate ratio > ceiling.
    lb is None when either arm's exposure is unmeasured: NOT a cleared ceiling (callers treat None as unreadable)."""
    if cbh is None or kbh is None or cbh <= 0 or kbh <= 0:
        return False, None
    if cd < floor:
        return False, 0.0
    lb = lower_bound(cd, cbh, kd, kbh)
    return lb > ceiling, lb


def at_trip(reg, revert_by, m, gate_counts, ceiling):
    """PURE. The death gate has just returned REVERT. -> ('REVERT' | 'EXTEND', why).

    `revert_by` is the field verdict.py writes on its REVERT ('death_gate' only for the all-cause gate);
    `m` is the re-measurement: {cd, cbh, kd, kbh, linked (count), own_rows, own_bots, errors};
    `gate_counts` is {cd, cbh, kd, kbh} as verdict.py recorded them when it tripped (None if absent);
    `ceiling` is (trips, lb) from ceiling_trips on m. EVERY doubt keeps today's REVERT."""
    if not is_bag_fix(reg):
        return 'REVERT', 'not a bag fix: the death gate decides as before'
    if revert_by != 'death_gate':
        return 'REVERT', 'the REVERT is not the all-cause death gate (%r): the bag-fix rule does not apply' % (revert_by,)
    if not isinstance(m, dict) or m.get('errors'):
        return 'REVERT', 'the re-measurement is unreadable (%s log file error(s)): the gate stands' % ((m or {}).get('errors'),)
    cd, cbh, kd, kbh = (m.get(k) for k in ('cd', 'cbh', 'kd', 'kbh'))
    if None in (cd, cbh, kd, kbh) or cbh <= 0 or kbh <= 0:
        return 'REVERT', 'exposure unmeasured in an arm (canary %s, control %s bot-h): the gate stands' % (cbh, kbh)
    g = gate_counts if isinstance(gate_counts, dict) else {}
    if not (isinstance(g.get('cd'), int) and isinstance(g.get('kd'), int)
            and all(isinstance(g.get(k), (int, float)) and not isinstance(g.get(k), bool) and g.get(k) > 0 for k in ('cbh', 'kbh'))):
        return 'REVERT', 'the tripping verdict did not record all four counts (%r): the gate stands' % (gate_counts,)
    if cd < FLOOR or cd < g['cd'] or kd < g['kd']:
        # deaths in EITHER arm under-counted means this measurement does not see what the gate saw (exposures come
        # from the same estimator at a poll but from the read's own at a scheduled read, so they are not compared)
        return 'REVERT', ('re-measured %d canary / %d control deaths, the gate counted %d / %d: the measurement does '
                          'not see what tripped the gate -- the gate stands' % (cd, kd, g['cd'], g['kd']))
    own, bots = m.get('own_rows') or 0, m.get('own_bots') or 0
    if own <= 0 or bots < MIN_OWN_BOTS:
        return 'REVERT', ('LINKAGE UNVERIFIABLE: the fix\'s own rows were seen %d time(s) on %d canary bot(s) '
                          '(need >= %d bots), so "0 linked" could not have been anything else -- the gate stands'
                          % (own, bots, MIN_OWN_BOTS))
    linked = m.get('linked')
    if not isinstance(linked, int):
        return 'REVERT', 'linked count unreadable: the gate stands'
    if linked > 0:
        return 'REVERT', ('%d of %d canary deaths mechanism-linked (own rows within %d s): the gate stands '
                          '(owner 10-07: extension only when ZERO are linked)' % (linked, cd, LINK_WINDOW_S))
    trips, lb = ceiling
    if lb is None:
        return 'REVERT', 'ceiling (b) unreadable: the gate stands'
    if trips:
        return 'REVERT', '(b) at the trip: lower bound %.2fx > %.1fx with %d deaths' % (lb, CEILING, cd)
    return 'EXTEND', ('bag fix, all-cause gate tripped with 0 of %d deaths linked (own rows %d on %d bots) and lower '
                      'bound %.2fx <= %.1fx: EXTEND to %d min (owner 10-07)' % (cd, own, bots, lb, CEILING, EXTEND_MIN))


def extended_poll(m, ceiling):
    """PURE. One poll during the extension. -> ('REVERT' | 'CONTINUE' | 'UNREADABLE', why). (a) then (b).
    UNREADABLE (never CONTINUE) when either arm's exposure is unmeasured or a log could not be read: the loop
    reverts after BLIND_POLLS of those in a row, because the all-cause gate has already tripped."""
    if not isinstance(m, dict) or m.get('errors'):
        return 'UNREADABLE', 'measurement unreadable (%s log file error(s))' % ((m or {}).get('errors'),)
    fc, fk = m.get('fresh_canary'), m.get('fresh_control')
    if fc is not None and fk is not None:
        # STALE TELEMETRY (round 2, Codex): cumulative counts keep answering CONTINUE after logging stops. Both arms
        # stale = a fleet outage (no bot is running, no harm accrues): PAUSED, not blind. One arm stale = blind.
        if fc < MIN_FRESH and fk < MIN_FRESH:
            return 'PAUSED', 'both arms stale (fresh canary %.0f%%, control %.0f%%): fleet outage' % (100 * fc, 100 * fk)
        if fc < MIN_FRESH or fk < MIN_FRESH:
            return 'UNREADABLE', 'telemetry stale in one arm (fresh canary %.0f%%, control %.0f%%)' % (100 * fc, 100 * fk)
    cd, linked, pl = m.get('cd'), m.get('linked'), m.get('p_link')
    trips, lb = ceiling
    if lb is None or not isinstance(cd, int) or not isinstance(linked, int) or pl is None:
        return 'UNREADABLE', 'exposure or counts unmeasured (canary %s, control %s bot-h)' % (m.get('cbh'), m.get('kbh'))
    beyond, p = linked_beyond_chance(linked, cd, pl)
    if beyond:
        return 'REVERT', ('(a) %d of %d deaths linked, P(X >= %d | Bin(%d, %.3f)) = %.4f < %.2f'
                          % (linked, cd, linked, cd, pl, p, LINK_ALPHA))
    if trips:
        return 'REVERT', '(b) %d deaths, lower bound %.2fx > %.1fx' % (cd, lb, CEILING)
    return 'CONTINUE', ('%d deaths, %d linked (p %.3f vs p_link %.3f), lower bound %.2fx <= %.1fx'
                        % (cd, linked, p, pl, lb, CEILING))


def coverage_ok(arms):
    """PURE. Value coverage for the 24-h read: every arm-window must carry inventory snapshots at >= MIN_INV_PER_BH
    per bot-h and a bag on >= MIN_DEATH_INV_SHARE of its deaths. -> (ok, why). Missing inventory telemetry must
    read as UNMEASURED, never as zero output and zero loss (round 1: stripping every snapshot still gave KEEP)."""
    for name, a in arms.items():
        h = a.get('bot_h') or 0.0
        if h <= 0:
            return False, '%s: no exposure' % name
        if (a.get('inv_obs') or 0) / h < MIN_INV_PER_BH:
            return False, '%s: %.1f inventory snapshots per bot-h < %.0f' % (name, (a.get('inv_obs') or 0) / h, MIN_INV_PER_BH)
        d = a.get('deaths') or 0
        if d and (a.get('deaths_with_inv') or 0) / d < MIN_DEATH_INV_SHARE:
            return False, '%s: %d of %d deaths carry the bag (< %.0f%%)' % (name, a.get('deaths_with_inv') or 0, d,
                                                                         100 * MIN_DEATH_INV_SHARE)
    return True, 'coverage ok'


def final(poll, exposure_bh, coverage, primary_moved, net_did, net_p025, iron_did, iron_p025):
    """PURE. The 24-h decision. -> ('REVERT' | 'INCONCLUSIVE' | 'KEEP', why).

    `poll` is extended_poll's answer on the SAME 24 h (a)/(b) are re-checked at the end, so deaths after the last
    poll cannot be skipped. Order: a REVERT from (a)/(b) or (c) first (a death-cost check must not be excused by a
    short read); then INCONCLUSIVE for anything unreadable, short or unmoved; else KEEP."""
    pw, pwhy = poll
    if pw == 'REVERT':
        return 'REVERT', pwhy
    if pw != 'CONTINUE':
        # NOT terminal: the loop counts it toward BLIND, so an unreadable end REVERTs like an unreadable poll (round 2)
        return 'UNREADABLE', '(a)/(b) unreadable at the end: %s' % pwhy
    cov_ok, cov_why = coverage
    if not cov_ok:
        return 'INCONCLUSIVE', 'value coverage: %s -- not measured, so not KEEP' % cov_why
    for name, v in (('net', net_did), ('net band', net_p025), ('iron', iron_did), ('iron band', iron_p025)):
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return 'INCONCLUSIVE', '%s output unreadable (%r): not KEEP' % (name, v)
    if net_did < net_p025:
        return 'REVERT', ('(c) value-weighted net output DiD %+.2f log-eq/bot-h < null 2.5th pct %+.2f'
                          % (net_did, net_p025))
    if iron_did < iron_p025:
        return 'REVERT', '(c) iron net DiD %+.3f ingot/bot-h < its null 2.5th pct %+.3f' % (iron_did, iron_p025)
    if exposure_bh is None or exposure_bh < MIN_EXPOSURE_BH:
        return 'INCONCLUSIVE', 'exposure %s canary bot-h < %.0f' % (exposure_bh, MIN_EXPOSURE_BH)
    if primary_moved is not True:
        return 'INCONCLUSIVE', 'the fix\'s own bag metric did not move beyond its null at +1440 (%r): no measurable benefit' % (primary_moved,)
    return 'KEEP', ('no (a)/(b)/(c) in 24 h; net %+.2f >= %+.2f; iron %+.3f >= %+.3f; %.0f bot-h; bag metric moved. '
                    'NEXT SLOT -> %s fix' % (net_did, net_p025, iron_did, iron_p025, exposure_bh, NEXT_SLOT))


def primary_moved(fields, spec):
    """PURE. Did the registration's own bag metric move? `spec` = {read, field, op ('<=' | '>='), value}:
    the registered edge of its null band. None when the field is missing (-> INCONCLUSIVE)."""
    if not isinstance(spec, dict) or not isinstance(fields, dict):
        return None
    v = fields.get(spec.get('field'))
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
        return None                      # NaN AND +/-inf are unreadable, never "moved" (round 4, Codex)
    if not isinstance(spec.get('value'), (int, float)) or isinstance(spec.get('value'), bool) or not math.isfinite(spec['value']):
        return None
    if spec.get('op') == '<=':
        return v <= spec.get('value')
    if spec.get('op') == '>=':
        return v >= spec.get('value')
    return None


def evidence_bound(o, reg, man, minute, now_iso_age_min):
    """PURE. Is a read's evidence object bound to THIS canary at THIS minute and fresh? verdict.py's own binding:
    sha, pools, run_id, declared_at, window_min, plus emitted within 90 min. -> (ok, why)."""
    if not isinstance(o, dict):
        return False, 'no evidence object'
    for k, want in (('sha', reg.get('sha')), ('pools', man.get('canary_pool')), ('run_id', man.get('run_id')),
                    ('declared_at', man.get('declared_at')), ('window_min', minute)):
        if o.get(k) != want:
            return False, 'evidence %s %r != %r' % (k, o.get(k), want)
    if now_iso_age_min is None or now_iso_age_min > 90:
        return False, 'evidence stale (%s min)' % now_iso_age_min
    if not isinstance(o.get('fields'), dict):
        return False, 'evidence has no fields'
    return True, 'bound'
