from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "public" / "validation" / "inputs"
OUTPUT = ROOT / "public" / "validation" / "outputs"
SAMPLES = ["apparel", "leather-shorts", "cosmetics", "shoes", "motorcycle"]
SOURCE_INDEX = {"cosmetics": 2}
SIZE = (1080, 360)

for name in SAMPLES:
    source_index = SOURCE_INDEX.get(name, 1)
    source = Image.open(INPUT / f"{name}-{source_index}.jpg").convert("RGB")
    background = source.copy()
    scale = max(SIZE[0] / background.width, SIZE[1] / background.height)
    background = background.resize((round(background.width * scale), round(background.height * scale)), Image.Resampling.LANCZOS)
    left, top = (background.width - SIZE[0]) // 2, (background.height - SIZE[1]) // 2
    background = background.crop((left, top, left + SIZE[0], top + SIZE[1]))
    background = ImageEnhance.Brightness(background.filter(ImageFilter.GaussianBlur(28))).enhance(1.08)
    foreground = source.copy()
    foreground.thumbnail((620, 360), Image.Resampling.LANCZOS)
    x, y = SIZE[0] - foreground.width, (SIZE[1] - foreground.height) // 2
    mask = Image.new("L", foreground.size, 255)
    feather = min(36, foreground.width)
    for px in range(feather):
        value = round(255 * px / max(1, feather - 1))
        for py in range(foreground.height):
            mask.putpixel((px, py), value)
    background.paste(foreground, (x, y), mask)
    background.save(OUTPUT / f"{name}-c.png", format="PNG", optimize=True)

print("created", len(SAMPLES), "original-image composition baselines")
