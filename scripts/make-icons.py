"""Draw Sidewalk's home-screen icons: a white snowflake on the app's blue.

Gold is Inventory and green is Bootprint, so blue keeps the three apart on a
phone's home screen. Drawn at 4x and scaled down, so the edges are smooth.

Usage: python scripts/make-icons.py   (writes icon-192/512 and the maskable one)
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
BLUE = (31, 95, 168)      # --accent in app.css
WHITE = (255, 255, 255)


def snowflake(draw, cx, cy, r, w):
    """Six arms, each with two pairs of branches. r = arm length, w = stroke."""
    def line(a, b):
        draw.line([a, b], fill=WHITE, width=w)
        for p in (a, b):  # round the ends
            draw.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=WHITE)
    for k in range(6):
        t = math.radians(90 + 60 * k)
        tip = (cx + r * math.cos(t), cy - r * math.sin(t))
        line((cx, cy), tip)
        for at, length in ((0.5, 0.32), (0.75, 0.22)):
            base = (cx + r * at * math.cos(t), cy - r * at * math.sin(t))
            for side in (-1, 1):
                b = t + side * math.radians(45)
                line(base, (base[0] + r * length * math.cos(b), base[1] - r * length * math.sin(b)))
    hub = w * 0.9
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=WHITE)


def icon(size, flake_share, rounded):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.18), fill=BLUE)
    else:
        d.rectangle([0, 0, s, s], fill=BLUE)  # maskable: the phone cuts its own shape
    # Stroke scales with the flake, or a smaller flake's branches run together.
    snowflake(d, s / 2, s / 2, s * flake_share / 2, max(4, int(s * flake_share * 0.076)))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    icon(192, 0.72, True).save(os.path.join(ROOT, "icon-192.png"))
    icon(512, 0.72, True).save(os.path.join(ROOT, "icon-512.png"))
    # Maskable: everything that matters inside the middle 80%, so no phone's
    # circle or squircle crop cuts an arm off.
    icon(512, 0.56, False).save(os.path.join(ROOT, "icon-maskable-512.png"))
    print("wrote icon-192.png, icon-512.png, icon-maskable-512.png")
