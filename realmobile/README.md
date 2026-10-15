<div align="center">

# 🧪 RealMobile

### A Real-Device Benchmark for Mobile GUI Agents

*Built from real user traffic, hand-rewritten for reproducibility, and executed on **physical devices against live applications** — not emulators.*

<p>
  <a href="https://seerray-lab.github.io/Xiaomi-GUI/realmobile/"><img src="https://img.shields.io/badge/🌐_Benchmark_Site-RealMobile-ff6700?style=flat-square" alt="Benchmark Site"/></a>
  <a href="https://seerray-lab.github.io/Xiaomi-GUI/"><img src="https://img.shields.io/badge/📄_Project-Xiaomi--GUI--0-4a4a4a?style=flat-square" alt="Project Page"/></a>
  <a href="https://arxiv.org/abs/2606.31410"><img src="https://img.shields.io/badge/arXiv-2606.31410-b31b1b?style=flat-square&logo=arxiv" alt="arXiv"/></a>
</p>

</div>

## 📖 Overview

High benchmark scores do not reliably predict performance on real devices, where account states, permission dialogs, payment authentication, and risk-control mechanisms continually reshape the state distribution a GUI agent encounters. **RealMobile** closes that gap by evaluating agents *where they will be deployed*: on physical phones, driving live commercial Chinese applications (Bilibili, Douyin, Xiaohongshu, Weibo, Taobao, QQ Music, Ctrip, AMap, Hema, …), on tasks drawn from real user traffic.

Instead of a single pass/fail signal, each task is decomposed into ordered **sub-goals** that award partial credit, so an agent that completes most of a long-horizon task is measured fairly. Every recorded **trajectory** (screenshots + UI-hierarchy XML + OCR + actions) is re-scored deterministically by **hand-written rule scripts**, verified with XPath and code rules over the UI XML plus PaddleOCR text.

<div align="center">

| | |
|---|---|
| 🎯 **Sub-goal scoring** | Ordered sub-goals with partial credit (e.g. 0.33 → 0.66 → 1.0) |
| 🔗 **Multi-app by design** | 57% of tasks span two or more applications |
| 📱 **Real devices, live apps** | Physical phones against production apps — no emulators |
| 🔍 **Transparent & reproducible** | Every query, rule, and script is open; scoring is deterministic |

</div>

## 📊 Benchmark at a Glance

100 tasks comprise 193 application instances across 14 live apps and four capability domains.

| Domain | Tasks | Avg. Apps | Multi-App | Focus |
|---|:---:|:---:|:---:|---|
| Foundation | 10 | 1.30 | 10% | Basic GUI operations: clicking, scrolling, inputting, navigating. |
| Safety & Reflection | 16 | 1.31 | 31% | Refusing unsafe/irreversible actions; recognizing infeasible goals. |
| Memory & Knowledge | 33 | 1.73 | 58% | Retaining information across steps; applying external knowledge. |
| Complex Reasoning & Planning | 41 | 2.49 | 78% | Long-horizon planning, multi-source aggregation, adaptive decisions. |
| **Overall** | **100** | **1.93** | **57%** | |

<div align="center">
  <img src="https://raw.githubusercontent.com/SeerRay-Lab/Xiaomi-GUI/gh-pages/assets/figs/app_freq_pie.png" width="44%" alt="Application frequency"/>
  <img src="https://raw.githubusercontent.com/SeerRay-Lab/Xiaomi-GUI/gh-pages/assets/figs/multiapp_bar.png" width="40%" alt="Applications per task"/>
</div>

