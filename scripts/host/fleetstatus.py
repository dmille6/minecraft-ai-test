#!/usr/bin/env python3
"""fleetstatus.py -- the fleet at a glance over 3 h / 24 h / 7 d, from Elasticsearch.

Replaces the lost /tmp/quickstatus.py (nightwatch's "quick status") and the 24 h summary that
hit the 6 GB file-walk cap (WalkTooWide) on 2026-10-14. Built on scripts/lib/estelemetry.py, so
every count is a server-side aggregation and nothing pulls millions of rows. ANALYSIS ONLY:
canary reads and gates stay on the files (lib/telemetry.py).

    python3 scripts/host/fleetstatus.py                 # 3h, 24h, 7d
    python3 scripts/host/fleetstatus.py --windows 3h,24h --json /tmp/fs.json

Per window: docs and bots (the denominators), deaths by cause and by pool, deaths per
bot-hour, successes / attempts for gather, craft, deposit and town_deposit, and drownings by
pool and hour (by pool and DAY for windows over 48 h). Once: bag fullness from the latest
inventory snapshot per bot in the last 3 h (bagcensus.py's metric: slots = ceil(count / stack
size), 36 slots, >= 34 is "full" by the owner's shed rule).

ZERO RULE. Every kind and status this script asks about is first PROVEN to exist in the widest
window (a positive control on the name). Each window must then prove it SAW the fleet: it
must hold documents, its newest document must be within STALE_AFTER of its end, and every
hour with no document from anyone is printed. Only then are per-window zeros accepted with
allow_zero=True, because "no deaths in the last 3 h" is a real answer once both the name and
the window are known to be live. Limit: the proof is a week wide -- a kind RENAMED inside
the week would read as a silent zero in the narrow windows until the old name ages out.

DENOMINATORS. Per-bot-hour figures divide by ACTIVE bot-hours: (bot, hour) pairs with at least
one document. They do not divide by bots x nominal hours, so a bot that was down for half the
window is not counted as a quiet one. Every by-pool and by-cause table must sum to the direct
count. Documents missing exp.pool or fail_class appear as '<missing>' and are never dropped.

ELK DISK HEADER. The report opens with the ELK host's disk, read from the hourly reading
infra/backup/check-backup.py publishes on 10.0.0.186 (index mcai-monitor-disk), plus any write
block on the shipped indices. Its DiskLow lines (above 75%, or projected to cross 85% within
14 days) are repeated here because the same check's DiskPressure alarm printed hourly for
eight days before the 2026-10-19 flood stage into a log nobody read. A missing or stale
reading is printed as an alarm line, never as a quiet disk. Report lines only, no paging.

WINDOWS END 5 MINUTES AGO (ingest lag max ~3 min, measured 10-14) and are clipped off 2026-10-07,
which ES holds duplicate docs for (filebeat re-sends after the 05:01Z crash). Every window
prints its caveats: rotations crossed (~40-60 skill rows lost each), clipping, validation range.
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import statistics
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from lib.estelemetry import EsEvents, ZeroLooksWrong  # noqa: E402
from lib import estelemetry as _est  # noqa: E402

ACTIONS = ('gather', 'craft', 'deposit', 'town_deposit')
FULL_AT = 34
SLOTS = 36
LAG = dt.timedelta(minutes=5)
STALE_AFTER = dt.timedelta(minutes=15)
UNSTACKABLE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|'
                         r'shears|flint_and_steel|bow|fishing_rod)$')


DISK_INDEX = 'mcai-monitor-disk'
DISK_STALE = dt.timedelta(hours=2, minutes=30)     # the check runs at :25 every hour
SHIPPED = 'mcai-skill-agents,mcai-llm-agents,mcai-mc-paper,mcai-sys-journal'
DISK_CLIENT = None                                  # tests inject; None = estelemetry.http

# OPS AUDIT (OWNER 2026-10-20 "yes"): Codex reads the operator's last 26 h of decisions once a day (~/bin/opsaudit.sh on
# the Mac mini) and publishes ~/digest/opsaudit-latest.md here. Its first line ("OPSAUDIT <day> FLAGS: n (k high)") and
# age open every report, because an audit written to a file nobody opens is no audit (the ELK DiskPressure lesson).
OPSAUDIT_PATH = '~/digest/opsaudit-latest.md'
OPSAUDIT_STALE = dt.timedelta(hours=30)


def opsaudit_line(now, path=None):
    """One header line for the daily Codex ops audit. Never raises: missing, stale or failed is an alarm line."""
    p = os.path.expanduser(path or OPSAUDIT_PATH)
    try:
        first = open(p, errors='replace').readline().strip()
        age = now - dt.datetime.fromtimestamp(os.path.getmtime(p), dt.timezone.utc)
    except OSError as e:
        return f'!! ops audit: NO REPORT ({type(e).__name__}) -- the daily Codex audit has not published to {p}'
    m = re.match(r'OPSAUDIT (\S+) FLAGS: (\d+)(?: \((\d+) high\))?', first)
    h = age.total_seconds() / 3600
    if not m:
        return f'!! ops audit: UNREADABLE first line {first[:120]!r} ({h:.0f} h old)'
    flags, high = int(m.group(2)), int(m.group(3) or 0)
    mark = '!! ' if high or age > OPSAUDIT_STALE else ''
    stale = f' -- STALE (> {OPSAUDIT_STALE.total_seconds() / 3600:.0f} h)' if age > OPSAUDIT_STALE else ''
    return f'{mark}ops audit (Codex) {m.group(1)}: {flags} flag(s), {high} high, {h:.0f} h old{stale}; read {p}'


# FRONTIER CENSUS (E0, expansion plan 2026-10-19 section 4): frontiercensus.py --tick runs from mike's crontab on this host
# every 5 min and rewrites ~/frontiercensus/out/heartbeat.json atomically. Its health opens every report, the same way as
# the disk and the audit: a census nobody looks at goes VOID unnoticed. The thresholds are check-frontiercensus.py's.
FRONTIER_HB = '~/frontiercensus/out/heartbeat.json'
FRONTIER_STALE = dt.timedelta(minutes=15)       # cron 5 min; a tick may run 4 min
FRONTIER_BEHIND = dt.timedelta(minutes=135)     # whole hours fold 10 min after they end: healthy is <= ~75 min
FRONTIER_NOT_STAGING = dt.timedelta(minutes=30)
FRONTIER_PUBLISHER = dt.timedelta(minutes=15)   # the publisher runs right after every tick: its line, as carried by the
#                                                 NEXT tick's heartbeat, is judged against that tick (its age is STALE's)


def _ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


# LAVA MAP (lavasight-01; scripts/host/lavasight): the publisher's own check of every pool's lava-map.json, never a quiet OK.
# A feed is only OK if something READS it: lavasight-01 closed INCONCLUSIVE 10-26 and is not on the fleet, yet the hourly
# publisher kept writing and this line kept saying "lavamap OK" (audit 10-31). So the line first asks the fleet's own
# build tree whether any module reads the file; with no reader it says so -- RETIRED when the publisher's cron was taken
# out on purpose (~/lavasight/RETIRED holds why), an alarm when the publisher still runs for nobody.
LAVAMAP_READERS = ('lava-map.json', 'lavaMapReader')       # the reader's file name and function (lavasight.mjs)
FLEET_TREE = '/srv/mcbots/harness/src'                       # the baseline units' WorkingDirectory + src


def lavamap_consumers(tree=FLEET_TREE):
    """-> (n_modules_scanned, [modules that read the lava map]). n == 0 means the tree was not readable (no verdict)."""
    n, hits = 0, []
    for root, _, files in os.walk(tree):
        for f in files:
            if not f.endswith(('.mjs', '.js')):
                continue
            try:
                text = open(os.path.join(root, f), errors='replace').read()
            except OSError:
                continue
            n += 1
            if any(k in text for k in LAVAMAP_READERS):
                hits.append(os.path.relpath(os.path.join(root, f), tree))
    return n, hits


def lavamap_line(now, home=None, tree=FLEET_TREE):
    import subprocess
    home = home or os.path.expanduser('~/lavasight')
    tool = os.path.join(home, 'app', 'lavamap_publish.py')
    retired = os.path.join(home, 'RETIRED')
    if not os.path.exists(tool) and not os.path.exists(retired):
        return None
    n, readers = lavamap_consumers(tree)
    if n == 0:
        return f'!! lavamap: cannot tell whether anything reads the feed ({tree} holds no readable module)'
    if not readers:
        if os.path.exists(retired):
            why = (open(retired, errors='replace').read().strip().splitlines() or [''])[0][:240]
            return f'lavamap RETIRED: no consumer on the fleet build ({n} modules in {tree} read no lava map); {why}'
        return (f'!! lavamap: the feed has NO CONSUMER -- none of {n} modules in {tree} reads lava-map.json, yet the '
                f'publisher is installed; retire its cron (keep the data) or ship the reader')
    try:
        r = subprocess.run([sys.executable, '-B', tool, 'check', '--root', '/var/lib/mcai',
                            '--map', os.path.expanduser('~/hazardmap/out/hazardmap.json')], capture_output=True, text=True, timeout=60)
        out = (r.stdout.strip().splitlines() or [''])[-1]
        return (out or 'LAVAMAP ALARM: the check printed nothing (exit %d)' % r.returncode) + f' (read by {", ".join(readers[:3])})'
    except Exception as e:
        return 'LAVAMAP ALARM: the check did not run (%s)' % type(e).__name__



# HAZARD MAP (per-seed hazard map, OWNER 2026-10-24; scripts/host/hazardmap): the tool's own check, never a quiet OK
def hazardmap_line(now, home=None):
    import subprocess
    home = home or os.path.expanduser('~/hazardmap')
    tool = os.path.join(home, 'app', 'scripts', 'host', 'hazardmap', 'hazardmap.py')
    if not os.path.exists(tool):
        return None
    try:
        r = subprocess.run([sys.executable, '-B', tool, 'check', '--home', home], capture_output=True, text=True, timeout=60)
        out = (r.stdout.strip().splitlines() or [''])[-1]
        return out or 'HAZARDMAP ALARM: the check printed nothing (exit %d)' % r.returncode
    except Exception as e:
        return 'HAZARDMAP ALARM: the check did not run (%s)' % type(e).__name__



# STRUCTURE COUNT (building tier step 0, docs/reports/building-tier-2026-10-23.md section 2): structcount.py daily runs on
# 10.0.0.30 after the 03:15Z world backup; pull.py mirrors its publication here hourly (owner Q8). The line reads the mirror
# with the count's OWN reader (scread.py, installed beside pull.py), so this report and the count can never disagree about
# what "published" means. Before 06:00Z, yesterday's OK publication is the normal state (today's waits for the backup).
STRUCTCOUNT_IN = '~/structcount/in'
STRUCTCOUNT_READER = '~/structcount/bin/scread.py'
STRUCTCOUNT_DUE = dt.time(6, 0)


def structcount_line(now, sdir=None, reader=None):
    """One header line for the structure count. NEVER raises: no mirror, no reader, a failed or stale publication is an
    alarm line ('!! '). RUNNING (today's attempt is in progress) is not an alarm."""
    try:
        import importlib.util
        rp = os.path.expanduser(reader or STRUCTCOUNT_READER)
        spec = importlib.util.spec_from_file_location('scread', rp)
        rd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rd)
        d = os.path.expanduser(sdir or STRUCTCOUNT_IN)
        att = os.path.join(d, 'attempts')
        today = now.strftime('%Y-%m-%d')
        r = rd.status(d, att, today, now, only=rd.MIRROR_FILES)
        if r['status'] != 'OK' and now.time() < STRUCTCOUNT_DUE:
            y = rd.status(d, att, (now - dt.timedelta(days=1)).strftime('%Y-%m-%d'), now, only=rd.MIRROR_FILES)
            if y['status'] == 'OK':
                r, when = y, 'yesterday (today due after the 03:15Z backup, by 06:00Z)'
            else:
                when = None
        else:
            when = 'today'
        if r['status'] == 'RUNNING':
            return f'structcount (B5 buildings, from the world): RUNNING -- {r["why"]}'
        if r['status'] != 'OK':
            return f'!! structcount (B5 buildings, from the world): {r["status"]} -- {r["why"]}; history {r.get("history") or "none"}'
        doc = r['doc'] or {}
        t = r['totals'] or {}
        towns = ', '.join(f'{w} {v["buildings"]}' for w, v in sorted(doc.items()) if v.get('buildings')) or 'none'
        return (f'structcount (B5 buildings, from the world): OK {when}: {t.get("buildings")} buildings ({towns}), '
                f'{t.get("unlit_rooms")} unlit rooms, {t.get("surface_structures"):,} surface structures in {t.get("worlds")} worlds')
    except Exception as e:                      # noqa: BLE001 -- the fleet report must never fall over on this line
        return f'!! structcount: UNREADABLE ({type(e).__name__}: {str(e)[:80]}) -- mirror {sdir or STRUCTCOUNT_IN}, reader {reader or STRUCTCOUNT_READER}'


