#!/usr/bin/env node
/*
 * Add a "Projects" page to the live Squarespace site. UNTESTED — see
 * CLAUDE.md "Playwright scripts: the bar". The selectors below are best
 * effort; verify against the real admin UI before relying on this script.
 *
 * What it does:
 *   1. Logs into Squarespace admin.
 *   2. Opens Pages and creates a new page called "Projects" if one doesn't
 *      already exist (slug: projects).
 *   3. Adds a Code Block to the page with the typographic-list HTML scaffold
 *      that preview.js renders into. (preview.js is loaded site-wide via
 *      Code Injection — header — so it'll find the placeholder and populate.)
 *   4. Writes Custom CSS for the projects-list styling into the per-page
 *      Page Header Code Injection — so the page is self-contained and
 *      doesn't require touching the global Custom CSS panel.
 *   5. Saves and reorders the page into the main nav, after Portfolio.
 *
 * Prereqs:
 *   - The site already has /preview/preview.js loaded site-wide (via
 *     Settings → Advanced → Code Injection → Header). If not, run the
 *     install-preview-helper.js script first. (UNTESTED.)
 *
 * Usage:
 *   SQS_SITE=antelope-tulip-5nyy.squarespace.com \
 *   SQS_EMAIL=you@example.com SQS_PASSWORD=... \
 *   node add-projects-page.js [--headed] [--headless] [--dry-run]
 */

const fs = require("fs");
const path = require("path");

// HTML scaffold for the Code Block (preview.js renders into the <ol>).
const PAGE_SCAFFOLD = `
<section id="preview-projects-list" class="preview-projects-list-section" aria-label="Projects">
  <header class="preview-projects-head">
    <h1 class="preview-projects-title">Projects</h1>
    <p class="preview-projects-sub">A complete index — every piece, in chronological order. Hover for a glimpse, click for the full set.</p>
  </header>
  <ol class="preview-projects-list" id="preview-projects-list-ol"></ol>
</section>
`.trim();

