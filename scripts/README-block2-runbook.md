# Block 2 runbook

The order below is not a suggestion. Two of these steps exist because skipping
them produced worlds that looked provisioned and were not.

    # on block2-worlds (10.0.0.30)
    sudo ./provision-block2.sh <seed>            # refuses to continue unless the
                                                 # service user can READ its config
    systemctl start block2@{hive-a,...}          # eight units, staggered
    sudo ./place-town.py <first-arm>             # SEARCH, once, on one world only
    sudo ./place-town.py <arm> --at=-474,75      # the other seven REUSE that site.
                                                 # NOTE --at=VALUE, not --at VALUE:
                                                 # coordinates start with a minus and
                                                 # argparse reads a bare -474,75 as an
                                                 # option name, not a value.
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
| search once, stamp N times | eight independent searches over one seed produced TWO towns (y=119 vs y=72): forceload returns when QUEUED and generation is async, so the probes scored terrain that did not exist yet |
| wood_nearby() | rejecting water, canopy and relief selects for flat dry TREELESS ground, and the tech tree starts at oak_log. The first site had zero trees within 288 blocks |
| fleet-doctor timer | every health signal in the stack is self-reported: systemd knows a PROCESS runs, not that the bot is PLAYING. Two faults have silently shrunk this fleet (over-long usernames, memory stalls) with all 40 units green |
| no MemoryHigh | it THROTTLES instead of killing. Processes stalled 57% of the time, never crashed, never tripped Restart=always, and were dropped by their servers while systemd saw them healthy |
| chunk evictor | ArrayBuffers are not bounded by --max-old-space-size. The JS heap stayed flat at 172MB while chunk columns grew to 1GB RSS |
| pregeneration | an arm that explores into fresh chunks under load pays tick time an arm on generated ground never pays |
| equal cgroup envelopes | same host is required by the design; same scheduler is not. Eight Paper servers in one domain starve each other |

## Current state (2026-08-20)

Eight worlds, seed 20260820, all sited identically at 96,0 (spawn is water on
this seed). 40 bots on the dedicated 3090 at 10.0.0.16, single endpoint, no
fallback. Smoke running; the shakedown clock has NOT started.
