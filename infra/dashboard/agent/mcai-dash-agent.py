#!/usr/bin/env python3
"""mcai-dash-agent -- the read-only status agent behind the Grafana dashboard (infra/dashboard).

One copy per host, selected by --role. It reads files the fleet already writes, never writes
anything outside its own process, and serves the result on :9188:

    /metrics          Prometheus text (Prometheus on 10.0.0.186 scrapes it every 30 s)
    /<name>.json      tables for Grafana's Infinity datasource (bots, canaries, queue, alarms, ...)
    /health           collector status: which collectors ran, when, and the last error of each

Roles
    fleet     10.0.0.31  mcbot@* units, newest row per bot (bags/health/role), trial manifest,
                         canary journal + queue, ALARMS.log, goalwatch, goalboard, digest lines;
                         /status/ serves the owner's status reports (~/digest/statusreport, read-only)
    worlds    10.0.0.30  every block2 Paper world: up, TPS, MSPT, players (RCON, read-only commands), RSS;
                         the newest result of each backup check (backup-alarm.log)
    showcase  10.0.0.40  mcshow@* units, showcase bots, PIECES.jsonl, deploy.jsonl, trip-last.json, ALARMS.log,
                         goalwatch, the showcase Paper world, and the timelapse videos (index + files,
                         served with Range so the gallery can seek)

Why an agent and not host-to-host ssh: the lab hosts deliberately do not trust each other's keys,
and a pull over HTTP keeps it that way. Every collector is independent: one failing shows up in
/health and in mcai_agent_collector_ok, and never blanks the others (a blank panel reads as
"zero", which is the failure this repo keeps repeating -- see CLAUDE.md).
"""
import argparse
import glob
import json
import math
import os
import re
import socket
import struct
import subprocess
import threading
import time
import traceback
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser('~')
NOW = lambda: time.time()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if ts else None


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def tail_lines(path, max_bytes=262144):
    """The complete lines in the last max_bytes of a file (the first, partial line is dropped)."""
    with open(path, 'rb') as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - max_bytes))
        data = f.read()
    lines = data.decode('utf-8', 'replace').splitlines()
    return lines[1:] if size > max_bytes else lines


def read_jsonl(path, max_bytes=None):
    lines = tail_lines(path, max_bytes) if max_bytes else open(path, encoding='utf-8', errors='replace').read().splitlines()
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            pass
    return out


BACKUP_LINE = re.compile(r'^(\S+Z) (.+?) (OK|ALARM)\b(.*)$')


def _rename(newest, cur, label):
    """Re-file an ALARM row under the check its own lines identify (it was filed as the generic 'world backup')."""
    if newest.get(cur['check']) is cur:
        del newest[cur['check']]
    cur['check'] = label
    cur['line'] = label + cur['line'][len('world backup'):]
    newest[label] = cur


def backup_checks(lines):
    """PURE. backup-alarm.log lines -> the newest result per check. 'world backups' is split by what the line says it
    holds: the fleet's nightly set (16 archives) vs the showcase's (1). An ALARM header line carries its '!!' lines."""
    newest, cur = {}, None
    for ln in lines:
        mm = BACKUP_LINE.match(ln)
        if mm:
            label, ok, rest = mm.group(2).strip().lower(), mm.group(3) == 'OK', mm.group(4)
            if label.startswith('world backup'):
                h = re.search(r'holds (\d+) archives', rest)
                label = ('world backup' if not h else 'showcase world backup' if h.group(1) == '1' else 'fleet world backup')
            elif label.startswith('backup'):
                label = 'log store (ES) backup'
            cur = {'check': label, 't': mm.group(1), 'ok': ok, 'line': f'{label} {"OK" if ok else "ALARM"}{rest}'.strip()}
            newest[label] = cur
        elif cur and not cur['ok'] and ln.strip().startswith('!!'):
            cur['line'] += ' ' + ln.strip()
            ex = re.search(r'expected (\d+)$', ln.strip())
            if cur['check'] == 'world backup' and ex:
                _rename(newest, cur, 'showcase world backup' if ex.group(1) == '1' else 'fleet world backup')
        elif cur and not cur['ok'] and ln.strip().startswith('context:') and cur['check'] == 'world backup':
            h = re.search(r'holds (\d+) archives', ln)
            if h:
                _rename(newest, cur, 'showcase world backup' if h.group(1) == '1' else 'fleet world backup')
    return sorted(newest.values(), key=lambda r: r['check'])


def run(cmd, timeout=60):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout


# --------------------------------------------------------------------------------------- metrics
class Metrics:
    def __init__(self):
        self.rows = {}   # name -> (help, type, [(labels, value)])

    def add(self, name, value, labels=None, help='', mtype='gauge'):
        if value is None:
            return
        h, t, rows = self.rows.setdefault(name, (help, mtype, []))
        rows.append((labels or {}, float(value)))

    def render(self):
        out = []
        for name, (h, t, rows) in sorted(self.rows.items()):
            if h:
                out.append(f'# HELP {name} {h}')
            out.append(f'# TYPE {name} {t}')
            for labels, v in rows:
                lab = ','.join('%s="%s"' % (k, str(val).replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' '))
                               for k, val in sorted(labels.items()))
                out.append(f'{name}{{{lab}}} {v}' if lab else f'{name} {v}')
        return '\n'.join(out) + '\n'


# --------------------------------------------------------------------------------------- systemd
def units(pattern):
    """[{unit, bot, active, sub}] for every unit matching pattern, loaded or not."""
    out = []
    for ln in run(['systemctl', 'list-units', '--type=service', '--all', '--no-legend', '--plain', pattern]).splitlines():
        p = ln.split()
        if len(p) < 4:
            continue
        unit, load, active, sub = p[:4]
        bot = unit.split('@', 1)[1].rsplit('.service', 1)[0] if '@' in unit else unit
        out.append({'unit': unit, 'bot': bot, 'load': load, 'active': active, 'sub': sub})
    return out


# --------------------------------------------------------------------------------------- bots
STACK1 = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_bed|_boat|_raft|'
                    r'_minecart|^minecart$|potion|_bucket$|^bow$|^crossbow$|^trident$|^shield$|^elytra$|^saddle$|'
                    r'^shears$|^flint_and_steel$|^fishing_rod$|shulker_box$|^totem_of_undying$|^written_book$|'
                    r'^writable_book$|_horse_armor$|^spyglass$|^brush$|^mace$|^carrot_on_a_stick$|_on_a_stick$)')
