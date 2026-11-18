#!/usr/bin/env python3
"""Generate the YASCO ERP app icon / splash mark.

The logo is a real axonometric 3D construction (three extruded beams forming a
"Y" around a hexagonal hub), so it stays crisp at every icon size and does not
depend on an external image service.

Outputs
    assets/branding/yasco-logo.svg    vector source
    assets/branding/yasco-logo-3d.png 1024px raster (app icon source)
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

# Slight plan rotation + a slightly raised camera: a pure isometric view makes
# two of the three beams exactly edge-on, which looks flat. 12 degrees keeps the
# construction symmetric but reveals a lit side face on every beam.
ROT = math.radians(12)
COS30 = math.cos(math.radians(30))
SIN30 = 0.5
SCALE = 1.0
OX, OY = SIZE / 2, SIZE * 0.508

ARM_LEN = 272.0       # pixels, from the hub centre
ARM_HALF = 62.0       # half width of a beam
# Screen space extrusion: beams are "pulled" down-right, which is what gives
# the mark its solid, consistently lit 3D body.
EXT = (8.0, 72.0)
HUB_R = 110.0
HUB_LIFT = 20.0
HUB_EXT = (6.0, 50.0)

# Screen angles: up / lower-right / lower-left (symmetric Y).
ARMS = [-90.0, 30.0, 150.0]


def add(p, v, k=1.0):
    return (p[0] + v[0] * k, p[1] + v[1] * k)


def arm_quad(angle: float):
    a = math.radians(angle)
    ux, uy = math.cos(a), math.sin(a)
    px, py = -uy, ux
    inner = -50.0
    c = (OX, OY)
    p0 = add(c, (px * ARM_HALF + ux * inner, py * ARM_HALF + uy * inner))
    p1 = add(c, (ux * ARM_LEN + px * ARM_HALF, uy * ARM_LEN + py * ARM_HALF))
    p2 = add(c, (ux * ARM_LEN - px * ARM_HALF, uy * ARM_LEN - py * ARM_HALF))
    p3 = add(c, (-px * ARM_HALF + ux * inner, -py * ARM_HALF + uy * inner))
    return [p0, p1, p2, p3]


def poly(pts) -> str:
    return "M " + " L ".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"


def area(pts) -> float:
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        s += x1 * y2 - x2 * y1
    return s / 2


def prism_sides(quad, ext, skip=()):
    """All side quads of a prism extruded downwards by `ext`.

    The extrusion is vertical, so every side face ends up at or below the top
    face; drawing them before the top face makes the top cover exactly the part
    that should be hidden.
    """
    out = []
    for i, (a, b) in enumerate(zip(quad, quad[1:] + quad[:1])):
        if i in skip:
            continue
        ex, ey = b[0] - a[0], b[1] - a[1]
        nx, ny = ey, -ex          # outward normal for this vertex order
        out.append((nx, [a, b, add(b, ext), add(a, ext)]))
    return out


body: list[str] = []
for angle in ARMS:
    q = arm_quad(angle)
    for nx, side in prism_sides(q, EXT, skip=(3,)):
        if nx < -8:
            fill = "url(#sideLit)"
        elif nx > 8:
            fill = "url(#sideDark)"
        else:
            fill = "url(#sideMid)"
        body.append(f'<path d="{poly(side)}" fill="{fill}" stroke="#06101f" stroke-width="1.2"/>')
    body.append(f'<path d="{poly(q)}" fill="url(#topFace)" stroke="#f5b301" stroke-opacity="0.45" stroke-width="2.4"/>')

# Gold bevel rims, drawn on top of the side faces.
bevel: list[str] = []
for angle in ARMS:
    bevel.append(f'<path d="{poly(arm_quad(angle))}" fill="none" stroke="url(#goldEdge)" '
                 f'stroke-width="3.4" stroke-linejoin="round"/>')

# Hexagonal hub sitting on the junction.
hub_c = (OX, OY - HUB_LIFT)
hub_pts = [
    (hub_c[0] + math.cos(math.radians(a)) * HUB_R,
     hub_c[1] + math.sin(math.radians(a)) * HUB_R)
    for a in range(0, 360, 60)
]
hub_sides = []
for nx, side in prism_sides(hub_pts, HUB_EXT):
    fill = "#8a5800" if nx < -8 else ("#6b4300" if nx > 8 else "#7a4c00")
    hub_sides.append(f'<path d="{poly(side)}" fill="{fill}" stroke="#4a2f00" stroke-width="1.2"/>')
hub_svg = (
    "".join(hub_sides)
    + f'<path d="{poly(hub_pts)}" fill="url(#hubFace)" stroke="#7a4c00" stroke-width="2.4"/>'
    + f'<path d="{poly(hub_pts)}" fill="none" stroke="#fff3c9" stroke-opacity="0.7" stroke-width="1.6"/>'
    # inset facet, gives the cap a machined look
    + f'<path d="{poly([(hub_c[0] + math.cos(math.radians(a)) * HUB_R * 0.58, hub_c[1] + math.sin(math.radians(a)) * HUB_R * 0.58) for a in range(0, 360, 60)])}" '
      f'fill="none" stroke="#fff0bf" stroke-opacity="0.45" stroke-width="1.4"/>'
)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="80%">
      <stop offset="0%" stop-color="#1a2f58"/>
      <stop offset="52%" stop-color="#0a1428"/>
      <stop offset="100%" stop-color="#04070f"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.38"/>
      <stop offset="55%" stop-color="#1d4ed8" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#0b1730" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="topFace" gradientUnits="userSpaceOnUse" x1="300" y1="170" x2="640" y2="640">
      <stop offset="0%" stop-color="#a9c7ff"/>
      <stop offset="22%" stop-color="#d6e5ff"/>
      <stop offset="42%" stop-color="#5b8ef7"/>
      <stop offset="72%" stop-color="#2854b8"/>
      <stop offset="100%" stop-color="#123173"/>
    </linearGradient>
    <linearGradient id="sideLit" x1="0%" y1="0%" x2="60%" y2="100%">
      <stop offset="0%" stop-color="#2b57a8"/>
      <stop offset="55%" stop-color="#17366c"/>
      <stop offset="100%" stop-color="#0b1c3a"/>
    </linearGradient>
    <linearGradient id="sideMid" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e3f78"/>
      <stop offset="60%" stop-color="#0e2044"/>
      <stop offset="100%" stop-color="#081528"/>
    </linearGradient>
    <linearGradient id="sideDark" x1="0%" y1="0%" x2="60%" y2="100%">
      <stop offset="0%" stop-color="#142c55"/>
      <stop offset="60%" stop-color="#0a1830"/>
      <stop offset="100%" stop-color="#06101f"/>
    </linearGradient>
    <linearGradient id="goldEdge" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe7a0"/>
      <stop offset="42%" stop-color="#f7bf2e"/>
      <stop offset="100%" stop-color="#b47600"/>
    </linearGradient>
    <linearGradient id="hubFace" gradientUnits="userSpaceOnUse" x1="380" y1="330" x2="700" y2="700">
      <stop offset="0%" stop-color="#fff0bf"/>
      <stop offset="38%" stop-color="#f9c94f"/>
      <stop offset="100%" stop-color="#a86b00"/>
    </linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="30"/>
    </filter>
    <filter id="drop" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="38"/>
    </filter>
  </defs>

  <rect width="{SIZE}" height="{SIZE}" fill="url(#bg)"/>
  <circle cx="{SIZE/2}" cy="{SIZE*0.44}" r="{SIZE*0.40}" fill="url(#glow)"/>

  <!-- hexagonal halo -->
  <path d="M 512,214 L 782,370 L 782,682 L 512,838 L 242,682 L 242,370 Z"
        fill="none" stroke="#4d7ff0" stroke-opacity="0.20" stroke-width="2.5"/>

  <!-- contact shadow -->
  <ellipse cx="536" cy="766" rx="310" ry="56" fill="#000610" opacity="0.62" filter="url(#drop)"/>
  <ellipse cx="536" cy="752" rx="220" ry="32" fill="#2f6bff" opacity="0.16" filter="url(#soft)"/>

  <g>
    {''.join(body)}
    {''.join(bevel)}
    {hub_svg}
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
        '<style>html,body{margin:0;padding:0;background:#04070f;overflow:hidden}'
        f'svg{{display:block}}</style>{svg}',
        encoding="utf-8",
    )
    # The headless window is taller than the artwork; the extra strip is
    # cropped away below instead of relying on viewport height.
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

    # Crop to the logo square (removes Chromium's leftover strip, if any).
    convert = subprocess.run(["bash", "-lc", "command -v convert"], capture_output=True, text=True)
    if convert.stdout.strip():
        subprocess.run([
            "convert", str(png), "-crop", f"{SIZE}x{SIZE}+0+0", "+repage",
            "-background", "#04070f", "-alpha", "remove", "-alpha", "off",
            str(png),
        ], check=True)

    icon = BRAND / "yasco-logo-3d.png"
    icon.write_bytes(png.read_bytes())
    print("wrote", png, icon.stat().st_size, "bytes")


if __name__ == "__main__":
    main()