#!/usr/bin/env python3
"""Build `imageTitles` and `imageDetailPages` in config.json.

Title precedence per image basename:
  1. Existing human / vision override (kept verbatim if
     `imageTitleSources[base]` is "human" or "vision").
  2. **Detail-page H1.** If the image is wrapped in `<a href="/X.html">` on
     any home/category page, and `/X.html` has a `.sqs-html-content` H1,
     use that H1 as the image title (e.g. Libellule_2.jpeg → "LIBELLULE
     HEADPIECE" via /green-loopy-hp.html). The link target is recorded in
     `imageDetailPages[base] = "/X.html"`.
  3. Filename-derived title (humanize stem, "and"→"&", title case).
  4. Empty (camera-default basenames like DSC_/IMG_/dated-IMG/UUID-prefixed
     fall through to no label, and `/name-images` fills them via vision).

Re-run any time the mirror or page H1s change.

Usage:
    python3 preview/build-image-titles.py [--report]
"""
from __future__ import annotations
import html
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "preview" / "config.json"
CDN_DIRS = [ROOT / "images.squarespace-cdn.com", ROOT / "static1.squarespace.com"]
SKIP_DIR_NAMES = {
    "preview", "assets.squarespace.com", "images.squarespace-cdn.com",
    "static1.squarespace.com", "antelope-tulip-5nyy.squarespace.com",
}

CAMERA_DEFAULT = re.compile(
    r"^(?:DSC|DSCN|IMG|MVI|GOPR|P[0-9]{3,7}\b|"
    r"\d{6,8}-?(?:DSC|IMG|DSCN)|"
    r"\d{3,}_[a-f0-9]{6,}|"
    r"[a-f0-9]{8}-)",
    re.IGNORECASE,
)
DIMENSION_SUFFIX = re.compile(r"[-_]\d{2,4}x\d{2,4}$")
SQS_H1_RE = re.compile(
    r'class="[^"]*\bsqs-html-content\b[^"]*"[^>]*>\s*<h1\b[^>]*>(.*?)</h1>',
    re.IGNORECASE | re.DOTALL,
)
TAG_RE = re.compile(r"<[^>]+>")
# `<a ... href="/page.html" ...>...<img ... (data-src|src)="...basename..." ...>`
# spanning whitespace/newlines/intermediate tags, non-greedy.
LINK_IMG_RE = re.compile(
    r'<a\b[^>]*?\bhref="(/[^"#?]+\.html?)(?:[?#][^"]*)?"[^>]*>'
    r'(?:(?!</a>).){0,4000}?'
    r'<img\b[^>]*?\b(?:data-src|data-image|src)="([^"]+)"',
    re.IGNORECASE | re.DOTALL,
)


def normalize_basename(name: str) -> str:
    f = name.split("?")[0].split("/")[-1]
    f = re.sub(r"@format=\d+w$", "", f)
    f = re.sub(r"\(\d+\)(?=\.[a-zA-Z]+$)", "", f)
    f = re.sub(r"^Copy\+of\+", "", f, flags=re.IGNORECASE)
    f = re.sub(r"^Copy\s+of\s+", "", f, flags=re.IGNORECASE)
    return f


def filename_title(stem: str) -> str:
    if CAMERA_DEFAULT.search(stem):
        return ""
    s = stem.replace("+", " ").replace("_", " ").replace("-", " ")
    s = DIMENSION_SUFFIX.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""
    out = []
    for w in s.split(" "):
        if w.lower() == "and":
            out.append("&")
        elif re.fullmatch(r"\d+", w):
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def sqs_h1(text: str) -> str:
    m = SQS_H1_RE.search(text)
    if not m:
        return ""
    inner = TAG_RE.sub("", m.group(1))
    return re.sub(r"\s+", " ", html.unescape(inner)).strip()


def collect_basenames() -> dict[str, list[Path]]:
    by_base: dict[str, list[Path]] = defaultdict(list)
    for d in CDN_DIRS:
        if not d.exists():
            continue
        for p in d.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}:
                continue
            by_base[normalize_basename(p.name)].append(p)
    return by_base


def scan_pages() -> tuple[dict[str, str], dict[str, str]]:
    """Returns (page_h1_by_path, image_basename_to_detail_page).

    First-link-wins for the detail-page map: if Foo.jpeg appears wrapped in
    a link on multiple pages, the lexicographically first page's link is
    recorded. (In practice the home page wraps thumbs in their detail-page
    links, and category pages don't wrap thumbs in links — so this is fine.)
    """
    page_h1: dict[str, str] = {}
    img_to_detail: dict[str, str] = {}
    for p in sorted(ROOT.rglob("*.html")):
        rel = p.relative_to(ROOT)
        if any(part in SKIP_DIR_NAMES for part in rel.parts[:-1]):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        page_path = "/" + rel.as_posix()
        h1 = sqs_h1(text)
        if h1:
            page_h1[page_path] = h1
        for m in LINK_IMG_RE.finditer(text):
            href, src = m.group(1), m.group(2)
            base = normalize_basename(src)
            if base and base not in img_to_detail:
                img_to_detail[base] = href
    return page_h1, img_to_detail


def main() -> int:
    report = "--report" in sys.argv[1:]
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    existing: dict[str, str] = cfg.get("imageTitles") or {}
    sources: dict[str, str] = cfg.get("imageTitleSources") or {}

    by_base = collect_basenames()
    page_h1, img_to_detail = scan_pages()

    titles: dict[str, str] = {}
    detail_pages: dict[str, str] = {}
    unnamed: list[str] = []
    from_detail = 0
    for base in sorted(by_base):
        # 1. Preserve human/vision overrides verbatim.
        src = sources.get(base)
        if src in {"human", "vision"} and existing.get(base):
            titles[base] = existing[base]
            if base in img_to_detail:
                detail_pages[base] = img_to_detail[base]
            continue

        # 2. Detail-page H1.
        detail = img_to_detail.get(base)
        if detail:
            detail_pages[base] = detail
            h1 = page_h1.get(detail)
            if h1:
                titles[base] = h1
                from_detail += 1
                continue

        # 3. Filename-derived.
        stem = re.sub(r"\.[a-zA-Z]+$", "", base)
        t = filename_title(stem)
        if t:
            titles[base] = t
        else:
            unnamed.append(base)

    cfg["imageTitles"] = dict(sorted(titles.items()))
    cfg["imageDetailPages"] = dict(sorted(detail_pages.items()))
    if "_imageTitles_comment" not in cfg:
        cfg["_imageTitles_comment"] = (
            "Override map: image basename → display title. Built by "
            "`preview/build-image-titles.py`. Precedence: human/vision "
            "override > detail-page H1 (via imageDetailPages) > filename. "
            "Camera-default names skipped — `/name-images` fills via vision."
        )
    CONFIG.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(titles)} image title(s) "
          f"({from_detail} from detail-page H1, "
          f"{len(detail_pages)} image→detail mappings); "
          f"{len(unnamed)} still unnamed")
    if report and unnamed:
        print("\nunnamed (no usable filename signal, no detail-page link):")
        for b in unnamed:
            paths = by_base[b]
            print(f"  {b}  ({len(paths)} copy/copies, e.g. {paths[0].relative_to(ROOT)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
