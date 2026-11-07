#!/usr/bin/env python3
r"""statusreport.py -- the owner's plain-language status report, four times a day (OWNER 11-06: "a report of status of the
bots, wells, towns, buildings, projects, worlds themselves, showcase, what worked, what didnt work, what is stalled, in
simple terms a few times a day so i dont have to keep using tokens to do that").

THE DATA REPORT IS DETERMINISTIC and is the source of truth: every line comes from a file or a query this lab already
keeps (sources below), every number says what it is out of, and a source that cannot be read is a line that says so
('could not read ...'), never a blank or a zero. "What worked / what didn't / what's stalled" is RULES (judge(), pure,
tested with mutants in test_statusreport.py), not a model.

THE NARRATIVE (OWNER 11-06 later: "using tokens to build the report is okay if it makes it better") is an optional
writing pass on top: Claude Haiku 5.5 gets ONLY the generated data report and returns a short readable version of the
headline, what worked / didn't / stalled and what needs you. check_narrative() then rejects it unless every number in it
appears in the data report (and it has the required parts and no commit ids); any failure, refusal, timeout or reject
falls back to the deterministic text. Key: ~/.config/mcai/anthropic.key (mode 600, owned by this user; never printed,
never in the repo). No key -> an optional local model from ~/.config/mcai/statusreport.json {"local": {"url":
"http://host:11434", "model": "..."}} -> the deterministic text. Paid output is for this report only and is NEVER
training data (owner rule 11-01: paid labels are never trained on): it lives only under ~/digest/statusreport/, tagged
provenance "paid:anthropic:<model> report-only" in its sidecar. Spend is logged per call (llm-usage.jsonl) and capped.

Read-only on the worlds and the bots: it reads files, Elasticsearch (read-only key), Prometheus and the dashboard agents
over HTTP; it writes only ~/digest/statusreport/ and one push.

Sources (all on 10.0.0.31 unless said):
  fleetstatus.py --json   deaths + causes, gather/craft/deposit, bags, structcount line, showcase block (ES)
  busy-fleet.json         time split (skills / walking / deciding / idle); hourwatch-fleet.json the patrol lap share
  hourwatch/value-*.json  value per bot-h per closed hour; valuescore/<day>.json the daily value + items (logs/iron/coal)
  BOTS-PINNED.txt         stuckwatch's pinned bots;  goalwatch-fleet.json stuck goals;  projectaudit-fleet.json verdicts
  flowledger/out/latest.json  bags, the well (disposal pit) share, chests, blocks placed by town
  /var/lib/mcai project records  projects finished / started since the last report; structcount buildings by town
  canary-journal.jsonl + canary-sched.py status   kept / reverted / running / next
  ~/digest/STATE.json     pending owner decisions;  ALARMS.log + alarm-acks.json  open tier-1 alarms (lib/alarm tiers)
  Prometheus 10.0.0.186:9090  worlds up / TPS (fleet + showcase), host disks;  10.0.0.30:9188/backups.json  backups
  showcase: ES (bots, deaths, blocks placed by project, rollouts, halts, goals) + 10.0.0.186/agent/showcase/*.json
            (the .40 agent's deploy.jsonl and trip-last.json, proxied by the dashboard host)

Outputs (~/digest/statusreport/): report-<YYYYMMDDTHHMM>CT.{md,json,html} (+ .narrative.md when one was accepted),
latest.html, index.json (newest first). The dashboard serves them at http://10.0.0.186/status/ (latest; the previous four
one click away). One push through lib/alarm.deliver at priority 'default' (never an urgent page): the headline + the link.

    python3 -B host/statusreport.py run [--force] [--no-push] [--no-llm] [--out DIR]
    python3 -B host/statusreport.py due          # prints the slot this minute belongs to, or nothing
    python3 -B host/statusreport.py narrate FILE.md [--provider anthropic|local|none]   # the writing pass alone

Schedule: cron on .31 runs in UTC, so it fires at 00,05,06,11,12,17,18,23 :03Z and due_slot() keeps only the run whose
Central (America/Chicago) time is 12 AM / 6 AM / 12 PM / 6 PM -- CST and CDT both, no edit at the clock change.
"""
import argparse
import datetime as dt
import glob
import html
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

UTC = dt.timezone.utc
HOME = os.path.expanduser('~')
DIGEST = f'{HOME}/digest'
OUT = f'{DIGEST}/statusreport'
LINK = 'http://10.0.0.186/status/'
SLOT_HOURS = (0, 6, 12, 18)
SLOT_GRACE_MIN = 40
DEFAULT_WINDOW_H = 6
PROM = 'http://10.0.0.186:9090'
SHOW_PROXY = 'http://10.0.0.186/agent/showcase'
WORLDS_AGENT = 'http://10.0.0.30:9188'
KEY_FILE = f'{HOME}/.config/mcai/anthropic.key'
LLM_CONF = f'{HOME}/.config/mcai/statusreport.json'
MODEL = 'claude-haiku-5-5'
PRICE_IN, PRICE_OUT = 0.10, 0.50          # USD per million tokens, Claude Haiku 5.5 (prompts <= 100K tokens)
MONTH_CAP_USD = 3.00                      # ~4 reports/day x ~$0.002 = ~$0.25/month; the cap is a runaway guard
LLM_TIMEOUT_S = 90
OPERATOR_SOURCES = ('promomerge', 'stallcheck', 'stallcheck-promo', 'opsaudit', 'pager', 'restack-showcase')
HEX = re.compile(r'\b[0-9a-f]{7,40}\b')

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo('America/Chicago')
except Exception:                          # noqa: BLE001 -- a host without tzdata: fixed CST, and the page says so
    CT = dt.timezone(dt.timedelta(hours=-6), 'CST')


# ============================================================================================ pure: time
def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def ts(s):
    try:
        t = dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
        return t if t.tzinfo else t.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        return None


def ct(t, day=False):
    """A UTC time as the owner reads it: '6:00 AM' (or 'Fri 6:00 AM' with day=True), Central time."""
    if t is None:
        return '?'
    c = t.astimezone(CT)
    s = c.strftime('%I:%M %p').lstrip('0')
    return f'{c.strftime("%a")} {s}' if day else s


def due_slot(now, grace_min=SLOT_GRACE_MIN):
    """PURE. now (UTC) -> the report slot it belongs to ('2026-11-07 06:00 CT' style key) or None. A slot is due from
    its Central hour (12 AM, 6 AM, 12 PM, 6 PM) for grace_min minutes; the cron fires on both candidate UTC hours of
    every slot (CST = UTC-6, CDT = UTC-5) and only the one that lands inside the window runs."""
    c = now.astimezone(CT)
    if c.hour in SLOT_HOURS and c.minute < grace_min:
        return c.strftime('%Y-%m-%d %H:00')
    return None


def slot_name(slot):
    """'2026-11-07 06:00' -> 'Sat 6 AM' style label for subjects."""
    d = dt.datetime.strptime(slot, '%Y-%m-%d %H:%M')
    h = d.hour % 12 or 12
    return f'{d.strftime("%a")} {h} {"AM" if d.hour < 12 else "PM"}'


def window_hours(prev_at, now, default=DEFAULT_WINDOW_H, lo=1, hi=24):
    """PURE. Hours since the previous report (rounded, clamped to [lo, hi]); default when there is none."""
    if prev_at is None:
        return default
    h = round((now - prev_at).total_seconds() / 3600)
    return max(lo, min(hi, h))


# ============================================================================================ pure: small helpers
def n(x):
    """1234 -> '1,234'; 0.5 -> '0.5'; None -> '?'."""
    if x is None:
        return '?'
    if isinstance(x, float) and not x.is_integer():
        return f'{x:,.1f}' if abs(x) >= 10 else f'{x:,.2f}'.rstrip('0').rstrip('.')
    return f'{int(x):,}'


def pct(a, b):
    return None if not b else 100.0 * a / b


def p(a, b):
    """'12 of 80 (15%)'."""
    q = pct(a, b)
    return f'{n(a)} of {n(b)}' + (f' ({q:.0f}%)' if q is not None else '')


def plain(s, limit=160):
    """Strip commit ids, code formatting and underscores-as-spaces from a source string."""
    s = HEX.sub('', str(s or ''))
    s = s.replace('`', '').replace('_', ' ')
    s = re.sub(r'\s+', ' ', s).strip(' ;,-')
    return s if len(s) <= limit else s[:limit - 3].rstrip() + '...'


def where(home):
    """A project key 'board-b/tidy@-249_65_144' -> ('board-b', 'tidy')."""
    m = re.match(r'(?:goal:)?([^/]+)/([^@]+)', str(home))
    return (m.group(1), m.group(2)) if m else (str(home), '')


PLOT_WORDS = {'tidy': 'town clean-up', 'shaft': 'common mineshaft', 'wall': 'town wall', 'house1': 'house',
              'shop': 'workshop', 'well': 'well', 'chests': 'storage chests', 'composter': 'composter',
              'monument': 'monument', 'paths': 'paths', 'stepwell': 'stepwell', 'tower': 'tower', 'forest': 'forest',
              'treefarm': 'tree farm', 'cropfarm': 'crop farm', 'dress': 'town decorations', 'copperhall': 'copper hall',
              'storehouse': 'storehouse', 'workshop': 'workshop', 'stair': 'stair', 'grounds': 'grounds',
              'town': 'town', 'yard': 'stockpile yard', 'land': 'site preparation'}


def plot_word(plot):
    base = re.sub(r'\d+$', '', str(plot))
    return PLOT_WORDS.get(plot) or PLOT_WORDS.get(base) or str(plot).replace('_', ' ')


