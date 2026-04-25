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

  // ---------- Fonts ----------
  // ----- Per-thumbnail metadata for the homepage labels --------------------
  // Edit these to set the "material" caption shown below each homepage tile
  // on hover. The keys are the anchor href (root-absolute pathnames).
  const HOMEPAGE_MATERIALS = {
    "/red-flower-hp.html":     "silk, wire",
    "/wedding.html":           "lace, silk",
    "/white-cyber-hp.html":    "ILLUMINATED, leather",
    "/green-loopy-hp.html":    "wirework",
    "/elf.html":               "mixed media",
    "/flora-faun.html":        "mixed media",
    "/snake-light-hp.html":    "ILLUMINATED",
    "/hip-shoulder-slit.html": "fabric",
    "/l-wire-full.html":       "wirework",
    "/spaceship-purse.html":   "leather",
    "/purple-spike-hp.html":   "structured fabric",
    "/sketches.html":          "graphite",
  };

  const FONTS = [
    "Inter", "DM Sans", "Space Grotesk", "Work Sans", "Poppins", "Montserrat",
    "Outfit", "Manrope", "Nunito", "Karla", "Public Sans", "Plus Jakarta Sans",
    "Archivo", "Raleway", "Quicksand", "Josefin Sans",
    "Playfair Display", "Cormorant Garamond", "Bodoni Moda",
    "Libre Baskerville", "EB Garamond", "Fraunces", "Lora", "Merriweather",
    "Crimson Pro", "Libre Caslon Text",
    "Lobster", "Pacifico", "Great Vibes", "Dancing Script", "Italiana", "Cinzel",
    "Caveat", "Sacramento", "Abril Fatface", "Parisienne", "Allura",
    "JetBrains Mono", "Fira Code"
  ];

  const params = new URLSearchParams(location.search);
  let currentFont = (params.get("font") || "").replace(/\+/g, " ").trim() || null;
  let currentLightbox = (params.get("lightbox") || localStorage.getItem("preview-lightbox") || "squarespace").trim();

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

  // ---------- Image reorder (Ctrl + drag and drop) ----------
  // Holding Ctrl and dragging from one image and dropping on another swaps
  // their containing blocks in the DOM. Order is persisted per page in
  // localStorage by the original-DOM index of each block, so reloading the
  // page restores the user's chosen order.
  const ORDER_KEY = "preview-image-order";
  function imgKey(img) {
    const s = img.currentSrc || img.src || img.getAttribute("data-src") || "";
    return s.split("?")[0];
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
    try { return JSON.parse(localStorage.getItem(pageOrderKey()) || "null"); } catch { return null; }
  }
  function saveOrder(arr) { localStorage.setItem(pageOrderKey(), JSON.stringify(arr)); }

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

  // Generic, adjacent-safe DOM swap using a comment placeholder.
  function swapNodes(a, b) {
    if (!a || !b || a === b) return;
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
    const ACTIVATE_PX = 6;
    let drag = null;
    let ghost = null;

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
      if (!img) return;
      if (img.closest("#preview-panel") || img.closest("#preview-lightbox")) return;
      const block = blockOf(img);
      if (!block) return;
      drag = { img, block, sx: e.clientX, sy: e.clientY, active: false, target: null };
    }

    function move(e) {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < ACTIVATE_PX) return;
        drag.active = true;
        activate();
      }
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      const under = document.elementFromPoint(e.clientX, e.clientY);
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

    function end() {
      if (!drag) return;
      if (!drag.active) { drag = null; return; }
      const { block, target } = drag;
      block.classList.remove("preview-reorder-source");
      if (target) target.classList.remove("preview-reorder-target");
      document.body.classList.remove("preview-reorder-active");
      if (ghost) { ghost.remove(); ghost = null; }
      if (target) {
        swapNodes(block, target);
        persistCurrentOrder();
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
        const href = a.getAttribute("href");
        const head = document.createElement("div");
        head.className = "preview-thumb-head";
        head.textContent = titleFromHref(href);
        const foot = document.createElement("div");
        foot.className = "preview-thumb-foot";
        foot.textContent = HOMEPAGE_MATERIALS[href] || "";
        b.appendChild(head);
        b.appendChild(foot);
        b.classList.add("preview-thumb-block");
        fetchPageMeta(href).then(meta => {
          if (meta.title) head.textContent = meta.title;
        });
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
          const head = measure(o.b, "preview-thumb-head");
          const foot = measure(o.b, "preview-thumb-foot");
          const peers = colSiblings(o);
          peers.forEach(p => {
            const shift = (p.b === o.b) ? head : head + foot;
            p.b.style.setProperty("--preview-shift", shift + "px");
            p.b.classList.add("preview-thumb-shift");
          });
          o.b.classList.add("preview-thumb-active");
        });
        o.b.addEventListener("mouseleave", () => {
          blocks.forEach(p => {
            p.b.classList.remove("preview-thumb-shift");
            p.b.classList.remove("preview-thumb-active");
          });
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
  function moveHeroToTop(hero) {
    if (!hero) return;
    const block = hero.closest(".fe-block, .sqs-block, figure") || hero.parentElement;
    if (!block || !block.parentElement) return;
    block.style.cssText +=
      ";grid-area:auto" +
      ";grid-column-start:auto;grid-column-end:auto" +
      ";grid-row-start:auto;grid-row-end:auto" +
      ";position:relative" +
      ";top:0;left:0" +
      ";width:100vw;height:100vh" +
      ";max-width:none;max-height:none" +
      ";margin:0;padding:0" +
      ";overflow:hidden;z-index:1";
    // Force every fluid-image wrapper inside to fill the new banner.
    block.querySelectorAll(
      ".fluid-image-component-root, .fluid-image-animation-wrapper, .fluid-image-container, .sqs-block-content, .sqs-block, a"
    ).forEach(el => {
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.maxHeight = "none";
      el.style.maxWidth = "none";
    });
    if (hero) {
      hero.style.width = "100%";
      hero.style.height = "100%";
      hero.style.objectFit = "cover";
      hero.style.maxWidth = "none";
      hero.style.maxHeight = "none";
    }
    document.body.insertBefore(block, document.body.firstChild);
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

  // Generic splash: show `srcUrl` fullscreen with object-fit:cover, hold
  // until first-screen images on this page have finished loading (with min
  // and max bounds), then translate/shrink to the bbox of `targetImg` while
  // the backdrop fades to the page background.
  function playSplash(srcUrl, targetImg) {
    if (!srcUrl) return;
    const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
    const TRANSITION_MS = 1300;
    const MIN_HOLD_MS = 800;
    const MAX_HOLD_MS = 8000;

    const overlay = document.createElement("div");
    overlay.className = "preview-splash-overlay";
    overlay.style.backgroundColor = bg;

    const splashImg = document.createElement("img");
    splashImg.src = srcUrl;
    splashImg.alt = "";
    Object.assign(splashImg.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      objectFit: "cover",
      display: "block",
      transition:
        "top " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "left " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "width " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "height " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)," +
        "opacity " + TRANSITION_MS + "ms cubic-bezier(.4,0,.2,1)",
    });
    overlay.appendChild(splashImg);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (targetImg) targetImg.style.visibility = "hidden";
    document.body.appendChild(overlay);

    function startFade() {
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
        if (targetImg) targetImg.style.visibility = "";
        document.body.style.overflow = prevOverflow;
      }, TRANSITION_MS + 100);
    }

    // Hold at least MIN_HOLD_MS, but don't fade until first-screen images
    // are loaded (capped at MAX_HOLD_MS so we never deadlock).
    const start = performance.now();
    waitForFirstScreenImages(MAX_HOLD_MS).then(() => {
      const elapsed = performance.now() - start;
      const wait = Math.max(0, MIN_HOLD_MS - elapsed);
      setTimeout(startFade, wait);
    });
  }

  // Find an image on the current page that matches a given source URL.
  // Used to "land" an arrival splash on the right tile of the destination.
  function findImageBySrc(srcUrl) {
    if (!srcUrl) return null;
    const fname = (srcUrl.split("?")[0].split("/").pop() || "").toLowerCase();
    if (!fname) return null;
    const candidates = Array.from(document.querySelectorAll("img"))
      .filter(img => !img.closest("#preview-panel") && !img.closest("#preview-lightbox"));
    // Exact filename match first
    let hit = candidates.find(img => {
      const s = (img.currentSrc || img.src || "").toLowerCase();
      return s.split("?")[0].endsWith("/" + fname);
    });
    if (hit) return hit;
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
        alt: img.alt || "",
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
      <div class="lb-counter"></div>
    `;
    const stageImg = root.querySelector(".lb-stage img");
    const counter = root.querySelector(".lb-counter");
    function render() {
      stageImg.src = images[i].src;
      stageImg.alt = images[i].alt;
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
    root.innerHTML = `<img alt="">`;
    const img = root.querySelector("img");
    function render() { img.src = images[i].src; img.alt = images[i].alt; setPageLink(root, images[i]); }
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
      title.textContent = images[i].alt || "Untitled";
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
      <div class="lb-dots"></div>
    `;
    const track = root.querySelector(".lb-track");
    const dots = root.querySelector(".lb-dots");
    images.forEach((im, idx) => {
      const slide = document.createElement("div");
      slide.className = "lb-slide";
      slide.innerHTML = `<img alt="${(im.alt || "").replace(/"/g, "&quot;")}" src="${im.src}">`;
      track.appendChild(slide);
      const dot = document.createElement("button");
      dot.className = "lb-dot";
      dot.addEventListener("click", () => { i = idx; render(); });
      dots.appendChild(dot);
    });
    function render() {
      track.style.transform = `translateX(-${i * 100}%)`;
      dots.querySelectorAll(".lb-dot").forEach((d, idx) => d.classList.toggle("active", idx === i));
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
    try {
      const u = new URL(href, location.href);
      const last = (u.pathname.split("/").filter(Boolean).pop() || "")
        .replace(/\.html?$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      return last
        .split(/\s+/)
        .map(w => w ? w[0].toUpperCase() + w.slice(1) : w)
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
        let title = (doc.querySelector('meta[property="og:title"]')?.content
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
    const ADVANCE_MS = 5500;

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

      // On the homepage, let anchor-wrapped thumbnails navigate normally.
      // The page-preview modal is no longer triggered from home.
      if (isHomePage() && img.closest("a[href]")) return;

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

  function init() {
    buildPanel();
    enableDragReorder();
    enableLightboxClicks();
    applyStoredOrder();
    enableHomepageHover();
    captureNavSplash();
    requestAnimationFrame(runSplash);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
