# RealMobile Trajectory Monitor

A static, zero-backend website that visualizes agent trajectories for the
[**RealMobile**](https://huggingface.co/datasets/SeerRay-Lab/RealMobile)
mobile-GUI-agent benchmark, in the spirit of the
[OSWorld-V2 monitor](https://osworld-v2-monitor.xlang.ai/tasks).

- **Task catalog** — one card per task (query, apps, rubric summary, preview).
- **Task detail** — model tabs, per-attempt episode selector, and a step-by-step
  replay (screenshot + `[Observation]/[Plan]/[Decision]` reasoning + action + exec
  status + UI-XML link), with the scoring rubric alongside.
- **Leaderboard** — success/progress table + per-domain scores.

Deploys to GitHub Pages as-is. Trajectory images are **hot-linked** to HuggingFace,
so the repo stores no images (only small JSON).

## Build the data index

```bash
# default: Xiaomi-GUI-0 + claude-opus-4-7
python3 build/build_index.py

# all 16 models
python3 build/build_index.py --models Xiaomi-GUI-0,claude-opus-4-7,claude-opus-4-6,gemini-3.1-pro,gemini-3.1-flash,seed-2.0,seed-1.8,GUI-Owl-1.5-32B-Instruct,GUI-Owl-1.5-32B-Think,GUI-Owl-1.5-8B-Instruct,GUI-Owl-1.5-8B-Think,UI-TARS-1.5-7B,UI-Venus-1.5-30B-A3B,UI-Venus-1.5-8B,mai-ui,step-gui
```

Stdlib-only (no pip install). Downloads only `task.json` files (cached in
`build/.cache/`), joins each episode to a task id via its normalized `query`,
and emits `data/catalog.json` + `data/task/<id>.json` + `data/leaderboard.json`.

The join key (`normalize_query`) must stay byte-identical between
`build/build_index.py` and `js/util.js`.

## Preview locally

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

## Add more models

Extend `ENABLED_MODELS` / `MODEL_MAP` in `build/build_index.py` (and the mirror
`MODEL_MAP` in `js/config.js`), re-run the build, commit the regenerated `data/`.
The frontend reads `catalog.models[]`, so tabs adapt automatically.
