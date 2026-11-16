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

    tl_under.py slot    --root /srv/showcase/timelapse [--region-dir <mirror>/world/region] [--budget-s 20]
                        [--slot-file <root>/logs/scenes-slot.json] [--style trails] [--size 1920x1080] [--stamp S]
                        PRODUCTION, once per capture slot, after the surface cameras (see THE SLOT below)
    tl_under.py thin    --root R [--days 14] [--hourly-after-days 2] [--dry-run]     old box snapshots; never frames
    tl_under.py redraw  --root R --id ID --stamp S [--style side|plan] --out DIR     a kept slot again, from its box
    tl_under.py scenes  --pos posdump.json [--dump dump.json] [--n 3]          the built-in scene finder, as JSON
    tl_under.py frame   --dump dump.json --pos posdump.json (--scenes scenes-slot.json | --auto 3)
                        [--style side|plan|trails|plantrails|all] [--size 1920x1080] [--at latest|busiest|ISO]
                        [--trail-min 45] (--out DIR | --root ROOT) [--cache DIR] [--mode open|near] [--slab 5]
                        [--layer under] [--ghost] [--tag -x]
    tl_under.py seq     ... as frame, plus [--frames 12] [--step-min 5] [--pick 0]    one scene, stepping in time
    tl_under.py palette --dump dump.json      which class every block name fell into (read it: 'other' is a guess)
    tl_under.py bench   [--size 1920x1080]    seconds per frame per style on a synthetic 96x96x70 box
    tl_under.py video   'frames/*.png' out.mp4 [--fps 4]                             (tl2.encode; needs ffmpeg)

THE SLOT. tl_director.py writes <root>/logs/scenes-slot.json each slot: {v, t, stamp, scenes: [{id, layer, kind, box,
y, bots, caption, camera, frames, trail, ...}]}. `slot` draws the scenes that are underground (layer shallow or deep
and no camera of their own); a surface scene is tl_showcase's, an unknown layer or a scene that fails check_scene is
skipped and counted. Per scene:
  blocks    read straight from the mirror's region files (tl_region.read_box, beside this file): on the scene's first
            slot the scene padded to 48 blocks plus the margin that fills the picture; afterwards exactly what its kept
            framing shows. From the picture's bottom up to y 159, empty sky dropped. At most 8 million cells: past
            that the margins are cut back (the scene's own box last) and the sidecar says `box_clipped`.
  framing   made on the scene's FIRST slot (at least 48 blocks wide, from 8 below its lowest level to the surface
            and 10 of sky) and kept in under-framing/under-<id>.json for the life of the id, however its box drifts.
            It is made anew, for the old box and the new together, only when the scene outgrows it (framing_holds:
            more than 4 blocks outside the picture, or the cut more than 16 blocks beside it); the sidecar's
            `framing_change` says why and what it was.
  frame     frames/under-<id>/<YYYYMMDD>/<stamp>.png and .json: tl_showcase's fields (label, project, changed) and a
            scene camera's (scene = the id, caption, bots, layer, score, kind), then framing, bot_pos, others, dug,
            block_box, render_s. `changed` is tl_showcase.changed_fraction against the camera's previous frame
            (a 320x180 thumbnail kept in under-framing/under-<id>.gray; no ffmpeg).
  box       under-box/<id>/<YYYYMMDD>/<stamp>.box.z: the scene's blocks that slot (read_box_file documents the
            format, version 1). The day's first box of a shape is whole (~0.1-0.4 MB); the later ones are the cells
            that differ from it (~1-5 KB). `thin` deletes them after 14 days and keeps one an hour after 2.
  dug       the cells that were rock, ore or built in the scene's FIRST box of the day and are empty now, in the
            highlight colour, counted in the sidecar (dug.cells; dug.drawn of them lie in the cut).
The whole call has ONE wall-clock deadline (--budget-s, default 20, on the monotonic clock). A scene is not started
once it has passed, and the clock is looked at all through a scene (tick(): before every chunk read, every row drawn,
every megabyte compressed, every write): a scene the deadline passes during is abandoned at the next look, counted as
skipped (why.deadline), with NOTHING written -- its five files are staged under temporary names and moved into place
together (Staged). Measured on the largest box a scene may ask for (6.9 million cells): the longest stretch without a
look at the clock is 0.016 s, and that is the most a call overran its deadline (summary: max_step_s, overrun_s).
One scene's failure is a line on stderr and a count, and the exit status is ALWAYS 0 with one JSON line {scenes,
drawn, skipped, errors, seconds, bytes_written, why, stamp, rows, max_step_s, overrun_s} on stdout. A hand-off file
more than 30 minutes old is not drawn (--max-age-min).
What is read is treated as hostile: a chunk is read within its own sectors, inflated under a cap, its NBT lengths
checked before anything is allocated, and it must say it is the chunk asked for (tl_region); a chunk or a section
that is not well formed is drawn as unknown and counted (block_box.missing_chunks, bad_sections), never guessed at.
A kept framing file is checked like any input (framing_sane). Every name pattern is applied with fullmatch().
No temporary outlives its write: a failed or abandoned write removes its own, and `slot` (in the folders it writes)
and `thin` (everywhere under under-box, under-framing and frames/under-*) delete any that are more than an hour old.
INSTALL (flat, /srv/showcase/bin): tl_under.py and tl_region.py, beside tl_showcase.py and showcasestatus.py which are
there already. tl2trails is not needed there (FB_COLORS below).

Inputs of the other commands: a block dump in the format of scripts/host/townplan_blockdump.py, and positions {"pos":
{bot: {iso: [x, y, z, skill]}}} at 10-s resolution. A scene is {id, layer, box [x0, z0, x1, z1], y [y0, y1], caption,
bots}: from the director's scenes-slot.json, or from find_scenes() here.

With --root, `frame` and `seq` write frames/<camera>/<YYYYMMDD>/<stamp>.png where tl_showcase puts frames, each with a
<stamp>.json sidecar that carries the FRAMING (axis, slab, ranges, pixels per block, origin): the next call reads it
back from <root>/under-framing/<camera>.json, so a scene keeps its scale, cut and colours for as long as its box does.

Every file name is built from checked parts (--tag, --style, a scene id) and every write is refused unless its path
resolves inside --out / --root (`inside`). The rendered rock is cached: 8 backgrounds in memory and, with --cache DIR,
24 files / 48 MB / one day on disk (prune_cache). `slot` uses no disk cache unless told to: the blocks of a scene
being mined differ every slot.

There is no PNG writer or bitmap font elsewhere in this repo (tl2 draws text with ffmpeg drawtext over BlueMap
screenshots), so both are here. Reused: tl2trails' bot colours, trail-break limits and compass; tl_showcase's frame
path, stamp and change score; the region reading of townplan_blockdump (tl_region.py); tl2.encode for the video.
"""
import argparse, base64, bisect, collections, datetime as dt, hashlib, json, math, os, re, struct, sys, time, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, 'tl2'), os.path.join(HERE, '..', '..', 'scripts', 'lib')):
    if _p not in sys.path:
        sys.path.insert(0, _p)
# One bot palette, one set of trail-break limits and one compass for every map: tl2trails'. The showcase VM's tools are
# installed FLAT in /srv/showcase/bin, where tl2 is not: FB_* are the same values (test_tl_under compares them with
# tl2trails while both are in the checkout), used only when the import fails.
FB_COLORS = {'Alpha': (255, 59, 48), 'Bravo': (255, 214, 0), 'Comet': (0, 229, 255), 'Delta': (255, 64, 200),
             'Echo': (255, 255, 255), 'Frost': (255, 140, 0), 'Gale': (190, 255, 60), 'Haven': (160, 110, 255),
             'Iris': (40, 120, 255), 'Juno': (255, 150, 160), 'Kite': (0, 255, 170), 'Lumen': (255, 240, 150),
             'Maple': (200, 0, 90), 'Nova': (120, 200, 255), 'Onyx': (20, 20, 20)}
FB_LIMITS = (60.0, 6.5, 32.0, 600.0)        # GAP_S, MAX_V, MAX_JUMP, ONLINE seconds


def fb_compass(x, z):
    a = math.degrees(math.atan2(x, -z)) % 360       # 0 = north (-z), 90 = east (+x)
    return ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')[int((a + 22.5) // 45) % 8]


try:
    from tl2trails import COLORS, GAP_S, MAX_V, MAX_JUMP, ONLINE, compass   # noqa: E402
except ImportError:
    COLORS, compass = FB_COLORS, fb_compass
    GAP_S, MAX_V, MAX_JUMP = FB_LIMITS[:3]
    ONLINE = dt.timedelta(seconds=FB_LIMITS[3])
from tl_showcase import stamp_of, parse_stamp, frame_path, changed_fraction   # noqa: E402  (one frame layout, one change score)
import tl_region                                                             # noqa: E402  (beside this file)

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
_ORE = re.compile(r'(deepslate_)?(coal|iron|copper|gold|redstone|lapis|diamond|emerald)_ore')


def classify(name):
    """A block name as the dump writes it ('stone', 'glow_lichen[waterlogged]', 'snow[layers=1]') -> a class name
    (CLASSES). Plants, layers, buttons and signs are 'air': they do not fill their cell. Pure (tested)."""
    wl = name.endswith('[waterlogged]')
    n = name.split('[', 1)[0].replace('minecraft:', '')
    if n == '?':
        return 'unknown'
    if n.startswith('#'):                                    # a name folded to its class (fold_name): draws the same
        return n[1:] if n[1:] in CID else 'other'
    if n in ('air', 'cave_air', 'void_air'):
        return 'air'
    if n in _EXACT and not (wl and KIND[CID[_EXACT[n]]] in 'ao'):
        return _EXACT[n]
    if wl:
        return 'water'
    m = _ORE.fullmatch(n)
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


def fold_name(name):
    """What a block name becomes once a box's palette is full (tl_region.read_box): '#<class>'."""
    return '#' + classify(name)


def read_json(path):
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------- a deadline that reaches every loop
class Deadline(Exception):
    """The wall-clock budget ran out inside a scene. Not a ValueError or an OSError on purpose: nothing that forgives
    a bad file may swallow it."""


_DL = {'at': None, 'last': 0.0, 'gap': 0.0, 'where': None}
_mono = time.monotonic


def tick(where='?'):
    """Called from every loop that can run long (per chunk read, per row drawn, per level, before each write). With no
    deadline set it costs one dictionary lookup. With one: Deadline once it has passed, and the longest stretch
    between two calls is remembered (_DL['gap'], _DL['where']): that stretch is the most a call can overrun."""
    at = _DL['at']
    if at is None:
        return
    now = _mono()
    if now - _DL['last'] > _DL['gap']:
        _DL['gap'], _DL['where'] = now - _DL['last'], where
    _DL['last'] = now
    if now > at:
        raise Deadline(where)


class deadline:
    """with deadline(at): ... -- `at` on the time.monotonic() clock. Not re-entrant, not for threads."""
    def __init__(self, at):
        self.at = at

    def __enter__(self):
        _DL.update(at=self.at, last=_mono(), gap=0.0, where=None)
        return _DL

    def __exit__(self, *exc):
        _DL['at'] = None


