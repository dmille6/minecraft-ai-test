#!/usr/bin/env python3
"""tierrule.py -- canary TIERS (gate v36; OWNER DECISION 2026-10-19 ~12:30Z, "yes"). PURE; in the gate bundle.

docs/reports/canary-tiers-2026-10-19.md. The owner's goal: ~1 h per settings change, 3-4 h per small fix.
  tier 1 SETTINGS     a constant changes: light review, owner-direct rollout + tripwire. NOT a canary; no code here.
  tier 2 SMALL FIX    strong Paper evidence: KEEP allowed at +180 (keep_early), a short pool cool-off for a tier-2
                      INCOMING draw (hold_t2, used by drawsteady.py), and every tier-2 KEEP needs a single-build
                      baseline over its read's lookback (baseline_clean). Draws already take up to four pools.
  tier 3 BIG          ziggurat, mineshaft, town floor, underground safety: unchanged.
A registration declares `"tier": 2`. ABSENT, or anything that is not exactly the integer 2 on a registration with no
`class`, is TIER 3 -- today's behaviour -- so every registration written before v36 reads exactly as before.
"""
import datetime as dt, glob, gzip, json, math, os, re

TIER2_KEEP_MIN = 180         # the one early read
TIER2_POOLS = 4              # EXACTLY rule A''s calibrated configuration (4 pools x 3 h)
TIER2_MIN_CANARY_BH = 48.0   # 80% of the 60 nominal bot-h of four pools at +180, MEASURED
TIER2_CLEAN_MIN = 240        # immobiledid's PRE 180 + its 60-min trailing position window
TIER3_KEEP_CLEAN_MIN = 360   # today's 6-h steady release, counted from the promotion for a tier-2 draw
CLASSES_WITH_OWN_RULES = ('bag-fix', 'underground-safety')
POOL_RE = re.compile(r'^[a-z]+-[a-z]$')
FLEET_WIDE_RE = re.compile(r'^FLEET-WIDE\b')


def tier_of(reg):
    """-> 2 or 3. Exactly the integer 2 (not True, not "2", not 2.0) on a registration with no class."""
    if not isinstance(reg, dict):
        return 3
    t = reg.get('tier')
    if type(t) is int and t == 2 and not reg.get('class'):
        return 2
    return 3


def tier_problem(reg):
    """A PRESENT tier that is not honoured, named (None when absent, 3, or honoured). Printed, never a verdict."""
    if not isinstance(reg, dict) or 'tier' not in reg:
        return None
    t = reg.get('tier')
    if tier_of(reg) == 2 or (type(t) is int and t == 3):
        return None
    if type(t) is int and t == 2:
        return 'tier 2 declared on class %r, which keeps its own rules: read as tier 3' % reg.get('class')
    if type(t) is int and t == 1:
        return 'tier 1 is the owner-direct settings path, not a canary: read as tier 3'
    return 'tier %r is not one of the integers 1, 2, 3: read as tier 3' % (t,)


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def exposure_ok(ex, reads, value):
    """(declared, met): a usable block (read registered, string field, numeric min >= 1) and a finite, numeric,
    non-bool value >= min."""
    declared = (isinstance(ex, dict) and isinstance(ex.get('read'), str) and ex.get('read') in (reads or [])
                and isinstance(ex.get('field'), str) and _num(ex.get('min')) and ex['min'] >= 1)
    return declared, bool(declared and _num(value) and value >= ex['min'])


def death_rate_ok(cd, cbh, kd, kbh):
    """The canary's cumulative death RATE <= the control's (point estimate). Unmeasured or non-finite exposure fails."""
    if not (_num(cd) and _num(kd) and _num(cbh) and _num(kbh)) or cbh <= 0 or kbh <= 0:
        return False
    return (cd / cbh) <= (kd / kbh)


def lookback_min(minute):
    """The PRE lookback a read at `minute` needs: immobiledid's 240, or the read window (scripts with PRE = CUT - W)."""
    return max(TIER2_CLEAN_MIN, int(minute))


