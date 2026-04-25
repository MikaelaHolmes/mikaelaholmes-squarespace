#!/usr/bin/env python3
"""Walk the local HTML mirror and build a map from absolute page path →
display title.

Source-of-truth precedence:
  1. The first <h1> inside the first `.sqs-html-content` div on the page —
     that's the real on-page title the user typed in the editor (e.g.
     "PLAYAN PRIESTESS"). Preserved verbatim, case included.
  2. Filename-derived fallback (split on `-`/`_`, `and`→`&`, title-case)
     for pages with no sqs-html h1 (category pages, etc.).

Usage:
    python3 preview/build-page-titles.py
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "preview" / "config.json"

# Detail pages live at the root and under portfolio/. Skip preview/ and
# the mirrored asset hosts (assets.squarespace.com, etc.).
SKIP_DIR_NAMES = {"preview", "assets.squarespace.com",
                  "images.squarespace-cdn.com", "static1.squarespace.com",
                  "antelope-tulip-5nyy.squarespace.com"}

def filename_title(p: Path) -> str:
    stem = p.stem.replace("_", "-")
    words = [w for w in stem.split("-") if w]
    out: list[str] = []
    for w in words:
        if w.lower() == "and":
            out.append("&")
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


# Match the FIRST <h1> inside any `.sqs-html-content` block. Tolerant to
# attribute reordering and stray whitespace; non-greedy on the inner content.
SQS_H1_RE = re.compile(
    r'class="[^"]*\bsqs-html-content\b[^"]*"[^>]*>\s*<h1\b[^>]*>(.*?)</h1>',
    re.IGNORECASE | re.DOTALL,
)
TAG_RE = re.compile(r"<[^>]+>")


def sqs_h1_title(text: str) -> str:
    m = SQS_H1_RE.search(text)
    if not m:
        return ""
    inner = TAG_RE.sub("", m.group(1))
    inner = html.unescape(inner).strip()
    inner = re.sub(r"\s+", " ", inner)
    return inner


def page_path(p: Path) -> str:
    rel = p.relative_to(ROOT).as_posix()
    return "/" + rel


def main() -> int:
    titles: dict[str, str] = {}
    for p in sorted(ROOT.rglob("*.html")):
        rel_parts = p.relative_to(ROOT).parts
        if any(part in SKIP_DIR_NAMES for part in rel_parts[:-1]):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        titles[page_path(p)] = sqs_h1_title(text) or filename_title(p)

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cfg["pageTitles"] = dict(sorted(titles.items()))
    CONFIG.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(titles)} page titles to {CONFIG.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
