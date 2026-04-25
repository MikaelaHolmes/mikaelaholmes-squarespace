/* Local + GH-Pages preview helper.
 *
 * Adds three features without modifying any vendor HTML:
 *   1. Floating control panel (bottom-right) with:
 *        - Font picker  — searchable, scrollable list of Google Fonts.
 *          Each option is rendered in its own font. Selecting it loads
 *          the family on demand and applies it site-wide. Persisted via
 *          ?font= in the URL.
 *        - Lightbox style picker — dropdown of lightbox variants.
 *          Persisted via ?lightbox= and localStorage.
 *   2. Ctrl + drag to reposition any <img> on the page. Position is
 *      remembered per-image (keyed by src) in localStorage.
 *      Ctrl + double-click resets the position.
 *   3. Click any large image to open it in a lightbox. The default style
 *      is "squarespace" (black overlay, centered, prev/next arrows on
 *      multi-image pages). Other styles are available from the dropdown.
 */
(function () {
  "use strict";

  // Synchronous pre-blank: if a splash is queued for THIS page (set by a
  // homepage click before navigation, or self-splash on /portfolio), hide
  // the document immediately so the destination's header/page header can't
  // flash before the splash overlay is in the DOM.
  (function preBlank() {
    try {
      let queued = false;
      const stored = sessionStorage.getItem("preview-splash-arrival");
      if (stored) {
        const info = JSON.parse(stored);
        if (info && info.href === location.pathname && info.src) queued = true;
      }
      const isPortfolio = /\/portfolio(\.html)?\/?$/.test(location.pathname);
      if (isPortfolio && sessionStorage.getItem("preview-splash-played") !== location.pathname) {
        queued = true;
      }
      if (!queued) return;
      const style = document.createElement("style");
      style.id = "preview-splash-preblank";
      // Hide everything in body except the splash overlay we'll insert.
      style.textContent = "body > *:not(.preview-splash-overlay) { visibility: hidden !important; }";
      (document.head || document.documentElement).appendChild(style);
      // Safety net: if for any reason the splash never starts fading,
      // reveal the page anyway after a generous timeout.
      setTimeout(() => {
        const s = document.getElementById("preview-splash-preblank");
        if (s) s.remove();
      }, 10000);
    } catch {}
  })();

  // ---------- Config ----------
  // All tunable constants (homepage materials, fonts, timings, etc.) live in
  // /preview/config.json. install.sh inlines that file as a
  // <script id="preview-config" type="application/json"> tag in every page,
  // so we can read it synchronously here. The DEFAULTS below are the
  // fallback used if the inlined tag is missing or malformed — keep them in
  // sync with config.json as a sanity check.
  const CONFIG_DEFAULTS = {
    homepageMaterials: {},
    fonts: [
      "Inter", "DM Sans", "Space Grotesk", "Work Sans", "Poppins", "Montserrat",
      "Playfair Display", "Cormorant Garamond", "Lora", "Merriweather",
      "Lobster", "Pacifico", "Great Vibes", "Dancing Script",
      "JetBrains Mono", "Fira Code",
    ],
    hoverLabels: { homeTitle: true, homeMaterial: true, catTitle: true, catMaterial: true },
    pageTitles: {},
    imageTitles: {},
    imageTitleSources: {},
    splash: { transitionMs: 1300, fadeInMs: 220, minHoldMs: 800, maxHoldMs: 8000 },
    drag: { activatePx: 6 },
    carousel: { advanceMs: 5500 },
    categoryIndex: { ttlMs: 60 * 60 * 1000, storageKey: "preview-category-index-v2" },
  };
  function loadConfig() {
    try {
      const tag = document.getElementById("preview-config");
      if (!tag) return CONFIG_DEFAULTS;
      const parsed = JSON.parse(tag.textContent || "{}");
      // Shallow merge so missing sections fall back to defaults.
      return Object.assign({}, CONFIG_DEFAULTS, parsed, {
        splash: Object.assign({}, CONFIG_DEFAULTS.splash, parsed.splash || {}),
        drag: Object.assign({}, CONFIG_DEFAULTS.drag, parsed.drag || {}),
        carousel: Object.assign({}, CONFIG_DEFAULTS.carousel, parsed.carousel || {}),
        categoryIndex: Object.assign({}, CONFIG_DEFAULTS.categoryIndex, parsed.categoryIndex || {}),
        hoverLabels: Object.assign({}, CONFIG_DEFAULTS.hoverLabels, parsed.hoverLabels || {}),
        pageTitles: Object.assign({}, CONFIG_DEFAULTS.pageTitles, parsed.pageTitles || {}),
        imageTitles: Object.assign({}, CONFIG_DEFAULTS.imageTitles, parsed.imageTitles || {}),
        imageTitleSources: Object.assign({}, CONFIG_DEFAULTS.imageTitleSources, parsed.imageTitleSources || {}),
      });
    } catch { return CONFIG_DEFAULTS; }
  }
  const CONFIG = loadConfig();
  const HOMEPAGE_MATERIALS = CONFIG.homepageMaterials;
  const FONTS = CONFIG.fonts;

  const params = new URLSearchParams(location.search);
  let currentFont = (params.get("font") || "").replace(/\+/g, " ").trim() || null;
  let currentLightbox = (params.get("lightbox") || localStorage.getItem("preview-lightbox") || "squarespace").trim();
  let currentBg = (params.get("bg") || localStorage.getItem("preview-bg") || "off").trim();

  // Background override: paint the page (body + every Squarespace wrapper
  // that normally carries a background) with one of a small set of solid
  // colors. Implemented as a single injected stylesheet whose contents are
  // rewritten when the option changes. "off" empties the rule and removes
  // the body class so the original Squarespace theme shows through.
  const BG_COLORS = { black: "#000", darkgray: "#3a3a3a", lightgray: "#d9d9d9" };
  function applyBg(id) {
    currentBg = id || "off";
    if (id && id !== "off") localStorage.setItem("preview-bg", id);
    else localStorage.removeItem("preview-bg");
    let style = document.getElementById("preview-bg-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "preview-bg-style";
      document.head.appendChild(style);
    }
    document.body.classList.remove("preview-bg-on");
    style.textContent = "";
    const color = BG_COLORS[currentBg];
    if (!color) return;
    document.body.classList.add("preview-bg-on");
    style.textContent = `
      body.preview-bg-on,
      body.preview-bg-on .section-border,
      body.preview-bg-on .content-wrapper,
      body.preview-bg-on .content,
      body.preview-bg-on main,
      body.preview-bg-on main#page,
      body.preview-bg-on main.container,
      body.preview-bg-on .page,
      body.preview-bg-on .page-section,
      body.preview-bg-on article,
      body.preview-bg-on section.page-section,
      body.preview-bg-on .portfolio-hover,
      body.preview-bg-on .portfolio-hover-display,
      body.preview-bg-on .portfolio-hover-items {
        background: ${color} !important;
        background-color: ${color} !important;
      }
    `;
  }

  const fontStyleEl = document.createElement("style");
  fontStyleEl.id = "preview-font-style";
  document.head.appendChild(fontStyleEl);

  const loadedFonts = new Set();
  function loadGoogleFont(family) {
    if (loadedFonts.has(family)) return;
    loadedFonts.add(family);
    const fam = family.replace(/\s+/g, "+");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${fam}:wght@300;400;500;600;700&display=swap`;
    document.head.appendChild(link);
  }

  function applyFont(family) {
    currentFont = family || null;
    if (!family) {
      fontStyleEl.textContent = "";
    } else {
      loadGoogleFont(family);
      fontStyleEl.textContent =
        `html,body,h1,h2,h3,h4,h5,h6,p,li,a,span,div,button,input,textarea,select,label,td,th{` +
        `font-family:"${family}",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif !important;}`;
    }
    const p = new URLSearchParams(location.search);
    if (family) p.set("font", family); else p.delete("font");
    history.replaceState(null, "", "?" + p.toString() + location.hash);
  }

  if (currentFont) applyFont(currentFont);

  // ---------- Hover-label toggles (home / category × title / material) ----
  // Persisted matrix of which hover labels are shown. Defaults: all on.
  const HOVER_KEY = "preview-hover-labels";
  const HOVER_DEFAULTS = Object.assign({
    homeTitle: true, homeMaterial: true,
    catTitle: true,  catMaterial: true,
  }, CONFIG.hoverLabels || {});
  function loadHoverPrefs() {
    try {
      const v = JSON.parse(localStorage.getItem(HOVER_KEY) || "null");
      return Object.assign({}, HOVER_DEFAULTS, v || {});
    } catch { return { ...HOVER_DEFAULTS }; }
  }
  function saveHoverPrefs(p) { localStorage.setItem(HOVER_KEY, JSON.stringify(p)); }
  function applyHoverPrefs(p) {
    const cl = document.body.classList;
    cl.toggle("preview-show-home-title",    !!p.homeTitle);
    cl.toggle("preview-show-home-material", !!p.homeMaterial);
    cl.toggle("preview-show-cat-title",     !!p.catTitle);
    cl.toggle("preview-show-cat-material",  !!p.catMaterial);
  }
  let hoverPrefs = loadHoverPrefs();
  applyHoverPrefs(hoverPrefs);

  // ---------- Image reorder (Ctrl + drag and drop) ----------
  // Holding Ctrl and dragging from one image and dropping on another swaps
  // their containing blocks in the DOM. Order is persisted per page in
  // localStorage by the original-DOM index of each block, so reloading the
  // page restores the user's chosen order.
  const ORDER_KEY = "preview-image-order";
  const SWAP_LOG_KEY = "preview-image-swaps";
  const IMAGE_TITLES_KEY = "preview-image-titles";

  // Image title resolution: client-side override > config map > img.alt > "".
  // Per the user's rule: if no explicit name is available, render nothing
  // (the lightbox/caption variants render the empty string instead of
  // "Untitled" so unnamed images stay quiet). Filename-derived titles are
  // intentionally NOT a fallback here — that's what produced ugly
  // `DSC_2419` labels before.
  function imageBasenameKey(src) {
    if (!src) return "";
    let f = src.split("?")[0].split("#")[0].split("/").pop() || "";
    try { f = decodeURIComponent(f); } catch {}
    f = f.replace(/@format=\d+w$/i, "");
    f = f.replace(/\(\d+\)(?=\.[a-zA-Z]+$)/, "");
    f = f.replace(/^Copy\+of\+/i, "").replace(/^Copy\s+of\s+/i, "");
    return f;
  }
  function loadLocalImageTitles() {
    try { return JSON.parse(localStorage.getItem(IMAGE_TITLES_KEY) || "{}") || {}; }
    catch { return {}; }
  }
  function saveLocalImageTitles(map) { localStorage.setItem(IMAGE_TITLES_KEY, JSON.stringify(map)); }
  let LOCAL_IMAGE_TITLES = loadLocalImageTitles();
  function imageTitleFor(imgOrSrc) {
    const src = (typeof imgOrSrc === "string")
      ? imgOrSrc
      : (imgOrSrc && (imgOrSrc.currentSrc || imgOrSrc.src)) || "";
    const key = imageBasenameKey(src);
    if (LOCAL_IMAGE_TITLES[key]) return LOCAL_IMAGE_TITLES[key];
    if (CONFIG.imageTitles && CONFIG.imageTitles[key]) return CONFIG.imageTitles[key];
    if (typeof imgOrSrc !== "string" && imgOrSrc && imgOrSrc.alt) {
      const a = imgOrSrc.alt.trim();
      // Skip alt strings that are just the filename / camera-default noise.
      if (a && !/^(?:DSC|DSCN|IMG|MVI|GOPR|P\d{3,7})/i.test(a) && !/\.(?:jpg|jpeg|png|webp|tif{1,2})$/i.test(a)) return a;
    }
    return "";
  }
  function setImageTitle(key, title) {
    key = imageBasenameKey(key);
    if (!key) return;
    if (title) LOCAL_IMAGE_TITLES[key] = title;
    else delete LOCAL_IMAGE_TITLES[key];
    saveLocalImageTitles(LOCAL_IMAGE_TITLES);
    // Best-effort POST to the local dev server's optional endpoint so the
    // override lands in config.json and survives reload across browsers.
    fetch("/preview/api/image-titles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: title || "" }),
    }).catch(() => {});
  }
  function downloadImageTitles() {
    const merged = Object.assign({}, CONFIG.imageTitles || {}, LOCAL_IMAGE_TITLES);
    const blob = new Blob([JSON.stringify({ imageTitles: merged }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "preview-image-titles.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // Track which titles came from /name-images (vision) so we can highlight
  // them in the preview UI and the user can review/approve.
  function isVisionNamed(key) {
    const src = CONFIG.imageTitleSources && CONFIG.imageTitleSources[key];
    return src === "vision";
  }
  function applyVisionLabels(root) {
    const scope = root || document;
    const imgs = scope.querySelectorAll("img");
    imgs.forEach(img => {
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      if (img.dataset.previewVisionTagged === "1") return;
      const key = imageBasenameKey(img.currentSrc || img.src || "");
      if (!key || !isVisionNamed(key)) return;
      const title = (CONFIG.imageTitles && CONFIG.imageTitles[key]) || "";
      if (!title) return;
      const parent = img.parentElement;
      if (!parent) return;
      const cs = getComputedStyle(parent);
      if (cs.position === "static") parent.style.position = "relative";
      const badge = document.createElement("div");
      badge.className = "preview-vision-badge";
      badge.textContent = title;
      badge.title = "AI-generated name — right-click image to edit";
      parent.appendChild(badge);
      img.dataset.previewVisionTagged = "1";
    });
  }
  // Re-run after late image loads so newly-decoded thumbs get badged too.
  function armVisionLabelObserver() {
    applyVisionLabels(document);
    const obs = new MutationObserver(() => applyVisionLabels(document));
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("load", () => applyVisionLabels(document), { once: true });
  }

  // ---- Materials (homepage tile foot labels) -------------------------------
  // Same shape as image titles: a per-browser local override map, plus a
  // best-effort POST to /preview/api/materials so edits survive a reload.
  const MATERIALS_KEY = "preview-homepage-materials";
  function loadLocalMaterials() {
    try { return JSON.parse(localStorage.getItem(MATERIALS_KEY) || "{}") || {}; }
    catch { return {}; }
  }
  function saveLocalMaterials(map) { localStorage.setItem(MATERIALS_KEY, JSON.stringify(map)); }
  let LOCAL_MATERIALS = loadLocalMaterials();
  function materialFor(href) {
    if (!href) return "";
    if (LOCAL_MATERIALS[href]) return LOCAL_MATERIALS[href];
    return (HOMEPAGE_MATERIALS && HOMEPAGE_MATERIALS[href]) || "";
  }
  function setMaterial(href, value) {
    if (!href) return;
    if (value) LOCAL_MATERIALS[href] = value;
    else delete LOCAL_MATERIALS[href];
    saveLocalMaterials(LOCAL_MATERIALS);
    fetch("/preview/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [href]: value || "" }),
    }).catch(() => {});
  }
  function isMaterialEdited(href) {
    return !!LOCAL_MATERIALS[href]
        || (CONFIG.homepageMaterialSources && CONFIG.homepageMaterialSources[href]);
  }

  // ---- Moved-image highlight ----------------------------------------------
  // Any image basename mentioned in the swap log gets an orange "MOVED" badge
  // — visual reminder that the local order differs from what's on Squarespace.
  function movedKeysAll() {
    const keys = new Set();
    try {
      const log = loadSwapLog();
      for (const s of (log.swaps || [])) { if (s.a) keys.add(s.a); if (s.b) keys.add(s.b); }
    } catch {}
    return keys;
  }
  function applyDecorations(root) {
    const scope = root || document;
    const moved = movedKeysAll();
    scope.querySelectorAll("img").forEach(img => {
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      const key = imageBasenameKey(img.currentSrc || img.src || "");
      if (!key) return;
      const parent = img.parentElement;
      if (!parent) return;
      // Vision badge (existing AI · <name>).
      if (isVisionNamed(key) && img.dataset.previewVisionTagged !== "1") {
        const title = (CONFIG.imageTitles && CONFIG.imageTitles[key]) || "";
        if (title) {
          if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
          const b = document.createElement("div");
          b.className = "preview-vision-badge";
          b.textContent = title;
          b.title = "AI-generated name — right-click image to edit";
          parent.appendChild(b);
          img.dataset.previewVisionTagged = "1";
        }
      }
      // Moved badge — image position drifted from Squarespace.
      if (moved.has(key) && img.dataset.previewMovedTagged !== "1") {
        if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
        const m = document.createElement("div");
        m.className = "preview-moved-badge";
        m.textContent = "MOVED";
        m.title = "Reordered locally — not pushed to Squarespace";
        parent.appendChild(m);
        img.dataset.previewMovedTagged = "1";
      }
    });
    // Material-edited tile foots get a gold ring / "edited" affordance.
    scope.querySelectorAll(".preview-thumb-foot").forEach(foot => {
      const tile = foot.closest("[data-preview-tile-href]")
                || foot.parentElement?.querySelector("a[href]");
      const href = tile?.getAttribute?.("data-preview-tile-href")
                || tile?.getAttribute?.("href") || "";
      foot.classList.toggle("preview-material-edited", !!href && isMaterialEdited(href));
    });
  }

  function armDecorationObserver() {
    applyDecorations(document);
    const obs = new MutationObserver(() => applyDecorations(document));
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("load", () => applyDecorations(document), { once: true });
  }

  // Expose for the workspace command's vision-naming flow if needed.
  window.previewImageTitles = { setImageTitle, downloadImageTitles, imageTitleFor };
  window.previewMaterials = { setMaterial, materialFor };
  function imgKey(img) {
    const s = img.currentSrc || img.src || img.getAttribute("data-src") || "";
    return s.split("?")[0];
  }
  // Append a swap record to the global swap log. Per-page, ordered, replayable.
  // Format: { version:1, swaps:[{page, ts, a, b}, ...] }
  function loadSwapLog() {
    try {
      const v = JSON.parse(localStorage.getItem(SWAP_LOG_KEY) || "null");
      if (v && Array.isArray(v.swaps)) return v;
    } catch {}
    return { version: 1, swaps: [] };
  }
  function saveSwapLog(log) { localStorage.setItem(SWAP_LOG_KEY, JSON.stringify(log)); }
  function recordSwap(aKey, bKey) {
    if (!aKey || !bKey || aKey === bKey) return;
    const log = loadSwapLog();
    log.swaps.push({ page: location.pathname, ts: new Date().toISOString(), a: aKey, b: bKey });
    saveSwapLog(log);
  }
  function clearSwapsForCurrentPage() {
    const log = loadSwapLog();
    log.swaps = log.swaps.filter(s => s.page !== location.pathname);
    saveSwapLog(log);
  }
  function downloadSwapLog() {
    const log = loadSwapLog();
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "preview-image-swaps.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function blockOf(img) {
    // Prefer the grid-positioned wrapper used by Squarespace's Fluid Engine
    // (`.fe-block`) when present — that's the unit that has grid-area set
    // and is what we need to swap to keep the layout coherent.
    return img.closest(".fe-block, .gallery-masonry-item, .sqs-gallery-design-grid-slide, .sqs-block, figure, .image-block-wrapper") || img.parentElement;
  }
  function pageOrderKey() {
    const k = ORDER_KEY + ":" + location.pathname;
    return k;
  }
  function loadOrder() {
    // Server config wins so the order survives across browsers / machines.
    // Fall back to localStorage for offline / not-yet-posted edits.
    const fromCfg = (CONFIG.imageOrders && CONFIG.imageOrders[location.pathname]) || null;
    if (fromCfg && fromCfg.length) return fromCfg;
    try { return JSON.parse(localStorage.getItem(pageOrderKey()) || "null"); } catch { return null; }
  }
  function saveOrder(arr) {
    localStorage.setItem(pageOrderKey(), JSON.stringify(arr));
    // Best-effort POST to the dev server so the order lands in config.json
    // and the deploy-time playwright script can replay it against admin.
    fetch("/preview/api/image-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: location.pathname, order: arr }),
    }).catch(() => {});
  }
  function imagesInSavedOrder() {
    const o = loadOrder();
    return new Set((o && o.length) ? o : []);
  }
  function highlightReorderedImages() {
    const set = imagesInSavedOrder();
    if (!set.size) return;
    document.querySelectorAll("img").forEach(img => {
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      const k = imgKey(img);
      if (k && set.has(k)) {
        const block = blockOf(img) || img.parentElement;
        if (block) block.classList.add("preview-reordered");
      }
    });
  }

  function applyStoredOrder() {
    const order = loadOrder();
    if (!order || !order.length) return;
    // Group blocks by their parent, then reorder children within each parent
    // to match the saved sequence (matched by image src key).
    const blocks = Array.from(document.querySelectorAll("img"))
      .map(img => ({ img, key: imgKey(img), block: blockOf(img) }))
      .filter(o => o.block);
    const byParent = new Map();
    for (const b of blocks) {
      if (!byParent.has(b.block.parentNode)) byParent.set(b.block.parentNode, []);
      byParent.get(b.block.parentNode).push(b);
    }
    for (const [parent, group] of byParent) {
      const desired = order.filter(k => group.some(g => g.key === k));
      if (desired.length < 2) continue;
      desired.forEach(k => {
        const item = group.find(g => g.key === k);
        if (item && item.block.parentNode === parent) parent.appendChild(item.block);
      });
      // Append any blocks not in saved order at the end (preserves new images)
      group.filter(g => !desired.includes(g.key)).forEach(g => {
        if (g.block.parentNode === parent) parent.appendChild(g.block);
      });
    }
  }

  function persistCurrentOrder() {
    const keys = [];
    document.querySelectorAll("img").forEach(img => {
      const k = imgKey(img);
      if (k && !keys.includes(k)) keys.push(k);
    });
    saveOrder(keys);
  }

  // Swap two layout blocks visually. On Squarespace's Fluid Engine, blocks
  // are placed by inline `grid-area` (or the row/column-start/end pieces)
  // in a `style` attribute — DOM-reordering them is invisible. So when both
  // blocks have grid-position inline styles, swap THOSE values. Fall back
  // to a comment-placeholder DOM swap when there's no grid positioning.
  const GRID_PROPS = [
    "grid-area",
    "grid-row", "grid-column",
    "grid-row-start", "grid-row-end",
    "grid-column-start", "grid-column-end",
  ];
  function readGridProps(el) {
    const out = {};
    for (const p of GRID_PROPS) {
      const v = el.style.getPropertyValue(p);
      if (v) out[p] = v;
    }
    return out;
  }
  function writeGridProps(el, props) {
    for (const p of GRID_PROPS) el.style.removeProperty(p);
    for (const p in props) el.style.setProperty(p, props[p]);
  }
  function swapNodes(a, b) {
    if (!a || !b || a === b) return;
    const ap = readGridProps(a);
    const bp = readGridProps(b);
    const aHasGrid = Object.keys(ap).length > 0;
    const bHasGrid = Object.keys(bp).length > 0;
    if (aHasGrid && bHasGrid) {
      writeGridProps(a, bp);
      writeGridProps(b, ap);
      return;
    }
    // Masonry / absolutely-positioned galleries: Squarespace re-pins each
    // block to its original index after layout, so swapping DOM order or
    // the block elements themselves is invisible. Swap the inner <img>
    // elements instead — the visual content trades places while the
    // surrounding container boxes stay put.
    const ai = a.querySelector("img");
    const bi = b.querySelector("img");
    if (ai && bi && ai !== bi) {
      const ph = document.createComment("preview-img-swap");
      ai.parentNode.insertBefore(ph, ai);
      bi.parentNode.insertBefore(ai, bi);
      ph.parentNode.insertBefore(bi, ph);
      ph.remove();
      return;
    }
    // Last resort: DOM-swap whole blocks (works for plain-flow layouts).
    const placeholder = document.createComment("preview-swap");
    a.parentNode.insertBefore(placeholder, a);
    b.parentNode.insertBefore(a, b);
    placeholder.parentNode.insertBefore(b, placeholder);
    placeholder.remove();
  }

  function enableDragReorder() {
    // Plain drag-and-drop reorder (no modifier). A short mousedown without
    // movement still acts as a normal click — the drag only activates once
    // the pointer travels past a small threshold, at which point we suppress
    // the trailing click so navigation/lightbox don't fire.
    const ACTIVATE_PX = CONFIG.drag.activatePx;
    let drag = null;
    let ghost = null;
    // Edge auto-scroll while dragging: when the cursor is within EDGE px of the
    // top/bottom of the viewport, scroll the page towards that edge. Speed
    // ramps up as the cursor approaches the edge (max MAX_SPEED px/frame).
    const EDGE = 80;
    const MAX_SPEED = 22;
    let edgeScrollRaf = 0;
    let edgeScrollVy = 0;
    let lastPointerY = 0;
    function edgeScrollTick() {
      edgeScrollRaf = 0;
      if (!drag || !drag.active || !edgeScrollVy) return;
      window.scrollBy(0, edgeScrollVy);
      // After scrolling, the element under the cursor changes — recompute the
      // current target so highlight tracks even when the mouse is stationary.
      updateDragTarget(window.__lastDragX || 0, lastPointerY);
      edgeScrollRaf = requestAnimationFrame(edgeScrollTick);
    }
    function updateEdgeScroll(clientY) {
      lastPointerY = clientY;
      let vy = 0;
      if (clientY < EDGE) {
        vy = -MAX_SPEED * (1 - clientY / EDGE);
      } else if (clientY > window.innerHeight - EDGE) {
        vy = MAX_SPEED * (1 - (window.innerHeight - clientY) / EDGE);
      }
      edgeScrollVy = vy;
      if (vy && !edgeScrollRaf) edgeScrollRaf = requestAnimationFrame(edgeScrollTick);
    }
    function stopEdgeScroll() {
      edgeScrollVy = 0;
      if (edgeScrollRaf) { cancelAnimationFrame(edgeScrollRaf); edgeScrollRaf = 0; }
    }
    function updateDragTarget(clientX, clientY) {
      if (!drag || !drag.active || !ghost) return;
      const under = document.elementFromPoint(clientX, clientY);
      const candidate = under && under.closest ? under.closest("img") : null;
      const target = candidate && candidate !== drag.img &&
                     !candidate.closest("#preview-panel") &&
                     !candidate.closest("#preview-lightbox")
                     ? blockOf(candidate) : null;
      if (target !== drag.target) {
        if (drag.target) drag.target.classList.remove("preview-reorder-target");
        drag.target = target;
        if (target) target.classList.add("preview-reorder-target");
      }
    }

    // Disable native HTML5 drag on every content image / anchor so our
    // mousemove tracking actually runs (native drag suppresses mousemove).
    function disableNativeDrag() {
      document.querySelectorAll("img, a").forEach(el => {
        if (el.closest("#preview-panel") || el.closest("#preview-lightbox")) return;
        el.setAttribute("draggable", "false");
      });
    }
    disableNativeDrag();
    // Also intercept any dragstart that does fire and cancel it.
    window.addEventListener("dragstart", (e) => {
      if (!e.target.closest) return;
      if (e.target.closest("#preview-panel") || e.target.closest("#preview-lightbox")) return;
      e.preventDefault();
    }, true);

    function activate() {
      ghost = document.createElement("div");
      ghost.className = "preview-reorder-ghost";
      const clone = drag.img.cloneNode(true);
      clone.removeAttribute("loading");
      clone.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
      ghost.appendChild(clone);
      document.body.appendChild(ghost);
      drag.block.classList.add("preview-reorder-source");
      document.body.classList.add("preview-reorder-active");
    }

    function down(e) {
      if (e.button !== 0 && e.button !== undefined) return;
      const img = e.target.closest && e.target.closest("img");
      if (!img) {
        console.log("[preview-drag] mousedown — no img under target", e.target?.tagName, e.target?.className);
        return;
      }
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      const block = blockOf(img);
      if (!block) {
        console.log("[preview-drag] mousedown — img has no block ancestor", imgKey(img));
        return;
      }
      console.log("[preview-drag] mousedown OK", { src: imgKey(img), blockTag: block.tagName, blockClass: block.className.slice(0, 80), gridArea: block.style.gridArea || block.style.gridColumnStart });
      drag = { img, block, sx: e.clientX, sy: e.clientY, active: false, target: null };
    }

    function move(e) {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < ACTIVATE_PX) return;
        drag.active = true;
        console.log("[preview-drag] activated (threshold passed)");
        activate();
      }
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      window.__lastDragX = e.clientX;
      updateDragTarget(e.clientX, e.clientY);
      updateEdgeScroll(e.clientY);
    }

    function end() {
      if (!drag) return;
      stopEdgeScroll();
      if (!drag.active) {
        console.log("[preview-drag] mouseup before activation (treated as click)");
        drag = null;
        return;
      }
      const { block, target } = drag;
      block.classList.remove("preview-reorder-source");
      if (target) target.classList.remove("preview-reorder-target");
      document.body.classList.remove("preview-reorder-active");
      if (ghost) { ghost.remove(); ghost = null; }
      if (target) {
        const ap = readGridProps(block);
        const bp = readGridProps(target);
        const mode = (Object.keys(ap).length && Object.keys(bp).length) ? "grid-swap" : "dom-swap";
        console.log("[preview-drag] swap", mode, {
          a: { src: imgKey(drag.img), grid: ap },
          b: { src: imgKey(target.querySelector("img")), grid: bp },
        });
        const aKey = imgKey(drag.img);
        const bImg = target.querySelector("img");
        const bKey = bImg ? imgKey(bImg) : null;
        swapNodes(block, target);
        persistCurrentOrder();
        recordSwap(aKey, bKey);
      } else {
        console.log("[preview-drag] mouseup with no target — no swap");
      }
      // Suppress the trailing click so we don't navigate / lightbox.
      const swallow = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      drag = null;
    }

    window.addEventListener("mousedown", down, true);
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", end, true);
    // Double-click any image to reset the saved order on this page.
    window.addEventListener("dblclick", (e) => {
      const img = e.target.closest && e.target.closest("img");
      if (!img) return;
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      e.preventDefault();
      localStorage.removeItem(pageOrderKey());
      location.reload();
    }, true);
  }

  // ---------- Homepage hover: column shifts, title appears ----------
  function parseGridArea(block) {
    const ga = (block.style.gridArea || getComputedStyle(block).gridArea || "").trim();
    if (!ga || ga === "auto" || ga === "auto / auto / auto / auto") return null;
    const parts = ga.split("/").map(s => s.trim());
    if (parts.length < 4) return null;
    const rs = parseInt(parts[0], 10);
    const cs = parseInt(parts[1], 10);
    const re_ = parseInt(parts[2], 10);
    const ce = parseInt(parts[3], 10);
    if ([rs, cs, re_, ce].some(n => Number.isNaN(n))) return null;
    return { rs, cs, re: re_, ce };
  }

  function enableHomepageHover() {
    if (!isHomePage()) return;
    const fluid = document.querySelectorAll(".fluid-engine");
    if (!fluid.length) return;

    fluid.forEach(grid => {
      // Fluid Engine items: each .fe-block has grid-area set inline.
      const blocks = Array.from(grid.querySelectorAll(".fe-block"))
        .map(b => ({ b, area: parseGridArea(b), a: b.querySelector('a[href]') }))
        .filter(o => o.area && o.a && o.a.querySelector("img") &&
                     /^\//.test(o.a.getAttribute("href") || ""));
      if (!blocks.length) return;

      // Pre-attach a head (title) and foot (material) label to each thumb
      // block. Layout reads top-to-bottom: head, image, foot. They're both
      // absolutely positioned so they don't push the rest of the page; the
      // column-shift logic below opens space above and below the image.
      blocks.forEach(({ b, a }) => {
        if (b.querySelector(".preview-thumb-head")) return;
        const img = a.querySelector("img");
        const bn = img ? imageBasename(img.currentSrc || img.src || img.getAttribute("src") || img.getAttribute("data-src") || "") : "";
        const detailHref = (CONFIG.imageDetailPages && CONFIG.imageDetailPages[bn]) || a.getAttribute("href");
        // Head = title link → detail page.
        const head = document.createElement("a");
        head.className = "preview-thumb-head";
        head.href = detailHref;
        head.textContent = titleFromHref(detailHref);
        // Foot = 3-segment nav: < CATEGORY · zoom · PROJECT >
        const foot = document.createElement("div");
        foot.className = "preview-thumb-foot preview-thumb-nav";
        foot.innerHTML =
          '<a class="ptn-seg ptn-cat" href="#" hidden><span class="ptn-arrow">‹</span><span class="ptn-label"></span></a>' +
          '<a class="ptn-seg ptn-proj" href="' + detailHref + '"><span class="ptn-label">Project</span><span class="ptn-arrow">›</span></a>';
        b.appendChild(head);
        b.appendChild(foot);
        b.classList.add("preview-thumb-block");
        fetchPageMeta(detailHref).then(meta => {
          if (meta.title) head.textContent = meta.title;
        });
        // Resolve the category link async via the category index.
        loadCategoryIndex().then(({ index, categories }) => {
          const catHref = bn ? lookupCategoryFor(bn, index) : null;
          if (!catHref) return;
          const cat = categories.find(c => c.href === catHref);
          const seg = foot.querySelector(".ptn-cat");
          seg.href = catHref;
          seg.querySelector(".ptn-label").textContent = (cat && cat.title) || catHref.replace(/^\//, "").replace(/\.html?$/, "");
          seg.hidden = false;
        });
        // Segment links navigate via default; image clicks (anywhere else)
        // fall through to enableLightboxClicks → lightbox.
      });

      function colSiblings(target) {
        return blocks.filter(o =>
          // share at least one grid column (ranges overlap)
          o.area.cs < target.area.ce && o.area.ce > target.area.cs &&
          // and start at or below the target's row
          o.area.rs >= target.area.rs
        );
      }

      // Measure each label's rendered height at hover-time so the shift
      // adapts to any title format / line count.
      //
      //   Hovered tile shifts down by head_height — exactly. That puts the
      //   head's TOP edge at the image's original top edge (head is anchored
      //   to bottom: 100% of the block, so head.bottom == block.new_top, and
      //   head.bottom - head.height == original_top).
      //
      //   Tiles BELOW the hovered tile in the same column shift by
      //   head_height + foot_height so the active tile's foot lands flush in
      //   the gap that opens between the active and the next-below tile.
      function measure(block, cls) {
        const el = block.querySelector("." + cls);
        return el ? Math.ceil(el.getBoundingClientRect().height) : 0;
      }

      blocks.forEach(o => {
        o.b.addEventListener("mouseenter", () => {
          o.b.classList.add("preview-thumb-active");
        });
        o.b.addEventListener("mouseleave", () => {
          o.b.classList.remove("preview-thumb-active");
        });
      });
    });
  }

  // ---------- Splash hero fade (portfolio only) ----------
  function isPortfolioPage() {
    return /\/portfolio(\.html?)?$/i.test(location.pathname);
  }

  // Find the largest standalone image on the page (not inside an <a>).
  // We pick a single hero per page on the portfolio.
  function findPortfolioHero() {
    const imgs = Array.from(document.querySelectorAll("img"))
      .filter(img => !img.closest("a[href]") && !img.closest("#preview-panel"));
    if (!imgs.length) return null;
    let best = null, bestArea = 0;
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = img; bestArea = area; }
    }
    return best;
  }

  // Make the portfolio hero a full-bleed banner anchored to the top-left of
  // the viewport — width = 100vw, height = 100vh, pinned at (0, 0). The rest
  // of the page flows below it.
  // Parallax rate for the portfolio hero. 0 = pinned, 1 = scrolls with content;
  // ~0.4 gives a noticeable but subtle parallax.
  const PORTFOLIO_PARALLAX = 0.4;
  function moveHeroToTop(hero) {
    if (!hero) return;
    const block = hero.closest(".fe-block, .sqs-block, figure") || hero.parentElement;
    if (!block || !block.parentElement) return;
    if (block.dataset.previewHero === "1") return; // idempotent
    block.dataset.previewHero = "1";
    block.style.cssText +=
      ";grid-area:auto" +
      ";grid-column-start:auto;grid-column-end:auto" +
      ";grid-row-start:auto;grid-row-end:auto" +
      ";position:fixed" +
      ";top:0;left:0" +
      ";width:100vw;height:100vh" +
      ";max-width:none;max-height:none" +
      ";margin:0;padding:0" +
      ";overflow:hidden;z-index:0" +
      ";will-change:transform";
    // Force every fluid-image wrapper inside to fill the banner exactly.
    // Squarespace's `.fluid-image-container` uses `padding-bottom: N%` to
    // hold an aspect ratio with the image absolutely positioned inside —
    // setting `height:100%` doesn't override that, so we also zero
    // padding-bottom and pin the inner <img> to `inset:0` so it truly fills
    // the 100vw×100vh box. Without this the image crops at a slightly
    // different rect than the splash overlay (which IS 100vw×100vh, object-
    // fit:cover) and you see a small jump when the splash fades.
    block.querySelectorAll(
      ".fluid-image-component-root, .fluid-image-animation-wrapper, .fluid-image-container, .sqs-block-content, .sqs-block, a"
    ).forEach(el => {
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.maxHeight = "none";
      el.style.maxWidth = "none";
      el.style.paddingBottom = "0";
      el.style.position = "relative";
    });
    if (hero) {
      hero.style.position = "absolute";
      hero.style.inset = "0";
      hero.style.width = "100%";
      hero.style.height = "100%";
      hero.style.objectFit = "cover";
      hero.style.maxWidth = "none";
      hero.style.maxHeight = "none";
    }
    // Pin to viewport (0,0) as the bottommost layer so the page header,
    // overlay text, and any project-thumb links render naturally on top.
    document.documentElement.style.margin = "0";
    document.body.style.margin = "0";
    // Force any site header to be transparent so it doesn't sit opaque
    // over the full-bleed banner.
    const headerSelectors = [
      "header", "#header", ".header",
      "[data-test='header']", ".site-header", ".sqs-header",
    ];
    document.querySelectorAll(headerSelectors.join(",")).forEach(h => {
      h.style.background = "transparent";
      h.style.backgroundColor = "transparent";
    });
    // Force opaque page wrappers transparent so the fixed hero can be seen
    // behind them. Inline-style is reset by Squarespace's late runtime, so
    // inject a stylesheet rule with !important that sticks. Scoped to the
    // portfolio page via body-class so we don't affect other pages.
    if (!document.getElementById("preview-portfolio-bg")) {
      const css = document.createElement("style");
      css.id = "preview-portfolio-bg";
      css.textContent = `
        body.preview-portfolio-bg .section-border,
        body.preview-portfolio-bg .content-wrapper,
        body.preview-portfolio-bg .content,
        body.preview-portfolio-bg main#page,
        body.preview-portfolio-bg main.container,
        body.preview-portfolio-bg .page,
        body.preview-portfolio-bg .page-section,
        body.preview-portfolio-bg article,
        body.preview-portfolio-bg section.page-section,
        body.preview-portfolio-bg .portfolio-hover,
        body.preview-portfolio-bg .portfolio-hover-display,
        body.preview-portfolio-bg .portfolio-hover-items {
          background: transparent !important;
          background-color: transparent !important;
        }
      `;
      document.head.appendChild(css);
    }
    document.body.classList.add("preview-portfolio-bg");
    document.body.insertBefore(block, document.body.firstChild);
  }

  // Apply parallax translation to a previously-pinned hero block. Runs on
  // every scroll/resize. Idempotent — safe to call multiple times.
  function armPortfolioParallax() {
    const block = document.querySelector('[data-preview-hero="1"]');
    if (!block) return;
    let raf = 0;
    function update() {
      raf = 0;
      const y = window.scrollY * PORTFOLIO_PARALLAX;
      block.style.transform = `translate3d(0, ${y}px, 0)`;
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(update); }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
  }

  // Always pin the portfolio hero on portfolio pages — not only on the first
  // visit (which was previously gated by the splash-played flag). Without
  // this, reloads showed the hero scrolling with content (no parallax).
  function ensurePortfolioHeroPinned() {
    if (!isPortfolioPage()) return;
    if (document.querySelector('[data-preview-hero="1"]')) {
      armPortfolioParallax();
      return;
    }
    const hero = findPortfolioHero();
    if (!hero) return;
    moveHeroToTop(hero);
    armPortfolioParallax();
  }

  // Wait for every <img> whose layout-rect intersects the first viewport
  // to be fully loaded (or fail). Resolves once they're all done, or after
  // `maxWaitMs` as a safety net so a stuck network never freezes the splash.
  function waitForFirstScreenImages(maxWaitMs) {
    const targets = Array.from(document.querySelectorAll("img"))
      .filter(img => !img.closest("#preview-panel") && !img.closest("#preview-lightbox") && !img.closest(".preview-splash-overlay"))
      .filter(img => {
        const r = img.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const docTop = r.top + window.scrollY;
        // Anything that overlaps the first-screen window (with a small buffer).
        return docTop < window.innerHeight + 200 && docTop + r.height > -200;
      });
    if (!targets.length) return Promise.resolve();

    const each = targets.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(res => {
        const done = () => {
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          res();
        };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    });
    return Promise.race([
      Promise.all(each),
      new Promise(res => setTimeout(res, maxWaitMs)),
    ]);
  }

  // Walk up from body looking for the first non-transparent background color.
  // Squarespace often paints the page background on a wrapper, leaving body
  // itself rgba(0,0,0,0). If we use that as the overlay bg, the page leaks
  // through during the hold.
  function pageBgColor() {
    let n = document.body;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "transparent" && !/^rgba\([^)]*,\s*0\s*\)$/.test(c)) return c;
      n = n.parentElement;
    }
    const html = getComputedStyle(document.documentElement).backgroundColor;
    if (html && html !== "transparent" && !/^rgba\([^)]*,\s*0\s*\)$/.test(html)) return html;
    return "#ffffff";
  }

  // Generic splash: cover the page with `srcUrl` (object-fit: cover, no
  // distortion). Hold until both the splash image AND the first viewport's
  // worth of in-page images are loaded — so when the splash translates and
  // fades, the target box and everything around it is already painted.
  // The target image is NOT hidden; the splash overlays it during the hold
  // and reveals it as it fades.
  // Per-tab record of which splash images have already been shown — so a
  // given image's splash transition only ever fires once per session,
  // regardless of which page-pair triggered it. (Home → category via X,
  // then category → detail via X: the second hop has no splash.)
  const SPLASH_SHOWN_KEY = "preview-splash-shown";
  function loadShownSplash() {
    try { return new Set(JSON.parse(sessionStorage.getItem(SPLASH_SHOWN_KEY) || "[]")); }
    catch { return new Set(); }
  }
  function markSplashShown(srcUrl) {
    const key = imageBasenameKey(srcUrl);
    if (!key) return;
    const set = loadShownSplash();
    set.add(key);
    sessionStorage.setItem(SPLASH_SHOWN_KEY, JSON.stringify([...set]));
  }
  function hasSplashShown(srcUrl) {
    return loadShownSplash().has(imageBasenameKey(srcUrl));
  }

  function playSplash(srcUrl, targetImg) {
    if (!srcUrl) return;
    if (hasSplashShown(srcUrl)) {
      // Already shown this session — clear pre-blank and skip the overlay.
      const pre = document.getElementById("preview-splash-preblank");
      if (pre) pre.remove();
      return;
    }
    markSplashShown(srcUrl);
    const TRANSITION_MS = CONFIG.splash.transitionMs;
    const FADE_IN_MS = CONFIG.splash.fadeInMs;
    const MIN_HOLD_MS = CONFIG.splash.minHoldMs;
    const MAX_HOLD_MS = CONFIG.splash.maxHoldMs;

    const overlay = document.createElement("div");
    overlay.className = "preview-splash-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;" +
      "background:" + pageBgColor() + ";" +
      "z-index:300000;" +
      "pointer-events:none;" +
      "overflow:hidden;" +
      "opacity:1;" +
      "transition:opacity " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1);";

    const splashImg = document.createElement("img");
    splashImg.alt = "";
    splashImg.style.cssText =
      "position:fixed;" +
      "top:0;left:0;" +
      "width:100vw;height:100vh;" +
      "object-fit:contain;" +
      "background:" + pageBgColor() + ";" +
      "display:block;" +
      "opacity:0;" +
      "transition:opacity " + FADE_IN_MS + "ms ease;";
    overlay.appendChild(splashImg);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);

    function imageReady(img) {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(res => {
        img.addEventListener("load", res, { once: true });
        img.addEventListener("error", res, { once: true });
      });
    }

    // Begin loading the splash image. Fade it in once it's actually painted.
    splashImg.addEventListener("load", () => {
      splashImg.style.opacity = "1";
    }, { once: true });
    splashImg.src = srcUrl;

    function startFade() {
      // Reveal the underlying page just before the splash fades into it,
      // so the target image (and the rest) are visible as the splash
      // crossfades into place.
      const pre = document.getElementById("preview-splash-preblank");
      if (pre) pre.remove();
      // Switch to the long transition so position + opacity ease together.
      splashImg.style.transition =
        "top " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "left " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "width " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "height " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "opacity " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)";
      if (targetImg && targetImg.isConnected) {
        const r = targetImg.getBoundingClientRect();
        Object.assign(splashImg.style, {
          top: r.top + "px",
          left: r.left + "px",
          width: r.width + "px",
          height: r.height + "px",
          opacity: "0",
        });
      } else {
        splashImg.style.opacity = "0";
      }
      overlay.style.opacity = "0";
      setTimeout(() => {
        overlay.remove();
        document.body.style.overflow = prevOverflow;
      }, TRANSITION_MS + 100);
    }

    const start = performance.now();
    Promise.all([
      imageReady(splashImg),
      waitForFirstScreenImages(MAX_HOLD_MS),
    ]).then(() => {
      const elapsed = performance.now() - start;
      const wait = Math.max(0, MIN_HOLD_MS - elapsed);
      setTimeout(startFade, wait);
    });
  }

  // Strip Squarespace's "Copy of" prefix and the format query so we can
  // match a homepage thumb (typically "Copy+of+Foo_06.jpg") against the
  // canonical version on the destination page ("Foo_06.jpg").
  function imageBasename(url) {
    if (!url) return "";
    let f = url.split("?")[0].split("/").pop() || "";
    f = decodeURIComponent(f).toLowerCase();
    // The wget mirror replaced `?format=Nw` query strings with a literal
    // `@format=Nw` suffix in filenames — strip everything after the
    // extension so they match canonical basenames.
    f = f.replace(/(\.[a-z0-9]+)@.*$/, "$1");
    f = f.replace(/^copy\+of\+/, "").replace(/^copy\s+of\s+/, "");
    return f;
  }

  // Find an image on the current page that matches a given source URL.
  // Used to "land" an arrival splash on the right tile of the destination
  // and to scroll the selected image into view.
  function findImageBySrc(srcUrl) {
    if (!srcUrl) return null;
    const want = imageBasename(srcUrl);
    if (!want) return null;
    const candidates = Array.from(document.querySelectorAll("img"))
      .filter(img => !img.closest("#preview-panel") && !img.closest("#preview-lightbox"));
    // Basename match (after stripping "Copy of" / format query)
    let hit = candidates.find(img => imageBasename(img.currentSrc || img.src || "") === want);
    if (hit) return hit;
    // Loose contains-match: clicked image's stem appears in candidate's name.
    const stem = want.replace(/\.[a-z0-9]+$/, "");
    if (stem.length >= 4) {
      hit = candidates.find(img => imageBasename(img.currentSrc || img.src || "").includes(stem));
      if (hit) return hit;
    }
    // Otherwise the largest image — likely a hero on the destination page.
    let best = null, bestArea = 0;
    for (const img of candidates) {
      const r = img.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { best = img; bestArea = area; }
    }
    return best;
  }

  function runSplash() {
    // 1) Arrival splash: home page click stored a {src, href}; if we landed
    // on the matching detail page, play splash from that image to its
    // counterpart on this page.
    const stored = sessionStorage.getItem("preview-splash-arrival");
    if (stored) {
      sessionStorage.removeItem("preview-splash-arrival");
      try {
        const info = JSON.parse(stored);
        if (info && info.href === location.pathname && info.src) {
          const target = findImageBySrc(info.src);
          // Center the matching image in the viewport once it is
          // initialized. Use the native scrollIntoView so the browser
          // handles any viewport size correctly. Re-fire on subsequent
          // load events too, since Squarespace's progressive image loader
          // emits multiple `load` events as higher-res variants arrive
          // and the surrounding layout settles.
          const center = () => {
            if (!target || !target.isConnected) return;
            const r = target.getBoundingClientRect();
            if (r.height < 8) return;
            target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
          };
          // Category-origin clicks stash `noCenter: true` so the detail page
          // lands at scrollTop:0 instead of centering the matched image —
          // category browsing is meant to be a top-of-page experience.
          if (target && !info.noCenter) {
            target.loading = "eager";
            if (target.complete && target.naturalWidth > 0) center();
            target.addEventListener("load", center);
            // Final pass after all resources settle, in case images above
            // the target finished loading after our last call.
            window.addEventListener("load", () => requestAnimationFrame(center), { once: true });
          } else if (info.noCenter) {
            // Force top-of-page even if the browser tried to restore a
            // prior scroll position for this URL.
            window.scrollTo(0, 0);
            requestAnimationFrame(() => window.scrollTo(0, 0));
          }
          // Wait one rAF so any layout from arrival is settled.
          requestAnimationFrame(() => playSplash(info.src, target));
          return;
        }
      } catch {}
    }

    // 2) Portfolio's own self-splash on first visit.
    if (!isPortfolioPage()) return;
    if (sessionStorage.getItem("preview-splash-played") === location.pathname) return;
    sessionStorage.setItem("preview-splash-played", location.pathname);

    const hero = findPortfolioHero();
    if (!hero) return;
    moveHeroToTop(hero);
    requestAnimationFrame(() => playSplash(hero.currentSrc || hero.src, hero));
  }

  // Capture homepage anchor clicks and stash the clicked image's src so the
  // destination page can resume the splash on arrival. We do NOT prevent
  // navigation — the click proceeds normally.
  function captureNavSplash() {
    window.addEventListener("click", (e) => {
      if (e.button !== 0 && e.button !== undefined) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href || /^https?:\/\//.test(href) || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return;
      const img = a.querySelector("img");
      if (!img) return;
      try {
        sessionStorage.setItem("preview-splash-arrival", JSON.stringify({
          src: (img.currentSrc || img.src || "").replace(/\?format=\d+w$/, "?format=2500w"),
          href: new URL(href, location.href).pathname,
        }));
      } catch {}
    }, true);
  }

  // ---------- Lightboxes ----------
  // Each lightbox style is a function(images, startIndex) -> { close }.
  // The host wires up keyboard / arrow controls; the style supplies the markup.

  function getLinkedPage(img) {
    const a = img.closest("a[href]");
    if (!a) return null;
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return null;
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return null;
      // Skip self-link
      if (url.pathname === location.pathname && !url.hash) return null;
      return url.pathname + url.search + url.hash;
    } catch { return null; }
  }

  function gatherImages() {
    return Array.from(document.querySelectorAll("img"))
      .filter(img => {
        if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return false;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w && h && (w < 120 || h < 120)) return false;
        const cs = getComputedStyle(img);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        return true;
      })
      .map(img => ({
        src: (img.currentSrc || img.src || "").replace(/\?format=\d+w$/, "?format=2500w"),
        alt: imageTitleFor(img),
        href: getLinkedPage(img),
      }))
      .filter(o => o.src);
  }

  function setPageLink(root, image) {
    let link = root.querySelector(".lb-page-link");
    if (!image.href) {
      if (link) link.hidden = true;
      return;
    }
    if (!link) {
      link = document.createElement("a");
      link.className = "lb-page-link";
      root.appendChild(link);
    }
    link.hidden = false;
    link.href = image.href;
    const label = image.href.replace(/^\//, "").replace(/\.html$/, "").replace(/[-_/]+/g, " ").trim() || "page";
    link.textContent = `View page: ${label} →`;
  }

  function makeRoot(className) {
    const root = document.createElement("div");
    root.id = "preview-lightbox";
    root.className = "preview-lightbox style-" + className;
    return root;
  }

  function basicNavWiring(root, total, getIndex, setIndex, close) {
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setIndex((getIndex() + 1) % total);
      else if (e.key === "ArrowLeft") setIndex((getIndex() - 1 + total) % total);
    });
  }

  // 1) Squarespace classic — black overlay, centered, side arrows, X close, fade.
  function squarespaceLightbox(images, startIndex) {
    const root = makeRoot("squarespace");
    let i = startIndex;
    root.innerHTML = `
      <button class="lb-close" aria-label="Close">×</button>
      <button class="lb-prev" aria-label="Previous">‹</button>
      <div class="lb-stage"><img alt=""></div>
      <button class="lb-next" aria-label="Next">›</button>
      <div class="lb-title-bar"></div>
      <div class="lb-counter"></div>
    `;
    const stageImg = root.querySelector(".lb-stage img");
    const titleBar = root.querySelector(".lb-title-bar");
    const counter = root.querySelector(".lb-counter");
    function render() {
      stageImg.src = images[i].src;
      stageImg.alt = images[i].alt;
      titleBar.textContent = images[i].alt || "";
      titleBar.style.display = images[i].alt ? "" : "none";
      counter.textContent = `${i + 1} / ${images.length}`;
      const multi = images.length > 1;
      root.querySelector(".lb-prev").style.display = multi ? "" : "none";
      root.querySelector(".lb-next").style.display = multi ? "" : "none";
      counter.style.display = multi ? "" : "none";
      setPageLink(root, images[i]);
    }
    function close() { root.remove(); document.body.style.overflow = ""; }
    root.querySelector(".lb-close").addEventListener("click", close);
    root.querySelector(".lb-prev").addEventListener("click", () => { i = (i - 1 + images.length) % images.length; render(); });
    root.querySelector(".lb-next").addEventListener("click", () => { i = (i + 1) % images.length; render(); });
    root.addEventListener("click", (e) => { if (e.target === root || e.target.classList.contains("lb-stage")) close(); });
    basicNavWiring(root, images.length, () => i, (n) => { i = n; render(); }, close);
    document.body.appendChild(root); document.body.style.overflow = "hidden";
    root.tabIndex = -1; root.focus(); render();
    return { close };
  }

  // 2) Minimal — image only, dim backdrop, click anywhere to close, no chrome.
  function minimalLightbox(images, startIndex) {
    const root = makeRoot("minimal");
    let i = startIndex;
    root.innerHTML = `<img alt=""><div class="lb-title-bar"></div>`;
    const img = root.querySelector("img");
    const titleBar = root.querySelector(".lb-title-bar");
    function render() {
      img.src = images[i].src; img.alt = images[i].alt;
      titleBar.textContent = images[i].alt || "";
      titleBar.style.display = images[i].alt ? "" : "none";
      setPageLink(root, images[i]);
    }
    function close() { root.remove(); document.body.style.overflow = ""; }
    root.addEventListener("click", close);
    basicNavWiring(root, images.length, () => i, (n) => { i = n; render(); }, close);
    document.body.appendChild(root); document.body.style.overflow = "hidden";
    root.tabIndex = -1; root.focus(); render();
    return { close };
  }

  // 3) Caption — image left, alt text + index right.
  function captionLightbox(images, startIndex) {
    const root = makeRoot("caption");
    let i = startIndex;
    root.innerHTML = `
      <button class="lb-close" aria-label="Close">×</button>
      <div class="lb-image"><img alt=""></div>
      <aside class="lb-side">
        <h3 class="lb-title"></h3>
        <p class="lb-meta"></p>
        <div class="lb-actions">
          <button class="lb-prev">← Previous</button>
          <button class="lb-next">Next →</button>
        </div>
      </aside>
    `;
    const stageImg = root.querySelector(".lb-image img");
    const title = root.querySelector(".lb-title");
    const meta = root.querySelector(".lb-meta");
    function render() {
      stageImg.src = images[i].src;
      stageImg.alt = images[i].alt;
      title.textContent = images[i].alt || "";
      meta.textContent = `${i + 1} of ${images.length}`;
      setPageLink(root, images[i]);
    }
    function close() { root.remove(); document.body.style.overflow = ""; }
    root.querySelector(".lb-close").addEventListener("click", close);
    root.querySelector(".lb-prev").addEventListener("click", () => { i = (i - 1 + images.length) % images.length; render(); });
    root.querySelector(".lb-next").addEventListener("click", () => { i = (i + 1) % images.length; render(); });
    root.addEventListener("click", (e) => { if (e.target === root) close(); });
    basicNavWiring(root, images.length, () => i, (n) => { i = n; render(); }, close);
    document.body.appendChild(root); document.body.style.overflow = "hidden";
    root.tabIndex = -1; root.focus(); render();
    return { close };
  }

  // 4) Polaroid — image with thick white border + drop shadow + slight tilt.
  function polaroidLightbox(images, startIndex) {
    const root = makeRoot("polaroid");
    let i = startIndex;
    root.innerHTML = `
      <button class="lb-close" aria-label="Close">×</button>
      <button class="lb-prev" aria-label="Previous">‹</button>
      <figure class="lb-card"><img alt=""><figcaption></figcaption></figure>
      <button class="lb-next" aria-label="Next">›</button>
    `;
    const stageImg = root.querySelector(".lb-card img");
    const cap = root.querySelector(".lb-card figcaption");
    function render() {
      stageImg.src = images[i].src;
      stageImg.alt = images[i].alt;
      cap.textContent = images[i].alt || "";
      setPageLink(root, images[i]);
    }
    function close() { root.remove(); document.body.style.overflow = ""; }
    root.querySelector(".lb-close").addEventListener("click", close);
    root.querySelector(".lb-prev").addEventListener("click", () => { i = (i - 1 + images.length) % images.length; render(); });
    root.querySelector(".lb-next").addEventListener("click", () => { i = (i + 1) % images.length; render(); });
    root.addEventListener("click", (e) => { if (e.target === root) close(); });
    basicNavWiring(root, images.length, () => i, (n) => { i = n; render(); }, close);
    document.body.appendChild(root); document.body.style.overflow = "hidden";
    root.tabIndex = -1; root.focus(); render();
    return { close };
  }

  // 5) Carousel — horizontal slider, snaps between images.
  function carouselLightbox(images, startIndex) {
    const root = makeRoot("carousel");
    let i = startIndex;
    root.innerHTML = `
      <button class="lb-close" aria-label="Close">×</button>
      <div class="lb-track"></div>
      <div class="lb-title-bar"></div>
      <div class="lb-dots"></div>
    `;
    const track = root.querySelector(".lb-track");
    const titleBar = root.querySelector(".lb-title-bar");
    const dots = root.querySelector(".lb-dots");
    images.forEach((im, idx) => {
      const slide = document.createElement("div");
      slide.className = "lb-slide";
      const cap = (im.alt || "").replace(/"/g, "&quot;");
      slide.innerHTML = `<img alt="${cap}" src="${im.src}">`;
      track.appendChild(slide);
      const dot = document.createElement("button");
      dot.className = "lb-dot";
      dot.addEventListener("click", () => { i = idx; render(); });
      dots.appendChild(dot);
    });
    function render() {
      track.style.transform = `translateX(-${i * 100}%)`;
      dots.querySelectorAll(".lb-dot").forEach((d, idx) => d.classList.toggle("active", idx === i));
      titleBar.textContent = images[i].alt || "";
      titleBar.style.display = images[i].alt ? "" : "none";
      setPageLink(root, images[i]);
    }
    function close() { root.remove(); document.body.style.overflow = ""; }
    root.querySelector(".lb-close").addEventListener("click", close);
    root.addEventListener("click", (e) => { if (e.target === root) close(); });
    basicNavWiring(root, images.length, () => i, (n) => { i = n; render(); }, close);
    document.body.appendChild(root); document.body.style.overflow = "hidden";
    root.tabIndex = -1; root.focus(); render();
    return { close };
  }

  const LIGHTBOX_STYLES = [
    { id: "squarespace", label: "Squarespace classic", fn: squarespaceLightbox },
    { id: "minimal",     label: "Minimal (image only)", fn: minimalLightbox },
    { id: "caption",     label: "Caption sidebar",      fn: captionLightbox },
    { id: "polaroid",    label: "Polaroid frame",       fn: polaroidLightbox },
    { id: "carousel",    label: "Carousel",             fn: carouselLightbox },
  ];

  function isHomePage() {
    const p = location.pathname;
    return p === "/" || /\/index(?:\.html?)?$/i.test(p);
  }

  // Background fetch + cache of target page metadata. Returns {title, desc}.
  const metaCache = new Map();
  function titleFromHref(href) {
    // Static map first (built by preview/build-page-titles.py from each
    // detail page's <title>). Falls back to a filename-derived title so
    // pages missing from the map still render something readable.
    try {
      const u = new URL(href, location.href);
      const fromMap = CONFIG.pageTitles && CONFIG.pageTitles[u.pathname];
      if (fromMap) return fromMap;
      const last = (u.pathname.split("/").filter(Boolean).pop() || "")
        .replace(/\.html?$/i, "")
        .replace(/_+/g, "-");
      return last
        .split("-")
        .filter(Boolean)
        .map(w => w.toLowerCase() === "and" ? "&" : (w[0].toUpperCase() + w.slice(1)))
        .join(" ");
    } catch { return href; }
  }
  async function fetchPageMeta(href) {
    if (metaCache.has(href)) return metaCache.get(href);
    const promise = (async () => {
      const fallbackTitle = titleFromHref(href);
      try {
        const res = await fetch(href, { credentials: "same-origin" });
        if (!res.ok) throw new Error("status " + res.status);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        // Prefer the editor-typed H1 inside .sqs-html-content over Squarespace's
        // auto-derived <title>/og:title — those are slug-cased ("Green Loopy
        // HP") whereas the H1 is the artist's real piece name ("LIBELLULE
        // HEADPIECE"). Matches build-page-titles.py's source-of-truth order.
        const sqsH1 = doc.querySelector(".sqs-html-content h1")?.textContent?.trim();
        let title = sqsH1
                 || (doc.querySelector('meta[property="og:title"]')?.content
                  || doc.title || "").replace(/\s*[—–-]\s*MH\s*$/i, "").trim();
        if (!title) title = fallbackTitle;
        let desc =
          doc.querySelector('meta[name="description"]')?.content ||
          doc.querySelector('meta[property="og:description"]')?.content ||
          (doc.querySelector(".sqs-block-html .sqs-html-content p")?.textContent || "") ||
          (doc.querySelector("p")?.textContent || "");
        desc = (desc || "").trim().replace(/\s+/g, " ");
        if (desc.length > 240) desc = desc.slice(0, 237) + "…";
        return { title, desc };
      } catch (e) {
        return { title: fallbackTitle, desc: "" };
      }
    })();
    metaCache.set(href, promise);
    return promise;
  }

  // Home-page carousel: one slide per linked subpage, with title + blurb + CTA,
  // auto-advance, prev/next, dots, ESC/arrows, click backdrop to close.
  function pagePreviewCarousel(items, startIndex) {
    const root = makeRoot("page-preview");
    let i = startIndex;
    let timer = null;
    const ADVANCE_MS = CONFIG.carousel.advanceMs;

    root.innerHTML = `
      <button class="lb-close" aria-label="Close">×</button>
      <button class="lb-prev" aria-label="Previous">‹</button>
      <article class="lb-card">
        <div class="lb-image"><img alt=""></div>
        <div class="lb-info">
          <div class="lb-progress"><span></span></div>
          <h2 class="lb-title">…</h2>
          <p class="lb-desc">Loading…</p>
          <div class="lb-actions">
            <a class="lb-cta" href="#">View detail page →</a>
            <button class="lb-play" type="button" aria-label="Pause">⏸</button>
          </div>
          <div class="lb-counter"></div>
        </div>
      </article>
      <button class="lb-next" aria-label="Next">›</button>
      <div class="lb-dots"></div>
    `;
    const stage = root.querySelector(".lb-image img");
    const titleEl = root.querySelector(".lb-title");
    const descEl = root.querySelector(".lb-desc");
    const cta = root.querySelector(".lb-cta");
    const counter = root.querySelector(".lb-counter");
    const playBtn = root.querySelector(".lb-play");
    const progress = root.querySelector(".lb-progress span");
    const dotsBox = root.querySelector(".lb-dots");

    items.forEach((_, idx) => {
      const d = document.createElement("button");
      d.className = "lb-dot";
      d.addEventListener("click", () => { i = idx; render(); resetTimer(); });
      dotsBox.appendChild(d);
    });

    async function render() {
      const it = items[i];
      stage.src = it.src;
      stage.alt = it.alt || "";
      titleEl.textContent = "Loading…";
      descEl.textContent = "";
      cta.href = it.href;
      counter.textContent = `${i + 1} / ${items.length}`;
      dotsBox.querySelectorAll(".lb-dot").forEach((d, idx) => d.classList.toggle("active", idx === i));
      // Restart progress animation
      progress.style.transition = "none";
      progress.style.width = "0%";
      void progress.offsetWidth;
      if (timer) {
        progress.style.transition = `width ${ADVANCE_MS}ms linear`;
        progress.style.width = "100%";
      }
      const meta = await fetchPageMeta(it.href);
      // Avoid stale write if user advanced
      if (items[i].href === it.href) {
        titleEl.textContent = meta.title;
        descEl.textContent = meta.desc || "";
      }
    }
    function step(d) { i = (i + d + items.length) % items.length; render(); resetTimer(); }
    function resetTimer() {
      if (timer) { clearInterval(timer); timer = setInterval(() => step(1), ADVANCE_MS); }
    }
    function play() {
      timer = setInterval(() => step(1), ADVANCE_MS);
      playBtn.textContent = "⏸";
      playBtn.setAttribute("aria-label", "Pause");
      // restart progress for current slide
      progress.style.transition = "none"; progress.style.width = "0%";
      void progress.offsetWidth;
      progress.style.transition = `width ${ADVANCE_MS}ms linear`; progress.style.width = "100%";
    }
    function pause() {
      if (timer) { clearInterval(timer); timer = null; }
      playBtn.textContent = "▶";
      playBtn.setAttribute("aria-label", "Play");
      progress.style.transition = "none"; progress.style.width = "0%";
    }
    function close() { pause(); root.remove(); document.body.style.overflow = ""; }

    root.querySelector(".lb-close").addEventListener("click", close);
    root.querySelector(".lb-prev").addEventListener("click", () => step(-1));
    root.querySelector(".lb-next").addEventListener("click", () => step(1));
    playBtn.addEventListener("click", () => { timer ? pause() : play(); });
    root.addEventListener("click", (e) => { if (e.target === root) close(); });
    basicNavWiring(root, items.length, () => i, (n) => { i = n; render(); resetTimer(); }, close);

    // Pre-warm metadata for all slides
    items.forEach(it => fetchPageMeta(it.href));

    document.body.appendChild(root);
    document.body.style.overflow = "hidden";
    root.tabIndex = -1; root.focus();
    // Start paused — user advances manually with arrows / dots / keys, or
    // hits the play button to start auto-advance.
    pause();
    render();
    return { close };
  }

  function openLightbox(srcImg) {
    const all = gatherImages();
    if (!all.length) return;
    const target = (srcImg.currentSrc || srcImg.src || "").replace(/\?format=\d+w$/, "?format=2500w");
    let idx = all.findIndex(o => o.src === target);
    if (idx < 0) idx = 0;
    const style = LIGHTBOX_STYLES.find(s => s.id === currentLightbox) || LIGHTBOX_STYLES[0];
    style.fn(all, idx);
  }

  function setLightboxStyle(id) {
    currentLightbox = id;
    localStorage.setItem("preview-lightbox", id);
    const p = new URLSearchParams(location.search);
    p.set("lightbox", id);
    history.replaceState(null, "", "?" + p.toString() + location.hash);
  }

  function enableLightboxClicks() {
    function handler(e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (e.type === "click" && e.button !== 0 && e.button !== undefined) return;

      let img = e.target.closest && e.target.closest("img");
      if (!img) {
        const a = e.target.closest && e.target.closest("a[href]");
        if (a) img = a.querySelector("img");
      }
      if (!img) return;
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      // Don't intercept clicks on our own nav segments (head link, foot
      // category/zoom/project segments) — they have their own behavior.
      if (e.target.closest && e.target.closest(".preview-thumb-head, .preview-thumb-nav, .preview-thumb-foot")) return;
      // The /projects.html cards are full-width links to detail pages —
      // never open a lightbox from there.
      if (e.target.closest && e.target.closest(".preview-projects-link, #preview-projects-list")) return;

      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w && h && (w < 120 || h < 120)) return;

      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      if (e.type === "click") openLightbox(img);
    }
    window.addEventListener("click", handler, true);
  }

  // ---------- Floating control panel ----------
  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "preview-panel";
    panel.innerHTML = `
      <button class="pp-toggle" type="button" aria-expanded="false">
        <span class="pp-dot"></span> Preview
      </button>
      <div class="pp-body" hidden>
        <section class="pp-section">
          <header>Font</header>
          <input type="text" class="pp-search" placeholder="Search Google Fonts…" />
          <div class="pp-fonts"></div>
        </section>
        <section class="pp-section">
          <header>Lightbox style</header>
          <div class="pp-lightboxes"></div>
        </section>
        <section class="pp-section">
          <header>Background (temporary)</header>
          <div class="pp-bgs"></div>
        </section>
        <section class="pp-section">
          <header>Hover labels</header>
          <table class="pp-hover-matrix">
            <thead><tr><th></th><th>Title</th><th>Material</th></tr></thead>
            <tbody>
              <tr>
                <th>Home</th>
                <td><label><input type="checkbox" data-hk="homeTitle"></label></td>
                <td><label><input type="checkbox" data-hk="homeMaterial"></label></td>
              </tr>
              <tr>
                <th>Category</th>
                <td><label><input type="checkbox" data-hk="catTitle"></label></td>
                <td><label><input type="checkbox" data-hk="catMaterial"></label></td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="pp-section">
          <header>Image order</header>
          <div class="pp-order">
            <button type="button" class="pp-order-btn" data-act="download">Download swap log</button>
            <button type="button" class="pp-order-btn" data-act="reset">Reset image order (this page)</button>
          </div>
        </section>
        <section class="pp-section">
          <header>Image titles</header>
          <div class="pp-imgtitles-hint">Right-click any image to rename it (saved per-browser; posts to local dev server if available).</div>
          <div class="pp-order">
            <button type="button" class="pp-imgtitles-btn" data-act="download">Download titles JSON</button>
            <button type="button" class="pp-imgtitles-btn" data-act="reset">Clear local title overrides</button>
          </div>
        </section>
      </div>
    `;
    document.body.appendChild(panel);

    const toggle = panel.querySelector(".pp-toggle");
    const body = panel.querySelector(".pp-body");
    toggle.addEventListener("click", () => {
      const open = body.hasAttribute("hidden");
      if (open) body.removeAttribute("hidden"); else body.setAttribute("hidden", "");
      toggle.setAttribute("aria-expanded", String(open));
    });
    let leaveTimer;
    panel.addEventListener("mouseenter", () => {
      clearTimeout(leaveTimer);
      body.removeAttribute("hidden");
      toggle.setAttribute("aria-expanded", "true");
    });
    panel.addEventListener("mouseleave", () => {
      leaveTimer = setTimeout(() => {
        body.setAttribute("hidden", "");
        toggle.setAttribute("aria-expanded", "false");
      }, 350);
    });

    // Font list
    const fontList = panel.querySelector(".pp-fonts");
    const search = panel.querySelector(".pp-search");

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "pp-font pp-font-reset";
    reset.textContent = "(default — no override)";
    reset.addEventListener("click", () => {
      applyFont(null);
      fontList.querySelectorAll(".pp-font").forEach(el => el.classList.remove("active"));
    });
    fontList.appendChild(reset);

    // Lazy-load each picker font only when the item scrolls into the panel's
    // visible area (or the user clicks it). Preloading all 40 at init was
    // contending with the page's own Epilogue/Poppins fetches and causing
    // the page's headings to fall back to the system sans-serif.
    const fontObserver = ("IntersectionObserver" in window)
      ? new IntersectionObserver((entries) => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              loadGoogleFont(e.target.dataset.font);
              fontObserver.unobserve(e.target);
            }
          });
        }, { root: fontList, rootMargin: "200px" })
      : null;

    FONTS.forEach(family => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pp-font";
      item.dataset.font = family;
      item.style.fontFamily = `"${family}", system-ui, sans-serif`;
      item.textContent = family;
      if (family === currentFont) item.classList.add("active");
      item.addEventListener("click", () => {
        loadGoogleFont(family);
        applyFont(family);
        fontList.querySelectorAll(".pp-font").forEach(el =>
          el.classList.toggle("active", el.dataset.font === family));
      });
      fontList.appendChild(item);
      if (fontObserver) fontObserver.observe(item);
    });

    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      fontList.querySelectorAll(".pp-font").forEach(el => {
        if (!el.dataset.font) return; // reset row
        el.style.display = el.dataset.font.toLowerCase().includes(q) ? "" : "none";
      });
    });

    // Background overrides — temporary visual aid for previewing how the
    // gallery looks against different backdrops. Persisted in localStorage
    // (key: preview-bg) and re-applied on every page load.
    const bgList = panel.querySelector(".pp-bgs");
    const BG_OPTIONS = [
      { id: "off",       label: "Off",        color: null },
      { id: "black",     label: "Black",      color: "#000" },
      { id: "darkgray",  label: "Dark gray",  color: "#3a3a3a" },
      { id: "lightgray", label: "Light gray", color: "#d9d9d9" },
    ];
    BG_OPTIONS.forEach(o => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pp-bg";
      item.dataset.bg = o.id;
      item.textContent = o.label;
      if (o.color) {
        item.style.background = o.color;
        item.style.color = (o.id === "lightgray") ? "#111" : "#fff";
      }
      if (o.id === currentBg) item.classList.add("active");
      item.addEventListener("click", () => {
        applyBg(o.id);
        bgList.querySelectorAll(".pp-bg").forEach(el =>
          el.classList.toggle("active", el.dataset.bg === o.id));
      });
      bgList.appendChild(item);
    });

    // Hover-label matrix: 4 checkboxes, persisted in localStorage.
    panel.querySelectorAll(".pp-hover-matrix input[type=checkbox]").forEach(cb => {
      const k = cb.dataset.hk;
      cb.checked = !!hoverPrefs[k];
      cb.addEventListener("change", () => {
        hoverPrefs[k] = cb.checked;
        saveHoverPrefs(hoverPrefs);
        applyHoverPrefs(hoverPrefs);
      });
    });

    // Image-titles section: download merged map, or clear local overrides.
    panel.querySelectorAll(".pp-imgtitles-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.act === "download") {
          downloadImageTitles();
        } else if (btn.dataset.act === "reset") {
          LOCAL_IMAGE_TITLES = {};
          saveLocalImageTitles(LOCAL_IMAGE_TITLES);
          // Tell the server too if it's listening.
          fetch("/preview/api/image-titles?clearLocal=1", { method: "DELETE" }).catch(() => {});
        }
      });
    });

    // Right-click any content image to rename it. Saves locally; POSTs to
    // /preview/api/image-titles (the local dev server's optional endpoint).
    window.addEventListener("contextmenu", (e) => {
      const img = e.target && e.target.closest && e.target.closest("img");
      if (!img) return;
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      const key = imageBasenameKey(img.currentSrc || img.src || "");
      if (!key) return;
      // Shift+right-click on a tile → material edit (per the link target,
      // not per image). Plain right-click → image title rename.
      const link = img.closest("a[href]");
      const linkHref = link?.getAttribute?.("href") || "";
      if (e.shiftKey && linkHref && /^\//.test(linkHref) && /\.html?$/i.test(linkHref)) {
        e.preventDefault();
        const cur = materialFor(linkHref);
        const m = window.prompt(`Material for ${linkHref}\n(empty = no label)`, cur);
        if (m === null) return;
        setMaterial(linkHref, m.trim());
        document.querySelectorAll(".preview-thumb-foot").forEach(foot => {
          const a = foot.parentElement?.querySelector("a[href]");
          if (a?.getAttribute("href") === linkHref) foot.textContent = m.trim();
        });
        applyDecorations(document);
        return;
      }
      e.preventDefault();
      const current = imageTitleFor(img);
      const next = window.prompt(`Title for ${key}\n(empty = no label)\nTip: shift+right-click to edit material instead.`, current);
      if (next === null) return;
      setImageTitle(key, next.trim());
      document.querySelectorAll("img").forEach(other => {
        if (imageBasenameKey(other.currentSrc || other.src || "") !== key) return;
        other.alt = next.trim();
      });
    });

    // Image order: download swap log JSON, or reset this page's order/log.
    panel.querySelectorAll(".pp-order-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "download") {
          downloadSwapLog();
        } else if (act === "reset") {
          localStorage.removeItem(pageOrderKey());
          clearSwapsForCurrentPage();
          location.reload();
        }
      });
    });

    // Lightbox style list
    const lbList = panel.querySelector(".pp-lightboxes");
    LIGHTBOX_STYLES.forEach(s => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pp-lightbox";
      item.dataset.style = s.id;
      item.textContent = s.label;
      if (s.id === currentLightbox) item.classList.add("active");
      item.addEventListener("click", () => {
        setLightboxStyle(s.id);
        lbList.querySelectorAll(".pp-lightbox").forEach(el =>
          el.classList.toggle("active", el.dataset.style === s.id));
        // No auto-open. The next image/anchor click opens in the new style.
      });
      lbList.appendChild(item);
    });
  }

  // On homepage, set scrollTop to the site header's height as soon as we
  // can measure it — so the page lands with the header just out of frame
  // and the content visible. Don't override if the user has already
  // scrolled themselves.
  function scrollPastHomeHeader() {
    if (!isHomePage()) return;
    // Only on first visit per session, not on every return to home.
    if (sessionStorage.getItem("preview-home-scrolled") === "1") return;
    const header =
      document.querySelector("header.site-header") ||
      document.querySelector("header#header") ||
      document.querySelector(".header-wrapper") ||
      document.querySelector("header");
    if (!header) return;
    const h = header.getBoundingClientRect().height;
    if (h <= 8) return;
    window.scrollTo({ top: h, left: 0, behavior: "instant" });
    sessionStorage.setItem("preview-home-scrolled", "1");
  }

  // Squarespace's runtime calls window.scrollTo(0, 0) / sets scrollTop=0 a
  // few times during initial page setup, which clobbers our manual offset.
  // For the home page's first visit only, intercept any zero-target scroll
  // calls and any scroll events that snap to 0 — for a short protection
  // window — and redirect them to our header-height offset. After ~2.5s the
  // native scroll behavior is restored.
  function armHomeScrollGuard() {
    if (!isHomePage()) return;
    if (sessionStorage.getItem("preview-home-scrolled") === "1") return;
    history.scrollRestoration = "manual";
    let desired = 0;
    function getDesired() {
      const header =
        document.querySelector("header.site-header") ||
        document.querySelector("header#header") ||
        document.querySelector(".header-wrapper") ||
        document.querySelector("header");
      const h = header ? header.getBoundingClientRect().height : 0;
      return h > 8 ? h : 0;
    }
    desired = getDesired();
    const realScrollTo = window.scrollTo.bind(window);
    const realScroll = window.scroll.bind(window);
    const PROTECT_MS = 2500;
    let active = true;
    function targetTop(args) {
      if (!args.length) return null;
      const a = args[0];
      if (typeof a === "number") return args[1] != null ? args[1] : 0;
      if (a && typeof a === "object") return a.top != null ? a.top : null;
      return null;
    }
    function intercept(real, args) {
      const t = targetTop(args);
      if (active && t !== null && t < 4) {
        // Squarespace tried to send us to the top — refresh desired in case
        // the header has just been measured, and redirect.
        desired = getDesired() || desired;
        if (desired) return real({ top: desired, left: 0, behavior: "instant" });
      }
      return real(...args);
    }
    window.scrollTo = function (...args) { return intercept(realScrollTo, args); };
    window.scroll = function (...args) { return intercept(realScroll, args); };
    function snapBack() {
      if (!active) return;
      if (window.scrollY < 4) {
        desired = getDesired() || desired;
        if (desired) realScrollTo({ top: desired, left: 0, behavior: "instant" });
      }
    }
    window.addEventListener("scroll", snapBack, { passive: true });
    setTimeout(() => {
      active = false;
      window.removeEventListener("scroll", snapBack);
      window.scrollTo = realScrollTo;
      window.scroll = realScroll;
    }, PROTECT_MS);
  }

  // Prepend a "Home" link as the leftmost nav item in the site header.
  // Idempotent: skip if our injected item is already present.
  function injectHomeNav() {
    const isHome = location.pathname === "/" || /\/index\.html$/.test(location.pathname);
    document.querySelectorAll(".header-nav-list").forEach(list => {
      if (list.querySelector(".preview-home-nav")) return;
      const wrap = document.createElement("div");
      wrap.className = "header-nav-item header-nav-item--collection preview-home-nav" +
        (isHome ? " header-nav-item--active" : "");
      const a = document.createElement("a");
      a.href = "/";
      a.setAttribute("data-animation-role", "header-element");
      if (isHome) a.setAttribute("aria-current", "page");
      a.textContent = "HOME";
      wrap.appendChild(a);
      list.insertBefore(wrap, list.firstChild);
    });
  }

  // ---------- Homepage → category navigation rewrite ----------
  // The homepage thumbs are reusable cover images; the actual gallery for
  // each piece lives on a portfolio-category page (ILLUMINATED, LEATHER,
  // HEADPIECES, JEWELRY) listed on /portfolio.html. Build an index that
  // maps every image's basename to the category page that contains it,
  // then rewrite each homepage thumb anchor to point at that category page
  // — so clicking a thumb navigates to the category and the existing
  // splash + scroll-into-view flow lands on the matching image.

  const CATEGORY_INDEX_KEY = CONFIG.categoryIndex.storageKey;
  const CATEGORY_INDEX_TTL = CONFIG.categoryIndex.ttlMs;

  // Returns { index, categories } where:
  //   index      = basename → { href }  (image basename → category page URL)
  //   categories = ordered [{ href, title }]  (in portfolio.html nav order)
  async function loadCategoryIndex() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CATEGORY_INDEX_KEY) || "null");
      if (cached && Date.now() - cached.ts < CATEGORY_INDEX_TTL) {
        return { index: cached.index, categories: cached.categories || [] };
      }
    } catch {}
    let categories = [];
    try {
      const html = await fetch("/portfolio.html", { credentials: "same-origin" }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      categories = Array.from(doc.querySelectorAll("a.portfolio-hover-item[href]"))
        .map(a => {
          const href = new URL(a.getAttribute("href"), location.origin).pathname;
          const title = (a.querySelector(".portfolio-hover-item-content")?.textContent
                      || a.textContent || "").trim();
          return { href, title };
        })
        .filter(c => c.href && c.href !== "/portfolio.html");
    } catch { return { index: {}, categories: [] }; }
    const index = {};
    await Promise.all(categories.map(async ({ href }) => {
      try {
        const html = await fetch(href, { credentials: "same-origin" }).then(r => r.text());
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("img").forEach(img => {
          const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
          const bn = imageBasename(src);
          if (!bn) return;
          if (!index[bn]) index[bn] = { href };
        });
      } catch {}
    }));
    try { sessionStorage.setItem(CATEGORY_INDEX_KEY, JSON.stringify({ ts: Date.now(), index, categories })); } catch {}
    return { index, categories };
  }

  // Look up the homepage thumb basename in the category index, including
  // a stem-contains fallback ("Horns_06" → matches "Horns_06.jpg" in the
  // index). Returns the category href or null.
  function lookupCategoryFor(basename, index) {
    if (!basename || !index) return null;
    if (index[basename]) return index[basename].href;
    const stem = basename.replace(/\.[a-z0-9]+$/, "");
    if (stem.length < 4) return null;
    for (const key in index) {
      if (key.includes(stem)) return index[key].href;
    }
    return null;
  }

  async function rewriteHomepageNav() {
    if (!isHomePage()) return;
    const { index } = await loadCategoryIndex();
    const anchors = document.querySelectorAll(".fluid-engine .fe-block a[href]");
    anchors.forEach(a => {
      if (a.dataset.previewRewritten) return;
      const img = a.querySelector("img");
      if (!img) return;
      const href = a.getAttribute("href") || "";
      // Skip non-internal links and links that already point to portfolio/*.
      if (!/^\//.test(href) || /^\/portfolio\//.test(href)) return;
      const bn = imageBasename(img.currentSrc || img.src || img.getAttribute("src") || "");
      if (!bn) return;
      const categoryHref = lookupCategoryFor(bn, index);
      if (!categoryHref) return;
      a.dataset.previewOriginalHref = href;
      a.dataset.previewFocusBasename = bn;
      a.setAttribute("href", categoryHref);
      a.dataset.previewRewritten = "1";
    });
  }

  // ---------- Category page header ----------
  // Each portfolio category page (ILLUMINATED, LEATHER, HEADPIECES, JEWELRY)
  // gets a banner injected at the top of its content with the category title
  // and prev/next links to wrap-around adjacent categories. Driven by the
  // same category list we build for the homepage-thumb rewrite.
  function isCategoryPage(categories) {
    return categories.some(c => c.href === location.pathname);
  }
  function injectCategoryHeader(categories) {
    if (!categories || !categories.length) return;
    if (!isCategoryPage(categories)) return;
    if (document.getElementById("preview-category-header")) return;
    const idx = categories.findIndex(c => c.href === location.pathname);
    if (idx < 0) return;
    const cur = categories[idx];
    const prev = categories[(idx - 1 + categories.length) % categories.length];
    const next = categories[(idx + 1) % categories.length];

    const bar = document.createElement("nav");
    bar.id = "preview-category-header";
    bar.className = "preview-category-header";
    bar.innerHTML = `
      <a class="preview-cat-prev" href="${prev.href}">
        <span class="preview-cat-arrow">‹</span>
        <span class="preview-cat-label">${prev.title}</span>
      </a>
      <button type="button" class="preview-cat-current">${cur.title}</button>
      <a class="preview-cat-next" href="${next.href}">
        <span class="preview-cat-label">${next.title}</span>
        <span class="preview-cat-arrow">›</span>
      </a>
    `;
    bar.querySelector(".preview-cat-current").addEventListener("click", () => {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
    document.body.appendChild(bar);
    document.body.classList.add("preview-has-category-header", "preview-category-page");
    syncCategoryHeaderOffset();
  }
  function syncCategoryHeaderOffset() {
    const bar = document.getElementById("preview-category-header");
    if (!bar) return;
    const header = document.querySelector("header.site-header") ||
                   document.querySelector("header#header") ||
                   document.querySelector(".header-wrapper") ||
                   document.querySelector("header");
    const siteH = header ? header.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty("--pl-site-header-h", siteH + "px");
    document.documentElement.style.setProperty("--pl-cat-header-h",
      bar.getBoundingClientRect().height + "px");
    // Squarespace's site header is position: absolute on category pages, so
    // it scrolls away with the page. Drive the bar's `top` so it sits just
    // below the site header at scrollY=0 and rises to top:0 as the user
    // scrolls past the site header.
    const top = Math.max(0, siteH - window.scrollY);
    bar.style.top = top + "px";
  }
  // Detail-page image index. Same shape as the category index but mapping
  // an image basename → the detail page (one of the keys of
  // HOMEPAGE_MATERIALS) that displays it. Used on category pages so each
  // thumb knows which detail page to navigate to on click.
  const DETAIL_INDEX_KEY = "preview-detail-index-v1";
  async function loadDetailIndex() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(DETAIL_INDEX_KEY) || "null");
      if (cached && Date.now() - cached.ts < CATEGORY_INDEX_TTL) return cached.index;
    } catch {}
    const detailHrefs = Object.keys(HOMEPAGE_MATERIALS);
    const index = {};
    await Promise.all(detailHrefs.map(async href => {
      try {
        const html = await fetch(href, { credentials: "same-origin" }).then(r => r.text());
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("img").forEach(img => {
          const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
          const bn = imageBasename(src);
          if (!bn) return;
          if (!index[bn]) index[bn] = href;
        });
      } catch {}
    }));
    try { sessionStorage.setItem(DETAIL_INDEX_KEY, JSON.stringify({ ts: Date.now(), index })); } catch {}
    return index;
  }
  function lookupDetailFor(basename, index) {
    if (!basename || !index) return null;
    if (index[basename]) return index[basename];
    const stem = basename.replace(/\.[a-z0-9]+$/, "");
    if (stem.length < 4) return null;
    for (const key in index) if (key.includes(stem)) return index[key];
    return null;
  }

  async function enableCategoryHover() {
    const { categories } = await loadCategoryIndex();
    if (!categories.length) return;
    if (!categories.some(c => c.href === location.pathname)) return;
    const detailIndex = await loadDetailIndex();
    const blocks = Array.from(document.querySelectorAll(
      ".gallery-masonry-item, .sqs-gallery-design-grid-slide, .fluid-engine .fe-block"
    ));
    blocks.forEach(block => {
      if (block.querySelector(".preview-thumb-head")) return; // idempotent
      const img = block.querySelector("img");
      if (!img) return;
      const bn = imageBasename(img.currentSrc || img.src || img.getAttribute("src") || "");
      const detailHref = lookupDetailFor(bn, detailIndex);
      if (!detailHref) return;
      block.dataset.previewDetailHref = detailHref;
      block.classList.add("preview-thumb-block", "preview-cat-thumb");
      // Head = title link → detail page.
      const head = document.createElement("a");
      head.className = "preview-thumb-head";
      head.href = detailHref;
      head.textContent = titleFromHref(detailHref);
      // Foot = 2-segment nav (no category back-link — we're already on the
      // category): zoom · PROJECT >
      const foot = document.createElement("div");
      foot.className = "preview-thumb-foot preview-thumb-nav preview-thumb-nav--cat";
      foot.innerHTML =
        '<a class="ptn-seg ptn-proj" href="' + detailHref + '"><span class="ptn-label">Project</span><span class="ptn-arrow">›</span></a>';
      block.appendChild(head);
      block.appendChild(foot);
      fetchPageMeta(detailHref).then(meta => { if (meta.title) head.textContent = meta.title; });
      block.addEventListener("mouseenter", () => block.classList.add("preview-thumb-active"));
      block.addEventListener("mouseleave", () => block.classList.remove("preview-thumb-active"));
      // Image clicks → lightbox (handled by enableLightboxClicks). Segment
      // clicks navigate via their own anchor. Stash a splash-arrival hint so
      // the detail page transitions in nicely.
      foot.querySelector(".ptn-proj").addEventListener("click", () => {
        try {
          sessionStorage.setItem("preview-splash-arrival", JSON.stringify({
            src: (img.currentSrc || img.src || "").replace(/\?format=\d+w$/, "?format=2500w"),
            href: detailHref,
            noCenter: true,
          }));
        } catch {}
      });
      head.addEventListener("click", () => {
        try {
          sessionStorage.setItem("preview-splash-arrival", JSON.stringify({
            src: (img.currentSrc || img.src || "").replace(/\?format=\d+w$/, "?format=2500w"),
            href: detailHref,
            noCenter: true,
          }));
        } catch {}
      });
    });
  }

  // On a detail page (a piece's own page — not the homepage, not portfolio,
  // not one of the category pages), inject a `< [category]` link at the
  // bottom of the page so visitors can step back up. We figure out which
  // category by taking any image on this page and looking it up in the
  // category-index built from /portfolio.html.
  async function injectDetailFooterBackLink() {
    if (isHomePage()) return;
    if (location.pathname === "/portfolio.html") return;
    if (document.getElementById("preview-detail-back")) return;
    const { index, categories } = await loadCategoryIndex();
    if (!categories.length) return;
    if (categories.some(c => c.href === location.pathname)) return; // is a category
    // Find the first image whose basename is in the category index.
    let cat = null;
    const imgs = Array.from(document.querySelectorAll("img"))
      .filter(i => !i.closest("#preview-panel") && !i.closest("#preview-lightbox"));
    for (const img of imgs) {
      const bn = imageBasename(img.currentSrc || img.src || img.getAttribute("src") || img.getAttribute("data-src") || "");
      const hit = bn ? lookupCategoryFor(bn, index) : null;
      if (hit) {
        cat = categories.find(c => c.href === hit) || { href: hit, title: hit.replace(/^\//, "").replace(/\.html?$/, "") };
        break;
      }
    }
    if (!cat) return;
    const nav = document.createElement("nav");
    nav.id = "preview-detail-back";
    nav.className = "preview-detail-back";
    const a = document.createElement("a");
    a.href = cat.href;
    a.innerHTML = `<span class="preview-detail-back-arrow">‹</span><span class="preview-detail-back-label">${cat.title}</span>`;
    nav.appendChild(a);
    document.body.appendChild(nav);
  }

  // ---------- Projects index page ----------
  // Renders the editorial typographic list at /projects.html — title-first,
  // muted material aside, cursor-tracked preview thumbnail. Pulls cover
  // images by fetching /index.html (the homepage) once and matching anchors
  // by detail-page href, so we get the exact CDN URL Squarespace serves.
  async function fetchHomepageCovers() {
    try {
      const html = await fetch("/index.html", { credentials: "same-origin" }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      const map = {};
      doc.querySelectorAll("a[href$='.html']").forEach(a => {
        const img = a.querySelector("img");
        if (!img) return;
        const href = new URL(a.getAttribute("href"), location.origin).pathname;
        const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
        if (!map[href] && src) map[href] = src;
      });
      return map;
    } catch { return {}; }
  }
  function buildProjectsList(homepageCovers) {
    const detail = CONFIG.imageDetailPages || {};
    const titles = CONFIG.pageTitles || {};
    const mats = CONFIG.homepageMaterials || {};
    const seenHref = new Set();
    const list = [];
    // First detail-page basename wins per page (so the first piece's photo
    // becomes the preview thumb for the whole project).
    for (const [base, href] of Object.entries(detail)) {
      if (seenHref.has(href)) continue;
      seenHref.add(href);
      list.push({
        href,
        title: titles[href] || href.replace(/^\//, "").replace(/\.html?$/, ""),
        material: mats[href] || "",
        thumb: homepageCovers[href] || "",
        basename: base,
      });
    }
    list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  }
  async function renderProjectsPage() {
    if (location.pathname !== "/projects.html") return;
    const ol = document.getElementById("preview-projects-list-ol");
    if (!ol) return;
    const covers = await fetchHomepageCovers();
    const projects = buildProjectsList(covers);
    ol.innerHTML = "";
    projects.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "preview-projects-item";
      const a = document.createElement("a");
      a.href = p.href;
      a.className = "preview-projects-link";
      const thumbSrc = p.thumb || "";
      a.innerHTML =
        (thumbSrc
          ? '<img class="ppi-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" loading="lazy" decoding="async">'
          : '<span class="ppi-thumb ppi-thumb-empty"></span>') +
        '<span class="ppi-num">' + String(i + 1).padStart(2, "0") + '</span>' +
        '<span class="ppi-name">' + escapeHtml(p.title) + '</span>' +
        '<span class="ppi-sub"></span>' +
        '<span class="ppi-meta">' + escapeHtml(p.material || "") + '</span>';
      li.appendChild(a);
      ol.appendChild(li);
      // Pull the detail page's first paragraph as a subheader (async).
      fetchPageMeta(p.href).then(meta => {
        const sub = a.querySelector(".ppi-sub");
        if (sub && meta && meta.desc) sub.textContent = meta.desc;
      });
    });
  }

  // Inject "PROJECTS" alongside the existing nav. Squarespace renders the
  // header twice (desktop + mobile), so loop every header-nav-list and
  // insert exactly once.
  function injectProjectsNav() {
    const here = location.pathname;
    const onProjects = here === "/projects.html";
    // Detail pages = anything reachable via imageDetailPages (Elf, Wedding, …).
    const detailPaths = new Set(Object.values((CONFIG.imageDetailPages) || {}));
    const onDetail = detailPaths.has(here);
    const projActive = onProjects || onDetail;
    document.querySelectorAll(".header-nav-list, .header-menu-nav-folder-content").forEach(list => {
      // Squarespace's static HTML marks one nav item with --active. On a
      // detail page or /projects.html the static markup still says PORTFOLIO
      // is active (it's the chrome we cloned). Strip that so PROJECTS owns it.
      if (projActive) {
        list.querySelectorAll(".header-nav-item--active, .header-menu-nav-item--active").forEach(el => {
          el.classList.remove("header-nav-item--active", "header-menu-nav-item--active");
          const a = el.querySelector("a[aria-current]");
          if (a) a.removeAttribute("aria-current");
        });
      }
      if (list.querySelector(".preview-projects-nav")) return;
      const isMenu = list.classList.contains("header-menu-nav-folder-content");
      const wrap = document.createElement("div");
      wrap.className = (isMenu ? "container header-menu-nav-item header-menu-nav-item--collection" : "header-nav-item header-nav-item--collection") +
        " preview-projects-nav" + (projActive ? (isMenu ? " header-menu-nav-item--active" : " header-nav-item--active") : "");
      const inner = document.createElement(isMenu ? "div" : "span");
      if (isMenu) inner.className = "header-menu-nav-item-content";
      const a = document.createElement("a");
      a.href = "/projects.html";
      a.setAttribute("data-animation-role", "header-element");
      a.textContent = "PROJECTS";
      if (projActive) a.setAttribute("aria-current", "page");
      inner.appendChild(a);
      wrap.appendChild(inner);
      // Insert after the existing PORTFOLIO link if we can find it.
      const portfolio = Array.from(list.children).find(c =>
        c.querySelector && c.querySelector('a[href*="portfolio"]')
      );
      if (portfolio && portfolio.nextSibling) list.insertBefore(wrap, portfolio.nextSibling);
      else if (portfolio) list.appendChild(wrap);
      else list.appendChild(wrap);
    });
  }

  async function setupCategoryHeader() {
    // Use cached categories if present so the header appears synchronously
    // on subsequent visits; the fetch path on cold cache populates it shortly.
    try {
      const cached = JSON.parse(sessionStorage.getItem(CATEGORY_INDEX_KEY) || "null");
      if (cached && cached.categories) injectCategoryHeader(cached.categories);
    } catch {}
    const { categories } = await loadCategoryIndex();
    injectCategoryHeader(categories);
  }

  // Scale the homepage hero grid so the vertical span from the top of
  // "MIKAELA HOLMES" to the bottom of the "Fashion Artist" tagline equals
  // exactly 100vh. Implemented as a CSS transform on the fluid-engine grid
  // (transform-origin: top center). The grid's parent is given an explicit
  // height equal to the post-scale rendered height so the rest of the page
  // flows correctly. Re-runs on resize and after any image inside the grid
  // loads (those late loads can shift the tagline's position).
  let heroFitScheduled = false;
  function findHomeHeroAnchors() {
    const title = Array.from(document.querySelectorAll("span.sqsrte-scaled-text, h1, h2"))
      .find(e => (e.textContent || "").trim() === "MIKAELA HOLMES");
    const tagline = Array.from(document.querySelectorAll("h2,h3,p,span"))
      .find(e => (e.textContent || "").trim().toLowerCase().endsWith("fashion artist"));
    if (!title || !tagline) return null;
    const grid = title.closest(".fluid-engine");
    if (!grid || !grid.contains(tagline)) return null;
    return { title, tagline, grid };
  }
  function fitHomeHero() {
    if (!isHomePage()) return;
    const found = findHomeHeroAnchors();
    if (!found) return;
    const { title, tagline, grid } = found;
    // Reset prior transform/height so we measure the natural layout.
    grid.style.transform = "";
    grid.style.transformOrigin = "";
    grid.style.width = "";
    grid.style.height = "";
    grid.style.marginBottom = "";
    if (grid.parentElement) grid.parentElement.style.height = "";

    // Use a rAF so the reset takes effect before re-measuring.
    requestAnimationFrame(() => {
      const tr = title.getBoundingClientRect();
      const gr = tagline.getBoundingClientRect();
      const titleTop = tr.top + window.scrollY;
      const tagBottom = gr.bottom + window.scrollY;
      const span = tagBottom - titleTop;
      if (span < 100) return;
      // Only ever shrink — never enlarge. On mobile/portrait viewports the
      // natural span is often shorter than vh after the responsive layout
      // stacks vertically, so enlarging would just clip / cause oscillation.
      const rawScale = window.innerHeight / span;
      const scale = Math.min(1, rawScale);
      if (Math.abs(1 - scale) < 0.01) {
        // Nothing to do — clear any prior transform and bail.
        return;
      }
      const naturalHeight = grid.getBoundingClientRect().height;
      grid.style.transformOrigin = "top center";
      grid.style.transform = `scale(${scale})`;
      // Compensate so the post-scale grid still spans the parent's full
      // width (transform doesn't change layout box but width=100/scale% on
      // the original makes the rendered width equal 100% of the parent).
      grid.style.width = (100 / scale) + "%";
      grid.style.marginLeft = "auto";
      grid.style.marginRight = "auto";
      // Force the surrounding layout box to the scaled height so the
      // page flows correctly below it.
      const scaledHeight = naturalHeight * scale;
      grid.style.marginBottom = (scaledHeight - naturalHeight) + "px";
    });
  }
  function scheduleFitHomeHero() {
    if (heroFitScheduled) return;
    heroFitScheduled = true;
    requestAnimationFrame(() => { heroFitScheduled = false; fitHomeHero(); });
  }
  function armHomeHeroFit() {
    if (!isHomePage()) return;
    const found = findHomeHeroAnchors();
    if (!found) return;
    const { grid } = found;
    // Pre-blank the hero so the user doesn't see the layout pop while we
    // measure and apply the scale transform. Fade in once we're settled.
    grid.style.transition = "opacity 240ms ease";
    grid.style.opacity = "0";
    let revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      grid.style.opacity = "";
    }
    fitHomeHero();
    // Settle, then reveal. A second pass at ~250ms catches the most common
    // late-image layout shift; a hard timeout at 1500ms guarantees the
    // hero never stays invisible.
    setTimeout(() => { fitHomeHero(); reveal(); }, 260);
    setTimeout(reveal, 1500);
    setTimeout(scheduleFitHomeHero, 800);
    setTimeout(scheduleFitHomeHero, 1800);
    window.addEventListener("load", scheduleFitHomeHero);
    window.addEventListener("resize", scheduleFitHomeHero);
    grid.querySelectorAll("img").forEach(img => {
      if (!img.complete) img.addEventListener("load", scheduleFitHomeHero, { once: true });
    });
  }

  function init() {
    buildPanel();
    if (currentBg && currentBg !== "off") applyBg(currentBg);
    armHomeScrollGuard();
    armHomeHeroFit();
    enableDragReorder();
    enableLightboxClicks();
    applyStoredOrder();
    highlightReorderedImages();
    enableHomepageHover();
    injectHomeNav();
    injectProjectsNav();
    captureNavSplash();
    rewriteHomepageNav();
    setupCategoryHeader();
    enableCategoryHover();
    injectDetailFooterBackLink();
    renderProjectsPage();
    window.addEventListener("resize", syncCategoryHeaderOffset);
    window.addEventListener("scroll", syncCategoryHeaderOffset, { passive: true });
    ensurePortfolioHeroPinned();
    armDecorationObserver();
    requestAnimationFrame(runSplash);
    // Apply the homepage header offset as early as possible, then re-apply
    // once layout has fully settled (fonts, images) in case the header's
    // height changed after the first measurement.
    scrollPastHomeHeader();
    requestAnimationFrame(scrollPastHomeHeader);
    window.addEventListener("load", () => requestAnimationFrame(scrollPastHomeHeader), { once: true });
    // Squarespace re-renders the header after our init; re-inject if needed.
    setTimeout(() => { injectHomeNav(); injectProjectsNav(); }, 800);
    setTimeout(() => { injectHomeNav(); injectProjectsNav(); }, 2500);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
