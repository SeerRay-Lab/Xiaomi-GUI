// Card wall: load catalog.json, render one card per task, search + app filter.
(function () {
  const el = RM.el;
  let catalog = null;
  let tasks = [];
  let activeApps = new Set();
  let search = "";

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindControls();
    try {
      catalog = await RM.fetchJSON(`${RM.DATA_BASE}/catalog.json`);
    } catch (e) {
      document.getElementById("container").innerHTML =
        `<div class="empty-msg"><i class="fas fa-exclamation-triangle"></i> Failed to load: ${e.message}</div>`;
      return;
    }
    tasks = catalog.tasks || [];
    document.getElementById("task-count").textContent = tasks.length;
    document.getElementById("model-chip").textContent =
      `${(catalog.models || []).length} models`;
    renderAppChips();
    render();
  }

  function bindControls() {
    document.getElementById("search").addEventListener("input", (e) => {
      search = RM.normalizeQuery(e.target.value);
      render();
    });
  }

  function renderAppChips() {
    const box = document.getElementById("app-chips");
    box.innerHTML = "";
    (catalog.apps || []).forEach((app) => {
      const chip = el("span", { class: "app-chip", text: app });
      chip.addEventListener("click", () => {
        if (activeApps.has(app)) activeApps.delete(app);
        else activeApps.add(app);
        chip.classList.toggle("on");
        render();
      });
      box.appendChild(chip);
    });
  }

  function visible() {
    let list = tasks.slice();
    if (activeApps.size) {
      list = list.filter((t) => (t.apps || []).some((a) => activeApps.has(a)));
    }
    if (search) {
      list = list.filter((t) => {
        const idHit = String(t.id).padStart(3, "0").includes(search) ||
          String(t.id) === search;
        return idHit || RM.normalizeQuery(t.query).includes(search);
      });
    }
    return list.sort((a, b) => a.id - b.id);
  }

  function render() {
    const container = document.getElementById("container");
    const list = visible();
    document.getElementById("task-count").textContent =
      list.length === tasks.length ? tasks.length : `${list.length} / ${tasks.length}`;
    container.innerHTML = "";
    if (!list.length) {
      container.appendChild(el("div", { class: "empty-msg", html:
        '<i class="fas fa-info-circle"></i> No tasks match your filters' }));
      return;
    }
    const grid = el("div", { class: "grid" });
    list.forEach((t) => grid.appendChild(card(t)));
    container.appendChild(grid);
  }

  function card(t) {
    const c = el("a", { class: "card", href: `task.html?id=${t.id}` });

    c.appendChild(el("div", { class: "card-head" }, [
      el("span", { class: "card-id", text: `Task ${String(t.id).padStart(3, "0")}` }),
    ]));

    const multi = (t.apps || []).length > 1;
    const foot = el("div", { class: "card-foot" }, [
      ...(t.apps || []).slice(0, 3).map((a) =>
        el("span", { class: "app-pill" + (multi ? " multi" : ""), text: a })),
      (t.models_present && t.models_present.length)
        ? el("span", { class: "ep-count", text: `${t.models_present.length} models` })
        : null,
    ]);

    c.appendChild(el("div", { class: "card-body" }, [
      el("p", { class: "card-query", text: t.query }),
      foot,
    ]));
    return c;
  }
})();
