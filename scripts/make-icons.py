"""Draw Shovel Command's home-screen icons: a white snow shovel over a pale
snowflake, on the app's blue.

Gold is Inventory and green is Bootprint, so blue keeps the three apart on a
phone's home screen. The snowflake is the icon the crew already knew (Snow
Crew, until 10/20/26); the shovel says which snow app this is, now that Plow
Command is coming. Drawn at 4x and scaled down, so the edges are smooth.

Usage: python scripts/make-icons.py   (writes icon-192/512 and the maskable one)
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
BLUE = (31, 95, 168)      # --accent in app.css
PALE = (84, 137, 201)     # the snowflake, a step lighter than the blue
WHITE = (255, 255, 255)
TILT = 30                 # degrees: the shovel leans right, blade at the bottom


def snowflake(draw, cx, cy, r, w, fill):
    """Six arms, each with two pairs of branches. r = arm length, w = stroke."""
    def line(a, b):
        draw.line([a, b], fill=fill, width=w)
        for p in (a, b):  # round the ends
            draw.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=fill)
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
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=fill)


def shovel(s, cx, cy, length):
    """A snow shovel on its own layer: D-grip, shaft, a wide scoop with a wear
    strip along the edge. Drawn upright, centred on (cx, cy), then tilted."""
    lay = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    L = length
    top = cy - L / 2
    shaft = L * 0.05
    # D-grip: a rounded ring
    gw, gh = L * 0.20, L * 0.13
    g0, g1 = (cx - gw / 2, top), (cx + gw / 2, top + gh)
    d.rounded_rectangle([g0, g1], radius=int(gh * 0.45), fill=WHITE)
    t = L * 0.04
    d.rounded_rectangle([g0[0] + t, g0[1] + t, g1[0] - t, g1[1] - t], radius=int(gh * 0.25), fill=(0, 0, 0, 0))
    # shaft
    d.rectangle([cx - shaft / 2, top + gh - 1, cx + shaft / 2, top + L * 0.60], fill=WHITE)
    # neck flaring into the scoop
    bw, by0, by1 = L * 0.46, top + L * 0.62, top + L
    d.polygon([(cx - shaft * 0.9, top + L * 0.56), (cx + shaft * 0.9, top + L * 0.56),
               (cx + bw * 0.30, by0), (cx - bw * 0.30, by0)], fill=WHITE)
    d.rounded_rectangle([cx - bw / 2, by0, cx + bw / 2, by1], radius=int(L * 0.05), fill=WHITE)
    # wear strip, in the background blue
    d.line([(cx - bw / 2 + L * 0.03, by1 - L * 0.06), (cx + bw / 2 - L * 0.03, by1 - L * 0.06)],
           fill=BLUE + (255,), width=max(2, int(L * 0.018)))
    return lay.rotate(TILT, resample=Image.BICUBIC, center=(cx, cy))


def icon(size, flake_share, shovel_share, rounded):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.18), fill=BLUE)
    else:
        d.rectangle([0, 0, s, s], fill=BLUE)  # maskable: the phone cuts its own shape
    # Stroke scales with the flake, or a smaller flake's branches run together.
    snowflake(d, s / 2, s / 2, s * flake_share / 2, max(4, int(s * flake_share * 0.076)), PALE)
    img.alpha_composite(shovel(s, s / 2, s / 2, s * shovel_share))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    icon(192, 0.76, 0.80, True).save(os.path.join(ROOT, "icon-192.png"))
    icon(512, 0.76, 0.80, True).save(os.path.join(ROOT, "icon-512.png"))
    # Maskable: everything that matters inside the middle 80%, so no phone's
    # circle or squircle crop cuts the grip or the blade off.
    icon(512, 0.56, 0.60, False).save(os.path.join(ROOT, "icon-maskable-512.png"))
    print("wrote icon-192.png, icon-512.png, icon-maskable-512.png")
