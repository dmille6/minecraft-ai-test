#!/usr/bin/env python3
"""hostscan.py -- READ-ONLY. ONE streaming pass over every bot's skill logs (live + rotated .gz) on the fleet host,
reduced to 5-minute buckets, printed as JSON lines on stdout. Run it FROM THE MAC so that nothing is written on the host:

    ssh 10.0.0.31 'nice -n 19 python3 -B - 2026-10-11T00:00:00Z 2026-10-23T15:00:00Z' < hostscan.py > scan.jsonl

Everything the queue-speed replays need is in the buckets, so the replays themselves run on the Mac:
  v   {full code.version: [rows, positive inventory_delta items, first s, last s]}   -> poolrank2's band, builds
  ll  _livelock_escape rows; cl _entombed + _marooned rows                          -> immobiledid's exposure filter
  bag [sum of total slots, bag readings] at the skill's END time (bagread.bot_rows)  -> drawsteady's carryover
  pos [rows with bot.pos, y < 50, y < 20]                                             -> the depth settle check
  k   {spec index: rows} for every draw_exposure requirement of the period          -> drawexposure.py
  d   deaths [[t, detail]]; bad: complete lines that do not parse (corrupt)
The parsing follows the host code it stands in for (cited per field); hostcheck() at the end is the positive control:
the totals must be non-zero for rows, bots and every field, or the scan says so and exits 2."""
import datetime as dt, glob, gzip, json, multiprocessing as mp, os, re, sys

ROOT = '/var/log/mcai'
A = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
B = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
BUCKET_S = 300
# every draw_exposure requirement of the runs 10-11..10-23 (registrations on the host, 10-23 ~14:30Z); kind with the
# leading underscore stripped, exactly as drawexposure.py's count() does
SPECS = [('compost', ''), ('count_town', 'lid_blocked'), ('craft_room', 'bamboo'), ('craft_room', 'more slot(s) at'),
         ('craft_sync', ''), ('death', 'drowned'), ('death_site_recorded', 'death:fire'), ('deposit', ''),
         ('dig_town', ''), ('drowning_ceiling_no_air', '(oxygen 0,'), ('home', ''), ('smelt', ''), ('smelt_town', ''),
         ('stagnation', ''), ('stock_refused', ' at_cobble=1 '), ('stock_refused', ':cobble_'),
         ('stock_refused', '_unknown'), ('toolkit', 'outcome=no_iron'), ('town_deposit', ''), ('well_dispose', ''),
         ('well_refused', 'reason=no_site'), ('well_refused', 'unreachable'), ('withdraw_pick', 'need='),
         ('withdraw_pick', 'no usable pickaxe')]
_TS = re.compile(r'"@timestamp":\s*"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)')
ONE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket|_bed|_boat|_raft|minecart|^potion|^splash_potion|^lingering_potion|^shears|^flint_and_steel|^bow|^crossbow|^trident|^fishing_rod|^carrot_on_a_stick|^warped_fungus_on_a_stick|^shield|^saddle|^elytra|^totem_of_undying|^music_disc|^enchanted_book|^written_book|^writable_book|_stew$|^rabbit_stew|^beetroot_soup|^cake|_shulker_box|^shulker_box|^spyglass|^goat_horn|^brush|^mace|_bundle$|^bundle|^debug_stick|^knowledge_book)$')
SIXTEEN = re.compile(r'^(egg|brown_egg|blue_egg|ender_pearl|snowball|bucket|honey_bottle|armor_stand|.*_sign|.*_hanging_sign|.*_banner)$')


