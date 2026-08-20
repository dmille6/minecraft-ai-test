# Block 2 runbook

The order below is not a suggestion. Two of these steps exist because skipping
them produced worlds that looked provisioned and were not.

    # on block2-worlds (10.0.0.30)
    sudo ./provision-block2.sh <seed>            # refuses to continue unless the
                                                 # service user can READ its config
    systemctl start block2@{hive-a,...}          # eight units, staggered
    sudo ./place-town.py <arm>                   # ONCE per world. Stamping twice
                                                 # moves the site; a marker refuses.
    sudo ./pregen-world.py <arm> --centre-from /srv/block2/town-<arm>.json
    sudo ./whitelist-block2.py

    # locally
    ./generate-roster.py --town '/tmp/towns/town-*.json' --out ./env \
        --endpoints http://10.0.0.16:11434

    # on block2-bots (10.0.0.31)
    sudo ./bootstrap-block2-bots.sh              # mcbot user, unit template, harness
    # push env/ to /srv/mcbots/harness/env, install filebeat, then start staggered

    # gate, from anywhere with ES access
    ./shakedown-gate.py --block block2 --hours 24

## What each guard is for

| guard | the failure it exists to prevent |
|---|---|
| config-readable check in the provisioner | root-owned mode-600 server.properties made Paper fall back to DEFAULTS: all eight worlds on port 25565, seven crash-looping, the eighth quietly running the wrong difficulty |
| TOWN-PLACED.json marker | siting stamps a town, and a stamped town changes the terrain the next search scores. Three runs put three towns in three places |
| explicit filebeat unit list | `mcbot@*.service` matches nothing in `include_matches` and the input looks perfectly healthy while shipping zero events |
| pregeneration | an arm that explores into fresh chunks under load pays tick time an arm on generated ground never pays |
| equal cgroup envelopes | same host is required by the design; same scheduler is not. Eight Paper servers in one domain starve each other |

## Current state (2026-08-20)

Eight worlds, seed 20260820, all sited identically at 96,0 (spawn is water on
this seed). 40 bots on the dedicated 3090 at 10.0.0.16, single endpoint, no
fallback. Smoke running; the shakedown clock has NOT started.
