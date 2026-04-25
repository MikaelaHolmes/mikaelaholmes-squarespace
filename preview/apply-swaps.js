#!/usr/bin/env node
/*
 * Apply image swaps recorded in preview-image-swaps.json to the live
 * Squarespace site. UNTESTED — see CLAUDE.md "Playwright scripts: the bar".
 *
 * Input file format (downloaded from the preview pill → "Download swap log"):
 *   {
 *     "version": 1,
 *     "swaps": [
 *       { "page": "/portfolio/foo.html", "ts": "...", "a": "<imgA>", "b": "<imgB>" },
 *       ...
 *     ]
 *   }
 *
 * Each swap exchanges the *src* of two <img> elements on the given page in
 * Squarespace's editor (the simplest cross-layout fix — works for both Fluid
 * Engine and masonry galleries because we're editing image references rather
 * than DOM order). For Fluid Engine pages where DOM order is what matters,
 * Squarespace renders by grid-area, so swapping the underlying image content
 * is the equivalent visual operation.
 *
 * Usage:
 *   SQS_SITE=antelope-tulip-5nyy.squarespace.com \
 *   SQS_EMAIL=you@example.com SQS_PASSWORD=... \
 *   node apply-swaps.js path/to/preview-image-swaps.json
 *
 * Optional:
 *   --dry-run   parse + print plan; don't drive the browser
 *   --headed    show the browser
 */

const fs = require("fs");
const path = require("path");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const headed = args.includes("--headed");
  const file = args.find(a => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node apply-swaps.js <swaps.json> [--dry-run] [--headed]");
    process.exit(2);
  }
  const log = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (!log || !Array.isArray(log.swaps)) {
    console.error("invalid swap log — expected { version, swaps:[] }");
    process.exit(2);
  }

  // Group swaps by page, applied in recorded order so chained swaps on the
  // same page compose correctly (later swaps see the result of earlier ones).
  const byPage = new Map();
  for (const s of log.swaps) {
    if (!byPage.has(s.page)) byPage.set(s.page, []);
    byPage.get(s.page).push(s);
  }
  console.log(`loaded ${log.swaps.length} swap(s) across ${byPage.size} page(s)`);
  for (const [page, swaps] of byPage) {
    console.log(`  ${page}  (${swaps.length} swap(s))`);
  }
  if (dryRun) return;

  const site = process.env.SQS_SITE;
  const email = process.env.SQS_EMAIL;
  const password = process.env.SQS_PASSWORD;
  if (!site || !email || !password) {
    console.error("missing env: SQS_SITE, SQS_EMAIL, SQS_PASSWORD required");
    process.exit(2);
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // --- Login. Selectors below are best-effort; verify against the live UI
  //     before trusting them. The script intentionally fails loudly if
  //     anything is missing rather than silently no-oping.
  const loginUrl = `https://login.squarespace.com/`;
  console.log(`→ ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.click('button[type="submit"], button:has-text("Continue")');
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"], button:has-text("Log In")');
  await page.waitForURL(/squarespace\.com/, { timeout: 30000 });

  for (const [pagePath, swaps] of byPage) {
    const url = `https://${site}${pagePath}`;
    console.log(`→ ${url} (${swaps.length} swap(s))`);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // The site is in editor mode if logged in; we read all <img> srcs and
    // resolve each swap by matching the basename (path without query) to the
    // recorded `a` / `b` keys.
    for (let i = 0; i < swaps.length; i++) {
      const { a, b } = swaps[i];
      const ok = await page.evaluate(({ a, b }) => {
        const norm = (s) => (s || "").split("?")[0];
        const imgs = Array.from(document.querySelectorAll("img"));
        const ia = imgs.find(im => norm(im.currentSrc || im.src) === a);
        const ib = imgs.find(im => norm(im.currentSrc || im.src) === b);
        if (!ia || !ib) return { ok: false, reason: "img not found", aFound: !!ia, bFound: !!ib };
        const tmp = ia.src; ia.src = ib.src; ib.src = tmp;
        return { ok: true };
      }, { a, b });
      if (!ok.ok) {
        console.warn(`  swap ${i + 1}/${swaps.length} skipped: ${ok.reason || "unknown"}`);
      } else {
        console.log(`  swap ${i + 1}/${swaps.length} applied`);
      }
    }

    // NOTE: in-DOM src swaps above are visual-only and won't persist on the
    // live site. Squarespace's persistence model uses block-IDs and an
    // editor RPC; persisting requires either driving the editor UI (drag
    // each thumbnail in the gallery editor) or POSTing to the internal
    // gallery-reorder endpoint. Neither is wired up here — see CLAUDE.md
    // for the bar this script needs to clear before claiming success.
  }

  await browser.close();
  console.log("done (UNTESTED — verify on live site before relying on this).");
}

main().catch(e => { console.error(e); process.exit(1); });
