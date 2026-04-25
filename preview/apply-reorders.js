#!/usr/bin/env node
/*
 * Apply image reorders from preview/config.json's `imageOrders` map to the
 * live Squarespace site. UNTESTED — see CLAUDE.md "Playwright scripts: the
 * bar". Selectors below are best-effort; verify against the real admin
 * before relying on this.
 *
 * Reads `imageOrders[<page-path>] = [imgKey, imgKey, ...]` from config.json
 * (where `imgKey` is the query-stripped image src, matching `imgKey()` in
 * preview.js). For each page, opens the page in the Squarespace editor and
 * drags each gallery item into the saved position.
 *
 * Usage:
 *   # CDP-attach to a running Chrome (recommended — uses the user's session):
 *   SQS_CDP=http://127.0.0.1:9223 node apply-reorders.js [--dry-run]
 *
 *   # Or fall back to launching a fresh browser with env-var login:
 *   SQS_SITE=antelope-tulip-5nyy.squarespace.com \
 *   SQS_EMAIL=... SQS_PASSWORD=... \
 *   node apply-reorders.js [--headed] [--headless] [--dry-run]
 */

const fs = require("fs");
const path = require("path");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let headed = !args.includes("--headless");
  if (args.includes("--headed")) headed = true;

  const cfgPath = path.resolve(__dirname, "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const orders = cfg.imageOrders || {};
  const pages = Object.keys(orders).filter(p => Array.isArray(orders[p]) && orders[p].length > 1);

  console.log(`apply-reorders: ${pages.length} page(s) with saved order`);
  for (const p of pages) console.log(`  ${p}  (${orders[p].length} items)`);
  if (dryRun || !pages.length) return;

  const cdp = process.env.SQS_CDP;
  const { chromium } = require("playwright");
  let browser, ctx, page;
  if (cdp) {
    console.log(`→ connecting CDP @ ${cdp}`);
    browser = await chromium.connectOverCDP(cdp);
    ctx = browser.contexts()[0] || (await browser.newContext());
    page = ctx.pages()[0] || (await ctx.newPage());
  } else {
    const site = process.env.SQS_SITE;
    const email = process.env.SQS_EMAIL;
    const password = process.env.SQS_PASSWORD;
    if (!site || !email || !password) {
      console.error("missing env: SQS_SITE+SQS_EMAIL+SQS_PASSWORD (or set SQS_CDP)");
      process.exit(2);
    }
    browser = await chromium.launch({ headless: !headed });
    ctx = await browser.newContext();
    page = await ctx.newPage();
    console.log("→ login.squarespace.com");
    await page.goto("https://login.squarespace.com/", { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"], input[type="email"]', email);
    await page.click('button[type="submit"], button:has-text("Continue")');
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('button[type="submit"], button:has-text("Log In")');
    await page.waitForURL(/squarespace\.com/, { timeout: 30000 });
  }

  const site = process.env.SQS_SITE || "antelope-tulip-5nyy.squarespace.com";
  function basenameOf(key) {
    return (key || "").split("?")[0].split("#")[0].split("/").pop() || "";
  }

  let total = 0, applied = 0, skipped = 0;
  for (const pagePath of pages) {
    const desired = orders[pagePath];
    total += desired.length;
    const editorUrl = `https://${site}${pagePath.replace(/\.html?$/, "")}?frame=admin`;
    console.log(`\n→ ${editorUrl}`);
    try {
      await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (e) {
      console.warn(`  load failed: ${e.message}`);
      skipped += desired.length;
      continue;
    }
    await page.waitForTimeout(2000);

    // Bubble out of any iframe — Squarespace renders the editor inside one.
    const frames = page.frames();
    const target = frames.find(f => /squarespace\.com/.test(f.url())) || page.mainFrame();

    // Walk the desired order; for each image (by basename), drag its block to
    // the position of the previous block + 1. We assume gallery items are
    // siblings in a single grid container.
    for (let i = 1; i < desired.length; i++) {
      const wantBase = basenameOf(desired[i]);
      const prevBase = basenameOf(desired[i - 1]);
      if (!wantBase || !prevBase) { skipped++; continue; }
      // Locate <img src*=basename>'s draggable ancestor; selector is best-effort.
      const wantBlock = target.locator(
        `[data-test*="block"]:has(img[src*="${wantBase}"]), .fe-block:has(img[src*="${wantBase}"]), .gallery-masonry-item:has(img[src*="${wantBase}"])`
      ).first();
      const prevBlock = target.locator(
        `[data-test*="block"]:has(img[src*="${prevBase}"]), .fe-block:has(img[src*="${prevBase}"]), .gallery-masonry-item:has(img[src*="${prevBase}"])`
      ).first();
      if (!(await wantBlock.count()) || !(await prevBlock.count())) {
        console.warn(`  ${wantBase}: block not found; skip`);
        skipped++; continue;
      }
      try {
        const wb = await wantBlock.boundingBox();
        const pb = await prevBlock.boundingBox();
        if (!wb || !pb) { skipped++; continue; }
        // Drag wantBlock just past prevBlock's right edge.
        await target.page().mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
        await target.page().mouse.down();
        await target.page().mouse.move(pb.x + pb.width + 12, pb.y + pb.height / 2, { steps: 16 });
        await target.page().mouse.up();
        applied++;
        console.log(`  ✓ ${wantBase} → after ${prevBase}`);
        await page.waitForTimeout(400);
      } catch (e) {
        console.warn(`  ${wantBase}: drag failed (${e.message})`);
        skipped++;
      }
    }

    // Save the page (Squarespace editor's Save button lives in the chrome).
    const save = page.locator('button:has-text("Save"), button[aria-label*="Save" i]').first();
    if (await save.count()) { try { await save.click(); console.log("  ✓ saved"); } catch {} }
    await page.waitForTimeout(800);
  }

  if (!cdp) await browser.close();
  console.log(`\ndone: ${applied}/${total} drags applied, ${skipped} skipped (UNTESTED — verify in admin).`);
}

main().catch(e => { console.error(e); process.exit(1); });