def nonzero_runs(buf, pattern=rb'[^\x00]+', piece=1 << 20):
    """(start, end) of every run of non-zero bytes in buf, scanned a megabyte at a time so a deadline is looked at
    between pieces (a run that crosses a piece's edge comes back as two)."""
    rx = re.compile(pattern)
    for o in range(0, len(buf), piece):
        tick('scan')
        for m in rx.finditer(buf, o, min(len(buf), o + piece)):
            yield m.start(), m.end()


class Staged:
    """Files written under temporary names beside their final ones and moved into place together, or not at all.
    add() checks the path stays inside its base, then writes `<name>.tmp<pid>`; commit() renames them in order;
    abort() (always call it, in a `finally`) removes whatever was not committed, and the folders add() had to make
    if they are still empty: a write that fails or is abandoned leaves nothing behind."""
    def __init__(self):
        self.items, self.made = [], []

    def add(self, path, data, base):
        inside(base, path)
        d = os.path.dirname(os.path.abspath(path))
        new = []
        while d and not os.path.isdir(d):
            new.append(d)
            d = os.path.dirname(d)
        for d in reversed(new):
            os.mkdir(d)
            self.made.append(d)
        tmp = path + f'.tmp{os.getpid()}'
        self.items.append((tmp, path))                         # listed BEFORE it is written: a half-written one is ours
        with open(tmp, 'wb') as f:
            f.write(data)

    def commit(self):
        while self.items:
            tmp, path = self.items[0]
            os.replace(tmp, path)
            self.items.pop(0)
        self.made = []

    def abort(self):
        for tmp, _ in self.items:
            try:
                os.remove(tmp)
            except OSError:
                pass
        for d in reversed(self.made):
            try:
                os.rmdir(d)
            except OSError:
                pass
        self.items, self.made = [], []


def atomic_write(path, data, base):
    """One file, whole or not at all, and never a temporary left behind."""
    st = Staged()
    try:
        st.add(path, data, base)
        st.commit()
    finally:
        st.abort()


def sweep_tmp(folder, now=None, max_age_s=None):
    """Delete the abandoned temporaries of ONE folder: files named <anything>.tmp<pid> or .part whose last change is
    more than max_age_s (an hour) old; a younger one may be another process's write in progress. -> how many."""
    now = time.time() if now is None else now
    max_age_s = TMP_MAX_AGE_S if max_age_s is None else max_age_s
    n = 0
    try:
        names = os.listdir(folder)
    except OSError:
        return 0
    for name in names:
        if _TMP_FILE.fullmatch(name):
            p = os.path.join(folder, name)
            try:
                if os.path.isfile(p) and not os.path.islink(p) and now - os.path.getmtime(p) > max_age_s:
                    os.remove(p)
                    n += 1
            except OSError:
                pass
    return n


def _mask(pred):
    return bytes(1 if pred(i) else 0 for i in range(256))


M_AIR = _mask(lambda i: i < len(_C) and KIND[i] == 'a')                    # 1 where a cell is empty
M_SOLID = _mask(lambda i: i < len(_C) and KIND[i] in 'repx')               # 1 where a cell is rock, ore or built
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
            tick('blocks')
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
            if not c & 1023:
                tick('surface')
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
    for n, (c, r, s, R) in enumerate(sources):
        if not n & 63:
            tick('light')
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
        tick('side: skyline')
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
        tick('side: slab')
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
        tick('side: daylight')
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
            tick('side: ghost')
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
    tick('side: floors')
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
        if not c & 255:
            tick('plan: columns')
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
        tick('side: pixels')
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
        tick('plan: pixels')
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
    detect, and block pictures repeat every row k times), every other row unfiltered. Compressed 64 rows at a time,
    so a deadline is looked at between pieces."""
    stride = W * 3
    assert len(rgb) == stride * H, 'rgb is not W x H x 3'
    mv = memoryview(rgb)
    same = b'\x02' + bytes(stride)
    z = zlib.compressobj(level)
    out, rows, prev = [], [], None
    for y in range(H):
        row = mv[y * stride:(y + 1) * stride]
        if prev is not None and row == prev:
            rows.append(same)
        else:
            rows.append(b'\x00')
            rows.append(row)
        prev = row
        if y % 64 == 63:
            tick('png')
            out.append(z.compress(b''.join(rows)))
            rows = []
    out.append(z.compress(b''.join(rows)))
    out.append(z.flush())

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', b''.join(out)) + chunk(b'IEND', b''))


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


def _legend_items(fr, counts, overlay, dug_label=None):
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
    if overlay or dug_label:
        it.append(([('fresh', 0)], dug_label or 'dug since the block scan'))
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


def legend_rows(items, rect, u):
    """Where each legend row goes: [(x, y, swatch size, [swatches], label, text scale)]. The swatch size is the
    largest of a few with which EVERY item gets a row inside the rect (the 1440x1440 panel is a third as tall as the
    wide one); a row too wide for the rect gives up swatches from its end before its text. Pure (tested)."""
    x0, y0, x1, y1 = rect
    small = max(2, u - 1)
    ks, gap = 9 * u, 2 * u
    for ks, gap in ((9 * u, 2 * u), (9 * u, u), (8 * u, u), (7 * u, max(2, u // 2)), (7 * small, 2)):
        if len(items) * (ks + gap) - gap <= y1 - y0:
            break
    rows = []
    for i, (sw, lab) in enumerate(items):
        y = y0 + i * (ks + gap)
        if y + ks > y1:
            break
        sw = list(sw)
        while len(sw) > 1 and x0 + len(sw) * (ks + u) + u + text_w(lab, small) > x1:
            sw.pop()
        rows.append((x0, y, ks, sw, lab, small))
    return rows


def _draw_legend(cv, rect, fr, counts, overlay, u, dug_label=None):
    items = _legend_items(fr, counts, overlay, dug_label)
    rows = legend_rows(items, rect, u)
    tl = Tiles(rows[0][2]) if rows else None
    for (x, y, ks, sw, lab, small) in rows:
        for kind, v in sw:
            if kind == 'open':
                cells = tl.open(v, 0)
            elif kind == 'solid':
                cells = tl.solid(CID[v])
            elif kind == 'hatch':
                cells = tl.hatch(CID[v])
            elif kind == 'shade':
                cells = tl.solid(CID['stone'], 1, 0, 0, False, v, True)
            elif kind == 'fresh':
                cv.rect(x, y, x + ks, y + ks, FRESH_RGB)
                x += ks + u
                continue
            elif kind == 'bar':
                cv.rect(x + ks // 2 - u, y, x + ks // 2 + u, y + ks, ACCENT)
                x += ks + u
                continue
            else:
                cells = None
            if cells is None:
                cv.disk(x + ks // 2, y + ks // 2, ks // 2 - 1, (15, 15, 15))
                cv.disk(x + ks // 2, y + ks // 2, ks // 2 - 3, COLORS['Comet'], hollow=0 if v else max(2, u))
            else:
                cv.rect(x - 1, y - 1, x + ks + 1, y + ks + 1, (90, 90, 96))
                cv.blit(x, y, cells)
            x += ks + u
        cv.text(x + u, y + (ks - 7 * small) // 2, lab, INK, small)


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
                _bg_put(key, buf, info)
                try:
                    os.utime(path)                            # used now: the day-old rule is for entries nobody reads
                except OSError:
                    pass
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
    tick('picture')
    cv.blit(px0, py0, rows)
    tick('picture')
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
    _bg_put(key, bytes(cv.b), info)
    if path:
        head = json.dumps(info).encode()
        tick('cache')
        atomic_write(path, struct.pack('>I', len(head)) + head + zlib.compress(bytes(cv.b), 1), cache)
        prune_cache(cache, keep=(os.path.basename(path),))
    return cv, dict(info, cache='built')


_BG = {}
BG_MEM_MAX = 8                       # rendered backgrounds kept in memory (6 MB each at 1920x1080)
CACHE_MAX_FILES = 24                 # ... and on disk: a new one is written whenever a scene's blocks or framing change
CACHE_MAX_BYTES = 48 * 1024 * 1024
CACHE_MAX_AGE_S = 86400
_BG_FILE = re.compile(r'under-[0-9a-f]{20}\.bg(\.tmp\d+)?')


def _bg_put(key, buf, info):
    """EVERY insertion into the in-memory cache goes through here: a built background and one read back from disk
    alike, so a run over many cached scenes holds BG_MEM_MAX of them, not all."""
    _BG.pop(key, None)
    _BG[key] = (buf, info)
    while len(_BG) > BG_MEM_MAX:
        _BG.pop(next(iter(_BG)))


def prune_cache(cache, max_files=None, max_bytes=None, max_age_s=None, now=None, keep=()):
    """Bound the disk cache: delete entries not used for max_age_s (a day), then the least recently used until at
    most max_files and max_bytes remain. Only this module's own files (under-<key>.bg and their .tmp) are looked at;
    `keep` names are never deleted (the entry just written). -> the names deleted."""
    max_files = CACHE_MAX_FILES if max_files is None else max_files
    max_bytes = CACHE_MAX_BYTES if max_bytes is None else max_bytes
    max_age_s = CACHE_MAX_AGE_S if max_age_s is None else max_age_s
    now = time.time() if now is None else now
    try:
        names = [n for n in os.listdir(cache) if _BG_FILE.fullmatch(n)]
    except OSError:
        return []
    entries = []
    for n in names:
        try:
            st = os.stat(os.path.join(cache, n))
            entries.append((st.st_mtime, n, st.st_size))
        except OSError:
            pass
    gone, n_kept, b_kept = [], 0, 0
    for mtime, n, size in sorted(entries, reverse=True):          # newest first
        if '.tmp' in n:
            drop = now - mtime > 600                              # a .tmp that old is a dead writer's; a young one is live
        else:
            drop = n not in keep and (now - mtime > max_age_s or n_kept >= max_files or b_kept + size > max_bytes)
        if drop:
            try:
                os.remove(os.path.join(cache, n))
                gone.append(n)
            except OSError:
                pass
        elif '.tmp' not in n:
            n_kept += 1
            b_kept += size
    return gone


def connected(a, b):
    """May two consecutive samples be joined by a line? tl2trails' limits (gap, speed, jump), with the height."""
    d = b[0] - a[0]
    hd = math.hypot(b[1] - a[1], b[3] - a[3])
    return d <= GAP_S and hd <= MAX_JUMP and abs(b[2] - a[2]) <= 2 * MAX_JUMP and hd / max(d, 0.05) <= MAX_V


DEPTH_REACH = 16                # a side cut lists and draws a bot this far in front of or behind the scene's own depth


def bots_now(pos, fr, t, margin=2.0, reach=DEPTH_REACH):
    """The bots inside the picture at time t: {name: (x, y, z, skill, in_cut)}. A bot whose last sample is older than
    tl2trails.ONLINE is left out; so is one more than `reach` blocks in front of or behind a side cut's scene."""
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
            if not (ua - margin <= uu <= ub + 1 + margin and da - reach <= d <= db + 1 + reach and ylo <= y <= yhi + 1):
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
    for n, (x, y, z) in enumerate(cells):
        if not n & 511:
            tick('dug: draw')
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
        tick('trails')
        for i in range(1, len(rows)):
            if not i & 127:
                tick('trails')
            p, q = rows[i - 1], rows[i]
            if not connected(p, q):
                continue
            if fr['style'] == 'side':
                d0, d1 = (p[3], q[3]) if fr['axis'] == 'x' else (p[1], q[1])
                if not (da - DEPTH_REACH <= d0 <= db + 1 + DEPTH_REACH and da - DEPTH_REACH <= d1 <= db + 1 + DEPTH_REACH):
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
        tick('bots')
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


