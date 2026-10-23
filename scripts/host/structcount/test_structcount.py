#!/usr/bin/env python3
"""Behaviour tests for structcount.py (the structure count) and scread.py (its reader), plus MUTANTS.

    python3 -B scripts/host/structcount/test_structcount.py              (everything; exit 1 on any failure)
    python3 -B scripts/host/structcount/test_structcount.py --daily-gate (the fixture world + blind-input mutants: what
                                                                         `structcount.py daily` runs before every publication)

THE FIXTURE WORLD. A real Anvil region file is WRITTEN by this file (an NBT and region writer below) into a temp dir, with a
hand-worked answer: the operator's town stamp (207 cells), one lit house (1 building), a buried cobble slab (a buried
structure), a dungeon (masked by its spawner), a village house piece at the surface (masked by its structure BB), and around
the box ~850 fully generated, never-ticked chunks each holding a small surface village piece (masked). The instrument must
read it back exactly, and `validate()` must find nothing to refuse.

BLIND-INPUT MUTANTS (the class the cooperation host tools failed on: controls that pass when the instrument sees nothing).
Each mutant blinds one part of the reader -- no chunk readable, no section decoded, an empty palette, no stamp model, no
negative-control chunks, no structure masks -- and the fixture's `validate()` must then REFUSE (a non-empty problem list).
A mutant that leaves validation empty SURVIVED: the controls would have published zeros from a blind instrument.

BEHAVIOUR MUTANTS: each breaks one decision (a lit rule, a roof rule, a plinth rule, a validation check, the reader) and must
fail the case written against it.

Every anchor must occur EXACTLY ONCE in the source with comments removed (tokenize), so an anchor never matches the comment
that explains it (CLAUDE.md), and a mutant that does not apply is a FAILURE, never a kill.
"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import tokenize
import types
import zlib

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = {'sc': os.path.join(HERE, 'structcount.py'), 'rd': os.path.join(HERE, 'scread.py'), 'sv': os.path.join(HERE, 'serve.py'),
       'pl': os.path.join(HERE, 'pull.py')}


def load(name, text=None):
    path = SRC[name]
    mod = types.ModuleType('mut_' + name)
    mod.__file__ = path
    exec(compile(text if text is not None else open(path).read(), path, 'exec'), mod.__dict__)
    return mod


# ------------------------------------------------------------------ an NBT + Anvil writer (just enough for fixtures)
def _str(s):
    b = s.encode()
    return struct.pack('>H', len(b)) + b


def _payload(tag, v):
    if tag == 1: return struct.pack('>b', v)
    if tag == 3: return struct.pack('>i', v)
    if tag == 4: return struct.pack('>q', v)
    if tag == 8: return _str(v)
    if tag == 9:
        et, items = v
        return struct.pack('>bi', et, len(items)) + b''.join(_payload(et, i) for i in items)
    if tag == 10:
        return b''.join(struct.pack('>b', t) + _str(k) + _payload(t, x) for k, (t, x) in v.items()) + b'\x00'
    if tag == 11: return struct.pack('>i', len(v)) + b''.join(struct.pack('>i', i) for i in v)
    if tag == 12: return struct.pack('>i', len(v)) + b''.join(struct.pack('>q', i) for i in v)
    raise ValueError(tag)


def nbt(root):
    return b'\x0a' + _str('') + _payload(10, root)


def pack(values, bits):
    per = 64 // bits
    out = []
    for i in range(0, len(values), per):
        v = 0
        for k, x in enumerate(values[i:i + per]):
            v |= x << (k * bits)
        out.append(v - (1 << 64) if v >= 1 << 63 else v)
    return out


def section(Y, cells):
    """cells: {(lx, ly, lz): (name, props)} -> a section compound."""
    names = sorted(set(cells.values()), key=lambda t: (t[0], json.dumps(t[1], sort_keys=True)))
    if len(names) == 1:
        pal = [{'Name': (8, names[0][0])}]
        if names[0][1]: pal[0]['Properties'] = (10, {k: (8, v) for k, v in names[0][1].items()})
        return {'Y': (1, Y), 'block_states': (10, {'palette': (9, (10, pal))})}
    idx = {n: i for i, n in enumerate(names)}
    vals = [idx[cells[(k & 15, k >> 8, (k >> 4) & 15)]] for k in range(4096)]
    bits = max(4, (len(names) - 1).bit_length())
    pal = []
    for n, props in names:
        e = {'Name': (8, n)}
        if props: e['Properties'] = (10, {k: (8, v) for k, v in props.items()})
        pal.append(e)
    return {'Y': (1, Y), 'block_states': (10, {'palette': (9, (10, pal)), 'data': (12, pack(vals, bits))})}


def chunk(cx, cz, blocks, inhabited, starts=None, refs=None, ground=63):
    """blocks: {(x, y, z): (name, props)} overrides inside this chunk on a terrain of stone below `ground`, grass at it."""
    secs = []
    for Y in (2, 3, 4):
        cells = {}
        for ly in range(16):
            y = Y * 16 + ly
            base = ('minecraft:stone', None) if y < ground else (('minecraft:grass_block', None) if y == ground else ('minecraft:air', None))
            for lz in range(16):
                for lx in range(16):
                    cells[(lx, ly, lz)] = blocks.get((cx * 16 + lx, y, cz * 16 + lz), base)
        secs.append(section(Y, cells))
    hm = []
    for lz in range(16):
        for lx in range(16):
            top = ground
            for y in range(79, ground, -1):
                if blocks.get((cx * 16 + lx, y, cz * 16 + lz), ('minecraft:air',))[0] not in ('minecraft:air', 'minecraft:torch'):
                    top = y; break
            hm.append(top + 65)
    root = {'DataVersion': (3, 4440), 'xPos': (3, cx), 'zPos': (3, cz), 'Status': (8, 'minecraft:full'),
            'InhabitedTime': (4, inhabited), 'sections': (9, (10, secs)),
            'Heightmaps': (10, {'MOTION_BLOCKING_NO_LEAVES': (12, pack(hm, 9))}),
            'structures': (10, {'starts': (10, starts or {}), 'References': (10, refs or {})})}
    return nbt(root)


def write_region(path, chunks):
    """chunks: {(lcx, lcz): bytes of uncompressed NBT} -> an .mca file."""
    loc = bytearray(4096); ts = bytearray(4096); body = bytearray(); sector = 2
    for (lx, lz), raw in sorted(chunks.items()):
        data = zlib.compress(raw)
        blob = struct.pack('>IB', len(data) + 1, 2) + data
        n = (len(blob) + 4095) // 4096
        blob += b'\x00' * (n * 4096 - len(blob))
        i = 4 * (lx + lz * 32)
        loc[i:i + 4] = struct.pack('>I', (sector << 8) | n)
        ts[i:i + 4] = struct.pack('>I', 1792000000)
        body += blob; sector += n
    with open(path, 'wb') as f:
        f.write(bytes(loc) + bytes(ts) + bytes(body))


def ref(cx, cz):
    v = (cz << 32) | (cx & 0xffffffff)
    return v - (1 << 64) if v >= 1 << 63 else v


def piece(sid, cx, cz, bb, loc):
    return {sid: (10, {'id': (8, sid), 'ChunkX': (3, cx), 'ChunkZ': (3, cz), 'Children': (9, (10, [
        {'id': (8, 'minecraft:jigsaw'), 'BB': (11, bb), 'pool_element': (10, {'location': (8, loc), 'element_type': (8, 'minecraft:single_pool_element')})}]))})}


HOME = (256, 64, 256)          # stamp_cells: the platform at home.y - 2 (62), chests, beds, torches, lectern at home.y - 1 (63)


def fixture(dirpath, sc):
    """Write the fixture region; return the hand-worked answer."""
    B = {}
    def put(x, y, z, n, props=None): B[(x, y, z)] = ('minecraft:' + n, props)
    for (x, y, z), k in sc.stamp_cells(HOME).items():                  # the operator's stamp: 207 cells
        put(x, y, z, k)
    for x in range(300, 305):                                         # one lit house: floor, 2-high walls, doorway, roof, torch
        for z in range(300, 305):
            put(x, 63, z, 'stone_bricks'); put(x, 66, z, 'oak_planks')
            if x in (300, 304) or z in (300, 304):
                for y in (64, 65):
                    if (x, z) != (302, 300): put(x, y, z, 'oak_planks')
    put(302, 64, 302, 'torch')
    for x in range(180, 220):                                         # a buried cobble slab: 800 cells under stone
        for z in range(180, 200):
            put(x, 50, z, 'cobblestone')
    put(230, 40, 300, 'spawner')                                      # a dungeon: masked by its spawner
    for d in range(-3, 4):
        put(230 + d, 40, 297, 'cobblestone'); put(230 + d, 40, 303, 'cobblestone')
    for x in range(322, 331):                                         # a village house at the surface: masked by its BB
        put(x, 64, 194, 'oak_planks'); put(x, 64, 202, 'oak_planks')
    vil = piece('minecraft:village_plains', 20, 12, [322, 60, 194, 330, 70, 202], 'minecraft:village/plains/houses/plains_small_house_1')
    hx, _, hz = HOME
    chunks = {}
    for lcx in range(32):
        for lcz in range(32):
            cx, cz = lcx, lcz
            inbox = abs(cx * 16 + 8 - hx) <= 96 + 16 and abs(cz * 16 + 8 - hz) <= 96 + 16
            blocks = {p: v for p, v in B.items() if p[0] >> 4 == cx and p[2] >> 4 == cz}
            starts, refs = None, None
            if (cx, cz) == (20, 12):
                starts, refs = vil, {'minecraft:village_plains': (12, [ref(20, 12)])}
            if not inbox:                                             # every never-ticked chunk: a small surface village piece
                x0, z0 = cx * 16 + 4, cz * 16 + 4
                for d in range(4):
                    blocks[(x0 + d, 64, z0)] = ('minecraft:oak_planks', None)
                sid = 'minecraft:village_taiga'
                starts = piece(sid, cx, cz, [x0, 60, z0, x0 + 3, 70, z0], 'minecraft:village/taiga/streets/x')
                refs = {sid: (12, [ref(cx, cz)])}
            chunks[(lcx, lcz)] = chunk(cx, cz, blocks, 0 if not inbox else 72000, starts, refs)
    os.makedirs(dirpath, exist_ok=True)
    write_region(os.path.join(dirpath, 'r.0.0.mca'), chunks)
    return {'stamp_present': 207, 'buildings': 1, 'box_chunks': 169, 'buried_min': 800}


# ------------------------------------------------------------------ cases
def run_fixture(sc, rdir):
    sc._regions.clear()
    res = sc.scan('fx', rdir, HOME, 96, True, None, [])
    neg = sc.negctl('fx', rdir, HOME, 96, 120)
    sc._regions.clear()
    return res, neg, sc.validate(res, neg, None)


def gate_cases(sc, rdir):
    """The cases the daily gate needs: the real instrument reads the fixture exactly and validation passes."""
    res, neg, bad = run_fixture(sc, rdir)
    out = []
    out.append(('fixture: coverage', (res['box_chunks'], res['box_chunks_ok']), (169, 169)))
    out.append(('fixture: stamp found', res['stamp_present'], 207))
    out.append(('fixture: one building', res['buildings'], 1))
    out.append(('fixture: the buried slab is buried', res['buried_structure_cells'] >= 800, True))
    out.append(('fixture: village and dungeon masked', res['masked'].get('worldgen_piece', 0) >= 18 + 14, True))
    out.append(('fixture: negative control saw 120', neg['uninhabited_full_chunks'], 120))
    out.append(('fixture: negative control 0 surface FP', neg['fp_cells_surface'], 0))
    out.append(('fixture: validate passes', bad, []))
    return out


BLIND = [   # (name, anchor, replacement): each must make validate() REFUSE on the fixture
    ('blind: no chunk readable', "    if off == 0: return None, 'absent'", "    return None, 'absent'"),
    ('blind: no section decoded', "    if dat is None or len(pal) <= 1: return None", "    return None"),
    ('blind: empty palette', "    r'cobblestone|cobblestone_(slab|stairs|wall)|", "    r'NOTHING_MATCHES_THIS|"),
    ('blind: no stamp model', "    return c\n\n# ------------------------------------------------------------------ grouping", "    return {}\n\n# ------------------------------------------------------------------ grouping"),
    ('blind: negctl sees no never-ticked chunk', "        if w.inhabited.get(c, 1) == 0 and str(w.status.get(c, '')).endswith('full'): zero.append(c)",
     "        if w.inhabited.get(c, 1) == -1 and str(w.status.get(c, '')).endswith('full'): zero.append(c)"),
    ('blind: no structure masks', "    return out\n\nPIECE_PAD_H", "    return []\n\nPIECE_PAD_H"),
]

BEHAVIOUR = [   # (case it must fail, anchor, replacement)
    ('validate: coverage', "    if scan_res.get('box_chunks', 0) <= 0 or scan_res.get('box_chunks_ok') != scan_res.get('box_chunks'):", "    if False:"),
    ('validate: stamp floor', "    if sp < STAMP_FLOOR:", "    if False:"),
    ('validate: stamp keep', "    if last and last.get('stamp_present') and sp < STAMP_KEEP * last['stamp_present']:", "    if False:"),
    ('validate: palette floor', "    if scan_res.get('raw_palette_cells', 0) < PALETTE_FLOOR:", "    if False:"),
    ('validate: negative chunks', "    if neg_res.get('uninhabited_full_chunks', 0) < NEG_MIN_CHUNKS:", "    if False:"),
    ('validate: negative FP', "    if neg_res.get('fp_cells_surface', 1) != 0:", "    if False:"),
    ('validate: stamp model', "    if scan_res.get('stamp_cells') != STAMP_CELLS:", "    if False:"),
    ('validate: unresolved starts', "    if scan_res.get('worldgen_starts_unreadable'):", "    if False:"),
]

READER = [   # (case, anchor, replacement) on scread.py
    ('reader: newer attempt', "    if a.get('attempt') != m.get('attempt'):", "    if False:"),
    ('reader: stale day', "    if m.get('day') != day:", "    if False:"),
    ('reader: hash', "        if not os.path.exists(p) or _sha(p) != h:", "        if False:"),
    ('reader: status', "    if m.get('status') != 'OK':", "    if False:"),
]


def validate_cases(sc):
    good = {'box_chunks': 169, 'box_chunks_ok': 169, 'worldgen_starts_unreadable': 0, 'stamp_cells': 207, 'stamp_present': 190,
            'raw_palette_cells': 5000}
    gneg = {'uninhabited_full_chunks': 120, 'fp_cells_surface': 0}
    def v(**kw):
        s = dict(good); n = dict(gneg); last = kw.pop('last', None)
        for k, x in kw.items():
            (n if k in gneg else s)[k] = x
        return bool(sc.validate(s, n, last))
    return [('validate: good passes', v(), False),
            ('validate: coverage', v(box_chunks_ok=168), True),
            ('validate: stamp floor', v(stamp_present=0), True),
            ('validate: stamp keep', v(stamp_present=160, last={'stamp_present': 199}), True),
            ('validate: palette floor', v(raw_palette_cells=0), True),
            ('validate: negative chunks', v(uninhabited_full_chunks=0), True),
            ('validate: negative FP', v(fp_cells_surface=3), True),
            ('validate: stamp model', v(stamp_cells=0), True),
            ('validate: unresolved starts', v(worldgen_starts_unreadable=2), True)]


def manifest_fixture(tmp, rd, mutate=None):
    """A publication on disk, then mutated; returns the reader's status."""
    out = os.path.join(tmp, 'out'); att = os.path.join(tmp, 'att')
    shutil.rmtree(tmp, ignore_errors=True); os.makedirs(os.path.join(out, 'gen-1')); os.makedirs(att)
    day = '2026-10-23'
    p = os.path.join(out, 'gen-1', 'structcount-day.json'); json.dump({'w': {'buildings': 0}}, open(p, 'w'))
    import hashlib
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    man = {'day': day, 'attempt': 'A1', 'status': 'OK', 'generation': 'gen-1', 'files': {'structcount-day.json': h},
           'last_good': {'generation': 'gen-1', 'sha': h}}
    att_doc = {'attempt': 'A1', 'day': day, 'started': '2026-10-23T03:45:00+00:00'}
    if mutate:
        mutate(man, att_doc, p)
    json.dump(man, open(os.path.join(out, 'manifest.json'), 'w')); json.dump(att_doc, open(os.path.join(att, 'attempt.json'), 'w'))
    now = dt.datetime(2026, 10, 23, 12, 0, tzinfo=dt.timezone.utc)
    return rd.status(out, att, day, now)['status']