# ============================================================================================ pure: the rules
def judge(f, prev=None):
    """PURE. The facts dict -> {'worked': [(prio, text)], 'didnt': [...], 'stalled': [...], 'unread': [...]}, each sorted
    by priority (lower = more important). prev: the previous report's facts (or None). Every rule needs its inputs to
    be READ: an unreadable source never produces 'worked' or 'didn't', it lands in 'unread'."""
    W, D, S, U = [], [], [], []
    err = f.get('errors') or {}
    U += [(90, f'could not read {k}: {plain(v, 90)}') for k, v in sorted(err.items())]
    wh = f.get('window_h') or DEFAULT_WINDOW_H

    # --- bots
    b = f.get('bots') or {}
    run, exp = b.get('running'), b.get('expected')
    if run is not None and exp:
        if run < exp:
            D.append((5, f'{exp - run} of {exp} bots are not running'))
    win, week = b.get('win') or {}, b.get('week') or {}
    if win.get('active_bot_hours') and week.get('active_bot_hours'):
        r_now = win['deaths'] / win['active_bot_hours']
        r_week = week['deaths'] / week['active_bot_hours']
        expect = r_week * win['active_bot_hours']
        if win['deaths'] >= 3 and r_now >= 1.5 * r_week:
            D.append((10, f'more deaths than usual: {win["deaths"]} in the last {wh} h vs about {expect:.0f} expected '
                          f'from the 7-day rate'))
        elif expect >= 2 and win['deaths'] <= 0.5 * expect:
            W.append((40, f'fewer deaths than usual: {win["deaths"]} in the last {wh} h vs about {expect:.0f} expected'))
    pin = f.get('pinned') or {}
    if pin.get('n'):
        S.append((30, f'{pin["n"]} of {pin.get("of") or "?"} bots pinned in the same spot for 4 h or more '
                      f'({", ".join(x[0] for x in pin.get("bots", [])[:4])})'))

    # --- production
    v = f.get('value') or {}
    if v.get('cur') is not None and v.get('prev'):
        ch = (v['cur'] - v['prev']) / v['prev']
        if ch >= 0.10:
            W.append((20, f'production up {ch * 100:.0f}%: value {v["cur"]:.1f} per bot-hour over the last {v["cur_h"]} h '
                          f'vs {v["prev"]:.1f} over the {v.get("prev_h", 24)} h before'))
        elif ch <= -0.25:
            D.append((15, f'production down {-ch * 100:.0f}%: value {v["cur"]:.1f} per bot-hour over the last '
                          f'{v["cur_h"]} h vs {v["prev"]:.1f} over the {v.get("prev_h", 24)} h before'))

    # --- bags
    bg = f.get('bags') or {}
    if bg.get('bots'):
        full = bg.get('full') or 0
        if full > 0.25 * bg['bots']:
            D.append((25, f'bags filling up: {p(full, bg["bots"])} bots at 34+ of 36 slots'))
        pb = ((prev or {}).get('bags') or {})
        if pb.get('bots') and pb.get('full') is not None and pb['full'] - full >= 3:
            W.append((60, f'bags emptier: {full} bots at 34+ slots, down from {pb["full"]} at the last report'))
    fl = f.get('flow') or {}
    if fl.get('well_share') is not None and fl['well_share'] >= 0.5 and fl.get('cobble_new'):
        D.append((70, f'the well (disposal pit) took {fl["well_share"] * 100:.0f}% of new cobble '
                      f'({n(fl["cobble_well"])} of {n(fl["cobble_new"])}): too little gets used'))

    # --- towns and projects
    bt = f.get('built') or {}
    done = bt.get('completed') or []
    if done:
        W.append((15, f'{len(done)} project(s) finished: ' + ', '.join(f'{t} {plot_word(pl)}' for t, pl, _ in done[:6])
                      + (' ...' if len(done) > 6 else '')))
    bnow, bprev = bt.get('buildings') or {}, bt.get('buildings_prev') or {}
    if bnow and bprev:
        up = sum(bnow.values()) - sum(bprev.values())
        if up > 0:
            W.append((30, f'{up} more building(s) in the worlds than the day before ({sum(bnow.values())} now)'))
        elif up < 0:
            D.append((45, f'{-up} fewer building(s) in the worlds than the day before ({sum(bnow.values())} now)'))
    g = f.get('goals') or {}
    for x in (g.get('stuck') or [])[:8]:
        S.append((20 if x['hours'] >= 12 else 35,
                  f'{x["town"]} {plot_word(x["plot"])} stuck {x["hours"]:.0f} h' + (f' ({x["why"]})' if x.get('why') else '')))
    for t in g.get('blocked_towns') or []:
        S.append((15, f'{t}: no town work any bot can do (every open project stuck)'))
    pnow = {x['key'] for x in g.get('stuck') or []}
    unstuck = sorted({x['key'] for x in ((prev or {}).get('goals') or {}).get('stuck') or []} - pnow)
    if unstuck and g.get('read'):
        W.append((35, f'{len(unstuck)} stuck project(s) moving again: ' + ', '.join(
            f'{where(k)[0]} {plot_word(where(k)[1])}' for k in unstuck[:5])))
    pa = f.get('projects') or {}
    for x in [x for x in pa.get('attention') or [] if x['verdict'] in ('BROKEN', 'DORMANT')][:6]:
        D.append((30, f'{x["town"]} {plot_word(x["plot"])} is finished but {x["verdict"].lower()} ({plain(x["why"], 90)})'))

    # --- worlds
    w = f.get('worlds') or {}
    for x in w.get('down') or []:
        D.append((1, f'world {x} is DOWN'))
    for x, tps in (w.get('slow') or {}).items():
        D.append((12, f'world {x} lagging: TPS fell to {tps:.1f} (20 is full speed)'))
    for h, used in (w.get('disk_high') or {}).items():
        D.append((14, f'disk on {h} is {used:.0f}% full'))
    for x in w.get('backup_bad') or []:
        D.append((8, f'backup problem: {plain(x, 120)}'))

    # --- showcase
    sc = f.get('showcase') or {}
    for x in sc.get('rollbacks') or []:
        D.append((6, f'showcase rolled back: {plain(x, 100)}'))
    for x in sc.get('trips') or []:
        D.append((7, f'showcase stopped by its safety check: {plain(x, 100)}'))
    eps = sc.get('halts') or []
    if eps:
        back = sc.get('units') and sc['units'][0] >= sc['units'][1]
        mins = max((ts(b) - ts(a)).total_seconds() / 60 + 5 for a, b, _ in eps)
        D.append((35 if back else 7, f'showcase bots were down {len(eps)} time(s), the longest about {mins:.0f} min '
                                     f'({plain(re.split(r" -- |;", eps[-1][2])[0], 70)})'
                                     + ('; all back now' if back else '')))
    fails = [x for x in sc.get('rollouts') or [] if not x.get('ok')]
    passes = [x for x in sc.get('rollouts') or [] if x.get('ok')]
    for x in fails:
        D.append((9, f'showcase release failed its 60-minute check: {plain(x.get("why"), 100)}'))
    if passes:
        W.append((25, f'showcase: {len(passes)} release(s) passed the 60-minute check'))
    if sc.get('units') and sc['units'][0] < sc['units'][1]:
        D.append((11, f'showcase: {sc["units"][1] - sc["units"][0]} of {sc["units"][1]} bots not running'))
    for x in (sc.get('stuck') or [])[:4]:
        S.append((40, f'showcase {plot_word(x["plot"])} stuck {x["hours"]:.0f} h'))
    if sc.get('placed_total'):
        W.append((45, f'showcase bots placed {n(sc["placed_total"])} blocks'))
    if sc.get('deaths') is not None and sc.get('bot_hours') and sc.get('rate_7d') is not None:
        expect = sc['rate_7d'] * sc['bot_hours']
        if sc['deaths'] >= 2 and sc['deaths'] >= 2 * expect:
            D.append((28, f'showcase: {sc["deaths"]} deaths in the last {wh} h vs about {expect:.1f} expected from its 7-day rate'
                          + (f' ({", ".join(f"{k} {v}" for k, v in sc["death_causes"].items())})' if sc.get('death_causes') else '')))

    # --- canary pipeline
    c = f.get('canary') or {}
    for x in c.get('closed') or []:
        if x['verdict'] == 'KEEP':
            W.append((10, f'kept {x["run"]}' + (f' ({x["title"]})' if x.get('title') else '') + ' -- it goes to every bot'))
        elif x['verdict'] == 'REVERT':
            D.append((8, f'reverted {x["run"]}' + (f' ({x["title"]})' if x.get('title') else '') + ': the test did worse'))
    for x in c.get('effect_worse') or []:
        D.append((20, effect_text(x)))
    if c.get('slot_empty') and c.get('next'):
        S.append((25, f'no test running although {len(c["next"])}+ are ready'))
    if c.get('stalled_items'):
        S.append((50, f'{c["stalled_items"]} items in the work pipeline stalled (stallcheck)'))
    key = lambda x: x[0]
    return {'worked': sorted(W, key=key), 'didnt': sorted(D, key=key), 'stalled': sorted(S, key=key),
            'unread': sorted(U, key=key)}


EFFECT_RE = re.compile(r'EFFECT (\S+) h(\d+) WORSE: [\w.]+\{"name": "(\w+)"[^}]*\} ([\d.]+) \([^)]*\) -> ([\d.]+) \([^)]*\) ([-+][\d.]+%)')


def effect_text(line):
    """PURE. An effectwatch WORSE line -> plain words."""
    m = EFFECT_RE.search(str(line))
    if not m:
        return f'a kept change made things worse: {plain(line, 110)}'
    return (f'kept change {m.group(1)} made things worse: {m.group(3).replace("_", " ")} rate {m.group(4)} -> '
            f'{m.group(5)} ({m.group(6)}) in the {m.group(2)} h after it')


def rollout_text(why):
    """PURE. A deploy.jsonl 'why' -> what was rolled out, in a few words ('forest-02', 'CoreProtect CE 24.0')."""
    t = re.sub(r'^OWNER [\d-]+:\s*', '', str(why or ''))
    t = re.split(r' \(|;| -- |: ', t, maxsplit=1)[0]
    t = re.sub(r'\s*\b\d\d:\d\dZ\b', '', t)
    return plain(t, 80)


TRIP_WORDS = {'WATCH': 'watching (nothing harmful; no action taken)', 'OK': 'all clear', 'PASS': 'all clear'}


def trip_text(trip):
    """PURE. trip-last.json's verdict + reasons -> plain words (rule codes and bot tables dropped)."""
    v = str(trip.get('verdict') or '?')
    why = '; '.join(re.sub(r"\{[^}]*\}|\([^)]*\)|\bS\d+\b", '', str(w)).strip() for w in trip.get('why') or [])
    return TRIP_WORDS.get(v, v) + (f' -- {plain(why, 140)}' if why else '')


def timelapse_text(line):
    """PURE. fleetstatus' SHOWCASE TIMELAPSE line -> plain words (None stays None)."""
    if not line:
        return None
    m = re.search(r'TIMELAPSE (\w+): newest frame (\d+) min ago; last 24 h: (\d+) of (\d+) slots captured', line)
    if not m:
        return plain(re.sub(r'^\s*SHOWCASE TIMELAPSE ', '', line), 140)
    ev = re.search(r'every (\d+) min', line)
    return (f'{m.group(1)}: {m.group(3)} of {m.group(4)} pictures taken in 24 h'
            + (f' (one every {ev.group(1)} min)' if ev else '') + f', newest {m.group(2)} min ago')


def brain_text(line):
    """PURE. fleetstatus' SHOWCASE BRAIN line -> plain words."""
    if not line:
        return None
    m = re.search(r'BRAIN: (\d+) decisions', line)
    u = re.search(r'unserved (\d+)', line)
    models = re.findall(r"'([\w.:-]+)': \d+", line)
    if not m:
        return plain(line, 120)
    return (f'{n(int(m.group(1)))} decisions in 3 h' + (f' by {", ".join(models)}' if models else '')
            + (f'; {u.group(1)} unanswered' if u else ''))


def halt_episodes(rows, gap=dt.timedelta(minutes=11)):
    """PURE. showcase_halt rows that were not 'running' -> [(start, end, why)] episodes (5-min samples merged)."""
    out = []
    for r in sorted((r for r in rows if r.get('event') != 'running' and not r.get('ok', True)), key=lambda r: r.get('t') or ''):
        t = ts(r.get('t'))
        if not t:
            continue
        if out and t - out[-1][1] <= gap:
            out[-1][1] = t
        else:
            out.append([t, t, str(r.get('why') or '')])
    return [(a, b, w) for a, b, w in out]