def frontier_line(now, path=None):
    """One header line for the frontier census. NEVER raises (a malformed heartbeat is an alarm line too): missing,
    unreadable, stale, VOID, error, instrument, behind, a town left out or gone, unread hazards, and -- once warm --
    nothing staged for 30 min or a publisher that has not reported `ok` within 15 min are '!! ' lines; a healthy census
    says so with its denominators."""
    p = os.path.expanduser(path or FRONTIER_HB)
    try:
        return _frontier_line(now, p)
    except Exception as e:                      # noqa: BLE001 -- the fleet report must never fall over on this line
        return f'!! frontier census (E0): UNREADABLE heartbeat ({type(e).__name__}: {str(e)[:80]}) at {p}'


# >>> coop_line (installed by patch-fleetstatus-coop.py)
# COOPERATION CENSUS (B1, cooperation-tier design r9.1 6.3): coopread.py --day runs daily from mike's crontab and writes
# ~/coopread/out/daily/<until>.json. Its line opens every report: stale (> 30 h), a failed control, or no file is '!! '.
COOP_DIR = '~/coopread/out'
COOP_STALE = dt.timedelta(hours=30)


def coop_line(now, out_dir=None):
    """One header line for the daily cooperation census. NEVER raises."""
    d = os.path.expanduser(out_dir or COOP_DIR)
    try:
        fs = sorted(f for f in os.listdir(os.path.join(d, 'daily')) if f.endswith('.json'))
        if not fs:
            raise FileNotFoundError('no daily file')
        with open(os.path.join(d, 'daily', fs[-1])) as fh:
            res = json.load(fh)
        end = _ts(res['window'][1])
        F, C = res.get('fleet') or {}, res.get('controls') or {}
        bad = [k for k, c in C.items() if not c.get('ok')]
        age = now - end
        w = F.get('prov_withdrawn', 0)
        unread = sorted(t for t, T in (res.get('towns') or {}).items() if T.get('provenance') is None)
        # coverage, PARTIAL and UNREADABLE towns stay visible (Codex r2 P2-3): a short or blind index is never a quiet zero
        chests = ('chests VOID (no readable index)' if not F.get('prov_towns') else
                  f'chests other-bot {F.get("prov_other_lb", 0)}-{F.get("prov_other_ub", 0)} of {w} withdrawn over '
                  f'{F.get("prov_cover_h", 0):.0f} town-h in {F.get("prov_towns", 0)} towns'
                  + (f' ({len(res.get("partial") or {})} PARTIAL)' if res.get('partial') else '')
                  + (f' UNREADABLE {",".join(unread)}' if unread else ''))
        what = (f'{chests}; furnace '
                f're-found empty {F.get("furnace_peer", 0)}; multi-builder project-days '
                f'{F.get("built_multi_builder_project_days", 0) if F.get("built_rows") else "idle"}; void {len(res.get("void") or {})}')
        if bad or age > COOP_STALE or not C or unread or not F.get('prov_towns'):
            why = (f'controls FAILED {bad}' if bad else 'no controls' if not C else
                   'provenance VOID' if (unread or not F.get('prov_towns')) else '') + \
                  (f' STALE {age.total_seconds() / 3600:.0f} h' if age > COOP_STALE else '')
            return f'!! cooperation census (B1): {why.strip()} -- {what}; read {d}'
        return f'cooperation census (B1): {age.total_seconds() / 3600:.0f} h old, {what}'
    except Exception as e:                      # noqa: BLE001 -- the fleet report must never fall over on this line
        return f'!! cooperation census (B1): NO DAILY FILE ({type(e).__name__}) in {d} -- not a quiet census, an absent one'