STACK16 = re.compile(r'(^egg$|_egg$|^snowball$|^ender_pearl$|^bucket$|_sign$|_banner$|^honey_bottle$|^armor_stand$)')
INV_SLOTS = 36   # main inventory + hotbar; armour and off-hand are not counted


def stack_size(item):
    if item.endswith('_spawn_egg'):
        return 64
    if STACK1.search(item):
        return 1
    if STACK16.search(item):
        return 16
    return 64


def slots_used(inv):
    """Estimated bag slots: one stack per ceil(count / stack size). An estimate -- the row carries
    counts, not slots -- but it matches how the bag censuses in STATE.md have counted (>= 34 = full)."""
    if not isinstance(inv, dict):
        return None
    return sum(math.ceil(n / stack_size(k)) for k, n in inv.items() if isinstance(n, (int, float)) and n > 0)


def bot_rows(log_root, prefix=None):
    """The newest parsable row of each bot's live skill log. Tail-read: this is a current-state
    snapshot, not a rate, so it does not need (and must not be used as) a full walk."""
    rows = []
    for d in sorted(glob.glob(os.path.join(log_root, '*/'))):
        name = os.path.basename(d.rstrip('/'))
        if name.startswith('_') or (prefix and not name.startswith(prefix)) or name.endswith('FIXTURE'):
            continue
        live = os.path.join(d, f'skill-{name}.jsonl')
        if not os.path.exists(live):
            continue
        newest = None
        deaths = 0
        ok = fail = 0
        rs = read_jsonl(live, 262144)
        for r in rs:
            sk = r.get('skill') or {}
            if sk.get('name') == '_death':
                deaths += 1
            elif not str(sk.get('name', '')).startswith('_'):
                if sk.get('status') == 'success':
                    ok += 1
                elif sk.get('status'):
                    fail += 1
        # The newest row says what the bot is doing; the newest row that carries a body (some reflex
        # and scan rows log a bot with no health/inventory) says what it holds. Mixing them up read
        # a sparse scan row as an empty bag.
        state = None
        for r in reversed(rs):
            if not (isinstance(r.get('bot'), dict) and r.get('@timestamp')):
                continue
            newest = newest or r
            if r['bot'].get('health') is not None and isinstance(r['bot'].get('inventory'), dict):
                state = r
                break
        if not newest:
            continue
        b = (state or newest)['bot']
        exp = newest.get('exp') or {}
        pos = b.get('pos') or {}
        inv = b.get('inventory') or {}
        ts = parse_ts(newest['@timestamp'])
        rows.append({
            'bot': name,
            'pool': exp.get('pool') or name.rsplit('-', 1)[0],
            'role': b.get('role'),
            'health': b.get('health'),
            'hunger': b.get('hunger'),
            'held': b.get('held'),
            'x': pos.get('x'), 'y': pos.get('y'), 'z': pos.get('z'),
            'bag_slots': slots_used(inv),
            'bag_items': int(sum(v for v in inv.values() if isinstance(v, (int, float)))) if isinstance(inv, dict) else None,
            'top_items': ', '.join(f'{k} {v}' for k, v in sorted(inv.items(), key=lambda kv: -kv[1])[:4]) if isinstance(inv, dict) else '',
            'last_skill': (newest.get('skill') or {}).get('name'),
            'last_status': (newest.get('skill') or {}).get('status'),
            'version': ((newest.get('code') or {}).get('version') or '')[:8],
            'run_id': newest.get('run_id'),
            'last_seen': newest['@timestamp'],
            'age_s': round(NOW() - ts) if ts else None,
            'tail_rows': len(rs), 'tail_ok': ok, 'tail_fail': fail, 'tail_deaths': deaths,
        })
    return rows


def age(r):
    """Seconds since the bot's newest row; a missing age is "forever". Not `age_s or 1e9`: a row logged
    this second has age 0, and that read 8 of 80 live bots as silent (11-04)."""
    return r['age_s'] if r['age_s'] is not None else 1e9


def bot_metrics(m, rows, scope):
    for r in rows:
        lab = {'bot': r['bot'], 'pool': r['pool'], 'scope': scope}
        m.add('mcai_bot_bag_slots', r['bag_slots'], lab, 'estimated inventory slots in use (of 36)')
        m.add('mcai_bot_health', r['health'], lab, 'bot health (0-20) in its newest row')
        m.add('mcai_bot_hunger', r['hunger'], lab, 'bot hunger (0-20) in its newest row')
        m.add('mcai_bot_row_age_seconds', r['age_s'], lab, 'seconds since the bot last logged a row')
        m.add('mcai_bot_y', r['y'], lab, 'bot y level')
    full = [r for r in rows if (r['bag_slots'] or 0) >= 34]
    m.add('mcai_bots_reporting', len([r for r in rows if age(r) < 600]), {'scope': scope},
          'bots with a log row in the last 10 minutes')
    m.add('mcai_bots_bag_full', len(full), {'scope': scope}, 'bots at >= 34 of 36 estimated slots')
    versions = {}
    for r in rows:
        if age(r) < 3600:
            versions[r['version']] = versions.get(r['version'], 0) + 1
    for v, n in versions.items():
        m.add('mcai_build_bots', n, {'scope': scope, 'version': v}, 'bots whose newest row carries this build')
    m.add('mcai_builds_live', len(versions), {'scope': scope}, 'distinct builds among bots seen in the last hour')


# --------------------------------------------------------------------------------------- alarms
ALARM_RE = re.compile(r'^(\S+)\s+(NEW|STILL|CLEARED|EVENT)\s+(\S+)\s+(.*?)\s+::\s+(.*)$')
ALARM_LIVE_S = 7 * 3600   # alarm.py re-pushes STILL every 6 h: a NEW/STILL older than that has no living source


