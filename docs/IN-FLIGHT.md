# In flight

Live state. Anything here is either running or waiting on a decision.

_Last updated: 2026-08-07, end of the build day._

## Running now

- **The fleet**: five bots on `mc2-lab01-dm`, Paper 1.21.8 on `mc2-mc01-dm`,
  world seed `7914455308567851796`. First run with correct labels and a clean
  lessons store. Left deliberately untouched to produce a baseline.
- **Death circuit breaker** on ctl01, 5-minute timer, alerts to ntfy.
- **Independent observer** on mc01, RCON sampling every 10s.
- **Evidence collection** on evd01, every 5 minutes.

## Waiting on a decision

- **A/A reproducibility run** — the weekend's first job, and a prerequisite for
  every other experiment.
- **BlueMap render** — staged on evd01, deliberately not started. Hours of IO.
  Run it during a window with no trial.
- **UniFi API key rotation** — the key used to build VLAN 193 is in plaintext in
  a session transcript. The build is done; rotate it.

## Known open, not urgent

- `home` has been chosen twice since the purge and succeeded neither time — too
  small a sample to judge whether removing the false lessons helped.
- `mine` success fell (67% → 43%) against yesterday, on a small sample. Watch it.
- `qwen2.5-coder:14b` on the M4 was re-pinned after an Ollama restart; if that
  host reboots, the pin is lost again.
- The three bot roles have still never been demonstrated to behave differently.
  Tonight is the first run where the scout chain is measured in knowledge rather
  than items.
