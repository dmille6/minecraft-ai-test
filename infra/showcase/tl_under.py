#!/usr/bin/env python3
"""tl_under.py -- pictures of the bots' UNDERGROUND work (camunder-01). Stdlib only: no numpy, no PIL, no ffmpeg.

WHY. Every showcase camera is a surface view, and BlueMap hides caves. Measured over 12 h the 14 bots spend 64% of
their time below ground, where no camera sees them. This draws the rock itself, from a block dump, and the bots in it.

Three styles, one framing per scene so the frames of a scene play as a video:
  side    SIDE CUT ("ant farm"): a vertical cross-section. The plane comes from the bots' own movement (the horizontal
          axis they spread along most, through the busiest slab of the other axis); a slab 5 blocks thick is
          projected (any open cell in the slab reads as open space: `--mode near`, nearest block wins, was tried and
          hides every tunnel behind the slab's front face), sky and surface on top. Open space lit from the side by
          daylight (under an overhang or a floating block) is drawn as shade, not as a cave.
  plan    ROOF OFF: straight down with everything above a height removed; the floor of the highest tunnel or cave
          under the cut, coloured by block and shaded by depth; rock with no opening is a dark hatch. At most 24
          levels deep (the busiest 24 of a taller scene): through 50 levels every column has a floor and nothing reads.
  trails  DEPTH TRAILS: the side cut plus each bot's path over the last N minutes as a fading line, a marker with its
          name and the skill in hand, and a roster.  (plantrails: the same overlay on the roof-off view.)
          A bot inside the cut is a full disc and a full line; one in front of or behind it a ring and a thin line.
          Cells a bot has stood in that the block scan still shows as rock are painted as DUG SINCE THE SCAN: the
          blocks are one snapshot, and the positions are the only record of digging newer than it.

    tl_under.py scenes  --pos posdump.json [--dump dump.json] [--n 3]          the built-in scene finder, as JSON
    tl_under.py frame   --dump dump.json --pos posdump.json (--scenes scenes-slot.json | --auto 3)
                        [--style side|plan|trails|plantrails|all] [--size 1920x1080] [--at latest|busiest|ISO]
                        [--trail-min 45] (--out DIR | --root ROOT) [--cache DIR] [--mode open|near] [--slab 5]
                        [--layer under] [--ghost] [--tag -x]
    tl_under.py seq     ... as frame, plus [--frames 12] [--step-min 5] [--pick 0]    one scene, stepping in time
    tl_under.py palette --dump dump.json      which class every block name fell into (read it: 'other' is a guess)
    tl_under.py bench   [--size 1920x1080]    seconds per frame per style on a synthetic 96x96x70 box
    tl_under.py video   'frames/*.png' out.mp4 [--fps 4]                             (tl2.encode; needs ffmpeg)

Inputs: a block dump in the format of scripts/host/townplan_blockdump.py, and positions {"pos": {bot: {iso: [x, y, z,
skill]}}} at 10-s resolution. A scene is {id, layer, box [x0, z0, x1, z1], y [y0, y1], caption, bots}: from the
director's scenes-slot.json, or from find_scenes() here.

With --root, frames land where tl_showcase puts them, frames/<camera>/<YYYYMMDD>/<stamp>.png, each with a <stamp>.json
sidecar that carries the FRAMING (axis, slab, ranges, pixels per block, origin): the next slot reads it back from
<root>/under-framing/<camera>.json, so a scene keeps its scale, cut and colours for as long as its box does.

There is no PNG writer or bitmap font elsewhere in this repo (tl2 draws text with ffmpeg drawtext over BlueMap
screenshots), so both are here. Reused: tl2trails' bot colours, trail-break limits and compass; tl_showcase's frame
path and stamp; tl2.encode for the video. NOT wired into the live capture.
"""
import argparse, base64, bisect, collections, datetime as dt, hashlib, json, math, os, re, struct, sys, time, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, 'tl2'), os.path.join(HERE, '..', '..', 'scripts', 'lib')):
    if _p not in sys.path:
        sys.path.insert(0, _p)
from tl2trails import COLORS, GAP_S, MAX_V, MAX_JUMP, ONLINE, compass   # noqa: E402  (one bot palette for every map)
from tl_showcase import stamp_of, parse_stamp, frame_path              # noqa: E402  (one frame layout)

VERSION = 1                     # part of the background cache key: bump it when the look changes
UTC = dt.timezone.utc
HOME = (0, 70, 0)               # the town centre
UNDER_Y = 58                    # a sample below this is underground (the surface is y 62-72)
CELL = 24                       # the scene finder's cell, blocks
SLAB = 5                        # the side cut's thickness, blocks (3 misses side rooms, 7 piles stairways on each other)
PLAN_BAND = 24                  # the roof-off view looks down through at most this many levels
SAMPLE_MIN = 10 / 60.0          # one position sample is 10 s of one bot
SKILL_W = {'mine': 3.0, 'deep_mine': 3.0, 'gather': 2.0, 'explore': 1.0}     # everything else 0.5
SKILL_W_OTHER = 0.5
VERB = {'mine': 'mining', 'deep_mine': 'deep mining', 'gather': 'gathering', 'explore': 'exploring', 'goto': 'walking',
        'home': 'heading home', 'craft': 'crafting', 'smelt': 'smelting', 'smelt_town': 'smelting', 'deposit': 'storing',
        'town_deposit': 'storing', 'surface': 'climbing out', 'eat': 'eating', 'place': 'placing', '?': 'starting'}
WIND = {'N': 'north', 'NE': 'north-east', 'E': 'east', 'SE': 'south-east', 'S': 'south', 'SW': 'south-west',
        'W': 'west', 'NW': 'north-west'}


# ================================================================ blocks: name -> class -> colour
# kind: a air, s sky, o thing standing in open space, w water, v lava, r natural, e ore, p placed, x placed special,
#       c canopy, u unknown.  prio: who wins a slab column (>= 7 beats open space).  ground: counts for the skyline.
#       (name, kind, prio, ground, jitter, pattern, base, fg, fg2)
_C = [
    ('unknown', 'u', 0, 0, 0, 'check', (70, 30, 70), (40, 20, 40), None),
    ('air', 'a', 0, 0, 0, 'flat', (14, 12, 18), None, None),
    ('sky', 's', 0, 0, 0, 'flat', (140, 185, 240), None, None),
    ('open', 'a', 0, 0, 0, 'flat', (14, 12, 18), None, None),          # display only: open space underground
    ('stone', 'r', 1, 1, 1, 'flat', (126, 126, 126), None, None),
    ('andesite', 'r', 1, 1, 1, 'flat', (136, 138, 138), None, None),
    ('diorite', 'r', 1, 1, 1, 'flat', (184, 184, 187), None, None),
    ('granite', 'r', 1, 1, 1, 'flat', (154, 112, 96), None, None),
    ('tuff', 'r', 1, 1, 1, 'flat', (108, 111, 102), None, None),
    ('deepslate', 'r', 1, 1, 1, 'flat', (84, 84, 91), None, None),
    ('calcite', 'r', 1, 1, 1, 'flat', (222, 224, 220), None, None),
    ('basalt', 'r', 1, 1, 1, 'flat', (66, 66, 74), None, None),
    ('dirt', 'r', 1, 1, 1, 'flat', (136, 98, 68), None, None),
    ('grass', 'r', 1, 1, 1, 'flat', (104, 156, 62), None, None),
    ('gravel', 'r', 1, 1, 1, 'speck', (134, 128, 124), (104, 100, 98), None),
    ('sand', 'r', 1, 1, 1, 'flat', (219, 207, 163), None, None),
    ('sandstone', 'r', 1, 1, 1, 'flat', (212, 198, 150), None, None),
    ('clay', 'r', 1, 1, 1, 'flat', (160, 166, 180), None, None),
    ('moss', 'r', 1, 1, 1, 'flat', (96, 122, 48), None, None),
    ('ice', 'r', 1, 1, 1, 'flat', (150, 186, 250), None, None),
    ('snow', 'r', 1, 1, 0, 'flat', (240, 246, 250), None, None),
    ('magma', 'r', 2, 1, 1, 'speck', (120, 52, 22), (230, 110, 30), None),
    ('obsidian', 'r', 1, 1, 0, 'flat', (34, 24, 50), None, None),
    ('amethyst', 'r', 5, 1, 1, 'speck', (150, 98, 214), (210, 170, 250), None),
    ('other', 'r', 1, 1, 1, 'flat', (122, 112, 102), None, None),
    ('leaves', 'c', 1, 0, 1, 'speck', (58, 108, 52), (40, 82, 40), None),
    ('water', 'w', 6, 1, 0, 'flat', (52, 104, 214), None, None),
    ('lava', 'v', 7, 1, 1, 'speck', (255, 122, 24), (255, 222, 90), None),
    ('ore_coal', 'e', 5, 1, 0, 'ore', (126, 126, 126), (24, 24, 28), (220, 220, 220)),
    ('ore_iron', 'e', 5, 1, 0, 'ore', (126, 126, 126), (232, 178, 146), (60, 40, 30)),
    ('ore_copper', 'e', 5, 1, 0, 'ore', (126, 126, 126), (240, 126, 66), (40, 90, 70)),
    ('ore_gold', 'e', 5, 1, 0, 'ore', (126, 126, 126), (255, 218, 40), (90, 60, 0)),
    ('ore_redstone', 'e', 5, 1, 0, 'ore', (126, 126, 126), (255, 36, 28), (70, 0, 0)),
    ('ore_lapis', 'e', 5, 1, 0, 'ore', (126, 126, 126), (50, 96, 240), (10, 20, 80)),
    ('ore_diamond', 'e', 5, 1, 0, 'ore', (126, 126, 126), (90, 244, 232), (10, 70, 80)),
    ('ore_emerald', 'e', 5, 1, 0, 'ore', (126, 126, 126), (36, 232, 104), (0, 70, 30)),
    ('dore_coal', 'e', 5, 1, 0, 'ore', (84, 84, 91), (24, 24, 28), (220, 220, 220)),
    ('dore_iron', 'e', 5, 1, 0, 'ore', (84, 84, 91), (232, 178, 146), (60, 40, 30)),
    ('dore_copper', 'e', 5, 1, 0, 'ore', (84, 84, 91), (240, 126, 66), (40, 90, 70)),
    ('dore_gold', 'e', 5, 1, 0, 'ore', (84, 84, 91), (255, 218, 40), (90, 60, 0)),
    ('dore_redstone', 'e', 5, 1, 0, 'ore', (84, 84, 91), (255, 36, 28), (70, 0, 0)),
    ('dore_lapis', 'e', 5, 1, 0, 'ore', (84, 84, 91), (50, 96, 240), (10, 20, 80)),
    ('dore_diamond', 'e', 5, 1, 0, 'ore', (84, 84, 91), (90, 244, 232), (10, 70, 80)),
    ('dore_emerald', 'e', 5, 1, 0, 'ore', (84, 84, 91), (36, 232, 104), (0, 70, 30)),
    ('cobble', 'p', 4, 1, 0, 'brick', (168, 162, 152), (104, 100, 94), None),
    ('cobble_deep', 'p', 4, 1, 0, 'brick', (104, 104, 114), (58, 58, 66), None),
    ('stone_bricks', 'p', 4, 1, 0, 'brick', (146, 146, 148), (96, 96, 98), None),
    ('tuff_bricks', 'p', 4, 1, 0, 'brick', (118, 124, 110), (74, 78, 70), None),
    ('planks', 'p', 4, 1, 0, 'plank', (198, 158, 98), (140, 104, 60), None),
    ('log', 'p', 4, 1, 0, 'log', (116, 86, 50), (78, 56, 30), None),
    ('copper', 'p', 4, 1, 0, 'brick', (206, 118, 84), (150, 80, 56), None),
    ('copper_green', 'p', 4, 1, 0, 'brick', (86, 170, 142), (54, 120, 100), None),
    ('glass', 'p', 4, 1, 0, 'frame', (176, 214, 228), (236, 246, 250), None),
    ('cloth', 'p', 4, 1, 0, 'flat', (196, 70, 70), None, None),
    ('path', 'p', 3, 1, 0, 'flat', (156, 128, 74), None, None),
    ('farmland', 'p', 3, 1, 0, 'plank', (104, 68, 42), (76, 48, 28), None),
    ('built', 'p', 4, 1, 0, 'frame', (176, 166, 150), (120, 112, 100), None),
    ('chest', 'x', 8, 1, 0, 'chest', (232, 160, 40), (255, 240, 170), (92, 56, 14)),
    ('furnace', 'x', 8, 1, 0, 'furnace', (92, 92, 98), (255, 150, 36), (40, 40, 44)),
    ('station', 'x', 8, 1, 0, 'table', (182, 120, 64), (96, 60, 28), (226, 188, 120)),
    ('cage', 'x', 8, 1, 0, 'cage', (30, 46, 66), (80, 190, 210), None),
    ('torch', 'o', 9, 0, 0, 'torch', (14, 12, 18), (255, 236, 130), (255, 170, 40)),
    ('ladder', 'o', 8, 0, 0, 'ladder', (14, 12, 18), (220, 174, 100), None),
    ('rail', 'o', 8, 0, 0, 'rail', (14, 12, 18), (196, 196, 206), (130, 96, 56)),
    ('glow', 'o', 7, 0, 0, 'dots', (14, 12, 18), (130, 214, 180), None),
]
CLASSES = [c[0] for c in _C]
CID = {c[0]: i for i, c in enumerate(_C)}
KIND = [c[1] for c in _C]
PRIO = [c[2] for c in _C]
UNKNOWN, AIR, SKY, OPEN, WATER, LAVA, TORCH, LADDER, GLOW = (CID[n] for n in
                                                              ('unknown', 'air', 'sky', 'open', 'water', 'lava', 'torch', 'ladder', 'glow'))