def alarms(path, scope):
    last = {}
    events = []
    for ln in tail_lines(path, 2_000_000):
        mt = ALARM_RE.match(ln)
        if not mt:
            continue
        ts, ev, src, key, text = mt.groups()
        row = {'ts': ts, 'event': ev, 'source': src, 'key': key, 'text': text, 'scope': scope}
        events.append(row)
        if ev != 'EVENT':
            last[(src, key)] = row
    now = NOW()
    active = []
    for (src, key), r in last.items():
        t = parse_ts(r['ts']) or 0
        if r['event'] in ('NEW', 'STILL') and now - t < ALARM_LIVE_S:
            # The NEW that opened THIS episode: a key can clear and come back, and its first-ever NEW is not it.
            first = r['ts']
            for e in reversed(events):
                if e['source'] == src and e['key'] == key:
                    if e['event'] == 'CLEARED':
                        break
                    if e['event'] == 'NEW':
                        first = e['ts']
            active.append(dict(r, since=first, severity=severity(src, r['text'])))
    active.sort(key=lambda r: (r['severity'] != 'critical', r['since']))
    return active, list(reversed(events[-200:]))


def severity(src, text):
    t = text.lower()
    if src.startswith(('haltwatch', 'death', 'slotwatch')) or 'halt' in t or 'rolled back' in t:
        return 'critical'
    if src.startswith(('goalwatch', 'flowledger', 'stallcheck', 'driftwatch')):
        return 'warning'
    return 'info'


def alarm_metrics(m, active, scope):
    by = {}
    for a in active:
        by[(a['source'], a['severity'])] = by.get((a['source'], a['severity']), 0) + 1
    for (src, sev), n in by.items():
        m.add('mcai_alarms_active', n, {'scope': scope, 'source': src, 'severity': sev},
              'alarms from ALARMS.log whose newest event is NEW/STILL within 7 h')
    m.add('mcai_alarms_active_total', len(active), {'scope': scope}, 'all active ALARMS.log alarms')


# --------------------------------------------------------------------------------------- goals
def goals(path, scope):
    d = json.load(open(path))
    now = NOW()
    out = []
    for g in d.get('goals') or []:
        key = g.get('key', '')
        m = re.match(r'goal:(?P<pool>[^/]+)/(?P<proj>[^@]+)@(?P<at>.*)$', key)
        lp = parse_ts(g.get('last_progress'))
        lv = g.get('last_visit') or {}
        out.append({
            'scope': scope,
            'town': m.group('pool') if m else '',
            'project': m.group('proj') if m else key,
            'site': (m.group('at') if m else '').replace('_', ','),
            'state': 'STUCK' if g.get('stuck') else (g.get('state') or '').upper(),
            'last_progress': g.get('last_progress'),
            'hours_since_progress': round((now - lp) / 3600, 1) if lp else None,
            'visits_4h': g.get('visits_in_window'),
            'last_visitor': lv.get('bot'),
            'last_outcome': lv.get('outcome'),
            'why': (lv.get('why') or '').replace('_', ' ')[:160],
            'created_at': g.get('created_at'),
        })
    out.sort(key=lambda r: (r['state'] != 'STUCK', -(r['hours_since_progress'] or 0)))
    return out, d


# --------------------------------------------------------------------------------------- RCON
def rcon_cmds(port, password, cmds, host='127.0.0.1', timeout=3.0):
    """Minimal Source-RCON client. Read-only commands only (tps, mspt, list)."""
    def pkt(i, t, body):
        b = body.encode() + b'\x00\x00'
        return struct.pack('<iii', len(b) + 8, i, t) + b

    def recv(s):
        hdr = b''
        while len(hdr) < 4:
            c = s.recv(4 - len(hdr))
            if not c:
                raise ConnectionError('rcon closed')
            hdr += c
        n = struct.unpack('<i', hdr)[0]
        body = b''
        while len(body) < n:
            c = s.recv(n - len(body))
            if not c:
                raise ConnectionError('rcon closed')
            body += c
        i, t = struct.unpack('<ii', body[:8])
        return i, body[8:-2].decode('utf-8', 'replace')

    out = {}
    with socket.create_connection((host, port), timeout=timeout) as s:
        s.sendall(pkt(1, 3, password))
        i, _ = recv(s)
        if i == -1:
            raise PermissionError('rcon auth refused')
        for n, c in enumerate(cmds, start=2):
            s.sendall(pkt(n, 2, c))
            _, body = recv(s)
            out[c] = re.sub(r'\u00a7.', '', body)
    return out


def props(path):
    p = {}
    for ln in open(path, encoding='utf-8', errors='replace'):
        if '=' in ln and not ln.startswith('#'):
            k, v = ln.rstrip('\n').split('=', 1)
            p[k.strip()] = v.strip()
    return p


def world_status(name, props_path, active, kind):
    row = {'world': name, 'kind': kind, 'up': 0, 'tps_1m': None, 'tps_5m': None, 'mspt': None, 'players': None, 'error': None}
    if not active:
        row['error'] = 'unit not active'
        return row
    try:
        p = props(props_path)
        if p.get('enable-rcon') != 'true':
            row['error'] = 'rcon disabled'
            return row
        r = rcon_cmds(int(p.get('rcon.port', 25575)), p.get('rcon.password', ''), ['tps', 'mspt', 'list'])
        row['up'] = 1
        nums = [float(x) for x in re.findall(r'\*?(\d+(?:\.\d+)?)', r['tps'].split(':', 1)[-1])]
        if len(nums) >= 2:
            row['tps_1m'], row['tps_5m'] = min(nums[0], 20.0), min(nums[1], 20.0)
        mm = re.search(r'(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)', r.get('mspt', ''))
        if mm:
            row['mspt'] = float(mm.group(1))
        pl = re.search(r'There are (\d+)', r.get('list', ''))
        if pl:
            row['players'] = int(pl.group(1))
    except Exception as e:   # noqa: BLE001 -- a world that will not answer is a row, not a crash
        row['error'] = f'{type(e).__name__}: {e}'[:200]
    return row


def java_rss_by_cwd():
    out = {}
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            if b'java' not in open(f'/proc/{pid}/cmdline', 'rb').read():
                continue
            cwd = os.readlink(f'/proc/{pid}/cwd')
            for ln in open(f'/proc/{pid}/status'):
                if ln.startswith('VmRSS:'):
                    out[cwd] = int(ln.split()[1]) * 1024
        except OSError:
            pass
    return out


