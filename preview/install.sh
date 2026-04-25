#!/usr/bin/env bash
# Idempotently inject the preview <link>+<script> tags (plus an inlined
# <script type="application/json"> with config.json contents) into every
# HTML file in the local mirror. Re-run any time preview.js / preview.css /
# config.json change — the cache-break key (file mtime) is refreshed in
# every page.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Use file mtimes as cache-break keys so a re-run after editing
# preview.js / preview.css forces every browser to fetch the new bytes.
CSS_V="$(date -r "$ROOT/preview/preview.css" +%s 2>/dev/null || echo 1)"
JS_V="$(date -r "$ROOT/preview/preview.js" +%s 2>/dev/null || echo 1)"
CFG_V="$(date -r "$ROOT/preview/config.json" +%s 2>/dev/null || echo 1)"

python3 - "$ROOT" "$CSS_V" "$JS_V" "$CFG_V" <<'PY'
import re, sys, json
from pathlib import Path
root = Path(sys.argv[1])
css_v, js_v, cfg_v = sys.argv[2], sys.argv[3], sys.argv[4]
# Load + minify config so the inlined JSON stays compact.
config_text = json.dumps(
    json.loads((root / "preview" / "config.json").read_text(encoding="utf-8")),
    separators=(",", ":"),
)
marker_re = re.compile(r"<!--preview-helper(?:@[^-]+)?-->")
marker = f"<!--preview-helper@{css_v}.{js_v}.{cfg_v}-->"
inject = (
    marker +
    f'<script id="preview-config" type="application/json">{config_text}</script>'
    f'<link rel="stylesheet" href="/preview/preview.css?v={css_v}">'
    f'<script defer src="/preview/preview.js?v={js_v}"></script>'
)
# Strip any prior injection (with any version) and insert fresh.
strip_re = re.compile(
    r"<!--preview-helper(?:@[^-]+)?-->"
    r'(?:<script id="preview-config" type="application/json">.*?</script>)?'
    r'<link rel="stylesheet" href="/preview/preview\.css(?:\?[^"]*)?">'
    r'<script defer src="/preview/preview\.js(?:\?[^"]*)?"></script>',
    re.DOTALL,
)
n = 0
for p in root.rglob("*.html"):
    if "/preview/" in str(p): continue
    text = p.read_text(encoding="utf-8", errors="ignore")
    text2 = strip_re.sub("", text)
    new, c = re.subn(r"</head>", lambda m: inject + "</head>", text2, count=1, flags=re.IGNORECASE)
    if c == 0:
        new, c = re.subn(r"<body[^>]*>", lambda m: m.group(0) + inject, text2, count=1, flags=re.IGNORECASE)
    if c and new != text:
        p.write_text(new, encoding="utf-8"); n += 1
print(f"injected preview helper (css={css_v} js={js_v} cfg={cfg_v}) into {n} HTML files")
PY
