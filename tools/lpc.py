"""Reader for the Universal LPC Spritesheet Character Generator catalogue.

The generator publishes one HTML page in which every selectable part is an
<input> tag carrying its layer paths, z positions, authors, licences and source
URLs. Parsing that page gives us both the artwork and the attribution data in a
single pass, so credits can never drift away from the files we actually ship.
"""

from __future__ import annotations

import os
import re
import urllib.error
import urllib.request

REPO = "https://raw.githubusercontent.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator/master"
INDEX_URL = f"{REPO}/index.html"
SPRITE_BASE = f"{REPO}/spritesheets/"

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
INDEX_CACHE = os.path.join(CACHE, "generator_index.html")

# Classic LPC universal sheet: 13 columns of 64px, 21 rows of 64px.
FRAME = 64
SHEET_COLUMNS = 13

# Row index per animation and facing. Facing order inside each block is
# up, left, down, right.
ANIMATION_ROWS = {
    "cast": {"up": 0, "left": 1, "down": 2, "right": 3},
    "thrust": {"up": 4, "left": 5, "down": 6, "right": 7},
    "walk": {"up": 8, "left": 9, "down": 10, "right": 11},
    "slash": {"up": 12, "left": 13, "down": 14, "right": 15},
    "shoot": {"up": 16, "left": 17, "down": 18, "right": 19},
    "collapse": {"up": 20, "left": 20, "down": 20, "right": 20},
}

ANIMATION_FRAMES = {
    "cast": 7,
    "thrust": 8,
    "walk": 9,
    "slash": 6,
    "shoot": 13,
    "collapse": 6,
}

_ATTR = re.compile(r'([A-Za-z0-9_\-]+)="([^"]*)"')
_BARE = re.compile(r'([A-Za-z0-9_\-]+)=([0-9]+)(?=[\s>])')
_LAYER = re.compile(r"data-layer_(\d+)_([a-z_]+)$")


def _download(url: str, dest: str) -> str:
    if os.path.exists(dest) and os.path.getsize(dest) > 128:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "alacakuyu-asset-build"})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = response.read()
    with open(dest, "wb") as handle:
        handle.write(payload)
    return dest


def load_catalogue() -> dict:
    """Return every generator entry keyed by its element id."""
    _download(INDEX_URL, INDEX_CACHE)
    with open(INDEX_CACHE, encoding="utf-8", errors="replace") as handle:
        page = handle.read()

    catalogue = {}
    for tag in re.findall(r'<input type="radio"[^>]*>', page):
        entry = {}
        for match in _ATTR.finditer(tag):
            entry[match.group(1)] = match.group(2)
        for match in _BARE.finditer(tag):
            entry.setdefault(match.group(1), match.group(2))
        if "id" in entry:
            catalogue[entry["id"]] = entry
    return catalogue


def body_types(entry: dict) -> set:
    found = set()
    for key in entry:
        match = _LAYER.match(key)
        if match:
            found.add(match.group(2))
    return found


def layers(entry: dict, body: str) -> list:
    """Layers of one part for one body type, sorted back to front."""
    available = body_types(entry)
    if body not in available:
        for fallback in ("male", "female", "muscular", "teen", "child"):
            if fallback in available:
                body = fallback
                break
        else:
            return []

    found = []
    for key, path in entry.items():
        match = _LAYER.match(key)
        if not match or match.group(2) != body:
            continue
        index = match.group(1)
        found.append(
            {
                "order": int(index),
                "path": path,
                "z": int(entry.get(f"data-layer_{index}_zpos", 100)),
                "authors": entry.get(f"data-layer_{index}_{body}_authors", ""),
                "licenses": entry.get(f"data-layer_{index}_{body}_licenses", ""),
                "urls": entry.get(f"data-layer_{index}_{body}_urls", ""),
                "notes": entry.get(f"data-layer_{index}_{body}_notes", ""),
            }
        )
    return sorted(found, key=lambda layer: (layer["z"], layer["order"]))


def sprite_file(path: str) -> str:
    try:
        return _download(SPRITE_BASE + path, os.path.join(CACHE, "spritesheets", path))
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        # A few families in the generator index are written with the body-size
        # folder glued to the variant name, e.g. hat/cloth/hood/adultwhite.png
        # where the file really is hat/cloth/hood/adult/white.png.
        repaired = re.sub(r"/(adult|child|teen|muscular)([a-z0-9_]+\.png)$", r"/\1/\2", path)
        if repaired == path:
            raise
        return _download(SPRITE_BASE + repaired, os.path.join(CACHE, "spritesheets", repaired))