def reader_cases(rd, tmp):
    def newer(m, a, p): a.update(attempt='A2', started='2026-10-23T03:50:00+00:00')
    def running(m, a, p): a.update(attempt='A2', started='2026-10-23T11:40:00+00:00')
    def stale(m, a, p): m['day'] = '2026-10-22'
    def altered(m, a, p): open(p, 'a').write(' ')
    def unknown(m, a, p): m['status'] = 'UNKNOWN'
    return [('reader: ok', manifest_fixture(tmp, rd), 'OK'),
            ('reader: newer attempt', manifest_fixture(tmp, rd, newer), 'UNKNOWN'),
            ('reader: running', manifest_fixture(tmp, rd, running), 'RUNNING'),
            ('reader: stale day', manifest_fixture(tmp, rd, stale), 'UNKNOWN'),
            ('reader: hash', manifest_fixture(tmp, rd, altered), 'UNKNOWN'),
            ('reader: status', manifest_fixture(tmp, rd, unknown), 'UNKNOWN')]


def daily_cases(sc, rd, rdir, tmp):
    """The cron pipeline end to end on the fixture, with the staging copy and the world list injected."""
    out = os.path.join(tmp, 'out'); att = os.path.join(tmp, 'att')
    shutil.rmtree(tmp, ignore_errors=True)
    def copy_fn(staging, w, home, dest):
        os.makedirs(dest, exist_ok=True); shutil.copytree(rdir, os.path.join(dest, 'region')); return None
    base = {'out': out, 'attempts': att, 'work': os.path.join(tmp, 'work'), 'staging': '-', 'backup_log': '-', 'expect': 1, 'r': 96,
            'day': None, 'skip_backup_check': True, 'worlds_fn': lambda s: ['fx'], 'home_fn': lambda s, w: HOME, 'copy_fn': copy_fn,
            'gate_cmd': [sys.executable, '-c', 'pass']}
    def run(fail_at=None, **kw):
        a = dict(base); a['force'] = True; a.update(kw)
        with contextlib.redirect_stdout(io.StringIO()):
            code = sc.daily(a, fail_at=fail_at)
        return code, rd.status(out, att)['status']
    cases = []
    cases.append(('daily: good publishes', run(), (0, 'OK')))
    cases.append(('daily: already published, nothing new', run(force=False, fail_at='selftest'), (0, 'OK')))
    cases.append(('daily: from OK, the generation rename fails', run(fail_at='gen_rename'), (6, 'UNKNOWN')))
    cases.append(('daily: retry good', run(), (0, 'OK')))
    cases.append(('daily: from OK, the OK manifest write fails', run(fail_at='manifest_ok'), (6, 'UNKNOWN')))
    cases.append(('daily: retry good', run(), (0, 'OK')))
    cases.append(('daily: depleted stamp refused', run(stamp_override=1), (4, 'UNKNOWN')))
    m = json.load(open(os.path.join(out, 'manifest.json')))
    cases.append(('daily: last_good carried through UNKNOWN', bool(m.get('last_good')), True))
    cases.append(('daily: selftest failure refused', run(fail_at='selftest'), (3, 'UNKNOWN')))
    cases.append(('daily: gate failure refused', run(gate_cmd=[sys.executable, '-c', 'import sys; sys.exit(1)']), (3, 'UNKNOWN')))
    cases.append(('daily: wrong world count refused', run(expect=2), (4, 'UNKNOWN')))
    cases.append(('daily: retry good again', run(), (0, 'OK')))
    lock = open(os.path.join(att, '.daily.lock'), 'w')
    import fcntl
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    cases.append(('daily: busy lock exits 8, touches nothing', run(fail_at='selftest'), (8, 'OK')))
    lock.close()
    cases.append(('daily: attempt cannot be recorded', run(fail_at='attempt'), (7, 'OK')))
    return cases