def keep_early(reg, n_pools, split, minute, read_minutes, watch, blocked, undefined, exposure, exposure_value,
               reads_readable, licence_class, cd, cbh, kd, kbh, clean, clean_why):
    """PURE. -> (may KEEP at this read, why). Every condition is required; any failure is NOT_YET (the canary continues
    to its next registered read exactly as today). Nothing here can REVERT."""
    if tier_of(reg) != 2:
        return False, 'not tier 2'
    rm = list(read_minutes or [])
    if minute != TIER2_KEEP_MIN or TIER2_KEEP_MIN not in rm or minute >= max(rm or [0]):
        return False, 'not the +%d read before the last registered read' % TIER2_KEEP_MIN
    if split:
        return False, 'a within-world split (calibrated for pool splits only)'
    if n_pools != TIER2_POOLS:
        return False, 'drawn at %d distinct pools (needs exactly %d)' % (n_pools, TIER2_POOLS)
    if not _num(cbh) or cbh < TIER2_MIN_CANARY_BH:
        return False, 'canary exposure %s measured bot-h (needs %.0f)' % (cbh, TIER2_MIN_CANARY_BH)
    if not _num(kbh) or kbh <= 0:
        return False, 'control exposure unmeasured'
    declared, met = exposure_ok(exposure, reg.get('reads'), exposure_value)
    if not declared:
        return False, 'no usable exposure block (a registered read, a field, min >= 1)'
    if not met:
        return False, 'exposure not ready (%r)' % (exposure_value,)
    if watch:
        return False, 'a guard, line or the death gate is on WATCH/HOLD: %s' % ', '.join(map(str, watch))[:200]
    if blocked:
        return False, 'a deciding line failed: %s' % ', '.join(map(str, blocked))[:200]
    if undefined:
        return False, 'an own line or friction rule is undefined: %s' % ', '.join(map(str, undefined))[:200]
    if not reads_readable:
        return False, 'a registered read is not readable'
    if licence_class in (None, '', 'rate'):
        return False, 'licence %r: a tier-2 early KEEP needs a discriminating licence (kind or text)' % (licence_class,)
    if not death_rate_ok(cd, cbh, kd, kbh):
        return False, ('canary death rate %s/%s bh is above the control\'s %s/%s bh (or unmeasured)' % (cd, cbh, kd, kbh))
    if not clean:
        return False, 'baseline not single-build over the +%d lookback: %s' % (minute, clean_why)
    return True, ('tier 2 (owner 10-19): %d pools, %.1f canary bot-h, exposure %s met, no WATCH/block/undefined line, '
                  'licence %s, canary death rate %d/%.1f bh <= control %d/%.1f bh, baseline single-build >= %d min'
                  % (n_pools, cbh, exposure_value, licence_class, cd, cbh, kd, kbh, lookback_min(minute)))


def _t(s):
    try:
        t = dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
        return t if t.tzinfo else None
    except Exception:
        return None


def closes(journal_rows):
    """PURE. {run: [(ts, how)]} from journal `torn-down` and fleet-wide `promoted` rows (how = 'torn-down'|'promoted'),
    each with the promoted sha prefix for a promotion."""
    out = {}
    for r in journal_rows or []:
        if not isinstance(r, dict):
            continue
        ph = r.get('phase'); t = _t(r.get('ts'))
        if t is None:
            continue
        if ph == 'torn-down':
            out.setdefault(r.get('run'), []).append((t, 'torn-down', None))
        elif ph == 'promoted' and 'fleet-wide' in str(r.get('note') or ''):
            out.setdefault(r.get('run'), []).append((t, 'promoted', str(r.get('note')).split()[0][:7]))
    return out


def close_of(run, sha, decided, cl, until):
    """PURE. The run's close: its LAST teardown or fleet-wide promotion OF ITS SHA at or after the decision and at or
    before `until` (an interrupted teardown finished later counts from the later row). -> (ts, how) or (None, None)."""
    best = None
    for t, how, s in cl.get(run, []):
        if how == 'promoted' and s != str(sha or '')[:7]:
            continue
        if decided <= t <= until and (best is None or t > best[0]):
            best = (t, how)
    return best or (None, None)


def run_of(row):
    return str(row.get('note') or '').split(':')[0].strip()


TIER_MARK = 'tier 2 (v36)'
_MARK_RE = re.compile(r'^([a-z0-9][a-z0-9._-]*): VERDICT [A-Z_]+ \(\+\d+\) :: tier 2 \(v36\) \|')