def world_metrics(m, rows, rss):
    for r in rows:
        lab = {'world': r['world'], 'kind': r['kind']}
        m.add('mcai_world_up', r['up'], lab, '1 when the world answered RCON this cycle')
        m.add('mcai_world_tps', r['tps_1m'], lab, 'Paper TPS, last 1 minute (capped at 20)')
        m.add('mcai_world_tps_5m', r['tps_5m'], lab, 'Paper TPS, last 5 minutes')
        m.add('mcai_world_mspt', r['mspt'], lab, 'Paper mean milliseconds per tick, last 5 s')
        m.add('mcai_world_players', r['players'], lab, 'players online (bots count as players)')
        if r.get('dir') in rss:
            r['rss_gb'] = round(rss[r['dir']] / 2**30, 2)
            m.add('mcai_world_rss_bytes', rss[r['dir']], lab, 'resident memory of the world JVM')


# --------------------------------------------------------------------------------------- canaries
OUTCOME_PHASES = {'recorded', 'poll-revert', 'operator-close', 'keep-unpromoted', 'rollout-rolled-back'}


def canary_runs(journal):
    """One row per run, oldest phase first. Outcome = the 'recorded' decision when there is one."""
    runs = {}
    for r in read_jsonl(journal):
        run_ = r.get('run')
        if not run_:
            continue
        x = runs.setdefault(run_, {'run': run_, 'first': r.get('ts'), 'phases': [], 'outcome': None,
                                   'deployed': None, 'decided': None, 'promoted': None, 'torn_down': None,
                                   'pools': None, 'note': ''})
        ph = r.get('phase', '')
        note = (r.get('note') or '').strip()
        x['phases'].append(ph)
        x['last'] = r.get('ts')
        x['last_phase'] = ph
        if ph == 'drawn' and not x['pools']:
            x['pools'] = note.split(' ', 1)[0]
        if ph == 'deployed' and not x['deployed']:
            x['deployed'] = r.get('ts')
        if ph == 'owner-direct' and not x['deployed']:
            x['deployed'] = r.get('ts')
        if ph == 'recorded':
            x['outcome'] = note.split()[0].upper() if note else x['outcome']
            x['decided'] = r.get('ts')
        elif ph == 'poll-revert' and not x['outcome']:
            x['outcome'] = 'REVERT'
            x['decided'] = r.get('ts')
            x['note'] = note[:220]
        elif ph == 'rollout-rolled-back':
            x['outcome'] = 'ROLLED BACK'
            x['decided'] = r.get('ts')
        elif ph == 'keep-unpromoted' and not x['outcome']:
            x['outcome'] = 'KEEP'
        elif ph == 'operator-close' and not x['outcome']:
            x['outcome'] = 'CLOSED'
            x['decided'] = r.get('ts')
            x['note'] = note[:220]
        elif ph == 'promoted':
            x['promoted'] = r.get('ts')
        elif ph == 'torn-down':
            x['torn_down'] = r.get('ts')
        elif ph.startswith('read-') and 'VERDICT' in note:
            x['note'] = note[:220]
    out = []
    for x in runs.values():
        if not x['deployed'] and not x['outcome']:
            continue   # drawn but never deployed: not a test
        status = x['outcome'] or ('IN TEST' if not x['torn_down'] else 'ENDED')
        if x['promoted'] and status in ('KEEP', 'IN TEST'):
            status = 'PROMOTED'
        d0, d1 = parse_ts(x['deployed']), parse_ts(x['decided'] or x['torn_down'] or x['last'])
        out.append({'run': x['run'], 'status': status, 'pools': x['pools'], 'deployed': x['deployed'],
                    'decided': x['decided'], 'promoted': x['promoted'],
                    'hours': round((d1 - d0) / 3600, 1) if d0 and d1 else None,
                    'last_phase': x['last_phase'], 'last': x['last'], 'note': x['note']})
    out.sort(key=lambda r: r['deployed'] or r['last'] or '', reverse=True)
    return out


QUEUE_RE = re.compile(r'^(\S+)\s+(\w+)\s+(\S+)\s+hold=(.*?)\s+not_before=(\S+)\s+after=(.*?)\s+variants=(\S*)')


def queue_status(sched):
    out = run(['python3', sched, 'status'], timeout=120)
    rows, decision = [], ''
    for ln in out.splitlines():
        if ln.startswith('DECISION:'):
            decision = ln[len('DECISION:'):].strip()
            continue
        mt = QUEUE_RE.match(ln)
        if mt:
            name, state, cls, hold, nb, after, variants = mt.groups()
            rows.append({'run': name, 'state': state, 'class': '' if cls == '-' else cls,
                         'hold': '' if hold in ('None', '') else hold[:200],
                         'not_before': None if nb == 'None' else nb,
                         'after': after.strip("[]'").replace("'", '') if after not in ('None', '[]') else '',
                         'variants': len([v for v in variants.split(',') if v])})
    return rows, decision


def last_line(path, match=None):
    try:
        for ln in reversed(tail_lines(path, 65536)):
            if ln.strip() and (match is None or match in ln):
                return ln.strip()
    except OSError:
        return None
    return None


# --------------------------------------------------------------------------------------- goalboard
def goalboard(out_dir):
    files = sorted(f for f in glob.glob(os.path.join(out_dir, 'goalboard-20*.json')))
    if not files:
        return []
    d = json.load(open(files[-1]))
    rows = []
    for section in ('build', 'survive', 'together', 'health'):
        for k, v in (d.get(section) or {}).items():
            if isinstance(v, dict) and 'value' in v and not isinstance(v['value'], (dict, list)):
                den = v.get('denominator') or {}
                rows.append({'day': d.get('day'), 'section': section, 'metric': k.replace('_', ' '),
                             'value': v.get('value'), 'unit': v.get('unit'), 'rate': v.get('rate'),
                             'out_of': f"{den.get('value')} {den.get('what')}" if den else '',
                             'status': v.get('status')})
    return rows


# --------------------------------------------------------------------------------------- videos
# The showcase timelapse renders (infra/timelapse, tl.py) land in /srv/showcase/timelapse/video:
#   daily/<YYYY-MM-DD>-<view>.mp4   weekly/week-ending-<YYYY-MM-DD>-<view>.mp4   monthly/<YYYY-MM>-<view>.mp4
#   history-<view>.mp4 (the whole series so far)   <adhoc dir>/<YYYY-MM-DD>-<view>.mp4
# each with a <file>.json sidecar. The gallery on 10.0.0.186:8088 reads this index through nginx.
VIDEO_KEEP = {'daily': 7, 'weekly': 4, 'monthly': 6, 'adhoc': 3}


