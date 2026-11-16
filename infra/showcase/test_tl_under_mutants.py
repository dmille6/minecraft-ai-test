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
FILES = ('tl_under.py', 'tl_region.py', 'test_tl_under.py', 'tl_showcase.py')

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
    # the 11-16 review's five blockers
    ("        prune_cache(cache, keep=(os.path.basename(path),))", "        pass", 'test_rendering_keeps_the_disk_cache_bounded'),
    ("            drop = n not in keep and (now - mtime > max_age_s or n_kept >= max_files or b_kept + size > max_bytes)",
     "            drop = n not in keep and (now - mtime > max_age_s or b_kept + size > max_bytes)",
     'test_the_disk_cache_is_pruned_by_count_bytes_and_age'),
    ("            drop = n not in keep and (now - mtime > max_age_s or n_kept >= max_files or b_kept + size > max_bytes)",
     "            drop = n not in keep and (now - mtime > max_age_s or n_kept >= max_files)",
     'test_the_disk_cache_is_pruned_by_count_bytes_and_age'),
    ("            drop = n not in keep and (now - mtime > max_age_s or n_kept >= max_files or b_kept + size > max_bytes)",
     "            drop = n not in keep and (n_kept >= max_files or b_kept + size > max_bytes)",
     'test_the_disk_cache_is_pruned_by_count_bytes_and_age'),
    ("            drop = n not in keep and (now - mtime > max_age_s or n_kept >= max_files or b_kept + size > max_bytes)",
     "            drop = (now - mtime > max_age_s or n_kept >= max_files or b_kept + size > max_bytes)",
     'test_the_disk_cache_is_pruned_by_count_bytes_and_age'),
    ("            drop = now - mtime > 600  ", "            drop = True  ", 'test_the_disk_cache_is_pruned_by_count_bytes_and_age'),
    ("    while len(_BG) > BG_MEM_MAX:", "    while False:", 'test_backgrounds_read_from_disk_do_not_pile_up_in_memory'),
    ("                _bg_put(key, buf, info)", "                _BG[key] = (buf, info)",
     'test_backgrounds_read_from_disk_do_not_pile_up_in_memory'),
    ("        if last is None:\n            return math.floor(", "        if False:\n            return math.floor(",
     'test_a_scene_with_no_bots_is_drawn_as_rock_and_says_so'),
    ("    if not 0 <= a.pick < len(scenes):", "    if False:", 'test_no_scene_is_a_refusal_before_anything_is_written'),
    ("    if not scenes:\n        print('tl_under: no scenes", "    if False:\n        print('tl_under: no scenes",
     'test_no_scene_is_a_refusal_before_anything_is_written'),
    ("    if a.root:\n        return inside(a.root, frame_path(a.root, camera, stamp)), a.root",
     "    if False:\n        return inside(a.root, frame_path(a.root, camera, stamp)), a.root",
     'test_seq_writes_under_root_when_root_is_given'),
    ("    if os.path.commonpath([b, q]) != b or q == b:", "    if False:", 'test_a_path_must_stay_inside_its_folder'),
    ("    inside(base, png_path)\n", "    pass\n", 'test_a_path_must_stay_inside_its_folder'),
    ("    if not _TAG.match(a.tag or ''):", "    if False:", 'test_tag_style_and_scene_id_cannot_escape'),
    ("        if st not in STYLES:", "        if False:", 'test_tag_style_and_scene_id_cannot_escape'),
    ("    return re.sub(r'[^A-Za-z0-9_]', '_', f\"{str(scene['id'])[:60]}_{style}\")", "    return f\"{str(scene['id'])[:60]}_{style}\"",
     'test_tag_style_and_scene_id_cannot_escape'),
    # the production step: the region reader (tl_region.py)
    ("        out[k::per] = ((big >> (k * bits)) & mask).to_bytes(n * 8, 'little')[0::8]",
     "        out[k::per] = ((big >> (k * 8)) & mask).to_bytes(n * 8, 'little')[0::8]",
     'test_section_bytes_is_section_values_for_every_bit_width', 'tl_region.py'),
    ("        except (OSError, zlib.error, struct.error, IndexError, ValueError, UnicodeError, MemoryError):", "        except MemoryError:",
     'test_a_torn_region_file_costs_chunks_not_the_call', 'tl_region.py'),
    ("                        if absent is None:\n                            continue", "                        if True:\n                            continue",
     'test_states_and_what_is_not_there', 'tl_region.py'),
    ("            if len(palette) >= max_real:", "            if False:", 'test_a_full_palette_folds_names_to_their_class', 'tl_region.py'),
    ("    raw = tl_region.read_box(region_dir, x0, z0, x1, z1, region['y0'], Y_TOP, fold=fold_name, absent='air')",
     "    raw = tl_region.read_box(region_dir, x0, z0, x1, z1, region['y0'], Y_TOP, fold=fold_name)",
     'test_a_scene_box_has_sky_over_it_not_unknown'),
    ("except ImportError:\n    COLORS, compass = FB_COLORS, fb_compass", "except ZeroDivisionError:\n    COLORS, compass = FB_COLORS, fb_compass",
     'test_it_runs_from_a_flat_install'),
    # ... which scenes are drawn
    ("        elif layer not in UNDER_LAYERS:", "        elif False:", 'test_a_slot_draws_its_underground_scenes_and_only_those'),
    ("        elif s.get('camera'):", "        elif False:", 'test_a_slot_draws_its_underground_scenes_and_only_those'),
    ("        elif check_scene(s):", "        elif False:", 'test_a_slot_draws_its_underground_scenes_and_only_those'),
    ("    if not isinstance(s.get('id'), str) or not _SCENE_ID.match(s['id']):", "    if False:", 'test_what_a_hand_off_scene_may_say'),
    ("    if s.get('frames') is not None and s['frames'] != 'frames/under-' + s['id']:", "    if False:", 'test_what_a_hand_off_scene_may_say'),
    # ... the framing that holds
    ("    gx, gz = max(0, min_w - (x1 - x0 + 1)), max(0, min_w - (z1 - z0 + 1))", "    gx, gz = 0, 0", 'test_a_tiny_scene_is_framed_wide'),
    ("    gx, gz = max(0, min_w - (x1 - x0 + 1)), max(0, min_w - (z1 - z0 + 1))", "    gx, gz = 0, 0",
     'test_a_tiny_scene_with_no_trail_is_framed_wide_and_drawn_without_bots'),
    ("        if ua < fr['u'][0] - slack or ub > fr['u'][1] + slack:", "        if False:", 'test_a_framing_holds_until_the_scene_outgrows_it'),
    ("        if fr['slab'][1] < da - reach or fr['slab'][0] > db + reach:", "        if False:", 'test_a_framing_holds_until_the_scene_outgrows_it'),
    ("    kept = load_framing(root, camera, size, style)", "    kept = None", 'test_the_second_slot_keeps_the_framing_and_shows_what_was_dug'),
    ("    if kept and why:   ", "    if kept:   ", 'test_the_second_slot_keeps_the_framing_and_shows_what_was_dug'),
    ("    why = framing_holds(kept, scene) if kept else None", "    why = None", 'test_a_scene_that_outgrows_its_framing_is_framed_anew_and_says_so'),
    ("        raw = trim_top(crop_box(raw, again['rect'], again['y0']), again['top_min'])", "        pass",
     'test_the_second_slot_keeps_the_framing_and_shows_what_was_dug'),
    ("    while (x1 - x0 + 1) * (z1 - z0 + 1) * ny > max_cells:", "    while False:", 'test_a_box_too_large_is_cut_back_around_the_scene'),
    ("    keep = min(ny, top + 1 + SKY_ROWS)", "    keep = ny", 'test_the_top_of_a_box_is_the_sky_it_needs'),
    ("        keep = min(ny, max(keep, top_min - y0 + 1))", "        keep = keep", 'test_the_top_of_a_box_is_the_sky_it_needs'),
    # ... the box snapshot
    ("                if len(idx) * 4 <= n:", "                if False:", 'test_a_box_round_trips_whole_and_as_a_delta'),
    ("    if len(cells) != hdr.get('cells') or hashlib.sha1(cells).hexdigest() != hdr.get('sha1'):", "    if False:",
     'test_a_damaged_or_foreign_snapshot_is_refused'),
    ("        if head[4] != BOX_VERSION:", "        if False:", 'test_a_damaged_or_foreign_snapshot_is_refused'),
    ("            if h['kind'] == 'full' and h.get('box') == list(box) and h.get('y') == list(y):", "            if h['kind'] == 'full':",
     'test_when_a_box_is_written_whole_again'),
    ("    h.update(raw['cells'].translate(w.lut))", "    h.update(raw['cells'])", 'test_a_box_round_trips_whole_and_as_a_delta'),
    ("    if not _SCENE_ID.match(sid) or not _STAMP.match(stamp):\n        raise ValueError(f'box snapshot name",
     "    if False:\n        raise ValueError(f'box snapshot name", 'test_a_damaged_or_foreign_snapshot_is_refused'),
    # ... dug since the day's first box
    ("    a = first.block(x0, z0, x1, z1, y0, y1).translate(M_SOLID)", "    a = first.block(x0, z0, x1, z1, y0, y1).translate(M_GROUND)",
     'test_what_was_dug_between_two_boxes'),
    ("    b = now.block(x0, z0, x1, z1, y0, y1).translate(M_AIR)", "    b = now.block(x0, z0, x1, z1, y0, y1).translate(M_HOLLOW)",
     'test_what_was_dug_between_two_boxes'),
    ("    if first and os.path.basename(first) != stamp + '.box.z':\n        F = read_box_file(first)\n        dug = {'cells': dug_cells(box_world(F), world), 'since': F['header']['stamp']}\n    t_box",
     "    if False:\n        F = read_box_file(first)\n        dug = {'cells': dug_cells(box_world(F), world), 'since': F['header']['stamp']}\n    t_box",
     'test_the_second_slot_keeps_the_framing_and_shows_what_was_dug'),
    ("        mine = [c for c in dug['cells'] if in_cut(fr, c[0] + 0.5, c[1], c[2] + 0.5, 0.0)]", "        mine = list(dug['cells'])",
     'test_the_second_slot_keeps_the_framing_and_shows_what_was_dug'),
    ("changed=round(changed_fraction(prev, gray), 5) if len(prev) == len(gray) else None", "changed=None",
     'test_the_second_slot_keeps_the_framing_and_shows_what_was_dug'),
    # ... the budget, one scene's failure, never a failure of the call
    ("        if spent >= a.budget_s or (i and spent + slowest > a.budget_s):", "        if False:", 'test_the_budget_and_one_scene_that_fails'),
    ("            out['errors'] += 1\n            print(f\"tl_under slot: scene", "            raise\n            print(f\"tl_under slot: scene",
     'test_the_budget_and_one_scene_that_fails'),
    ("    except BaseException as e:", "    except ZeroDivisionError as e:",
     'test_slot_never_fails_the_capture'),
    ("    if not isinstance(stamp, str) or not _STAMP.match(stamp) or parse_stamp(stamp) is None:", "    if False:",
     'test_slot_never_fails_the_capture'),
    ("    if not a.stamp and now - slot_t > a.max_age_min * 60:", "    if False:", 'test_a_stale_hand_off_file_is_not_drawn'),
    # ... thinning
    ("        if age > days:\n            gone += [(sid, day, e[2]) for e in es]", "        if False:\n            gone += [(sid, day, e[2]) for e in es]",
     'test_which_snapshots_go'),
    ("                if e[2][9:11] not in hours:", "                if True:", 'test_which_snapshots_go'),
    ("            keep |= {e[3] for e in es if e[2] in keep and e[3]}", "            keep |= set()", 'test_which_snapshots_go'),
    ("    base = os.path.join(a.root, 'under-box')\n    entries, sizes = [], {}", "    base = os.path.join(a.root, 'frames')\n    entries, sizes = [], {}",
     'test_thin_deletes_boxes_and_never_frames'),
    # ... the caption and the roster count the same bots; the legend fits
    ("    return sorted(b for b, v in now.items() if v[1] < under_y)", "    return sorted(now)", 'test_the_caption_and_the_roster_count_the_same_bots'),
    ("            return [str(b) for b in scene['bots']]", "            return sorted(now)", 'test_the_caption_and_the_roster_count_the_same_bots'),
    ("    cap = cap or frame_caption(pos, scene, counted, t, trail_min)", "    cap = cap or frame_caption(pos, scene, sorted(now), t, trail_min)",
     'test_a_drawn_frame_counts_once'),
    ("        if len(items) * (ks + gap) - gap <= y1 - y0:\n            break", "        if True:\n            break",
     'test_the_legend_fits_both_frame_sizes'),
    ("        while len(sw) > 1 and x0 + len(sw) * (ks + u) + u + text_w(lab, small) > x1:", "        while False:",
     'test_the_legend_fits_both_frame_sizes'),
    # the PNG
    ("            rows.append(same)", "            rows.append(b'\\x00' + bytes(stride))", 'test_round_trip'),
    ("        assert struct.unpack_from('>I', data, i + 8 + n)[0] == zlib.crc32(t + d) & 0xffffffff, 'bad CRC'", "        pass",
     'test_a_damaged_file_is_refused'),
]