# <<< coop_line


def _frontier_line(now, p):
    try:
        with open(p) as fh:
            hb = json.load(fh)
        at = _ts(hb['at'])
        if at.tzinfo is None:
            raise ValueError('timestamp without a zone')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        return f'!! frontier census (E0): NO HEARTBEAT ({type(e).__name__}) at {p} -- not a quiet census, an absent one'
    bad = []
    age = now - at
    if age > FRONTIER_STALE:
        bad.append(f'STALE: newest tick {age.total_seconds() / 60:.0f} min old')
    st = hb.get('status')
    if st in ('error', 'selftest_failed'):
        bad.append(f'{st.upper()}: {str(hb.get("error"))[:120]}')
    elif st == 'void':
        bad.append(f'VOID: ES blind since {hb.get("es_blind_since")} (reads VOID, not zero)')
    elif st == 'instrument':
        bad.append(f'INSTRUMENT: {"; ".join(hb.get("instrument") or [])[:160]}')
    elif st not in ('ok', 'idle', 'behind'):
        bad.append(f'status {st!r}')
    mu = hb.get('newest_measured_hour_end')
    try:
        lag = now - _ts(mu) if mu else None
    except ValueError:
        lag = None
    if lag is None:
        bad.append('BEHIND: no measured hour')
    elif lag > FRONTIER_BEHIND:
        bad.append(f'BEHIND: newest measured hour ended {mu[11:16]}Z ({lag.total_seconds() / 60:.0f} min)')
    if hb.get('home_problems'):
        bad.append(f'towns left out {hb["home_problems"]}')
    if hb.get('site_errors'):
        bad.append(f'hazards unread (ranking withheld) {hb["site_errors"]}')
    wu = hb.get('warmup') or {}
    if (hb.get('last_publish') or {}).get('unusable'):
        bad.append(f'PUBLISHER cannot write {hb["last_publish"]["unusable"]}')
    if not wu.get('complete'):              # the publisher must be alive during the warm-up too (Claude r4 P2-1)
        lp = hb.get('last_publish') or {}
        if not lp.get('at') or at - _ts(lp['at']) > FRONTIER_PUBLISHER or lp.get('status') not in ('warmup', 'ok') \
                or (lp.get('usable') or 0) < (lp.get('offered') or 0):
            bad.append(f'PUBLISHER {lp.get("status") or "silent"} at {lp.get("at")} during the warm-up '
                       f'(usable {lp.get("usable")} of {lp.get("offered")})')
    if wu.get('complete'):
        ls = hb.get('last_staged_at')
        if not ls or now - _ts(ls) > FRONTIER_NOT_STAGING:
            bad.append(f'NOT STAGING since {ls} (withheld: {str(hb.get("withheld"))[:80]})')
        lp = hb.get('last_publish') or {}
        if not lp.get('at') or at - _ts(lp['at']) > FRONTIER_PUBLISHER or lp.get('status') != 'ok':
            bad.append(f'PUBLISHER {lp.get("status") or "silent"} at {lp.get("at")}: '
                       f'{str(lp.get("why") or lp.get("error") or lp.get("refused") or "")[:100]}')
    warm = ('warm-up complete' if wu.get('complete') else
            f'warm-up ends {wu["complete_at"][:16]}Z (nothing published before)' if wu.get('complete_at') else
            'warm-up not started')
    unc = hb.get('uncovered_days')
    what = (f'{hb.get("towns")} towns (+{len(hb.get("isolated_folded") or [])} isolated folded), '
            f'measured to {mu[11:16] if mu else "-"}Z, backlog {hb.get("backlog_hours")} h, uncovered days '
            f'{unc if unc else "none"}, {warm}')
    if bad:
        return f'!! frontier census (E0): {"; ".join(bad)} -- {what}; read {os.path.dirname(p)}/check.log'
    return f'frontier census (E0): {st}, tick {age.total_seconds() / 60:.0f} min ago, {what}'