def _label_day(d, fmt='%b %-d, %Y'):
    try:
        return datetime.strptime(d, '%Y-%m-%d').strftime(fmt)
    except ValueError:
        return d


def video_index(root):
    groups = {}
    for p in glob.glob(os.path.join(root, '**', '*.mp4'), recursive=True):
        rel = os.path.relpath(p, root)
        parts = rel.split(os.sep)
        f = parts[-1]
        if len(parts) == 1:
            m = re.match(r'history-(.+)\.mp4$', f)
            key, kind, label, view = 'history', 'history', 'Full history', m.group(1) if m else f[:-4]
        elif parts[0] == 'daily':
            m = re.match(r'(\d{4}-\d{2}-\d{2})-(.+)\.mp4$', f)
            if not m:
                continue
            key, kind, label, view = 'day-' + m.group(1), 'daily', 'Day · ' + _label_day(m.group(1)), m.group(2)
        elif parts[0] == 'weekly':
            m = re.match(r'week-ending-(\d{4}-\d{2}-\d{2})-(.+)\.mp4$', f)
            if not m:
                continue
            key, kind, label, view = 'week-' + m.group(1), 'weekly', 'Week ending ' + _label_day(m.group(1)), m.group(2)
        elif parts[0] == 'monthly':
            m = re.match(r'(\d{4}-\d{2})-(.+)\.mp4$', f)
            if not m:
                continue
            key, kind, view = 'month-' + m.group(1), 'monthly', m.group(2)
            label = 'Month · ' + datetime.strptime(m.group(1), '%Y-%m').strftime('%B %Y')
        else:
            m = re.match(r'(\d{4}-\d{2}-\d{2})-(.+)\.mp4$', f)
            key, kind, view = 'adhoc-' + parts[0], 'adhoc', m.group(2) if m else f[:-4]
            d = re.match(r'([a-z]+)-(\d{2})(\d{2})([a-z]*)$', parts[0])     # early-1104b -> Early cut · Nov 4 (b)
            label = ('%s cut · %s%s' % (d.group(1).capitalize(), _label_day(f'{datetime.now().year}-{d.group(2)}-{d.group(3)}', '%b %-d'),
                                        f' ({d.group(4)})' if d.group(4) else '')) if d else 'Extra cut · ' + parts[0]
        side = {}
        try:
            side = json.load(open(p + '.json'))
        except (OSError, ValueError):
            pass
        st = os.stat(p)
        g = groups.setdefault(key, {'name': key, 'kind': kind, 'label': label, 'videos': []})
        g['videos'].append({'path': rel, 'title': view, 'bytes': st.st_size, 'mtime': int(st.st_mtime),
                            'duration_s': side.get('duration_s'), 'first': side.get('first'), 'last': side.get('last')})
    sets = []
    for kind, keep in VIDEO_KEEP.items():
        sets += sorted((g for g in groups.values() if g['kind'] == kind), key=lambda g: g['name'], reverse=True)[:keep]
    sets += [g for g in groups.values() if g['kind'] == 'history']
    for g in sets:
        g['newest'] = max(v['mtime'] for v in g['videos'])
        g['videos'].sort(key=lambda v: (v['title'] != 'reel', v['title']))
        if g['kind'] == 'history':
            firsts = [v['first'] for v in g['videos'] if v.get('first')]
            lasts = [v['last'] for v in g['videos'] if v.get('last')]
            if firsts and lasts:   # sidecar stamps look like 20261025T1800Z
                stamp = lambda x: datetime.strptime(x[:8], '%Y%m%d').strftime('%b %-d')
                g['label'] = 'Full history · %s to %s' % (stamp(min(firsts)), stamp(max(lasts)))
    # Newest first, but a full-history set never leads: it is long and re-rendered rarely.
    sets.sort(key=lambda g: (g['kind'] != 'history', g['newest']), reverse=True)
    return {'generated_at': iso(time.time()), 'sets': sets}


THUMBS_PER_CYCLE = 40   # ffmpeg runs per slow cycle at most: ~0.3 s each, so a fresh install catches up in minutes


def thumb_for(root, cache, v):
    """Cached 480-px JPEG of second 2 of the video (path keyed by mtime, so a re-render gets a new one)."""
    return os.path.join(cache, '%s.%d.jpg' % (v['path'].replace(os.sep, '__'), v['mtime']))


def make_thumbs(root, cache, idx):
    os.makedirs(cache, exist_ok=True)
    made = 0
    for s in idx['sets']:
        for v in s['videos']:
            t = thumb_for(root, cache, v)
            if not os.path.exists(t) and made < THUMBS_PER_CYCLE:
                made += 1
                at = '2' if (v.get('duration_s') or 10) > 4 else '0'
                subprocess.run(['nice', '-n', '19', 'ffmpeg', '-v', 'error', '-y', '-ss', at, '-i', os.path.join(root, v['path']),
                                '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', t], timeout=60, capture_output=True)
            if os.path.exists(t):
                v['thumb'] = os.path.basename(t)
    return made


STATUS_TYPES = {'.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
                '.json': 'application/json'}


def serve_status(handler, root, rel):
    """The status reports (~/digest/statusreport): a plain file under root with an allowed extension, nothing else."""
    root = os.path.realpath(root)
    p = os.path.realpath(os.path.join(root, rel))
    ext = os.path.splitext(p)[1]
    if not p.startswith(root + os.sep) or ext not in STATUS_TYPES or not os.path.isfile(p) or \
            os.path.basename(p) == 'llm-usage.jsonl':
        return False
    with open(p, 'rb') as fh:
        body = fh.read()
    handler.send_response(200)
    handler.send_header('Content-Type', STATUS_TYPES[ext])
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    if handler.command != 'HEAD':
        handler.wfile.write(body)
    return True


