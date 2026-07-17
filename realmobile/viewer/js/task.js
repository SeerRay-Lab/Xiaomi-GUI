// Detail page: model tabs + episode selector + step timeline + steprules.
(function () {
  const el = RM.el;
  let detail = null;
  let activeModel = 0; // index into detail.models
  let activeEp = 0;

  document.addEventListener("DOMContentLoaded", init);

  function taskId() {
    return new URLSearchParams(location.search).get("id");
  }

  async function init() {
    const id = taskId();
    const root = document.getElementById("detail");
    if (!id) {
      root.innerHTML = `<div class="empty-msg">Missing task ID</div>`;
      return;
    }
    try {
      detail = await RM.fetchJSON(`${RM.DATA_BASE}/task/${id}.json`);
    } catch (e) {
      root.innerHTML = `<div class="empty-msg"><i class="fas fa-exclamation-triangle"></i> Failed to load: ${e.message}</div>`;
      return;
    }
    document.title = `Task ${id} · RealMobile`;
    render();
    document.addEventListener("keydown", onKey);
  }

  function render() {
    const root = document.getElementById("detail");
    root.innerHTML = "";
    root.appendChild(head());
    root.appendChild(rubricPanel());
    root.appendChild(mainCol());
  }

  function head() {
    return el("div", { class: "detail-head" }, [
      el("span", { class: "m-id",
        text: `TASK ${String(detail.id).padStart(3, "0")}` }),
      el("h2", { class: "detail-query", text: detail.query }),
      el("div", { class: "detail-meta" }, [
        ...(detail.apps || []).map((a) => el("span", { class: "tag app", text: a })),
      ]),
    ]);
  }

  function mainCol() {
    const col = el("div", {});
    if (!detail.models || !detail.models.length) {
      col.appendChild(el("div", { class: "empty-msg",
        html: '<i class="fas fa-ghost"></i> No recorded trajectories for this task yet' }));
      return col;
    }
    col.appendChild(modelTabs());
    col.appendChild(el("div", { id: "ep-and-steps" }));
    renderEpAndSteps(col);
    return col;
  }

  function modelTabs() {
    const box = el("div", { class: "model-tabs" });
    detail.models.forEach((m, i) => {
      const tab = el("div", {
        class: "model-tab" + (i === activeModel ? " active" : ""),
      }, [
        el("span", { text: m.display }),
        el("small", { text: `${totalSteps(m)} steps` }),
      ]);
      tab.addEventListener("click", () => {
        activeModel = i; activeEp = 0;
        render();
      });
      box.appendChild(tab);
    });
    return box;
  }

  function totalSteps(m) {
    return m.episodes.reduce((n, e) => n + e.step_count, 0);
  }

  function renderEpAndSteps(col) {
    const host = col.querySelector("#ep-and-steps");
    host.innerHTML = "";
    const model = detail.models[activeModel];
    if (!model) return;

    if (model.episodes.length > 1) {
      const pills = el("div", { class: "episode-pills" });
      model.episodes.forEach((ep, i) => {
        const pill = el("span", {
          class: "ep-pill" + (i === activeEp ? " active" : ""),
          text: `#${i + 1} · ${ep.episode_id.slice(0, 6)} · ${ep.step_count} steps`,
        });
        pill.addEventListener("click", () => { activeEp = i; render(); });
        pills.appendChild(pill);
      });
      host.appendChild(pills);
    }

    const ep = model.episodes[activeEp];
    if (!ep) return;
    const steps = el("div", { class: "steps" });
    ep.steps.forEach((s) => steps.appendChild(stepRow(s)));
    host.appendChild(steps);
    bindStepHeights(steps);
  }

  // Lock each step's model-output box to the screenshot height so the shot
  // never leaves empty space; overflowing output scrolls inside the box.
  const STACK_W = 640; // matches the single-column media query
  function sizeStep(step) {
    const img = step.querySelector(".step-shot img");
    const pre = step.querySelector(".thought-raw");
    const top = step.querySelector(".step-top");
    if (!img || !pre) return;
    if (window.innerWidth <= STACK_W) { pre.style.height = ""; return; }
    const h = img.clientHeight;
    if (!h) return;
    pre.style.height = Math.max(120, h - (top ? top.offsetHeight : 0) - 8) + "px";
  }

  function bindStepHeights(container) {
    const steps = [...container.querySelectorAll(".step")];
    steps.forEach((step) => {
      const img = step.querySelector(".step-shot img");
      if (!img) return;
      if (img.complete && img.naturalHeight) sizeStep(step);
      else img.addEventListener("load", () => sizeStep(step), { once: true });
      if (window.ResizeObserver) new ResizeObserver(() => sizeStep(step)).observe(img);
    });
    if (bindStepHeights._onResize) window.removeEventListener("resize", bindStepHeights._onResize);
    bindStepHeights._onResize = () => steps.forEach(sizeStep);
    window.addEventListener("resize", bindStepHeights._onResize);
  }

  function stepRow(s) {
    const shot = el("div", { class: "step-shot" });
    const img = RM.makeImg(s.img, `step ${s.step}`,
      { w: s.image_width, h: s.image_height });
    img.addEventListener("click", () => lightbox(s.screenshot_png || s.img));
    shot.appendChild(img);

    const th = s.thought || {};
    const rawOutput = s.raw_output || th.raw || "";

    const main = el("div", { class: "step-main" }, [
      el("div", { class: "step-top" }, [
        el("span", { class: "step-num", text: `STEP ${s.step}` }),
        s.infer_time != null
          ? el("span", { class: "step-infer", text: `${s.infer_time}s` }) : null,
      ]),
      rawOutput
        ? el("pre", { class: "thought-raw", text: rawOutput })
        : null,
    ]);

    return el("div", { class: "step" }, [shot, main]);
  }

  // Parse steprules exactly like the RealMobile homepage (app.js parseRules).
  // Returns {steps:[{score,text}], veto:[text]}.
  function parseRules(rules) {
    const out = { steps: [], veto: [] };
    if (!rules) return out;
    const lines = rules.split(/\n/).map((l) => l.trim()).filter(Boolean);
    let mode = "step";
    for (const ln of lines) {
      if (/^(评分规则|分段评分规则)/.test(ln)) { mode = "step"; continue; }
      if (/^一票否决/.test(ln)) { mode = "veto"; continue; }
      const m = ln.match(/^-?\s*(.*?)\s*→\s*(?:总分|分数)\s*[:：]\s*([0-9.]+)\s*$/);
      if (m) {
        const text = m[1].trim();
        if (mode === "veto" || parseFloat(m[2]) === 0) out.veto.push(text);
        else out.steps.push({ text, score: m[2] });
        continue;
      }
      if (mode === "veto") {
        if (/^暂无$/.test(ln)) continue;
        out.veto.push(ln.replace(/^-\s*/, ""));
      } else if (out.steps.length) {
        out.steps[out.steps.length - 1].text += " " + ln;
      }
    }
    return out;
  }

  function rubricPanel() {
    const panel = el("div", { class: "panel" });
    const body = el("div", { class: "m-rules rubric" });
    const parsed = parseRules(detail.steprules);

    if (parsed.steps.length) {
      body.appendChild(el("h4", { text: "Sub-goal rubric" }));
      parsed.steps.forEach((s) =>
        body.appendChild(el("div", { class: "rule-step" }, [
          el("span", { class: "rule-score", text: s.score }),
          el("span", { class: "rule-text", text: s.text }),
        ])));
      parsed.veto.forEach((v) =>
        body.appendChild(el("div", { class: "rule-step rule-veto" }, [
          el("span", { class: "rule-score", text: "veto" }),
          el("span", { class: "rule-text", text: v }),
        ])));
    } else if (detail.steprules) {
      body.appendChild(el("h4", { text: "Scoring rubric" }));
      body.appendChild(el("pre", { class: "m-raw", text: detail.steprules }));
    } else {
      body.appendChild(el("h4", { text: "Scoring rubric" }));
      body.appendChild(el("p", { text: "Rubric available in the benchmark repository." }));
    }
    panel.appendChild(body);
    return panel;
  }

  function lightbox(src) {
    const box = el("div", { class: "lightbox" }, [RM.makeImg(src, "")]);
    box.addEventListener("click", () => box.remove());
    document.body.appendChild(box);
  }

  function onKey(e) {
    const model = detail.models && detail.models[activeModel];
    if (!model) return;
    if (e.key === "ArrowRight" && activeEp < model.episodes.length - 1) {
      activeEp++; render();
    } else if (e.key === "ArrowLeft" && activeEp > 0) {
      activeEp--; render();
    } else if (e.key === "Escape") {
      const lb = document.querySelector(".lightbox");
      if (lb) lb.remove();
    }
  }
})();
