#!/usr/bin/env python3
"""Build a fresh-world rehearsal's bot env files from the showcase release's pinned control env. Pure core (tested).

    make_rehearsal_env.py --control <release>/control.env --site rehearsal-0.town-site.json --sha <40-hex> \
                          --run rehearsal-0 --out-dir DIR [--bots 12]

A rehearsal runs THE SHOWCASE'S RELEASE on a different world, so every policy knob comes from the release's control
env exactly as `infra/showcase/make_env.py` takes it (its `policy_of` is reused, not copied). Three things differ:

  MEMORY_POOL stays `showcase`.  35 switches in the release default to the pool name `showcase` and one size table
      compares against it (ziggurat.mjs); a new pool name would silently switch the town features off and the
      rehearsal would test a different bot. The world, the host and the state directories are separate, so nothing
      is shared with the real showcase.
  EXP_ARM / EXP_INSTANCE = `rehearsal`, EXP_BLOCK = RUN_ID's run (`rehearsal-0`).  These are log labels only (the
      release reads them in config.mjs and logger.mjs and nowhere else): they are what tells a rehearsal row from a
      showcase row.
  BOT_NAME is `rh0-<Name>`, so no bot shares a name with a showcase bot.
"""
import argparse, importlib.util, json, os, re, sys
from pathlib import Path

_here = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('show_make_env', _here.parent / 'showcase' / 'make_env.py')
SME = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SME)

NAMES = SME.NAMES[:12]                      # Alpha .. Lumen
PREFIX = 'rh0-'
POOL = 'showcase'                           # see the docstring: the release's switches key on this name
LABEL = 'rehearsal'
BRAIN = SME.BRAIN                           # the VM's own tunnel end; the endpoint behind it is the manifest's call
BRAIN_MODEL = SME.BRAIN_MODEL


def build_env(control, i, site, sha, run):
    """-> ordered list of (key, value) for bot NAMES[i]."""
    if not re.fullmatch(r'[0-9a-f]{40}', sha or ''):
        raise ValueError(f'sha must be 40 hex, got {sha!r}')
    if not re.fullmatch(r'rehearsal-[0-9]+', run or ''):
        raise ValueError(f'run must be rehearsal-<n>, got {run!r}')
    name = PREFIX + NAMES[i]
    if len(name) > 16:
        raise ValueError(f'{name} is longer than the 16-character Minecraft limit')
    pol = SME.policy_of(control)
    home, board = site['home'], site['board']
    mine = [
        ('BOT_NAME', name),
        ('MINECRAFT_HOST', '127.0.0.1'), ('MINECRAFT_PORT', str(site.get('port', 25565))),
        ('HOME_X', str(home[0])), ('HOME_Y', str(home[1])), ('HOME_Z', str(home[2])),
        ('BOARD_X', str(board[0])), ('BOARD_Y', str(board[1])), ('BOARD_Z', str(board[2])),
        ('WORLD_BORDER_RADIUS', str(site['border_radius'])),
        ('MEMORY_POOL', POOL), ('MEMORY_SCOPE', 'board'),
        ('EXP_ARM', LABEL), ('EXP_INSTANCE', LABEL), ('EXP_BLOCK', run),
        ('RUN_ID', f'{run}-{sha[:8]}'),
        ('OLLAMA_MODEL', BRAIN_MODEL),
        ('OLLAMA_BASE_URLS', f'{BRAIN}|{BRAIN_MODEL}'),
        ('OLLAMA_BASE_URL', BRAIN),
        ('CODE_VERSION', sha),
        ('VIEWER_PORT', str(3200 + i)),
        ('LOG_DIR', f'/var/log/mcai/{name}'), ('STATE_DIR', f'/var/lib/mcai/{name}'),
    ]
    rows = sorted(pol.items()) + mine
    text = '\n'.join(f'{k}={v}' for k, v in rows)
    for h in SME.FORBIDDEN_HOSTS:
        if h in text:
            raise ValueError(f'refusing: the env would name {h} (a bench model host; never used by a rehearsal)')
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control', required=True)
    ap.add_argument('--site', required=True)
    ap.add_argument('--sha', required=True)
    ap.add_argument('--run', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--bots', type=int, default=12)
    a = ap.parse_args()
    if not 1 <= a.bots <= len(NAMES):
        raise SystemExit(f'--bots must be 1..{len(NAMES)}')
    control = SME.parse_env(open(a.control).read())
    site = json.load(open(a.site))
    os.makedirs(a.out_dir, exist_ok=True)
    for i in range(a.bots):
        rows = build_env(control, i, site, a.sha, a.run)
        p = os.path.join(a.out_dir, f'{PREFIX}{NAMES[i]}.env')
        with open(p + '.tmp', 'w') as f:
            f.write('\n'.join(f'{k}={v}' for k, v in rows) + '\n')
        os.replace(p + '.tmp', p)
    print(f'wrote {a.bots} env files for {a.sha[:8]} ({a.run}) to {a.out_dir}')


if __name__ == '__main__':
    sys.exit(main())