def serve_file(handler, root, rel):
    """Stream a file under root, honouring a single Range (browsers seek video with Range)."""
    root = os.path.realpath(root)
    p = os.path.realpath(os.path.join(root, rel))
    if not p.startswith(root + os.sep) or not p.endswith(('.mp4', '.png', '.jpg')) or not os.path.isfile(p):
        return False
    size = os.path.getsize(p)
    start, end, code = 0, size - 1, 200
    m = re.match(r'bytes=(\d*)-(\d*)$', handler.headers.get('Range') or '')
    if m and (m.group(1) or m.group(2)):
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
        else:
            start = max(0, size - int(m.group(2)))
        if start > end:
            handler.send_response(416)
            handler.send_header('Content-Range', f'bytes */{size}')
            handler.end_headers()
            return True
        code = 206
    handler.send_response(code)
    handler.send_header('Content-Type', 'video/mp4' if p.endswith('.mp4') else 'image/' + p.rsplit('.', 1)[1].replace('jpg', 'jpeg'))
    handler.send_header('Accept-Ranges', 'bytes')
    handler.send_header('Content-Length', str(end - start + 1))
    handler.send_header('Cache-Control', 'public, max-age=3600')
    if code == 206:
        handler.send_header('Content-Range', f'bytes {start}-{end}/{size}')
    handler.end_headers()
    if handler.command == 'HEAD':
        return True
    try:
        with open(p, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(262144, left))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                left -= len(chunk)
    except (BrokenPipeError, ConnectionResetError):
        pass   # the browser seeked elsewhere and dropped this range
    return True