OPEN_RGB = {1: (38, 34, 44), 2: (25, 22, 30), 3: (13, 11, 17),      # 1 = a thin tunnel in the slab, 3 = open right through
            4: (84, 112, 150)}                                      # 4 = open to daylight from the side: shade, not cave
GHOST_RGB = (30, 26, 38)
LIGHT_OPEN = (176, 126, 52)
LIGHT_ROCK = (255, 214, 140)
PLAN_FLOOR = (158, 154, 148)
FRESH_RGB = (150, 62, 30)        # a cell a bot has stood in that the block snapshot still shows as rock

_EXACT = {
    'stone': 'stone', 'infested_stone': 'stone', 'andesite': 'andesite', 'diorite': 'diorite', 'granite': 'granite',
    'tuff': 'tuff', 'deepslate': 'deepslate', 'infested_deepslate': 'deepslate', 'calcite': 'calcite',
    'smooth_basalt': 'basalt', 'basalt': 'basalt', 'blackstone': 'basalt', 'bedrock': 'basalt', 'dirt': 'dirt',
    'rooted_dirt': 'dirt', 'coarse_dirt': 'dirt', 'podzol': 'dirt', 'mud': 'dirt', 'grass_block': 'grass',
    'mycelium': 'grass', 'gravel': 'gravel', 'sand': 'sand', 'red_sand': 'sand', 'sandstone': 'sandstone',
    'clay': 'clay', 'moss_block': 'moss', 'packed_ice': 'ice', 'ice': 'ice', 'blue_ice': 'ice', 'snow_block': 'snow',
    'powder_snow': 'snow', 'magma_block': 'magma', 'obsidian': 'obsidian', 'crying_obsidian': 'obsidian',
    'amethyst_block': 'amethyst', 'budding_amethyst': 'amethyst', 'dripstone_block': 'granite', 'netherrack': 'granite',
    'bone_block': 'calcite', 'pumpkin': 'other', 'melon': 'other',
    'water': 'water', 'bubble_column': 'water', 'seagrass': 'water', 'tall_seagrass': 'water', 'kelp': 'water',
    'kelp_plant': 'water', 'lava': 'lava',
    'torch': 'torch', 'wall_torch': 'torch', 'soul_torch': 'torch', 'soul_wall_torch': 'torch', 'lantern': 'torch',
    'soul_lantern': 'torch', 'campfire': 'torch', 'glowstone': 'torch', 'sea_lantern': 'torch', 'shroomlight': 'torch',
    'jack_o_lantern': 'torch', 'redstone_torch': 'torch', 'redstone_wall_torch': 'torch',
    'glow_lichen': 'glow', 'ladder': 'ladder', 'scaffolding': 'ladder',
    'chest': 'chest', 'trapped_chest': 'chest', 'barrel': 'chest', 'ender_chest': 'chest',
    'furnace': 'furnace', 'blast_furnace': 'furnace', 'smoker': 'furnace',
    'crafting_table': 'station', 'fletching_table': 'station', 'smithing_table': 'station', 'cartography_table': 'station',
    'grindstone': 'station', 'composter': 'station', 'anvil': 'station', 'hopper': 'station', 'dispenser': 'station',
    'dropper': 'station', 'bell': 'station', 'decorated_pot': 'station', 'cauldron': 'station', 'water_cauldron': 'station',
    'loom': 'station', 'stonecutter': 'station', 'lectern': 'station', 'bookshelf': 'station',
    'spawner': 'cage', 'trial_spawner': 'cage', 'vault': 'cage',
    'cobblestone': 'cobble', 'mossy_cobblestone': 'cobble', 'dirt_path': 'path', 'farmland': 'farmland',
    'azalea': 'leaves', 'flowering_azalea': 'leaves',
}
_THIN = {'short_grass', 'tall_grass', 'grass', 'fern', 'large_fern', 'dandelion', 'poppy', 'vine', 'moss_carpet',
         'snow', 'brown_mushroom', 'red_mushroom', 'cobweb', 'sugar_cane', 'sweet_berry_bush', 'bush', 'firefly_bush',
         'dead_bush', 'hanging_roots', 'spore_blossom', 'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf',
         'pointed_dripstone', 'chain', 'flower_pot', 'wheat', 'carrots', 'potatoes', 'beetroots', 'cave_vines',
         'cave_vines_plant', 'amethyst_cluster', 'large_amethyst_bud', 'medium_amethyst_bud', 'small_amethyst_bud',
         'candle', 'lever', 'tripwire', 'tripwire_hook', 'redstone_wire', 'fire', 'bamboo', 'cactus', 'lily_pad',
         'leaf_litter', 'wildflowers', 'pink_petals', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'allium',
         'blue_orchid', 'lily_of_the_valley', 'peony', 'rose_bush', 'lilac', 'sunflower'}
_WOODS = ('oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped',
          'pale_oak')
_ORE = re.compile(r'^(deepslate_)?(coal|iron|copper|gold|redstone|lapis|diamond|emerald)_ore$')


def classify(name):
    """A block name as the dump writes it ('stone', 'glow_lichen[waterlogged]', 'snow[layers=1]') -> a class name
    (CLASSES). Plants, layers, buttons and signs are 'air': they do not fill their cell. Pure (tested)."""
    wl = name.endswith('[waterlogged]')
    n = name.split('[', 1)[0].replace('minecraft:', '')
    if n == '?':
        return 'unknown'
    if n in ('air', 'cave_air', 'void_air'):
        return 'air'
    if n in _EXACT and not (wl and KIND[CID[_EXACT[n]]] in 'ao'):
        return _EXACT[n]
    if wl:
        return 'water'
    m = _ORE.match(n)
    if m:
        return ('dore_' if m.group(1) else 'ore_') + m.group(2)
    if n.startswith('raw_') and n.endswith('_block'):
        return 'ore_' + n[4:-6] if 'ore_' + n[4:-6] in CID else 'other'
    if n in _THIN or n.startswith('potted_') or n.endswith(('_sapling', '_button', '_sign', '_carpet', '_pressure_plate',
                                                            '_banner', '_candle', '_tulip', '_coral_fan', '_head', '_skull')):
        return 'air'
    if n.endswith('rail'):
        return 'rail'
    if n.endswith('_leaves'):
        return 'leaves'
    if 'copper' in n:
        return 'copper_green' if ('oxidized' in n or 'weathered' in n) else 'copper'
    if n.endswith(('_log', '_wood', '_stem', '_hyphae')):
        return 'log'
    if n.endswith('_planks') or (n.startswith(_WOODS) and n.endswith(('_slab', '_stairs', '_fence', '_fence_gate', '_door',
                                                                         '_trapdoor'))):
        return 'planks'
    if n.startswith('cobbled_deepslate') or n.startswith('deepslate_') or n.startswith('polished_deepslate'):
        return 'cobble_deep'
    if n.startswith(('cobblestone_', 'mossy_cobblestone_')):
        return 'cobble'
    if 'tuff' in n:
        return 'tuff_bricks'
    if 'brick' in n or n.startswith(('polished_', 'chiseled_', 'smooth_', 'cut_')) or n.startswith('stone_'):
        return 'stone_bricks'
    if 'glass' in n:
        return 'glass'
    if n.endswith(('_bed', '_wool', '_terracotta', '_concrete', '_concrete_powder')):
        return 'cloth'
    if n.endswith(('_slab', '_stairs', '_wall', '_door', '_trapdoor', '_fence', '_fence_gate')):
        return 'built'
    return 'other'


def read_json(path):
    with open(path) as f:
        return json.load(f)


def _mask(pred):
    return bytes(1 if pred(i) else 0 for i in range(256))


M_AIR = _mask(lambda i: i < len(_C) and KIND[i] == 'a')                    # 1 where a cell is empty
M_GROUND = _mask(lambda i: i < len(_C) and _C[i][3] == 1)                  # 1 where a cell counts for the skyline
M_HOLLOW = _mask(lambda i: i < len(_C) and KIND[i] in 'ao')              # 1 where a cell is empty or holds a torch or ladder
T_SKY = bytes(SKY if (i < len(_C) and KIND[i] == 'a') else i for i in range(256))   # air above the skyline is sky


# ================================================================ the world: a block dump, as class ids
class World:
    """A box of block classes. cells: palette index per cell, x fastest, then z, then y (townplan_blockdump)."""
    def __init__(self, box, yr, palette, cells, bits=8, token='mem'):
        self.box, self.yr, self.palette, self.bits, self.token = list(box), list(yr), palette, bits, token
        self.nx, self.nz, self.ny = box[2] - box[0] + 1, box[3] - box[1] + 1, yr[1] - yr[0] + 1
        cls = [CID[classify(n)] for n in palette]
        if bits == 8:
            self.cells = cells
            self.lut = bytes(cls + [UNKNOWN] * (256 - len(cls)))
        else:
            import array
            a = array.array('H')
            a.frombytes(cells)
            if sys.byteorder == 'big':
                a.byteswap()
            self.cells, self.lut = a, cls
        assert len(self.cells) == self.nx * self.nz * self.ny, 'the dump is not box x y cells'
        self._memo = {}

    @classmethod
    def from_dump(cls, path):
        d = read_json(path)
        st = os.stat(path)
        token = hashlib.sha1(f'{os.path.abspath(path)}:{st.st_size}:{st.st_mtime_ns}'.encode()).hexdigest()[:16]
        return cls(d['box'], d['y'], d['palette'], base64.b64decode(d['cells']), d.get('bits', 8), token)

    def _row(self, o, n):
        if self.bits == 8:
            return self.cells[o:o + n].translate(self.lut)
        return bytes(map(self.lut.__getitem__, self.cells[o:o + n]))

    def block(self, x0, z0, x1, z1, y0, y1):
        """Class ids of a box (inclusive), x fastest, then z, then y. Cells outside the dump are UNKNOWN. Memoised:
        the second frame of a scene does not walk the dump again."""
        key = (x0, z0, x1, z1, y0, y1)
        if key in self._memo:
            return self._memo[key]
        wx0, wz0, wx1, wz1 = self.box
        wy0, wy1 = self.yr
        X = x1 - x0 + 1
        cx0, cx1 = max(x0, wx0), min(x1, wx1)
        blank = bytes([UNKNOWN]) * X
        padl, padr = bytes([UNKNOWN]) * max(0, cx0 - x0), bytes([UNKNOWN]) * max(0, x1 - cx1)
        rows = []
        for y in range(y0, y1 + 1):
            yin = wy0 <= y <= wy1
            by = (y - wy0) * self.nz
            for z in range(z0, z1 + 1):
                if not yin or not wz0 <= z <= wz1 or cx0 > cx1:
                    rows.append(blank)
                    continue
                seg = self._row((by + z - wz0) * self.nx + cx0 - wx0, cx1 - cx0 + 1)
                rows.append(padl + seg + padr if (padl or padr) else seg)
        out = b''.join(rows)
        if len(self._memo) > 12:
            self._memo.clear()
        self._memo[key] = out
        return out

    def class_at(self, x, y, z):
        """The class id of one cell (UNKNOWN outside the dump)."""
        if not (self.box[0] <= x <= self.box[2] and self.box[1] <= z <= self.box[3] and self.yr[0] <= y <= self.yr[1]):
            return UNKNOWN
        return self.lut[self.cells[((y - self.yr[0]) * self.nz + z - self.box[1]) * self.nx + x - self.box[0]]]

    def surface_top(self, x0, z0, x1, z1):
        """The highest ground cell (not air, leaves or a torch) over a region, or None."""
        B = self.block(x0, z0, x1, z1, self.yr[0], self.yr[1])
        layer = (x1 - x0 + 1) * (z1 - z0 + 1)
        top = -1
        for c in range(layer):
            top = max(top, B[c::layer].translate(M_GROUND).rfind(b'\x01'))
        return None if top < 0 else self.yr[0] + top


