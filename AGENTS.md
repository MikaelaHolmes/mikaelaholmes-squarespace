# Working in this directory

This is a static mirror of a Squarespace-hosted site (`antelope-tulip-5nyy.squarespace.com`),
captured by `wget` and then flattened/rewritten so it serves from `/`. The HTML, CSS, and JS
under this tree are **vendor output from Squarespace** — minified, generated, and not authored
by us. Treat them as read-only artifacts.

## Hard rules for modifying the live site

The mirror is a **reference and preview** of the live Squarespace site. The live site is what
matters. Any change that is meant to ship to the live site MUST be expressed as one of:

1. **Custom CSS** that can be pasted into Squarespace's *Custom CSS* panel
   (Design → Custom CSS, or the per-site equivalent).
2. **Code injection / custom script** snippets that can be pasted into Squarespace's
   *Code Injection* panels (Header, Footer, Lock Page, or per-page Code Block).
3. **Playwright scripts** that drive the live admin/editor UI to make the change, and that
   you have verified will work end-to-end against the real site (login + target action +
   visible confirmation) before handing them over.

Do not propose changes that require:

- Editing minified Squarespace bundles (`assets.squarespace.com/...`,
  `static1.squarespace.com/...`, the rewritten HTML at the root, etc.).
- Server-side templates, theme JSON, or anything that isn't reachable from the
  Squarespace admin UI for this plan tier.
- Hand-edited HTML files in this mirror as a delivery mechanism. Edits here are
  for *local preview only* — they don't propagate to the live site.

If a requested change cannot be done via (1), (2), or (3), say so explicitly and stop;
don't fall back to editing the mirror and pretending it's a fix.

## Playwright scripts: the bar

When delivering a Playwright script as the change mechanism:

- It must run against the real `*.squarespace.com` admin or the public site, not the
  local mirror.
- It must handle the password gate / login deterministically (selectors that exist,
  waits that resolve, no `sleep`-as-hope).
- It must verify the change took effect (assertion on a post-change selector or
  network response), not just "no exception was thrown".
- If you haven't actually run it, say "untested" — don't claim it works.

## What lives here

- `serve.sh` — local static server (`python3 -m http.server`), opens `http://localhost:8000/`.
- `flatten.sh` — one-time flattening of the wget mirror tree (idempotent).
- `rebase-links.py` — rewrites HTML/CSS refs to root-absolute (`/...`); idempotent.
- Top-level `*.html` — flattened pages from the primary host.
- `assets.squarespace.com/`, `images.squarespace-cdn.com/`, `static1.squarespace.com/` —
  mirrored asset hosts; cross-host refs in HTML now point at `/<host>/...`.

Local-only edits (e.g., tweaking `serve.sh`, regenerating the mirror, adjusting these
helper scripts) are fine and don't go through the rules above. The rules apply to changes
intended to land on the live Squarespace site.