// Per-page Custom CSS (read from preview.css's projects block at runtime so
// it stays in sync with local preview).
function extractProjectsCss() {
  const css = fs.readFileSync(path.resolve(__dirname, "preview.css"), "utf8");
  const start = css.indexOf("/* ---------- Projects index");
  if (start < 0) throw new Error("projects-index CSS block not found in preview.css");
  return css.slice(start);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let headed = !args.includes("--headless");
  if (args.includes("--headed")) headed = true;

  const projectsCss = extractProjectsCss();

  console.log(`add-projects-page (mode: ${headed ? "headed" : "headless"}${dryRun ? ", dry-run" : ""})`);
  console.log(`  scaffold bytes: ${PAGE_SCAFFOLD.length}`);
  console.log(`  injected css bytes: ${projectsCss.length}`);
  if (dryRun) {
    console.log("\n--- scaffold ---\n" + PAGE_SCAFFOLD);
    console.log("\n--- css (first 400 bytes) ---\n" + projectsCss.slice(0, 400) + "...");
    return;
  }

  const cdp = process.env.SQS_CDP;
  const site = process.env.SQS_SITE;
  const email = process.env.SQS_EMAIL;
  const password = process.env.SQS_PASSWORD;
  if (!cdp && (!site || !email || !password)) {
    console.error("missing env: set SQS_CDP=http://host:9223 (recommended)\n" +
                  "       OR  SQS_SITE+SQS_EMAIL+SQS_PASSWORD");
    process.exit(2);
  }

  const { chromium } = require("playwright");
  let browser, ctx, page;
  if (cdp) {
    console.log(`→ connecting CDP @ ${cdp}`);
    browser = await chromium.connectOverCDP(cdp);
    ctx = browser.contexts()[0] || (await browser.newContext());
    page = ctx.pages()[0] || (await ctx.newPage());
  } else {
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

  // Open the Pages panel.
  const pagesUrl = `https://${site}/config/pages`;
  console.log(`→ ${pagesUrl}`);
  await page.goto(pagesUrl, { waitUntil: "domcontentloaded" });

  // If a Projects page already exists, we'll edit it; otherwise create it.
  const existing = page.locator('a[href*="/projects"], [data-test*="projects" i]').first();
  let exists = false;
  try { exists = (await existing.count()) > 0; } catch {}

  if (!exists) {
    console.log("→ Pages: + → Page → Blank");
    // Click the "+" to add a page in the Main Navigation section.
    const addBtn = page.locator(
      '[aria-label*="Add Page" i], [data-test="add-page-button"], button:has-text("Add")'
    ).first();
    await addBtn.click();
    // Choose a blank page layout. Squarespace shows a layout picker; the
    // "Blank" option is typically labeled "Start From Scratch" or similar.
    const blank = page.locator(
      'button:has-text("Blank"), button:has-text("Start From Scratch"), [data-test="blank-page-template"]'
    ).first();
    if (await blank.count()) await blank.click();

    // Title the page.
    const titleInput = page.locator(
      'input[placeholder*="Page Title" i], input[name="title"], input[aria-label*="title" i]'
    ).first();
    await titleInput.waitFor({ timeout: 10000 });
    await titleInput.fill("Projects");
    // Confirm / save the new page (Squarespace creates it and opens it).
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);
    console.log("  ✓ created Projects page");
  } else {
    console.log("→ Projects page already exists — editing");
    await existing.click();
    await page.waitForTimeout(1500);
  }

  // Open the page in editor mode and add a Code Block.
  // Squarespace's editor Add-Block flyout is typically reached by hovering
  // an empty section and clicking the "+" insertion point.
  console.log("→ inserting Code Block with projects scaffold");
  const insertPoint = page.locator(
    '[data-test="insert-point-add-block"], [aria-label*="Add Block" i], .sqs-add-block-button'
  ).first();
  if (await insertPoint.count()) {
    await insertPoint.click();
    const codeChip = page.locator(
      'button:has-text("Code"), [data-test="block-menu-code"], [aria-label*="Code Block" i]'
    ).first();
    await codeChip.click();
    // Code editor textarea — Squarespace uses a CodeMirror or plain textarea.
    const codeArea = page.locator('textarea, .CodeMirror textarea, [contenteditable="true"]').first();
    await codeArea.fill(PAGE_SCAFFOLD);
    const saveCode = page.locator('button:has-text("Apply"), button:has-text("Save")').first();
    if (await saveCode.count()) await saveCode.click();
    console.log("  ✓ code block inserted (verify in editor)");
  } else {
    console.warn("  could not locate insert point — code block NOT inserted; do this manually");
  }

  // Page-level CSS: open page settings → Advanced → Page Header Code Injection
  // and paste a <style>...</style> block with the projects CSS.
  console.log("→ adding per-page CSS via Page Header Code Injection");
  const pageSettings = page.locator(
    '[aria-label*="Page Settings" i], [data-test="page-settings"], button:has-text("Settings")'
  ).first();
  if (await pageSettings.count()) {
    await pageSettings.click();
    const advanced = page.locator('button:has-text("Advanced"), [data-tab="advanced"]').first();
    if (await advanced.count()) await advanced.click();
    const inject = page.locator(
      'textarea[name*="header" i], textarea[aria-label*="Page Header" i], textarea[aria-label*="Code Injection" i]'
    ).first();
    if (await inject.count()) {
      await inject.fill(`<style>\n${projectsCss}\n</style>`);
      const save = page.locator('button:has-text("Save"), button:has-text("Apply")').first();
      if (await save.count()) await save.click();
      console.log("  ✓ per-page CSS injected");
    } else {
      console.warn("  Code Injection field not found — paste manually:\n" +
        "    Settings → Advanced → Page Header Code Injection");
    }
  } else {
    console.warn("  page settings not found — skip");
  }

  // Reorder so Projects sits right after Portfolio in the main nav. Drag-drop
  // is awkward in Playwright; this is a best-effort attempt — if it fails,
  // the user can drag manually in the Pages panel.
  console.log("→ attempting to reorder Projects after Portfolio in main nav");
  await page.goto(pagesUrl, { waitUntil: "domcontentloaded" });
  const projectsRow = page.locator('a[href*="/projects"], [data-name="projects"]').first();
  const portfolioRow = page.locator('a[href*="/portfolio"], [data-name="portfolio"]').first();
  if ((await projectsRow.count()) && (await portfolioRow.count())) {
    try {
      const pBox = await portfolioRow.boundingBox();
      const prBox = await projectsRow.boundingBox();
      if (pBox && prBox) {
        await page.mouse.move(prBox.x + 12, prBox.y + prBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(pBox.x + 12, pBox.y + pBox.height + 8, { steps: 16 });
        await page.mouse.up();
        console.log("  ✓ drag attempted (verify order in admin)");
      }
    } catch (e) {
      console.warn(`  drag failed: ${e.message} — reorder manually`);
    }
  } else {
    console.warn("  could not locate Projects/Portfolio rows — reorder manually");
  }

  if (!cdp) await browser.close();
  console.log("\ndone (UNTESTED — verify each step in the live admin):");
  console.log("  1. /projects exists with the code block scaffold");
  console.log("  2. Page Header Code Injection has the <style> block");
  console.log("  3. Main nav order: HOME · PORTFOLIO · PROJECTS · ABOUT · CONTACT");
  console.log("  4. /preview/preview.js is loaded site-wide (it renders into #preview-projects-list-ol)");
}

main().catch(e => { console.error(e); process.exit(1); });