def hop_cases(sc, rd, rdir, tmp):
    """Owner Q8: the forced command (serve.py) and the mirror (pull.py), in process: what serve refuses, and a mirror the
    reader reads as OK; a tampered day file is never mirrored."""
    sv, pl = load('sv'), load('pl')
    shutil.rmtree(tmp, ignore_errors=True)
    out = os.path.join(tmp, 'out'); att = os.path.join(tmp, 'att'); cen = os.path.join(tmp, 'census')
    os.makedirs(cen)
    json.dump({'worlds': {}}, open(os.path.join(cen, 'census-goal-20261023T0015Z.json'), 'w'))
    open(os.path.join(cen, 'secret.json'), 'w').write('{}')
    def copy_fn(staging, w, home, dest):
        os.makedirs(dest, exist_ok=True); shutil.copytree(rdir, os.path.join(dest, 'region')); return None
    a = {'out': out, 'attempts': att, 'work': os.path.join(tmp, 'work'), 'staging': '-', 'backup_log': '-', 'expect': 1, 'r': 96,
         'day': None, 'skip_backup_check': True, 'worlds_fn': lambda s: ['fx'], 'home_fn': lambda s, w: HOME, 'copy_fn': copy_fn,
         'gate_cmd': [sys.executable, '-c', 'pass'], 'force': True}
    with contextlib.redirect_stdout(io.StringIO()):
        sc.daily(a)
    gen = json.load(open(os.path.join(out, 'manifest.json')))['generation']
    def ask(req):
        buf = io.BytesIO()
        class O:            # serve() writes to sys.stdout.buffer / sys.stdout
            buffer = buf
            def write(self, x): buf.write(x.encode())
        old = sys.stdout; sys.stdout = O()
        try:
            code = sv.serve(req, out, att, cen)
        finally:
            sys.stdout = old
        return code, buf.getvalue()
    cases = [('serve: manifest', ask('manifest')[0], 0),
             ('serve: the day of the manifest generation', ask('day ' + gen)[0], 0),
             ('serve: refuses another generation', ask('day gen-20991231T000000.000Z-1')[0], 2),
             ('serve: refuses a path', ask('day ../../etc/passwd')[0], 2),
             ('serve: refuses a shell command', ask('cat /etc/passwd')[0], 2),
             ('serve: refuses a non-census file', ask('census secret.json')[0], 2),
             ('serve: census name', ask('census-name')[1].strip(), b'census-goal-20261023T0015Z.json')]
    def fake(req, args):
        code, data = ask(req)
        if code:
            raise RuntimeError('refused %s' % req)
        return data
    mirror = os.path.join(tmp, 'in'); mcen = os.path.join(tmp, 'mcen')
    pl.pull({'in': mirror, 'census_dir': mcen}, fetch=fake)
    cases.append(('pull: the mirror reads OK', rd.status(mirror, os.path.join(mirror, 'attempts'), only=rd.MIRROR_FILES)['status'], 'OK'))
    cases.append(('pull: the census mirrored', os.path.exists(os.path.join(mcen, 'census-goal-20261023T0015Z.json')), True))
    open(os.path.join(out, gen, 'structcount-day.json'), 'a').write(' ')        # tamper with the source day file
    shutil.rmtree(os.path.join(mirror, gen))
    try:
        pl.pull({'in': mirror, 'census_dir': mcen}, fetch=fake); got = 'mirrored'
    except RuntimeError:
        got = 'refused'
    cases.append(('pull: a tampered day file is refused', got, 'refused'))
    cases.append(('pull: the mirror then reads UNKNOWN, never a mix', rd.status(mirror, os.path.join(mirror, 'attempts'), only=rd.MIRROR_FILES)['status'], 'UNKNOWN'))
    return cases