# --------------------------------------------------------------------------------------- the agent
class Agent:
    def __init__(self, role, opts):
        self.role, self.o = role, opts
        self.lock = threading.Lock()
        self.data = {}             # name -> JSON-able
        self.metrics_text = ''
        self.health = {}           # collector -> {ok, at, ms, error}
        self.slow_at = 0

    def _run(self, name, fn, m):
        t0 = time.time()
        try:
            fn(m)
            self.health[name] = {'ok': True, 'at': iso(t0), 'ms': round((time.time() - t0) * 1000), 'error': None}
        except Exception as e:  # noqa: BLE001
            self.health[name] = {'ok': False, 'at': iso(t0), 'ms': round((time.time() - t0) * 1000),
                                 'error': f'{type(e).__name__}: {e}', 'trace': traceback.format_exc()[-800:]}
        m.add('mcai_agent_collector_ok', 1 if self.health[name]['ok'] else 0, {'collector': name, 'role': self.role},
              '1 when the collector succeeded on its last run')

    def cycle(self):
        m = Metrics()
        slow = time.time() - self.slow_at >= self.o.slow_every
        jobs = {'fleet': self.fleet_jobs, 'worlds': self.world_jobs, 'showcase': self.showcase_jobs}[self.role](slow)
        for name, fn in jobs:
            self._run(name, fn, m)
        if slow:
            self.slow_at = time.time()
        # carry the last good slow-collector metrics forward between slow cycles
        for name, rows in getattr(self, 'slow_metrics', {}).items():
            if name not in m.rows:
                m.rows[name] = rows
        m.add('mcai_agent_last_cycle_timestamp_seconds', time.time(), {'role': self.role}, 'unix time of the last cycle')
        with self.lock:
            self.metrics_text = m.render()

    def keep_slow(self, m, names):
        self.slow_metrics = getattr(self, 'slow_metrics', {})
        for n in names:
            if n in m.rows:
                self.slow_metrics[n] = m.rows[n]

    def put(self, name, value):
        with self.lock:
            self.data[name] = value

    # ---- fleet (10.0.0.31)
    def fleet_jobs(self, slow):
        o = self.o
        jobs = [('units', lambda m: self._units(m, 'mcbot@*', 'fleet')),
                ('bots', lambda m: self._bots(m, o.log_root, None, 'fleet')),
                ('manifest', self._manifest),
                ('alarms', lambda m: self._alarms(m, os.path.join(o.digest, 'ALARMS.log'), 'fleet')),
                ('goals', lambda m: self._goals(m, os.path.join(o.digest, 'goalwatch-fleet.json'), 'fleet')),
                ('digest', self._digest)]
        if slow:
            jobs += [('journal', self._journal), ('queue', self._queue), ('goalboard', self._goalboard)]
        return jobs

    def _units(self, m, pattern, scope):
        us = units(pattern)
        running = [u for u in us if u['sub'] == 'running']
        failed = [u for u in us if u['active'] == 'failed']
        m.add('mcai_bot_units_running', len(running), {'scope': scope}, 'bot systemd units in state running')
        m.add('mcai_bot_units_failed', len(failed), {'scope': scope}, 'bot systemd units in state failed')
        if scope == 'fleet':   # the showcase's size changes with each release; only the fleet has a fixed 80
            m.add('mcai_bot_units_expected', self.o.expected_bots, {'scope': scope}, 'bots the fleet should be running')
        self.put(f'units-{scope}', us)

    def _bots(self, m, root, prefix, scope):
        rows = bot_rows(root, prefix)
        bot_metrics(m, rows, scope)
        pools = {}
        for r in rows:
            p = pools.setdefault(r['pool'], {'pool': r['pool'], 'bots': 0, 'reporting': 0, 'bag_full': 0,
                                             'bag_slots_sum': 0, 'health_sum': 0, 'tail_deaths': 0})
            p['bots'] += 1
            p['reporting'] += 1 if age(r) < 600 else 0
            p['bag_full'] += 1 if (r['bag_slots'] or 0) >= 34 else 0
            p['bag_slots_sum'] += r['bag_slots'] or 0
            p['health_sum'] += r['health'] or 0
            p['tail_deaths'] += r['tail_deaths']
        for p in pools.values():
            p['avg_bag_slots'] = round(p.pop('bag_slots_sum') / p['bots'], 1)
            p['avg_health'] = round(p.pop('health_sum') / p['bots'], 1)
        self.put(f'bots-{scope}', rows)
        self.put(f'pools-{scope}', sorted(pools.values(), key=lambda p: p['pool']))
        hist = {}
        for r in rows:
            b = r['bag_slots'] or 0
            k = '0-19' if b < 20 else '20-29' if b < 30 else '30-33' if b < 34 else '34-36 (full)'
            hist[k] = hist.get(k, 0) + 1
        self.put(f'bagbands-{scope}', [{'band': k, 'bots': hist.get(k, 0)} for k in ('0-19', '20-29', '30-33', '34-36 (full)')])

    def _manifest(self, m):
        d = json.load(open(self.o.manifest))
        canary = d.get('canary_pool')
        dec = parse_ts(d.get('declared_at'))
        self.put('manifest', [{
            'fleet_build': (d.get('declared_code_version') or '')[:8],
            'canary_run': d.get('run_id') if canary else None,
            'canary_build': (d.get('canary_code_version') or '')[:8] if canary else None,
            'canary_pools': canary,
            'declared_at': d.get('declared_at'),
            'notes': (d.get('notes') or '')[:400],
        }])
        m.add('mcai_canary_active', 1 if canary else 0, {}, '1 while a canary pool is declared in the trial manifest')
        if canary and dec:
            m.add('mcai_canary_age_seconds', time.time() - dec, {'run': d.get('run_id', '')}, 'seconds since the canary was declared')

    def _alarms(self, m, path, scope):
        active, events = alarms(path, scope)
        alarm_metrics(m, active, scope)
        self.put(f'alarms-{scope}', active)
        self.put(f'alarm-events-{scope}', events)

    def _goals(self, m, path, scope):
        rows, d = goals(path, scope)
        self.put(f'goals-{scope}', rows)
        m.add('mcai_goals_open', len(rows), {'scope': scope}, 'open town projects (goalwatch)')
        m.add('mcai_goals_stuck', len([r for r in rows if r['state'] == 'STUCK']), {'scope': scope},
              'open town projects with no progress for >= 3 h (goalwatch)')
        gen = parse_ts(d.get('generated_at'))
        if gen:
            m.add('mcai_source_age_seconds', time.time() - gen, {'source': f'goalwatch-{scope}'}, 'age of an upstream state file')

    def _digest(self, m):
        dg = self.o.digest
        lines = [
            ('halt watch', last_line(os.path.join(dg, 'w5-halt.log'), 'mcbot units')),
            ('canary slot', last_line(os.path.join(dg, 'w5-halt.log'), 'canary slot')),
            ('project goals', last_line(os.path.join(dg, 'w5-goal.log'), 'fleet goals:')),
            ('canary watch', last_line(os.path.join(dg, 'canarywatch.log'))),
            ('stalled work', last_line(os.path.join(dg, 'stallcheck.log'))),
            ('scheduler', last_line(os.path.join(dg, 'sched.log'))),
            ('iron funnel', last_line(os.path.join(dg, 'ironfunnel.log'))),
        ]
        self.put('digest', [{'watch': k, 'line': (v or '(no line)')[:400]} for k, v in lines])
        st = last_line(os.path.join(dg, 'stallcheck.log')) or ''
        mt = re.search(r'STALLED: (\d+) items', st)
        m.add('mcai_stalled_items', int(mt.group(1)) if mt else 0, {}, 'approved work items with no progress (stallcheck)')

    def _journal(self, m):
        rows = canary_runs(self.o.journal)
        self.put('canaries', rows[:200])
        now = time.time()
        for window, secs in (('7d', 7 * 86400), ('30d', 30 * 86400)):
            counts = {}
            for r in rows:
                t = parse_ts(r['decided'] or r['last'])
                if t and now - t < secs and r['status'] != 'IN TEST':
                    counts[r['status']] = counts.get(r['status'], 0) + 1
            for k, n in counts.items():
                m.add('mcai_canary_outcomes', n, {'window': window, 'outcome': k}, 'canary outcomes decided in the window')
        self.keep_slow(m, ['mcai_canary_outcomes'])

    def _queue(self, m):
        rows, decision = queue_status(self.o.sched)
        live = [r for r in rows if r['state'] not in ('done', 'cancelled')]
        self.put('queue', live)
        self.put('queue-all', rows)
        self.put('scheduler', [{'decision': decision}])
        for st in {r['state'] for r in rows}:
            m.add('mcai_queue_entries', len([r for r in rows if r['state'] == st]), {'state': st}, 'canary queue entries by state')
        self.keep_slow(m, ['mcai_queue_entries'])

    def _goalboard(self, m):
        self.put('goalboard', goalboard(self.o.goalboard))

    # ---- worlds (10.0.0.30)
    def world_jobs(self, slow):
        jobs = [('worlds', self._worlds)]
        if slow:
            jobs.append(('backups', self._backups))
        return jobs

    def _backups(self, m):
        """The newest result of each backup check in backup-alarm.log (check-backup.py, check-world-backup.py fleet and
        showcase): [{check, t, ok, line}] -- the status report's 'backups' line (scripts/host/statusreport.py)."""
        rows = backup_checks(tail_lines(self.o.backup_log, 262144))
        self.put('backups', rows)
        for r in rows:
            m.add('mcai_backup_ok', 1 if r['ok'] else 0, {'check': r['check']}, 'newest backup check result (1 = OK)')

    def _worlds(self, m):
        us = {u['unit']: u for u in units('block2*')}
        rss = java_rss_by_cwd()
        rows = []
        for pp in sorted(glob.glob(os.path.join(self.o.world_root, '*', 'server.properties'))):
            d = os.path.dirname(pp)
            name = os.path.basename(d)
            unit = f'block2-{name}.service' if name.startswith('sandbox') else f'block2@{name}.service'
            if unit not in us:
                continue
            kind = 'sandbox' if name.startswith('sandbox') else 'fleet'
            r = world_status(name, pp, us[unit]['sub'] == 'running', kind)
            r['dir'] = d
            rows.append(r)
        world_metrics(m, rows, rss)
        for r in rows:
            r.pop('dir', None)
        self.put('worlds', rows)

    # ---- showcase (10.0.0.40)
    def showcase_jobs(self, slow):
        o = self.o
        jobs = [('units', lambda m: self._units(m, 'mcshow@*', 'showcase')),
                ('bots', lambda m: self._bots(m, o.log_root, 'showcase-', 'showcase')),
                ('alarms', lambda m: self._alarms(m, os.path.join(o.digest, 'ALARMS.log'), 'showcase')),
                ('goals', lambda m: self._goals(m, os.path.join(o.digest, 'goalwatch-showcase.json'), 'showcase')),
                ('world', self._showcase_world)]
        if slow:
            jobs += [('pieces', self._pieces), ('videos', self._videos), ('trip', self._trip)]
        return jobs

    def _videos(self, m):
        idx = video_index(self.o.video_root)
        made = make_thumbs(self.o.video_root, self.o.thumb_cache, idx)
        self.put('videos', idx)
        m.add('mcai_video_thumbs_made', made, {}, 'thumbnails rendered this cycle (capped)')
        n = sum(len(s['videos']) for s in idx['sets'])
        m.add('mcai_videos_indexed', n, {}, 'timelapse videos offered to the gallery')
        newest = max((s['newest'] for s in idx['sets'] if s['kind'] != 'history'), default=None)
        if newest:
            m.add('mcai_video_newest_age_seconds', time.time() - newest, {}, 'age of the newest daily/weekly render')
        self.keep_slow(m, ['mcai_videos_indexed', 'mcai_video_newest_age_seconds'])

    def _showcase_world(self, m):
        rss = java_rss_by_cwd()
        active = any(u['sub'] == 'running' for u in units('showcase-paper*'))
        r = world_status('showcase', self.o.showcase_props, active, 'showcase')
        r['dir'] = os.path.dirname(self.o.showcase_props)
        world_metrics(m, [r], rss)
        r.pop('dir', None)
        self.put('worlds', [r])

    def _trip(self, m):
        """trip-last.json: the showcase tripwire's newest verdict (statusreport reads it through the dashboard host)."""
        try:
            d = json.load(open(self.o.trip_last))
        except (OSError, ValueError):
            d = {}
        self.put('trip', {'t': d.get('t'), 'verdict': d.get('verdict'), 'why': (d.get('why') or [])[:8],
                          'quarantine': d.get('quarantine') or [],
                          'quarantined': sorted((d.get('facts') or {}).get('quarantined') or [])})

    def _pieces(self, m):
        pieces = []
        for p in [p for p in read_jsonl(self.o.pieces) if p.get('run')][-60:]:
            t = p.get('tests') or {}
            pieces.append({'piece': p.get('run'), 'kind': p.get('kind'), 'sha': (p.get('sha') or '')[:8],
                           'tests': t.get('result'), 'summary': (t.get('summary') or '')[:200]})
        self.put('pieces', list(reversed(pieces)))
        deploys = []
        for e in read_jsonl(self.o.deploy_log, 1_000_000)[-80:]:
            deploys.append({'t': e.get('t'), 'event': e.get('event'), 'release': (e.get('release') or '')[:26],
                            'bots': e.get('running_bots'), 'why': (e.get('why') or e.get('note') or '')[:240]})
        self.put('releases', list(reversed(deploys)))


