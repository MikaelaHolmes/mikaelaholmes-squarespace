/* Preview-only font switcher.
 *
 * Reads font choices from the URL query string and applies them by injecting
 * a Google Fonts <link> + a high-specificity stylesheet override.
 *
 * Query params:
 *   font=<Family>[:<weights>]     applies to everything (body)
 *   heading=<Family>[:<weights>]  applies to h1..h6, .sqs-block-html h1, etc.
 *   mono=<Family>[:<weights>]     applies to code, pre, kbd, samp
 *
 * Examples:
 *   ?font=Lobster
 *   ?font=Inter:400,700
 *   ?heading=Playfair+Display:700&font=Inter:400
 *
 * This file is shipped only with the GitHub Pages preview build. It is NOT
 * how font changes should land on the live Squarespace site — for the live
 * site, port the equivalent CSS into Design → Custom CSS.
 */
(function () {
  var qs = new URLSearchParams(window.location.search);
  var body = qs.get("font");
  var heading = qs.get("heading");
  var mono = qs.get("mono");

  if (!body && !heading && !mono) return;

  function parse(spec) {
    if (!spec) return null;
    // "Family Name:400,700"  ->  { family, weights }
    var idx = spec.indexOf(":");
    var family = (idx === -1 ? spec : spec.slice(0, idx)).replace(/\+/g, " ").trim();
    var weights = idx === -1 ? "400,700" : spec.slice(idx + 1).trim();
    return { family: family, weights: weights };
  }

  function gfontParam(spec) {
    if (!spec) return null;
    // Google Fonts CSS2 needs "Family+Name:wght@400;700"
    var fam = spec.family.replace(/\s+/g, "+");
    var wts = spec.weights.split(",").map(function (w) { return w.trim(); }).filter(Boolean).join(";");
    return "family=" + fam + (wts ? ":wght@" + wts : "");
  }

  var specs = { body: parse(body), heading: parse(heading), mono: parse(mono) };
  var families = ["body", "heading", "mono"]
    .map(function (k) { return gfontParam(specs[k]); })
    .filter(Boolean);

  if (families.length) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?" + families.join("&") + "&display=swap";
    document.head.appendChild(link);

    var preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";
    document.head.appendChild(preconnect1);

    var preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "";
    document.head.appendChild(preconnect2);
  }

  function rule(selector, family) {
    return selector + '{font-family:"' + family + '",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif !important;}';
  }

  var css = "";
  if (specs.body) {
    css += rule("html,body,p,li,a,span,div,button,input,textarea,select,label,td,th", specs.body.family);
  }
  if (specs.heading) {
    css += rule("h1,h2,h3,h4,h5,h6,.sqs-block h1,.sqs-block h2,.sqs-block h3,.sqs-block h4", specs.heading.family);
  }
  if (specs.mono) {
    css += specs.mono ? 'code,pre,kbd,samp{font-family:"' + specs.mono.family + '",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace !important;}' : "";
  }

  var style = document.createElement("style");
  style.setAttribute("data-font-switcher", "1");
  style.textContent = css;
  document.head.appendChild(style);

  // Tiny floating badge so it's obvious which font is active.
  function badge() {
    var b = document.createElement("div");
    b.style.cssText =
      "position:fixed;right:8px;bottom:8px;z-index:99999;padding:6px 10px;" +
      "background:rgba(0,0,0,.7);color:#fff;font:12px/1.2 system-ui,sans-serif;" +
      "border-radius:6px;pointer-events:none;";
    var parts = [];
    if (specs.body) parts.push("body: " + specs.body.family);
    if (specs.heading) parts.push("heading: " + specs.heading.family);
    if (specs.mono) parts.push("mono: " + specs.mono.family);
    b.textContent = parts.join("  •  ");
    document.body.appendChild(b);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", badge);
  } else {
    badge();
  }
})();
