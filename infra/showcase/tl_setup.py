#!/usr/bin/env python3
"""ON THE SHOWCASE VM, as mike: write the BlueMap config and tl.conf for the chosen home (once, before frame 0).
    tl_setup.py --home X,Y,Z [--capture-min 15] [--mask-half 384]
Static lighting (sky-light 1, ambient 0.1), file storage, one map `showcase` reading the timelapse MIRROR (never the
live world). Cameras: topdown = flat orthographic over ~192 x 192 blocks; angled = fixed perspective (the same
45-degree style as .30's ziggurat timelapse). Design: docs/reports/showcase-2026-10-20.md section 6.
"""
import argparse, json, math, os

BM = '/srv/showcase/bluemap'
TL = '/srv/showcase/timelapse'

CORE = '''accept-download: true
data: "data"
render-thread-count: 4
scan-for-mod-resources: false
metrics: false
'''
WEBSERVER = '''enabled: true
webroot: "web"
port: 8100
'''
WEBAPP = '''enabled: true
webroot: "web"
update-settings-file: true
use-cookies: true
default-to-flat-view: false
min-zoom-distance: 5
max-zoom-distance: 100000
resolution-default: 1
hires-slider-max: 500
hires-slider-default: 200
hires-slider-min: 0
lowres-slider-max: 7000
lowres-slider-default: 2000
lowres-slider-min: 500
scripts: [
]
styles: [
]
'''
STORAGE = '''storage-type: file
root: "web/maps"
compression: gzip
'''
MAP = '''world: "{world}"
dimension: "minecraft:overworld"
name: "Showcase town"
sorting: 0
start-pos: {{ x: {x}, z: {z} }}
sky-color: "#7dabff"
void-color: "#000000"
sky-light: 1
ambient-light: 0.1
remove-caves-below-y: 55
cave-detection-ocean-floor: 10
cave-detection-uses-block-light: false
min-inhabited-time: 0
render-mask: [
  {{ min-x: {x0}, max-x: {x1}, min-z: {z0}, max-z: {z1}, min-y: -64, max-y: 320 }}
]
render-edges: true
edge-light-strength: 8
enable-perspective-view: true
enable-flat-view: true
enable-free-flight-view: true
enable-hires: true
storage: "file"
ignore-missing-light-data: false
marker-sets: {{
  town: {{ label: "Town", toggleable: true, default-hidden: false, markers: {{
    home: {{ type: "poi", position: {{ x: {x}, y: {y}, z: {z} }}, label: "showcase home" }}
  }} }}
}}
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--home', required=True)
    ap.add_argument('--capture-min', type=int, default=15)
    ap.add_argument('--mask-half', type=int, default=384)
    a = ap.parse_args()
    x, y, z = (int(v) for v in a.home.split(','))
    os.makedirs(f'{BM}/config/maps', exist_ok=True)
    os.makedirs(f'{BM}/config/storages', exist_ok=True)
    for name, txt in (('core.conf', CORE), ('webserver.conf', WEBSERVER), ('webapp.conf', WEBAPP)):
        open(f'{BM}/config/{name}', 'w').write(txt)
    open(f'{BM}/config/storages/file.conf', 'w').write(STORAGE)
    h = a.mask_half
    open(f'{BM}/config/maps/showcase.conf', 'w').write(MAP.format(world=f'{TL}/mirror/world', x=x, y=y, z=z,
                                                                  x0=x - h, x1=x + h, z0=z - h, z1=z + h))
    ang = math.radians(50)
    cfg = {
        'capture_min': a.capture_min, 'root': TL, 'world': '/srv/showcase/server/world', 'mirror': f'{TL}/mirror/world',
        'home': [x, y, z], 'mask_half': h, 'map_id': 'showcase', 'jar': f'{BM}/bluemap-cli.jar',
        'bm_conf': f'{BM}/config', 'bm_home': BM, 'web': 'http://127.0.0.1:8100', 'capture_dir': f'{TL}/capture',
        'heartbeat': '/var/log/showcase/heartbeat.jsonl', 'width': 1920, 'height': 1080, 'settle_ms': 8000,
        'min_free_gb': 20, 'render_heap': '3G', 'render_timeout_s': 600, 'capture_timeout_s': 400,
        'save_hold': True, 'save_wait_s': 120, 'brain_healthz': 'http://127.0.0.1:11612/healthz',
        'cameras': {
            # flat orthographic view centred on home; distance tuned on the first render to span ~192 x 192 blocks
            'topdown': {'x': x + 0.5, 'y': y, 'z': z + 0.5, 'distance': 200, 'rotation': 0.0, 'angle': 0.0,
                        'ortho': 1, 'mode': 'flat', 'fov': None},
            # fixed perspective: looking north at 50 degrees from the south, the town in the lower-middle third
            'angled': {'x': x + 0.5, 'y': y, 'z': z - 20.5, 'distance': 330, 'rotation': 0.0, 'angle': round(ang, 4),
                       'ortho': 0, 'mode': 'perspective', 'fov': 35},
            # owner 10-25: the TOWN close-up -- flat orthographic, square, on home; distance 95 at 1440 x 1440 spans
            # ~ +-57 blocks (12.7 px a block, measured 10-25 against the taiga village's west edge at x 49): the storehouse,
            # the workshop, the ring out to ~60
            'town': {'x': x + 0.5, 'y': y, 'z': z + 0.5, 'distance': 95, 'rotation': 0.0, 'angle': 0.0,
                     'ortho': 1, 'mode': 'flat', 'fov': None, 'width': 1440, 'height': 1440},
        },
    }
    os.makedirs(TL, exist_ok=True)
    json.dump(cfg, open(f'{TL}/tl.conf', 'w'), indent=1)
    print(f'wrote {BM}/config and {TL}/tl.conf for home {x},{y},{z} (mask +-{h}, every {a.capture_min} min)')


if __name__ == '__main__':
    main()
