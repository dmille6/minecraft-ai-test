#!/usr/bin/env python3
"""Mutants for the underground pictures (tl_under.py): each must make its own test in test_tl_under.py FAIL. The
pattern of test_showcase_mutants.py: every anchor is asserted present and unique before it is replaced (CLAUDE.md: a
mutant that silently fails to apply reads as killed), and a mutant counts as killed only by the named test's failure.

    python3 infra/showcase/test_tl_under_mutants.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FILES = ('tl_under.py', 'test_tl_under.py', 'tl_showcase.py')

MUTANTS = [
    # the scene finder
    ("    return SKILL_W.get(skill, SKILL_W_OTHER)", "    return 1.0", 'test_miners_outrank_walkers'),
    ("            if y < under_y and (bounds is None or", "            if True and (bounds is None or", 'test_surface_bots_are_not_underground'),
    ("                    if any(ox < t[0] + span and t[0] < ox + span and oz < t[1] + span and t[1] < oz + span for t in taken):",
     "                    if False:", 'test_scenes_do_not_overlap'),
    ("    lo = hi - window_min * 60 if window_min else -1e99", "    lo = -1e99", 'test_bounds_and_window'),
    ("        if acc >= need - 1e-9 and (best is None or v - vw[i][0] < best[1] - best[0]):",
     "        if acc >= need - 1e-9 and best is None:", 'test_densest_band'),
    # the cut
    ("    axis = 'x' if sx >= sz else 'z'", "    axis = 'z' if sx >= sz else 'x'", 'test_the_axis_is_the_one_the_bots_spread_along'),
    ("        w = sum(hist.get(d, 0.0) for d in range(d0, d0 + thick))", "        w = 0.0", 'test_the_slab_is_the_busiest_one'),
    ("        if best is None or w > best[0] + 1e-9:", "        if best is None:", 'test_plan_band'),
    ("    comb = _combine_open if fr.get('mode', 'open') == 'open' else _combine_near", "    comb = _combine_near",
     'test_a_tunnel_reads_as_open_space_and_rock_as_rock'),
    ("    comb = _combine_open if fr.get('mode', 'open') == 'open' else _combine_near", "    comb = _combine_open",
     'test_nearest_wins_hides_a_tunnel_inside_the_slab'),
    ("                p[o::U] = p[o::U].translate(T_SKY)", "                pass", 'test_sky_is_on_top_and_the_surface_under_it'),
    ("    if best is not None and bp >= 7:\n        return best, 0", "    if False:\n        return best, 0",
     'test_a_tunnel_reads_as_open_space_and_rock_as_rock'),
    ("        f = m.rfind(b'\\x00', 0, t)", "        f = m.find(b'\\x00')", 'test_roof_off'),
    # framing and the picture
    ("        return ox + (u - fr['u'][0]) * k, oy + (fr['y'][1] + 1 - y) * k", "        return ox + (u - fr['u'][0]) * k, oy + (y - fr['y'][0]) * k",
     'test_world_to_pixel'),
    ("    ok = (fr.get('box') == list(scene['box']) and", "    ok = (True and", 'test_the_kept_framing_is_for_one_scene_box'),
    ("    fr = framing or make_framing(world, pos, scene, style, size, t, thick, mode, ghost=ghost)",
     "    fr = make_framing(world, pos, scene, style, size, t, thick + (int(t) // 300) % 2 * 2, mode, ghost=ghost)",
     'test_two_slots_of_one_scene_share_one_framing'),
    ("                if not is_base and pattern in ('ore', 'chest', 'furnace', 'torch'):\n                    return c",
     "                if False:\n                    return c", 'test_ores_stand_out_from_their_rock_and_from_each_other'),
    # the bots
    ("        if j < 0 or t - rows[j][0] > ONLINE.total_seconds():", "        if j < 0:", 'test_a_bot_gone_quiet_is_left_out'),
    ("    return d <= GAP_S and hd <= MAX_JUMP and", "    return hd <= MAX_JUMP and", 'test_trail_breaks'),
    ("                if cell not in out and KIND[world.class_at(*cell)] in 're':", "                if cell not in out:",
     'test_cells_dug_since_the_scan'),
    ("            if y >= under_y or not in_cut(fr, x, y, z, 0.0):", "            if y >= under_y:", 'test_cells_dug_since_the_scan'),
    ("        return fr['slab'][0] - slack <= d <= fr['slab'][1] + 1 + slack", "        return True", 'test_who_is_in_the_picture'),
    # the PNG
    ("            rows.append(same)", "            rows.append(b'\\x00' + bytes(stride))", 'test_round_trip'),
    ("        assert struct.unpack_from('>I', data, i + 8 + n)[0] == zlib.crc32(t + d) & 0xffffffff, 'bad CRC'", "        pass",
     'test_a_damaged_file_is_refused'),
]


def main():
    failed = 0
    for old, new, test in MUTANTS:
        with tempfile.TemporaryDirectory() as d:
            dst = os.path.join(d, 'infra', 'showcase')
            os.makedirs(dst)
            for f in FILES:
                shutil.copy(os.path.join(HERE, f), dst)
            shutil.copytree(os.path.join(HERE, 'tl2'), os.path.join(dst, 'tl2'), ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copytree(os.path.join(ROOT, 'scripts', 'lib'), os.path.join(d, 'scripts', 'lib'),
                            ignore=shutil.ignore_patterns('__pycache__'))
            p = os.path.join(dst, 'tl_under.py')
            src = open(p).read()
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {old[:70]!r} ({src.count(old)})'
            open(p, 'w').write(src.replace(old, new, 1))
            r = subprocess.run([sys.executable, '-W', 'ignore', os.path.join(dst, 'test_tl_under.py'), '-k', test],
                               capture_output=True, text=True, timeout=300)
            # KILLED only by the INTENDED assertion: the named test must FAIL (not error out for an unrelated reason)
            killed = r.returncode != 0 and f'FAIL: {test} ' in r.stderr
            print(f"  {'KILLED' if killed else 'SURVIVED'}  {old.strip()[:70]}  (by {test})")
            failed += 0 if killed else 1
    print(f'{len(MUTANTS) - failed} of {len(MUTANTS)} mutants killed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
