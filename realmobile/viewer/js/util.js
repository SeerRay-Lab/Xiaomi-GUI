// Shared frontend utilities.
window.RM = window.RM || {};

// createElement helper (OSWorld-style): el('div', {class:'x'}, [childNodes|strings]).
RM.el = function (tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "dataset") {
        for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      } else {
        node.setAttribute(k, v);
      }
    }
  }
  if (children != null) {
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return node;
};

RM.fetchJSON = async function (url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
};

// JOIN KEY invariant — MUST match build_index.py normalize_query() byte-for-byte:
// NFKC -> straighten curly quotes -> remove ALL whitespace.
RM.normalizeQuery = function (s) {
  s = (s || "").normalize("NFKC");
  s = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  return s.replace(/\s+/g, "");
};

// Robust hot-linked image: lazy, async, jpg->png retry, then SVG placeholder.
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240">' +
      '<rect width="100%" height="100%" fill="#f1f2f4"/>' +
      '<text x="50%" y="50%" font-size="11" fill="#9aa0a6" text-anchor="middle" ' +
      'font-family="sans-serif">no image</text></svg>'
  );

RM.makeImg = function (src, alt, opts) {
  opts = opts || {};
  const img = RM.el("img", {
    src,
    alt: alt || "",
    loading: "lazy",
    decoding: "async",
  });
  if (opts.w && opts.h) img.style.aspectRatio = `${opts.w} / ${opts.h}`;
  img.addEventListener("error", function onErr() {
    img.removeEventListener("error", onErr);
    if (/\.jpg($|\?)/.test(img.src)) {
      // first failure: try the full-res PNG
      const png = img.src.replace(/\.jpg($|\?)/, ".png$1");
      img.addEventListener("error", function onErr2() {
        img.removeEventListener("error", onErr2);
        img.src = PLACEHOLDER;
        img.classList.add("img-missing");
      });
      img.src = png;
    } else {
      img.src = PLACEHOLDER;
      img.classList.add("img-missing");
    }
  });
  return img;
};

RM.pct = (v) => (v == null ? "–" : `${(v * 100).toFixed(0)}%`);
// Score class matching the benchmark site's .sr.full / .mid / .low.
RM.srClass = (v) =>
  v == null ? "" : v >= 0.75 ? "full" : v >= 0.4 ? "mid" : "low";
