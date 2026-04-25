#!/usr/bin/env python3
"""Static dev server with a small JSON-over-HTTP endpoint for the preview
pill's image-title overrides.

Endpoints:
  POST   /preview/api/image-titles   body: {"<basename>": "<title>", ...}
                                     merges into config.json's imageTitles
                                     (empty title removes the key) and runs
                                     preview/install.sh to re-inline.
  DELETE /preview/api/image-titles?clearLocal=1
                                     no-op server-side (the client clears
                                     its own localStorage); returns 200.
  GET *                              static file serving (current dir).
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "preview" / "config.json"
INSTALL = ROOT / "preview" / "install.sh"
API_PATH = "/preview/api/image-titles"
MATERIALS_PATH = "/preview/api/materials"
ORDERS_PATH = "/preview/api/image-orders"


def merge_image_titles(updates: dict[str, str], source: str | None = None) -> dict[str, str]:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    titles: dict[str, str] = cfg.get("imageTitles") or {}
    sources: dict[str, str] = cfg.get("imageTitleSources") or {}
    for k, v in updates.items():
        if not k:
            continue
        if v:
            titles[k] = v
            if source:
                sources[k] = source
        else:
            titles.pop(k, None)
            sources.pop(k, None)
    cfg["imageTitles"] = dict(sorted(titles.items()))
    cfg["imageTitleSources"] = dict(sorted(sources.items()))
    CONFIG.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    try:
        subprocess.run(["bash", str(INSTALL)], check=False, cwd=str(ROOT),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    return cfg["imageTitles"]


def merge_materials(updates: dict[str, str], source: str | None = None) -> dict[str, str]:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    mats: dict[str, str] = cfg.get("homepageMaterials") or {}
    sources: dict[str, str] = cfg.get("homepageMaterialSources") or {}
    for k, v in updates.items():
        if not k:
            continue
        if v:
            mats[k] = v
            if source:
                sources[k] = source
        else:
            mats.pop(k, None)
            sources.pop(k, None)
    cfg["homepageMaterials"] = dict(sorted(mats.items()))
    cfg["homepageMaterialSources"] = dict(sorted(sources.items()))
    CONFIG.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    try:
        subprocess.run(["bash", str(INSTALL)], check=False, cwd=str(ROOT),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    return cfg["homepageMaterials"]


def merge_image_orders(page: str, order: list[str]) -> dict[str, list[str]]:
    """Replace `imageOrders[page]` with the given list (clears if empty)."""
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    orders: dict[str, list[str]] = cfg.get("imageOrders") or {}
    if order:
        orders[page] = [str(k) for k in order if k]
    else:
        orders.pop(page, None)
    cfg["imageOrders"] = dict(sorted(orders.items()))
    CONFIG.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    try:
        subprocess.run(["bash", str(INSTALL)], check=False, cwd=str(ROOT),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    return cfg["imageOrders"]


class Handler(SimpleHTTPRequestHandler):
    # Quiet down the per-request logging.
    def log_message(self, fmt: str, *args) -> None:
        return

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path not in (API_PATH, MATERIALS_PATH, ORDERS_PATH):
            self.send_error(404, "no such endpoint")
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("body must be an object")
        except Exception as e:
            self.send_error(400, f"bad json: {e}")
            return
        if path == ORDERS_PATH:
            page = str(body.get("page") or "").strip()
            order = body.get("order") or []
            if not page or not isinstance(order, list):
                self.send_error(400, "expected {page, order:[...]}")
                return
            merged = merge_image_orders(page, [str(k) for k in order])
            out = json.dumps({"ok": True, "pages": len(merged), "count": len(merged.get(page) or [])}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
            return
        # Body shapes:
        #   { "<key>": "<value>", ... }                          (source=human)
        #   { "titles"|"materials": {...}, "source": "vision"|"human" }
        wrap_key = "materials" if path == MATERIALS_PATH else "titles"
        if wrap_key in body and isinstance(body.get(wrap_key), dict):
            updates = body[wrap_key]
            source = body.get("source") or "human"
        else:
            updates = body
            source = "human"
        merger = merge_materials if path == MATERIALS_PATH else merge_image_titles
        merged = merger(
            {str(k): str(v) for k, v in updates.items()},
            source=str(source) if source else None,
        )
        out = json.dumps({"ok": True, "count": len(merged)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_DELETE(self) -> None:
        if urlsplit(self.path).path not in (API_PATH, MATERIALS_PATH, ORDERS_PATH):
            self.send_error(404, "no such endpoint")
            return
        # Server doesn't track per-browser local overrides — the client
        # already cleared its own localStorage. We just acknowledge.
        out = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(str(ROOT))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
