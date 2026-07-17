#!/usr/bin/env python3
"""Build the static index for the RealMobile trajectory monitor.

Walks the HuggingFace dataset `SeerRay-Lab/RealMobile`, downloads ONLY the
per-episode `task.json` files (never images — images are hot-linked at render
time), joins each episode to a task id (1..100) via its normalized `query`
text, and emits a compact static index:

    data/catalog.json          -> card wall + global metadata
    data/task/<id>.json         -> per-task detail incl. every model's episodes
    data/leaderboard.json       -> copied from the existing benchmark site

Zero third-party deps: uses only the Python standard library (urllib), so no
pip install is required.

Usage:
    python3 build/build_index.py \
        --models Xiaomi-GUI-0,claude-opus-4-7 \
        --out data --cache build/.cache
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

# --------------------------------------------------------------------------
# Config (mirror of js/config.js — keep in sync)
# --------------------------------------------------------------------------
HF_REPO = "SeerRay-Lab/RealMobile"
HF_BASE = f"https://huggingface.co/datasets/{HF_REPO}/resolve/main"
HF_TREE = f"https://huggingface.co/api/datasets/{HF_REPO}/tree/main"
TASKS_URL = "https://seerray-lab.github.io/Xiaomi-GUI-0/realmobile/tasks.json"
LEADERBOARD_URL = "https://seerray-lab.github.io/Xiaomi-GUI-0/realmobile/leaderboard.json"

# HF folder name -> leaderboard display name. Full 16-model table; ENABLED_MODELS
# controls which are actually built. Expanding to all 16 = extend ENABLED_MODELS.
MODEL_MAP = {
    "Xiaomi-GUI-0": "Xiaomi-GUI-0-30B-A3B",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-4-6": "Claude Opus 4.6",
    "gemini-3.1-pro": "Gemini 3.1 Pro",
    "gemini-3.1-flash": "Gemini 3.1 Flash",
    "seed-2.0": "Seed 2.0 Pro",
    "seed-1.8": "Seed 1.8",
    "GUI-Owl-1.5-32B-Instruct": "GUI-Owl-1.5-32B-Instruct",
    "GUI-Owl-1.5-32B-Think": "GUI-Owl-1.5-32B-Thinking",
    "GUI-Owl-1.5-8B-Instruct": "GUI-Owl-1.5-8B-Instruct",
    "GUI-Owl-1.5-8B-Think": "GUI-Owl-1.5-8B-Thinking",
    "UI-TARS-1.5-7B": "UI-TARS-1.5",
    "UI-Venus-1.5-30B-A3B": "UI-Venus-1.5-30B-A3B",
    "UI-Venus-1.5-8B": "UI-Venus-1.5-8B",
    "mai-ui": "MAI-UI-8B",
    "step-gui": "Step-GUI-8B",
}
# Preferred display order (best-first, roughly by leaderboard success).
MODEL_ORDER = list(MODEL_MAP.keys())
ENABLED_MODELS = list(MODEL_MAP.keys())  # all 16 models

# App-name aliases: fold sub-apps into their parent. "Douyin Mall" (抖音商城)
# is a module inside Douyin, not a separate app, so it merges into "Douyin".
# Applied to every task's apps list, de-duplicated while preserving order.
APP_ALIASES: dict[str, str] = {
    "Douyin Mall": "Douyin",
}

# App names to drop entirely (long-tail platforms not in the canonical 14).
APP_IGNORE: set[str] = {"Juzi"}

# Per-task app-list corrections for tasks.json mis-labels, verified against the
# ground-truth foreground_app of the recorded trajectories. Applied after aliases.
#   task 54: apps=["WeChat"] but every step runs in 盒马 (Hema); "微信" is only
#            the budget source in the query, never the operated app.
# Maps task id -> replacement apps list.
APP_FIXES: dict[int, list[str]] = {
    54: ["Hema"],
}


def fix_apps(task_id: int, apps: list[str]) -> list[str]:
    """Apply per-task overrides, then aliases, de-duplicated in order."""
    if task_id in APP_FIXES:
        apps = list(APP_FIXES[task_id])
    out: list[str] = []
    for a in apps:
        a = APP_ALIASES.get(a, a)
        if a in APP_IGNORE or a in out:
            continue
        out.append(a)
    return out

USER_AGENT = "realmobile-monitor-build/1.0"


# --------------------------------------------------------------------------
# JOIN KEY — the single most important correctness invariant.
# Must be byte-identical to normalizeQuery() in js/util.js:
#   NFKC normalize -> straighten curly quotes -> remove ALL whitespace.
# --------------------------------------------------------------------------
_CURLY = {
    "“": '"', "”": '"',   # “ ”
    "‘": "'", "’": "'",   # ‘ ’
}


def normalize_query(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    for a, b in _CURLY.items():
        s = s.replace(a, b)
    return "".join(s.split())


# --------------------------------------------------------------------------
# HTTP helpers (stdlib only)
# --------------------------------------------------------------------------
def _get(url: str, retries: int = 3, backoff: float = 1.5):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(backoff * (attempt + 1))
    raise last  # type: ignore[misc]


def get_json(url: str, retries: int = 3):
    return json.loads(_get(url, retries=retries).decode("utf-8"))


def list_episodes(model_folder: str) -> list[str]:
    """List episode-folder names under a model, paginating the HF tree API."""
    eps: list[str] = []
    cursor = None
    while True:
        url = f"{HF_TREE}/{urllib.parse.quote(model_folder)}"
        if cursor:
            url += f"?cursor={urllib.parse.quote(cursor)}"
        data = get_json(url)
        if not data:
            break
        for item in data:
            if item.get("type") == "directory":
                eps.append(item["path"].split("/")[-1])
        # HF returns <=1000 per page; most models are ~100 so one page suffices.
        if len(data) < 1000:
            break
        cursor = data[-1].get("path")
        if not cursor:
            break
    return eps


# --------------------------------------------------------------------------
# task.json parsing / step coercion
# --------------------------------------------------------------------------
def _as_int(v, default=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _as_float(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def coerce_step(raw: dict, model_folder: str, ep: str) -> dict:
    """Emit only the fields the viewer actually renders. The detail page shows
    the full raw model output verbatim (raw_output); the parsed thought segments,
    action title, foreground_app, exec_success and UI-XML link were all removed
    from the UI, so those fields are no longer stored (saves ~40% of data/)."""
    base = f"{HF_BASE}/{urllib.parse.quote(model_folder)}/{urllib.parse.quote(ep)}"
    jpg = raw.get("local_path") or f"{_as_int(raw.get('step'), 1)}.jpg"
    png = raw.get("screenshot") or f"{_as_int(raw.get('step'), 1)}.png"
    step = {
        "step": _as_int(raw.get("step")),
        "infer_time": _as_float(raw.get("infer_time")),
        "img": f"{base}/{jpg}",
        "screenshot_png": f"{base}/{png}",
        "image_width": _as_int(raw.get("image_width")) or None,
        "image_height": _as_int(raw.get("image_height")) or None,
        # Full, unmodified model output (<think>/<action>/<tool_call>), shown verbatim.
        "raw_output": (raw.get("raw_model_output") or "").strip(),
    }
    # Fallback for the ~2% of steps with no raw_model_output: the viewer reads
    # `s.raw_output || s.thought.raw`, so only carry thought.raw when needed.
    if not step["raw_output"]:
        th = (raw.get("thought") or "").strip()
        if th:
            step["thought"] = {"raw": th}
    return step


def build_episode(model_folder: str, ep: str, tj: dict) -> dict:
    # Only episode_id / step_count / steps are read by the viewer; the device
    # metadata (phone/os/screen_resolution) and exec_success_count are unused.
    steps_raw = tj.get("data") or tj.get("steps") or []
    steps = [coerce_step(s, model_folder, ep) for s in steps_raw]
    return {
        "episode_id": tj.get("episode_id", ep),
        "step_count": len(steps),
        "steps": steps,
    }


# --------------------------------------------------------------------------
# Caching of downloaded task.json (avoids re-fetch across runs)
# --------------------------------------------------------------------------
def fetch_task_json(model_folder: str, ep: str, cache_dir: str | None) -> dict | None:
    cache_path = None
    if cache_dir:
        cache_path = os.path.join(cache_dir, model_folder, f"{ep}.json")
        if os.path.exists(cache_path):
            try:
                with open(cache_path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:  # noqa: BLE001
                pass
    url = f"{HF_BASE}/{urllib.parse.quote(model_folder)}/{urllib.parse.quote(ep)}/task.json"
    try:
        tj = get_json(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"  ! 404 {model_folder}/{ep}/task.json — skipped", file=sys.stderr)
            return None
        raise
    if cache_path:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(tj, f, ensure_ascii=False)
    return tj


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------
def build(models: list[str], out_dir: str, cache_dir: str | None, workers: int) -> None:
    os.makedirs(os.path.join(out_dir, "task"), exist_ok=True)

    print(f"Loading tasks.json + leaderboard.json ...")
    tasks_doc = get_json(TASKS_URL)
    leaderboard = get_json(LEADERBOARD_URL)
    tasks = tasks_doc["tasks"]
    summary = tasks_doc.get("summary", {})

    # Apply verified app-label corrections + aliases (see fix_apps).
    for t in tasks:
        t["apps"] = fix_apps(t["id"], t.get("apps", []) or [])

    qindex = {normalize_query(t["query"]): t["id"] for t in tasks}
    tasks_by_id = {t["id"]: t for t in tasks}
    print(f"  {len(tasks)} tasks, {len(qindex)} unique normalized queries")

    # task_id -> model_folder -> [episode dicts]
    buckets: dict[int, dict[str, list]] = {t["id"]: {} for t in tasks}
    model_stats: dict[str, dict] = {}

    for model in models:
        display = MODEL_MAP.get(model, model)
        print(f"\n== {model}  ({display}) ==")
        eps = list_episodes(model)
        print(f"  {len(eps)} episodes; downloading task.json ...")
        matched = unmatched = 0
        unmatched_eps: list[str] = []

        def work(ep):
            tj = fetch_task_json(model, ep, cache_dir)
            return ep, tj

        results = []
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            for ep, tj in pool.map(work, eps):
                results.append((ep, tj))

        for ep, tj in results:
            if not tj:
                unmatched += 1
                unmatched_eps.append(ep)
                continue
            tid = qindex.get(normalize_query(tj.get("query", "")))
            if tid is None:
                unmatched += 1
                unmatched_eps.append(ep)
                continue
            episode = build_episode(model, ep, tj)
            # Drop empty runs (0 recorded steps) so they don't render as a blank
            # episode pill in the detail page.
            if episode["step_count"] == 0:
                unmatched += 1
                unmatched_eps.append(ep)
                continue
            buckets[tid].setdefault(model, []).append(episode)
            matched += 1

        # deterministic order within a (task, model): by episode_id
        for tid in buckets:
            if model in buckets[tid]:
                buckets[tid][model].sort(key=lambda e: e["episode_id"])

        model_stats[model] = {
            "folder": model,
            "display": display,
            "episode_count": matched,
        }
        print(f"  matched {matched} / unmatched {unmatched}")
        if unmatched_eps:
            print(f"  unmatched episodes: {unmatched_eps[:10]}", file=sys.stderr)

    # ---- emit per-task detail files (all 100, even empty) ----
    apps_union: set[str] = set()
    catalog_tasks = []
    for t in tasks:
        tid = t["id"]
        apps = t.get("apps", []) or []
        apps_union.update(apps)
        model_entries = []
        episode_total = 0
        models_present = []
        preview = None
        for model in models:  # preserve enabled order
            eps = buckets[tid].get(model, [])
            if not eps:
                continue
            models_present.append(model)
            episode_total += len(eps)
            model_entries.append({
                "folder": model,
                "display": MODEL_MAP.get(model, model),
                "episodes": eps,
            })
            if preview is None and eps and eps[0]["steps"]:
                preview = {"model": model, "img": eps[0]["steps"][0]["img"]}

        detail = {
            "id": tid,
            "query": t["query"],
            "apps": apps,
            "success_rate": t.get("success_rate"),
            "avg_score": t.get("avg_score"),
            "total_paths": t.get("total_paths"),
            "steprules": t.get("steprules", ""),
            "models": model_entries,
        }
        with open(os.path.join(out_dir, "task", f"{tid}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False)

        steprules = t.get("steprules", "") or ""
        first_line = next((ln.strip() for ln in steprules.splitlines()
                           if ln.strip() and ln.strip() != "评分规则"), "")
        catalog_tasks.append({
            "id": tid,
            "query": t["query"],
            "apps": apps,
            "success_rate": t.get("success_rate"),
            "avg_score": t.get("avg_score"),
            "total_paths": t.get("total_paths"),
            "steprules_summary": first_line[:80],
            "models_present": models_present,
            "episode_total": episode_total,
            "preview": preview,
        })

    catalog = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "models": [model_stats[m] for m in models if m in model_stats],
        "apps": sorted(apps_union),
        "summary": summary,
        "tasks": catalog_tasks,
    }
    with open(os.path.join(out_dir, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False)
    with open(os.path.join(out_dir, "leaderboard.json"), "w", encoding="utf-8") as f:
        json.dump(leaderboard, f, ensure_ascii=False)

    # ---- report ----
    print("\n=== build complete ===")
    print(f"  catalog.json: {len(catalog_tasks)} tasks, {len(catalog['models'])} models")
    total_eps = sum(m["episode_count"] for m in catalog["models"])
    print(f"  total episodes: {total_eps}")
    print(f"  apps: {len(apps_union)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=",".join(ENABLED_MODELS),
                    help="comma-separated HF folder names")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    ap.add_argument("--cache", default=os.path.join(os.path.dirname(__file__), ".cache"))
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    out_dir = os.path.abspath(args.out)
    cache_dir = os.path.abspath(args.cache) if args.cache else None
    print(f"models={models}\nout={out_dir}\ncache={cache_dir}")
    build(models, out_dir, cache_dir, args.workers)


if __name__ == "__main__":
    main()
