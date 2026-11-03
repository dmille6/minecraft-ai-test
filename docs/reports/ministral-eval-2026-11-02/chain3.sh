#!/bin/bash
# resumed after the .31 reboot 01:16Z (kernel 146->147, clean poweroff; not this eval); the 4B ladder restarts from its first rung
cd ~/learnloop/evals/ministral-1102
python3 mineval.py ladder 20261101-qwen35-4b run:20261101-qwen35-4b/cand-q8_0.gguf || echo CHAINFAIL 4b-ladder
python3 mineval.py ladder qwen2.5-7b-instruct qwen2.5-7b-instruct || echo CHAINFAIL q25-ladder
python3 mineval.py fixed ministral-3-8b ministral-3-8b 10,20 || echo CHAINFAIL f8
python3 mineval.py fixed ministral-3-14b ministral-3-14b 10,20 || echo CHAINFAIL f14
python3 mineval.py fixed 20261101-qwen35-4b run:20261101-qwen35-4b/cand-q8_0.gguf 10,20 || echo CHAINFAIL f4
python3 mineval.py fixed qwen2.5-7b-instruct qwen2.5-7b-instruct 10,20 || echo CHAINFAIL fq
echo CHAIN3 DONE