# LEARNING-LOOP ARCHIVE (M1, docs/reports/learning-loop-design-2026-10-21.md s.1.5): scripts/learnloop/nightly.py runs
# from mike's crontab on this host at 01:50Z, extracts each finished day, checks it and archives it to the NAS through
# the .30 relay, then rewrites ~/learnloop/heartbeat.json. The logs here rotate after 14 days, so that archive is the
# only long-term copy of the decision stream: a missing, stale, behind or failing archive opens every report.
LEARNLOOP_HB = '~/learnloop/heartbeat.json'
LEARNLOOP_STALE = dt.timedelta(hours=26)         # daily cron; one missed night is an alarm
LEARNLOOP_READY = dt.timedelta(days=1, hours=1, minutes=15)   # nightly.READY_AFTER: day D is extractable from here
LEARNLOOP_GRACE = dt.timedelta(hours=3)          # cron 01:50Z + a run of minutes: D is due on the NAS by D+1 04:15Z
LEARNLOOP_BAD = {'error': 'ERROR', 'archive_failed': 'ARCHIVE FAILED', 'at_risk': 'RAW AT RISK', 'behind': 'BEHIND',
                 'control_failed': 'CONTROL FAILED', 'empty': 'NOTHING ARCHIVED'}


def learnloop_line(now, path=None):
    """One header line for the learning-loop archive. NEVER raises: missing, unreadable, stale, any status but ok, a
    newest archived day older than the one due, or a NAS that disagrees with the local state are '!! ' lines; a healthy
    archive says so with its denominators."""
    p = os.path.expanduser(path or LEARNLOOP_HB)
    try:
        return _learnloop_line(now, p)
    except Exception as e:                      # noqa: BLE001 -- the fleet report must never fall over on this line
        return f'!! learning-loop archive (M1): UNREADABLE heartbeat ({type(e).__name__}: {str(e)[:80]}) at {p}'


def _learnloop_line(now, p):
    try:
        with open(p) as fh:
            hb = json.load(fh)
        at = _ts(hb['at'])
        if at.tzinfo is None:
            raise ValueError('timestamp without a zone')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        return f'!! learning-loop archive (M1): NO HEARTBEAT ({type(e).__name__}) at {p} -- no nightly run has reported'
    bad = []
    age = now - at
    if age > LEARNLOOP_STALE:
        bad.append(f'STALE: last run {age.total_seconds() / 3600:.0f} h ago')
    st = hb.get('status')
    if st != 'ok':
        bad.append(f'{LEARNLOOP_BAD.get(st, "status " + repr(st))}' + (f': {str(hb.get("error"))[:100]}' if hb.get('error') else ''))
    for r in hb.get('this_run') or []:
        if not r.get('archived'):
            bad.append(f'{r.get("day")} not archived ({str(r.get("archive_error"))[:80]})')
    if hb.get('at_risk'):
        bad.append('raw rotates out before it is archived: ' + ', '.join(f'{x.get("day")} (expires {x.get("expires")})'
                                                                        for x in hb['at_risk'][:4]))
    newest = hb.get('newest_archived_day')
    due = (now - LEARNLOOP_READY - LEARNLOOP_GRACE).date().isoformat()
    if not newest or newest < due:
        bad.append(f'newest archived day {newest}, {due} is due')
    rec = hb.get('newest') or {}
    if rec and not rec.get('controls_ok'):
        bad.append(f'{newest} failed controls {rec.get("controls_failed")}')
    for u in (hb.get('unresolved') or [])[:4]:          # an OLDER failed day must not hide behind a healthy newest one
        bad.append(f'unresolved {u.get("day")}: {str(u.get("why"))[:90]}')
    if len(hb.get('unresolved') or []) > 4:
        bad.append(f'+{len(hb["unresolved"]) - 4} more unresolved')
    nas = hb.get('nas') or {}
    if nas.get('newest') != newest or (nas.get('sealed') or 0) < (hb.get('archived_days') or 0):
        bad.append(f'NAS says newest {nas.get("newest")} ({nas.get("sealed")} sealed), local state {newest} '
                   f'({hb.get("archived_days")})')
    what = (f'newest {newest}: {rec.get("triples", 0):,} triples of {rec.get("llm_rows", 0):,} decision rows, '
            f'{rec.get("bots")}/{rec.get("roster")} bots; {hb.get("archived_days")} day(s) sealed on the NAS; '
            f'pending {hb.get("pending") or "none"}')
    if bad:
        return f'!! learning-loop archive (M1): {"; ".join(bad)} -- {what}; read ~/learnloop/nightly.log'
    return f'learning-loop archive (M1): ok, run {age.total_seconds() / 3600:.0f} h ago, {what}'