def main():
    failed = 0
    for old, new, test, *rest in MUTANTS:
        fn = rest[0] if rest else 'tl_under.py'
        with tempfile.TemporaryDirectory() as d:
            dst = os.path.join(d, 'infra', 'showcase')
            os.makedirs(dst)
            for f in FILES:
                shutil.copy(os.path.join(HERE, f), dst)
            shutil.copytree(os.path.join(HERE, 'tl2'), os.path.join(dst, 'tl2'), ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copytree(os.path.join(ROOT, 'scripts', 'lib'), os.path.join(d, 'scripts', 'lib'),
                            ignore=shutil.ignore_patterns('__pycache__'))
            os.makedirs(os.path.join(d, 'scripts', 'host'))
            shutil.copy(os.path.join(ROOT, 'scripts', 'host', 'townplan_blockdump.py'), os.path.join(d, 'scripts', 'host'))
            p = os.path.join(dst, fn)
            src = open(p).read()
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {old[:70]!r} ({src.count(old)})'
            open(p, 'w').write(src.replace(old, new, 1))
            r = subprocess.run([sys.executable, '-W', 'ignore', os.path.join(dst, 'test_tl_under.py'), '-k', test],
                               capture_output=True, text=True, timeout=300)
            # KILLED only by the INTENDED assertion: the named test must FAIL (not error out for an unrelated reason)
            killed = r.returncode != 0 and f'FAIL: {test} ' in r.stderr
            print(f"  {'KILLED' if killed else 'SURVIVED'}  {fn}: {old.strip().splitlines()[0][:70]}  (by {test})")
            failed += 0 if killed else 1
    print(f'{len(MUTANTS) - failed} of {len(MUTANTS)} mutants killed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