> 🔎 Browse all 100 tasks — queries, apps, and sub-goal rubrics — on the interactive [**benchmark site**](https://seerray-lab.github.io/Xiaomi-GUI/realmobile/).

## 🗂️ Repository Layout

```text
realmobile/
├── rules/
│   ├── 1.py … 100.py            # One scoring script per task (QUERY + STEPRULES + matchers)
│   ├── evaluator_xpath.py       # Scoring engine: UI-XML parsing + XPath matching
│   ├── main_eval.py             # Batch evaluation runner
│   ├── trajectory_summary.json  # id → query summary used by the runner
│   └── human_eval.csv           # sid ↔ query order for human-aligned reporting
└── query_comparison_report.json # Task queries ↔ model trajectories, for cross-model comparison
```

| Path | What it is |
|---|---|
| [`rules/1.py … 100.py`](rules/) | **Scoring scripts (core).** One per task — each defines `QUERY`, `STEPRULES`, and per-step matchers. |
| [`rules/evaluator_xpath.py`](rules/evaluator_xpath.py) | **Scoring engine.** Parses Android UI XML and provides XPath-style matching. |
| [`rules/main_eval.py`](rules/main_eval.py) | **Batch runner.** Scores a set of trajectories across all tasks and aggregates the results. |
| [`rules/trajectory_summary.json`](rules/trajectory_summary.json), [`rules/human_eval.csv`](rules/human_eval.csv) | Query metadata and ordering used by the runner. |
| [`query_comparison_report.json`](query_comparison_report.json) | Cross-reference report mapping task queries to model trajectories. |

> **Note** — Trajectory data (screenshots + UI XML) is not committed to the repo due to size. The scripts assume a local trajectory directory laid out as `<batch>/<episode_id>/` (see the trajectory format below).

## 🧩 How Scoring Works

```text
Agent runs a task on a physical phone
        │
        ▼
Collect trajectory  (screenshots + uiautomator XML + action coordinates)
        │
        ▼
(Optional) enrich UI XML with OCR  →  N_ocr.xml
        │
        ▼
rules/N.py  scores step by step via XPath rules    ← evaluator_xpath.py
        │
        ▼
main_eval.py  aggregates scores & success rates
```

### Trajectory format

Each trajectory is a folder (e.g. `<batch>/67037d53/`) capturing one full task execution:

| File | Meaning |
|------|---------|
| `task.json` | Task metadata + every step's action (query, app, phone model, tap coordinates, thought…) |
| `N.xml` | Android UI-hierarchy tree at step N (`uiautomator dump`) |
| `N_ocr.xml` | OCR-enriched XML with an `ocr_texts` attribute (preferred during scoring) |
| `N.png` / `N.jpg` | Screenshot at step N |
| `N.json` | Action metadata at step N |
| `N_error.txt` | Error log for that step, if any |

### Scoring rules (`rules/N.py`)

Each rule file corresponds to one task and defines:

- `QUERY` — the task instruction (e.g. `"关闭b站后台播放"`)
- `TASK_ID` — the task number
- `STEPRULES` — human-readable, step-by-step scoring criteria
- `evaluate_rule_X()` — per-step matcher over UI elements + tap coordinates via XPath
- `evaluate_trajectory(path)` — entry point returning the score dictionary

Scoring is **cumulative**: multi-step tasks award credit progressively (0.33 / 0.66 / 1.0), with `total_score` in `[0.0, 1.0]`. The engine (`evaluator_xpath.py`) parses UI XML into elements with attributes like `text`, `ocr_texts`, `bounds`, and `checked`, and adds a custom XPath function `bbox_contains_point(@bounds, $point)` to test whether the agent's tap landed inside a target element.

## 🚀 Usage

```bash
pip install lxml pandas tqdm
```

**Score one task from code:**

```python
import sys, importlib
sys.path.append("rules")

rule = importlib.import_module("1")            # load rules/1.py
result = rule.evaluate_trajectory("<batch>/67037d53")
# {
#   "query": "关闭b站后台播放",
#   "id": 1,
#   "total_score": 1.0,
#   "details": [{"rule": ..., "score": 0.33, "satisfied": true, "evidence": "step 9 …"}, ...]
# }
```

**Run the full batch evaluation:**

```bash
python rules/main_eval.py     # scores all tasks and aggregates success rates
```

The runner writes an aggregated report (`evaluation_results_<timestamp>.{json,csv,xlsx}`) with this shape:

```json
{
  "summary": { "total_tasks": 100, "total_success_rate": 0.90, "overall_avg_score": 0.93 },
  "results": [
    { "id": 1, "query": "关闭b站后台播放", "success_rate": 1.0, "path_results": [ ... ] }
  ]
}
```

## 📚 Citation

```bibtex
@misc{cao2026xiaomigui0technicalreport,
      title={Xiaomi-GUI-0 Technical Report},
      author={Wanxia Cao and Chengzhen Duan and Pei Fu and Pengzhi Gao and Niu Lian and Fazhan Liu and Hui Liu and Heng Qu and Qinzhuo Wu and Zhehao Yu and Tongbo Chen and Shiqi Cui and Anan Du and Shukai Jia and Yuanfa Li and Wei Liu and Yike Liu and Wenchao Lu and Zhenbo Luo and Haoyuan Sun and Jiatong Sun and Cheng Tan and Yajie Wang and Changqiao Wu and Tao Xiong and Jiahui Yang and Yuxuan Yuan and Ruoceng Zhang and Shaojie Zhang and Jian Zhu and Jian Luan and Cong Zou},
      year={2026},
      eprint={2606.31410},
      archivePrefix={arXiv},
      primaryClass={cs.AI},
      url={https://arxiv.org/abs/2606.31410},
}
```
