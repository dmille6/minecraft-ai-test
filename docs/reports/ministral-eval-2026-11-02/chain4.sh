#!/bin/bash
# the ministral ladders again, AFTER the reboot, so all four ladders share one condition (ethan-gpu load changed at the reboot)
cd ~/learnloop/evals/ministral-1102
python3 mineval.py ladder ministral-3-8b ministral-3-8b || echo CHAINFAIL 8b
python3 mineval.py ladder ministral-3-14b ministral-3-14b || echo CHAINFAIL 14b
echo CHAIN4 DONE