def counted_bots(scene, now, under_y=UNDER_Y):
    """The bots a frame's caption counts, in the roster's order. A director scene: its own `bots` (the caption is the
    director's and counts those). A scene of the built-in finder, or one with no caption: the bots that are in the
    picture and underground now. The caption and the roster are both made from THIS list. Pure (tested)."""
    if scene.get('caption') and not scene.get('auto'):
        if scene.get('bots') is not None:
            return [str(b) for b in scene['bots']]
        return sorted(now)
    return sorted(b for b, v in now.items() if v[1] < under_y)


def roster_rows(now, counted):
    """One row per counted bot: [(name, text, state)], state 'in' (in the cut), 'near' (in the picture, in front of or
    behind it) or 'away' (no position in the picture now). Pure (tested)."""
    rows = []
    for b in counted:
        v = now.get(b)
        if v is None:
            rows.append((b, 'not in the picture', 'away'))
        else:
            rows.append((b, f"{VERB.get(v[3], v[3].replace('_', ' '))}  y {int(math.floor(v[1]))}", 'in' if v[4] else 'near'))
    return rows


def draw_roster(cv, rect, now, counted, u):
    x0, y0, x1, y1 = rect
    small = max(2, u - 1)
    cv.text(x0, y0, 'WHO IS HERE', DIM, small)
    rows = roster_rows(now, counted)
    others = sorted(b for b in now if b not in counted)
    rh = 7 * u + 3 * u
    y = y0 + 7 * small + 3 * u
    foot = 7 * small + 2 * u if others else 0
    per = max(1, (y1 - foot - y) // rh)
    need = 8 * u + 6 * u * 6 + 2 * u + 6 * small * 19        # chip, a 6-letter name, 'heading home  y -12'
    ncol = max(1, min((x1 - x0) // need, -(-len(rows) // per)))
    cw = (x1 - x0) // ncol
    shown = rows
    if len(rows) > per * ncol:                               # more bots than rows: say so instead of overlapping
        shown = rows[:per * ncol - 1]
        cv.text(x0 + (ncol - 1) * cw + 8 * u, y + (per - 1) * rh, f'+ {len(rows) - len(shown)} more', DIM, u)
    for i, (b, text, state) in enumerate(shown):
        bx, by = x0 + (i // per) * cw, y + (i % per) * rh
        col = COLORS.get(b, (255, 255, 255)) if state != 'away' else (96, 96, 104)
        cv.disk(bx + 3 * u, by + 3 * u + u // 2, 3 * u, (235, 235, 235) if _dark(col) else (12, 12, 14))
        cv.disk(bx + 3 * u, by + 3 * u + u // 2, 3 * u - 2, col, hollow=0 if state == 'in' else max(2, u))
        nx = cv.text(bx + 8 * u, by, b, INK if state != 'away' else DIM, u)
        cv.text(max(nx + 2 * u, bx + 8 * u + 6 * u * 6), by + (7 * u - 7 * small), text, DIM, small)
    if not rows:
        cv.text(x0, y, 'no bot down here now', DIM, small)
    if others:                                               # in the picture but not in the caption's count
        line = 'also in view: ' + ', '.join(others)
        room = max(8, (x1 - x0) // (6 * small))
        if len(line) > room:
            k = len(others)
            while k > 0 and len('also in view: ' + ', '.join(others[:k]) + f' +{len(others) - k}') > room:
                k -= 1
            line = 'also in view: ' + ', '.join(others[:k]) + f' +{len(others) - k}'
        cv.text(x0, y1 - 7 * small, line, DIM, small)


def frame_caption(pos, scene, who, t, trail_min, under_y=UNDER_Y):
    """A caption for one frame from the positions themselves (the built-in finder's scenes). who: counted_bots(),
    the same list the roster shows; the verb is what their last trail_min minutes in the scene went on."""
    skills = collections.Counter()
    x0, z0, x1, z1 = scene['box']
    for b in who:
        for (_, x, y, z, sk) in window(pos.get(b) or [], t - trail_min * 60, t):
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
           ghost=False, dug=None, clock=None):
    """One frame. style: side | plan | trails | plantrails. -> (Canvas, sidecar dict). Pass the framing of the
    scene's earlier frame to keep the picture still between slots. dug: {'cells': [(x, y, z), ...], 'since': stamp}
    from two block boxes (dug_cells): drawn in the highlight colour in every style, INSTEAD of the guess from the
    positions that a single block scan allows. clock: the time the title shows (a slot's own stamp), default t. The sidecar carries tl_showcase's fields (label, project, changed) and
    a director scene camera's (scene = the id, caption, bots = the names the caption counts, layer, score, kind)."""
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
    counted = counted_bots(scene, now)
    cap = scene.get('caption') if not scene.get('auto') else None
    cap = cap or frame_caption(pos, scene, counted, t, trail_min)
    when = dt.datetime.fromtimestamp(t if clock is None else clock, UTC)
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
    nfresh, dug_side, dug_label = 0, None, None
    if dug is not None:
        mine = [c for c in dug['cells'] if in_cut(fr, c[0] + 0.5, c[1], c[2] + 0.5, 0.0)]
        since = parse_stamp(str(dug.get('since') or ''))
        dug_label = f'dug since {since:%H:%M}' if since else 'dug today'
        dug_side = {'since': dug.get('since'), 'cells': len(dug['cells']), 'drawn': draw_fresh(cv, fr, mine)}
    elif overlay:
        nfresh = draw_fresh(cv, fr, fresh_cells(world, pos, fr, t))
    counts = {CID[k]: v for k, v in info['counts'].items()}
    tick('overlay')
    if overlay:
        ntr = draw_trails(cv, pos, fr, t, trail_min)
        tick('overlay')
        draw_bots(cv, fr, now)
        tick('overlay')
        draw_roster(cv, info['roster'], now, counted, u)
        _draw_legend(cv, info['legend'], fr, counts, True, u, dug_label)
    else:
        ntr = 0
        _draw_legend(cv, L['panel'], fr, counts, False, u, dug_label)
    side_car = {'label': cap, 'project': scene.get('project'), 'changed': None,
                'scene': scene.get('id'), 'caption': cap, 'bots': counted, 'layer': scene.get('layer'),
                'score': scene.get('score'), 'kind': scene.get('kind'),
                'style': style, 'stamp': stamp_of(when), 'time': when.isoformat(), 'box': list(scene['box']),
                'y': list(scene['y']), 'framing': fr, 'trail_min': trail_min if overlay else None,
                'bot_pos': {b: {'x': v[0], 'y': v[1], 'z': v[2], 'skill': v[3], 'in_cut': v[4]} for b, v in sorted(now.items())},
                'others': sorted(b for b in now if b not in counted),
                'trail_segments': ntr, 'fresh_cells': nfresh, 'dug': dug_side, 'world': world.token,
                'background': info.get('cache'),
                'render_s': {'background': round(t_bg, 3), 'total': round(time.time() - t0, 3)}, 'version': VERSION}
    return cv, side_car


def encode_frame(cv, side_car, level=6):
    """The frame's two files as bytes: (PNG, sidecar JSON). The sidecar gets the PNG's size and encode time."""
    t0 = time.time()
    data = png_encode(cv.W, cv.H, cv.b, level)
    side_car['render_s']['png'] = round(time.time() - t0, 3)
    side_car['bytes'] = len(data)
    return data, json.dumps(side_car, indent=1).encode()


def write_frame(cv, side_car, png_path, base, level=6):
    """The PNG and its sidecar, both or neither. `base` is the folder the frame must stay inside (--out, or
    --root): Staged.add checks it before a directory is made or a byte is written."""
    if not png_path.endswith('.png'):
        raise ValueError(f'{png_path!r} is not a .png')
    data, side = encode_frame(cv, side_car, level)
    st = Staged()
    try:
        st.add(png_path[:-4] + '.json', side, base)
        st.add(png_path, data, base)
        st.commit()
    finally:
        st.abort()
    return len(data)


# ================================================================ CLI
STYLES = ('side', 'plan', 'trails', 'plantrails')
# EVERY pattern that guards a file name is used with fullmatch(): `$` (and match()) accept a trailing newline, and a
# name like 'hostile\n' would then be written but never recognised again by the code that thins and sweeps.
_TAG = re.compile(r'[A-Za-z0-9_-]{0,40}')
_NAME = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,79}')
_SIZE = re.compile(r'(\d{3,4})x(\d{3,4})')
_DAY = re.compile(r'\d{8}')
_STATE_FILE = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,79}\.(json|gray)')
_TMP_FILE = re.compile(r'.+\.(tmp\d+|part)')
TMP_MAX_AGE_S = 3600             # a temporary older than this belongs to a writer that died


def _fail(msg):
    raise SystemExit('tl_under: ' + msg)


def camera_name(scene, style):
    """frames/<camera>/...: letters, digits and '_' only (tl_showcase's camera names carry no '-'), at most 80."""
    return re.sub(r'[^A-Za-z0-9_]', '_', f"{str(scene['id'])[:60]}_{style}")


def inside(base, path):
    """`path`, which must lie inside `base` once every link and '..' is resolved. A file name is built from a scene
    id, a style and a tag that other programs and people supply: this is the check that none of them, however it was
    spelled, puts a file anywhere else. Raises ValueError. Pure given the filesystem (tested)."""
    b, q = os.path.realpath(base), os.path.realpath(path)
    if os.path.commonpath([b, q]) != b or q == b:
        raise ValueError(f'{path!r} is not inside {base!r}')
    return path


def parse_size(s):
    m = _SIZE.fullmatch(s or '')
    if not m or not (320 <= int(m.group(1)) <= 7680 and 320 <= int(m.group(2)) <= 4320):
        _fail(f'--size {s!r}: WIDTHxHEIGHT, 320x320 to 7680x4320')
    return int(m.group(1)), int(m.group(2))


def parse_styles(arg, default):
    styles = list(default) if arg == 'all' else arg.split(',')
    for st in styles:
        if st not in STYLES:
            _fail(f'--style {st!r}: one of {", ".join(STYLES)}' + (' (or all)' if len(default) > 1 else ''))
    return styles


def check_names(a):
    """Everything that becomes part of a file name, checked BEFORE anything is read or written."""
    if not _TAG.fullmatch(a.tag or ''):
        _fail(f'--tag {a.tag!r}: letters, digits, _ and - only, at most 40')


def _state_file(root, camera, ext):
    if not isinstance(camera, str) or not _NAME.fullmatch(camera):
        raise ValueError(f'camera name {camera!r}')
    return inside(root, os.path.join(root, 'under-framing', camera + ext))


def kept_framing(root, camera, scene, size, style):
    """The framing this camera used last, if it is still for this scene box, y range, size and look."""
    try:
        fr = read_json(_state_file(root, camera, '.json'))
    except (OSError, ValueError):
        return None
    ok = (fr.get('box') == list(scene['box']) and fr.get('scene_y') == list(scene['y']) and fr.get('size') == list(size)
          and fr.get('version') == VERSION)
    return {k: v for k, v in fr.items() if k != 'version'} if ok else None


def keep_framing(root, camera, fr):
    atomic_write(_state_file(root, camera, '.json'), json.dumps(dict(fr, version=VERSION), indent=1).encode(), root)


def busiest_slot(pos, scene, trail_min, slot_min=15):
    """The slot (a multiple of slot_min) whose trail window holds the most weighted samples of the scene."""
    hi = last_time(pos)
    if hi is None:
        return None
    lo = min(r[0][0] for r in pos.values())
    best = None
    t = math.floor(hi / (slot_min * 60)) * slot_min * 60
    while t - trail_min * 60 >= lo - 1:
        w = sum(s[3] for s in scene_samples(pos, scene, t - trail_min * 60, t))
        if best is None or w > best[0]:
            best = (w, t)
        t -= slot_min * 60
    return best[1] if best else hi


def _when(arg, pos, scene, trail_min, now=None):
    """The frame's time. With no position at all, `latest` and `busiest` are the clock's last five minutes: a scene
    nobody is in is still drawn (rock only, and the caption says no bots), not a crash."""
    if arg in ('latest', 'busiest'):
        last = last_time(pos)
        if last is None:
            return math.floor((time.time() if now is None else now) / 300) * 300
        return math.floor(last / 300) * 300 if arg == 'latest' else busiest_slot(pos, scene, trail_min)
    p = parse_stamp(arg)
    try:
        return (p or dt.datetime.fromisoformat(arg).replace(tzinfo=UTC)).timestamp()
    except ValueError:
        _fail(f'--at {arg!r}: latest, busiest, a stamp like 20261116T1245Z or an ISO time')


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


def _target(a, camera, stamp, flat):
    """Where one frame goes, and the folder it must stay in: --root's frames/<camera>/<day>/<stamp>.png, else
    --out's <flat>.png."""
    if a.root:
        return inside(a.root, frame_path(a.root, camera, stamp)), a.root
    return inside(a.out, os.path.join(a.out, flat + '.png')), a.out


def cmd_frame(a):
    check_names(a)
    size = parse_size(a.size)
    styles = parse_styles(a.style, ('side', 'plan', 'trails'))
    world, pos, scenes = _inputs(a)
    if not scenes:
        print('tl_under: no scenes in the input: nothing drawn', file=sys.stderr)
        return []
    rows = []
    for n, sc in enumerate(scenes):
        t = _when(a.at, pos, sc, a.trail_min)
        for st in styles:
            cam = camera_name(sc, st)
            fr = kept_framing(a.root, cam, sc, size, st) if a.root else None
            cv, sd = render(world, pos, sc, st, t, size, fr, a.trail_min, a.cache, a.slab, a.mode, a.ghost)
            sd['camera'] = cam
            sd['framing_kept'] = fr is not None
            p, base = _target(a, cam, sd['stamp'], f'scene{n + 1}-{st}{a.tag}')
            if a.root and fr is None:
                keep_framing(a.root, cam, sd['framing'])
            write_frame(cv, sd, p, base)
            rows.append({'png': p, 'caption': sd['label'], 'render_s': sd['render_s'], 'bytes': sd['bytes'],
                         'bots': len(sd['bots']), 'ppb': sd['framing']['ppb']})
            print(json.dumps(rows[-1]))
    return rows


def cmd_seq(a):
    check_names(a)
    size = parse_size(a.size)
    style = parse_styles(a.style, ('trails',))
    if len(style) != 1:
        _fail('seq draws one style')
    style = style[0]
    world, pos, scenes = _inputs(a)
    if not 0 <= a.pick < len(scenes):
        _fail(f'seq --pick {a.pick}: the input has {len(scenes)} scene(s); nothing drawn')
    sc = scenes[a.pick]
    t1 = _when(a.at, pos, sc, a.trail_min)
    cam = camera_name(sc, style)
    fr = kept_framing(a.root, cam, sc, size, style) if a.root else None
    rows = []
    for i in range(a.frames):
        t = t1 - (a.frames - 1 - i) * a.step_min * 60
        cv, sd = render(world, pos, sc, style, t, size, fr, a.trail_min, a.cache, a.slab, a.mode, a.ghost)
        if a.root and fr is None:
            keep_framing(a.root, cam, sd['framing'])
        fr = sd['framing']
        sd['camera'] = cam
        p, base = _target(a, cam, sd['stamp'], f"seq-scene{a.pick + 1}-{style}{a.tag}-{i + 1:02d}-{sd['stamp']}")
        write_frame(cv, sd, p, base)
        rows.append({'png': p, 'caption': sd['label'], 'render_s': sd['render_s'], 'bots': len(sd['bots'])})
        print(json.dumps(rows[-1]))
    return rows


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


# ================================================================ production: one call per slot, from the region files
UNDER_LAYERS = ('shallow', 'deep', 'under', 'underground')     # tl_director's two, and this file's own finder's
MIN_WIDE = 48                   # a scene is framed as if it were at least this wide (two bots in three blocks are a scene)
OUTGROW = 4                     # a scene may reach this far outside its framing before the framing is widened
CUT_REACH = 16                  # ... and its side cut may lie this far beside the scene before it is cut anew
Y_TOP, Y_BOTTOM = 159, -64      # the highest level a box is read to; the world's floor
SKY_ROWS = 12                   # levels kept above the highest block of a box
MAX_BOX_CELLS = 8_000_000       # a box read for one scene (up to Y_TOP, before the sky is dropped): 8 MB in memory
DEPTH_MAX = 64                  # a side cut's box reaches at most this far in front of and behind the cut
UNION_MAX = 256                 # an outgrown framing is remade for the old box AND the new one only up to this width
BOX_VERSION = 1
BOX_MAGIC = b'UBOX'
_SCENE_ID = re.compile(r'[A-Za-z0-9_]{1,60}')
_STAMP = re.compile(r'\d{8}T\d{4}Z')
_ISO = re.compile(r'(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d:?\d\d)?')
MAX_SPAN = 1024                 # no picture or box is wider than this, whatever a scene or a kept framing says


def parse_iso(s):
    """'2026-11-16T12:44:50Z' (also with a fraction or an offset; none means UTC) -> epoch seconds, or None."""
    m = _ISO.fullmatch(s) if isinstance(s, str) else None
    if not m:
        return None
    try:
        t = dt.datetime(*(int(g) for g in m.groups()[:6]), tzinfo=UTC).timestamp()
    except ValueError:
        return None
    off = m.group(7)
    if off and off != 'Z':
        t -= (1 if off[0] == '+' else -1) * (int(off[1:3]) * 3600 + int(off[-2:]) * 60)
    return t


MAX_HANDOFF_BYTES = 4 << 20      # the hand-off file is ~80 KB; one fifty times that is not a hand-off file
MAX_SCENES = 64                  # scenes looked at in one hand-off (the director keeps at most a handful live)
MAX_TRAIL_BOTS = 64              # bots drawn in one scene
MAX_TRAIL_ROWS = 600             # samples per bot (the director writes at most 300): the NEWEST are kept
MAX_WORD = 40                    # a bot name, a time, a skill: longer is not one


def trail_positions(trail):
    """A scene's `trail` {bot: [[t_iso, x, y, z, skill], ...]} -> ({bot: [(epoch, x, y, z, skill), ...]} sorted, the
    number of rows that were not read). A missing trail, or a bot with [], is simply nobody to draw. Bounded whatever
    the file says: MAX_TRAIL_BOTS bots, each one's newest MAX_TRAIL_ROWS rows (so no sort is of more), names and times
    of at most MAX_WORD characters, coordinates that are numbers; what is over a limit is counted as not read. The
    deadline is looked at for every bot and every 128 rows."""
    out, bad = {}, 0
    if not isinstance(trail, dict):
        return out, (0 if trail is None else 1)
    for n, (b, rows) in enumerate(trail.items()):
        tick('trail')
        rows = rows if isinstance(rows, list) else []
        if n >= MAX_TRAIL_BOTS or not isinstance(b, str) or not 0 < len(b) <= MAX_WORD:
            bad += len(rows)
            continue
        bad += max(0, len(rows) - MAX_TRAIL_ROWS)
        got = []
        for i, r in enumerate(rows[-MAX_TRAIL_ROWS:]):
            if not i & 127:
                tick('trail')
            try:
                if not isinstance(r, list) or len(r) > 8 or not isinstance(r[0], str) or len(r[0]) > MAX_WORD \
                        or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in r[1:4]):
                    raise ValueError
                t = parse_iso(r[0])
                x, y, z = float(r[1]), float(r[2]), float(r[3])
                if t is None or not all(math.isfinite(v) for v in (x, y, z)):
                    raise ValueError
                got.append((t, x, y, z, str(r[4])[:MAX_WORD] if len(r) > 4 and isinstance(r[4], str) else '?'))
            except (TypeError, ValueError, IndexError, OverflowError):
                bad += 1
        got.sort()
        if got:
            out[b] = got
    return out, bad


def read_handoff(path, max_bytes=MAX_HANDOFF_BYTES):
    """The hand-off file as an object. A file over max_bytes is refused BEFORE a byte of it is decoded, and no more
    than max_bytes + 1 of it are ever read (so one that grows while it is read is refused too): ValueError."""
    with open(path, 'rb') as f:
        data = f.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(f'the hand-off file is more than {max_bytes} bytes: not decoded')
    return json.loads(data)


def check_scene(s):
    """Why a hand-off scene cannot be drawn, or None. Nothing of it reaches a path or an array size unchecked."""
    if not isinstance(s, dict):
        return 'not an object'
    if not isinstance(s.get('id'), str) or not _SCENE_ID.fullmatch(s['id']):
        return 'id: letters, digits and _ only, at most 60'
    box, y = s.get('box'), s.get('y')
    if not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in box)):
        return 'box: four numbers'
    if not (isinstance(y, list) and len(y) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in y)):
        return 'y: two numbers'
    if box[0] > box[2] or box[1] > box[3] or box[2] - box[0] > 512 or box[3] - box[1] > 512 or max(abs(v) for v in box) > 3e7:
        return 'box: x0 <= x1, z0 <= z1, at most 512 wide'
    if y[0] > y[1] or y[0] < Y_BOTTOM - 1 or y[1] > 320:
        return f'y: lowest <= highest, {Y_BOTTOM} to 320'
    if s.get('frames') is not None and s['frames'] != 'frames/under-' + s['id']:
        return 'frames: not frames/under-<id>'
    return None


