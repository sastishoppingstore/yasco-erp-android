#!/usr/bin/env python3
"""Generate the YASCO ERP app icon / splash mark.

The mark is a real 3D construction: three extruded, rounded beams forming a
"Y" around a machined gold hexagon.  Everything is drawn as vector geometry and
rasterised with the Chromium that is already on the machine, so the icon stays
crisp at every launcher size and does not depend on an image service.

Outputs
    assets/branding/yasco-logo.svg    vector source
    assets/branding/yasco-logo-3d.png 1024px raster (app icon source)
    assets/branding/splash-512.png    512px raster (native splash)
    public/splash-logo.png            1024px raster (in-app splash)
"""
from __future__ import annotations

import math
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "branding"
SIZE = 1024

# --- geometry -------------------------------------------------------------
OX, OY = SIZE / 2, SIZE * 0.492
ARM_LEN = 252.0          # centre -> tip, in pixels
BEAM_W = 112.0           # top face width
GOLD_W = 124.0           # width of the gilded edge under the top face
DEPTH = 74               # extrusion, pixels
STEPS = 37               # extrusion slices (2 px each)
HUB_R = 103.0
HUB_DEPTH = 16
HUB_STEPS = 23

ARMS = (-90.0, 30.0, 150.0)


def pt(angle: float, length: float):
    a = math.radians(angle)
    return OX + math.cos(a) * length, OY + math.sin(a) * length


def line(angle: float, length: float = ARM_LEN) -> str:
    x, y = pt(angle, length)
    return f"M {OX:.2f},{OY:.2f} L {x:.2f},{y:.2f}"


def hexagon(radius: float, cx: float = OX, cy: float = OY) -> str:
    pts = [
        (cx + math.cos(math.radians(a)) * radius, cy + math.sin(math.radians(a)) * radius)
        for a in range(-30, 330, 60)
    ]
    return "M " + " L ".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"


# --- extrusion layers -----------------------------------------------------
def extrude(path: str, width: float, fill: str, depth: int, steps: int,
            dx: float = 34.0, dy: float = 76.0) -> str:
    """Stack copies of `path` along (dx, dy) to fake a solid extruded body.

    The offset is diagonal (light falls from the top-left), so the visible side
    wall sits on the lower-right of every beam. That is what makes the mark
    read as 3D instead of as a flat sticker.
    """
    out = []
    x_step, y_step = dx / steps, dy / steps
    for i in range(steps, 0, -1):
        out.append(
            f'<path d="{path}" fill="none" stroke="{fill}" stroke-width="{width:.1f}" '
            f'stroke-linecap="round" stroke-linejoin="round" '
            f'transform="translate({i * x_step:.2f} {i * y_step:.2f})"/>'
        )
    return "".join(out)


beams = "".join(line(a) for a in ARMS)

