#!/usr/bin/env python3
"""Fetch and prepare every asset the game ships.

Nothing here is drawn, recorded or generated: character sheets are composited
from the Liberated Pixel Cup libraries, dungeon tiles come from the CC0 export
of Dungeon Crawl Stone Soup, interface icons come from game-icons.net, sound
effects come from Kenney's CC0 audio packs, and the typefaces are Open Font
Licence families pulled once and served locally.

Every fetched file records its authors, licence and source URL; those records
are written to src/data/credits.json and ASSETS.md, which is what the in-game
credits screen reads.

    python3 tools/build_assets.py            # everything
    python3 tools/build_assets.py sprites    # one stage
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

from PIL import Image

import lpc
from roster import ENEMIES, HEROES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public", "assets")
DATA = os.path.join(ROOT, "src", "data")
CACHE = lpc.CACHE

CRAWL_TILES = "https://raw.githubusercontent.com/crawl/crawl/master/crawl-ref/source/rltiles/"
CRAWL_EXCLUSIONS = "https://raw.githubusercontent.com/crawl/tiles/master/TILES_UNDER_UNKNOWN_LICENSE.md"
GAME_ICONS = "https://raw.githubusercontent.com/game-icons/icons/master/"
GOOGLE_FONTS = "https://fonts.googleapis.com/css2"

BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Collected while building; flushed to disk at the end.
CREDITS: dict[str, dict] = {}


_LICENCE_SHAPE = re.compile(r"^(CC0|CC[- ]BY|OGA[- ]BY|GPL|SIL|MIT|Public domain)", re.I)


def record(source: str, authors, licenses, urls, used_by: str, notes: str = "") -> None:
    def split(value):
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return [part for part in value if part]

    # Some upstream records put remarks in the licence field. Keep the licence
    # list to actual licences and push the rest into notes.
    licence_list = split(licenses)
    remarks = [item for item in licence_list if not _LICENCE_SHAPE.match(item)]
    licence_list = [item for item in licence_list if _LICENCE_SHAPE.match(item)]
    if remarks:
        notes = "; ".join(filter(None, [notes] + remarks))

    licenses = licence_list

    entry = CREDITS.setdefault(
        source,
        {
            "source": source,
            "authors": split(authors),
            "licenses": split(licenses),
            "urls": split(urls),
            "notes": notes,
            "usedBy": [],
        },
    )
    if used_by not in entry["usedBy"]:
        entry["usedBy"].append(used_by)


def download(url: str, dest: str, browser: bool = False) -> str:
    if os.path.exists(dest) and os.path.getsize(dest) > 64:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    headers = {"User-Agent": BROWSER_UA if browser else "alacakuyu-asset-build"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=180) as response:
        payload = response.read()
    with open(dest, "wb") as handle:
        handle.write(payload)
    return dest


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": BROWSER_UA}), timeout=120
    ) as response:
        return response.read().decode("utf-8", "replace")


# --------------------------------------------------------------------------
# character sheets
# --------------------------------------------------------------------------


def build_sprites() -> dict:
    catalogue = lpc.load_catalogue()
    out_dir = os.path.join(PUBLIC, "sprites")
    os.makedirs(out_dir, exist_ok=True)

    manifest = {}
    missing = []

    for kind, roster in (("hero", HEROES), ("enemy", ENEMIES)):
        for name, definition in roster.items():
            body = definition["body"]
            facing = definition["facing"]

            stack = []
            # Every fighter stands on the LPC drop shadow so they sit on the floor
            # rather than float over it.
            for part_id in ["shadow-Shadow_shadow", *definition["parts"]]:
                entry = catalogue.get(part_id)
                if entry is None:
                    missing.append(f"{name}: {part_id}")
                    continue
                for layer in lpc.layers(entry, body):
                    stack.append((layer["z"], layer["order"], part_id, layer))
            stack.sort(key=lambda item: (item[0], item[1]))

            full = Image.new("RGBA", (lpc.SHEET_COLUMNS * lpc.FRAME, 21 * lpc.FRAME))
            for _z, _order, part_id, layer in stack:
                path = layer["path"]
                try:
                    sheet = Image.open(lpc.sprite_file(path)).convert("RGBA")
                except Exception as error:  # noqa: BLE001 - report and carry on
                    missing.append(f"{name}: {path} ({error})")
                    continue
                # Animation-specific sheets use their own geometry; the classic
                # 21-row universal sheets are the ones that line up here.
                if sheet.width != lpc.SHEET_COLUMNS * lpc.FRAME or sheet.height < 21 * lpc.FRAME:
                    continue
                full.alpha_composite(sheet.crop((0, 0, full.width, full.height)))
                record(path, layer["authors"], layer["licenses"], layer["urls"], f"{kind}:{name}", layer["notes"])

            animations = {"idle": "walk", "walk": "walk", "attack": definition["attack"], "collapse": "collapse"}
            animations.update(definition.get("extra_anims", {}))

            rows = []
            meta = {}
            for label, source_animation in animations.items():
                if label == "idle":
                    continue
                row = lpc.ANIMATION_ROWS[source_animation][facing]
                meta[label] = {
                    "row": len(rows),
                    "frames": lpc.ANIMATION_FRAMES[source_animation],
                }
                rows.append(row)

            sheet_out = Image.new("RGBA", (lpc.SHEET_COLUMNS * lpc.FRAME, len(rows) * lpc.FRAME))
            for index, row in enumerate(rows):
                strip = full.crop((0, row * lpc.FRAME, full.width, row * lpc.FRAME + lpc.FRAME))
                sheet_out.paste(strip, (0, index * lpc.FRAME))

            file_name = f"{name}.png"
            sheet_out.save(os.path.join(out_dir, file_name))
            manifest[name] = {
                "kind": kind,
                "file": f"assets/sprites/{file_name}",
                "frame": lpc.FRAME,
                "facing": facing,
                "animations": meta,
            }
            print(f"  sprite {name:<12} layers={len(stack):<3} rows={len(rows)}")

    if missing:
        print("\n  unresolved parts:")
        for item in missing:
            print(f"    {item}")

    return manifest


# --------------------------------------------------------------------------
# dungeon tiles
# --------------------------------------------------------------------------

ZONE_TILES = {
    "cellars": {
        "wall": ["dngn/wall/brick_brown0.png", "dngn/wall/brick_brown2.png", "dngn/wall/brick_brown5.png"],
        "floor": ["dngn/floor/pebble_brown0.png", "dngn/floor/pebble_brown3.png", "dngn/floor/pebble_brown6.png"],
    },
    "catacombs": {
        "wall": ["dngn/wall/brick_dark_2_0.png", "dngn/wall/brick_dark_2_4.png", "dngn/wall/brick_dark_2_9.png"],
        "floor": ["dngn/floor/crypt0.png", "dngn/floor/crypt3.png", "dngn/floor/crypt7.png"],
    },
    "warrens": {
        "wall": ["dngn/wall/brick_dark_4_0.png", "dngn/wall/brick_dark_4_6.png", "dngn/wall/brick_dark_4_11.png"],
        "floor": ["dngn/floor/mud0.png", "dngn/floor/mud1.png", "dngn/floor/mud2.png"],
    },
    "seam": {
        "wall": ["dngn/wall/brick_dark_5_0.png", "dngn/wall/brick_dark_5_7.png", "dngn/wall/brick_dark_5_12.png"],
        "floor": ["dngn/floor/crystal_floor0.png", "dngn/floor/crystal_floor2.png", "dngn/floor/crystal_floor5.png"],
    },
    "maw": {
        "wall": ["dngn/wall/brick_dark_3_0.png", "dngn/wall/brick_dark_3_5.png", "dngn/wall/brick_dark_3_13.png"],
        "floor": ["dngn/floor/demonic_red1.png", "dngn/floor/demonic_red4.png", "dngn/floor/demonic_red8.png"],
    },
}

TILE_CREDIT = {
    "authors": ["Dungeon Crawl Stone Soup contributors"],
    "licenses": ["CC0 1.0"],
    "urls": [
        "https://github.com/crawl/tiles",
        "https://opengameart.org/content/dungeon-crawl-32x32-tiles",
    ],
    "notes": "Tiles released to the public domain by the artists listed in crawl/tiles ARTISTS.md.",
}


def build_tiles() -> dict:
    excluded = set()
    for line in fetch_text(CRAWL_EXCLUSIONS).splitlines():
        match = re.match(r"-\s+(\S+\.png)", line.strip())
        if match:
            excluded.add(match.group(1))

    out_dir = os.path.join(PUBLIC, "tiles")
    os.makedirs(out_dir, exist_ok=True)
    manifest = {}

    for zone, groups in ZONE_TILES.items():
        zone_manifest = {}
        for group, paths in groups.items():
            kept = []
            for path in paths:
                base = os.path.basename(path)
                if base in excluded:
                    print(f"  skipped {base}: listed under unclear licence")
                    continue
                try:
                    cached = download(CRAWL_TILES + path, os.path.join(CACHE, "crawl", path))
                except Exception as error:  # noqa: BLE001
                    print(f"  missing tile {path}: {error}")
                    continue
                target_name = f"{zone}_{group}_{len(kept)}.png"
                Image.open(cached).convert("RGBA").save(os.path.join(out_dir, target_name))
                kept.append(f"assets/tiles/{target_name}")
                record(
                    f"crawl/{path}",
                    TILE_CREDIT["authors"],
                    TILE_CREDIT["licenses"],
                    TILE_CREDIT["urls"],
                    f"zone:{zone}",
                    TILE_CREDIT["notes"],
                )
            zone_manifest[group] = kept
        manifest[zone] = zone_manifest
        print(f"  zone {zone:<10} wall={len(zone_manifest['wall'])} floor={len(zone_manifest['floor'])}")

    return manifest


# --------------------------------------------------------------------------
# sound
# --------------------------------------------------------------------------

KENNEY_RPG = "https://raw.githubusercontent.com/Boyquotes/kenney-rpg-audio-for-godot/main/addons/kenney%20rpg%20audio/"
KENNEY_UI = "https://raw.githubusercontent.com/Calinou/kenney-ui-audio/master/addons/kenney_ui_audio/"

KENNEY_CREDIT = {
    "authors": ["Kenney"],
    "licenses": ["CC0 1.0"],
    "urls": ["https://kenney.nl/assets/rpg-audio", "https://kenney.nl/assets/ui-audio"],
    "notes": "Kenney's RPG Audio and UI Audio packs, both released to the public domain.",
}

# Cue name to source files. Several files per cue means the player picks one at
# random, so repeated hits do not sound like a loop.
SOUNDS = {
    "strike": [(KENNEY_RPG, "chop.ogg"), (KENNEY_RPG, "knife_slice.ogg"), (KENNEY_RPG, "knife_slice_2.ogg")],
    "clank": [(KENNEY_RPG, "metal_pot_1.ogg"), (KENNEY_RPG, "metal_pot_2.ogg"), (KENNEY_RPG, "metal_pot_3.ogg")],
    "draw": [(KENNEY_RPG, "draw_knife_1.ogg"), (KENNEY_RPG, "draw_knife_2.ogg"), (KENNEY_RPG, "draw_knife_3.ogg")],
    "step": [(KENNEY_RPG, "footstep_2.ogg"), (KENNEY_RPG, "footstep_5.ogg"), (KENNEY_RPG, "footstep_8.ogg")],
    "loot": [(KENNEY_RPG, "handle_small_leather.ogg"), (KENNEY_RPG, "handle_small_leather_2.ogg")],
    "coins": [(KENNEY_RPG, "handle_coins.ogg"), (KENNEY_RPG, "handle_coins_2.ogg")],
    "gate": [(KENNEY_RPG, "door_open_1.ogg")],
    "rout": [(KENNEY_RPG, "door_close_4.ogg")],
    "rope": [(KENNEY_RPG, "creak_2.ogg")],
    "keeper": [(KENNEY_RPG, "metal_latch.ogg")],
    "buy": [(KENNEY_RPG, "metal_click.ogg")],
    "rank": [(KENNEY_RPG, "book_place_1.ogg")],
    "leaf": [(KENNEY_RPG, "book_open.ogg")],
    "click": [(KENNEY_UI, "click1.wav")],
}


def build_sounds() -> dict:
    out_dir = os.path.join(PUBLIC, "sound")
    os.makedirs(out_dir, exist_ok=True)
    manifest = {}

    for cue, sources in SOUNDS.items():
        kept = []
        for base, name in sources:
            try:
                cached = download(base + name, os.path.join(CACHE, "sound", name))
            except Exception as error:  # noqa: BLE001
                print(f"  missing sound {name}: {error}")
                continue
            target = f"{cue}_{len(kept)}{os.path.splitext(name)[1]}"
            with open(cached, "rb") as source, open(os.path.join(out_dir, target), "wb") as destination:
                destination.write(source.read())
            kept.append(f"assets/sound/{target}")
            record(
                f"kenney/{name}",
                KENNEY_CREDIT["authors"],
                KENNEY_CREDIT["licenses"],
                KENNEY_CREDIT["urls"],
                f"sound:{cue}",
                KENNEY_CREDIT["notes"],
            )
        if kept:
            manifest[cue] = kept

    print(f"  sounds {len(manifest)} cues, {sum(len(v) for v in manifest.values())} files")
    return manifest


# --------------------------------------------------------------------------
# interface icons
# --------------------------------------------------------------------------

ICONS = {
    "blade": "lorc/broadsword",
    "wound": "lorc/sword-wound",
    "guard": "sbed/shield",
    "vitals": "skoll/hearts",
    "swords": "lorc/crossed-swords",
    "bow": "lorc/bowman",
    "magus": "delapouite/wizard-face",
    "faith": "lorc/holy-symbol",
    "helm": "sbed/helmet",
    "coin": "delapouite/two-coins",
    "ingot": "willdabeast/gold-bar",
    "stone": "lorc/stone-block",
    "shard": "lorc/crystal-cluster",
    "descend": "delapouite/stairs",
    "ascend": "lorc/return-arrow",
    "camp": "lorc/campfire",
    "gate": "delapouite/dungeon-gate",
    "death": "lorc/skull-crack",
    "grave": "lorc/tombstone",
    "gear": "lorc/battle-gear",
    "talent": "delapouite/skills",
    "upgrade": "delapouite/upgrade",
    "settings": "lorc/cog",
    "ledger": "lorc/scroll-unfurled",
    "satchel": "delapouite/backpack",
    "hoard": "delapouite/chest",
    "spell": "lorc/magic-swirl",
    "ember": "sbed/fire",
    "relic": "lorc/spiral-arrow",
    "rank": "skoll/rank-3",
    "pick": "lorc/mining",
    "fang": "lorc/wolf-head",
    "tusk": "delapouite/orc-head",
    "bone": "lorc/bone-knife",
    "crystal": "lorc/crystal-shine",
}

ICON_CREDIT_URLS = "https://game-icons.net/,https://github.com/game-icons/icons"


def build_icons() -> dict:
    out_dir = os.path.join(PUBLIC, "icons")
    os.makedirs(out_dir, exist_ok=True)
    manifest = {}
    glyphs: dict[str, str] = {}

    for name, path in ICONS.items():
        author = path.split("/")[0]
        try:
            cached = download(GAME_ICONS + path + ".svg", os.path.join(CACHE, "icons", path + ".svg"))
        except Exception as error:  # noqa: BLE001
            print(f"  missing icon {path}: {error}")
            continue
        with open(cached, encoding="utf-8") as handle:
            svg = handle.read()
        with open(os.path.join(out_dir, f"{name}.svg"), "w", encoding="utf-8") as handle:
            handle.write(svg)

        # game-icons ships each glyph as a white shape on a black plate. Drop the
        # plate and let the shape take the surrounding text colour; the artwork
        # itself is untouched.
        inner = re.sub(r'<svg[^>]*>|</svg>', "", svg).strip()
        inner = inner.replace('<path d="M0 0h512v512H0z"/>', "")
        inner = inner.replace('fill="#fff"', 'fill="currentColor"')
        glyphs[name] = inner
        manifest[name] = f"assets/icons/{name}.svg"
        record(
            f"game-icons/{path}.svg",
            [author],
            ["CC BY 3.0"],
            ICON_CREDIT_URLS,
            f"icon:{name}",
            "Icon from game-icons.net.",
        )

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "icons.json"), "w", encoding="utf-8") as handle:
        json.dump(glyphs, handle, ensure_ascii=False, indent=0)

    print(f"  icons {len(manifest)}")
    return manifest


# --------------------------------------------------------------------------
# typefaces
# --------------------------------------------------------------------------

FONTS = [
    ("Grenze Gotisch", "wght@400;600", "grenze-gotisch"),
    ("Grenze", "ital,wght@0,400;0,600;1,400", "grenze"),
    ("Fragment Mono", "ital@0;1", "fragment-mono"),
]

FONT_CREDITS = {
    "Grenze Gotisch": ("Omnibus-Type", "SIL Open Font License 1.1", "https://fonts.google.com/specimen/Grenze+Gotisch"),
    "Grenze": ("Omnibus-Type", "SIL Open Font License 1.1", "https://fonts.google.com/specimen/Grenze"),
    "Fragment Mono": ("Wei Huang", "SIL Open Font License 1.1", "https://fonts.google.com/specimen/Fragment+Mono"),
}


def build_fonts() -> None:
    out_dir = os.path.join(PUBLIC, "fonts")
    os.makedirs(out_dir, exist_ok=True)
    css_parts = ["/* Generated by tools/build_assets.py. Fonts served locally, no outside requests. */"]

    for family, axis, slug in FONTS:
        query = f"{GOOGLE_FONTS}?family={family.replace(' ', '+')}:{axis}&display=swap"
        css = fetch_text(query)
        blocks = re.findall(r"/\*\s*([a-z\-]+)\s*\*/\s*(@font-face\s*\{.*?\})", css, re.S)
        if not blocks:
            print(f"  no faces returned for {family}")
            continue
        kept = 0
        for subset, block in blocks:
            if subset not in ("latin", "latin-ext"):
                continue
            url_match = re.search(r"url\((https://[^)]+\.woff2)\)", block)
            if not url_match:
                continue
            style = "italic" if "font-style: italic" in block else "normal"
            weight_match = re.search(r"font-weight:\s*([0-9]+)", block)
            weight = weight_match.group(1) if weight_match else "400"
            file_name = f"{slug}-{weight}-{style}-{subset}.woff2"
            download(url_match.group(1), os.path.join(out_dir, file_name), browser=True)
            range_match = re.search(r"unicode-range:\s*([^;]+);", block)
            css_parts.append(
                "@font-face {\n"
                f"  font-family: '{family}';\n"
                f"  font-style: {style};\n"
                f"  font-weight: {weight};\n"
                "  font-display: swap;\n"
                f"  src: url('./{file_name}') format('woff2');\n"
                + (f"  unicode-range: {range_match.group(1)};\n" if range_match else "")
                + "}"
            )
            kept += 1
        author, licence, url = FONT_CREDITS[family]
        record(f"font/{family}", [author], [licence], url, "typeface", "Served from the game's own files.")
        print(f"  font {family:<16} faces={kept}")

    with open(os.path.join(out_dir, "fonts.css"), "w", encoding="utf-8") as handle:
        handle.write("\n\n".join(css_parts) + "\n")


# --------------------------------------------------------------------------
# credits
# --------------------------------------------------------------------------


def write_credits() -> None:
    os.makedirs(DATA, exist_ok=True)
    entries = sorted(CREDITS.values(), key=lambda item: item["source"])
    with open(os.path.join(DATA, "credits.json"), "w", encoding="utf-8") as handle:
        json.dump(entries, handle, ensure_ascii=False, indent=1)

    groups: dict[str, list] = {}
    for entry in entries:
        if entry["source"].startswith("crawl/"):
            key = "Dungeon tiles"
        elif entry["source"].startswith("game-icons/"):
            key = "Interface icons"
        elif entry["source"].startswith("kenney/"):
            key = "Sound"
        elif entry["source"].startswith("font/"):
            key = "Typefaces"
        else:
            key = "Character art"
        groups.setdefault(key, []).append(entry)

    lines = [
        "# Assets",
        "",
        "Every image and typeface in this repository was made by someone else and is",
        "used under an open licence. Nothing was drawn for this project. The list below",
        "is generated by `tools/build_assets.py` from the metadata that ships with each",
        "source, so it stays honest as the asset set changes.",
        "",
    ]
    for group, group_entries in groups.items():
        lines.append(f"## {group}")
        lines.append("")
        if group == "Character art":
            lines.append(
                "Composited from the Liberated Pixel Cup character libraries via the "
                "Universal LPC Spritesheet Character Generator."
            )
            lines.append("")
        seen = set()
        for entry in group_entries:
            authors = ", ".join(entry["authors"]) or "unattributed"
            licences = ", ".join(entry["licenses"])
            key = (authors, licences, tuple(entry["urls"][:1]))
            if group == "Character art" and key in seen:
                continue
            seen.add(key)
            url = entry["urls"][0] if entry["urls"] else ""
            lines.append(f"- **{entry['source']}** - {authors} - {licences}" + (f" - <{url}>" if url else ""))
        lines.append("")

    lines += [
        "## Share-alike",
        "",
        "Parts of the character art are licensed CC BY-SA 3.0 or GPL 3.0. The composited",
        "spritesheets in `public/assets/sprites` are therefore distributed under",
        "CC BY-SA 3.0. Game code in `src` is MIT licensed and can be reused freely.",
        "",
    ]

    with open(os.path.join(ROOT, "ASSETS.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))

    print(f"  credits {len(entries)} sources")


def main() -> None:
    all_stages = ["sprites", "tiles", "sounds", "icons", "fonts"]
    stages = sys.argv[1:] or all_stages
    manifest_path = os.path.join(DATA, "assets.json")
    credits_path = os.path.join(DATA, "credits.json")

    if set(stages) != set(all_stages) and os.path.exists(credits_path):
        # Partial run: keep the records the other stages wrote last time.
        with open(credits_path, encoding="utf-8") as handle:
            for entry in json.load(handle):
                CREDITS[entry["source"]] = entry

    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)

    if "sprites" in stages:
        print("sprites")
        manifest["sprites"] = build_sprites()
    if "tiles" in stages:
        print("tiles")
        manifest["zones"] = build_tiles()
    if "sounds" in stages:
        print("sounds")
        manifest["sounds"] = build_sounds()
    if "icons" in stages:
        print("icons")
        manifest["icons"] = build_icons()
    if "fonts" in stages:
        print("fonts")
        build_fonts()

    print("credits")
    os.makedirs(DATA, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=1)
    write_credits()


if __name__ == "__main__":
    main()