# --------------------------------------------------------------------------------------- HTTP
def make_handler(agent):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype):
            b = body.encode()
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = urllib.parse.unquote(self.path.split('?', 1)[0]).strip('/')
            if path.startswith('videos/thumbs/') and agent.role == 'showcase':
                if not serve_file(self, agent.o.thumb_cache, path[len('videos/thumbs/'):]):
                    self._send(404, '{"error": "no such thumbnail"}', 'application/json')
                return
            if path.startswith('videos/files/') and agent.role == 'showcase':
                # Outside the lock: a video can stream for minutes.
                if not serve_file(self, agent.o.video_root, path[len('videos/files/'):]):
                    self._send(404, '{"error": "no such video"}', 'application/json')
                return
            if (path == 'status' or path.startswith('status/')) and agent.role == 'fleet':
                rel = path[len('status/'):] if path.startswith('status/') else ''
                if not serve_status(self, agent.o.status_dir, rel or 'latest.html'):
                    self._send(404, '<p>No status report yet (scripts/host/statusreport.py writes them 4 times a day).</p>',
                               'text/html; charset=utf-8')
                return
            if path == 'videos/index.json':
                path = 'videos.json'
            with agent.lock:
                if path == 'metrics':
                    return self._send(200, agent.metrics_text, 'text/plain; version=0.0.4')
                if path in ('', 'health'):
                    return self._send(200, json.dumps({'role': agent.role, 'collectors': agent.health,
                                                       'datasets': sorted(agent.data)}, indent=1), 'application/json')
                if path.endswith('.json') and path[:-5] in agent.data:
                    return self._send(200, json.dumps(agent.data[path[:-5]], default=str), 'application/json')
            self._send(404, json.dumps({'error': 'not found', 'datasets': sorted(agent.data)}), 'application/json')
    return H


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--role', required=True, choices=['fleet', 'worlds', 'showcase'])
    ap.add_argument('--port', type=int, default=9188)
    ap.add_argument('--bind', default='0.0.0.0')
    ap.add_argument('--every', type=int, default=60, help='seconds between fast cycles')
    ap.add_argument('--slow-every', type=int, default=300, help='seconds between slow collectors (journal, queue)')
    ap.add_argument('--log-root', default='/var/log/mcai')
    ap.add_argument('--digest', default=os.path.join(HOME, 'digest'))
    ap.add_argument('--manifest', default='/srv/mcbots/trial-manifest.json')
    ap.add_argument('--journal', default=os.path.join(HOME, 'canary-journal.jsonl'))
    ap.add_argument('--sched', default=os.path.join(HOME, 'canary-sched.py'))
    ap.add_argument('--goalboard', default=os.path.join(HOME, 'goalboard', 'out'))
    ap.add_argument('--expected-bots', type=int, default=80)
    ap.add_argument('--world-root', default='/srv/block2')
    ap.add_argument('--showcase-props', default='/srv/showcase/server/server.properties')
    ap.add_argument('--pieces', default='/srv/showcase/PIECES.jsonl')
    ap.add_argument('--deploy-log', default='/srv/showcase/ops/deploy.jsonl')
    ap.add_argument('--video-root', default='/srv/showcase/timelapse/video')
    ap.add_argument('--status-dir', default=os.path.join(HOME, 'digest', 'statusreport'))
    ap.add_argument('--backup-log', default='/var/log/mcai-monitor/backup-alarm.log')
    ap.add_argument('--trip-last', default='/srv/showcase/ops/trip-last.json')
    ap.add_argument('--thumb-cache', default=os.path.join(HOME, '.cache', 'mcai-dash-thumbs'))
    ap.add_argument('--once', action='store_true', help='run one cycle, print /health and exit')
    o = ap.parse_args()
    agent = Agent(o.role, o)
    if o.once:
        agent.cycle()
        print(json.dumps({'collectors': agent.health, 'datasets': {k: (len(v) if isinstance(v, list) else 1)
                                                                    for k, v in agent.data.items()}}, indent=1))
        return
    srv = ThreadingHTTPServer((o.bind, o.port), make_handler(agent))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    while True:
        t0 = time.time()
        agent.cycle()
        time.sleep(max(5, o.every - (time.time() - t0)))


if __name__ == '__main__':
    main()