def strip_comments(text):
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(text).readline):
        if tok.type != tokenize.COMMENT:
            out.append(tok)
    return tokenize.untokenize(out)


def check(cases):
    fails = [c for c in cases if c[1] != c[2]]
    return fails


def mutate(name, anchor, repl):
    src = open(SRC[name]).read()
    if src.count(anchor) != 1:
        return None, 'anchor occurs %d times in the source' % src.count(anchor)
    stripped = strip_comments(src)
    first = anchor.strip().splitlines()[0]
    if stripped.count(first.strip()) < 1:
        return None, 'anchor is only in a comment'
    return src.replace(anchor, repl, 1), None


def main():
    gate_only = '--daily-gate' in sys.argv
    tmp = tempfile.mkdtemp(prefix='structcount-test-')
    sc = load('sc'); rd = load('rd')
    rdir = os.path.join(tmp, 'fixture', 'region')
    with contextlib.redirect_stdout(io.StringIO()):
        fixture(rdir, sc)
    results = []
    results += gate_cases(sc, rdir)
    for name, anchor, repl in BLIND:                                   # blind-input mutants: validation must refuse
        text, err = mutate('sc', anchor, repl)
        if err:
            results.append((name, err, 'applies')); continue
        try:
            m = load('sc', text)
            res, neg, bad = run_fixture(m, rdir)
            results.append((name, 'REFUSED' if bad else 'SURVIVED (validation empty on a blind read)', 'REFUSED'))
        except Exception as e:
            results.append((name, 'REFUSED (crashed: %s)' % type(e).__name__, 'REFUSED (crashed: %s)' % type(e).__name__))
    if not gate_only:
        st = sc.selftest(quiet=True)
        results.append(('instrument selftest', st['failed'], 0))
        results += validate_cases(sc)
        results += reader_cases(rd, os.path.join(tmp, 'man'))
        results += daily_cases(sc, rd, rdir, os.path.join(tmp, 'daily'))
        results += hop_cases(sc, rd, rdir, os.path.join(tmp, 'hop'))
        for case, anchor, repl in BEHAVIOUR:
            text, err = mutate('sc', anchor, repl)
            if err:
                results.append(('mutant ' + case, err, 'applies')); continue
            m = load('sc', text)
            killed = any(c[0] == case and c[1] != c[2] for c in validate_cases(m))
            results.append(('mutant ' + case, 'KILLED' if killed else 'SURVIVED', 'KILLED'))
        for case, anchor, repl in READER:
            text, err = mutate('rd', anchor, repl)
            if err:
                results.append(('mutant ' + case, err, 'applies')); continue
            m = load('rd', text)
            killed = any(c[0] == case and c[1] != c[2] for c in reader_cases(m, os.path.join(tmp, 'man2')))
            results.append(('mutant ' + case, 'KILLED' if killed else 'SURVIVED', 'KILLED'))
    shutil.rmtree(tmp, ignore_errors=True)
    bad = check(results)
    for c in results:
        print('%-50s %s' % (c[0], 'ok' if c[1] == c[2] else 'FAIL: got %r want %r' % (c[1], c[2])))
    print('%d cases, %d failed' % (len(results), len(bad)))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
