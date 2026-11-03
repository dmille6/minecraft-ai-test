#!/bin/bash
cd ~/learnloop/evals/ministral-1102
while pgrep -f "mineval.py replay ministral-3-8b" >/dev/null; do sleep 15; done
python3 mineval.py replay ministral-3-14b ministral-3-14b || echo CHAINFAIL 14b-replay
python3 mineval.py ladder ministral-3-8b ministral-3-8b || echo CHAINFAIL 8b-ladder
python3 mineval.py ladder ministral-3-14b ministral-3-14b || echo CHAINFAIL 14b-ladder
python3 mineval.py ladder 20261101-qwen35-4b run:20261101-qwen35-4b/cand-q8_0.gguf || echo CHAINFAIL 4b-ladder
python3 mineval.py ladder qwen2.5-7b-instruct qwen2.5-7b-instruct || echo CHAINFAIL q25-ladder
echo CHAIN DONE