def synthetic_world(nx=96, nz=96, ny=70, y0=-10, seed=7):
    """A deterministic test world: deepslate under stone under dirt and grass, 10 levels of air on top, three tunnels,
    a cave, ores, torches, a ladder shaft, a chest. -> (World, facts). Used by the tests and `bench`."""
    pal = ['?', 'air', 'stone', 'deepslate', 'dirt', 'grass_block', 'coal_ore', 'deepslate_diamond_ore', 'torch',
           'ladder', 'chest', 'water', 'lava', 'cobblestone', 'oak_planks', 'iron_ore']
    P = {n: i for i, n in enumerate(pal)}
    layer = nx * nz
    ground = ny - 11                                         # index of the grass level
    cells = bytearray()
    for yi in range(ny):
        v = P['deepslate'] if yi < ny // 3 else P['stone'] if yi < ground - 3 else P['dirt'] if yi < ground else \
            P['grass_block'] if yi == ground else P['air']
        cells += bytes([v]) * layer

    def put(x, y, z, name):
        if 0 <= x < nx and 0 <= z < nz and 0 <= y < ny:
            cells[(y * nz + z) * nx + x] = P[name]
    s = seed
    for _ in range(nx * nz * ny // 150):                     # ores, anywhere in the rock
        s = (s * 1103515245 + 12345) & 0x7fffffff
        x, z, y = s % nx, (s >> 8) % nz, (s >> 16) % (ground - 3)
        put(x, y, z, 'deepslate_diamond_ore' if y < ny // 3 else ('coal_ore' if s & 1 else 'iron_ore'))
    zt, yt = nz // 2, ny // 2                                # the main tunnel: along x at z = nz/2, two high
    for x in range(8, nx - 8):
        for dy in (0, 1):
            put(x, yt + dy, zt, 'air')
        if x % 12 == 0:
            put(x, yt + 1, zt, 'torch')
    for z in range(zt, zt + 20):                             # a side branch along z
        for dy in (0, 1):
            put(nx // 3, yt + dy, z, 'air')
    for y in range(yt, ground + 1):                          # a ladder shaft up to the surface
        put(nx - 9, y, zt, 'ladder')
    for x in range(nx // 2 - 6, nx // 2 + 7):                # a cave lower down, with a pool
        for z in range(zt - 5, zt + 6):
            for y in range(8, 14):
                put(x, y, z, 'air')
            put(x, 7, z, 'water' if x < nx // 2 else 'stone')
    put(nx // 2 + 2, 8, zt, 'chest')
    put(nx // 2 + 4, 8, zt, 'torch')
    put(12, yt - 1, zt, 'cobblestone')
    put(13, yt - 1, zt, 'oak_planks')
    put(20, 3, zt, 'lava')
    w = World([0, 0, nx - 1, nz - 1], [y0, y0 + ny - 1], pal, bytes(cells), 8, f'synthetic-{nx}x{nz}x{ny}-{seed}')
    return w, {'tunnel_z': zt, 'tunnel_y': y0 + yt, 'ground_y': y0 + ground, 'cave_y': [y0 + 8, y0 + 13],
               'shaft_x': nx - 9, 'branch_x': nx // 3}


def synthetic_positions(facts, nx=96, t0=1794800000, minutes=60, bots=('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost')):
    """Six bots pacing the synthetic tunnel for an hour -> the load_positions() shape."""
    out = {}
    for i, b in enumerate(bots):
        rows = []
        for k in range(minutes * 6):
            ph = (k * 0.9 + i * 13) % (2 * (nx - 20))
            x = 10 + (ph if ph < nx - 20 else 2 * (nx - 20) - ph)
            rows.append((t0 + k * 10, x + 0.5, float(facts['tunnel_y']), facts['tunnel_z'] + 0.5 + (i % 3 - 1) * 9 * (i > 2),
                         ('mine', 'gather', 'explore')[i % 3]))
        out[b] = rows
    return out


# ================================================================ positions and scenes
def load_positions(obj):
    """posdump.json -> {bot: [(epoch_s, x, y, z, skill), ...]} sorted by time; a bot with no sample is left out."""
    out = {}
    for b, d in (obj.get('pos') or {}).items():
        rows = []
        for k, v in d.items():
            if len(v) < 3:
                continue
            t = dt.datetime.fromisoformat(k).replace(tzinfo=UTC).timestamp()
            rows.append((t, float(v[0]), float(v[1]), float(v[2]), str(v[3]) if len(v) > 3 else '?'))
        rows.sort()
        if rows:
            out[b] = rows
    return out


def last_time(pos):
    return max((r[-1][0] for r in pos.values()), default=None)


def window(rows, lo, hi):
    """The samples with lo < t <= hi."""
    return rows[bisect.bisect_right(rows, (lo, 1e99)):bisect.bisect_right(rows, (hi, 1e99))]


def skill_weight(skill):
    return SKILL_W.get(skill, SKILL_W_OTHER)


def densest_band(vw, share=0.7):
    """The shortest [lo, hi] that holds `share` of the weight. vw: [(value, weight)]. Pure (tested)."""
    vw = sorted(vw)
    total = sum(w for _, w in vw)
    if not vw or total <= 0:
        return None
    need, best, acc, i = total * share, None, 0.0, 0
    for v, w in vw:
        acc += w
        while acc - vw[i][1] >= need - 1e-9:
            acc -= vw[i][1]
            i += 1
        if acc >= need - 1e-9 and (best is None or v - vw[i][0] < best[1] - best[0]):
            best = (vw[i][0], v)
    return best


def _snap(v, step, up):
    return int(math.ceil(v / step) * step) if up else int(math.floor(v / step) * step)


def where_words(box, home=HOME):
    cx, cz = (box[0] + box[2]) / 2 - home[0], (box[1] + box[3]) / 2 - home[2]
    d = math.hypot(cx, cz)
    if d < 56 or (box[0] <= home[0] <= box[2] and box[1] <= home[2] <= box[3]):
        return 'under the town'
    return f'{int(round(d / 10) * 10)} blocks {WIND[compass(cx, cz)]} of the town'


def caption_for(nbots, skills, box, y, home=HOME):
    """'5 bots mining under the town, y 12 to 30'. skills: {skill: weight}. Pure (tested)."""
    grp = collections.Counter()
    for s, w in skills.items():
        grp['mining' if s in ('mine', 'deep_mine') else 'gathering' if s == 'gather' else
            'exploring caves' if s == 'explore' else 'moving'] += w
    verb = 'working'
    for v, _ in grp.most_common():
        if v != 'moving' or len(grp) == 1:
            verb = v if v != 'moving' else 'passing through'
            break
    who = 'no bots' if not nbots else '1 bot' if nbots == 1 else f'{nbots} bots'
    if not nbots:
        return f'{who} {where_words(box, home)} right now, y {y[0]} to {y[1]}'
    return f'{who} {verb} {where_words(box, home)}, y {y[0]} to {y[1]}'


def find_scenes(pos, n=3, hi=None, window_min=None, cell=CELL, span=4, under_y=UNDER_Y, bounds=None, min_minutes=3.0,
                home=HOME):
    """The busiest underground places. Samples below under_y are binned into cell x cell columns and scored in
    bot-minutes weighted by the skill in hand (SKILL_W: mining 3, gathering 2, exploring 1, the rest 0.5); the best
    span x span window of cells is a scene, and the next one may not overlap it. Its box is the tight (2-98%) extent
    of its samples, padded and snapped to 8; its y range is the densest band holding 70% of the weight.
    bounds [x0, z0, x1, z1] keeps scenes inside a dump. -> [{id, layer, box, y, caption, bots, score, bot_minutes,
    skills, auto}] best first. Pure (tested)."""
    hi = last_time(pos) if hi is None else hi
    if hi is None:
        return []
    lo = hi - window_min * 60 if window_min else -1e99
    S = []
    for b, rows in pos.items():
        for (t, x, y, z, sk) in window(rows, lo, hi):
            if y < under_y and (bounds is None or (bounds[0] <= x <= bounds[2] and bounds[1] <= z <= bounds[3])):
                S.append((int(x // cell), int(z // cell), x, y, z, skill_weight(sk) * SAMPLE_MIN, b, sk))
    grid = collections.Counter()
    for s in S:
        grid[(s[0], s[1])] += s[5]
    taken, scenes = [], []
    while len(scenes) < n:
        best = None
        for (cx, cz) in grid:
            for ox in range(cx - span + 1, cx + 1):
                for oz in range(cz - span + 1, cz + 1):
                    if any(ox < t[0] + span and t[0] < ox + span and oz < t[1] + span and t[1] < oz + span for t in taken):
                        continue
                    sc = sum(grid.get((ox + i, oz + j), 0.0) for i in range(span) for j in range(span))
                    cand = (-sc, ox, oz)
                    if best is None or cand < best:
                        best = cand
        if best is None or -best[0] <= 0:
            break
        ox, oz = best[1], best[2]
        taken.append((ox, oz))
        mem = [s for s in S if ox <= s[0] < ox + span and oz <= s[1] < oz + span]
        minutes = len(mem) * SAMPLE_MIN
        if minutes < min_minutes:
            continue
        wx0, wz0, wx1, wz1 = ox * cell, oz * cell, (ox + span) * cell - 1, (oz + span) * cell - 1
        xs, zs = sorted(s[2] for s in mem), sorted(s[4] for s in mem)
        q = lambda a, f: a[min(len(a) - 1, int(f * len(a)))]
        box = [max(wx0, _snap(q(xs, 0.02) - 6, 8, False)), max(wz0, _snap(q(zs, 0.02) - 6, 8, False)),
               min(wx1, _snap(q(xs, 0.98) + 6, 8, True) - 1), min(wz1, _snap(q(zs, 0.98) + 6, 8, True) - 1)]
        if bounds is not None:
            box = [max(box[0], bounds[0]), max(box[1], bounds[1]), min(box[2], bounds[2]), min(box[3], bounds[3])]
        band = densest_band([(s[3], s[5]) for s in mem]) or (0, 0)
        y = [_snap(band[0] - 3, 4, False), min(under_y, _snap(band[1] + 3, 4, True))]
        inb = [s for s in mem if y[0] - 4 <= s[3] <= y[1] + 4]
        skills = collections.Counter()
        for s in inb:
            skills[s[7]] += s[5]
        bots = sorted({s[6] for s in inb})
        tag = lambda v: ('m' if v < 0 else 'p') + str(abs(v))
        scenes.append({'id': f'under_x{tag(wx0)}_z{tag(wz0)}', 'layer': 'under', 'box': box, 'y': y,
                       'caption': caption_for(len(bots), skills, box, y, home), 'bots': bots,
                       'score': round(-best[0], 1), 'bot_minutes': round(minutes, 1),
                       'skills': {k: round(v, 1) for k, v in skills.most_common(6)}, 'auto': True})
    return scenes


def load_scenes(path):
    """The director's scenes-slot.json: a list of scenes, or {'scenes': [...]}. A scene needs id, box and y."""
    d = read_json(path)
    sc = d.get('scenes') if isinstance(d, dict) else d
    out = []
    for s in sc or []:
        if isinstance(s, dict) and s.get('id') and len(s.get('box') or []) == 4 and len(s.get('y') or []) == 2:
            out.append(dict(s, box=[int(v) for v in s['box']], y=[int(v) for v in s['y']]))
    return out


def scene_samples(pos, scene, lo, hi, pad_y=6):
    """[(x, y, z, weight, bot, skill, t)] of the samples inside a scene's box and near its y range."""
    x0, z0, x1, z1 = scene['box']
    y0, y1 = scene['y']
    out = []
    for b, rows in pos.items():
        for (t, x, y, z, sk) in window(rows, lo, hi):
            if x0 <= x <= x1 + 1 and z0 <= z <= z1 + 1 and y0 - pad_y <= y <= y1 + pad_y:
                out.append((x, y, z, skill_weight(sk), b, sk, t))
    return out


def choose_plane(samples, box, thick=SLAB):
    """Where to cut. samples: [(x, y, z, weight, ...)]. The picture's horizontal axis is the one the positions spread
    along most (weighted standard deviation; a tie is x); the slab is the `thick` blocks of the OTHER axis that hold
    the most weight (a tie goes to the middle of the box). No samples: the longer side of the box, through its
    middle. -> {axis, slab [d0, d1], spread {x, z}, share}. Pure (tested)."""
    x0, z0, x1, z1 = box
    W = sum(s[3] for s in samples)
    if W <= 0:
        axis = 'x' if (x1 - x0) >= (z1 - z0) else 'z'
        lo, hi = (z0, z1) if axis == 'x' else (x0, x1)
        d0 = max(lo, (lo + hi) // 2 - thick // 2)
        return {'axis': axis, 'slab': [d0, min(hi, d0 + thick - 1)], 'spread': {'x': 0.0, 'z': 0.0}, 'share': 0.0}
    mx, mz = sum(s[0] * s[3] for s in samples) / W, sum(s[2] * s[3] for s in samples) / W
    sx = math.sqrt(sum(s[3] * (s[0] - mx) ** 2 for s in samples) / W)
    sz = math.sqrt(sum(s[3] * (s[2] - mz) ** 2 for s in samples) / W)
    axis = 'x' if sx >= sz else 'z'
    lo, hi = (z0, z1) if axis == 'x' else (x0, x1)
    hist = collections.Counter()
    for s in samples:
        hist[int(math.floor(s[2] if axis == 'x' else s[0]))] += s[3]
    thick = max(1, min(thick, hi - lo + 1))
    mid = (lo + hi) / 2
    best = None
    for d0 in range(lo, hi - thick + 2):
        w = sum(hist.get(d, 0.0) for d in range(d0, d0 + thick))
        cand = (-round(w, 6), abs(d0 + (thick - 1) / 2 - mid), d0)
        if best is None or cand < best:
            best = cand
    return {'axis': axis, 'slab': [best[2], best[2] + thick - 1], 'spread': {'x': round(sx, 2), 'z': round(sz, 2)},
            'share': round(-best[0] / W, 3)}


# ================================================================ framing: where every block lands on the picture
def layout(W, H):
    """The fixed rectangles of a frame: title strip, picture area, panel (right on a wide frame, below on a square
    one), foot. u is the text unit (bitmap-font scale of body text)."""
    u = max(2, round(min(W, H) / 360))
    title_h = 7 * (u + 2) + 7 * u + 11 * u
    axis_w = 6 * u * 6 + 6 * u
    foot_h = 7 * u + 8 * u
    wide = W >= H * 1.3
    if wide:
        pw = round(W * 0.225)
        area = [axis_w, title_h + 2 * u, W - pw - 4 * u, H - foot_h]
        panel = [W - pw, title_h + 2 * u, W - 4 * u, H - 3 * u]
    else:
        ph = round(H * 0.24)
        area = [axis_w, title_h + 2 * u, W - 6 * u, H - ph - foot_h]
        panel = [4 * u, H - ph, W - 4 * u, H - 3 * u]
    return {'u': u, 'title_h': title_h, 'area': area, 'panel': panel, 'wide': wide, 'foot_h': foot_h}


def _fit(lo, hi, cap, wlo, whi):
    """Widen [lo, hi] to `cap` cells, evenly, inside the world's [wlo, whi]."""
    extra = cap - (hi - lo + 1)
    if extra <= 0:
        return lo, hi
    lo2 = max(wlo, lo - extra // 2)
    hi2 = min(whi, lo2 + cap - 1)
    lo2 = max(wlo, hi2 - cap + 1)
    return lo2, hi2


def frame_side(scene, plane, wbox, wy, surface_y, size, mode='open', ghost=False):
    """The side cut's framing: a pure function of the scene, the plane, the world's bounds and the surface height.
    y runs from 8 below the scene to 10 above the surface; the scale is the largest whole pixels-per-block that fits
    the scene box; the horizontal range is then widened to fill the picture. Pure (tested)."""
    W, H = size
    L = layout(W, H)
    ax0, ay0, ax1, ay1 = L['area']
    x0, z0, x1, z1 = scene['box']
    axis = plane['axis']
    (ua, ub), (da, db) = ((x0, x1), (z0, z1)) if axis == 'x' else ((z0, z1), (x0, x1))
    wu = (wbox[0], wbox[2]) if axis == 'x' else (wbox[1], wbox[3])
    wd = (wbox[1], wbox[3]) if axis == 'x' else (wbox[0], wbox[2])
    ua, ub = max(ua, wu[0]), min(ub, wu[1])
    da, db = max(da, wd[0]), min(db, wd[1])
    ylo = max(wy[0], _snap(scene['y'][0] - 8, 4, False))
    yhi = min(wy[1], _snap((surface_y if surface_y is not None else scene['y'][1]) + 10, 4, True))
    ppb = max(2, min((ax1 - ax0) // (ub - ua + 1), (ay1 - ay0) // (yhi - ylo + 1)))
    ua, ub = _fit(ua, ub, (ax1 - ax0) // ppb, wu[0], wu[1])
    ylo = _fit(ylo, yhi, (ay1 - ay0) // ppb, wy[0], yhi)[0]
    nu, ny = ub - ua + 1, yhi - ylo + 1
    slab = [max(da, plane['slab'][0]), min(db, plane['slab'][1])]
    return {'style': 'side', 'size': [W, H], 'axis': axis, 'look': 'north' if axis == 'x' else 'east',
            'slab': slab, 'depth': [da, db], 'u': [ua, ub], 'y': [ylo, yhi], 'scene_y': list(scene['y']),
            'ppb': ppb, 'origin': [ax0 + ((ax1 - ax0) - nu * ppb) // 2, ay0 + ((ay1 - ay0) - ny * ppb) // 2],
            'mode': mode, 'ghost': bool(ghost), 'box': list(scene['box'])}


def plan_band(samples, y, height=PLAN_BAND):
    """The levels the roof-off view shows: the scene's own y range, or, when that is taller than `height`, the
    `height` levels of it that hold the most weight (no samples: the top ones). samples: [(x, y, z, weight, ...)].
    Looking down through 50 levels shows a floor in every column and no tunnels. Pure (tested)."""
    y0, y1 = y
    if y1 - y0 + 1 <= height:
        return [y0, y1]
    hist = collections.Counter()
    for s in samples:
        hist[int(math.floor(s[1]))] += s[3]
    best = None
    for a in range(y1 - height + 1, y0 - 1, -1):
        w = sum(hist.get(v, 0.0) for v in range(a, a + height))
        if best is None or w > best[0] + 1e-9:
            best = (w, a)
    return [best[1], best[1] + height - 1]


def frame_plan(scene, wbox, wy, size, band=None):
    """The roof-off framing: cut one above the band's top (the scene's y range, or plan_band's part of it), look
    down to 6 below its bottom; north is up. Pure."""
    band = list(band or scene['y'])
    W, H = size
    L = layout(W, H)
    ax0, ay0, ax1, ay1 = L['area']
    x0, z0, x1, z1 = scene['box']
    x0, z0, x1, z1 = max(x0, wbox[0]), max(z0, wbox[1]), min(x1, wbox[2]), min(z1, wbox[3])
    ppb = max(2, min((ax1 - ax0) // (x1 - x0 + 1), (ay1 - ay0) // (z1 - z0 + 1)))
    x0, x1 = _fit(x0, x1, (ax1 - ax0) // ppb, wbox[0], wbox[2])
    z0, z1 = _fit(z0, z1, (ay1 - ay0) // ppb, wbox[1], wbox[3])
    nx, nz = x1 - x0 + 1, z1 - z0 + 1
    return {'style': 'plan', 'size': [W, H], 'x': [x0, x1], 'z': [z0, z1],
            'y': [max(wy[0], band[0] - 6), min(wy[1], band[1] + 1)], 'band': band, 'scene_y': list(scene['y']),
            'ppb': ppb, 'origin': [ax0 + ((ax1 - ax0) - nx * ppb) // 2, ay0 + ((ay1 - ay0) - nz * ppb) // 2],
            'box': list(scene['box'])}


def to_px(fr, x, y, z):
    """World (x, y, z) -> picture (px, py) floats. Pure (tested)."""
    k, (ox, oy) = fr['ppb'], fr['origin']
    if fr['style'] == 'side':
        u = x if fr['axis'] == 'x' else z
        return ox + (u - fr['u'][0]) * k, oy + (fr['y'][1] + 1 - y) * k
    return ox + (x - fr['x'][0]) * k, oy + (z - fr['z'][0]) * k


def pic_rect(fr):
    k, (ox, oy) = fr['ppb'], fr['origin']
    if fr['style'] == 'side':
        return ox, oy, ox + (fr['u'][1] - fr['u'][0] + 1) * k, oy + (fr['y'][1] - fr['y'][0] + 1) * k
    return ox, oy, ox + (fr['x'][1] - fr['x'][0] + 1) * k, oy + (fr['z'][1] - fr['z'][0] + 1) * k


def in_cut(fr, x, y, z, slack=1.5):
    """Is a bot inside what the picture shows solid: the slab of a side cut, the height band of a plan?"""
    if fr['style'] == 'side':
        d = z if fr['axis'] == 'x' else x
        return fr['slab'][0] - slack <= d <= fr['slab'][1] + 1 + slack
    return fr['y'][0] - slack <= y <= fr['y'][1] + 1 + slack


# ================================================================ block-resolution pictures (one value per block)
def _combine_open(tup):
    """One column through the slab, nearest first -> (class, open level 0-3). A thing standing in open space, a
    chest or lava always shows; then any open cell makes the column open (how open: the level); else the best solid."""
    n_air = n_sky = n_wat = 0
    best, bp = None, -1
    for c in tup:
        k = KIND[c]
        if k == 'a':
            n_air += 1
        elif k == 's':
            n_sky += 1
        else:
            if k == 'w':
                n_wat += 1
            if PRIO[c] > bp:
                bp, best = PRIO[c], c
    if best is not None and bp >= 7:
        return best, 0
    if n_air:
        if n_wat >= n_air:
            return WATER, 0
        f = n_air / (len(tup) - n_sky)
        return OPEN, 3 if f >= 0.66 else 2 if f >= 0.33 else 1
    if best is None:
        return SKY, 0
    return best, 0


def _combine_near(tup):
    """Nearest non-empty cell wins; open only where the whole slab is empty."""
    air = False
    for c in tup:
        k = KIND[c]
        if k == 'a':
            air = True
        elif k != 's':
            return c, 0
    return (OPEN, 3) if air else (SKY, 0)


def _light(n_cols, n_rows, sources):
    """A light level 0-4 per cell from [(col, row, strength, radius)]: no shadows, the brightest source wins."""
    L = [0.0] * (n_cols * n_rows)
    kern = {}
    for (c, r, s, R) in sources:
        if R not in kern:
            kern[R] = [(dx, dy, 1 - math.hypot(dx, dy) / R) for dy in range(-R, R + 1) for dx in range(-R, R + 1)
                       if math.hypot(dx, dy) < R]
        for dx, dy, f in kern[R]:
            x, y = c + dx, r + dy
            if 0 <= x < n_cols and 0 <= y < n_rows:
                i = y * n_cols + x
                v = s * f
                if v > L[i]:
                    L[i] = v
    return [int(v * 4 + 0.5) for v in L]


def _sources(cls, n_cols, n_rows):
    src = []
    lava = 0
    for i, c in enumerate(cls):
        if c == TORCH:
            src.append((i % n_cols, i // n_cols, 1.0, 7))
        elif c == LAVA:
            lava += 1
            if lava % 3 == 0 and lava < 1800:
                src.append((i % n_cols, i // n_cols, 0.6, 4))
        elif c == GLOW:
            src.append((i % n_cols, i // n_cols, 0.4, 3))
    return src


def side_grid(world, fr):
    """The side cut at one value per block. -> {nu, ny, cls, lvl, gh, light, floor, counts}: flat lists, row 0 = the
    TOP row, nu wide. cls is the class shown, lvl how open (0-3), gh how hollow the rest of the scene's depth is
    behind and in front (0-3), light 0-4 from torches, floor = rock with open space right above it."""
    axis = fr['axis']
    (ua, ub), (da, db), (ylo, yhi) = fr['u'], fr['depth'], fr['y']
    U, D, NY = ub - ua + 1, db - da + 1, yhi - ylo + 1
    if axis == 'x':
        B = world.block(ua, da, ub, db, ylo, yhi)
        planes = [bytearray(b''.join([B[(yi * D + di) * U:(yi * D + di + 1) * U] for yi in range(NY)])) for di in range(D)]
    else:
        B = world.block(da, ua, db, ub, ylo, yhi)
        planes = [bytearray(B[di::D]) for di in range(D)]
    for p in planes:                                          # air above the skyline becomes sky (leaves stay)
        for ui in range(U):
            top = p[ui::U].translate(M_GROUND).rfind(b'\x01')
            if top < NY - 1:
                o = ui + (top + 1) * U
                p[o::U] = p[o::U].translate(T_SKY)
    s0, s1 = fr['slab'][0] - da, fr['slab'][1] - da
    slab = planes[s0:s1 + 1]
    if axis == 'x':
        slab = slab[::-1]                                     # looking north: the highest z is nearest
    comb = _combine_open if fr.get('mode', 'open') == 'open' else _combine_near
    memo = {}
    cls, lvl = [0] * (U * NY), [0] * (U * NY)
    for yi in range(NY):
        o = yi * U
        r = (NY - 1 - yi) * U
        for ui, tup in enumerate(zip(*[p[o:o + U] for p in slab])):
            v = memo.get(tup)
            if v is None:
                v = memo[tup] = comb(tup)
            cls[r + ui], lvl[r + ui] = v
    # daylight: open cells within 8 steps sideways or up from sky (under an overhang or a floating block, not down
    # a tunnel) are drawn as shade, not as a cave: the land above ground is full of both
    front = [i for i in range(U * NY) if cls[i] == SKY]
    for _ in range(8):
        nxt = []
        for i in front:
            for j in ((i - 1) if i % U else -1, (i + 1) if (i + 1) % U else -1, i - U):
                if j >= 0 and cls[j] == OPEN and lvl[j] != 4:
                    lvl[j] = 4
                    nxt.append(j)
        front = nxt
    gh = [0] * (U * NY)
    if fr.get('ghost') and D - len(slab) > 0:
        rest = [p for i, p in enumerate(planes) if not s0 <= i <= s1][:250]
        acc = 0
        for p in rest:
            acc += int.from_bytes(p.translate(M_AIR), 'little')       # one byte per cell: a count, no carry below 256
        cnt = acc.to_bytes(U * NY, 'little')
        n = len(rest)
        for yi in range(NY):
            o, r = yi * U, (NY - 1 - yi) * U
            for ui in range(U):
                c = cnt[o + ui]
                if c:
                    f = c / n
                    gh[r + ui] = 3 if f >= 0.35 else 2 if f >= 0.15 else 1 if f >= 0.04 else 0
    light = _light(U, NY, _sources(cls, U, NY))
    floor = [False] * (U * NY)
    for i in range(U, U * NY):
        if cls[i] != OPEN and cls[i] != SKY and KIND[cls[i]] not in 'ao' and cls[i - U] in (OPEN, SKY):
            floor[i] = True
    return {'nu': U, 'ny': NY, 'cls': cls, 'lvl': lvl, 'gh': gh, 'light': light, 'floor': floor,
            'counts': collections.Counter(cls)}


def plan_grid(world, fr):
    """The roof-off view at one value per block. Per column: the highest empty cell at or under the cut, and the
    floor under it. -> {nx, nz, cls, kind, shade, light, counts}; kind 'f' floor, 'h' no opening (hatch), 'd' an
    opening with no floor in range (deep), 'q' flooded; shade 0 (at the cut) to 7 (deepest)."""
    (x0, x1), (z0, z1), (ylo, cut) = fr['x'], fr['z'], fr['y']
    X, Z, NY = x1 - x0 + 1, z1 - z0 + 1, cut - ylo + 1
    B = world.block(x0, z0, x1, z1, ylo, cut)
    layer = X * Z
    cls, kind, shade = [0] * layer, ['h'] * layer, [0] * layer
    src = []
    torch, ladder = bytes([TORCH]), bytes([LADDER])
    for c in range(layer):
        col = B[c::layer]
        m = col.translate(M_HOLLOW)
        t = m.rfind(b'\x01')
        if t < 0:
            w = col.rfind(bytes([WATER]))
            v = col.rfind(bytes([LAVA]))
            if max(w, v) >= 0:
                cls[c], kind[c], shade[c] = (WATER if w >= v else LAVA), 'q', min(7, (NY - 1 - max(w, v)) * 8 // NY)
            else:
                cls[c] = col[NY - 1]
            continue
        f = m.rfind(b'\x00', 0, t)
        if f < 0:
            kind[c], cls[c] = 'd', (LADDER if col.find(ladder, 0, t + 1) >= 0 else OPEN)
            continue
        k = col[f]
        cls[c], kind[c], shade[c] = k, 'f', min(7, (NY - 1 - f) * 8 // NY)
        if col.find(torch, f + 1, t + 1) >= 0:
            src.append((c % X, c // X, 1.0, 7))
            cls[c] = TORCH
        elif col.find(ladder, f + 1, t + 1) >= 0:
            cls[c] = LADDER
        elif k == LAVA:
            src.append((c % X, c // X, 0.6, 4))
    light = _light(X, Z, src[:1500])
    return {'nx': X, 'nz': Z, 'cls': cls, 'kind': kind, 'shade': shade, 'light': light,
            'counts': collections.Counter(c for c, k in zip(cls, kind) if k != 'h')}


# ================================================================ tiles: one block -> k x k pixels
def _mix(a, b, f):
    return tuple(int(a[i] + (b[i] - a[i]) * f + 0.5) for i in range(3))


def _mul(a, f):
    return tuple(max(0, min(255, int(v * f + 0.5))) for v in a)


def _pat(name, i, j, k):
    """Which colour (0 base, 1 fg, 2 fg2) pixel (i, j) of a k x k tile takes."""
    c, m = k // 2, max(1, k // 5)
    if name == 'flat':
        return 0
    if name == 'ore':
        if m <= i < k - m and m <= j < k - m:
            corner = (i in (m, k - m - 1)) and (j in (m, k - m - 1))
            edge = i in (m, k - m - 1) or j in (m, k - m - 1)
            return 0 if corner else 2 if edge else 1
        return 0
    if name == 'brick':
        return 1 if (j == k - 1 or j == c - 1 or (j < c - 1 and i == k // 3) or (c - 1 < j < k - 1 and i == (2 * k) // 3)) else 0
    if name == 'plank':
        return 1 if j in (c - 1, k - 1) else 0
    if name == 'log':
        return 1 if i in (k // 4, (3 * k) // 4) else 0
    if name == 'frame':
        return 1 if (i in (0, k - 1) or j in (0, k - 1)) else 0
    if name == 'chest':
        if i in (0, k - 1) or j in (0, k - 1) or j == c - 1:
            return 2
        return 1 if (abs(i - c) <= max(0, k // 8) and c - 1 < j <= c + max(1, k // 5)) else 0
    if name == 'furnace':
        if i in (0, k - 1) or j in (0, k - 1):
            return 2
        return 1 if (m < i < k - m - 1 and j >= c) and j < k - 2 else 0
    if name == 'table':
        return 2 if j < m else 1 if (i == c or j == c + m // 2 or i in (0, k - 1)) else 0
    if name == 'cage':
        return 1 if (i % 3 == 0 or j % 3 == 0) else 0
    if name == 'torch':
        d = max(abs(i - c), abs(j - c))
        r = max(1, k // 6)
        return 1 if d <= r else 2 if (d <= r + max(1, k // 8) or ((i == c or j == c) and d <= r + max(2, k // 4))) else 0
    if name == 'ladder':
        return 1 if (i in (m, k - m - 1) or (j % max(3, k // 3) == 1 and m <= i < k - m)) else 0
    if name == 'rail':
        return 1 if j == k - 2 else 2 if (j == k - 1 and i % 3 == 0) else 0
    if name == 'dots':
        return 1 if ((i * 5 + j * 3) % 7 == 0) else 0
    if name == 'speck':
        return 1 if ((i * 7 + j * 13 + (i * j) % 3) % 6 == 0) else 0
    if name == 'hatch':
        return 1 if (i + j) % k == k - 1 or (k >= 10 and (i + j) % k == c - 1) else 0
    if name == 'check':
        return 1 if ((2 * i) // k + (2 * j) // k) % 2 else 0
    return 0


class Tiles:
    """k x k pixel tiles per (class, variant), built once. A tile is k byte strings of k RGB pixels."""
    def __init__(self, k):
        self.k, self.c = k, {}

    def _build(self, pattern, base, fg, fg2, top):
        k = self.k
        cols = (bytes(base), bytes(fg or base), bytes(fg2 or fg or base))
        if pattern == 'flat' and not top:
            return [cols[0] * k] * k
        hi = bytes(_mix(base, (255, 255, 255), 0.38))
        nhi = max(1, k // 6) if top else 0
        rows, memo = [], {}
        for j in range(k):
            if j < nhi:
                rows.append(hi * k)
                continue
            key = tuple(_pat(pattern, i, j, k) for i in range(k))
            if key not in memo:
                memo[key] = b''.join(cols[v] for v in key)
            rows.append(memo[key])
        return rows

    def solid(self, cid, jit=1, light=0, ghost=0, top=False, shade=0, plan=False):
        """A block of class cid. jit 0-2 a little brightness noise, light 0-4 torch light, ghost 0-3 hollow behind
        (side cut), shade 0-7 depth (plan), top a lit top edge (a floor). plan: a floor seen from above: plain rock
        is pulled halfway to one neutral tone, so the tunnels read as a map and ores, water and built blocks stand out."""
        key = (cid, jit, light, ghost, top, shade, plan)
        t = self.c.get(key)
        if t is None:
            _, kind, _, _, jitter, pattern, base, fg, fg2 = _C[cid]

            def tone(c, is_base):
                if c is None:
                    return None
                if kind in 'aso':
                    if is_base:
                        c = OPEN_RGB[3]
                        if shade:
                            c = _mul(_mix((70, 64, 78), OPEN_RGB[3], 0.25), 1.0 - 0.07 * shade)
                        return _mix(c, LIGHT_OPEN, 0.17 * light)
                    return c
                if not is_base and pattern in ('ore', 'chest', 'furnace', 'torch'):
                    return c                                  # an ore keeps its colour in any light and at any depth
                if plan and kind == 'r':
                    c = _mix(c, PLAN_FLOOR, 0.55)
                if jitter and is_base and not plan:
                    c = _mul(c, (0.955, 1.0, 1.045)[jit])
                if ghost:
                    c = _mix(c, GHOST_RGB, (0, 0.2, 0.36, 0.5)[ghost])
                if shade:
                    c = _mul(c, 1.0 - 0.08 * shade)
                if light:
                    f = 0.5 if plan else 1.0
                    c = _mul(_mix(c, LIGHT_ROCK, 0.07 * light * f), 1.0 + 0.06 * light * f)
                return c
            t = self.c[key] = self._build(pattern, tone(base, True), tone(fg, False), tone(fg2, False), top)
        return t

    def open(self, lvl=3, light=0):
        key = ('open', lvl, light)
        t = self.c.get(key)
        if t is None:
            t = self.c[key] = [bytes(_mix(OPEN_RGB[lvl], LIGHT_OPEN, 0.17 * light)) * self.k] * self.k
        return t

    def sky(self, band):
        key = ('sky', band)
        t = self.c.get(key)
        if t is None:
            t = self.c[key] = [bytes(_mix((112, 164, 236), (190, 220, 246), min(1.0, band / 6.0))) * self.k] * self.k
        return t

    def hatch(self, cid):
        key = ('hatch', cid)
        t = self.c.get(key)
        if t is None:
            base = _C[cid][6] if KIND[cid] in 'rep' else (110, 110, 112)
            g = sum(base) / 3
            t = self.c[key] = self._build('hatch', _mul((g, g, g * 1.06), 0.2), _mul((g, g, g * 1.06), 0.36), None, False)
        return t

    def deep(self):
        key = ('deep',)
        if key not in self.c:
            self.c[key] = [bytes((4, 3, 8)) * self.k] * self.k
        return self.c[key]


def _jit(a, b):
    return ((a * 73856093) ^ (b * 19349663)) % 3


def side_rows(g, fr, tiles):
    """The side grid as pixel rows (bytes), top first."""
    U, NY, k = g['nu'], g['ny'], tiles.k
    cls, lvl, gh, light, floor = g['cls'], g['lvl'], g['gh'], g['light'], g['floor']
    ua, yhi = fr['u'][0], fr['y'][1]
    out = []
    for r in range(NY):
        o = r * U
        row = []
        y = yhi - r
        for ui in range(U):
            c = cls[o + ui]
            if c == OPEN:
                row.append(tiles.open(lvl[o + ui], light[o + ui]))
            elif c == SKY:
                row.append(tiles.sky(min(6, r // 3)))
            else:
                row.append(tiles.solid(c, _jit(ua + ui, y), light[o + ui], gh[o + ui], floor[o + ui]))
        for s in range(k):
            out.append(b''.join([t[s] for t in row]))
    return out


def plan_rows(g, fr, tiles):
    X, Z, k = g['nx'], g['nz'], tiles.k
    cls, kind, shade, light = g['cls'], g['kind'], g['shade'], g['light']
    out = []
    for zi in range(Z):
        o = zi * X
        row = []
        for xi in range(X):
            kd = kind[o + xi]
            if kd == 'h':
                row.append(tiles.hatch(cls[o + xi]))
            elif kd == 'd':
                row.append(tiles.deep() if cls[o + xi] == OPEN else tiles.solid(cls[o + xi], 1, 0, 0, False, 7, True))
            else:
                north = kind[o + xi - X] if zi else 'h'
                row.append(tiles.solid(cls[o + xi], 1, light[o + xi], 0, False,
                                       min(7, shade[o + xi] + (2 if north == 'h' else 0)), True))
        for s in range(k):
            out.append(b''.join([t[s] for t in row]))
    return out


# ================================================================ canvas, font, PNG
_FONT_HEX = ('0000000000' '00005F0000' '0007000700' '147F147F14' '242A7F2A12' '2313086462' '3649552250' '0005030000'
             '001C224100' '0041221C00' '14083E0814' '08083E0808' '0050300000' '0808080808' '0060600000' '2010080402'
             '3E5149453E' '00427F4000' '4261514946' '2141454B31' '1814127F10' '2745454539' '3C4A494930' '0171090503'
             '3649494936' '064949291E' '0036360000' '0056360000' '0814224100' '1414141414' '0041221408' '0201510906'
             '324979413E' '7E1111117E' '7F49494936' '3E41414122' '7F4141221C' '7F49494941' '7F09090901' '3E4149497A'
             '7F0808087F' '00417F4100' '2040413F01' '7F08142241' '7F40404040' '7F020C027F' '7F0408107F' '3E4141413E'
             '7F09090906' '3E4151215E' '7F09192946' '4649494931' '01017F0101' '3F4040403F' '1F2040201F' '3F4038403F'
             '6314081463' '0708700807' '6151494543' '007F414100' '0204081020' '0041417F00' '0402010204' '4040404040'
             '0001020400' '2054545478' '7F48444438' '3844444420' '384444487F' '3854545418' '087E090102' '0C5252523E'
             '7F08040478' '00447D4000' '2040443D00' '7F10284400' '00417F4000' '7C04180478' '7C08040478' '3844444438'
             '7C14141408' '081414187C' '7C08040408' '4854545420' '043F444020' '3C4040207C' '1C2040201C' '3C4030403C'
             '4428102844' '0C5050503C' '4464544C44' '0008364100' '00007F0000' '0041360800' '0804081008')


_DESC = {'g': (0x38, 0x144, 0x144, 0x144, 0xFC), 'p': (0x1FC, 0x44, 0x44, 0x44, 0x38), 'q': (0x38, 0x44, 0x44, 0x44, 0x1FC),
         'y': (0x3C, 0x140, 0x140, 0x140, 0xFC), 'j': (0, 0x100, 0x100, 0xFD, 0)}


def _glyph_runs():
    """The classic 5x7 column font (ASCII 32-126) as runs per glyph: [(row, first column, length)]."""
    out = {}
    for n in range(95):
        cols = bytes.fromhex(_FONT_HEX[n * 10:n * 10 + 10])
        runs = []
        for row in range(7):
            i = 0
            while i < 5:
                if cols[i] >> row & 1:
                    j = i
                    while j < 5 and cols[j] >> row & 1:
                        j += 1
                    runs.append((row, i, j - i))
                    i = j
                else:
                    i += 1
        out[chr(32 + n)] = runs
    for ch, cols in _DESC.items():                           # true descenders: rows 7 and 8 hang below the line
        out[ch] = [(row, i, 1) for row in range(9) for i in range(5) if cols[i] >> row & 1]
    return out


GLYPHS = _glyph_runs()


def text_w(s, scale):
    return max(0, len(s) * 6 * scale - scale)


class Canvas:
    """An RGB picture in a bytearray, with the few primitives the overlays need."""
    def __init__(self, W, H, rgb=(18, 18, 22), buf=None):
        self.W, self.H = W, H
        self.b = bytearray(buf) if buf is not None else bytearray(bytes(rgb) * (W * H))
        self.clip = (0, 0, W, H)

    def copy(self):
        return Canvas(self.W, self.H, buf=self.b)

    def rect(self, x0, y0, x1, y1, rgb):
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(self.W, int(x1)), min(self.H, int(y1))
        if x0 >= x1 or y0 >= y1:
            return
        row = bytes(rgb) * (x1 - x0)
        for y in range(y0, y1):
            o = (y * self.W + x0) * 3
            self.b[o:o + len(row)] = row

    def shade(self, x0, y0, x1, y1, rgb, a):
        """Blend a rectangle towards rgb by a/255 (per-channel translate: no per-pixel Python)."""
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(self.W, int(x1)), min(self.H, int(y1))
        if x0 >= x1 or y0 >= y1:
            return
        lut = [bytes((v * (255 - a) + c * a) // 255 for v in range(256)) for c in rgb]
        for y in range(y0, y1):
            o, e = (y * self.W + x0) * 3, (y * self.W + x1) * 3
            seg = self.b[o:e]
            for ch in range(3):
                seg[ch::3] = seg[ch::3].translate(lut[ch])
            self.b[o:e] = seg

    def blit(self, x, y, rows):
        for i, r in enumerate(rows):
            o = ((y + i) * self.W + x) * 3
            self.b[o:o + len(r)] = r

    def blend_px(self, acc, rgb):
        """acc: {y * W + x: alpha 0-255}: blend each pixel once (inside the clip)."""
        b, W = self.b, self.W
        cx0, cy0, cx1, cy1 = self.clip
        r, g, bl = rgb
        for p, a in acc.items():
            y, x = divmod(p, W)
            if cx0 <= x < cx1 and cy0 <= y < cy1:
                o = p * 3
                ia = 255 - a
                b[o] = (b[o] * ia + r * a) // 255
                b[o + 1] = (b[o + 1] * ia + g * a) // 255
                b[o + 2] = (b[o + 2] * ia + bl * a) // 255

    def line_acc(self, acc, x0, y0, x1, y1, a, w):
        """Add a w-wide line to acc (max alpha per pixel)."""
        W, H = self.W, self.H
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        h = w // 2
        last = None
        for i in range(n + 1):
            f = i / n
            x, y = int(x0 + (x1 - x0) * f), int(y0 + (y1 - y0) * f)
            if (x, y) == last:
                continue
            last = (x, y)
            for dy in range(-h, w - h):
                yy = y + dy
                if 0 <= yy < H:
                    for dx in range(-h, w - h):
                        xx = x + dx
                        if 0 <= xx < W:
                            p = yy * W + xx
                            if acc.get(p, 0) < a:
                                acc[p] = a

    def line(self, x0, y0, x1, y1, rgb, w=1, a=255):
        acc = {}
        self.line_acc(acc, x0, y0, x1, y1, a, w)
        self.blend_px(acc, rgb)

    def disk(self, cx, cy, r, rgb, a=255, hollow=0):
        acc = {}
        cx, cy = int(cx), int(cy)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                d2 = dx * dx + dy * dy
                if d2 <= r * r and (not hollow or d2 > (r - hollow) * (r - hollow)):
                    if 0 <= cx + dx < self.W and 0 <= cy + dy < self.H:
                        acc[(cy + dy) * self.W + cx + dx] = a
        self.blend_px(acc, rgb)

    def text(self, x, y, s, rgb=(255, 255, 255), scale=3, shadow=None):
        """Bitmap text, top-left at (x, y). shadow: an rgb drawn one scale-step down-right first."""
        if shadow is not None:
            self.text(x + max(1, scale // 2), y + max(1, scale // 2), s, shadow, scale)
        x, y = int(x), int(y)
        W, H, b = self.W, self.H, self.b
        col = bytes(rgb)
        for ch in s:
            for (row, c0, n) in GLYPHS.get(ch, GLYPHS['?']):
                xa, xb = x + c0 * scale, x + (c0 + n) * scale
                xa, xb = max(0, xa), min(W, xb)
                if xa >= xb:
                    continue
                run = col * (xb - xa)
                for yy in range(y + row * scale, y + (row + 1) * scale):
                    if 0 <= yy < H:
                        o = (yy * W + xa) * 3
                        b[o:o + len(run)] = run
            x += 6 * scale
        return x

    def label(self, x, y, s, rgb=(255, 255, 255), scale=3, bg=(0, 0, 0), a=170, pad=None):
        pad = scale * 2 if pad is None else pad
        self.shade(x - pad, y - pad, x + text_w(s, scale) + pad, y + 7 * scale + pad, bg, a)
        self.text(x, y, s, rgb, scale)

    def pixel(self, x, y):
        o = (y * self.W + x) * 3
        return tuple(self.b[o:o + 3])


def png_encode(W, H, rgb, level=6):
    """RGB bytes -> a PNG file's bytes. A row equal to the one above is written as an 'up' filter of zeros (free to
    detect, and block pictures repeat every row k times), every other row unfiltered."""
    stride = W * 3
    assert len(rgb) == stride * H, 'rgb is not W x H x 3'
    mv = memoryview(rgb)
    same = b'\x02' + bytes(stride)
    rows, prev = [], None
    for y in range(H):
        row = mv[y * stride:(y + 1) * stride]
        if prev is not None and row == prev:
            rows.append(same)
        else:
            rows.append(b'\x00')
            rows.append(row)
        prev = row

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), level)) + chunk(b'IEND', b''))


def png_decode(data):
    """The inverse, for the RGB 8-bit PNGs this module writes (filters 0, 1 and 2): -> (W, H, rgb bytes). Checks
    every chunk's CRC."""
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i, idat, W = 8, [], None
    while i < len(data):
        n = struct.unpack_from('>I', data, i)[0]
        t, d = data[i + 4:i + 8], data[i + 8:i + 8 + n]
        assert struct.unpack_from('>I', data, i + 8 + n)[0] == zlib.crc32(t + d) & 0xffffffff, 'bad CRC'
        if t == b'IHDR':
            W, H, depth, ctype = struct.unpack_from('>IIBB', d)
            assert (depth, ctype) == (8, 2), 'only 8-bit RGB'
        elif t == b'IDAT':
            idat.append(d)
        i += 12 + n
    raw = zlib.decompress(b''.join(idat))
    stride = W * 3
    out = bytearray()
    prev = bytes(stride)
    for y in range(H):
        o = y * (stride + 1)
        f, row = raw[o], raw[o + 1:o + 1 + stride]
        if f == 2:
            row = bytes((a + b) & 255 for a, b in zip(row, prev)) if any(row) else prev
        elif f == 1:
            r = bytearray(row)
            for j in range(3, stride):
                r[j] = (r[j] + r[j - 3]) & 255
            row = bytes(r)
        else:
            assert f == 0, f'filter {f} not handled'
        out += row
        prev = row
    return W, H, bytes(out)


# ================================================================ a frame
BG, INK, DIM, ACCENT = (18, 18, 22), (240, 240, 240), (160, 162, 170), (255, 208, 80)


def _nice_step(span_px_per_unit, min_px):
    for s in (2, 5, 10, 20, 50, 100):
        if s * span_px_per_unit >= min_px:
            return s
    return 200


def _legend_items(fr, counts, overlay):
    side = fr['style'] == 'side'
    has = lambda *names: any(counts.get(CID[n]) for n in names)
    ores = [n for n in ('coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald')
            if has('ore_' + n, 'dore_' + n)]
    it = []
    if side:
        it.append(([('open', 3)], 'open: tunnel or cave'))
        it.append(([('solid', 'stone'), ('solid', 'deepslate')], 'stone, deepslate'))
    else:
        it.append(([('hatch', 'stone')], 'solid rock'))
        it.append(([('shade', 0), ('shade', 3), ('shade', 6)], 'floor: darker is deeper'))
    if overlay:
        it.append(([('bot', True)], 'bot in this cut' if side else 'bot on these levels'))
        it.append(([('bot', False)], 'bot in front or behind' if side else 'bot above or below'))
        it.append(([('fresh', 0)], 'dug since the block scan'))
    if ores:
        it.append(([('solid', ('dore_' if not has('ore_' + n) else 'ore_') + n) for n in ores[:6]],
                   'ores' if len(ores) > 3 else ', '.join(ores)))
    liq = [n for n in ('water', 'lava') if has(n)]
    if liq:
        it.append(([('solid', n) for n in liq], ', '.join(liq)))
    if has('torch'):
        it.append(([('solid', 'torch')], 'torch and its light'))
    placed = [n for n in ('cobble', 'planks', 'stone_bricks', 'tuff_bricks', 'copper') if has(n)]
    if placed:
        it.append(([('solid', n) for n in placed[:3]], 'built: ' + ', '.join(
            {'cobble': 'cobble', 'planks': 'planks', 'stone_bricks': 'bricks', 'tuff_bricks': 'tuff bricks',
             'copper': 'copper'}[n] for n in placed[:2])))
    things = [n for n in ('ladder', 'chest', 'furnace', 'station') if has(n)]
    if things:
        it.append(([('solid', n) for n in things], ', '.join({'station': 'table'}.get(n, n) for n in things[:3])))
    if side:
        it.append(([('bar', 0)], 'the levels in the title'))
    return it


def _draw_legend(cv, rect, fr, counts, overlay, u):
    x0, y0, x1, y1 = rect
    ks = 7 * u + 2 * u
    tl = Tiles(ks)
    items = _legend_items(fr, counts, overlay)
    rh = ks + 2 * u
    col_w = max(1, x1 - x0)
    ncol = max(1, min(2, col_w // (ks * 3 + 6 * u * 20)))
    per = max(1, (y1 - y0) // rh)
    for i, (sw, lab) in enumerate(items[:per * ncol]):
        x, y = x0 + (i // per) * (col_w // ncol), y0 + (i % per) * rh
        for kind, v in sw:
            if kind == 'open':
                rows = tl.open(v, 0)
            elif kind == 'solid':
                rows = tl.solid(CID[v])
            elif kind == 'hatch':
                rows = tl.hatch(CID[v])
            elif kind == 'shade':
                rows = tl.solid(CID['stone'], 1, 0, 0, False, v, True)
            elif kind == 'fresh':
                cv.rect(x, y, x + ks, y + ks, FRESH_RGB)
                x += ks + u
                continue
            elif kind == 'bar':
                cv.rect(x + ks // 2 - u, y, x + ks // 2 + u, y + ks, ACCENT)
                x += ks + u
                continue
            else:
                rows = None
            if rows is None:
                cv.disk(x + ks // 2, y + ks // 2, ks // 2 - 1, (15, 15, 15))
                cv.disk(x + ks // 2, y + ks // 2, ks // 2 - 3, COLORS['Comet'], hollow=0 if v else max(2, u))
            else:
                cv.rect(x - 1, y - 1, x + ks + 1, y + ks + 1, (90, 90, 96))
                cv.blit(x, y, rows)
            x += ks + u
        cv.text(x + u, y + u, lab, INK, max(2, u - 1))


def background(world, fr, cache=None):
    """Everything that does not move between two slots of one world: the block picture, the axes, the scale bar, the
    legend. -> (Canvas, info). Cached in memory per (world, framing), and on disk when cache is a directory."""
    key = hashlib.sha1(json.dumps([VERSION, world.token, fr], sort_keys=True).encode()).hexdigest()[:20]
    W, H = fr['size']
    hit = _BG.get(key)
    if hit:
        return Canvas(W, H, buf=hit[0]), dict(hit[1], cache='memory')
    path = os.path.join(cache, f'under-{key}.bg') if cache else None
    if path and os.path.exists(path):
        try:
            with open(path, 'rb') as f:
                raw = f.read()
            n = struct.unpack_from('>I', raw)[0]
            info = json.loads(raw[4:4 + n])
            buf = zlib.decompress(raw[4 + n:])
            if len(buf) == W * H * 3:
                _BG[key] = (buf, info)
                return Canvas(W, H, buf=buf), dict(info, cache='disk')
        except (OSError, ValueError, zlib.error, struct.error):
            pass
    L = layout(W, H)
    u, k = L['u'], fr['ppb']
    cv = Canvas(W, H, BG)
    tiles = Tiles(k)
    side = fr['style'] == 'side'
    g = side_grid(world, fr) if side else plan_grid(world, fr)
    rows = side_rows(g, fr, tiles) if side else plan_rows(g, fr, tiles)
    px0, py0, px1, py1 = pic_rect(fr)
    cv.blit(px0, py0, rows)
    cv.rect(px0 - 2, py0 - 2, px1 + 2, py0, (70, 70, 78))
    cv.rect(px0 - 2, py1, px1 + 2, py1 + 2, (70, 70, 78))
    cv.rect(px0 - 2, py0, px0, py1, (70, 70, 78))
    cv.rect(px1, py0, px1 + 2, py1, (70, 70, 78))
    small = max(2, u - 1)
    if side:                                                      # the depth axis: y every step, the scene's band marked
        ylo, yhi = fr['y']
        step = _nice_step(k, 7 * u * 2.2)
        for y in range(_snap(ylo, step, True), yhi + 1, step):
            py = py0 + (yhi + 1 - y) * k
            cv.rect(px0 - 3 * u, py - 1, px0 - 2, py + 1, INK)
            cv.shade(px0, py, px1, py + 1, (255, 255, 255), 26)
            s = f'y {y}'
            cv.text(px0 - 4 * u - text_w(s, u), py - (7 * u) // 2, s, INK, u)
        sy0, sy1 = fr['scene_y']
        cv.rect(px0 - 2 * u, py0 + (yhi - min(sy1, yhi)) * k, px0 - 2, py0 + (yhi + 1 - max(sy0, ylo)) * k, ACCENT)
        a, b = ('west', 'east') if fr['axis'] == 'x' else ('north', 'south')
        cv.label(px0 + 3 * u, py0 + 3 * u, '< ' + a, INK, u, a=120)
        cv.label(px1 - 3 * u - text_w(b + ' >', u), py0 + 3 * u, b + ' >', INK, u, a=120)
        span = f"{fr['axis']} {fr['u'][0]} to {fr['u'][1]}"
    else:
        cv.label(px1 - 3 * u - text_w('N', u + 1), py0 + 3 * u, 'N', INK, u + 1, a=150)
        cx = px1 - 3 * u - text_w('N', u + 1) // 2
        for i in range(3 * u):
            cv.rect(cx - i // 2, py0 + 3 * u + 7 * (u + 1) + 2 * u + i, cx + i // 2 + 1, py0 + 3 * u + 7 * (u + 1) + 2 * u + i + 1, INK)
        step = _nice_step(k, 7 * u * 6)
        for z in range(_snap(fr['z'][0], step, True), fr['z'][1] + 1, step):
            py = py0 + (z - fr['z'][0]) * k
            cv.rect(px0 - 3 * u, py - 1, px0 - 2, py + 1, INK)
            s = f'z {z}'
            cv.text(px0 - 4 * u - text_w(s, u), py - (7 * u) // 2, s, INK, u)
        span = f"x {fr['x'][0]} to {fr['x'][1]}"
    n = max(s for s in (5, 8, 10, 16, 20, 32, 50, 64, 100) if s * k <= max(5 * k, (px1 - px0) * 0.3))   # the scale bar
    by = py1 + 3 * u
    for i in range(4):
        cv.rect(px0 + i * n * k // 4, by, px0 + (i + 1) * n * k // 4, by + 2 * u, INK if i % 2 == 0 else (110, 110, 118))
    cv.rect(px0, by - u, px0 + 2, by + 3 * u, INK)
    cv.rect(px0 + n * k - 2, by - u, px0 + n * k, by + 3 * u, INK)
    cv.text(px0 + n * k + 3 * u, by - u, f'{n} blocks', INK, u)
    cv.text(px1 - text_w(span, small), by, span, DIM, small)
    ax0, ay0, ax1, ay1 = L['panel']
    info = {'counts': {CLASSES[c]: v for c, v in g['counts'].most_common(40)}, 'cells': [len(g['cls'])],
            'tiles': len(tiles.c)}
    if L['wide']:
        info['legend'] = [ax0, ay0 + (ay1 - ay0) * 58 // 100, ax1, ay1]
        info['roster'] = [ax0, ay0, ax1, ay0 + (ay1 - ay0) * 56 // 100]
    else:
        info['legend'] = [ax0 + (ax1 - ax0) * 67 // 100, ay0, ax1, ay1]
        info['roster'] = [ax0, ay0, ax0 + (ax1 - ax0) * 65 // 100, ay1]
    _BG[key] = (bytes(cv.b), info)
    if len(_BG) > 8:
        _BG.pop(next(iter(_BG)))
    if path:
        os.makedirs(cache, exist_ok=True)
        head = json.dumps(info).encode()
        tmp = path + f'.tmp{os.getpid()}'
        with open(tmp, 'wb') as f:
            f.write(struct.pack('>I', len(head)) + head + zlib.compress(bytes(cv.b), 1))
        os.replace(tmp, path)
    return cv, dict(info, cache='built')


_BG = {}


def connected(a, b):
    """May two consecutive samples be joined by a line? tl2trails' limits (gap, speed, jump), with the height."""
    d = b[0] - a[0]
    hd = math.hypot(b[1] - a[1], b[3] - a[3])
    return d <= GAP_S and hd <= MAX_JUMP and abs(b[2] - a[2]) <= 2 * MAX_JUMP and hd / max(d, 0.05) <= MAX_V


def bots_now(pos, fr, t, margin=2.0):
    """The bots inside the picture at time t: {name: (x, y, z, skill, in_cut)}. A bot whose last sample is older than
    tl2trails.ONLINE is left out."""
    out = {}
    if fr['style'] == 'side':
        ua, ub = fr['u']
        da, db = fr['depth']
        ylo, yhi = fr['y']
    for b, rows in pos.items():
        j = bisect.bisect_right(rows, (t, 1e99)) - 1
        if j < 0 or t - rows[j][0] > ONLINE.total_seconds():
            continue
        _, x, y, z, sk = rows[j]
        if fr['style'] == 'side':
            uu, d = (x, z) if fr['axis'] == 'x' else (z, x)
            if not (ua - margin <= uu <= ub + 1 + margin and da - margin <= d <= db + 1 + margin and ylo <= y <= yhi + 1):
                continue
        elif not (fr['x'][0] <= x <= fr['x'][1] + 1 and fr['z'][0] <= z <= fr['z'][1] + 1 and y <= fr['y'][1] + 8):
            continue
        out[b] = (x, y, z, sk, in_cut(fr, x, y, z))
    return out


def fresh_cells(world, pos, fr, t, under_y=UNDER_Y):
    """The cells a bot has stood in (feet and head) up to time t that the block snapshot shows as rock or ore, inside
    what the picture cuts: they were dug after the snapshot was taken. A bot's own positions are the only record of
    digging there is between two snapshots. -> {(x, y, z)}. Pure (tested)."""
    out = set()
    for rows in pos.values():
        for (_, x, y, z, _) in rows[:bisect.bisect_right(rows, (t, 1e99))]:
            if y >= under_y or not in_cut(fr, x, y, z, 0.0):
                continue
            c = (int(math.floor(x)), int(math.floor(y + 0.01)), int(math.floor(z)))
            for cell in (c, (c[0], c[1] + 1, c[2])):
                if cell not in out and KIND[world.class_at(*cell)] in 're':
                    out.add(cell)
    return out


def draw_fresh(cv, fr, cells):
    k = fr['ppb']
    x0, y0, x1, y1 = pic_rect(fr)
    seen = set()
    for (x, y, z) in cells:
        px, py = to_px(fr, x, y + 1, z)
        px, py = int(px), int(py)
        if (px, py) in seen or not (x0 <= px < x1 and y0 <= py < y1):
            continue
        seen.add((px, py))
        cv.rect(px, py, px + k, py + k, FRESH_RGB)
    return len(seen)


def _dark(rgb):
    return sum(rgb) < 150


def draw_trails(cv, pos, fr, t, trail_min):
    """Each bot's path over the last trail_min minutes: newest brightest; full strength inside the cut, thin and
    faint in front of or behind it."""
    lo = t - trail_min * 60
    u = layout(*fr['size'])['u']
    cv.clip = pic_rect(fr)
    n = 0
    da, db = fr['depth'] if fr['style'] == 'side' else (None, None)
    for b in sorted(pos):
        rows = window(pos[b], lo, t)
        col = COLORS.get(b, (255, 255, 255))
        acc, halo = {}, {}
        for i in range(1, len(rows)):
            p, q = rows[i - 1], rows[i]
            if not connected(p, q):
                continue
            if fr['style'] == 'side':
                d0, d1 = (p[3], q[3]) if fr['axis'] == 'x' else (p[1], q[1])
                if not (da - 2 <= d0 <= db + 3 and da - 2 <= d1 <= db + 3):
                    continue
            elif min(p[2], q[2]) > fr['y'][1] + 8:
                continue
            x0, y0 = to_px(fr, p[1], p[2] + 0.9, p[3])
            x1, y1 = to_px(fr, q[1], q[2] + 0.9, q[3])
            if max(x0, x1) < cv.clip[0] or min(x0, x1) > cv.clip[2] or max(y0, y1) < cv.clip[1] or min(y0, y1) > cv.clip[3]:
                continue
            age = (t - q[0]) / (trail_min * 60.0)
            inside = in_cut(fr, q[1], q[2], q[3])
            a = int(255 * (0.22 + 0.78 * (1 - age)) * (1.0 if inside else 0.6))
            w = (u + 1 if age < 0.3 else u) if inside else max(1, u - 1)
            cv.line_acc(acc, x0, y0, x1, y1, a, w)
            if _dark(col):
                cv.line_acc(halo, x0, y0, x1, y1, a, w + 2)
            n += 1
        if halo:
            cv.blend_px(halo, (235, 235, 235))
        cv.blend_px(acc, col)
    cv.clip = (0, 0, cv.W, cv.H)
    return n


def _place_labels(items, rect, taken):
    """Greedy label placement: for each (cx, cy, w, h) try spots around the marker, nearest first, and take the first
    that stays in rect and overlaps nothing placed yet. -> [(x, y)] top-left corners."""
    x0, y0, x1, y1 = rect
    out = []
    for (cx, cy, w, h, r) in items:
        best = None
        for ring in range(0, 9):
            g = r + 4 + ring * (h // 2 + 3)
            for (dx, dy) in ((g, -h // 2), (-g - w, -h // 2), (-w // 2, -g - h), (-w // 2, g), (g, -g - h), (-g - w, -g - h),
                             (g, g), (-g - w, g)):
                x, y = int(cx + dx), int(cy + dy)
                if x < x0 or y < y0 or x + w > x1 or y + h > y1:
                    continue
                if any(x < t[2] and t[0] < x + w and y < t[3] and t[1] < y + h for t in taken):
                    continue
                best = (x, y)
                break
            if best:
                break
        if best is None:
            best = (int(min(max(cx + r + 4, x0), x1 - w)), int(min(max(cy - h // 2, y0), y1 - h)))
        taken.append((best[0] - 2, best[1] - 2, best[0] + w + 2, best[1] + h + 2))
        out.append(best)
    return out


def draw_bots(cv, fr, now):
    """Markers and labels. A bot inside the cut is a full disc; one in front of or behind it is a ring."""
    u = layout(*fr['size'])['u']
    rect = pic_rect(fr)
    r = 3 * u
    small = max(2, u - 1)
    items, meta = [], []
    taken = []
    for b in sorted(now):
        x, y, z, sk, inside = now[b]
        px, py = to_px(fr, x, y + 0.9, z)
        px, py = min(max(px, rect[0] + r), rect[2] - r), min(max(py, rect[1] + r), rect[3] - r)
        verb = VERB.get(sk, sk.replace('_', ' '))
        w = max(text_w(b, u), text_w(verb, small)) + 4 * u
        h = 7 * u + 7 * small + 5 * u
        items.append((px, py, w, h, r))
        meta.append((b, verb, px, py, inside))
        taken.append((px - r - 2, py - r - 2, px + r + 2, py + r + 2))
    spots = _place_labels(items, rect, taken)
    for (b, verb, px, py, inside), (lx, ly), (_, _, w, h, _) in zip(meta, spots, items):
        cv.line(px, py, min(max(px, lx), lx + w), min(max(py, ly), ly + h), (235, 235, 235), 1, 170)
    for (b, verb, px, py, inside), (lx, ly), (_, _, w, h, _) in zip(meta, spots, items):
        col = COLORS.get(b, (255, 255, 255))
        ring = (235, 235, 235) if _dark(col) else (12, 12, 14)
        cv.disk(px, py, r + max(2, u - 1), ring)
        if inside:
            cv.disk(px, py, r, col)
        else:
            cv.disk(px, py, r, (40, 38, 46))
            cv.disk(px, py, r, col, hollow=max(2, u))
        cv.shade(lx, ly, lx + w, ly + h, (0, 0, 0), 190)
        cv.rect(lx, ly, lx + max(2, u), ly + h, (235, 235, 235) if _dark(col) else col)
        cv.text(lx + 3 * u, ly + 2 * u, b, (240, 240, 240) if _dark(col) else col, u)
        cv.text(lx + 3 * u, ly + 2 * u + 7 * u + u, verb, INK, small)


def draw_roster(cv, rect, now, fr, u):
    x0, y0, x1, y1 = rect
    small = max(2, u - 1)
    cv.text(x0, y0, 'WHO IS HERE', DIM, small)
    rh = 7 * u + 3 * u
    y = y0 + 7 * small + 3 * u
    per = max(1, (y1 - y) // rh)
    need = 8 * u + 6 * u * 6 + 2 * u + 6 * small * 19        # chip, a 6-letter name, 'heading home  y -12'
    ncol = max(1, min((x1 - x0) // need, -(-len(now) // per)))
    cw = (x1 - x0) // ncol
    names = sorted(now)
    if len(names) > per * ncol:                              # more bots than rows: say so instead of overlapping
        names = names[:per * ncol - 1]
        cv.text(x0 + (ncol - 1) * cw + 8 * u, y + (per - 1) * rh, f'+ {len(now) - len(names)} more', DIM, u)
    for i, b in enumerate(names):
        bx, by = x0 + (i // per) * cw, y + (i % per) * rh
        _, yy, _, sk, inside = now[b]
        col = COLORS.get(b, (255, 255, 255))
        cv.disk(bx + 3 * u, by + 3 * u + u // 2, 3 * u, (235, 235, 235) if _dark(col) else (12, 12, 14))
        cv.disk(bx + 3 * u, by + 3 * u + u // 2, 3 * u - 2, col, hollow=0 if inside else max(2, u))
        nx = cv.text(bx + 8 * u, by, b, INK, u)
        s = f"{VERB.get(sk, sk.replace('_', ' '))}  y {int(math.floor(yy))}"
        cv.text(max(nx + 2 * u, bx + 8 * u + 6 * u * 6), by + (7 * u - 7 * small), s, DIM, small)
    if not now:
        cv.text(x0, y, 'no bot in this picture', DIM, small)
        cv.text(x0, y + 7 * small + 2 * u, 'at this moment', DIM, small)


def frame_caption(pos, scene, now, t, trail_min, under_y=UNDER_Y):
    """A caption for one frame from the positions themselves (the built-in finder's scenes): the bots that are
    underground in the picture NOW (so the count matches the roster), and what their last trail_min minutes in
    the scene went on."""
    who = {b for b, v in now.items() if v[1] < under_y}
    skills = collections.Counter()
    x0, z0, x1, z1 = scene['box']
    for b in who:
        for (_, x, y, z, sk) in window(pos[b], t - trail_min * 60, t):
            if y < under_y and x0 - 8 <= x <= x1 + 9 and z0 - 8 <= z <= z1 + 9:
                skills[sk] += skill_weight(sk)
    return caption_for(len(who), skills, scene['box'], scene['y'])


def make_framing(world, pos, scene, style, size, t=None, thick=SLAB, mode='open', plane_min=360, ghost=False):
    """A scene's framing for a style, from scratch. The plane is chosen from the newest plane_min minutes of
    positions there are (not from the frame's own time: two frames of one scene made from one position file get one
    cut); after that the framing is DATA: keep it (the sidecar carries it) and pass it back to render()."""
    base = 'plan' if style in ('plan', 'plantrails') else 'side'
    t = last_time(pos)
    S = scene_samples(pos, scene, (t or 0) - plane_min * 60, t or 0) if t is not None else []
    if base == 'plan':
        return frame_plan(scene, world.box, world.yr, size, plan_band(S, scene['y']))
    plane = choose_plane(S, scene['box'], thick)
    x0, z0, x1, z1 = scene['box']
    d0, d1 = plane['slab']
    reg = (x0, d0, x1, d1) if plane['axis'] == 'x' else (d0, z0, d1, z1)
    reg = (max(reg[0], world.box[0]), max(reg[1], world.box[1]), min(reg[2], world.box[2]), min(reg[3], world.box[3]))
    fr = frame_side(scene, plane, world.box, world.yr, world.surface_top(*reg), size, mode, ghost)
    fr['plane_share'] = plane['share']
    return fr


def render(world, pos, scene, style, t, size=(1920, 1080), framing=None, trail_min=45, cache=None, thick=SLAB, mode='open',
           ghost=False):
    """One frame. style: side | plan | trails | plantrails. -> (Canvas, sidecar dict). Pass the framing of the
    scene's earlier frame to keep the picture still between slots."""
    t0 = time.time()
    overlay = style in ('trails', 'plantrails')
    fr = framing or make_framing(world, pos, scene, style, size, t, thick, mode, ghost=ghost)
    W, H = fr['size']
    L = layout(W, H)
    u = L['u']
    cv, info = background(world, fr, cache)
    t_bg = time.time() - t0
    side = fr['style'] == 'side'
    now = bots_now(pos, fr, t)
    cap = scene.get('caption') if not scene.get('auto') else None
    cap = cap or frame_caption(pos, scene, now, t, trail_min)
    when = dt.datetime.fromtimestamp(t, UTC)
    stamp = f'{when:%d %b %Y  %H:%M} UTC' if L['wide'] else f'{when:%d %b %H:%M} UTC'
    ss = u + 1 if L['wide'] else u
    big = u + 2
    while big > 2 and text_w(cap, big) > W - text_w(stamp, ss) - 16 * u:
        big -= 1
    cv.rect(0, 0, W, L['title_h'], (10, 10, 13))
    cv.text(5 * u, 4 * u + (7 * (u + 2) - 7 * big) // 2, cap, INK, big)
    cv.text(W - 5 * u - text_w(stamp, ss), 4 * u + (7 * (u + 2) - 7 * ss) // 2, stamp, ACCENT, ss)
    if side:
        parts = [f"Side cut looking {fr['look']}, {fr['slab'][1] - fr['slab'][0] + 1} blocks thick "
                 f"({'z' if fr['axis'] == 'x' else 'x'} {fr['slab'][0]} to {fr['slab'][1]}).", 'Dark is open space.']
    else:
        parts = [f"Roof off: everything above y {fr['band'][1]} removed, looking down to y {fr['band'][0]}.",
                 'Hatched is solid rock.']
    if overlay:
        parts.insert(1, f'Lines: each bot, last {trail_min} min.')
    small = max(2, u - 1)
    while len(parts) > 1 and text_w(' '.join(parts), small) > W - 10 * u:      # the least needed sentence goes first
        parts.pop()
    sub = ' '.join(parts)
    if text_w(sub, u) <= W - 10 * u and u <= big:
        small = u
    cv.text(5 * u, 4 * u + 7 * (u + 2) + 4 * u, sub, DIM, small)
    nfresh = 0
    if overlay:
        nfresh = draw_fresh(cv, fr, fresh_cells(world, pos, fr, t))
        ntr = draw_trails(cv, pos, fr, t, trail_min)
        draw_bots(cv, fr, now)
        draw_roster(cv, info['roster'], now, fr, u)
        _draw_legend(cv, info['legend'], fr, {CID[k]: v for k, v in info['counts'].items()}, True, u)
    else:
        ntr, now = 0, {}
        ax0, ay0, ax1, ay1 = L['panel']
        _draw_legend(cv, [ax0, ay0, ax1, ay1], fr, {CID[k]: v for k, v in info['counts'].items()}, False, u)
    side_car = {'label': cap, 'project': None, 'style': style, 'scene': {k: scene[k] for k in ('id', 'box', 'y') if k in scene},
                'stamp': stamp_of(when), 'time': when.isoformat(), 'framing': fr, 'trail_min': trail_min if overlay else None,
                'bots': {b: {'x': v[0], 'y': v[1], 'z': v[2], 'skill': v[3], 'in_cut': v[4]} for b, v in sorted(now.items())},
                'trail_segments': ntr, 'fresh_cells': nfresh, 'world': world.token, 'background': info.get('cache'),
                'render_s': {'background': round(t_bg, 3), 'total': round(time.time() - t0, 3)}, 'version': VERSION}
    return cv, side_car


def write_frame(cv, side_car, png_path, level=6):
    t0 = time.time()
    os.makedirs(os.path.dirname(os.path.abspath(png_path)), exist_ok=True)
    data = png_encode(cv.W, cv.H, cv.b, level)
    tmp = png_path + f'.tmp{os.getpid()}'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, png_path)
    side_car['render_s']['png'] = round(time.time() - t0, 3)
    side_car['bytes'] = len(data)
    with open(png_path[:-4] + '.json', 'w') as f:
        json.dump(side_car, f, indent=1)
    return len(data)


# ================================================================ CLI
def camera_name(scene, style):
    """frames/<camera>/...: letters, digits and '_' only (tl_showcase's camera names carry no '-')."""
    return re.sub(r'[^A-Za-z0-9_]', '_', f"{scene['id']}_{style}")


def kept_framing(root, camera, scene, size, style):
    """The framing this camera used last, if it is still for this scene box, y range, size and look."""
    try:
        fr = read_json(os.path.join(root, 'under-framing', camera + '.json'))
    except (OSError, ValueError):
        return None
    ok = (fr.get('box') == list(scene['box']) and fr.get('scene_y') == list(scene['y']) and fr.get('size') == list(size)
          and fr.get('version') == VERSION)
    return {k: v for k, v in fr.items() if k != 'version'} if ok else None


def keep_framing(root, camera, fr):
    d = os.path.join(root, 'under-framing')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, camera + '.json'), 'w') as f:
        json.dump(dict(fr, version=VERSION), f, indent=1)


def busiest_slot(pos, scene, trail_min, slot_min=15):
    """The slot (a multiple of slot_min) whose trail window holds the most weighted samples of the scene."""
    hi = last_time(pos)
    lo = min(r[0][0] for r in pos.values())
    best = None
    t = math.floor(hi / (slot_min * 60)) * slot_min * 60
    while t - trail_min * 60 >= lo - 1:
        w = sum(s[3] for s in scene_samples(pos, scene, t - trail_min * 60, t))
        if best is None or w > best[0]:
            best = (w, t)
        t -= slot_min * 60
    return best[1] if best else hi


def _when(arg, pos, scene, trail_min):
    if arg == 'latest':
        return math.floor(last_time(pos) / 300) * 300
    if arg == 'busiest':
        return busiest_slot(pos, scene, trail_min)
    p = parse_stamp(arg)
    return (p or dt.datetime.fromisoformat(arg).replace(tzinfo=UTC)).timestamp()


def _inputs(a):
    world = World.from_dump(a.dump)
    pos = load_positions(read_json(a.pos))
    if a.scenes:
        scenes = load_scenes(a.scenes)
        if a.layer:
            kept = [s for s in scenes if s.get('layer') == a.layer]
            print(f'--layer {a.layer}: {len(kept)} of {len(scenes)} scenes', file=sys.stderr)
            scenes = kept
    else:
        scenes = find_scenes(pos, n=a.auto, bounds=world.box, window_min=a.window_min)
    return world, pos, scenes


def cmd_frame(a):
    world, pos, scenes = _inputs(a)
    size = tuple(int(v) for v in a.size.split('x'))
    styles = ['side', 'plan', 'trails'] if a.style == 'all' else a.style.split(',')
    rows = []
    for n, sc in enumerate(scenes):
        t = _when(a.at, pos, sc, a.trail_min)
        for st in styles:
            cam = camera_name(sc, st)
            fr = kept_framing(a.root, cam, sc, size, st) if a.root else None
            cv, sd = render(world, pos, sc, st, t, size, fr, a.trail_min, a.cache, a.slab, a.mode, a.ghost)
            sd['camera'] = cam
            sd['framing_kept'] = fr is not None
            p = frame_path(a.root, cam, sd['stamp']) if a.root else os.path.join(a.out, f'scene{n + 1}-{st}{a.tag}.png')
            if a.root and fr is None:
                keep_framing(a.root, cam, sd['framing'])
            write_frame(cv, sd, p)
            rows.append({'png': p, 'caption': sd['label'], 'render_s': sd['render_s'], 'bytes': sd['bytes'],
                         'bots': len(sd['bots']), 'ppb': sd['framing']['ppb']})
            print(json.dumps(rows[-1]))
    return rows


def cmd_seq(a):
    world, pos, scenes = _inputs(a)
    size = tuple(int(v) for v in a.size.split('x'))
    sc = scenes[a.pick]
    t1 = _when(a.at, pos, sc, a.trail_min)
    fr = None
    for i in range(a.frames):
        t = t1 - (a.frames - 1 - i) * a.step_min * 60
        cv, sd = render(world, pos, sc, a.style, t, size, fr, a.trail_min, a.cache, a.slab, a.mode, a.ghost)
        fr = sd['framing']
        p = os.path.join(a.out, f"seq-scene{a.pick + 1}-{a.style}-{i + 1:02d}-{sd['stamp']}.png")
        write_frame(cv, sd, p)
        print(json.dumps({'png': p, 'caption': sd['label'], 'render_s': sd['render_s'], 'bots': len(sd['bots'])}))


def cmd_scenes(a):
    pos = load_positions(read_json(a.pos))
    bounds = read_json(a.dump)['box'] if a.dump else None
    print(json.dumps({'scenes': find_scenes(pos, n=a.n, bounds=bounds, window_min=a.window_min)}, indent=1))


def cmd_palette(a):
    d = read_json(a.dump)
    buf = base64.b64decode(d['cells'])
    if d.get('bits', 8) == 8:
        n = collections.Counter(buf)
    else:
        n = collections.Counter(struct.unpack('<%dH' % (len(buf) // 2), buf))
    by = collections.defaultdict(list)
    for i, name in enumerate(d['palette']):
        by[classify(name)].append((n.get(i, 0), name))
    total = sum(n.values())
    for c in CLASSES:
        if by.get(c):
            cells = sum(k for k, _ in by[c])
            print(f"{c:14s} {cells:10d} {100 * cells / total:6.2f}%  " + ', '.join(f'{nm}' for _, nm in sorted(by[c], reverse=True)[:12]))
    print(f'total cells {total}, names {len(d["palette"])}; read the `other` and `built` lines: those are guesses')


def bench(size=(1920, 1080), repeat=3, nx=96, nz=96, ny=70):
    """Seconds per frame per style on the synthetic box: cold (nothing cached), warm (same process, background kept),
    and the PNG encode. -> {style: {cold, warm, png}}."""
    world, facts = synthetic_world(nx, nz, ny)
    pos = synthetic_positions(facts, nx)
    t = last_time(pos)
    scene = {'id': 'bench', 'box': world.box, 'y': [world.yr[0] + 4, facts['ground_y'] - 6], 'auto': True}
    out = {}
    for st in ('side', 'plan', 'trails'):
        cold, warm, png = [], [], []
        for _ in range(repeat):
            _BG.clear()
            world._memo.clear()
            t0 = time.time()
            cv, sd = render(world, pos, scene, st, t, size)
            cold.append(time.time() - t0)
            t0 = time.time()
            data = png_encode(cv.W, cv.H, cv.b)
            png.append(time.time() - t0)
            t0 = time.time()
            render(world, pos, scene, st, t - 300, size, sd['framing'])
            warm.append(time.time() - t0)
        out[st] = {'cold_s': round(min(cold), 3), 'warm_s': round(min(warm), 3), 'png_s': round(min(png), 3),
                   'png_bytes': len(data), 'ppb': sd['framing']['ppb']}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)

    def common(p):
        p.add_argument('--dump', required=True)
        p.add_argument('--pos', required=True)
        p.add_argument('--scenes', help="the director's scenes-slot.json")
        p.add_argument('--layer', help="with --scenes: only the scenes of this layer (default: every scene in the file)")
        p.add_argument('--auto', type=int, default=3, help='without --scenes: the N busiest scenes of the built-in finder')
        p.add_argument('--window-min', type=int, default=None, help='the built-in finder looks this far back (default: all)')
        p.add_argument('--size', default='1920x1080')
        p.add_argument('--at', default='latest', help='latest | busiest | 20261116T1245Z | ISO time')
        p.add_argument('--trail-min', type=int, default=45)
        p.add_argument('--out', default='.')
        p.add_argument('--root', help='write frames/<camera>/<day>/<stamp>.png under this root and keep the framing there')
        p.add_argument('--cache', help='a directory for rendered backgrounds')
        p.add_argument('--mode', default='open', choices=('open', 'near'))
        p.add_argument('--slab', type=int, default=SLAB)
        p.add_argument('--ghost', action='store_true', help='side cut: darken rock that is hollow elsewhere in the scene depth')
        p.add_argument('--tag', default='', help='with --out: a suffix for the file names')
    p = sub.add_parser('frame'); common(p); p.add_argument('--style', default='all')
    p = sub.add_parser('seq'); common(p); p.add_argument('--style', default='trails')
    p.add_argument('--frames', type=int, default=12); p.add_argument('--step-min', type=int, default=5)
    p.add_argument('--pick', type=int, default=0)
    p = sub.add_parser('scenes'); p.add_argument('--pos', required=True); p.add_argument('--dump')
    p.add_argument('--n', type=int, default=3); p.add_argument('--window-min', type=int, default=None)
    p = sub.add_parser('palette'); p.add_argument('--dump', required=True)
    p = sub.add_parser('bench'); p.add_argument('--size', default='1920x1080')
    p = sub.add_parser('video'); p.add_argument('glob'); p.add_argument('out'); p.add_argument('--fps', type=float, default=4)
    a = ap.parse_args(argv)
    if a.cmd == 'frame':
        cmd_frame(a)
    elif a.cmd == 'seq':
        cmd_seq(a)
    elif a.cmd == 'scenes':
        cmd_scenes(a)
    elif a.cmd == 'palette':
        cmd_palette(a)
    elif a.cmd == 'bench':
        print(json.dumps(bench(tuple(int(v) for v in a.size.split('x'))), indent=1))
    elif a.cmd == 'video':
        import tl2
        tl2.encode(a.glob, a.fps, a.out, dissolve=False)


if __name__ == '__main__':
    main()