def mood(j):
    """PURE. One word for line 1 of the headline. A report with an unread source is never 'GOOD'."""
    top_bad = min([x[0] for x in j['didnt']], default=99)
    if top_bad <= 9:
        return 'NEEDS A LOOK'
    if j['didnt'] or len(j['stalled']) >= 4:
        return 'MIXED'
    if j['unread']:
        return 'PARTLY UNKNOWN'
    return 'GOOD'


def headline(f, j):
    """PURE. The three headline lines."""
    b = f.get('bots') or {}
    first = (f'{mood(j)}. {n(b.get("running"))} of {n(b.get("expected"))} bots running; '
             f'{n((b.get("win") or {}).get("deaths"))} death(s) in the last {f.get("window_h")} h; '
             f'{len(j["worked"])} things worked, {len(j["didnt"])} did not, {len(j["stalled"])} stalled'
             + (f'; {len(j["unread"])} source(s) could not be read' if j['unread'] else '') + '.')
    win = j['worked'][0][1] if j['worked'] else 'nothing new to report as a win'
    bad = (j['didnt'] or j['stalled'] or j['unread'] or [(0, 'nothing serious found')])[0][1]
    return [first, f'Biggest win: {win}.', f'Biggest problem: {bad}.']


def owner_alarms(active, acks, now, tier_of, find_ack, pending=()):
    """PURE. active: {(source, key): (time, source, text)} (stategen.active_alarms). -> {'owner': [(src, key, text)],
    'operator': {source: n}, 'acked': n, 'pending': [(id, question)]}. Tier 1 only ('progress stopped and no rule fixes
    it'); operator sources (merges, the stall audit) are the control session's and are counted, not listed."""
    owner, operator, acked = [], {}, 0
    for (src, key), (_, _, text) in sorted(active.items()):
        if tier_of(src, key) != 1:
            continue
        if find_ack(acks, src, key, now) is not None:
            acked += 1
            continue
        if src in OPERATOR_SOURCES:
            operator[src] = operator.get(src, 0) + 1
        else:
            owner.append((src, key, text))
    return {'owner': owner, 'operator': operator, 'acked': acked, 'pending': list(pending)}


# ============================================================================================ pure: facts from sources
def busy_shares(sec):
    """busy-fleet.json 'seconds' -> shares {skills, walking, deciding, idle} of observed time."""
    tot = sum(v for k, v in sec.items() if k not in ('unobserved', 'dead'))
    if not tot:
        return None
    return {'skills': sec.get('productive', 0) / tot, 'walking': sec.get('walking', 0) / tot,
            'deciding': (sec.get('between', 0) + sec.get('llm_wait', 0) + sec.get('paused', 0)) / tot,
            'idle': sec.get('idle', 0) / tot}


