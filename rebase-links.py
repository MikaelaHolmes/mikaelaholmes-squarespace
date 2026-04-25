#!/usr/bin/env python3
"""Rewrite relative links/asset refs in the mirror to be root-absolute (/...).

Walks the mirror root and rewrites in-place:
  - HTML: href, src, action, poster, data, srcset
  - CSS:  url(...) inside stylesheets and <style> blocks

A reference is rewritten when it is a *relative* path (no scheme, doesn't
already start with '/', '#', 'data:', 'mailto:', 'javascript:', or 'tel:').
Each such reference is resolved against the containing file's directory and
replaced with its absolute path from the mirror root.

Idempotent: already-absolute paths are left alone.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent

SKIP_PREFIXES = ("/", "#", "data:", "mailto:", "javascript:", "tel:", "blob:", "about:")


def is_relative(url: str) -> bool:
    u = url.strip()
    if not u:
        return False
    if u.startswith(SKIP_PREFIXES):
        return False
    parts = urlsplit(u)
    if parts.scheme or parts.netloc or u.startswith("//"):
        return False
    return True


def resolve(file_path: Path, ref: str) -> str:
    # Split off ?query / #fragment so we don't lose them.
    m = re.match(r"^([^?#]*)([?#].*)?$", ref)
    path_part = m.group(1) if m else ref
    suffix = m.group(2) or "" if m else ""
    if not path_part:
        return ref
    base_dir = file_path.parent
    target = (base_dir / path_part).resolve()
    try:
        rel = target.relative_to(ROOT)
    except ValueError:
        # Outside root — leave alone.
        return ref
    return "/" + str(rel).replace(os.sep, "/") + suffix


# href="...", src="...", action="...", poster="...", data="..."
ATTR_RE = re.compile(
    r'''(\b(?:href|src|action|poster|data)\s*=\s*)(?P<q>["'])(?P<val>[^"']*)(?P=q)''',
    re.IGNORECASE,
)
# srcset="url1 1x, url2 2x" — comma-separated list, each item is "url [descriptor]"
SRCSET_RE = re.compile(
    r'''(\bsrcset\s*=\s*)(?P<q>["'])(?P<val>[^"']*)(?P=q)''',
    re.IGNORECASE,
)
# CSS url(...) — supports unquoted, single, and double quoted forms.
CSS_URL_RE = re.compile(
    r'''url\(\s*(?P<q>["']?)(?P<val>(?:(?!\)|\s).)*)(?P=q)\s*\)''',
)


def rewrite_attr(file_path: Path, m: re.Match) -> str:
    val = m.group("val")
    if not is_relative(val):
        return m.group(0)
    new = resolve(file_path, val)
    return f'{m.group(1)}{m.group("q")}{new}{m.group("q")}'


def rewrite_srcset(file_path: Path, m: re.Match) -> str:
    val = m.group("val")
    parts = []
    changed = False
    for item in val.split(","):
        item = item.strip()
        if not item:
            continue
        bits = item.split(None, 1)
        url = bits[0]
        descriptor = bits[1] if len(bits) > 1 else ""
        if is_relative(url):
            url = resolve(file_path, url)
            changed = True
        parts.append(url + ((" " + descriptor) if descriptor else ""))
    if not changed:
        return m.group(0)
    new = ", ".join(parts)
    return f'{m.group(1)}{m.group("q")}{new}{m.group("q")}'


def rewrite_css_url(file_path: Path, m: re.Match) -> str:
    val = m.group("val")
    if not is_relative(val):
        return m.group(0)
    new = resolve(file_path, val)
    q = m.group("q")
    return f"url({q}{new}{q})"


def process(file_path: Path) -> bool:
    try:
        text = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    new = text
    if file_path.suffix.lower() in {".html", ".htm"}:
        new = ATTR_RE.sub(lambda m: rewrite_attr(file_path, m), new)
        new = SRCSET_RE.sub(lambda m: rewrite_srcset(file_path, m), new)
        new = CSS_URL_RE.sub(lambda m: rewrite_css_url(file_path, m), new)
    elif file_path.suffix.lower() == ".css":
        new = CSS_URL_RE.sub(lambda m: rewrite_css_url(file_path, m), new)
    else:
        return False
    if new != text:
        file_path.write_text(new, encoding="utf-8")
        return True
    return False


def main() -> int:
    targets = [
        p
        for p in ROOT.rglob("*")
        if p.is_file() and p.suffix.lower() in {".html", ".htm", ".css"}
    ]
    changed = 0
    for p in targets:
        if process(p):
            changed += 1
    print(f"Scanned {len(targets)} files; rewrote {changed}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