def slot_scenes(obj):
    """The hand-off object -> (the underground scenes to draw, in its order; why the others are not drawn:
    {'surface': n, 'unknown_layer': n, 'has_camera': n, 'invalid': n}). Underground = layer shallow or deep AND no
    camera of its own (tl_showcase shoots a scene that has one). Pure (tested)."""
    why = collections.Counter()
    out = []
    scenes = obj.get('scenes') if isinstance(obj, dict) else obj
    scenes = scenes if isinstance(scenes, list) else []
    if len(scenes) > MAX_SCENES:
        why['too_many'] = len(scenes) - MAX_SCENES
    for s in scenes[:MAX_SCENES]:
        tick('hand-off: scenes')
        layer = s.get('layer') if isinstance(s, dict) else None
        if layer == 'surface':
            why['surface'] += 1
        elif layer not in UNDER_LAYERS:
            why['unknown_layer'] += 1
        elif s.get('camera'):
            why['has_camera'] += 1
        elif check_scene(s):
            why['invalid'] += 1
        else:
            bots = s.get('bots')
            out.append(dict(s, box=[int(math.floor(v)) for v in s['box'][:2]] + [int(math.ceil(v)) for v in s['box'][2:]],
                            y=[int(math.floor(s['y'][0])), int(math.ceil(s['y'][1]))],
                            bots=[str(b)[:MAX_WORD] for b in bots[:MAX_TRAIL_BOTS]] if isinstance(bots, list) else None,
                            caption=s['caption'][:200] if isinstance(s.get('caption'), str) else None))
    return out, dict(why)