def value_window(hours, now, cur_h, min_prev=20):
    """PURE. hours: hourwatch's per-hour cache [{'hour': iso, 'value', 'bot_hours'}] -> value per bot-h over the last cur_h
    CLOSED hours ending at this hour (one hour of cache lag allowed: hourwatch writes at :25) and over the 24 h before.
    Readable hours only (bot_hours > 0). A window missing more than one of its hours is None, never an old window passed
    off as current: 'missing' says how many."""
    by = {ts(h['hour']): h for h in hours if ts(h.get('hour')) and (h.get('bot_hours') or 0) > 0}
    end = now.replace(minute=0, second=0, microsecond=0)
    if end - dt.timedelta(hours=1) not in by:
        end -= dt.timedelta(hours=1)                    # the newest closed hour is not cached yet
    pick = lambda a, b: [by[t] for t in (a + dt.timedelta(hours=i) for i in range(int((b - a).total_seconds() // 3600)))
                         if t in by]
    cut = end - dt.timedelta(hours=cur_h)
    cur, prev = pick(cut, end), pick(cut - dt.timedelta(hours=24), cut)
    s = lambda xs, k: sum(x.get(k) or 0 for x in xs)
    cb, pb = s(cur, 'bot_hours'), s(prev, 'bot_hours')
    ok_cur, ok_prev = len(cur) >= max(1, cur_h - 1), len(prev) >= min_prev
    return {'cur': s(cur, 'value') / cb if cb and ok_cur else None, 'cur_bh': cb, 'cur_h': len(cur), 'end': iso(end),
            'prev': s(prev, 'value') / pb if pb and ok_prev else None, 'prev_bh': pb, 'prev_h': len(prev),
            'missing': (cur_h - len(cur)) + (24 - len(prev))}


IRON = ('raw_iron', 'iron_ore', 'deepslate_iron_ore')
COAL = ('coal', 'coal_ore', 'deepslate_coal_ore')


def day_items(units):
    """valuescore units_by_item -> {'logs', 'iron', 'coal', 'cobble'}."""
    u = units or {}
    return {'logs': sum(v for k, v in u.items() if k.endswith('_log')),
            'iron': sum(u.get(k, 0) for k in IRON), 'coal': sum(u.get(k, 0) for k in COAL),
            'cobble': u.get('cobblestone', 0) + u.get('cobbled_deepslate', 0)}


def parse_pinned(text):
    """BOTS-PINNED.txt -> {'n', 'of', 'at', 'bots': [(name, pos)]}."""
    lines = (text or '').splitlines()
    if not lines:
        return None
    m = re.match(r'(\S+)\s+(\d+) of (\d+) bots PINNED', lines[0])
    if not m:
        return None
    bots = []
    for line in lines[1:]:
        mm = re.match(r'\s+(\S+)\s+at \(([^)]*)\)', line)
        if mm:
            bots.append((mm.group(1), mm.group(2)))
    return {'n': int(m.group(2)), 'of': int(m.group(3)), 'at': m.group(1), 'bots': bots}


STUCK_RE = re.compile(r'STUCK ([\d.]+) h: ([^ ]+) -- (.*?); blocker: (.*)$')


def parse_stuck(line):
    m = STUCK_RE.match(str(line))
    if not m:
        return None
    town, plot = where(m.group(2))
    why = m.group(4)
    why = re.sub(r'last _build_visit \S+ by \S+: ', '', why)
    mm = re.search(r'why=([^;]*)', why)
    why = mm.group(1) if mm else why.split(';')[0]
    why = why.replace('_', ' ')
    if ' -- ' in why:
        why = why.split(' -- ', 1)[1].split(';')[0]
    elif 'no bot is visiting' in why:
        why = 'no bot is visiting the site'
    why = re.sub(r'\s*\(first [^)]*\)?', '', why.replace('_', ' '))
    return {'key': 'goal:' + m.group(2), 'town': town, 'plot': plot, 'hours': float(m.group(1)),
            'why': plain(why.replace('_', ' '), 80)}


def finished_projects(records, since, until):
    """records: [(pool, plot, record dict)] -> (completed [(town, plot, iso)], started [(town, plot, iso)])."""
    done, started = [], []
    for pool, plot, rec in records:
        c = rec.get('completeAt')
        if isinstance(c, (int, float)):
            t = dt.datetime.fromtimestamp(c / 1000, UTC)
            if since <= t < until:
                done.append((pool, plot, iso(t)))
        a = rec.get('_first_at')
        if isinstance(a, (int, float)):
            t = dt.datetime.fromtimestamp(a / 1000, UTC)
            if since <= t < until:
                started.append((pool, plot, iso(t)))
    return sorted(done, key=lambda x: x[2]), sorted(started, key=lambda x: x[2])


def canary_facts(rows, status, since, now, titles=None):
    """Journal rows + parsed sched status -> {'closed': [...], 'promoted': [...], 'running': [...], 'next': [...],
    'held': n, 'slot_empty': bool}. PURE."""
    titles = titles or {}
    closed, promoted, deployed = [], [], {}
    for r in rows:
        t, run, ph = ts(r.get('ts')), r.get('run'), r.get('phase')
        if not t or not run:
            continue
        if ph == 'deployed':
            deployed[run] = t
        if t < since or t > now:
            continue
        note = str(r.get('note') or '')
        m = re.match(r'\s*(KEEP|REVERT|INCONCLUSIVE)\b', note, re.I)
        if ph == 'recorded' and m:
            closed.append({'run': run, 'verdict': m.group(1).upper(), 't': iso(t), 'title': titles.get(run)})
        elif ph == 'promoted':
            promoted.append({'run': run, 't': iso(t)})
    running = [{'run': e['run'], 'since': iso(deployed[e['run']]) if e['run'] in deployed else None,
                'title': titles.get(e['run'])} for e in status if e['state'] == 'running']
    ready = [e for e in status if e['state'] == 'ready']
    free = [e for e in ready if not e.get('hold')]
    held = [e for e in ready if e.get('hold')]
    return {'closed': closed, 'promoted': promoted, 'running': running,
            'next': [{'run': e['run'], 'title': titles.get(e['run'])} for e in free[:3]],
            'ready': len(free), 'held': len(held), 'slot_empty': not running}


def short_title(t, limit=70):
    """PURE. A ledger title -> its first clause, parentheses dropped, cut at a word boundary."""
    t = re.sub(r'\([^()]*\)', '', str(t or ''))
    t = re.split(r' -- |; |: (?=[a-z])|\. ', t, maxsplit=1)[0]
    t = plain(re.sub(r'^[\w.-]+-\d\d\b[\s:(-]*', '', t).strip(' ()'), 400)
    if len(t) > limit:
        t = t[:limit].rsplit(' ', 1)[0] + '...'
    return t


def title_of(run, ledger):
    """PURE. A canary run name -> a short plain title from the ledger, or None. Ledger ids are '<base>-<mmdd>' and the
    base is the run ('stations-01' -> 'stations'), its numbered form ('idlework-02' -> 'idlework2'), or the run itself;
    else an item that names the run in its evidence."""
    items = (ledger or {}).get('items') or []
    base = {re.sub(r'-\d{4}$', '', str(it.get('id') or '')): it for it in items}
    m = re.match(r'^(.*?)-0*(\d+)$', run)
    cands = [run]
    if m:
        cands += [m.group(1)] if m.group(2) == '1' else [m.group(1) + m.group(2)]
    for c in cands:
        if c in base and base[c].get('title'):
            return short_title(base[c]['title']) or None
    for it in reversed(items):
        ev = it.get('evidence') or {}
        if run in (ev.get('grep') or []) or run in (ev.get('branches') or []):
            return short_title(it.get('title')) or None
    return None


def showcase_deploy_facts(rows, since):
    """The .40 agent's releases.json rows (newest first) -> rollbacks / quarantines / activations in the window."""
    rb, qu, act, notes = [], [], [], []
    for r in rows or []:
        t = ts(r.get('t'))
        if not t or t < since:
            continue
        ev, why = str(r.get('event') or ''), str(r.get('why') or '')
        if ev == 'rollback':
            rb.append(why or ev)
        elif ev == 'quarantine':
            qu.append(why or ev)
        elif ev in ('activated', 'rollout'):
            act.append({'t': iso(t), 'event': ev, 'why': why})
        elif ev in ('stop-bots', 'trip-remedy', 'owner-repair', 'owner-oneoff'):
            notes.append(f'{ev}: {why}')
    return {'rollbacks': rb, 'quarantines': qu, 'activations': act, 'notes': notes}


def placed_by_project(details):
    """_build_visit skill.detail strings -> {project: blocks placed}."""
    out = {}
    for d in details:
        m, mm = re.search(r'\bproject=(\S+)', d or ''), re.search(r'\bplaced=(\d+)', d or '')
        if m and mm and int(mm.group(1)):
            out[m.group(1)] = out.get(m.group(1), 0) + int(mm.group(1))
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


# ============================================================================================ pure: render
def bullets(items, empty):
    return [f'- {t}' for _, t in items] if items else [f'- {empty}']


def render(f, j, now):
    """PURE. facts + judgement -> the data report (markdown)."""
    L = []
    wh = f['window_h']
    since = ts(f['since'])
    L.append(f'# Bot status report -- {ct(now, day=True)} CT')
    L.append(f'_Covers the last {wh} h ({ct(since, day=True)} to {ct(now)} Central). Data report: every number comes '
             f'from the lab\'s own logs and checks; nothing here is written by a model._')
    L.append('')
    L.append('## 1. Headline')
    L += [f'- {x}' for x in headline(f, j)]
    L.append('')

    # 2 bots
    L.append('## 2. Bots')
    b = f.get('bots') or {}
    if b.get('error'):
        L.append(f'- could not read the bot numbers: {plain(b["error"], 120)}')
    else:
        win, day = b.get('win') or {}, b.get('day') or {}
        L.append(f'- Running: {p(b.get("running"), b.get("expected"))} bots.')
        for lab, w_ in ((f'last {wh} h', win), ('last 24 h', day)):
            if w_:
                causes = ', '.join(f'{k} {v}' for k, v in sorted((w_.get('deaths_by_cause') or {}).items(), key=lambda kv: -kv[1]))
                L.append(f'- Deaths, {lab}: {n(w_.get("deaths"))} in {n(w_.get("active_bot_hours"))} bot-hours'
                         + (f' ({causes})' if causes else '') + '.')
        wk = b.get('week') or {}
        if wk.get('active_bot_hours'):
            L.append(f'- 7-day death rate: {n(wk["deaths"])} in {n(wk["active_bot_hours"])} bot-hours '
                     f'(about {wk["deaths"] / wk["active_bot_hours"] * 100:.1f} per 100 bot-hours).')
    pin = f.get('pinned')
    if pin:
        L.append(f'- Stuck in the same spot 4 h+: {p(pin["n"], pin["of"])} bots'
                 + (': ' + ', '.join(f'{a} at {pos}' for a, pos in pin['bots'][:5]) if pin['bots'] else '') + '.')
    bs = f.get('busy')
    if bs:
        L.append(f'- Time split (24 h, {n(bs.get("bot_hours"))} bot-hours): working {bs["skills"] * 100:.0f}%, walking '
                 f'{bs["walking"] * 100:.0f}%, deciding/waiting {bs["deciding"] * 100:.0f}%, idle {bs["idle"] * 100:.0f}%.'
                 + (f' Patrol lap (walking rounds with nothing to do) {bs["lap"] * 100:.0f}% of the last hour.'
                    if bs.get('lap') is not None else ''))
    L.append('')

    # 3 production
    L.append('## 3. Production')
    v = f.get('value') or {}
    if v.get('cur') is not None:
        L.append(f'- Value per bot-hour: {v["cur"]:.1f} over the {v["cur_h"]} h to {ct(ts(v.get("end")))} '
                 f'({n(v["cur_bh"])} bot-hours) vs ' + (f'{v["prev"]:.1f} over the {v.get("prev_h", 24)} readable h before.' if v.get('prev') is not None
                                                      else 'no readable 24 h before it.'))
    if v.get('daily'):
        L.append('- Daily value per bot-hour: ' + ', '.join(f'{d[5:]} {x:.1f}' for d, x in v['daily'][-7:]) + '.')
    if v.get('yday'):
        y, med = v['yday'], v.get('median') or {}
        L.append(f'- Yesterday ({v["yday_day"][5:]}) the bots brought in: logs {n(y["logs"])}, iron ore {n(y["iron"])}, '
                 f'coal {n(y["coal"])}, cobble {n(y["cobble"])}'
                 + (f' (7-day median: logs {n(med.get("logs"))}, iron {n(med.get("iron"))}, coal {n(med.get("coal"))})'
                    if med else '') + '.')
    acts = ((f.get('bots') or {}).get('win') or {}).get('actions') or {}
    if acts:
        L.append('- Last ' + f'{wh} h: ' + '; '.join(
            f'{k.replace("_", " ")} {n(a["success"])} of {n(a["attempts"])} worked' for k, a in acts.items()) + '.')
    if not v and not acts:
        L.append('- could not read production numbers')
    L.append('')

    # 4 bags, chests, pit
    L.append('## 4. Bags, chests and the disposal pit')
    bg = f.get('bags') or {}
    if bg.get('bots'):
        L.append(f'- Bags: median {n(bg.get("median"))} of 36 slots used; {p(bg.get("full"), bg["bots"])} bots at 34+ '
                 f'(nearly full), {n(bg.get("at36"))} completely full.')
        worst = [f'{k} {v_["ge34"]}' for k, v_ in sorted((bg.get('by_town') or {}).items()) if v_.get('ge34')]
        if worst:
            L.append(f'- Nearly-full bags by town: {", ".join(worst)}.')
    fl = f.get('flow') or {}
    if fl:
        if fl.get('cobble_new'):
            L.append(f'- Cobble, last {fl.get("window_h")} h: {n(fl["cobble_new"])} new; {n(fl.get("cobble_spent"))} used, '
                     f'{n(fl.get("cobble_banked"))} put in chests, {n(fl.get("cobble_well"))} thrown in the well'
                     + (f' ({fl["well_share"] * 100:.0f}%)' if fl.get('well_share') is not None else '') + '.')
        if fl.get('well24'):
            L.append(f'- Well over 24 h: {fl["well24"]}.')
        if fl.get('chest_items') is not None:
            top = ', '.join(f'{k} {n(v_)}' for k, v_ in list(fl.get('chest_groups', {}).items())[:6])
            L.append(f'- Town chests hold {n(fl["chest_items"])} items in {fl["towns_counted"]} of {fl["towns"]} towns '
                     f'counted' + (f' ({top})' if top else '') + f'; cobble in bags {n(fl.get("bag_cobble"))}.')
        if fl.get('stations_left') is not None:
            L.append(f'- Crafting tables / furnaces: {n(fl["stations_crafted"])} made, {n(fl["stations_left"])} left '
                     f'behind in the world ({fl.get("window_h")} h).')
    else:
        L.append('- could not read the flow ledger')
    L.append('')

    # 5 towns and buildings
    L.append('## 5. Towns and buildings')
    bt = f.get('built') or {}
    bnow = bt.get('buildings') or {}
    if bnow:
        prev = bt.get('buildings_prev') or {}
        L.append(f'- Buildings with walls and a roof (counted from the world each night): {sum(bnow.values())} in '
                 f'{len(bnow)} worlds' + (f' ({sum(bnow.values()) - sum(prev.values()):+d} vs the night before)' if prev else '')
                 + '. By town: ' + ', '.join(f'{k} {v_}' for k, v_ in sorted(bnow.items())) + '.')
    if bt.get('completed') is not None:
        L.append(f'- Finished in the last {wh} h: ' + (', '.join(f'{t} {plot_word(pl)} ({ct(ts(at))})' for t, pl, at in
                                                           bt['completed']) or 'none') + '.')
        L.append(f'- Started in the last {wh} h: ' + (', '.join(f'{t} {plot_word(pl)}' for t, pl, _ in bt['started'])
                                                          or 'none') + '.')
    if bt.get('placed'):
        tot = sum(bt['placed'].values())
        L.append(f'- Blocks placed on town projects, last {bt.get("placed_h")} h: {n(tot)}. By town: ' + ', '.join(
            f'{k} {n(v_)}' for k, v_ in sorted(bt['placed'].items(), key=lambda kv: -kv[1]) if v_) + '.')
    g = f.get('goals') or {}
    if g.get('read'):
        L.append(f'- Open projects: {g["open"]} of {g["records"]} on record; stuck 3 h+: {len(g.get("stuck") or [])}.')
        for x in g.get('stuck') or []:
            L.append(f'  - {x["town"]} {plot_word(x["plot"])}: stuck {x["hours"]:.0f} h ({x["why"]})')
        for t in g.get('blocked_towns') or []:
            L.append(f'  - {t}: every open project is stuck, so its bots have no town work')
    if not (bnow or g.get('read') or bt.get('completed') is not None):
        L.append('- could not read the town numbers')
    L.append('')

    # 6 projects
    L.append('## 6. Finished projects: are they used?')
    pa = f.get('projects') or {}
    if pa.get('counts'):
        c = pa['counts']
        L.append(f'- Daily audit ({ct(ts(pa.get("at")), day=True)}; {pa.get("total")} projects in 7 days): '
                 f'{c.get("EFFECTIVE", 0)} working as meant, {c.get("UNDERUSED", 0)} underused, {c.get("DORMANT", 0)} '
                 f'dormant, {c.get("BROKEN", 0)} broken, {c.get("UNMEASURED", 0)} no way to measure yet.')
        att = pa.get('attention') or []
        groups = {}
        for x in att:
            groups.setdefault((x['verdict'], x['plot']), []).append(x['town'])
        for (verdict, plot), towns in sorted(groups.items()):
            whys = [x['why'] for x in att if x['verdict'] == verdict and x['plot'] == plot]
            L.append(f'  - {verdict.lower()}: {plot_word(plot)} in {len(towns)} town(s) ({", ".join(towns[:8])}'
                     f'{" ..." if len(towns) > 8 else ""}) -- e.g. {plain(whys[0], 110)}')
    else:
        L.append('- could not read the project audit')
    if pa.get('showcase'):
        L.append(f'- Showcase audit: {plain(pa["showcase"], 260)}')
    L.append('')

    # 7 worlds
    L.append('## 7. Worlds and servers')
    w = f.get('worlds') or {}
    if w.get('worlds'):
        up = [x for x in w['worlds'] if x['up']]
        L.append(f'- Minecraft servers up: {p(len(up), len(w["worlds"]))}; players online {n(w.get("players"))}'
                 + (f'; slowest TPS in the last {wh} h {w["min_tps"]:.1f} (20 is full speed)' if w.get('min_tps') is not None
                    else '') + '.')
        if w.get('down'):
            L.append(f'- DOWN: {", ".join(w["down"])}.')
    else:
        L.append('- could not read the world servers')
    if w.get('disks'):
        L.append('- Disk used: ' + ', '.join(f'{h} {u:.0f}%' for h, u in sorted(w['disks'].items())) + '.')
    if w.get('elk'):
        L.append(f'- Log store: {plain(w["elk"], 160)}.')
    if w.get('backups'):
        for x in w['backups']:
            L.append(f'- Backup: {plain(x, 160)}.')
    elif 'backups' in (f.get('errors') or {}):
        L.append('- Backups: could not read the backup check.')
    L.append('')

    # 8 showcase
    L.append('## 8. Showcase')
    sc = f.get('showcase') or {}
    if sc:
        if sc.get('units'):
            L.append(f'- Bots running: {p(*sc["units"])} bot services' + (f'; quarantined: {", ".join(sc["quarantined"])}'
                                                                           if sc.get('quarantined') else '')
                     + (f'; {sc["silent"][0]} of the {sc["silent"][1]} bots seen in 24 h are not active now '
                        f'({", ".join(sc["silent"][2])}: stopped or quarantined)' if sc.get('silent') else '') + '.')
        if sc.get('deaths') is not None:
            L.append(f'- Deaths, last {wh} h: {sc["deaths"]}' + (f' ({", ".join(f"{k} {v_}" for k, v_ in sc["death_causes"].items())})'
                                                                  if sc.get('death_causes') else '') + f'; bots seen {sc.get("bots")}.')
        if sc.get('placed'):
            L.append(f'- Blocks placed, last {wh} h: {n(sc["placed_total"])} in {n(sc.get("visits"))} build visits. By project: ' + ', '.join(
                f'{plot_word(k)} {n(v_)}' for k, v_ in list(sc['placed'].items())[:8]) + '.')
        for x in sc.get('activations') or []:
            what = rollout_text(x.get('why'))
            L.append(f'- {"New release started" if x["event"] == "activated" else "Change rolled out"} {ct(ts(x["t"]))}'
                     + (f': {what}' if what else '') + '.')
        for a_, b_, why in sc.get('halts') or []:
            span = f'at {ct(ts(a_))}' if a_ == b_ else f'{ct(ts(a_))} to {ct(ts(b_))}'
            L.append(f'- Bots down {span}: {plain(re.split(r" -- |; down ", why)[0], 120)}.')
        for x in sc.get('rollouts') or []:
            dm = re.search(r'deaths (\d+) / ([\d.]+) active bot-h', str(x.get('why') or ''))
            L.append(f'- 60-minute check after a release, {ct(ts(x["t"]))}: {"PASS" if x["ok"] else "FAIL"}'
                     + (f' ({dm.group(1)} deaths in {dm.group(2)} bot-hours)' if dm else f' ({plain(x.get("why"), 120)})'))
        if sc.get('trip'):
            L.append(f'- Safety check (tripwire) {ct(ts(sc["trip"].get("t")))}: {trip_text(sc["trip"])}.')
        for x in sc.get('stuck') or []:
            L.append(f'- Stuck: {plot_word(x["plot"])} {x["hours"]:.0f} h ({x["why"]}).')
        if sc.get('timelapse'):
            L.append(f'- Timelapse: {plain(sc["timelapse"], 140)}.')
        if sc.get('brain'):
            L.append(f'- Brain: {plain(sc["brain"], 120)}.')
    else:
        L.append('- could not read the showcase')
    L.append('')

    # 9 canary
    L.append('## 9. Testing pipeline (one change tested at a time on 10 bots, then given to all)')
    c = f.get('canary') or {}
    if c:
        cl = c.get('closed') or []
        L.append(f'- Decided in the last {wh} h: ' + ('; '.join(f'{x["verdict"]} {x["run"]}' + (f' ({x["title"]})' if x.get('title') else '')
                                                            + f' at {ct(ts(x["t"]))}' for x in cl) or 'none') + '.')
        L.append('- Testing now: ' + ('; '.join(f'{x["run"]}' + (f' ({x["title"]})' if x.get('title') else '')
                                               + (f', since {ct(ts(x["since"]))}' if x.get('since') else '') for x in c.get('running') or [])
                                     or 'nothing') + '.')
        L.append('- Next up: ' + ('; '.join(f'{x["run"]}' + (f' ({x["title"]})' if x.get('title') else '') for x in c.get('next') or [])
                                 or 'nothing ready') + f'. Ready {c.get("ready", 0)}, waiting on something {c.get("held", 0)}.')
    else:
        L.append('- could not read the testing pipeline')
    L.append('')

    # 10 judged
    L.append('## 10. What worked, what didn\'t, what is stalled')
    L.append('**Worked**')
    L += bullets(j['worked'], 'nothing new')
    L.append('**Didn\'t work**')
    L += bullets(j['didnt'], 'nothing found')
    L.append('**Stalled**')
    L += bullets(j['stalled'], 'nothing stalled')
    if j['unread']:
        L.append('**Could not check**')
        L += bullets(j['unread'], '')
    L.append('')

    # 11 alarms
    L.append('## 11. Needs you')
    a = f.get('alarms')
    errs = f.get('errors') or {}
    if a is None:
        L.append(f'- could not read the alarms ({plain(errs.get("alarms", "no result"), 100)}), so this report cannot '
                 f'say that nothing needs you')
    else:
        if 'owner decisions' in errs:
            L.append('- could not read the list of decisions waiting for you (STATE.json)')
        items = [f'decision waiting: {plain(q, 200)}' for _, q in a.get('pending') or []]
        items += [f'{plain(t, 170)}' for _, _, t in a.get('owner') or []]
        L += [f'- {x}' for x in items] or (['- nothing needs you right now'] if 'owner decisions' not in errs else [])
        if a.get('operator'):
            L.append(f'- (Handled by the control session, already paged: '
                     + ', '.join(f'{k} {v_}' for k, v_ in sorted(a['operator'].items())) + '.)')
        if a.get('acked'):
            L.append(f'- ({a["acked"]} alarm(s) acknowledged and on hold.)')
    L.append('')
    L.append(f'_Next report about 6 h after this one. Archive: {LINK} (latest + previous four)._')
    return '\n'.join(L) + '\n'


# ============================================================================================ pure: the narrative check
NUM = re.compile(r'(?<![\w.])-?\d[\d,]*(?:\.\d+)?')


def numbers_in(text):
    """PURE. Every number in a text, normalised ('1,234' -> '1234', '06' -> '6', '5.0' -> '5')."""
    out = set()
    for m in NUM.finditer(text or ''):
        s = m.group(0).replace(',', '')
        try:
            v = float(s)
        except ValueError:
            continue
        out.add(str(int(v)) if v.is_integer() else repr(round(v, 4)).rstrip('0'))
    return out


NUM_WORDS = re.compile(r"\b(?:zero|(?<!no )(?<!any)(?<!some)one(?! of\b)(?! by one\b)(?! spot\b)(?! place\b)(?! at a time\b)|two|three|four|five|six|seven|eight|nine|"
                       r"ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|"
                       r"thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozens?|twice|"
                       r"thrice|half|double|triple|quarter|single)\b", re.I)
NARR_PARTS = ('in short', 'worked', 'didn', 'stalled', 'needs you')


def _phrase_in(narr, m, low_src):
    """A number word quoted with its next word from the source ('in one spot' -> 'one spot') is not a new quantity."""
    nxt = re.match(r'[ -]+([a-z]+)', narr[m.end():].lower())
    if not nxt:
        return False
    return re.search(r'\b' + re.escape(m.group(0).lower()) + r'[ -]+' + re.escape(nxt.group(1)) + r'\b', low_src) is not None


def check_narrative(narr, source, max_chars=3000):
    """PURE. -> (ok, why). Rejects: empty or too long, a missing part, a commit id, any number not in the source."""
    if not narr or not narr.strip():
        return False, 'empty'
    if len(narr) > max_chars:
        return False, f'too long ({len(narr)} chars > {max_chars})'
    low = narr.lower()
    miss = [x for x in NARR_PARTS if x not in low]
    if miss:
        return False, f'missing part(s): {", ".join(miss)}'
    if HEX.search(narr) and any(re.search(r'[a-f]', h) for h in HEX.findall(narr)):
        return False, 'contains a commit id'
    low_src = re.sub(r'\s+', ' ', source.lower())
    words = [m.group(0) for m in NUM_WORDS.finditer(narr) if not _phrase_in(narr, m, low_src)]
    if words:
        return False, f'spelled-out quantity ({", ".join(sorted(set(w.lower() for w in words))[:5])}): numbers must be digits'
    extra = sorted(numbers_in(narr) - numbers_in(source), key=lambda s: (len(s), s))
    if extra:
        return False, f'numbers not in the data report: {", ".join(extra[:8])}'
    return True, 'ok'


SYSTEM = """You turn a lab's status report about Minecraft bots into a short note for its owner, who reads it on a phone.
Use ONLY facts from the report. Never add a fact, a cause, a guess or advice that is not in it. Every number you write must
appear in the report exactly as written there (you may leave numbers out; never compute new ones: no sums, differences,
percentages or roundings). Write every quantity as digits, never as words (2, not "two"; no "half", "twice", "a dozen").
Times are Central time; write them as the report does. Plain words, no code names of software
changes unless the report gives them, no commit ids, no markdown tables.

Write exactly these five parts, each a heading line followed by short lines starting with "- ":
In short        (3 lines: how it is going, the biggest win, the biggest problem)
What worked     (at most 5 lines)
What didn't     (at most 5 lines)
What's stalled  (at most 5 lines)
What needs you  (at most 4 lines; say "Nothing right now." if the report says nothing needs the owner)
Keep the whole note under 220 words."""


def narrative_prompt(report_md):
    return [{'role': 'user', 'content': 'The status report:\n\n' + report_md}]


def month_spend(rows, now):
    """PURE. llm-usage rows -> USD spent this calendar month (UTC)."""
    key = now.strftime('%Y-%m')
    return sum(float(r.get('usd') or 0) for r in rows if str(r.get('t') or '').startswith(key))


def usd(usage):
    return (usage.get('input_tokens', 0) * PRICE_IN + usage.get('output_tokens', 0) * PRICE_OUT) / 1e6


# ============================================================================================ pure: html
def md_to_html(md):
    """PURE. The report's own small markdown (headings, '- ' / '  - ' bullets, **bold** lines, _italic_ lines) -> HTML."""
    out, open_ul = [], 0

    def close(to=0):
        nonlocal open_ul
        while open_ul > to:
            out.append('</ul>')
            open_ul -= 1

    def inline(s):
        s = html.escape(s)
        s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
        return re.sub(r'(?<![\w])_(.+?)_(?![\w])', r'<em>\1</em>', s)

    for line in md.splitlines():
        m = re.match(r'^(#{1,3}) (.*)$', line)
        b = re.match(r'^( *)- (.*)$', line)
        if m:
            close()
            lv = len(m.group(1))
            out.append(f'<h{lv}>{inline(m.group(2))}</h{lv}>')
        elif b:
            depth = len(b.group(1)) // 2 + 1
            while open_ul < depth:
                out.append('<ul>')
                open_ul += 1
            close(depth)
            out.append(f'<li>{inline(b.group(2))}</li>')
        elif line.strip():
            close()
            out.append(f'<p>{inline(line)}</p>')
        else:
            close()
    close()
    return '\n'.join(out)


PAGE_CSS = """
:root{--bg:#ffffff;--fg:#1d2330;--muted:#5d6675;--card:#f4f6f9;--line:#d9dee6;--accent:#2f6fde;--bad:#b42318;--good:#18794e}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#111317;--fg:#e6e8ec;--muted:#9aa3b2;--card:#1a1d23;
--line:#2a2f38;--accent:#7aa7ff;--bad:#ff8a80;--good:#5fd39a}}
:root[data-theme="dark"]{--bg:#111317;--fg:#e6e8ec;--muted:#9aa3b2;--card:#1a1d23;--line:#2a2f38;--accent:#7aa7ff;--bad:#ff8a80;--good:#5fd39a}
body{background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0}
main{max-width:860px;margin:0 auto;padding:16px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
nav a{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:14px}
nav a.cur{background:var(--card);color:var(--fg)}
h1{font-size:22px;margin:8px 0} h2{font-size:18px;margin:22px 0 6px;border-top:1px solid var(--line);padding-top:14px}
ul{margin:4px 0 4px 0;padding-left:20px} li{margin:2px 0} p{margin:6px 0} em{color:var(--muted)}
.narr{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 16px 10px;margin:10px 0 18px}
.narr h1{font-size:18px} .narr h2,.narr h3{font-size:16px;border:0;padding:0;margin:12px 0 2px}
.foot{color:var(--muted);font-size:13px;margin-top:24px}
"""


def page_html(report_md, narrative_md, nav, title, note=''):
    """PURE. One archived page: optional narrative card, then the data report; nav = [(label, href, current)]."""
    navh = ''.join(f'<a href="{html.escape(h)}"{" class=cur" if cur else ""}>{html.escape(lab)}</a>' for lab, h, cur in nav)
    narr = (f'<section class="narr">{md_to_html(narrative_md)}<p class="foot">{html.escape(note)}</p></section>'
            if narrative_md else '')
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>Bot status report</title><style>{PAGE_CSS}</style></head><body><main>'
            f'<nav>{navh}</nav>{narr}{md_to_html(report_md)}'
            f'<p class="foot">{html.escape(title)} -- generated by scripts/host/statusreport.py on the canary host.</p>'
            '</main></body></html>\n')


def headline_html(lines, when, mood_word):
    """PURE. The 4-row strip on the dashboard's Overview: the three headline lines and a link to the full report."""
    col = {'GOOD': 'var(--good)', 'MIXED': 'var(--accent)'}.get(mood_word, 'var(--bad)')
    rows = ''.join(f'<div>{html.escape(x)}</div>' for x in lines)
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<style>{PAGE_CSS} body{{background:transparent;font-size:14px}} .h{{padding:2px 6px}} '
            f'.h b{{color:{col}}} a{{color:var(--accent)}}</style></head><body><div class="h">'
            f'<div><b>{html.escape(mood_word)}</b> &middot; {html.escape(when)} CT &middot; '
            f'<a href="/status/" target="_top">full report</a></div>{rows}</div></body></html>\n')


# ============================================================================================ impure: collection
def sh(cmd, timeout=120, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    return r.returncode, r.stdout, r.stderr


def http_json(url, timeout=15, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def jload(path):
    with open(os.path.expanduser(path)) as fh:
        return json.load(fh)


def prom(q):
    import urllib.parse
    d = http_json(f'{PROM}/api/v1/query?' + urllib.parse.urlencode({'query': q}))
    if d.get('status') != 'success':
        raise RuntimeError(str(d)[:120])
    return d['data']['result']


def attempt(f, name, fn):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 -- every source is independent; a failure is a line, never a crash
        f['errors'][name] = f'{type(e).__name__}: {str(e)[:140]}'
        return None


def c_fleetstatus(f, now, wh):
    with tempfile.TemporaryDirectory(dir=HOME) as d:
        out = os.path.join(d, 'fs.json')
        rc, so, se = sh([sys.executable, '-B', os.path.join(HERE, 'fleetstatus.py'), '--windows', f'{wh}h,24h,7d',
                         '--json', out], timeout=300)
        if rc or not os.path.exists(out):
            raise RuntimeError(f'fleetstatus rc={rc}: {(se or so).strip()[-160:]}')
        rep = jload(out)
    W = rep['windows']
    lines = rep.get('w5_alarms') or []
    m = next((re.search(r'fleet running (\d+)/(\d+) mcbot units', x) for x in lines
              if 'fleet running' in x), None)
    slim = lambda w: {k: w.get(k) for k in ('active_bot_hours', 'deaths', 'deaths_by_cause', 'deaths_by_pool', 'bots',
                                            'actions', 'drownings')}
    f['bots'] = {'running': int(m.group(1)) if m else None, 'expected': int(m.group(2)) if m else None,
                 'win': slim(W[f'{wh}h']), 'day': slim(W['24h']), 'week': slim(W['7d'])}
    bg = rep.get('bags') or {}
    f['bags'] = {'bots': bg.get('bots_with_snapshot'), 'median': bg.get('slots_median'), 'full': bg.get('full_ge_34'),
                 'at36': bg.get('at_36'), 'by_town': bg.get('by_pool')}
    f['_elk'] = next((x for x in (rep.get('elk_disk') or {}).get('lines', []) if x.startswith(('ELK', '!! ELK'))), None)
    sc = rep.get('showcase') or {}
    f['_show_lines'] = sc.get('lines') or []
    f['_show_halt'] = next((x for x in lines if 'showcase running' in x or 'showcase halt' in x), None)
    f['_show_goal_lines'] = [x for x in lines if 'showcase/' in x and 'STUCK' in x]
    f['_show_head'] = rep.get('showcase_head')


def c_busy(f, now):
    d = jload(f'{DIGEST}/busy-fleet.json')
    t = ts(d.get('generated_at'))
    if not t or now - t > dt.timedelta(hours=3):
        raise RuntimeError(f'busy-fleet.json is stale ({d.get("generated_at")})')
    s = busy_shares(d.get('seconds') or {})
    if not s:
        raise RuntimeError('busy-fleet.json has no observed time')
    s['bot_hours'] = round(sum(v for k, v in d['seconds'].items() if k not in ('unobserved', 'dead')) / 3600)
    try:
        h = jload(f'{DIGEST}/hourwatch-fleet.json')
        if (h.get('lap') or {}).get('judged') and now - ts(h['generated_at']) <= dt.timedelta(hours=2):
            s['lap'] = h['lap']['share']
    except (OSError, ValueError, KeyError, TypeError):
        pass
    f['busy'] = s


def c_value(f, now, wh):
    hours = []
    for pth in sorted(glob.glob(f'{DIGEST}/hourwatch/value-*.json'))[-48:]:
        try:
            hours.append(jload(pth))
        except (OSError, ValueError):
            pass
    v = value_window(hours, now, wh)
    daily, items = [], []
    for pth in sorted(glob.glob(f'{DIGEST}/valuescore/20*.json'))[-8:]:
        try:
            d = jload(pth)
        except (OSError, ValueError):
            continue
        day = os.path.basename(pth)[:10]
        if d.get('value_per_bot_h') is not None:
            daily.append((day, float(d['value_per_bot_h'])))
            items.append((day, day_items(d.get('units_by_item'))))
    v['daily'] = daily
    if items:
        v['yday_day'], v['yday'] = items[-1]
        prior = [x for _, x in items[:-1]][-7:]
        if prior:
            v['median'] = {k: statistics.median(x[k] for x in prior) for k in ('logs', 'iron', 'coal')}
    if v.get('cur') is None and not daily:
        raise RuntimeError(f'the hourwatch value cache is missing {v["missing"]} hour(s) and no valuescore day file')
    if v.get('cur') is None:
        f['errors']['production (hourwatch)'] = f'the per-hour value cache covers {v["cur_h"]} of the last {wh} h'
    if daily and daily[-1][0] < (now - dt.timedelta(days=2)).strftime('%Y-%m-%d'):
        f['errors']['production (valuescore)'] = 'the newest daily value file is ' + daily[-1][0]
    f['value'] = v


def c_pinned(f, now):
    with open(f'{DIGEST}/BOTS-PINNED.txt') as fh:
        pin = parse_pinned(fh.read())
    if not pin:
        raise RuntimeError('BOTS-PINNED.txt has no header line')
    if now - ts(pin['at']) > dt.timedelta(hours=2):
        raise RuntimeError(f'stuckwatch is stale ({pin["at"]})')
    f['pinned'] = pin


def c_goals(f, now):
    g = jload(f'{DIGEST}/goalwatch-fleet.json')
    if now - ts(g['generated_at']) > dt.timedelta(minutes=50):
        raise RuntimeError(f'goalwatch-fleet.json is stale ({g["generated_at"]})')
    stuck = [x for x in (parse_stuck(v) for k, v in (g.get('alarms') or {}).items() if k.startswith('goal:')) if x]
    blocked = sorted(k.split(':', 1)[1] for k in (g.get('alarms') or {}) if k.startswith('town:'))
    f['goals'] = {'read': True, 'open': g.get('open'), 'records': g.get('records_scanned'),
                  'stuck': sorted(stuck, key=lambda x: -x['hours']), 'blocked_towns': blocked}


def c_projects(f, now):
    d = jload(f'{DIGEST}/projectaudit-fleet.json')
    if now - ts(d['generated_at']) > dt.timedelta(hours=26):
        raise RuntimeError(f'projectaudit-fleet.json is stale ({d["generated_at"]})')
    att = [{'town': r['pool'], 'plot': r['plot'], 'verdict': r['verdict'], 'why': r.get('why') or ''}
           for r in d.get('results') or [] if r.get('verdict') in ('BROKEN', 'DORMANT', 'UNDERUSED')]
    f['projects'] = {'at': d['generated_at'], 'counts': d.get('verdicts') or {}, 'total': d.get('projects'),
                     'attention': att}


def c_built(f, now, since):
    import goalwatch as GW
    recs = []
    for (pool, home, plot), (gen, path, first) in GW.newest_records('/var/lib/mcai').items():
        try:
            rec = jload(path)
            if first != path:
                rec['_first_at'] = jload(first).get('at')
            else:
                rec['_first_at'] = rec.get('at') if gen == 1 else None
        except (OSError, ValueError):
            continue
        recs.append((pool, plot, rec))
    if not recs:
        raise RuntimeError('no project records under /var/lib/mcai')
    done, started = finished_projects(recs, since, now)
    f['built'] = {'completed': done, 'started': started, 'records': len(recs)}


def c_structcount(f, now):
    gens = sorted(glob.glob(f'{HOME}/structcount/in/gen-*/structcount-day.json'))
    if not gens:
        raise RuntimeError('no structcount generation')
    cur = jload(gens[-1])
    f.setdefault('built', {})['buildings'] = {w: v.get('buildings', 0) for w, v in cur.items() if isinstance(v, dict)}
    f['built']['buildings_day'] = os.path.basename(os.path.dirname(gens[-1]))[4:12]
    if len(gens) > 1:
        prev = jload(gens[-2])
        f['built']['buildings_prev'] = {w: v.get('buildings', 0) for w, v in prev.items() if isinstance(v, dict)}


def c_flow(f, now):
    d = jload(f'{HOME}/flowledger/out/latest.json')
    if now - ts(d['ts']) > dt.timedelta(hours=2):
        raise RuntimeError(f'flowledger latest.json is stale ({d["ts"]})')
    t = d.get('window_totals') or {}
    groups = {}
    for town, gs in (d.get('chest_groups') or {}).items():
        for k, v in gs.items():
            groups[k] = groups.get(k, 0) + (v.get('observed') or 0)
    counted = sum(1 for v in (d.get('chests') or {}).values() if not v.get('uncounted'))
    sinks = (d.get('alarms') or {}).get('sinks')
    m = re.search(r'took (\d+)% of new cobble over 24 h \(([\d,]+) of ([\d,]+)', sinks or '')
    f['flow'] = {'window_h': round((d.get('window_min') or 360) / 60), 'cobble_new': t.get('cobble_supply'),
                 'cobble_well': t.get('cobble_well'), 'cobble_spent': t.get('cobble_spend'),
                 'cobble_banked': t.get('cobble_banked'),
                 'well_share': (t.get('cobble_well') or 0) / t['cobble_supply'] if t.get('cobble_supply') else None,
                 'well24': f'{m.group(1)}% of new cobble ({m.group(2)} of {m.group(3)})' if m else None,
                 'chest_items': sum(groups.values()), 'chest_groups': dict(sorted(groups.items(), key=lambda kv: -kv[1])),
                 'towns_counted': counted, 'towns': len(d.get('pools') or []),
                 'bag_cobble': sum((v.get('cobble') or 0) for v in (d.get('bags') or {}).values()),
                 'stations_crafted': t.get('crafted_stations'), 'stations_left': t.get('left_stations')}
    f.setdefault('built', {})['placed'] = {k: v.get('build_placed', 0) for k, v in (d.get('extra') or {}).items()}
    f['built']['placed_h'] = f['flow']['window_h']


def c_worlds(f, now, wh):
    up = prom('mcai_world_up')
    tps = {r['metric'].get('world'): float(r['value'][1]) for r in prom(f'min_over_time(mcai_world_tps[{wh}h])')}
    pl = sum(float(r['value'][1]) for r in prom('mcai_world_players'))
    worlds = [{'world': r['metric'].get('world'), 'up': r['value'][1] == '1'} for r in up]
    if not worlds:
        raise RuntimeError('Prometheus has no mcai_world_up series')
    disks = {}
    for r in prom('100*(1-node_filesystem_avail_bytes{mountpoint="/"}/node_filesystem_size_bytes{mountpoint="/"})'):
        disks[r['metric']['instance'].split(':')[0]] = float(r['value'][1])
    f['worlds'] = {'worlds': worlds, 'down': sorted(x['world'] for x in worlds if not x['up']),
                   'min_tps': min(tps.values()) if tps else None, 'slow': {k: v for k, v in tps.items() if v < 15},
                   'players': pl, 'disks': disks, 'disk_high': {k: v for k, v in disks.items() if v >= 85},
                   'elk': f.pop('_elk', None)}


WORLD_CHECKS = ('fleet world backup', 'showcase world backup')


def backup_facts(rows, now, fresh=dt.timedelta(hours=3)):
    """PURE. The worlds agent's backups.json (the NEWEST row per check identity) -> (lines to show, problems).
    - a check whose newest row is an ALARM is a problem, however old (nothing has recovered it);
    - a check whose newest row is older than `fresh` (they run hourly) is a problem: it stopped reporting;
    - an ALARM the agent could not tie to fleet or showcase ('world backup') is resolved only by a LATER OK of BOTH
      world checks; otherwise it is a problem too."""
    show, bad = [], []
    newest = {r['check']: r for r in rows if ts(r.get('t'))}
    for chk, r in sorted(newest.items()):
        t = ts(r['t'])
        if chk == 'world backup' and not r.get('ok'):
            oks = [ts(newest[c]['t']) for c in WORLD_CHECKS if c in newest and newest[c].get('ok')]
            if len(oks) == len(WORLD_CHECKS) and min(oks) > t:
                continue                            # history: both world checks passed after it
        show.append(r['line'])
        if not r.get('ok'):
            bad.append(r['line'])
        elif now - t > fresh:
            bad.append(f'{chk}: the check has not reported since {ct(t, day=True)} CT')
    return show, bad


def c_backups(f, now):
    d = http_json(f'{WORLDS_AGENT}/backups.json')
    rows = d if isinstance(d, list) else d.get('rows') or []
    if not rows:
        raise RuntimeError('backups.json is empty')
    f.setdefault('worlds', {})['backups'], f['worlds']['backup_bad'] = backup_facts(rows, now)


def c_showcase(f, now, since):
    from lib.estelemetry import EsEvents
    from lib import estelemetry as est
    sc = {}
    wk = EsEvents.load('showcase-skill', since=now - dt.timedelta(days=7), until=now, gaps='allow')
    proven = '_death' in wk.names()
    ev = EsEvents.load('showcase-skill', since=since, until=now, gaps='allow')
    if ev.total():
        sc['bots'] = len(ev.bots_present())
        if proven:
            sc['deaths'] = int(ev.count('_death', allow_zero=True))
            try:
                sc['bot_hours'] = ev.coverage()['bot_hours']
                wbh = wk.coverage()['bot_hours']
                sc['rate_7d'] = int(wk.count('_death', allow_zero=True)) / wbh if wbh else None
            except Exception:  # noqa: BLE001 -- no rate, no rule
                pass
            sc['death_causes'] = dict(ev.terms('skill.fail_class', '_death', allow_zero=True)) if sc['deaths'] else {}
        if '_build_visit' in wk.names():
            det = [((r.get('skill') or {}).get('detail') or '') for r in
                   ev.rows('_build_visit', fields=['skill.detail'], allow_zero=True, max_rows=50_000)]
            sc['placed'] = placed_by_project(det)
            sc['placed_total'] = sum(sc['placed'].values())
            sc['visits'] = len(det)
    else:
        sc['bots'] = 0

    def ops(kind, size=50):
        r = est.http('POST', 'mcai-showcase-ops/_search', {'size': size, 'sort': [{'@timestamp': {'order': 'desc'}}],
                     'query': {'bool': {'filter': [{'term': {'kind': kind}},
                                                   {'range': {'@timestamp': {'gte': iso(since)}}}]}}})
        return [h['_source'] for h in r['hits']['hits']]
    sc['rollouts'] = [{'t': x.get('t'), 'ok': x.get('event') == 'PASS',
                       'why': re.sub(r'^\S+: (PASS|FAIL\w*): ', '', str(x.get('why') or ''))}
                      for x in reversed(ops('showcase_rollout'))]
    sc['halts'] = [(iso(a), iso(b), w) for a, b, w in halt_episodes(ops('showcase_halt', 300))]
    lines = f.pop('_show_lines', [])
    sc['timelapse'] = timelapse_text(next((x for x in lines if 'TIMELAPSE' in x), None))
    sc['brain'] = brain_text(next((x for x in lines if 'BRAIN' in x), None))
    halt = f.pop('_show_halt', None) or ''
    m = re.search(r'showcase running (\d+)/(\d+)', halt)
    sc['units'] = [int(m.group(1)), int(m.group(2))] if m else None
    sc['stuck'] = [x for x in (parse_stuck(re.sub(r'^!!\s*', '', y)) for y in f.pop('_show_goal_lines', [])) if x]
    m = re.search(r'(\d+) of (\d+) bots \(seen in 24 h\) wrote a row in the last 30 min; absent ([^;]+);', f.pop('_show_head', None) or '')
    if m:
        sc['silent'] = [int(m.group(2)) - int(m.group(1)), int(m.group(2)), [x.strip() for x in m.group(3).split(',')]]
    f['showcase'] = sc


def c_showcase_ops(f, since):
    sc = f.setdefault('showcase', {})
    rows = http_json(f'{SHOW_PROXY}/releases.json')
    d = showcase_deploy_facts(rows, since)
    sc['rollbacks'], sc['activations'] = d['rollbacks'], d['activations']
    sc['quarantine_events'], sc['ops_notes'] = d['quarantines'], d['notes']
    trip = http_json(f'{SHOW_PROXY}/trip.json')
    if isinstance(trip, list):
        trip = trip[0] if trip else {}
    sc['trip'] = {k: trip.get(k) for k in ('t', 'verdict', 'why', 'quarantine')}
    sc['quarantined'] = sorted(trip.get('quarantined') or [])
    if trip.get('verdict') in ('HARM', 'TRIP', 'STOP', 'TRIPPED') and ts(trip.get('t')) and ts(trip['t']) >= since:
        sc.setdefault('trips', []).append(f'{trip["verdict"]}: ' + '; '.join(trip.get('why') or []))


def c_canary(f, now, since):
    import stategen as G
    rows = []
    with open(f'{HOME}/canary-journal.jsonl', errors='replace') as fh:
        for line in fh:
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    rc, out, err = sh([sys.executable, f'{HOME}/canary-sched.py', 'status'], timeout=180)
    status, decision = G.parse_status(out)
    if not status:
        raise RuntimeError(f'canary-sched.py status rc={rc}: {err.strip()[:100]}')
    titles = {}
    try:
        rc2, led, _ = sh(['git', '-C', f'{HOME}/stategen/repo', 'show', 'origin/main:config/owner-commitments.json'])
        if rc2 == 0:
            ledger = json.loads(led)
            titles = {e['run']: title_of(e['run'], ledger) for e in status}
            titles.update({r.get('run'): title_of(r.get('run'), ledger) for r in rows[-400:] if r.get('run')})
    except (ValueError, OSError, subprocess.SubprocessError):
        pass
    c = canary_facts(rows, status, since, now, titles)
    try:
        e = jload(f'{DIGEST}/effect-fleet.json')
        c['effect_worse'] = [v for k, v in (e.get('alarms') or {}).items() if 'WORSE' in str(v)]
    except (OSError, ValueError):
        c['effect_worse'] = []
    try:
        s = jload(f'{DIGEST}/stallcheck-fleet.json')
        c['stalled_items'] = sum((s.get('counts') or {}).values()) if isinstance(s.get('counts'), dict) else None
    except (OSError, ValueError, TypeError):
        pass
    f['canary'] = c


def c_alarms(f, now):
    import stategen as G
    from lib import alarm as AL
    with open(f'{DIGEST}/ALARMS.log', 'rb') as fh:
        fh.seek(0, 2)
        start = max(0, fh.tell() - 8_000_000)
        fh.seek(start)
        lines = fh.read().decode('utf-8', 'replace').splitlines()
        if start:                                   # the first line is partial only when we seeked into the file
            lines = lines[1:]
    active = G.active_alarms(lines)
    pending = []
    try:
        st = jload(f'{DIGEST}/STATE.json')
        pending = [tuple(x) for x in st.get('pending') or []]
    except (OSError, ValueError):
        f['errors']['owner decisions'] = 'STATE.json unreadable'
    a = owner_alarms(active, AL.load_acks(DIGEST), now, AL.tier_of, AL.find_ack, pending)
    f['alarms'] = a


def collect(now, since, wh, prev):
    f = {'generated_at': iso(now), 'since': iso(since), 'window_h': wh, 'errors': {}}
    attempt(f, 'fleet numbers (fleetstatus)', lambda: c_fleetstatus(f, now, wh))
    attempt(f, 'time split (busytime)', lambda: c_busy(f, now))
    attempt(f, 'production (valuescore / hourwatch)', lambda: c_value(f, now, wh))
    attempt(f, 'pinned bots (stuckwatch)', lambda: c_pinned(f, now))
    attempt(f, 'stuck projects (goalwatch)', lambda: c_goals(f, now))
    attempt(f, 'project audit', lambda: c_projects(f, now))
    attempt(f, 'project records', lambda: c_built(f, now, since))
    attempt(f, 'building count (structcount)', lambda: c_structcount(f, now))
    attempt(f, 'flow ledger', lambda: c_flow(f, now))
    attempt(f, 'world servers (Prometheus)', lambda: c_worlds(f, now, wh))
    attempt(f, 'backups', lambda: c_backups(f, now))
    attempt(f, 'showcase (Elasticsearch)', lambda: c_showcase(f, now, since))
    attempt(f, 'showcase release log', lambda: c_showcase_ops(f, since))
    attempt(f, 'testing pipeline', lambda: c_canary(f, now, since))
    attempt(f, 'alarms', lambda: c_alarms(f, now))
    for k in [k for k in f if k.startswith('_')]:
        f.pop(k)
    return f


# ============================================================================================ impure: the narrative
def key_ok(path=KEY_FILE):
    import stat
    try:
        st = os.stat(path)
    except OSError:
        return False
    return stat.S_IMODE(st.st_mode) == 0o600 and st.st_uid == os.getuid() and st.st_size > 0


def call_anthropic(report_md, timeout=LLM_TIMEOUT_S):
    """Raw HTTP to the Messages API (no SDK is installed on the lab hosts; nothing new to install). -> (text, usage)."""
    with open(KEY_FILE) as fh:
        key = fh.read().strip()
    body = {'model': MODEL, 'max_tokens': 4000, 'system': SYSTEM, 'messages': narrative_prompt(report_md),
            'output_config': {'effort': 'low'}}
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json', 'x-api-key': key,
                                          'anthropic-version': '2026-10-21'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:200]}') from None
    if d.get('stop_reason') == 'refusal':
        raise RuntimeError(f'refusal ({(d.get("stop_details") or {}).get("category")})')
    if d.get('stop_reason') == 'max_tokens':
        raise RuntimeError('hit max_tokens')
    text = '\n'.join(b.get('text', '') for b in d.get('content') or [] if b.get('type') == 'text').strip()
    return text, d.get('usage') or {}


def call_local(report_md, conf, timeout=LLM_TIMEOUT_S):
    """An Ollama /api/chat endpoint from ~/.config/mcai/statusreport.json (free; the fallback when no key)."""
    body = {'model': conf['model'], 'stream': False, 'think': False, 'options': {'num_predict': 1500},
            'messages': [{'role': 'system', 'content': SYSTEM}] + narrative_prompt(report_md)}
    d = http_json(conf['url'].rstrip('/') + '/api/chat', timeout=timeout, data=json.dumps(body).encode(),
                  headers={'content-type': 'application/json'})
    return (d.get('message') or {}).get('content', '').strip(), {}


def narrate(report_md, now, out_dir, provider='auto'):
    """-> (narrative or None, note). Never raises. Logs every attempt to out_dir/llm-usage.jsonl."""
    log = os.path.join(out_dir, 'llm-usage.jsonl')
    row = {'t': iso(now), 'provider': None, 'model': None, 'ok': False}
    try:
        rows = [json.loads(x) for x in open(log)] if os.path.exists(log) else []
    except (OSError, ValueError):
        rows = []
    try:
        conf = jload(LLM_CONF) if os.path.exists(LLM_CONF) else {}
        use = provider
        if use == 'auto':
            use = 'anthropic' if key_ok() else ('local' if conf.get('local') else 'none')
        if use == 'none':
            return None, 'no model configured (no key at ~/.config/mcai/anthropic.key, no local model): data report only'
        if use == 'anthropic':
            spent = month_spend(rows, now)
            if spent >= MONTH_CAP_USD:
                return None, f'monthly cap reached (${spent:.2f} of ${MONTH_CAP_USD:.2f}): data report only'
            row.update(provider='anthropic', model=MODEL)
            text, usage = call_anthropic(report_md)
            row.update(usage={k: usage.get(k) for k in ('input_tokens', 'output_tokens')}, usd=round(usd(usage), 6))
            who = 'Claude Haiku 5.5'
        else:
            lc = conf['local']
            row.update(provider='local', model=lc['model'])
            text, _ = call_local(report_md, lc)
            row['usd'] = 0
            who = f'local model {lc["model"]}'
        ok, why = check_narrative(text, report_md)
        row.update(ok=ok, check=why, chars=len(text or ''))
        if not ok:
            row['rejected_text'] = (text or '')[:3000]
            return None, f'the {who} note was rejected ({why}): data report only'
        return text, (f'Written by {who} from the data report below; every number in it was checked against the data '
                      f'report. Report-only output, never used as training data.')
    except Exception as e:  # noqa: BLE001 -- any failure falls back to the deterministic text
        row['error'] = f'{type(e).__name__}: {str(e)[:200]}'
        return None, f'the writing pass failed ({row["error"][:80]}): data report only'
    finally:
        try:
            with open(log, 'a') as fh:
                fh.write(json.dumps(row) + '\n')
        except OSError:
            pass


# ============================================================================================ impure: run
def push_lines(hl, narr):
    """The three lines of the push: the narrative's 'In short' when one was accepted, else the data headline."""
    if narr:
        m = re.search(r'in short[^\n]*\n((?:[ \t]*-[^\n]*\n?){1,3})', narr, re.I)
        if m:
            return [x.strip()[1:].strip() for x in m.group(1).strip().splitlines()]
    return hl


def load_index(out_dir):
    try:
        return jload(os.path.join(out_dir, 'index.json'))
    except (OSError, ValueError):
        return []


def write_atomic(path, text):
    tmp = f'{path}.tmp'
    with open(tmp, 'w') as fh:
        fh.write(text)
    os.replace(tmp, path)


def cmd_run(a):
    now = dt.datetime.now(UTC).replace(microsecond=0)
    slot = due_slot(now)
    if not slot and not a.force:
        return 0
    os.makedirs(a.out, exist_ok=True)
    idx = load_index(a.out)
    if slot and not a.force and idx and idx[0].get('slot') == slot:
        print(f'{iso(now)} statusreport: slot {slot} already written ({idx[0]["file"]})')
        return 0
    slot = slot or now.astimezone(CT).strftime('%Y-%m-%d %H:%M')
    prev_at = ts(idx[0]['at']) if idx else None
    wh = window_hours(prev_at, now)
    since = now - dt.timedelta(hours=wh)
    prev = None
    if idx:
        try:
            prev = jload(os.path.join(a.out, idx[0]['file'] + '.json'))
        except (OSError, ValueError):
            prev = None
    f = collect(now, since, wh, prev)
    j = judge(f, prev)
    md = render(f, j, now)
    stem = 'report-' + now.astimezone(CT).strftime('%Y%m%dT%H%M') + 'CT'
    narr, note = (None, 'writing pass off (--no-llm): data report only') if a.no_llm else narrate(md, now, a.out)
    write_atomic(os.path.join(a.out, stem + '.md'), md)
    if narr:
        write_atomic(os.path.join(a.out, stem + '.narrative.md'), narr + '\n')
    side = dict(f, judged=j, narrative={'note': note, 'accepted': bool(narr),
                                         'provenance': (f'paid:anthropic:{MODEL} report-only' if narr and 'Haiku' in note
                                                        else ('local report-only' if narr else None))})
    write_atomic(os.path.join(a.out, stem + '.json'), json.dumps(side, indent=1, default=str))
    hl = headline(f, j)
    idx = [{'file': stem, 'slot': slot, 'at': iso(now), 'headline': hl, 'narrative': bool(narr)}] + \
          [x for x in idx if x.get('file') != stem]
    idx = idx[:60]
    write_atomic(os.path.join(a.out, 'index.json'), json.dumps(idx, indent=1))
    # pages: every page's nav shows the newest five; rewrite the five so their nav stays current
    five = idx[:5]
    for i, e in enumerate(five):
        try:
            emd = open(os.path.join(a.out, e['file'] + '.md')).read()
        except OSError:
            continue
        np_ = os.path.join(a.out, e['file'] + '.narrative.md')
        enarr = open(np_).read() if os.path.exists(np_) else None
        enote = note if i == 0 else 'Written by a model from the data report below; numbers checked against it.'
        try:
            enote = jload(os.path.join(a.out, e['file'] + '.json'))['narrative']['note']
        except (OSError, ValueError, KeyError, TypeError):
            pass
        nav = [(('Latest: ' if k == 0 else '') + ct(ts(x['at']), day=True), f'{x["file"]}.html', k == i)
               for k, x in enumerate(five)]
        page = page_html(emd, enarr, nav, e['file'], enote)
        write_atomic(os.path.join(a.out, e['file'] + '.html'), page)
        if i == 0:
            write_atomic(os.path.join(a.out, 'latest.html'), page)
    write_atomic(os.path.join(a.out, 'headline.html'), headline_html(push_lines(hl, narr),
                                                                     ct(now, day=True), mood(j)))
    print(f'{iso(now)} statusreport: wrote {stem} ({len(md.splitlines())} lines; {len(f["errors"])} source(s) unread; '
          f'narrative: {note[:90]})')
    if not a.no_push:
        from lib import alarm as AL
        body = '\n'.join(push_lines(hl, narr)) + f'\n\nFull report: {LINK}'
        ok, detail = AL.deliver(f'Bot status {slot_name(slot)} CT: {mood(j)}', body, now, DIGEST, AL.CONF,
                                priority='default')
        print(f'push: {"DELIVERED" if ok else "NOT delivered (queued in the outbox)"} ({detail})')
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run')
    r.add_argument('--force', action='store_true', help='run outside a slot (and again inside one)')
    r.add_argument('--no-push', action='store_true')
    r.add_argument('--no-llm', action='store_true')
    r.add_argument('--out', default=OUT)
    sub.add_parser('due')
    nr = sub.add_parser('narrate')
    nr.add_argument('file')
    nr.add_argument('--provider', default='auto', choices=['auto', 'anthropic', 'local', 'none'])
    nr.add_argument('--out', default=tempfile.gettempdir())
    a = ap.parse_args(argv)
    if a.cmd == 'due':
        print(due_slot(dt.datetime.now(UTC)) or '')
        return 0
    if a.cmd == 'narrate':
        md = open(a.file).read()
        text, note = narrate(md, dt.datetime.now(UTC), a.out, a.provider)
        print(note)
        print(text or '(no narrative)')
        return 0 if text else 1
    return cmd_run(a)


if __name__ == '__main__':
    sys.exit(main())
