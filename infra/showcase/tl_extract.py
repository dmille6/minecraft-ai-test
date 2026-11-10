#!/usr/bin/env python3
"""timelapse2-1110: hourly per-day extracts for the .30 timelapse videos (showcase-tl-extract.timer, :07 every hour).
Writes /srv/showcase/timelapse/data/<YYYYMMDD>/ for today and yesterday (read by .30 with the read-only tl key; copied to
the NAS data/ by nas-sync.sh):
  build.tsv  t, bot, project, op, x, y, z, block      (`_build` place/clear rows)
  pos.tsv    t, bot, x, z                             (every bot.pos sample, consecutive duplicates dropped)
  cp.tsv     epoch, user, action(0 break/1 place), x, y, z, material   (CoreProtect, overworld; from a COPY of the DB)
  chat.jsonl the showchat lines of the day
  sites.json project boxes (tl_showcase.project_sites) + cameras.json (tl.conf cameras)
Read-only on the logs, the pool and CoreProtect. nice 19 / ionice idle via the unit."""
import datetime as dt, glob, gzip, json, os, re, shutil, sqlite3, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl_showcase as T         # noqa: E402

LOGS = '/var/log/mcai/showcase-*/skill-showcase-*.jsonl*'
CP_DB = '/srv/showcase/server/plugins/CoreProtect/database.db'
CHAT = '/var/lib/mcai/_pool-showcase/showchat-lines.jsonl'
RX_P, RX_O = re.compile(r'project=(\S+)'), re.compile(r'op=(\S+)')
RX_C, RX_B = re.compile(r'cell=(-?\d+),(-?\d+),(-?\d+)'), re.compile(r'block=(\S+)')


def day_files(day):
    """The live log files plus the rotated file(s) that can hold `day` (named for the rotation date = day + 1)."""
    nxt = (day + dt.timedelta(days=1)).strftime('%Y%m%d')
    return [f for f in sorted(glob.glob(LOGS)) if 'FIXTURE' not in f and (f.endswith('.jsonl') or nxt in f or day.strftime('%Y%m%d') in f)]


def extract_logs(day):
    pfx = day.isoformat()
    build, pos = [], []
    for f in day_files(day):
        op = gzip.open if f.endswith('.gz') else open
        with op(f, 'rt', errors='replace') as fh:
            for line in fh:
                i = line.find('"@timestamp":"')
                if i < 0 or line[i + 14:i + 24] != pfx:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                t, b = r['@timestamp'][:23], ((r.get('bot') or {}).get('name') or '').replace('showcase-', '')
                p = (r.get('bot') or {}).get('pos')
                if p:
                    pos.append((b, t, round(p.get('x', 0), 1), round(p.get('z', 0), 1)))
                sk = r.get('skill') or {}
                if sk.get('name') == '_build':
                    d = sk.get('detail') or ''
                    o, c = RX_O.search(d), RX_C.search(d)
                    if o and c and o.group(1) in ('place', 'clear'):
                        pr, bl = RX_P.search(d), RX_B.search(d)
                        build.append((t[:19], b, pr.group(1) if pr else '-', o.group(1), *c.groups(), bl.group(1) if bl else '-'))
    pos.sort()
    out_pos, last = [], {}
    for b, t, x, z in pos:
        if last.get(b) != (x, z):
            last[b] = (x, z)
            out_pos.append((t, b, x, z))
    return sorted(build), sorted(out_pos)


def extract_cp(db, day):
    lo = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp())
    c = sqlite3.connect(db)
    users = dict(c.execute('select rowid, user from co_user'))
    mats = dict(c.execute('select id, material from co_material_map'))
    wid = [i for i, w in c.execute('select id, world from co_world') if w == 'world']
    rows = c.execute('select time,user,action,x,y,z,type from co_block where action in (0,1) and time>=? and time<? '
                     'and wid=? order by time', (lo, lo + 86400, wid[0] if wid else 1)).fetchall()
    c.close()
    return [(t, users.get(u, u), a, x, y, z, str(mats.get(ty, ty)).replace('minecraft:', '')) for t, u, a, x, y, z, ty in rows]


def write(path, rows):
    with open(path + '.part', 'w') as f:
        for r in rows:
            f.write('\t'.join(str(v) for v in r) + '\n')
    os.replace(path + '.part', path)


def main():
    cfg = T.load_conf()
    now = T.now_utc()
    root = os.path.join(cfg['root'], 'data')
    tmpdb = os.path.join(cfg['root'], 'logs', 'cp-copy.db')
    shutil.copyfile(CP_DB, tmpdb)
    try:
        for day in ((now - dt.timedelta(days=1)).date(), now.date()):
            d = os.path.join(root, day.strftime('%Y%m%d'))
            if day < now.date() and os.path.exists(os.path.join(d, 'FINAL')):
                continue
            os.makedirs(d, exist_ok=True)
            build, pos = extract_logs(day)
            write(os.path.join(d, 'build.tsv'), build)
            write(os.path.join(d, 'pos.tsv'), pos)
            write(os.path.join(d, 'cp.tsv'), extract_cp(tmpdb, day))
            with open(os.path.join(d, 'chat.jsonl'), 'w') as f:
                for line in open(CHAT):
                    if line.startswith('{"t":"' + day.isoformat()):
                        f.write(line)
            json.dump(T.project_sites(cfg), open(os.path.join(d, 'sites.json'), 'w'))
            json.dump(cfg.get('cameras') or {}, open(os.path.join(d, 'cameras.json'), 'w'))
            if day < now.date() and now.hour >= 1:          # yesterday is complete after the 23:59 rotation settles
                open(os.path.join(d, 'FINAL'), 'w').write(T._iso(now))
            print(json.dumps({'day': day.isoformat(), 'build': len(build), 'pos': len(pos)}))
    finally:
        os.remove(tmpdb)
    return 0


if __name__ == '__main__':
    sys.exit(main())