def ledger_tier(row):
    """PURE. The predecessor's tier AS DECIDED: 2 only when the ledger note -- the loop's `<run>: <verdict line>` -- starts
    with the run's own name and the verdict line's FIRST reason is the tier-2 marker (an ANCHORED full-prefix match, never
    a substring search: the-loop-read-the-line-not-the-field). A manual close, another note, or anything else = 3."""
    if not isinstance(row, dict):
        return 3
    m = _MARK_RE.match(str(row.get('note') or ''))
    return 2 if m and m.group(1) == run_of(row) else 3


BUCKET_MIN = 10
MIN_BOT_ROWS = 20
MIN_SEEN_SHARE = 0.8
EDGE_MIN = 60                # a counted bot needs rows in the first AND the last hour of the window
MAX_TRANSITION_SHARE = 0.10  # rows passing only by a neighbouring bucket's majority (a fleet transition)


def _modal_counts(c):
    """{version: n} -> the version with the most, or None on a tie / empty."""
    if not c:
        return None
    top = max(c.values())
    w = sorted(v for v, n in c.items() if n == top)
    return w[0] if len(w) == 1 else None


def n_buckets(since, until):
    return int(math.ceil((until - since).total_seconds() / (BUCKET_MIN * 60)))


def bucket_of(x, since):
    return int((x - since).total_seconds() // (BUCKET_MIN * 60))


def bucketize(rows, since, until):
    """PURE. [(t, version)] -> {bucket: {version: n}} for rows in [since, until) (the loader streams into this shape)."""
    out = {}
    for x, v in rows or []:
        if since <= x < until:
            c = out.setdefault(bucket_of(x, since), {}); c[v] = c.get(v, 0) + 1
    return out


_TS_Z = re.compile(r'"@timestamp":\s*"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z"')


def load_buckets(logroot, bots, since, until):
    """THE ONE NON-PURE FUNCTION HERE (verdict.py's tier-2 baseline reads through it, and so does the installer's live
    positive control, so the two cannot differ). -> ({bot: {bucket: {full code.version: rows}}} over [since, until),
    bad). EVERY generation of each bot's skill log (live, rotated, .gz: the logs rotate ~23:59Z), streamed into counts.
    `bad` counts unreadable files and complete lines that do not parse or carry no zone-aware @timestamp or no
    code.version: each one makes the baseline NOT clean. The cheap prefilter only skips lines whose stamp is a UTC `Z`
    stamp outside the window; any other stamp is parsed in full."""
    lo, hi = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    out, bad = {}, 0
    for bot in bots:
        bk = out.setdefault(bot, {})
        for f in sorted(glob.glob(os.path.join(logroot, bot, 'skill-*.jsonl*'))):
            try:
                if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < since:
                    continue
                fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
                with fh:
                    for line in fh:
                        m = _TS_Z.search(line[:200])
                        if m and not (lo <= m.group(1) < hi):
                            continue
                        try:
                            r = json.loads(line)
                            x = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
                            v = r['code']['version']
                            if not isinstance(v, str) or not v or x.tzinfo is None:
                                raise ValueError('no version or no zone')
                        except Exception:
                            if line.endswith('\n'):
                                bad += 1
                            continue
                        if since <= x < until:
                            c = bk.setdefault(bucket_of(x, since), {}); c[v] = c.get(v, 0) + 1
            except Exception:
                bad += 1
    return out, bad


def asymmetric_rows(canary, control, roster, since, until, bad=0):
    """PURE. The tier-2 baseline interlock over [since, until). canary / control: {bot: {bucket: {full_version: rows}}}
    (bucketize); roster: the ENABLED canary bots (the stable denominator). -> (clean, why, heterogeneity or None).
    CLEAN iff: no unreadable file / corrupt or version-less line (`bad`); >= 80% of the roster SEEN (>= 20 rows, rows in
    the first and the last hour); canary rows in EVERY 10-min bucket; a unique control majority (by bot: each bot's
    modal version in the bucket is one vote) in every bucket; every canary row on its bucket's control majority, the
    only exception a row on the majority of an adjacent bucket WHERE THE MAJORITY CHANGES (a fleet transition), at most
    10% of canary rows. Heterogeneity (REPORTED, never gated): the share of control bot-buckets off the majority."""
    if bad:
        return False, '%d unreadable file(s) or corrupt/version-less line(s) in the window' % bad, None
    roster = sorted(set(roster or []))
    if not roster:
        return False, 'no enabled canary bots', None
    nb = n_buckets(since, until)
    if nb <= 0:
        return False, 'empty window', None
    edge = int(math.ceil(EDGE_MIN / BUCKET_MIN))
    when = lambda i: (since + dt.timedelta(minutes=BUCKET_MIN * i)).strftime('%m-%dT%H:%MZ')
    can = {b: {i: c for i, c in (canary.get(b) or {}).items() if 0 <= i < nb} for b in roster}
    seen = [b for b, bks in can.items() if sum(sum(c.values()) for c in bks.values()) >= MIN_BOT_ROWS
            and any(i < edge for i in bks) and any(i >= nb - edge for i in bks)]
    if len(seen) < MIN_SEEN_SHARE * len(roster):
        return False, ('only %d of %d enabled canary bots seen over the window (>= %d rows, rows in its first and last hour)'
                       % (len(seen), len(roster), MIN_BOT_ROWS)), None
    cvotes = [dict() for _ in range(nb)]
    for _b, bks in (control or {}).items():
        for i, c in (bks or {}).items():
            mv = _modal_counts(c) if 0 <= i < nb else None
            if mv is not None:
                cvotes[i][mv] = cvotes[i].get(mv, 0) + 1
    major = []
    for i, c in enumerate(cvotes):
        mv = _modal_counts(c)
        if mv is None:
            return False, 'bucket %d of %d (%s): %s' % (i + 1, nb, when(i), 'no control rows' if not c
                                                         else 'tied control majority %s' % sorted(c.items())), None
        major.append(mv)
    have = set(); rows = trans = 0
    for b, bks in sorted(can.items()):
        for i, c in sorted(bks.items()):
            have.add(i)
            for v, n in c.items():
                rows += n
                if v == major[i]:
                    continue
                nbrs = {major[j] for j in (i - 1, i + 1) if 0 <= j < nb and major[j] != major[i]}
                if v in nbrs:
                    trans += n
                    continue
                return False, ('%s ran %s in the bucket at %s while the controls ran %s (an asymmetric build in the '
                               'baseline)' % (b, str(v)[:20], when(i), str(major[i])[:20])), None
    miss = [i for i in range(nb) if i not in have]
    if miss:
        return False, '%d of %d buckets hold no canary row (first %s)' % (len(miss), nb, when(miss[0])), None
    if trans > MAX_TRANSITION_SHARE * rows:
        return False, '%d of %d canary rows pass only through a fleet transition (> %d%%)' % (
            trans, rows, round(100 * MAX_TRANSITION_SHARE)), None
    tot = sum(sum(c.values()) for c in cvotes)
    off = sum(n for i, c in enumerate(cvotes) for v, n in c.items() if v != major[i])
    het = (off / tot) if tot else None
    return True, ('every canary row on the control majority build over %d min (%d of %d canary bots seen, %d transition '
                  'rows); control heterogeneity %.1f%% (reported, not gated)'
                  % ((until - since).total_seconds() // 60, len(seen), len(roster), trans, 100 * (het or 0))), het


def hold_t2(decision, pred_tier, how, mins_since_close):
    """PURE. One in-window ledger decision, for a TIER-2 INCOMING draw -> None (no longer holds its pools) or why.
    The predecessor must be CLOSED (how = 'torn-down' | 'promoted'); its age is counted from that close:
      recorded tier 2, any closing decision     -> TIER2_CLEAN_MIN (240)
      tier 3, KEEP promoted fleet-wide          -> TIER3_KEEP_CLEAN_MIN (360: today's 6 h, from the promotion)
      anything else                             -> held (drawrec's 12-h exclusion from the decision, as today)"""
    if how not in ('torn-down', 'promoted') or mins_since_close is None:
        return '%s not closed (no teardown or fleet-wide promotion recorded): 12 h' % decision
    if pred_tier == 2 and decision in ('KEEP', 'REVERT', 'INCONCLUSIVE'):
        need = TIER2_CLEAN_MIN
    elif decision == 'KEEP' and how == 'promoted':
        need = TIER3_KEEP_CLEAN_MIN
    else:
        return 'tier-%d %s (%s): 12 h' % (pred_tier, decision, how)
    if mins_since_close < need:
        return 'tier-%d %s closed (%s) %.0f min ago (< %d)' % (pred_tier, decision, how, mins_since_close, need)
    return None
