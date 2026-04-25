#!/usr/bin/env node
/*
 * Rename pages in the live Squarespace site. UNTESTED — see CLAUDE.md
 * "Playwright scripts: the bar". Treat the selectors below as a starting
 * point; verify against the real admin UI before relying on this script.
 *
 * Reads `preview/rename-manifest.json` (`{ renames: [{ from, to }, ...] }`)
 * and drives the Squarespace admin UI to change each page's URL slug.
 *
 * Usage:
 *   SQS_SITE=antelope-tulip-5nyy.squarespace.com \
 *   SQS_EMAIL=you@example.com SQS_PASSWORD=... \
 *   node rename-pages.js [--headed] [--headless] [--dry-run]
 *
 * Flags:
 *   --headed    show the browser (default: headed for safety while untested)
 *   --headless  run with no visible browser
 *   --dry-run   parse manifest + print plan; don't drive the browser
 */

const fs = require("fs");
const path = require("path");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  // Default to HEADED while this script is unverified — safer to watch it
  // run. Pass --headless explicitly once you've verified the selectors.
  let headed = !args.includes("--headless");
  if (args.includes("--headed")) headed = true;

  const manifestPath = path.resolve(__dirname, "rename-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const titlecaseFromSlug = (slug) =>
    slug.split("-").filter(Boolean).map(w =>
      w.toLowerCase() === "and" ? "&" : (w[0].toUpperCase() + w.slice(1))
    ).join(" ");
  const renames = (manifest.renames || [])
    .filter(r => r.from && r.to)
    .map(r => ({ ...r, title: r.title || titlecaseFromSlug(r.to) }));
  console.log(`renaming ${renames.length} page(s) (mode: ${headed ? "headed" : "headless"}${dryRun ? ", dry-run" : ""})`);
  for (const r of renames) console.log(`  ${r.from}  →  slug=${r.to}  title="${r.title}"`);
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

  // Login. Selectors are best-effort; verify before relying.
  console.log("→ login.squarespace.com");
  await page.goto("https://login.squarespace.com/", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.click('button[type="submit"], button:has-text("Continue")');
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"], button:has-text("Log In")');
  await page.waitForURL(/squarespace\.com/, { timeout: 30000 });

  for (const { from, to, title } of renames) {
    const url = `https://${site}/config/pages`;
    console.log(`→ ${url}  (renaming ${from} → slug=${to}, title="${title}")`);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Find and click the page entry. The list is virtualized — Squarespace
    // shows page titles as text. Use a selector keyed off the current slug.
    const fromSlug = from.replace(/\.html?$/, "").split("/").filter(Boolean).pop();
    const target = page.locator(`[data-name="${fromSlug}"], [data-test*="${fromSlug}"], a[href*="${fromSlug}"]`).first();
    if (!(await target.count())) {
      console.warn(`  page not found in admin: ${fromSlug} — skipping`);
      continue;
    }
    // Open settings (cogwheel) for that row.
    await target.hover();
    const cog = target.locator('[data-test*="settings"], button[aria-label*="settings" i]').first();
    if (await cog.count()) {
      await cog.click();
    } else {
      await target.click();
    }
    // Settings drawer. Update both the URL slug and the page title (the
    // Page Title field — populates <title>, og:title, and the editor list).
    const slugInput = page.locator(
      'input[name="urlId"], input[name="slug"], input[aria-label*="URL" i], input[id*="slug" i]'
    ).first();
    await slugInput.waitFor({ timeout: 10000 });
    await slugInput.fill(to);

    const titleInput = page.locator(
      'input[name="title"], input[aria-label*="Page Title" i], input[aria-label="Title"], input[id*="title" i]'
    ).first();
    if (await titleInput.count()) {
      await titleInput.fill(title);
    } else {
      console.warn(`  page title field not found — slug updated but title left as-is`);
    }

    // Save. Squarespace uses different button labels at different points;
    // try the common ones in order.
    const save = page.locator('button:has-text("Save"), button:has-text("Apply"), button[type="submit"]').first();
    await save.click();
    // Confirmation toast or URL change.
    await page.waitForTimeout(1500);
    console.log(`  ✓ ${fromSlug} → slug=${to}, title="${title}" (UI flow attempted; verify in admin)`);
  }

  // ---- Image alt-text pass ---------------------------------------------
  // Pull the override map from preview/config.json's imageTitles. For each
  // image whose current alt text on the live site differs from the desired
  // title, update the alt via the editor UI. UNTESTED — selectors below
  // are best-effort; verify against the real admin before relying on this.
  let altTotal = 0, altUpdated = 0, altSkipped = 0;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "config.json"), "utf8"));
    const imageTitles = cfg.imageTitles || {};
    const want = Object.entries(imageTitles).filter(([, v]) => v && v.trim());
    altTotal = want.length;
    if (altTotal) {
      console.log(`\n→ image alt-text pass (${altTotal} entries with titles)`);
      // Visit the public site once and walk all <img>s, matching by basename.
      // For pages reachable via the live URL: drive into the editor via the
      // image block's "Edit" affordance. Squarespace's image-block edit
      // panel exposes an alt-text input; we set and save.
      // This loop is intentionally simple — verify in the admin afterwards.
      for (const [basename, title] of want) {
        // Search admin asset library by basename (best-effort URL).
        const searchUrl = `https://${site}/config/pages?asset=${encodeURIComponent(basename)}`;
        try {
          await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
        } catch {}
        // Find an alt-text field whose surrounding row references this basename.
        const altField = page.locator(
          `:has(text=${JSON.stringify(basename)}) input[name="altText"], ` +
          `:has(text=${JSON.stringify(basename)}) input[aria-label*="alt" i], ` +
          `:has(text=${JSON.stringify(basename)}) textarea[name="altText"]`
        ).first();
        if (!(await altField.count())) {
          altSkipped++;
          console.warn(`  ${basename} — alt field not found, skipping`);
          continue;
        }
        const currentAlt = (await altField.inputValue().catch(() => "")) || "";
        if (currentAlt.trim() === title.trim()) {
          altSkipped++;
          continue;
        }
        await altField.fill(title);
        const save = page.locator('button:has-text("Save"), button:has-text("Apply")').first();
        if (await save.count()) await save.click();
        await page.waitForTimeout(800);
        altUpdated++;
        console.log(`  ${basename} alt: "${currentAlt}" → "${title}"`);
      }
      console.log(`alt-text pass: ${altUpdated} updated, ${altSkipped} unchanged/skipped of ${altTotal}`);
    }
  } catch (e) {
    console.warn(`alt-text pass failed: ${e.message}`);
  }

  await browser.close();
  console.log("done (UNTESTED — verify each rename + alt update in the live admin).");
}

main().catch(e => { console.error(e); process.exit(1); });
