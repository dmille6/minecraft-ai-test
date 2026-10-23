#!/usr/bin/env python3
"""Behaviour tests for structcount.py (the structure count) and scread.py (its reader), plus MUTANTS.

    python3 -B scripts/host/structcount/test_structcount.py              (everything; exit 1 on any failure)
    python3 -B scripts/host/structcount/test_structcount.py --daily-gate (the fixture world + blind-input mutants: what
                                                                         `structcount.py daily` runs before every publication)

THE FIXTURE WORLD. A real Anvil region file is WRITTEN by this file (an NBT and region writer below) into a temp dir, with a
hand-worked answer: the operator's town stamp (207 cells), a torch-lit house and a lamp-lit house (lit=true: 2 buildings),
an unlit-lamp house (lit=false: 1 unlit room, so the block STATE is read in both directions), a buried cobble slab (a buried
structure), a dungeon (masked by its spawner), a village house piece at the surface (masked by its structure BB), and around
the box ~850 fully generated, never-ticked chunks each holding a small surface village piece (masked). The instrument must
read it back exactly, and `validate()` must find nothing to refuse.

BLIND-INPUT MUTANTS (the class the cooperation host tools failed on: controls that pass when the instrument sees nothing).
Each mutant blinds one part of the reader -- no chunk readable, no section decoded, an empty palette, no stamp model, no
negative-control chunks, negative-control chunks with nothing in them, no structure masks, block states ignored -- and must
be stopped FOR ITS NAMED REASON: either `validate()` refuses with the named problem (data-level blindness, which the daily
run meets on real worlds), or the named fixture case of the daily gate fails (code-level blindness: the daily runs this
gate on the installed code before every publication). A crash is a FAILURE, never a refusal (Claude r1 P3-3).

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


class HD(dict):
    """A hashable block-state dict (the fixture's cells are set members)."""
    def __hash__(self):
        return hash(tuple(sorted(self.items())))


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
    def put(x, y, z, n, props=None): B[(x, y, z)] = ('minecraft:' + n, HD(props) if props else None)
    for (x, y, z), k in sc.stamp_cells(HOME).items():                  # the operator's stamp: 207 cells
        put(x, y, z, k)
    for x in range(300, 305):                                         # one lit house: floor, 2-high walls, doorway, roof, torch
        for z in range(300, 305):
            put(x, 63, z, 'stone_bricks'); put(x, 66, z, 'oak_planks')
            if x in (300, 304) or z in (300, 304):
                for y in (64, 65):
                    if (x, z) != (302, 300): put(x, y, z, 'oak_planks')
    put(302, 64, 302, 'torch')
    for x0, z0, lit in ((330, 330, 'true'), (330, 310, 'false')):      # a lamp house each way: the lamp's `lit` decides it
        for x in range(x0, x0 + 5):
            for z in range(z0, z0 + 5):
                put(x, 63, z, 'stone_bricks'); put(x, 66, z, 'oak_planks')
                if x in (x0, x0 + 4) or z in (z0, z0 + 4):
                    for y in (64, 65):
                        if (x, z) != (x0 + 2, z0): put(x, y, z, 'oak_planks')
        put(x0 + 2, 64, z0 + 2, 'redstone_lamp', {'lit': lit})
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
    return {'stamp_present': 207, 'buildings': 2, 'unlit_rooms': 1, 'box_chunks': 169, 'buried_min': 800}


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
    out.append(('fixture: two buildings (torch, lamp lit=true)', res['buildings'], 2))
    out.append(('fixture: one unlit room (lamp lit=false)', res['unlit_rooms'], 1))
    out.append(('fixture: the buried slab is buried', res['buried_structure_cells'] >= 800, True))
    out.append(('fixture: village and dungeon masked', res['masked'].get('worldgen_piece', 0) >= 18 + 14, True))
    out.append(('fixture: negative control saw 120', neg['uninhabited_full_chunks'], 120))
    out.append(('fixture: negative control 0 surface FP', neg['fp_cells_surface'], 0))
    out.append(('fixture: negative control observed all 120', neg['observed_chunks'], 120))
    out.append(('fixture: every matching section decoded', (res['undecoded_hit_sections'], neg['undecoded_hit_sections']), (0, 0)))
    out.append(('fixture: validate passes', bad, []))
    return out


BLIND = [   # (name, anchor, replacement, how it must be stopped: 'validate:<problem text>' or 'gate:<fixture case>')
    ('blind: no chunk readable', "    if off == 0: return None, 'absent'", "    return None, 'absent'", 'validate:coverage'),
    ('blind: no section decoded', "    if dat is None or len(pal) <= 1: return None", "    return None", 'validate:stamp control'),
    ('blind: empty palette', "BUILT = re.compile(r'^minecraft:('", "BUILT = re.compile(r'(?!)('", 'validate:palette cells'),
    ('blind: no stamp model', "    return c\n\n# ------------------------------------------------------------------ grouping", "    return {}\n\n# ------------------------------------------------------------------ grouping", 'validate:stamp model'),
    ('blind: negctl sees no never-ticked chunk', "        if w.inhabited.get(c, 1) == 0 and str(w.status.get(c, '')).endswith('full'): zero.append(c)",
     "        if w.inhabited.get(c, 1) == -1 and str(w.status.get(c, '')).endswith('full'): zero.append(c)", 'validate:negative control saw'),
    ('blind: negctl chunks read empty', "    observed = 0\n", "    for c in zero: w.secs[c] = {}\n    observed = 0\n", 'validate:negative control blind'),
    ('blind: no structure masks', "    return out\n\nPIECE_PAD_H", "    return []\n\nPIECE_PAD_H", 'validate:surface false positives'),
    ('blind: negctl BUILT sections undecodable', "    fps = collections.Counter(); inpiece = 0; surface_fp = collections.Counter(); buried_fp = 0\n",
     "    for c in zero:\n        for s in (w.chunk(*c) or {}).values():\n            if any(BUILT.match(n) for n in s[0]): s[1] = {'palette': s[1].get('palette')}; s[2] = None\n"
     "    fps = collections.Counter(); inpiece = 0; surface_fp = collections.Counter(); buried_fp = 0\n", 'validate:negative control undecoded'),
    ('blind: negctl BUILT sections hold out-of-range indices', "    fps = collections.Counter(); inpiece = 0; surface_fp = collections.Counter(); buried_fp = 0\n",
     "    for c in zero:\n        for s in (w.chunk(*c) or {}).values():\n            if len(s[0]) > 1 and any(BUILT.match(n) for n in s[0]): s[2] = [len(s[0]) + 7] * 4096\n"
     "    fps = collections.Counter(); inpiece = 0; surface_fp = collections.Counter(); buried_fp = 0\n", 'validate:negative control undecoded'),
    ('blind: scan BUILT sections undecodable', "            if vals is None: vals = s[2] = section_values(bs)\n            if vals is None or len(vals) < 4096 or max(vals) >= len(pal):",
     "            vals = None\n            if vals is None or len(vals) < 4096 or max(vals) >= len(pal):", 'validate:scan undecoded'),
    ('blind: block states ignored', "[p.get('Properties') or {} for p in (bs.get('palette') or [])]", "[{} for p in (bs.get('palette') or [])]",
     'gate:fixture: two buildings (torch, lamp lit=true)'),
]

BEHAVIOUR = [   # (case it must fail, anchor, replacement)
    ('validate: coverage', "    if scan_res.get('box_chunks', 0) <= 0 or scan_res.get('box_chunks_ok') != scan_res.get('box_chunks'):", "    if False:"),
    ('validate: stamp floor', "    if sp < STAMP_FLOOR:", "    if False:"),
    ('validate: stamp keep', "    if last and last.get('stamp_present') and sp < STAMP_KEEP * last['stamp_present']:", "    if False:"),
    ('validate: palette floor', "    if scan_res.get('raw_palette_cells', 0) < PALETTE_FLOOR:", "    if False:"),
    ('validate: negative chunks', "    if neg_res.get('uninhabited_full_chunks', 0) < NEG_MIN_CHUNKS:", "    if False:"),
    ('validate: negative FP', "    if neg_res.get('fp_cells_surface', 1) != 0:", "    if False:"),
    ('validate: negative observed', "    if neg_res.get('observed_chunks', 0) < max(NEG_MIN_CHUNKS, neg_res.get('uninhabited_full_chunks', 0)):", "    if False:"),
    ('validate: undecoded sections (scan)', "        if r.get('undecoded_hit_sections', 1) != 0:", "        if what != 'scan' and r.get('undecoded_hit_sections', 1) != 0:"),
    ('validate: undecoded sections (negative control)', "        if r.get('undecoded_hit_sections', 1) != 0:", "        if what == 'scan' and r.get('undecoded_hit_sections', 1) != 0:"),
    ('validate: stamp model', "    if scan_res.get('stamp_cells') != STAMP_CELLS:", "    if False:"),
    ('validate: unresolved starts', "    if scan_res.get('worldgen_starts_unreadable'):", "    if False:"),
]

PULL = [   # (case, anchor, replacement) on pull.py
    ('pull: a torn pull leaves the previous mirror whole', "    for gen in {man.get('generation')", "    put(os.path.join(ind, 'manifest.json'), man_b)\n    for gen in {man.get('generation')"),
    ('pull: a run finishing mid-pull is retried: attempt and manifest agree', "        if att0 == att_b:\n            break", "        break"),
]

READER = [   # (case, anchor, replacement) on scread.py
    ('reader: newer attempt', "    if a.get('attempt') != m.get('attempt'):", "    if False:"),
    ('reader: stale day', "    if m.get('day') != day:", "    if False:"),
    ('reader: hash', "        if not os.path.exists(p) or _sha(p) != h:", "        if False:"),
    ('reader: status', "    if m.get('status') != 'OK':", "    if False:"),
]


def validate_cases(sc):
    good = {'box_chunks': 169, 'box_chunks_ok': 169, 'worldgen_starts_unreadable': 0, 'stamp_cells': 207, 'stamp_present': 190,
            'raw_palette_cells': 5000, 'undecoded_hit_sections': 0}
    gneg = {'uninhabited_full_chunks': 120, 'observed_chunks': 120, 'fp_cells_surface': 0, 'neg_undecoded': 0}
    def v(**kw):
        s = dict(good); n = dict(gneg); last = kw.pop('last', None)
        if 'neg_undecoded' in kw:
            kw['undecoded_hit_sections_neg'] = kw.pop('neg_undecoded')
        for k, x in kw.items():
            if k == 'undecoded_hit_sections_neg':
                n['undecoded_hit_sections'] = x
            else:
                (n if k in gneg else s)[k] = x
        n.setdefault('undecoded_hit_sections', 0); n.pop('neg_undecoded', None)
        return bool(sc.validate(s, n, last))
    return [('validate: good passes', v(), False),
            ('validate: coverage', v(box_chunks_ok=168), True),
            ('validate: stamp floor', v(stamp_present=0), True),
            ('validate: stamp keep', v(stamp_present=160, last={'stamp_present': 199}), True),
            ('validate: palette floor', v(raw_palette_cells=0), True),
            ('validate: negative chunks', v(uninhabited_full_chunks=0), True),
            ('validate: negative FP', v(fp_cells_surface=3), True),
            ('validate: negative observed', v(observed_chunks=119), True),
            ('validate: undecoded sections (scan)', v(undecoded_hit_sections=1), True),
            ('validate: undecoded sections (negative control)', v(neg_undecoded=1), True),
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
    cases.append(('daily: a crash is UNKNOWN with its reason, never RUNNING', run(fail_at='crash'), (4, 'UNKNOWN')))
    cases.append(('daily: the crash is named in the manifest', 'crash: ValueError' in json.load(open(os.path.join(out, 'manifest.json'))).get('why', ''), True))
    cases.append(('daily: retry good after the crash', run(), (0, 'OK')))
    today = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    log = os.path.join(tmp, 'backup.log')
    def logrun(lines, **kw):
        open(log, 'w').write(''.join('2026-01-01T03:15:00Z %s\n' % l for l in lines))
        return run(skip_backup_check=False, backup_log=log, day=today, **kw)
    START, GOOD = 'start %s: 1 fleet worlds -> nas' % today, 'good %s: 1/1 worlds, raw 1MB -> zst 1MB, 5s' % today
    cases.append(('daily: backup residual 0 publishes', logrun([START, 'ok fx: raw 9MB zst 7MB files=9 mca=3 residual=0 5s', GOOD]), (0, 'OK')))
    cases.append(('daily: backup residual 999 is UNKNOWN', logrun([START, 'ok fx: raw 9MB zst 7MB files=9 mca=3 residual=999 5s', GOOD]), (4, 'UNKNOWN')))
    cases.append(('daily: residual 21 (just over 20) is UNKNOWN', logrun([START, 'ok fx: files=9 mca=3 residual=21 5s', GOOD]), (4, 'UNKNOWN')))
    cases.append(('daily: residual 20 (at the limit) publishes', logrun([START, 'ok fx: files=9 mca=3 residual=20 5s', GOOD]), (0, 'OK')))
    cases.append(('daily: no completion line for the world is UNKNOWN', logrun([START, 'ok other: files=9 mca=3 residual=0 5s', GOOD]), (4, 'UNKNOWN')))
    cases.append(('daily: a later run of the day replaces the earlier', logrun([START, 'ok fx: residual=999 5s', GOOD, START, 'ok fx: residual=0 5s', GOOD]), (0, 'OK')))
    cases.append(('daily: no good line yet: not yet, nothing touched', logrun([START, 'ok fx: residual=0 5s']), (0, 'OK')))
    open(log, 'w').write(''.join('2026-01-01T03:15:00Z %s\n' % l for l in [START, 'ok fx: residual=0 5s', GOOD, START, 'ok fx: residual=999 5s']))
    cases.append(('backup_record: an unfinished LATER run voids the earlier good', sc.backup_record(log, today), (False, {})))
    cases.append(('daily: an unfinished later backup run: not yet', logrun([START, 'ok fx: residual=0 5s', GOOD, START]), (0, 'OK')))
    other = 'start %s: 3 fleet worlds -> nas' % today
    cases.append(('daily: another script\'s run (3 worlds, not 1) in the log is ignored', logrun([START, 'ok fx: residual=0 5s', GOOD, other, 'ok sc: residual=0 5s', 'good %s: 3/3' % today]), (0, 'OK')))
    cases.append(('backup_record: positive control, expect=None reads that other run', sc.backup_record(log, today)[1], {'sc': 0}))
    for tok in ('0.999', '0x10', '7abc', '-1', ''):
        cases.append(('daily: malformed residual=%s is UNKNOWN (no completion line)' % tok,
                      logrun([START, 'ok fx: files=9 residual=%s 5s' % tok, GOOD]), (4, 'UNKNOWN')))
    cases.append(('daily: positive control, residual=0 at the end of the line publishes', logrun([START, 'ok fx: files=9 residual=0', GOOD]), (0, 'OK')))
    open(log, 'w').write(''.join('2026-01-01T03:15:00Z %s\n' % l for l in [START, 'ok fx: residual=0 5s']))
    cases.append(('backup_record: a started, unfinished run records nothing', sc.backup_record(log, today), (False, {})))
    return cases


def hop_cases(sc, rd, rdir, tmp, pl_mod=None):
    """Owner Q8: the forced command (serve.py) and the mirror (pull.py), in process: what serve refuses, and a mirror the
    reader reads as OK; a tampered day file is never mirrored."""
    sv, pl = load('sv'), (pl_mod or load('pl'))
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
    def snap():
        m = json.loads(ask('manifest')[1])
        d = {'manifest': ask('manifest')[1], 'attempt': ask('attempt')[1]}
        for g in {m.get('generation'), (m.get('last_good') or {}).get('generation')} - {None}:
            d['day ' + g] = ask('day ' + g)[1]
        return d
    s1 = snap()
    with contextlib.redirect_stdout(io.StringIO()):
        sc.daily(a)                                                     # a second publication at the source: gen B
    gen2 = json.load(open(os.path.join(out, 'manifest.json')))['generation']
    s2 = snap()
    cases.append(('pull: positive control, the source moved to a new generation', gen2 != gen, True))
    open(os.path.join(out, gen2, 'structcount-day.json'), 'a').write(' ')       # tamper with the NEW day file at the source
    try:
        pl.pull({'in': mirror, 'census_dir': mcen}, fetch=fake); got = 'mirrored'
    except RuntimeError:
        got = 'refused'
    cases.append(('pull: a tampered day file is refused', got, 'refused'))
    mman = json.load(open(os.path.join(mirror, 'manifest.json')))
    cases.append(('pull: a torn pull leaves the previous mirror whole', (mman['generation'], rd.status(mirror, os.path.join(mirror, 'attempts'), only=rd.MIRROR_FILES)['status']), (gen, 'OK')))
    # a run that finishes BETWEEN the pull's requests (Claude r1 P3-4): the source switches from s1 to s2 after call 2
    calls = []
    def racing(req, args):
        calls.append(req)
        src = s1 if len(calls) <= 2 else s2
        if req.startswith('census'):
            return fake(req, args)
        if req not in src:
            raise RuntimeError('refused %s' % req)
        return src[req]
    m2 = os.path.join(tmp, 'in2')
    try:
        pl.pull({'in': m2, 'census_dir': mcen}, fetch=racing)
        mm, ma = json.load(open(os.path.join(m2, 'manifest.json'))), json.load(open(os.path.join(m2, 'attempts', 'attempt.json')))
        got = (ma['attempt'] == mm['attempt'], mm['generation'])
    except RuntimeError as e:
        got = ('pull failed', str(e)[:60])
    cases.append(('pull: a run finishing mid-pull is retried: attempt and manifest agree', got, (True, gen2)))
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
    for name, anchor, repl, how in BLIND:                              # blind-input mutants: stopped for their named reason
        text, err = mutate('sc', anchor, repl)
        if err:
            results.append((name, err, 'applies')); continue
        try:
            m = load('sc', text)
            res, neg, bad = run_fixture(m, rdir)
            kind, what = how.split(':', 1)
            if kind == 'validate':
                got = 'STOPPED' if any(what in b for b in bad) else 'SURVIVED (problems: %s)' % (bad or 'none')
            else:
                gate = {c[0]: c for c in gate_cases(m, rdir)}
                got = 'STOPPED' if what in gate and gate[what][1] != gate[what][2] else 'SURVIVED (the gate case %r passed)' % what
        except Exception as e:                                         # a crash proves nothing about the controls
            got = 'CRASHED: %s: %s' % (type(e).__name__, e)
        results.append((name, got, 'STOPPED'))
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
        for case, anchor, repl in PULL:
            text, err = mutate('pl', anchor, repl)
            if err:
                results.append(('mutant ' + case, err, 'applies')); continue
            m = load('pl', text)
            killed = any(c[0] == case and c[1] != c[2] for c in hop_cases(sc, rd, rdir, os.path.join(tmp, 'hop2'), pl_mod=m))
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