body = []
# gold silhouette, extruded
body.append(extrude(beams, GOLD_W, "url(#bodySide)", DEPTH, STEPS))
# hexagonal hub body, extruded (drawn before the beams so the beams overlap it)
body.append(
    f'<g transform="translate(8 {HUB_DEPTH})">'
    f'<path d="{hexagon(HUB_R)}" fill="url(#hubSide)"/>'
    "</g>"
)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="32%" r="82%">
      <stop offset="0%" stop-color="#1d3563"/>
      <stop offset="46%" stop-color="#0b1730"/>
      <stop offset="100%" stop-color="#03060d"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.40"/>
      <stop offset="52%" stop-color="#1d4ed8" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#0b1730" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="beamTop" gradientUnits="userSpaceOnUse" x1="300" y1="180" x2="700" y2="760">
      <stop offset="0%" stop-color="#dcebff"/>
      <stop offset="16%" stop-color="#9dc2ff"/>
      <stop offset="38%" stop-color="#5c92f8"/>
      <stop offset="68%" stop-color="#2c57be"/>
      <stop offset="100%" stop-color="#16357c"/>
    </linearGradient>
    <linearGradient id="goldTop" gradientUnits="userSpaceOnUse" x1="330" y1="240" x2="700" y2="720">
      <stop offset="0%" stop-color="#fff3c4"/>
      <stop offset="22%" stop-color="#ffd977"/>
      <stop offset="52%" stop-color="#f2b62a"/>
      <stop offset="78%" stop-color="#c98a10"/>
      <stop offset="100%" stop-color="#8f5f05"/>
    </linearGradient>
    <linearGradient id="goldSide" gradientUnits="userSpaceOnUse" x1="0" y1="240" x2="0" y2="900">
      <stop offset="0%" stop-color="#b8811a"/>
      <stop offset="22%" stop-color="#7d5206"/>
      <stop offset="55%" stop-color="#3f2700"/>
      <stop offset="100%" stop-color="#120b00"/>
    </linearGradient>
    <linearGradient id="bodySide" gradientUnits="userSpaceOnUse" x1="0" y1="250" x2="0" y2="900">
      <stop offset="0%" stop-color="#4a78d4"/>
      <stop offset="14%" stop-color="#2a4c92"/>
      <stop offset="46%" stop-color="#122750"/>
      <stop offset="100%" stop-color="#050a14"/>
    </linearGradient>
    <linearGradient id="hubSide" gradientUnits="userSpaceOnUse" x1="0" y1="430" x2="0" y2="700">
      <stop offset="0%" stop-color="#8a5c06"/>
      <stop offset="55%" stop-color="#4d3200"/>
      <stop offset="100%" stop-color="#1c1100"/>
    </linearGradient>
    <linearGradient id="hubTop" gradientUnits="userSpaceOnUse" x1="410" y1="300" x2="660" y2="640">
      <stop offset="0%" stop-color="#fffaf0"/>
      <stop offset="26%" stop-color="#ffe49b"/>
      <stop offset="58%" stop-color="#f6bf35"/>
      <stop offset="100%" stop-color="#b2790a"/>
    </linearGradient>
    <linearGradient id="glass" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="52%" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-45%" y="-45%" width="190%" height="190%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="drop" x="-45%" y="-45%" width="190%" height="190%">
      <feGaussianBlur stdDeviation="34"/>
    </filter>
  </defs>

  <rect width="{SIZE}" height="{SIZE}" fill="url(#bg)"/>
  <circle cx="{SIZE/2:.0f}" cy="{SIZE*0.43:.0f}" r="{SIZE*0.43:.0f}" fill="url(#halo)"/>

  <!-- hexagonal halo -->
  <path d="{hexagon(392, SIZE/2, SIZE*0.49)}" fill="none"
        stroke="#5b8cff" stroke-opacity="0.20" stroke-width="2.4"/>

  <!-- contact shadow -->
  <ellipse cx="{OX + 14:.0f}" cy="{OY + DEPTH + 92:.0f}" rx="300" ry="62"
           fill="#000409" opacity="0.66" filter="url(#drop)"/>
  <ellipse cx="{OX + 14:.0f}" cy="{OY + DEPTH + 74:.0f}" rx="214" ry="34"
           fill="#2f6bff" opacity="0.16" filter="url(#soft)"/>

  <g>
    {''.join(body)}

    <!-- beams: gilded edge + blue top face -->
    <g stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="{beams}" stroke="url(#goldTop)" stroke-width="{GOLD_W}"/>
      <path d="{beams}" stroke="url(#beamTop)" stroke-width="{BEAM_W}"/>
    </g>

    <!-- hexagonal hub -->
    <path d="{hexagon(HUB_R)}" fill="url(#hubSide)"/>
    <path d="{hexagon(HUB_R)}" fill="url(#hubTop)" stroke="#6d4704" stroke-width="2"/>
    <path d="{hexagon(HUB_R * 0.82)}" fill="none" stroke="#fff8e2"
          stroke-opacity="0.62" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="{hexagon(HUB_R * 0.46)}" fill="none" stroke="#8a5c06"
          stroke-opacity="0.35" stroke-width="2"/>
    <path d="M {OX - HUB_R * 0.44:.1f},{OY - HUB_R * 0.34:.1f}
             L {OX + HUB_R * 0.10:.1f},{OY - HUB_R * 0.62:.1f}
             L {OX + HUB_R * 0.52:.1f},{OY - HUB_R * 0.10:.1f}"
          fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="10"
          stroke-linecap="round" filter="url(#soft)"/>

  </g>
</svg>
'''


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    svg_path = BRAND / "yasco-logo.svg"
    svg_path.write_text(svg, encoding="utf-8")
    print("wrote", svg_path)

    chrome = sorted(
        (pathlib.Path.home() / ".cache" / "ms-playwright").glob("chromium-*/chrome-linux/chrome")
    )
    png = ROOT / "public" / "splash-logo.png"
    if not chrome:
        print("Chromium not found; only the SVG was written", file=sys.stderr)
        return

    html = BRAND / "render.html"
    html.write_text(
        '<!doctype html><meta charset="utf-8">'
        '<style>html,body{margin:0;padding:0;background:#03060d;overflow:hidden}'
        "svg{display:block}</style>" + svg,
        encoding="utf-8",
    )
    subprocess.run(
        [
            str(chrome[-1]), "--headless", "--no-sandbox", "--disable-gpu",
            "--hide-scrollbars", "--force-device-scale-factor=1",
            f"--window-size={SIZE},{SIZE + 120}",
            f"--screenshot={png}", html.as_uri(),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    html.unlink(missing_ok=True)

    has_convert = subprocess.run(
        ["bash", "-lc", "command -v convert"], capture_output=True, text=True
    ).stdout.strip()
    if has_convert:
        subprocess.run(
            [
                "convert", str(png), "-crop", f"{SIZE}x{SIZE}+0+0", "+repage",
                "-background", "#03060d", "-alpha", "remove", "-alpha", "off", str(png),
            ],
            check=True,
        )
        subprocess.run(
            ["convert", str(png), "-resize", "512x512", str(BRAND / "splash-512.png")],
            check=True,
        )

    icon = BRAND / "yasco-logo-3d.png"
    icon.write_bytes(png.read_bytes())
    print("wrote", png, icon.stat().st_size, "bytes")


if __name__ == "__main__":
    main()