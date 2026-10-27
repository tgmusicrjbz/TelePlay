"""Generate crisp PWA icons from Komod's simple cabinet mark."""
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1] / "public"


def icon(size: int, *, maskable: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), (7, 9, 15, 255) if maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    inset = int(size * (0.08 if maskable else 0.045))
    radius = int(size * 0.23)
    for y in range(inset, size - inset):
        mix = (y - inset) / max(1, size - inset * 2)
        color = (
            round(168 * (1 - mix) + 109 * mix),
            round(85 * (1 - mix) + 40 * mix),
            round(247 * (1 - mix) + 217 * mix),
            255,
        )
        draw.rounded_rectangle((inset, inset, size - inset, size - inset), radius=radius, fill=color)
    cabinet = (int(size * .27), int(size * .20), int(size * .73), int(size * .78))
    draw.rounded_rectangle(cabinet, radius=int(size * .055), fill=(247, 244, 255, 247), outline=(255, 255, 255, 255), width=max(2, size // 64))
    for fraction in (.40, .59):
        y = int(size * fraction)
        draw.line((cabinet[0], y, cabinet[2], y), fill=(124, 58, 237, 255), width=max(3, size // 37))
    for y in (int(size * .30), int(size * .49), int(size * .68)):
        draw.line((int(size * .33), y, int(size * .64), y), fill=(196, 181, 253, 255), width=max(2, size // 52))
        knob = max(2, size // 48)
        draw.ellipse((int(size * .62)-knob, y-knob, int(size * .62)+knob, y+knob), fill=(124, 58, 237, 255))
    return image


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    icon(192).save(ROOT / "komod-192.png", optimize=True)
    icon(512).save(ROOT / "komod-512.png", optimize=True)
    icon(512, maskable=True).save(ROOT / "komod-maskable-512.png", optimize=True)
    icon(180).save(ROOT / "apple-touch-icon.png", optimize=True)