def elk_disk(now, client=None):
    """Header lines for the ELK host's disk. Never raises: an unreadable reading is itself an
    alarm line, because a disk check that cannot be read has not passed."""
    client = client or DISK_CLIENT or _est.http
    lines, out = [], {'reading': None, 'blocked_indices': [], 'alarm': False}
    try:
        r = client('POST', f'{DISK_INDEX}/_search', {'size': 1, 'sort': [{'@timestamp': {'order': 'desc'}}]})
        hits = r['hits']['hits']
        if not hits:
            raise LookupError(f'{DISK_INDEX} holds no reading')
        d = hits[0]['_source']
        out['reading'] = d
        at = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
        age = max(now - at, dt.timedelta(0))     # --now is minute-truncated; a reading can be seconds newer
        rate = d.get('growth_gb_per_day')
        trend = (f'{rate:+.2f} GB/day over {d.get("history_h", 0):.0f} h, {d.get("proj_pct", 85):.0f}% in '
                 f'{d["days_to_proj_pct"]:.0f} d' if rate is not None and d.get('days_to_proj_pct') is not None
                 else f'{rate:+.2f} GB/day (not growing)' if rate is not None
                 else f'growth rate not yet known: {d.get("rate_unavailable")}')
        lines.append(f'ELK disk {d.get("host")}:{d.get("path")} {d.get("used_pct")}% of {d.get("total_gb")} GB '
                     f'(ES-style used), {trend}; read {at:%m-%d %H:%M}Z, {age.total_seconds() / 3600:.1f} h ago')
        for x in d.get('alarms') or []:
            lines.append(f'  !! {x}')
        if age > DISK_STALE:
            lines.append(f'  !! ELK disk reading is STALE ({age.total_seconds() / 3600:.1f} h old): the hourly check '
                         f'on 10.0.0.186 is not running, or ES is refusing its write (flood stage?)')
        out['alarm'] = bool(d.get('alarms')) or age > DISK_STALE
    except Exception as e:
        lines.append(f'!! ELK disk: NO READING ({type(e).__name__}: {str(e)[:160]}) -- not a healthy disk, an '
                     f'unread one; check /var/log/mcai-monitor/backup-alarm.log on 10.0.0.186')
        out['alarm'] = True
    try:
        st = client('GET', f'{SHIPPED}/_settings?filter_path=*.settings.index.blocks', None)
        out['blocked_indices'] = sorted(ix for ix, v in (st or {}).items()
                                        if any(str(b).lower() == 'true' for b in
                                               ((v.get('settings') or {}).get('index') or {}).get('blocks', {}).values()))
        if out['blocked_indices']:
            lines.append(f'  !! WRITE BLOCK on {len(out["blocked_indices"])} indices '
                         f'({", ".join(out["blocked_indices"][:4])}{" ..." if len(out["blocked_indices"]) > 4 else ""}): '
                         f'ES is refusing ingest -- the 2026-10-19 flood stage looked exactly like this')
            out['alarm'] = True
    except Exception as e:
        lines.append(f'  !! could not read index blocks ({type(e).__name__}: {str(e)[:120]})')
        out['alarm'] = True
    out['lines'] = lines
    return out


# SHOWCASE HEADER (2026-10-26): the showcase sat stopped by its tripwire for 18 h (10-25 19:37Z .. 10-26 13:40Z) and
# nobody noticed, because the only sign was "SHOWCASE bots: 0 skill docs in 3 h" at the very bottom of the report. Up or
# down is now one header line. DOWN = the showcase skill stream's newest doc is >= SHOWCASE_DOWN_AFTER old. The stop's
# reason comes from the showcase VM's /srv/showcase/ops/deploy.jsonl ("stop-bots" rows; a "why" starting "tripwire" is
# a trip, anything else a deliberate stop) ONLY if a copy sits at SHOWCASE_DEPLOY_LOG: this host has no route to read
# 10.0.0.40, so without one the line says where to look rather than guessing.
SHOWCASE_DOWN_AFTER = dt.timedelta(minutes=30)
SHOWCASE_ROSTER = dt.timedelta(hours=24)        # the denominator: bots that wrote a showcase skill row in this window
SHOWCASE_LOOKBACK = dt.timedelta(days=7)        # how far back the newest row is sought
SHOWCASE_DEPLOY_LOG = '~/showcase-ops/deploy.jsonl'
SHOWCASE_STOP_SLACK = dt.timedelta(minutes=15)  # a stop is "the" stop if it is no older than the newest row minus this


def showcase_stop(path, newest, now):
    """The stop that began this outage: the FIRST stop-bots row of a deploy.jsonl copy in [newest - SHOWCASE_STOP_SLACK,
    now], as (when, kind, why). A later stop issued while already down does not relabel it, and a row after `now` (a
    --now replay) is not seen. None when there is no such row; raises OSError when the file cannot be read."""
    stop = None
    with open(os.path.expanduser(path)) as fh:
        for line in fh:
            try:
                r = json.loads(line)
                t = _ts(r['t'])
            except (ValueError, KeyError, TypeError):
                continue
            if (r.get('event') == 'stop-bots' and newest - SHOWCASE_STOP_SLACK <= t <= now
                    and (stop is None or t < stop[0])):
                stop = (t, str(r.get('why') or ''))
    if stop is None:
        return None
    t, why = stop
    if why.strip().lower().startswith('tripwire'):
        why = why.split('TRIP --', 1)[1] if 'TRIP --' in why else why.split(':', 1)[-1]
        return t, 'tripwire', why.strip()
    return t, 'deliberate', why.strip()


def showcase_line(now, client=None, deploy_log=None):
    """One header line: is the showcase running? NEVER raises. DOWN and PARTIAL are '!! ' lines; OK names its
    denominator (bots seen in SHOWCASE_ROSTER) and the newest row's age."""
    try:
        return _showcase_line(now, client, deploy_log or SHOWCASE_DEPLOY_LOG)
    except Exception as e:                      # noqa: BLE001 -- the fleet report must never fall over on this line
        return f'!! showcase: UNREADABLE ({type(e).__name__}: {str(e)[:100]}) -- stream mcai-skill-showcase'


