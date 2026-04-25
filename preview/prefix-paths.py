#!/usr/bin/env python3
"""Prefix existing root-absolute paths in HTML/CSS with a path segment."""
import re
import sys
from pathlib import Path

if len(sys.argv) != 3:
    print("usage: prefix-paths.py <root-dir> <prefix>", file=sys.stderr)
    sys.exit(2)
root = Path(sys.argv[1]).resolve()
prefix = "/" + sys.argv[2].strip("/")

ATTR_RE = re.compile(
    r'''(\b(?:href|src|action|poster|data|srcset)\s*=\s*)(?P<q>["'])(?P<val>[^"']*)(?P=q)''',
    re.IGNORECASE,
)
CSS_URL_RE = re.compile(r'''url\(\s*(?P<q>["']?)(?P<val>(?:(?!\)|\s).)*)(?P=q)\s*\)''')

def is_root_abs(u: str) -> bool:
    return u.startswith("/") and not u.startswith("//")

def prefix_one(u: str) -> str:
    if not is_root_abs(u):
        return u
    if u.startswith(prefix + "/") or u == prefix:
        return u  # already prefixed
    return prefix + u

def rewrite_attr(m):
    if m.group(1).strip().lower().startswith("srcset"):
        parts = []
        changed = False
        for item in m.group("val").split(","):
            item = item.strip()
            if not item:
                continue
            bits = item.split(None, 1)
            url = bits[0]
            desc = bits[1] if len(bits) > 1 else ""
            new = prefix_one(url)
            if new != url:
                changed = True
            parts.append(new + ((" " + desc) if desc else ""))
        if not changed:
            return m.group(0)
        return f'{m.group(1)}{m.group("q")}{", ".join(parts)}{m.group("q")}'
    val = m.group("val")
    new = prefix_one(val)
    if new == val:
        return m.group(0)
    return f'{m.group(1)}{m.group("q")}{new}{m.group("q")}'

def rewrite_url(m):
    val = m.group("val")
    new = prefix_one(val)
    if new == val:
        return m.group(0)
    q = m.group("q")
    return f"url({q}{new}{q})"

changed = 0
for p in root.rglob("*"):
    if not p.is_file() or p.suffix.lower() not in {".html", ".htm", ".css"}:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    new = text
    if p.suffix.lower() in {".html", ".htm"}:
        new = ATTR_RE.sub(rewrite_attr, new)
        new = CSS_URL_RE.sub(rewrite_url, new)
    else:
        new = CSS_URL_RE.sub(rewrite_url, new)
    if new != text:
        p.write_text(new, encoding="utf-8")
        changed += 1
print(f"prefixed paths in {changed} files with {prefix}")
