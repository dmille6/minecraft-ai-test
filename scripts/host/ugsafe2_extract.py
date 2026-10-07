#!/usr/bin/env python3
"""ugsafe2_extract.py <since-iso> <until-iso> <outdir>  -- underground safety phase 2 (2026-10-07) row extract.

PER BOT, rotation-aware, deduplicated, SORTED BY t. Each bot's skill rows live only in its own files
(/var/log/mcai/<bot>/skill-<bot>.jsonl + the rotated skill-<bot>.jsonl-<D+1>.gz), so the walk is done one bot at a
time and memory stays ~one bot's rows. File choice is telemetry.py's own predicate (skip a file whose mtime predates
the window: a rotated file cannot hold rows newer than its mtime), which is what Events.load and scoreboard.load_window
rely on. Dedup key (t, bot, kind, detail) as scoreboard.load_window.

Writes <outdir>/<bot>.pkl = {'rows': [tuple...], 'llm': [(t, milestone, skill, outcome_status)], 'files': [...]}.
Row tuple fields (F_* indices below). Inventory is summarised per row (the snapshot is the END of a skill); the full
inventory+tools JSON is kept only on `_death` rows. The decision stream (llm-<bot>.jsonl) is read with regexes for
@timestamp / milestone / first tool call / outcome status (its lines carry multi-KB prompts).
"""
import sys, os, re, json, glob, pickle, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))
sys.path.insert(0, os.path.join(HERE, 'lib'))
from telemetry import open_log

(F_T, F_BOT, F_KIND, F_STATUS, F_DETAIL, F_X, F_Y, F_Z, F_HP, F_FOOD, F_VER, F_POOL, F_DUR, F_HELD, F_ARGS,
 F_PICK, F_IRONPICK, F_BLOCKS, F_BUCKET, F_WBUCKET, F_NITEMS, F_DELTA, F_FULLINV, F_TRIGGER, F_RUN) = range(25)

# reflex.mjs PLACEABLE (c6e91a8)
PLACEABLE = re.compile(r'^(dirt|cobblestone|stone|sand|gravel|andesite|diorite|granite|deepslate|cobbled_deepslate|sandstone|red_sandstone|dripstone_block|tuff|netherrack|coarse_dirt|rooted_dirt)$|(_log|_planks|_wood|_hyphae)$|^(crimson_stem|warped_stem|stripped_crimson_stem|stripped_warped_stem)$')
TS = re.compile(r'"@timestamp":\s*"([^"]+)"')
MS = re.compile(r'"milestone":\s*"([^"]*)"')
TC = re.compile(r'"tool_calls":\s*\[\{"skill":\s*"([^"]*)"')
OC = re.compile(r'"outcome":\s*\{"status":\s*"([^"]*)"')


def parse_t(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def files_for(pattern, since):
    out = []
    for f in sorted(glob.glob(pattern)):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < since:
                continue
        except OSError:
            continue
        out.append(f)
    return out


def summarise(bot):
    inv = bot.get('inventory') if isinstance(bot.get('inventory'), dict) else {}
    tools = bot.get('tools') if isinstance(bot.get('tools'), dict) else {}
    pick, ironpick = -1, 0
    for k, v in tools.items():
        if k.endswith('_pickaxe') and isinstance(v, list):
            for e in v:
                try:
                    left = e.get('max', 0) - e.get('used', 0)
                except AttributeError:
                    continue
                pick = max(pick, left)
                if k in ('iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe') and left > 0:
                    ironpick += 1
    blocks = sum(c for k, c in inv.items() if isinstance(c, (int, float)) and PLACEABLE.search(k))
    return (pick, ironpick, blocks, inv.get('bucket', 0) or 0, inv.get('water_bucket', 0) or 0,
            sum(c for c in inv.values() if isinstance(c, (int, float))))


def extract_bot(d, since, until):
    s0, u0 = since.timestamp(), until.timestamp()
    name = os.path.basename(d)
    files = files_for(os.path.join(d, 'skill-*.jsonl*'), since)
    seen, rows = set(), []
    for f in files:
        with open_log(f) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                sk = r.get('skill') or {}
                kind = sk.get('name')
                if not kind:
                    continue
                try:
                    t = parse_t(r.get('@timestamp', ''))
                except Exception:
                    continue
                if t < s0 or t >= u0:
                    continue
                det = (sk.get('detail') or '')
                key = (t, kind, det)
                if key in seen:
                    continue
                seen.add(key)
                bot = r.get('bot') or {}
                pos = bot.get('pos') or {}
                code = r.get('code') or {}
                exp = r.get('exp') or {}
                args = sk.get('args')
                a = json.dumps(args, separators=(',', ':'))[:160] if args else ''
                delta = sk.get('inventory_delta')
                dl = json.dumps(delta, separators=(',', ':'))[:400] if delta else ''
                full = json.dumps({'inventory': bot.get('inventory'), 'tools': bot.get('tools')}) if kind == '_death' else None
                rows.append((t, bot.get('name') or name, kind, sk.get('status'), det[:400], pos.get('x'), pos.get('y'),
                             pos.get('z'), bot.get('health'), bot.get('hunger'),
                             str(code.get('version') or '').split('+')[0], exp.get('pool'), sk.get('duration_ms'),
                             bot.get('held'), a) + summarise(bot) + (dl, full, r.get('trigger'), r.get('run_id')))
    rows.sort(key=lambda x: x[0])
    llm, lseen = [], set()
    lfiles = files_for(os.path.join(d, 'llm-*.jsonl*'), since)
    for f in lfiles:
        with open_log(f) as fh:
            for line in fh:
                m = TS.search(line[:200])
                if not m:
                    continue
                try:
                    t = parse_t(m.group(1))
                except Exception:
                    continue
                if t < s0 or t >= u0 or t in lseen:
                    continue
                lseen.add(t)
                ms, tc, oc = MS.search(line), TC.search(line), OC.search(line)
                llm.append((t, ms.group(1) if ms else None, tc.group(1) if tc else None, oc.group(1) if oc else None))
    llm.sort()
    return {'rows': rows, 'llm': llm, 'files': files + lfiles}


if __name__ == '__main__':
    since = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
    until = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
    out = sys.argv[3]
    os.makedirs(out, exist_ok=True)
    tot = 0
    for d in sorted(glob.glob('/var/log/mcai/*/')):
        d = d.rstrip('/')
        if not glob.glob(os.path.join(d, 'skill-*.jsonl*')):
            continue
        res = extract_bot(d, since, until)
        if not res['rows']:
            continue
        tot += len(res['rows'])
        with open(os.path.join(out, os.path.basename(d) + '.pkl'), 'wb') as fh:
            pickle.dump(res, fh, protocol=4)
        print(os.path.basename(d), len(res['rows']), len(res['llm']), flush=True)
    print('TOTAL rows', tot)
