#!/usr/bin/env python3
"""Arrange the existing single-image Bilby assets without regenerating artwork."""

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
POSES = [
    ("waving", "Waving", "Welcome"),
    ("sleeping", "Sleeping", "Nighttime & unlock"),
    ("running", "Running", "Payment in progress"),
    ("searching", "Searching", "Find a friend"),
    ("reviewing", "Reviewing", "Check payment details"),
    ("gifting", "Gifting", "Gift shop"),
    ("receiving", "Receiving", "Receive & claim"),
    ("saving", "Saving", "Burrow"),
    ("organizing", "Organizing", "Saved gifts"),
    ("celebrating", "Celebrating", "Confirmed success"),
]


def font(size, weight="400Regular"):
    path = ROOT / "node_modules/@expo-google-fonts/nunito" / weight / f"Nunito_{weight}.ttf"
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default(size=size)


def make_collage(output, poses_only=False):
    assets = [(ROOT / "app/assets/bilby-poses" / f"{key}.png", title, context)
              for key, title, context in POSES]
    if not poses_only:
        assets = [(ROOT / "app/assets/bilby.webp", "Original Bilby", "Character reference")] + assets
        assets += [(ROOT / "app/assets/bilby-sprites/v2" / f"{key}-poster.png", title, "Animation still · frame 1")
                   for key, title in [("wave", "Wave"), ("run", "Run"), ("gift", "Gift wrapping"), ("album", "Album")]]

    columns, cell_w, cell_h, gap, margin, header = 5, 480, 560, 24, 64, 182
    rows = math.ceil(len(assets) / columns)
    width = margin * 2 + columns * cell_w + (columns - 1) * gap
    height = header + rows * cell_h + (rows - 1) * gap + margin
    canvas = Image.new("RGB", (width, height), "#F8F3E8")
    draw = ImageDraw.Draw(canvas)
    navy, muted = "#1C2948", "#677184"
    title_font, label_font, caption_font = font(58, "800ExtraBold"), font(31, "800ExtraBold"), font(23)
    draw.text((margin, 39), "Bilby · the illustration collection", font=title_font, fill=navy)
    subtitle = "10 page-specific poses" if poses_only else "15 individual images · original reference, 10 page poses & 4 animation stills"
    draw.text((margin + 2, 115), subtitle, font=font(27), fill=muted)

    for index, (path, label, context) in enumerate(assets):
        x = margin + (index % columns) * (cell_w + gap)
        y = header + (index // columns) * (cell_h + gap)
        draw.rounded_rectangle((x, y, x + cell_w, y + cell_h), radius=24, fill="#FFFFFF", outline="#EAE3D7", width=2)
        with Image.open(path) as source:
            art = source.convert("RGBA")
        # Trim only transparent canvas; preserve every visible pixel and the full silhouette.
        bounds = art.getchannel("A").getbbox()
        if bounds:
            art = art.crop(bounds)
        art.thumbnail((cell_w - 52, cell_h - 138), Image.Resampling.LANCZOS)
        art_x = x + (cell_w - art.width) // 2
        art_y = y + 22 + (cell_h - 138 - art.height) // 2
        canvas.paste(art, (art_x, art_y), art)
        draw.text((x + cell_w // 2, y + cell_h - 84), label, font=label_font, fill=navy, anchor="mt")
        draw.text((x + cell_w // 2, y + cell_h - 42), context, font=caption_font, fill=muted, anchor="mt")

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True)
    print(f"{output}: {width} × {height}, {len(assets)} images")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "reports/bilby-collage/bilby-all-images.png")
    parser.add_argument("--poses-only", action="store_true")
    args = parser.parse_args()
    make_collage(args.output, args.poses_only)
