"""Draws a fictional test business card (all data is made up) to test/sample-card.png."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "sample-card.png")
W, H = 1050, 600
img = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(img)

def font(name, size):
    for p in (f"/usr/share/fonts/truetype/dejavu/{name}", f"/usr/share/fonts/truetype/freefont/{name}"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

bold, reg = "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"
d.rectangle([0, 0, 28, H], fill="#1f3a5f")

d.text((70, 50), "NORTHWIND AEROSPACE AG", font=font(bold, 34), fill="#1f3a5f")
d.text((70, 140), "Dr. Anna Müller", font=font(bold, 44), fill="#111111")
d.text((70, 200), "Head of Business Development", font=font(reg, 28), fill="#333333")

y = 290
for line in [
    "M +41 79 123 45 67",
    "T +41 41 123 45 00",
    "anna.mueller@northwind-aero.example",
    "www.northwind-aero.example",
]:
    d.text((70, y), line, font=font(reg, 28), fill="#111111")
    y += 48

d.text((70, 490), "Bahnhofstrasse 21", font=font(reg, 26), fill="#333333")
d.text((70, 530), "CH-6340 Baar, Switzerland", font=font(reg, 26), fill="#333333")

img.save(OUT)
print("wrote", OUT)
