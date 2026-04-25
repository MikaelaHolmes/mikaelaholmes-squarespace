#!/usr/bin/env bash
# Idempotently inject the preview <link>+<script> tags into every HTML file
# in the local mirror. Re-run any time preview.js / preview.css move.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
import re, sys
from pathlib import Path
root = Path(sys.argv[1])
marker = "<!--preview-helper-->"
inject = (
    marker +
    '<link rel="stylesheet" href="/preview/preview.css">'
    '<script defer src="/preview/preview.js"></script>'
)
n = 0
for p in root.rglob("*.html"):
    if "/preview/" in str(p): continue
    text = p.read_text(encoding="utf-8", errors="ignore")
    if marker in text: continue
    new, c = re.subn(r"</head>", inject + "</head>", text, count=1, flags=re.IGNORECASE)
    if c == 0:
        new, c = re.subn(r"<body[^>]*>", lambda m: m.group(0) + inject, text, count=1, flags=re.IGNORECASE)
    if c:
        p.write_text(new, encoding="utf-8"); n += 1
print(f"injected preview helper into {n} HTML files")
PY