def _showcase_line(now, client, deploy_log):
    kw = {'client': client} if client else {}
    wk = EsEvents.load('showcase-skill', since=now - SHOWCASE_LOOKBACK, until=now, gaps='allow', **kw)
    newest = wk.newest_in_window()
    if newest is None:
        return (f'!! SHOWCASE DOWN >= {SHOWCASE_LOOKBACK.days} d: no showcase skill row in {SHOWCASE_LOOKBACK.days} d '
                f'(the stream answered: {wk.total():,} docs) -- read /srv/showcase/ops/trip.log on 10.0.0.40')
    age = now - newest
    if age >= SHOWCASE_DOWN_AFTER:
        hrs = f'{age.total_seconds() / 3600:.1f} h'
        try:
            stop = showcase_stop(deploy_log, newest, now)
        except OSError:
            return (f'!! SHOWCASE DOWN {hrs}: last skill row {newest:%m-%d %H:%MZ} -- check trip.log and deploy.jsonl '
                    f'in /srv/showcase/ops on 10.0.0.40 (no copy of deploy.jsonl here)')
        if stop is None:
            return (f'!! SHOWCASE DOWN {hrs}: last skill row {newest:%m-%d %H:%MZ}, NO stop recorded in deploy.jsonl '
                    f'since -- the bots died or stopped shipping; check filebeat and the bots on 10.0.0.40')
        t, kind, why = stop
        tail = ('read /srv/showcase/ops/trip.log on 10.0.0.40' if kind == 'tripwire'
                else 'stopped on purpose; restart it when that work is done')
        return f'!! SHOWCASE DOWN {hrs}: {kind} stop {t:%m-%d %H:%MZ} "{why[:90]}" -- {tail}'
    roster = EsEvents.load('showcase-skill', since=now - SHOWCASE_ROSTER, until=now, gaps='allow', **kw).bots_present()
    live = EsEvents.load('showcase-skill', since=now - SHOWCASE_DOWN_AFTER, until=now, gaps='allow', **kw).bots_present()
    absent = sorted(set(roster) - set(live))
    mins = int(age.total_seconds() // 60)
    if absent:
        return (f'!! showcase PARTIAL: {len(live)} of {len(roster)} bots (seen in {SHOWCASE_ROSTER.total_seconds() / 3600:.0f} h) '
                f'wrote a row in the last {SHOWCASE_DOWN_AFTER.total_seconds() / 60:.0f} min; absent {", ".join(absent[:5])}'
                f'{" ..." if len(absent) > 5 else ""}; last row {mins} min ago')
    return f'showcase OK: {len(live)} of {len(roster)} bots, last row {mins} min ago'


SHOWCASE_OPS = 'mcai-showcase-ops'      # the showcase VM's timelapse heartbeat rows (filebeat route ops)


# W5 ALARMS (fun mode, OWNER 2026-10-28): stuck goals (no project progress 3 h), halts (a stop with no start in 15 min),
# daily drift (> 30 % vs the 7-day median) and the rollout ledger's 60-min checks -- scripts/lib/alarmhead.py, never raises.
def w5_alarm_lines(now, client):
    try:
        from lib import alarmhead
        return alarmhead.lines(now, client)
    except Exception as e:                      # noqa: BLE001 -- a tree without the helper must not blank the report
        return [f'!! W5 alarms unavailable ({type(e).__name__}: {str(e)[:100]}) -- install scripts/lib/alarmhead.py and alarm.py']


def showcase_report(until, client=None, window_h=3):
    """The SHOWCASE block (docs/reports/showcase-2026-10-20.md section 4). It reads ONLY the showcase's own
    streams -- the fleet sections above never see a showcase row -- and never raises: an unreadable stream is a
    line saying so. Bots not started is a legitimate zero, stated with its denominator (the stream's own total)."""
    client = client or DISK_CLIENT or _est.http
    lines, out = [], {}
    try:
        from lib import showcasestatus as SS
    except Exception as e:     # a tree installed without the helper must not blank the FLEET report
        return {'lines': [f'SHOWCASE: block unavailable ({type(e).__name__}: {str(e)[:100]}) -- install '
                          f'scripts/lib/showcasestatus.py beside estelemetry.py'], 'error': str(e)[:200]}
    since = until - dt.timedelta(hours=window_h)
    try:
        sk = EsEvents.load('showcase-skill', since=since, until=until, gaps='allow', client=client)
        n = sk.total()
        out['skill_docs'] = n
        if n:
            bots = sk.bots_present()
            vers = sk.terms('code.version', allow_zero=True)
            deaths = sk.count('_death', allow_zero=True)
            out.update(bots=len(bots), versions=vers, deaths=int(deaths))
            lines.append(f'SHOWCASE bots: {len(bots)} present in {window_h} h ({n:,} skill docs), deaths {int(deaths)}, '
                         f'builds {vers}')
        else:
            lines.append(f'SHOWCASE bots: 0 skill docs in {window_h} h (bots not started, or not shipping)')
    except Exception as e:
        lines.append(f'SHOWCASE bots: stream unreadable ({type(e).__name__}: {str(e)[:120]}) -- before the first '
                     f'showcase bot row this is expected; afterwards check filebeat on 10.0.0.40')
    try:
        ll = EsEvents.load('showcase-llm', since=since, until=until, gaps='allow', client=client)
        n = ll.total()
        models = ll.terms('llm.model', allow_zero=True) if n else {}
        unserved = n - sum(v for k, v in models.items() if k != _est.MISSING)
        models = {k: v for k, v in models.items() if k != _est.MISSING}
        eps = ll.terms('llm.endpoint', allow_zero=True) if n else {}
        foreign = sum(v for k, v in eps.items() if k not in (_est.MISSING, 'http://127.0.0.1:11612'))
        out.update(llm_docs=n, models=models, unserved=unserved, foreign_endpoint_rows=foreign)
        lines.append(SS.brain_line(models, unserved, n, foreign))
    except Exception as e:
        lines.append(f'SHOWCASE BRAIN: stream unreadable ({type(e).__name__}: {str(e)[:120]})')
    try:
        r = client('POST', f'{SHOWCASE_OPS}/_search',
                   {'size': 400, 'sort': [{'@timestamp': {'order': 'desc'}}],
                    'query': {'bool': {'filter': [{'term': {'kind': 'showcase_timelapse'}},
                                                  {'range': {'@timestamp': {'gte': _est._iso(until - dt.timedelta(hours=26))}}}]}}})
        rows = [h['_source'] for h in r['hits']['hits']]
        f0 = next((dt.datetime.fromisoformat(x['frame0_t'].replace('Z', '+00:00')) for x in rows if x.get('frame0_t')),
                  None)
        lines.append(SS.timelapse_line(rows, until, frame0=f0))
        pl = SS.pause_line(rows, until)
        if pl:
            lines.append(pl)
        out['heartbeat_rows'] = len(rows)
    except Exception as e:
        lines.append(f'SHOWCASE TIMELAPSE: heartbeat unreadable ({type(e).__name__}: {str(e)[:120]}) -- not a healthy '
                     f'timelapse, an unread one')
    try:
        r = client('POST', 'mcai-misc-showcase/_count?ignore_unavailable=true&allow_no_indices=true',
                   {'query': {'range': {'@timestamp': {'gte': _est._iso(until - dt.timedelta(hours=24))}}}})
        n = int(r.get('count', 0))
        out['misc_docs_24h'] = n
        if n:
            lines.append(f'  !! SHOWCASE UNROUTED: {n} docs in mcai-misc-showcase in 24 h -- filebeat on 10.0.0.40 met '
                         f'an event with no route; fix its routing (nothing reached a bench stream: the writer cannot)')
    except Exception as e:
        lines.append(f'  !! SHOWCASE unrouted check unreadable ({type(e).__name__}: {str(e)[:100]})')
    out['lines'] = lines
    return out


def pool_group(p):
    """isolated bots each carry their own pool ('self-isolated-a-Alpha'); group them as 'isolated-a'
    for display so the table reads by world like the other pools."""
    m = re.fullmatch(r'self-(isolated-[a-z])-\w+', str(p))
    return m.group(1) if m else p


def grouped(d):
    out = Counter()
    for k, v in d.items():
        out[pool_group(k)] += v
    return dict(sorted(out.items(), key=lambda x: str(x[0])))


def parse_window(w):
    n, u = int(w[:-1]), w[-1]
    return dt.timedelta(hours=n) if u == 'h' else dt.timedelta(days=n) if u == 'd' else None


def slot_counter(stack_path):
    """bagcensus.py's estimator when ~/stack.json exists, else scoreboard.py's (64, tools 1)."""
    try:
        stack = json.load(open(os.path.expanduser(stack_path)))
        return ((lambda it, c: math.ceil(c / stack.get(it, 64)) if c > 0 else 0),
                f'stack sizes from {stack_path}; a LOWER bound: one item split over partial stacks uses more slots')
    except (OSError, ValueError):
        return ((lambda it, c: (c if UNSTACKABLE.search(it) else -(-c // 64)) if c > 0 else 0),
                'ESTIMATED stack sizes (64; tools 1) -- ~/stack.json not found')


def prove_names(ev):
    """Positive control on every name and value this script relies on, in the widest window."""
    names = ev.names()
    need = ('_death',) + ACTIONS
    missing = [n for n in need if not names.get(n)]
    if missing:
        raise ZeroLooksWrong(f'{missing} absent from the widest window ({ev.total():,} docs): the names '
                             f'are wrong or the fleet changed its vocabulary; refusing to report zeros')
    for k in ACTIONS:
        if not ev.count(k, status='success'):
            raise ZeroLooksWrong(f'{k}: no status=success at all in the widest window')
    if not ev.count('_death', fail_class='drowning'):
        raise ZeroLooksWrong("_death fail_class='drowning' absent from the widest window")
    return {n: names[n] for n in need}


def window_report(ev, hourly, fleet):
    """`fleet`: the bots seen in the widest window. A window whose own documents or bots are
    missing is an INGEST problem, not a quiet fleet, and is refused rather than reported as 0s."""
    hours = (ev.until - ev.since).total_seconds() / 3600
    if not ev.total():
        raise ZeroLooksWrong(f'{ev.since:%m-%d %H:%M}..{ev.until:%H:%M}Z holds NO documents although the widest '
                             f'window holds {len(fleet)} bots: ES ingest is behind or down -- not reporting zeros')
    bots = ev.bots_present()
    cov = ev.coverage()
    if ev.until - cov['newest'] > STALE_AFTER:
        raise ZeroLooksWrong(f'the newest document in {ev.since:%m-%d %H:%M}..{ev.until:%H:%M}Z is {cov["newest"]:%H:%M}Z, '
                             f'{int((ev.until - cov["newest"]).total_seconds() // 60)} min before the window ends: ingest is '
                             f'stalled -- not reporting zeros')
    caveats = list(ev.caveats)
    if cov['empty_hours']:
        caveats.append(f'NO documents at all in hours {cov["empty_hours"]} (ingest stall or fleet outage); '
                       f'rates below use active bot-hours, counts are short by whatever happened then')
    if cov['empty_10min'] and not cov['empty_hours']:
        caveats.append(f'NO documents at all in the 10-minute slots {cov["empty_10min"][:12]}'
                       f'{" ..." if len(cov["empty_10min"]) > 12 else ""} (a short ingest stall or outage)')
    bh = cov['bot_hours']
    deaths = ev.count('_death', allow_zero=True)
    out = {
        'since': ev.since.isoformat(), 'until': ev.until.isoformat(), 'hours': round(hours, 2),
        'active_bot_hours': bh, 'newest_doc': cov['newest'].isoformat(),
        'docs': ev.total(), 'bots': len(bots), 'bots_in_widest': len(fleet),
        'bots_absent': sorted(set(fleet) - set(bots)), 'caveats': caveats,
        'deaths': int(deaths),
        'deaths_per_bot_hour': round(deaths / bh, 4) if bh else None,
        'deaths_by_cause': dict(ev.terms('skill.fail_class', '_death', allow_zero=True)),
        'deaths_by_pool': grouped(ev.by_pool('_death', allow_zero=True)),
        'actions': {},
    }
    for k in ACTIONS:
        ok = ev.count(k, status='success', allow_zero=True)
        n = ev.count(k, allow_zero=True)
        out['actions'][k] = {'success': int(ok), 'attempts': int(n),
                             'success_pct': round(100 * ok / n, 1) if n else None,
                             'success_per_bot_hour': round(ok / bh, 3) if bh else None}
    drown = int(ev.count('_death', fail_class='drowning', allow_zero=True))
    dr = ev.by_pool('_death', fail_class='drowning', allow_zero=True)
    # by_pool carries a '<missing>' bucket for docs with no exp.pool, so the parts must sum to the
    # direct count; if they do not, the grouping is hiding documents and the table would lie
    for label, whole, parts in (('drownings', drown, dr), ('deaths by pool', int(deaths), out['deaths_by_pool']),
                                ('deaths by cause', int(deaths), out['deaths_by_cause'])):
        if sum(parts.values()) != whole:
            raise ZeroLooksWrong(f'{label}: by-pool parts sum to {sum(parts.values())} but the direct count is {whole}')
    out['drownings'] = drown
    out['drownings_by_pool'] = grouped(dr)
    h = ev.histogram('_death', interval='1h' if hourly else '1d', split='exp.pool',
                     fail_class='drowning', allow_zero=True)
    if sum(sum(v.values()) for v in h.values()) != drown:
        raise ZeroLooksWrong(f'drownings: the time breakdown sums to {sum(sum(v.values()) for v in h.values())} '
                             f'but the direct count is {drown}')
    out['drownings_by_' + ('hour' if hourly else 'day')] = {t: grouped(v) for t, v in h.items()}
    return out


def bag_report(now, stack_path):
    ev = EsEvents.load('skill', since=now - LAG - dt.timedelta(hours=3), until=now - LAG)
    slots_of, method = slot_counter(stack_path)
    # 'bot.pos.x', not 'bot.inventory': exists on the flattened inventory is false for an EMPTY
    # bag, so requiring it would show an emptied bot's previous, fuller snapshot
    lat = ev.latest(require='bot.pos.x', fields=['bot.inventory', 'exp.pool'])
    present = ev.bots_present()
    per, pool_slots = {}, defaultdict(list)
    oldest, no_inv = None, []
    for bot, src in lat.items():
        inv = (src.get('bot') or {}).get('inventory')
        if not isinstance(inv, dict):         # a pos row WITHOUT an inventory key is no snapshot, not an empty bag
            no_inv.append(bot)
            continue
        s = sum(slots_of(it, c) for it, c in inv.items() if isinstance(c, (int, float)))
        per[bot] = s
        pool_slots[pool_group((src.get('exp') or {}).get('pool'))].append(s)
        oldest = min(oldest or src['@timestamp'], src['@timestamp'])
    S = sorted(per.values())
    return {
        'method': method, 'bots_with_snapshot': len(per), 'bots_present_3h': len(present),
        'no_snapshot': sorted(set(present) - set(per)), 'pos_without_inventory': sorted(no_inv),
        'oldest_snapshot': oldest,
        'slots_min': S[0] if S else None, 'slots_median': statistics.median(S) if S else None,
        'slots_max': S[-1] if S else None,
        f'full_ge_{FULL_AT}': sum(x >= FULL_AT for x in S), f'at_{SLOTS}': sum(x >= SLOTS for x in S),
        'by_pool': {p: {'bots': len(v), 'median': statistics.median(v), f'ge_{FULL_AT}': sum(x >= FULL_AT for x in v)}
                    for p, v in sorted(pool_slots.items(), key=lambda x: str(x[0]))},
        'caveats': ev.caveats,
    }


def show(rep):
    print(f'FLEET STATUS (Elasticsearch) generated {rep["generated_at"]}  -- analysis only; gates read the files')
    for line in rep.get('elk_disk', {}).get('lines', []):
        print(line)
    if rep.get('opsaudit'):
        print(rep['opsaudit'])
    if rep.get('frontier'):
        print(rep['frontier'])
    if rep.get('learnloop'):
        print(rep['learnloop'])
    if rep.get('coop'):
        print(rep['coop'])
    if rep.get('lavamap'):
        print(rep['lavamap'])
    if rep.get('hazardmap'):
        print(rep['hazardmap'])
    if rep.get('structcount'):
        print(rep['structcount'])
    if rep.get('showcase_head'):
        print(rep['showcase_head'])
    for line in rep.get('w5_alarms') or []:
        print(line)
    print(f'names proven in the widest window: {rep["proven"]}')
    for name, w in rep['windows'].items():
        print(f'\n=== last {name}: {w["since"][:16]}Z .. {w["until"][:16]}Z  ({w["docs"]:,} docs, {w["bots"]} bots of '
              f'{w["bots_in_widest"]} seen in the widest window; absent: {w["bots_absent"] or "none"})')
        for c in w['caveats']:
            print(f'  caveat: {c}')
        print(f'  active bot-hours {w["active_bot_hours"]:,}; newest doc {w["newest_doc"][11:19]}Z')
        print(f'  deaths {w["deaths"]}  ({w["deaths_per_bot_hour"]} per active bot-hour)  by cause {w["deaths_by_cause"]}')
        print(f'  deaths by pool {w["deaths_by_pool"]}   (isolated-x = its 5 self-isolated bots)')
        for k, a in w['actions'].items():
            print(f'  {k:<13} {a["success"]:>7,} ok / {a["attempts"]:>7,} attempts ({a["success_pct"]}%)  '
                  f'{a["success_per_bot_hour"]} ok per active bot-hour')
        print(f'  drownings {w["drownings"]}  by pool {w["drownings_by_pool"]}')
        key = 'drownings_by_hour' if 'drownings_by_hour' in w else 'drownings_by_day'
        for t, pools in w[key].items():
            print(f'    {t[:13 if key.endswith("hour") else 10]}  {pools}')
    b = rep['bags']
    print(f'\n=== bags: latest inventory per bot, last 3 h ({b["method"]})')
    print(f'  {b["bots_with_snapshot"]} of {b["bots_present_3h"]} bots present have a snapshot (oldest {b["oldest_snapshot"]});'
          f' missing: {b["no_snapshot"] or "none"}; newest state row had NO inventory key: '
          f'{b["pos_without_inventory"] or "none"}')
    print(f'  slots used min {b["slots_min"]} median {b["slots_median"]} max {b["slots_max"]} of {SLOTS};'
          f' >= {FULL_AT}: {b[f"full_ge_{FULL_AT}"]}; at {SLOTS}: {b[f"at_{SLOTS}"]}')
    for p, v in b['by_pool'].items():
        print(f'    {p:<12} bots {v["bots"]}  median {v["median"]}  >= {FULL_AT}: {v[f"ge_{FULL_AT}"]}')
    if rep.get('showcase'):
        print('\n=== SHOWCASE (10.0.0.40; its own streams -- never part of the fleet numbers above)')
        for line in rep['showcase']['lines']:
            print(f'  {line}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--windows', default='3h,24h,7d')
    ap.add_argument('--now', help='ISO end time (default: now); windows end 5 min before it')
    ap.add_argument('--stack', default='~/stack.json')
    ap.add_argument('--json')
    ap.add_argument('--no-showcase', action='store_true', help='omit the SHOWCASE block (fleet sections unchanged)')
    a = ap.parse_args()
    now = (dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now
           else dt.datetime.now(dt.timezone.utc)).replace(second=0, microsecond=0)
    until = now - LAG
    wins = [(w, parse_window(w)) for w in a.windows.split(',')]
    if any(d is None for _, d in wins):
        raise SystemExit('windows look like 3h,24h,7d')
    evs = {w: EsEvents.load('skill', since=until - d, until=until, gaps='clip') for w, d in wins}
    widest = max(wins, key=lambda x: x[1])[0]
    rep = {'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
           'elk_disk': elk_disk(now), 'opsaudit': opsaudit_line(now), 'frontier': frontier_line(now), 'lavamap': lavamap_line(now), 'hazardmap': hazardmap_line(now), 'structcount': structcount_line(now), 'coop': coop_line(now), 'learnloop': learnloop_line(now), 'proven': prove_names(evs[widest]), 'windows': {}}
    fleet = evs[widest].bots_present()
    for w, d in wins:
        rep['windows'][w] = window_report(evs[w], hourly=d <= dt.timedelta(hours=48), fleet=fleet)
    rep['bags'] = bag_report(now, a.stack)
    if not a.no_showcase:
        rep['showcase_head'] = showcase_line(now)
        rep['showcase'] = showcase_report(until)
    rep['w5_alarms'] = w5_alarm_lines(now, None if a.no_showcase else (DISK_CLIENT or _est.http))
    show(rep)
    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(rep, fh, indent=1, default=str)


if __name__ == '__main__':
    main()
