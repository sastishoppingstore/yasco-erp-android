#!/usr/bin/env python3
"""Regenerate every launcher icon from the single 1024px brand artwork.

`npx tauri icon` needs node_modules; this script only needs ImageMagick, so the
icon set can always be rebuilt from `assets/branding/yasco-logo-3d.png`.

Android adaptive icons are written the way the platform expects them:
    ic_launcher_foreground.png  transparent canvas, artwork centred at ~62 %
                                of the 108 dp canvas (inside the 66 dp safe zone)
    ic_launcher.png / _round    full-bleed legacy icons (pre-Android 8)
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
ART = ROOT / "assets" / "branding" / "yasco-logo-3d.png"
ICONS = ROOT / "src-tauri" / "icons"
ANDROID = ICONS / "android"

# density -> (legacy launcher px, adaptive foreground px)
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

PNG_ICONS = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}


# Tauri refuses any icon that is not 8-bit RGBA, so every PNG we write gets
# an explicit alpha channel and color type 6.
RGBA = ["-alpha", "on", "-depth", "8", "-define", "png:color-type=6"]


def run(*args: str) -> None:
    # encoding options must precede the output path, never follow it
    subprocess.run(["convert", *args[:-1], *RGBA, args[-1]], check=True)


def main() -> None:
    if not ART.exists():
        raise SystemExit(f"missing artwork: {ART}")

    base = ICONS / "_ys_base.png"
    run(str(ART), str(base))

    for name, size in PNG_ICONS.items():
        run(str(ART), "-resize", f"{size}x{size}", str(ICONS / name))

    # Windows .ico with every common size.
    subprocess.run(
        [
            "convert", str(ART), "-define", "icon:auto-resize=256,128,64,48,32,16",
            str(ICONS / "icon.ico"),
        ],
        check=True,
    )

    for density, (legacy, fg) in DENSITIES.items():
        folder = ANDROID / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)

        # legacy square icon + circular variant
        run(str(ART), "-resize", f"{legacy}x{legacy}", str(folder / "ic_launcher.png"))
        circle_mask = folder / "_mask.png"
        run(
            "-size", f"{legacy}x{legacy}", "xc:none",
            "-fill", "white", "-draw", f"circle {legacy/2},{legacy/2} {legacy/2},2",
            str(circle_mask),
        )
        run(
            str(folder / "ic_launcher.png"), str(circle_mask),
            "-alpha", "set", "-compose", "DstIn", "-composite",
            str(folder / "ic_launcher_round.png"),
        )
        circle_mask.unlink(missing_ok=True)

        # adaptive foreground: transparent canvas, artwork inside the safe zone
        inner = round(fg * 0.72)
        run(
            "-size", f"{fg}x{fg}", "xc:none",
            "(", str(ART), "-resize", f"{inner}x{inner}", ")",
            "-gravity", "center", "-composite",
            str(folder / "ic_launcher_foreground.png"),
        )

    base.unlink(missing_ok=True)

    # The native splash uses the 512 px artwork.
    run(str(ART), "-resize", "512x512", str(ROOT / "assets" / "branding" / "splash-512.png"))
    print("icons regenerated")


if __name__ == "__main__":
    main()