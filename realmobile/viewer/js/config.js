// Frontend config — single source of truth for model names + data paths.
// Mirror of build/build_index.py's MODEL_MAP. Expanding to 16 models = the
// build regenerates data/ (frontend reads catalog.models[]); this map only
// supplies display-name fallback + ordering.
window.RM = window.RM || {};

RM.HF_REPO = "SeerRay-Lab/RealMobile";
RM.HF_BASE = `https://huggingface.co/datasets/${RM.HF_REPO}/resolve/main`;
RM.DATA_BASE = "data";

// HF folder -> display name.
RM.MODEL_MAP = {
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
};

RM.displayName = (folder) => RM.MODEL_MAP[folder] || folder;