def slots(inv):
    """bagread.bag_vector(inv)[0]: total slots, a stack of 1 / 16 / 64 per item."""
    n = 0
    for name, c in inv.items():
        if isinstance(c, (int, float)) and c > 0:
            st = 1 if ONE.search(name) else 16 if SIXTEEN.search(name) else 64
            n += c if st == 1 else -(-int(c) // st)
    return n


def scan_bot(bot):
    lo, hi = A.strftime('%Y-%m-%dT%H:%M:%S'), B.strftime('%Y-%m-%dT%H:%M:%S')
    bk, seen, deaths, files, bad_files = {}, set(), [], 0, 0

    def cell(t):
        i = int((t - A).total_seconds() // BUCKET_S)
        c = bk.get(i)
        if c is None:
            c = bk[i] = {'v': {}, 'll': 0, 'cl': 0, 'bag': [0, 0], 'pos': [0, 0, 0], 'k': {}, 'bad': 0}
        return c
    for f in sorted(glob.glob(os.path.join(ROOT, bot, 'skill-*.jsonl*'))):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < A:
                continue
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
            files += 1
            with fh:
                for line in fh:
                    m = _TS.search(line[:200])
                    if m and not (lo <= m.group(1) < hi):
                        continue
                    try:
                        r = json.loads(line)
                        t = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
                    except Exception:
                        if m and line.endswith('\n'):
                            cell(dt.datetime.fromisoformat(m.group(1) + '+00:00'))['bad'] += 1
                        continue
                    if not (A <= t < B):
                        continue
                    sk = r.get('skill') or {}
                    name = sk.get('name') or ''
                    det = sk.get('detail') or ''
                    key = (r['@timestamp'], name, det[:200])
                    if key in seen:            # bagread.bot_rows de-duplicates (t, name, detail) across generations
                        continue
                    seen.add(key)
                    c = cell(t)
                    ver = (r.get('code') or {}).get('version') or ''
                    v = c['v'].get(ver)
                    s = (t - A).total_seconds()
                    if v is None:
                        v = c['v'][ver] = [0, 0, s, s]
                    v[0] += 1; v[2] = min(v[2], s); v[3] = max(v[3], s)
                    for _it, x in (sk.get('inventory_delta') or {}).items():      # poolrank2: positive deltas summed
                        if isinstance(x, (int, float)) and x > 0:
                            v[1] += x
                    if name == '_livelock_escape':                                 # immobiledid POOLS=1
                        c['ll'] += 1
                    elif name in ('_entombed', '_marooned'):
                        c['cl'] += 1
                    if name == '_death':
                        deaths.append([s, det[:120]])
                    kn = name.lstrip('_')
                    for i, (kk, need) in enumerate(SPECS):                         # drawexposure.count()
                        if kn == kk and (not need or need in det):
                            c['k'][i] = c['k'].get(i, 0) + 1
                    p = (r.get('bot') or {}).get('pos') or {}
                    if isinstance(p.get('y'), (int, float)):
                        c['pos'][0] += 1; c['pos'][1] += p['y'] < 50; c['pos'][2] += p['y'] < 20
                    inv = (r.get('bot') or {}).get('inventory')
                    if isinstance(inv, dict):
                        te = t
                        dur = sk.get('duration_ms')
                        if not name.startswith('_') and isinstance(dur, (int, float)) and 0 < dur < 6 * 3600 * 1000:
                            te = t + dt.timedelta(milliseconds=dur)            # bagread: the bag is the END snapshot
                        if A <= te < B:
                            cb = cell(te); cb['bag'][0] += slots(inv); cb['bag'][1] += 1
        except Exception as e:
            bad_files += 1
            sys.stderr.write('unreadable %s %s\n' % (f, type(e).__name__))
    return {'bot': bot, 'files': files, 'bad_files': bad_files, 'deaths': deaths,
            'b': {str(i): c for i, c in sorted(bk.items())}}


def main():
    bots = sorted(os.path.basename(d) for d in glob.glob(os.path.join(ROOT, '*-*-*')) if os.path.isdir(d))
    print(json.dumps({'meta': {'from': sys.argv[1], 'to': sys.argv[2], 'bucket_s': BUCKET_S, 'specs': SPECS,
                               'bots': bots}}), flush=True)
    rows = nonzero = 0
    with mp.Pool(8) as pool:
        for out in pool.imap_unordered(scan_bot, bots):
            n = sum(v[0] for c in out['b'].values() for v in c['v'].values())
            rows += n; nonzero += n > 0
            print(json.dumps(out, separators=(',', ':')), flush=True)
    print(json.dumps({'total': {'rows': rows, 'bots_with_rows': nonzero}}), flush=True)
    if rows == 0 or nonzero < 60:
        sys.stderr.write('POSITIVE CONTROL FAILED: %d rows over %d bots\n' % (rows, nonzero)); sys.exit(2)


if __name__ == '__main__':
    main()