def pad_scene(scene, min_w=MIN_WIDE):
    """The scene a framing is made FOR: its box grown evenly to at least min_w blocks each way. Pure (tested)."""
    x0, z0, x1, z1 = scene['box']
    gx, gz = max(0, min_w - (x1 - x0 + 1)), max(0, min_w - (z1 - z0 + 1))
    return dict(scene, box=[x0 - gx // 2, z0 - gz // 2, x1 + gx - gx // 2, z1 + gz - gz // 2])


def framing_holds(fr, scene, slack=OUTGROW, reach=CUT_REACH):
    """Does a kept framing still show this scene? -> None, or why not. A side cut holds while the scene's box is inside
    the picture's width (give or take `slack`), its lowest level inside the picture's height, and the cut itself
    within `reach` blocks of the scene; a plan while the box is inside the map and the scene's levels inside the
    band it looks through. Pure (tested)."""
    x0, z0, x1, z1 = scene['box']
    y0, y1 = scene['y']
    if fr['style'] == 'side':
        (ua, ub), (da, db) = ((x0, x1), (z0, z1)) if fr['axis'] == 'x' else ((z0, z1), (x0, x1))
        if ua < fr['u'][0] - slack or ub > fr['u'][1] + slack:
            return f"the scene ({ua} to {ub}) is wider than the picture ({fr['u'][0]} to {fr['u'][1]})"
        if y0 < fr['y'][0] - slack or y1 > fr['y'][1] + slack:
            return f"the scene's levels ({y0} to {y1}) are outside the picture ({fr['y'][0]} to {fr['y'][1]})"
        if fr['slab'][1] < da - reach or fr['slab'][0] > db + reach:
            return f"the cut ({fr['slab'][0]} to {fr['slab'][1]}) is more than {reach} blocks beside the scene ({da} to {db})"
        return None
    if x0 < fr['x'][0] - slack or x1 > fr['x'][1] + slack or z0 < fr['z'][0] - slack or z1 > fr['z'][1] + slack:
        return 'the scene is wider than the map'
    if y1 > fr['band'][1] + slack or y0 < fr['band'][0] - 6 - slack:
        return f"the scene's levels ({y0} to {y1}) are outside the band ({fr['band'][0]} to {fr['band'][1]})"
    return None


def held_framing(fr, scene):
    """A kept framing for this slot: the same picture, with the depth it lists bots over and the levels its axis
    marks following the scene (neither moves a block on the picture). The depth only ever grows, and never past
    DEPTH_MAX blocks from the cut: it is also the box that is read and kept every slot. Pure (tested)."""
    out = dict(fr, scene_y=list(scene['y']))
    if fr['style'] == 'side':
        x0, z0, x1, z1 = scene['box']
        da, db = (z0, z1) if fr['axis'] == 'x' else (x0, x1)
        lo, hi = fr['slab'][0] - DEPTH_MAX, fr['slab'][1] + DEPTH_MAX
        out['depth'] = [max(lo, min(fr['depth'][0], da)), min(hi, max(fr['depth'][1], db))]
    return out


def framing_sane(fr):
    """Is a framing read back from a file something this program could have written? Whole numbers in order, nothing
    wider than MAX_SPAN, a scale of 2 to 64 pixels. A file that fails is not used: the scene is framed anew. (A kept
    framing decides how many blocks are read and how many rows are drawn: it is input, and it is checked as input.)"""
    def pair(v, lo, hi, span):
        return (isinstance(v, list) and len(v) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in v)
                and lo <= v[0] <= v[1] <= hi and v[1] - v[0] < span)
    try:
        if fr.get('style') not in ('side', 'plan') or not pair(fr.get('y'), Y_BOTTOM, 320, 400):
            return False
        if not (isinstance(fr.get('ppb'), int) and 2 <= fr['ppb'] <= 64 and pair(fr.get('scene_y'), -2048, 2048, 4096)):
            return False
        if not (isinstance(fr.get('origin'), list) and len(fr['origin']) == 2 and all(isinstance(v, int) and 0 <= v < 8192 for v in fr['origin'])):
            return False
        if not (isinstance(fr.get('box'), list) and len(fr['box']) == 4 and pair(fr['box'][0::2], -3e7, 3e7, MAX_SPAN)
                and pair(fr['box'][1::2], -3e7, 3e7, MAX_SPAN)):
            return False
        if fr['style'] == 'side':
            return (fr.get('axis') in ('x', 'z') and fr.get('mode') in ('open', 'near') and pair(fr.get('u'), -3e7, 3e7, MAX_SPAN)
                    and pair(fr.get('depth'), -3e7, 3e7, MAX_SPAN) and pair(fr.get('slab'), -3e7, 3e7, 64))
        return pair(fr.get('x'), -3e7, 3e7, MAX_SPAN) and pair(fr.get('z'), -3e7, 3e7, MAX_SPAN) and pair(fr.get('band'), Y_BOTTOM, 320, 400)
    except (TypeError, AttributeError, ValueError):
        return False


def load_framing(root, camera, size, style):
    """The framing kept for a camera, if it is this version's, this size's, this kind of picture's, and sane."""
    try:
        fr = read_json(_state_file(root, camera, '.json'))
    except (OSError, ValueError):
        return None
    base = 'plan' if style in ('plan', 'plantrails') else 'side'
    if not isinstance(fr, dict) or fr.get('version') != VERSION or fr.get('size') != list(size) or fr.get('style') != base:
        return None
    fr = {k: v for k, v in fr.items() if k != 'version'}
    return fr if framing_sane(fr) else None


def cap_rect(rect, ny, max_cells=MAX_BOX_CELLS, keep=None):
    """A read rectangle of at most max_cells over ny levels. What is cut first is the margin around `keep` (the
    scene's own box): every side keeps at most M blocks of margin, M the largest that fits (found by halving: at most
    64 steps whatever the numbers, never a block at a time); only when the scene alone is too large is it cut,
    evenly from the two ends of its longer side and then of the other (never under 16 blocks). With no `keep` (a
    kept framing's box: the same cut every slot) it is cut around its own middle. -> (rect, cut?). Pure (tested)."""
    x0, z0, x1, z1 = (int(v) for v in rect)
    area = max(256, max_cells // max(1, ny))
    if (x1 - x0 + 1) * (z1 - z0 + 1) <= area:
        return [x0, z0, x1, z1], False
    if keep is None:
        mx, mz = (x0 + x1 + 1) // 2, (z0 + z1 + 1) // 2
        kx0, kz0, kx1, kz1 = mx, mz, mx - 1, mz - 1                 # nothing to keep: an empty box at the middle
    else:
        kx0, kz0, kx1, kz1 = max(x0, min(x1, keep[0])), max(z0, min(z1, keep[1])), min(x1, max(x0, keep[2])), min(z1, max(z0, keep[3]))
    kw, kd = kx1 - kx0 + 1, kz1 - kz0 + 1
    a, b, c, d = kx0 - x0, x1 - kx1, kz0 - z0, z1 - kz1

    def size(m):
        return (kw + min(a, m) + min(b, m)) * (kd + min(c, m) + min(d, m))
    if size(0) <= area:
        lo, hi = 0, max(a, b, c, d)
        while lo < hi:                                             # the largest margin that fits
            mid = (lo + hi + 1) // 2
            if size(mid) <= area:
                lo = mid
            else:
                hi = mid - 1
        return [kx0 - min(a, lo), kz0 - min(c, lo), kx1 + min(b, lo), kz1 + min(d, lo)], True
    w, dd = kw, kd                                                 # the scene itself is too large
    if w >= dd:
        w = min(kw, max(16, area // max(1, dd)))
        dd = min(kd, max(16, area // w))
    else:
        dd = min(kd, max(16, area // max(1, w)))
        w = min(kw, max(16, area // dd))
    nx0, nz0 = kx0 + (kw - w) // 2, kz0 + (kd - dd) // 2
    return [nx0, nz0, nx0 + w - 1, nz0 + dd - 1], True


def slot_region(scene, fr, size, pos, style, thick=SLAB):
    """The block box to read for a scene this slot: {rect [x0, z0, x1, z1], y0, top_min, clipped}. With a framing
    (held_framing's): EXACTLY what that picture shows and lists bots over, from its own bottom level, so that every
    slot of one framing reads the same box and the boxes compare cell for cell (a scene that pokes a few blocks out
    of its picture is not read there: it is not drawn there either). Without one (the scene's first slot): the
    padded scene plus, along the axis the cut will run, the margin that fills the picture at the scale its height
    allows, and 8 blocks to the sides, from 12 below the scene's lowest level. Always up to Y_TOP; read_scene_box
    then drops the empty sky. Past MAX_BOX_CELLS the margins are cut back (cap_rect) and the frame says
    `box_clipped`. Pure (tested)."""
    P = pad_scene(scene)
    x0, z0, x1, z1 = P['box']
    y0 = max(Y_BOTTOM, _snap(scene['y'][0] - 12, 4, False))
    top_min = None
    if fr is not None:
        if fr['style'] == 'side':
            (ua, ub), (da, db) = fr['u'], fr['depth']
            vx0, vz0, vx1, vz1 = (ua, da, ub, db) if fr['axis'] == 'x' else (da, ua, db, ub)
        else:
            (vx0, vx1), (vz0, vz1) = fr['x'], fr['z']
        rect = [vx0, vz0, vx1, vz1]
        y0 = max(Y_BOTTOM, fr['y'][0])
        top_min = fr['y'][1] if fr['style'] == 'side' else None
    else:
        L = layout(*size)
        aw, ah = L['area'][2] - L['area'][0], L['area'][3] - L['area'][1]
        if style in ('plan', 'plantrails'):
            k = max(2, min(aw // (x1 - x0 + 1), ah // (z1 - z0 + 1)))
            mx, mz = min(64, max(8, (aw // k - (x1 - x0 + 1) + 1) // 2)), min(64, max(8, (ah // k - (z1 - z0 + 1) + 1) // 2))
        else:
            S = scene_samples(pos, P, -1e99, 1e99)
            axis = choose_plane(S, P['box'], thick)['axis']
            wide = (x1 - x0 + 1) if axis == 'x' else (z1 - z0 + 1)
            k = max(2, min(aw // wide, ah // max(1, 100 - (scene['y'][0] - 8))))      # the surface is near y 90 at most
            m = min(64, max(8, (aw // k - wide + 1) // 2))
            mx, mz = (m, 8) if axis == 'x' else (8, m)
        rect = [x0 - mx, z0 - mz, x1 + mx, z1 + mz]
    rect, clipped = cap_rect(rect, Y_TOP - y0 + 1, keep=None if fr is not None else scene['box'])
    return {'rect': rect, 'y0': y0, 'top_min': top_min, 'clipped': clipped}


def box_world(raw):
    """A box as tl_region.read_box (or a snapshot) gives it -> a World. Its token is the hash of what is DRAWN (the
    class of every cell, not the order its names happened to be met in): two slots with the same blocks share one
    rendered background."""
    tick('box: hash')
    w = World(raw['box'], raw['y'], raw['palette'], raw['cells'], 8, 'box')
    h = hashlib.sha1(json.dumps([raw['box'], raw['y']]).encode())
    h.update(raw['cells'].translate(w.lut))
    tick('box: hash')
    w.token = 'box-' + h.hexdigest()[:16]
    return w


def trim_top(raw, top_min=None):
    """Drop a box's empty sky: its top becomes SKY_ROWS above the highest level that holds anything but air, and never
    below top_min (the kept framing's own top: a picture's sky must be read, not unknown)."""
    x0, z0, x1, z1 = raw['box']
    y0, y1 = raw['y']
    layer = (x1 - x0 + 1) * (z1 - z0 + 1)
    solid = bytes(0 if (i < len(raw['palette']) and KIND[CID[classify(raw['palette'][i])]] == 'a') else 1 for i in range(256))
    cells = raw['cells']
    ny = y1 - y0 + 1
    top = 0
    for yi in range(ny - 1, -1, -1):
        tick('box: sky')
        if b'\x01' in cells[yi * layer:(yi + 1) * layer].translate(solid):
            top = yi
            break
    keep = min(ny, top + 1 + SKY_ROWS)
    if top_min is not None:
        keep = min(ny, max(keep, top_min - y0 + 1))
    return dict(raw, y=[y0, y0 + keep - 1], cells=cells[:keep * layer])


def read_scene_box(region_dir, region):
    """Read a scene's box from the mirror's region files, up to Y_TOP, and drop the empty sky (trim_top)."""
    x0, z0, x1, z1 = region['rect']
    raw = tl_region.read_box(region_dir, x0, z0, x1, z1, region['y0'], Y_TOP, fold=fold_name, absent='air',
                             tick=lambda: tick('read: chunk'))
    return trim_top(raw, region.get('top_min'))


def crop_box(raw, rect, y0=None):
    """The same box cut down to rect, and to the levels from y0 up (both must lie inside it): the first slot reads
    wide to choose its framing, then keeps exactly what every later slot of that framing will read, so their boxes
    compare cell for cell."""
    bx0, bz0, bx1, bz1 = raw['box']
    x0, z0, x1, z1 = rect
    y0 = raw['y'][0] if y0 is None else y0
    if not (bx0 <= x0 <= x1 <= bx1 and bz0 <= z0 <= z1 <= bz1 and raw['y'][0] <= y0 <= raw['y'][1]):
        return raw
    if list(rect) == list(raw['box']) and y0 == raw['y'][0]:
        return raw
    nx, nz = bx1 - bx0 + 1, bz1 - bz0 + 1
    cells, w = raw['cells'], x1 - x0 + 1
    rows = []
    for yi in range(y0 - raw['y'][0], raw['y'][1] - raw['y'][0] + 1):
        tick('box: crop')
        rows += [cells[((yi * nz) + z - bz0) * nx + x0 - bx0:((yi * nz) + z - bz0) * nx + x0 - bx0 + w] for z in range(z0, z1 + 1)]
    return dict(raw, box=[x0, z0, x1, z1], y=[y0, raw['y'][1]], cells=b''.join(rows))


# ---------------------------------------------------------------- the box snapshot: under-box/<id>/<day>/<stamp>.box.z
def _box_path(root, sid, stamp):
    if not (isinstance(sid, str) and isinstance(stamp, str) and _SCENE_ID.fullmatch(sid) and _STAMP.fullmatch(stamp)):
        raise ValueError(f'box snapshot name {sid!r} {stamp!r}')
    return inside(root, os.path.join(root, 'under-box', sid, stamp[:8], stamp + '.box.z'))


def box_header(path):
    """A snapshot's JSON header alone (a few hundred bytes read). Raises ValueError on anything else."""
    with open(path, 'rb') as f:
        head = f.read(9)
        if len(head) != 9 or head[:4] != BOX_MAGIC:
            raise ValueError(f'{path}: not a box snapshot')
        if head[4] != BOX_VERSION:
            raise ValueError(f'{path}: box snapshot version {head[4]}, this reader knows {BOX_VERSION}')
        n = struct.unpack('>I', head[5:9])[0]
        if n > 1 << 20:
            raise ValueError(f'{path}: header of {n} bytes')
        try:
            hdr = json.loads(f.read(n))
        except ValueError:
            raise ValueError(f'{path}: header is not JSON')
    if not isinstance(hdr, dict) or hdr.get('kind') not in ('full', 'delta'):
        raise ValueError(f'{path}: header without a kind')
    hdr['_at'] = 9 + n
    return hdr


def read_box_file(path):
    """A snapshot -> {box, y, palette, cells, bits: 8, header}. FORMAT (version 1): b'UBOX', one version byte, a
    4-byte big-endian header length, the header (JSON: v, kind, id, stamp, box, y, palette (count), cells (count),
    sha1 of the cells, missing, folded, clipped, base, changed), then ONE zlib stream:
      kind full   the palette as a JSON list, a newline, one palette index per cell (x fastest, then z, then y);
      kind delta  the palette (the base's, with new names appended), a newline, n little-endian uint32 cell
                  indices, n bytes: the cells that differ from the snapshot `base` (a full one in the same folder).
    Every read ends with the sha1 check, so a damaged file or a base that is not the one written against is an
    error (ValueError), never a wrong picture."""
    hdr = box_header(path)
    if not isinstance(hdr.get('cells'), int) or not 0 < hdr['cells'] <= 4 * MAX_BOX_CELLS:
        raise ValueError(f'{path}: a box of {hdr.get("cells")!r} cells')
    with open(path, 'rb') as f:
        f.seek(hdr.pop('_at'))
        data = f.read(hdr['cells'] + (1 << 20))               # a snapshot is never larger than its own cells
    cap = 5 * hdr['cells'] + (1 << 20)                         # ... and never inflates past them (a delta: 5 bytes a cell)
    z, parts, got = zlib.decompressobj(), [], 0
    try:
        while data and not z.eof:                              # a megabyte at a time: the deadline is looked at between
            tick('box: read')
            piece = z.decompress(data, 1 << 20)
            got += len(piece)
            if got > cap:
                raise ValueError(f'{path}: inflates past its {hdr["cells"]} cells')
            parts.append(piece)
            data = z.unconsumed_tail
            if not piece and not data:
                break
    except zlib.error as e:
        raise ValueError(f'{path}: {e}')
    if not z.eof:
        raise ValueError(f'{path}: cut short')
    body = b''.join(parts)
    cut = body.find(b'\n')
    try:
        palette = json.loads(body[:cut]) if cut >= 0 else None
    except ValueError:
        palette = None
    if not isinstance(palette, list) or len(palette) != hdr.get('palette') or len(palette) > 256:
        raise ValueError(f'{path}: palette')
    rest = body[cut + 1:]
    if hdr['kind'] == 'full':
        cells = rest
    else:
        try:
            base = read_box_file(os.path.join(os.path.dirname(path), str(hdr.get('base')) + '.box.z'))
        except OSError as e:
            raise ValueError(f'{path}: its base {hdr.get("base")} cannot be read: {e}')
        if base['header']['kind'] != 'full' or base['box'] != hdr['box'] or base['y'] != hdr['y'] \
                or palette[:len(base['palette'])] != base['palette']:
            raise ValueError(f'{path}: its base {hdr.get("base")} is not the box it was written against')
        n = hdr.get('changed')
        if not isinstance(n, int) or len(rest) != 5 * n:
            raise ValueError(f'{path}: delta of {len(rest)} bytes for {n} cells')
        buf = bytearray(base['cells'])
        idx = struct.unpack('<%dI' % n, rest[:4 * n])
        vals = rest[4 * n:]
        if n and max(idx) >= len(buf):
            raise ValueError(f'{path}: a changed cell outside the box')
        for i, v in zip(idx, vals):
            buf[i] = v
        cells = bytes(buf)
    tick('box: check')
    if len(cells) != hdr.get('cells') or hashlib.sha1(cells).hexdigest() != hdr.get('sha1'):
        raise ValueError(f'{path}: the cells do not match the header (damaged, or a different base)')
    tick('box: check')
    return {'box': hdr['box'], 'y': hdr['y'], 'palette': palette, 'cells': cells, 'bits': 8, 'header': hdr}


def _day_base(folder, stamp, box, y):
    """The full snapshot a new one of this box may be written against: the newest full one in the day's folder,
    older than `stamp`, of the same box. -> its stamp or None. Two header reads at most in the usual day."""
    try:
        names = sorted((n[:-6] for n in os.listdir(folder) if n.endswith('.box.z') and _STAMP.fullmatch(n[:-6]) and n[:-6] < stamp),
                       reverse=True)
    except OSError:
        return None
    seen = set()
    for n in names[:6]:
        try:
            h = box_header(os.path.join(folder, n + '.box.z'))
            b = n if h['kind'] == 'full' else h.get('base')
            if b in seen or not isinstance(b, str) or not _STAMP.fullmatch(b):
                continue
            seen.add(b)
            if b != n:
                h = box_header(os.path.join(folder, b + '.box.z'))
            if h['kind'] == 'full' and h.get('box') == list(box) and h.get('y') == list(y):
                return b
        except (OSError, ValueError):
            continue
    return None


def _deflate(body, level=6, piece=1 << 18):
    """zlib, a quarter of a megabyte at a time: a deadline is looked at between pieces."""
    z = zlib.compressobj(level)
    out = []
    for o in range(0, len(body), piece):
        tick('box: compress')
        out.append(z.compress(body[o:o + piece]))
    out.append(z.flush())
    return b''.join(out)


def build_box_file(root, sid, stamp, raw, extra=None, level=6):
    """A scene's box for a slot, as the bytes of its snapshot file. The day's first box of a given shape is whole; the
    later ones are the cells that differ from it (a slot of mining changes a few hundred of two million), whole
    again when the shape changes, a quarter of the cells differ or the palette would pass 256 names.
    -> (path, data, header). Nothing is written."""
    path = _box_path(root, sid, stamp)
    folder = os.path.dirname(path)
    palette, cells = list(raw['palette']), raw['cells']
    hdr = dict(extra or {}, v=BOX_VERSION, id=sid, stamp=stamp, box=list(raw['box']), y=list(raw['y']), bits=8,
               missing=raw.get('missing') or [], bad_sections=raw.get('bad_sections') or 0, folded=raw.get('folded') or 0)
    body = None
    base = _day_base(folder, stamp, raw['box'], raw['y'])
    if base:
        try:
            B = read_box_file(os.path.join(folder, base + '.box.z'))
            tick('box: base read')
            ext = list(B['palette'])
            where = {n: i for i, n in enumerate(ext)}
            lut = bytearray(256)
            for i, n in enumerate(palette):
                if n not in where:
                    where[n] = len(ext)
                    ext.append(n)
                lut[i] = where[n] if where[n] < 256 else 0
            if len(ext) <= 256 and len(B['cells']) == len(cells):
                mine = cells.translate(bytes(lut))
                n = len(mine)
                diff = (int.from_bytes(mine, 'little') ^ int.from_bytes(B['cells'], 'little')).to_bytes(n, 'little')
                tick('box: compare')
                idx = []
                for a0, a1 in nonzero_runs(diff):
                    idx.extend(range(a0, a1))
                    if len(idx) * 4 > n:
                        break
                if len(idx) * 4 <= n:
                    palette, cells = ext, mine
                    hdr.update(kind='delta', base=base, changed=len(idx))
                    body = json.dumps(ext).encode() + b'\n' + struct.pack('<%dI' % len(idx), *idx) + bytes(mine[i] for i in idx)
        except (OSError, ValueError):
            body = None
    if body is None:
        hdr.update(kind='full', base=None, changed=None)
        body = json.dumps(palette).encode() + b'\n' + cells
    tick('box: hash')
    hdr.update(palette=len(palette), cells=len(cells), sha1=hashlib.sha1(cells).hexdigest())
    tick('box: hash')
    head = json.dumps(hdr, sort_keys=True).encode()
    return path, BOX_MAGIC + bytes([BOX_VERSION]) + struct.pack('>I', len(head)) + head + _deflate(body, level), hdr


def write_box_file(root, sid, stamp, raw, extra=None, level=6):
    """build_box_file, written (whole or not at all). -> (path, bytes, header)."""
    path, data, hdr = build_box_file(root, sid, stamp, raw, extra, level)
    atomic_write(path, data, root)
    return path, len(data), hdr


def first_box_of_day(root, sid, stamp):
    """The path of the scene's first snapshot of the stamp's day, or None."""
    folder = os.path.dirname(_box_path(root, sid, stamp))
    try:
        names = sorted(n for n in os.listdir(folder) if n.endswith('.box.z') and _STAMP.fullmatch(n[:-6]))
    except OSError:
        return None
    return os.path.join(folder, names[0]) if names else None


def dug_cells(first, now):
    """The cells that were rock, ore or built in `first` and are EMPTY in `now` (two Worlds), over what the two boxes
    share: what was dug out between them. A cell that now holds a torch or a ladder is not listed: it is drawn as
    the torch or ladder it is. -> [(x, y, z), ...]. Pure (tested)."""
    x0, z0 = max(first.box[0], now.box[0]), max(first.box[1], now.box[1])
    x1, z1 = min(first.box[2], now.box[2]), min(first.box[3], now.box[3])
    y0, y1 = max(first.yr[0], now.yr[0]), min(first.yr[1], now.yr[1])
    if x0 > x1 or z0 > z1 or y0 > y1:
        return []
    a = first.block(x0, z0, x1, z1, y0, y1).translate(M_SOLID)
    b = now.block(x0, z0, x1, z1, y0, y1).translate(M_AIR)
    n = len(a)
    tick('dug: compare')
    both = (int.from_bytes(a, 'little') & int.from_bytes(b, 'little')).to_bytes(n, 'little')
    tick('dug: compare')
    nx, nz = x1 - x0 + 1, z1 - z0 + 1
    out = []
    for a0, a1 in nonzero_runs(both):
        for i in range(a0, a1):
            yz, x = divmod(i, nx)
            y, z = divmod(yz, nz)
            out.append((x0 + x, y0 + y, z0 + z))
    return out


def thumb_gray(cv, w=320, h=180):
    """The frame as w x h bytes (its green channel, point-sampled): what tl_showcase.changed_fraction compares, without
    ffmpeg."""
    sx, sy = max(1, cv.W // w), max(1, cv.H // h)
    rows = []
    for j in range(h):
        o = min(cv.H - 1, j * sy) * cv.W * 3 + 1
        rows.append(bytes(cv.b[o:o + cv.W * 3:3 * sx][:w]).ljust(w, b'\x00'))
    return b''.join(rows)


def slot_scene(a, scene, stamp, t, size, style):
    """One underground scene of one slot: read its box, find what was dug since the day's first box, draw the frame
    in the scene's kept framing; then its five files (box snapshot, framing, change thumbnail, sidecar, PNG) go into
    place together or not at all (Staged). -> a row for the summary. Raises on anything it cannot do, Deadline
    included (tick() is called all through): the caller counts it, and nothing of the scene is left on disk."""
    t0 = time.time()
    sid = scene['id']
    camera = 'under-' + sid
    root = a.root
    png = inside(root, frame_path(root, camera, stamp))
    bfolder = os.path.dirname(_box_path(root, sid, stamp))
    for folder in (os.path.join(root, 'under-framing'), os.path.dirname(png), bfolder):
        sweep_tmp(folder)                              # this scene's own folders only: a dead writer's leftovers
    tick('start')
    pos, bad = trail_positions(scene.get('trail'))
    kept = load_framing(root, camera, size, style)
    why = framing_holds(kept, scene) if kept else None
    change = None
    frame_for = pad_scene(scene)
    if kept and why:                                   # outgrown: frame anew for the old view AND the new scene
        o, n = kept['box'], frame_for['box']
        both = [min(o[0], n[0]), min(o[1], n[1]), max(o[2], n[2]), max(o[3], n[3])]
        if both[2] - both[0] < UNION_MAX and both[3] - both[1] < UNION_MAX:      # a scene that has walked away is framed alone
            frame_for = dict(frame_for, box=both)
        change = {'why': why, 'was': {k: kept[k] for k in ('axis', 'slab', 'u', 'x', 'z', 'y', 'ppb') if k in kept}}
        kept = None
    fr = held_framing(kept, scene) if kept else None
    region = slot_region(frame_for, fr, size, pos, style, a.slab)
    raw = read_scene_box(a.region_dir, region)
    t_read = time.time() - t0
    world = box_world(raw)
    if not kept:                                       # a first slot: choose the framing on the wide read, keep its box
        fr = held_framing(make_framing(world, pos, frame_for, style, size, t, a.slab), scene)
        again = slot_region(scene, fr, size, pos, style, a.slab)
        raw = trim_top(crop_box(raw, again['rect'], again['y0']), again['top_min'])
        world = box_world(raw)
    tick('box')
    first = first_box_of_day(root, sid, stamp)
    dug = {'cells': [], 'since': stamp}
    if first and os.path.basename(first) != stamp + '.box.z':
        F = read_box_file(first)
        tick('dug: first box read')
        dug = {'cells': dug_cells(box_world(F), world), 'since': F['header']['stamp']}
    bpath, bdata, bhdr = build_box_file(root, sid, stamp, raw, {'clipped': region['clipped'], 'layer': scene.get('layer')})
    t_box = time.time() - t0 - t_read
    cv, sd = render(world, pos, scene, style, t, size, fr, a.trail_min, a.cache, a.slab, dug=dug,
                    clock=parse_stamp(stamp).timestamp())
    gray = thumb_gray(cv)
    gpath = _state_file(root, camera, '.gray')
    try:
        with open(gpath, 'rb') as f:
            prev = f.read()
    except OSError:
        prev = b''
    sd.update(stamp=stamp, camera=camera, changed=round(changed_fraction(prev, gray), 5) if len(prev) == len(gray) else None,
              framing_kept=kept is not None, framing_change=change, box_clipped=region['clipped'],
              block_box={'rect': raw['box'], 'y': raw['y'], 'cells': len(raw['cells']), 'missing_chunks': len(raw['missing']),
                         'missing_why': raw.get('missing_why') or {}, 'bad_sections': raw.get('bad_sections') or 0,
                         'chunks': raw['chunks'], 'snapshot': os.path.relpath(bpath, root), 'snapshot_bytes': len(bdata),
                         'snapshot_kind': bhdr['kind'], 'folded_names': raw['folded']},
              trail_rows_unread=bad)
    sd['render_s'].update(read=round(t_read, 3), box=round(t_box, 3))
    data, side = encode_frame(cv, sd)
    st = Staged()
    try:
        for path, blob in ((bpath, bdata),
                           (_state_file(root, camera, '.json'), json.dumps(dict(fr, version=VERSION), indent=1).encode()),
                           (gpath, gray), (png[:-4] + '.json', side), (png, data)):
            tick('write')                              # the last look at the clock: after it, five renames
            st.add(path, blob, root)
        tick('commit')
        st.commit()
    finally:
        st.abort()
    return {'id': sid, 'seconds': round(time.time() - t0, 3), 'bytes': len(data) + len(side) + len(bdata), 'read_s': round(t_read, 3),
            'dug': len(dug['cells']), 'snapshot': bhdr['kind'], 'missing_chunks': len(raw['missing']),
            'bad_sections': raw.get('bad_sections') or 0}


def run_slot(a, now=None):
    """Every underground scene of the hand-off file, inside the budget. -> the summary. The budget is ONE deadline on
    the monotonic clock for the whole call, running from before the hand-off file is read (a file over
    MAX_HANDOFF_BYTES is refused undecoded): a scene is not started once it has passed (or when the time left is less
    than the slowest scene so far took: why.budget), and a scene it passes during is abandoned at the next tick()
    with nothing written (why.deadline). One scene's failure is a line on stderr and a count. max_step_s is the
    longest the call went without looking at the clock: the most it can overrun."""
    t0 = time.time()
    m0 = _mono()
    now = time.time() if now is None else now
    out = {'scenes': 0, 'drawn': 0, 'skipped': 0, 'errors': 0, 'seconds': 0.0, 'bytes_written': 0, 'why': {}, 'stamp': None}

    def done():
        out['seconds'] = round(time.time() - t0, 3)
        return out
    at = m0 + a.budget_s
    obj = None
    try:
        with deadline(at):                             # the clock runs from the first byte read, not from the first scene
            obj = read_handoff(a.slot_file)
            scenes, why = slot_scenes(obj)
    except Deadline as e:
        listed = obj.get('scenes') if isinstance(obj, dict) else obj
        n = max(1, len(listed)) if isinstance(listed, list) else 1
        out['why'], out['skipped'] = {'deadline': n}, n
        out['overrun_s'] = round(max(0.0, _mono() - at), 4)
        print(f'tl_under slot: out of time ({a.budget_s:g} s) reading the hand-off file ({e}): nothing drawn', file=sys.stderr)
        return done()
    out['scenes'] = len(scenes)
    out['why'] = why
    out['skipped'] = sum(v for k, v in why.items() if k != 'surface')
    stamp = a.stamp or (obj.get('stamp') if isinstance(obj, dict) else None)
    if not isinstance(stamp, str) or not _STAMP.fullmatch(stamp) or parse_stamp(stamp) is None:
        raise ValueError(f'no usable stamp ({stamp!r}): the hand-off file carries "stamp": "20261116T1245Z"')
    out['stamp'] = stamp
    slot_t = parse_stamp(stamp).timestamp()
    if not a.stamp and now - slot_t > a.max_age_min * 60:         # the director did not run this slot: draw nothing old
        out['why']['stale'] = len(scenes)
        out['skipped'] += len(scenes)
        return done()
    t = parse_iso(obj.get('t')) if isinstance(obj, dict) else None
    size = parse_size(a.size)
    style = parse_styles(a.style, ('trails',))[0]
    slowest = 0.0
    step, where = 0.0, None
    for i, sc in enumerate(scenes):
        spent = _mono() - m0
        if spent >= a.budget_s or (i and spent + slowest > a.budget_s):
            out['why']['budget'] = len(scenes) - i
            out['skipped'] += len(scenes) - i
            break
        s0 = _mono()
        try:
            with deadline(at) as dl:
                try:
                    last = max((rows[-1][0] for rows in trail_positions(sc.get('trail'))[0].values()), default=None)
                    row = slot_scene(a, sc, stamp, t if t is not None else (last if last is not None else slot_t), size, style)
                finally:
                    if dl['gap'] > step:
                        step, where = dl['gap'], dl['where']
            out['drawn'] += 1
            out['bytes_written'] += row['bytes']
            out.setdefault('rows', []).append(row)
        except Deadline as e:                         # out of time inside the scene: nothing of it was written
            out['why']['deadline'] = out['why'].get('deadline', 0) + 1
            out['skipped'] += 1
            print(f"tl_under slot: scene {sc.get('id')!r}: abandoned at the {a.budget_s:g} s deadline ({e})", file=sys.stderr)
        except Exception as e:                        # one scene never costs the others, or the capture service
            out['errors'] += 1
            print(f"tl_under slot: scene {sc.get('id')!r}: {type(e).__name__}: {e}", file=sys.stderr)
        slowest = max(slowest, _mono() - s0)
    out['max_step_s'], out['max_step'] = round(step, 4), where
    out['overrun_s'] = round(max(0.0, _mono() - at), 4)
    return done()


def slot_args(argv):
    ap = argparse.ArgumentParser(prog='tl_under.py slot')
    ap.add_argument('--root', default='/srv/showcase/timelapse')
    ap.add_argument('--slot-file', help='default: <root>/logs/scenes-slot.json')
    ap.add_argument('--region-dir', default='/srv/showcase/timelapse/mirror/world/region')
    ap.add_argument('--stamp', help='draw as this slot (no staleness check); default: the stamp in the file')
    ap.add_argument('--style', default='trails')
    ap.add_argument('--size', default='1920x1080')
    ap.add_argument('--budget-s', type=float, default=20.0)
    ap.add_argument('--trail-min', type=int, default=45)
    ap.add_argument('--max-age-min', type=float, default=30.0, help='a hand-off file older than this is not drawn')
    ap.add_argument('--cache', help='a folder for rendered backgrounds (default: none: a slot of mining never reuses one)')
    ap.add_argument('--slab', type=int, default=SLAB)
    a = ap.parse_args(argv)
    a.slot_file = a.slot_file or os.path.join(a.root, 'logs', 'scenes-slot.json')
    return a


def slot_main(argv):
    """`tl_under.py slot ...`: ALWAYS exit status 0 and one JSON line on stdout, whatever happens (the capture
    service runs it after the surface cameras; nothing here may fail that unit)."""
    t0 = time.time()
    out = {'scenes': 0, 'drawn': 0, 'skipped': 0, 'errors': 0, 'seconds': 0.0, 'bytes_written': 0}
    try:
        out = run_slot(slot_args(argv))
    except BaseException as e:                        # argparse's SystemExit too: status 0, and the reason in the line
        if isinstance(e, KeyboardInterrupt):
            raise
        out['errors'] += 1
        out['error'] = f'{type(e).__name__}: {e}'[:300]
        out['seconds'] = round(time.time() - t0, 3)
        print(f'tl_under slot: {out["error"]}', file=sys.stderr)
    try:
        print(json.dumps(out))
    except Exception:
        pass
    return 0


# ---------------------------------------------------------------- thinning the box snapshots (never the frames)
def thin_plan(entries, today, days=14, hourly_after=2):
    """Which box snapshots to delete. entries: [(scene id, 'YYYYMMDD', stamp, base stamp or None)]; today: a date.
    Older than `days` days: all of them. Older than `hourly_after` days: all but the first of each hour, and any
    snapshot a kept one is written against (a delta's base). -> a sorted list of (id, day, stamp). Pure (tested)."""
    gone = []
    groups = collections.defaultdict(list)
    for e in entries:
        groups[(e[0], e[1])].append(e)
    for (sid, day), es in groups.items():
        try:
            age = (today - dt.datetime.strptime(day, '%Y%m%d').date()).days
        except ValueError:
            continue
        if age > days:
            gone += [(sid, day, e[2]) for e in es]
        elif age > hourly_after:
            keep, hours = set(), set()
            for e in sorted(es, key=lambda e: e[2]):
                if e[2][9:11] not in hours:
                    hours.add(e[2][9:11])
                    keep.add(e[2])
            keep |= {e[3] for e in es if e[2] in keep and e[3]}
            gone += [(sid, day, e[2]) for e in es if e[2] not in keep]
    return sorted(gone)


def cmd_thin(a):
    """Delete old box snapshots under <root>/under-box (thin_plan), the framing and change-score files of scenes not
    drawn for `days` days, and every abandoned temporary (<name>.tmp<pid> or .part, more than an hour old) under
    under-box, under-framing and frames/under-*. Frames are never touched: the nightly video job thins those."""
    base = os.path.join(a.root, 'under-box')
    entries, sizes = [], {}
    for sid in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        if not _SCENE_ID.fullmatch(sid):
            continue
        for day in sorted(os.listdir(os.path.join(base, sid))):
            folder = os.path.join(base, sid, day)
            if not _DAY.fullmatch(day) or not os.path.isdir(folder) or os.path.islink(folder):
                continue
            for n in sorted(os.listdir(folder)):
                if not (n.endswith('.box.z') and _STAMP.fullmatch(n[:-6]) and n[:8] == day):
                    continue
                try:
                    b = box_header(os.path.join(folder, n)).get('base')
                except (OSError, ValueError):
                    b = None
                entries.append((sid, day, n[:-6], b))
                sizes[(sid, day, n[:-6])] = os.path.getsize(os.path.join(folder, n))
    today = dt.datetime.strptime(a.today, '%Y%m%d').date() if a.today else dt.datetime.now(UTC).date()
    gone = thin_plan(entries, today, a.days, a.hourly_after_days)
    freed = 0
    for (sid, day, stamp) in gone:
        p = _box_path(a.root, sid, stamp)
        freed += sizes[(sid, day, stamp)]
        if not a.dry_run:
            os.remove(p)
    state = tmp = 0
    if not a.dry_run:
        for top in [os.path.join(a.root, 'under-framing'), base] + sorted(
                os.path.join(a.root, 'frames', n) for n in (os.listdir(os.path.join(a.root, 'frames'))
                                                            if os.path.isdir(os.path.join(a.root, 'frames')) else [])
                if n.startswith('under-')):
            for folder, dirs, _ in os.walk(top):          # abandoned temporaries, wherever a write of ours died
                dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(folder, d))]
                tmp += sweep_tmp(folder)
        for (sid, day) in sorted({(g[0], g[1]) for g in gone}):
            for d in (os.path.join(base, sid, day), os.path.join(base, sid)):
                try:
                    os.rmdir(d)
                except OSError:
                    pass
        sdir = os.path.join(a.root, 'under-framing')
        cut = time.time() - a.days * 86400
        for n in os.listdir(sdir) if os.path.isdir(sdir) else []:
            p = os.path.join(sdir, n)
            if _STATE_FILE.fullmatch(n) and os.path.isfile(p) and os.path.getmtime(p) < cut:
                os.remove(p)
                state += 1
    out = {'snapshots': len(entries), 'deleted': len(gone), 'bytes_freed': freed, 'kept_bytes': sum(sizes.values()) - freed,
           'state_files_deleted': state, 'temporaries_deleted': tmp, 'dry_run': bool(a.dry_run)}
    print(json.dumps(out))
    return out


def cmd_redraw(a):
    """A kept slot again, from its box snapshot, in any style: the rock, and what was dug since the day's first box
    (the bots' positions are not in a box, so no trails)."""
    check_names(a)
    size = parse_size(a.size)
    style = parse_styles(a.style, ('side',))[0]
    if not _SCENE_ID.fullmatch(a.id) or not _STAMP.fullmatch(a.stamp):
        _fail('--id / --stamp: a scene id and a stamp like 20261116T1245Z')
    B = read_box_file(_box_path(a.root, a.id, a.stamp))
    world = box_world(B)
    try:
        side = read_json(inside(a.root, frame_path(a.root, 'under-' + a.id, a.stamp))[:-4] + '.json')
    except (OSError, ValueError):
        side = {}
    scene = {'id': a.id, 'box': side.get('box') or B['box'], 'y': side.get('y') or [B['y'][0] + 12, B['y'][0] + 24],
             'caption': side.get('caption'), 'bots': [], 'layer': side.get('layer')}
    fr = side.get('framing') if (side.get('framing') or {}).get('style') == ('plan' if style.startswith('plan') else 'side') \
        and (side.get('framing') or {}).get('size') == list(size) else None
    first = first_box_of_day(a.root, a.id, a.stamp)
    dug = {'cells': [], 'since': a.stamp}
    if first and os.path.basename(first) != a.stamp + '.box.z':
        F = read_box_file(first)
        dug = {'cells': dug_cells(box_world(F), world), 'since': F['header']['stamp']}
    cv, sd = render(world, {}, pad_scene(scene), style, parse_stamp(a.stamp).timestamp(), size, fr, dug=dug)
    p = inside(a.out, os.path.join(a.out, f'redraw-{a.id}-{a.stamp}-{style}{a.tag}.png'))
    write_frame(cv, sd, p, a.out)
    print(json.dumps({'png': p, 'style': style, 'dug': sd['dug'], 'bytes': sd['bytes']}))


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
    argv = sys.argv[1:] if argv is None else list(argv)
    if argv[:1] == ['slot']:
        return slot_main(argv[1:])
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
    sub.add_parser('slot', help='one call per capture slot: see `tl_under.py slot -h`')
    p = sub.add_parser('thin'); p.add_argument('--root', default='/srv/showcase/timelapse')
    p.add_argument('--days', type=int, default=14); p.add_argument('--hourly-after-days', type=int, default=2)
    p.add_argument('--dry-run', action='store_true'); p.add_argument('--today', help='YYYYMMDD (default: today, UTC)')
    p = sub.add_parser('redraw'); p.add_argument('--root', default='/srv/showcase/timelapse')
    p.add_argument('--id', required=True); p.add_argument('--stamp', required=True); p.add_argument('--style', default='side')
    p.add_argument('--size', default='1920x1080'); p.add_argument('--out', default='.'); p.add_argument('--tag', default='')
    a = ap.parse_args(argv)
    if a.cmd in ('frame', 'seq') and a.root and a.out != '.':
        ap.error('--root and --out are two different places: give one')
    if a.cmd == 'frame':
        cmd_frame(a)
    elif a.cmd == 'seq':
        cmd_seq(a)
    elif a.cmd == 'scenes':
        cmd_scenes(a)
    elif a.cmd == 'palette':
        cmd_palette(a)
    elif a.cmd == 'bench':
        print(json.dumps(bench(parse_size(a.size)), indent=1))
    elif a.cmd == 'thin':
        cmd_thin(a)
    elif a.cmd == 'redraw':
        cmd_redraw(a)
    elif a.cmd == 'video':
        import tl2
        tl2.encode(a.glob, a.fps, a.out, dissolve=False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
