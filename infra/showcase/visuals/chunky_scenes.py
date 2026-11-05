#!/usr/bin/env python3
"""visuals-1105: write the Chunky scene JSONs for the showcase hero views.
    scenes.py SCENE_DIR WORLD_DIR [--spp N] [--width W --height H]
One scene per view; the camera looks from `eye` at `look`. Chunky conventions (measured on a render, 11-05): yaw 0 = -x, PI/2 = +z;
pitch 0 = straight down, -PI/2 = level. The chunk list is every chunk within `radius` blocks of `look`."""
import argparse, json, math, os

VIEWS = {
    # name: eye (x,y,z), look (x,y,z), fov deg, radius blocks
    'town':     dict(eye=(58, 112, 60), look=(-10, 70, -6), fov=45, radius=176),
    'hallwall': dict(eye=(-62, 104, 72), look=(-12, 70, 16), fov=45, radius=144),
    'ziggurat': dict(eye=(-2, 100, -78), look=(-39, 74, -28), fov=45, radius=144),
}


def camera(eye, look, fov):
    dx, dy, dz = (look[i] - eye[i] for i in range(3))
    yaw = math.atan2(dz, -dx)          # measured 11-05: yaw 0 looks along -x, yaw PI/2 along +z (the doc comment in Camera.java is off)
    below = math.atan2(-dy, math.hypot(dx, dz))            # angle below the horizon
    pitch = -(math.pi / 2 - below)
    return {'name': 'camera 1', 'position': {'x': eye[0], 'y': eye[1], 'z': eye[2]},
            'orientation': {'roll': 0.0, 'pitch': pitch, 'yaw': yaw},
            'projectionMode': 'PINHOLE', 'fov': fov, 'dof': 'Infinity', 'focalOffset': 2.0}


def chunks(look, radius):
    cx0, cz0 = int(look[0]) >> 4, int(look[2]) >> 4
    r = radius // 16 + 1
    return [[cx, cz] for cx in range(cx0 - r, cx0 + r + 1) for cz in range(cz0 - r, cz0 + r + 1)
            if math.hypot((cx - cx0) * 16, (cz - cz0) * 16) <= radius + 16]


def scene(name, v, world, spp, w, h):
    return {
        'sdfVersion': 9, 'name': name, 'width': w, 'height': h,
        'world': {'path': world, 'dimension': 0},
        'chunkList': chunks(v['look'], v['radius']),
        'camera': camera(v['eye'], v['look'], v['fov']),
        'sppTarget': spp, 'spp': 0, 'renderTime': 0,
        'exposure': 1.15, 'outputMode': 'PNG', 'saveSnapshots': False,
        'rayDepth': 5, 'emittersEnabled': False, 'sunEnabled': True,
        'transparentSky': False, 'renderActors': True, 'stillWater': True,
        'yClipMin': 40, 'yClipMax': 200,
        # a warm, low late-afternoon sun from the south-west: long soft shadows across the town
        'sun': {'altitude': math.radians(32), 'azimuth': math.radians(215), 'intensity': 1.35,
                'color': {'red': 1.0, 'green': 0.9, 'blue': 0.76}, 'drawTexture': True},
        'sky': {'skyYaw': 0.0, 'skyMirrored': True, 'skyLight': 1.0, 'mode': 'SIMULATED'},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scene_dir'); ap.add_argument('world')
    ap.add_argument('--spp', type=int, default=512)
    ap.add_argument('--width', type=int, default=1920); ap.add_argument('--height', type=int, default=1080)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    for name, v in VIEWS.items():
        if a.only and name not in a.only.split(','):
            continue
        d = os.path.join(a.scene_dir, name)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f'{name}.json'), 'w') as f:
            json.dump(scene(name, v, a.world, a.spp, a.width, a.height), f, indent=1)
        print(name, len(scene(name, v, a.world, a.spp, a.width, a.height)['chunkList']), 'chunks')


if __name__ == '__main__':
    main()
