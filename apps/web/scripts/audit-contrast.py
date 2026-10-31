#!/usr/bin/env python3
"""Measure WCAG contrast of workbench text and icons against rendered pixels.

Usage: KIUMI_CONTRAST_DIR=dir node scripts/capture-ui.mjs && python3 scripts/audit-contrast.py dir
Exits 1 when a string or icon fails: enabled text needs 4.5 (large text and icons 3), disabled text 3.
"""
import glob, json, os, re, sys
from collections import defaultdict
from PIL import Image

def lin(c):
    c /= 255
    return c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4
def lum(rgb): return .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2])
def ratio(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True)
    return (x + .05) / (y + .05)
def parse(value):
    n = [float(v) for v in re.findall(r'[\d.]+', value)]
    if 'color(srgb' in value: n = [v * 255 for v in n[:3]] + n[3:]
    return n[:3], (n[3] if len(n) > 3 else 1)
def over(fg, a, bg): return tuple(a * f + (1 - a) * b for f, b in zip(fg, bg))

directory = sys.argv[1]
rows = defaultdict(lambda: {'worst': 99, 'states': set()})
for path in sorted(glob.glob(f'{directory}/*.json')):
    state = os.path.basename(path)[:-5]
    image = Image.open(f'{directory}/{state}.png').convert('RGB')
    width, height = image.size
    for item in json.load(open(path, encoding='utf8')):
        l, t, r, b = item['rect']
        if item['kind'] in ('value', 'placeholder'):  # Whole field: stay clear of its focus ring.
            l, t, r, b = l + 10, t + 8, r - 10, b - 8
        box = (max(0, int(l)), max(0, int(t)), min(width, int(r) + 1), min(height, int(b) + 1))
        if box[2] <= box[0] or box[3] <= box[1]: continue
        fg, a = parse(item['color'])
        a *= item['alpha']
        crop = image.crop(box).resize((min(box[2] - box[0], 48), min(box[3] - box[1], 16)))
        pixels = [crop.getpixel((x, y)) for x in range(crop.width) for y in range(crop.height)]
        scores = sorted(ratio(over(fg, a, p), p) for p in pixels)
        score = scores[len(scores) // 20]
        large = item['size'] >= 24 or (item['size'] >= 18.66 and item['weight'] >= 700)
        need = 3 if item['kind'] == 'icon' or large or item['disabled'] else 4.5
        key = (item['kind'], item['where'], item['color'], item['disabled'], need)
        row = rows[key]
        row['states'].add(state)
        if score < row['worst']:
            row.update(worst=score, text=item['text'], state=state, size=item['size'], alpha=item['alpha'])

failed = 0
for (kind, where, color, disabled, need), row in sorted(rows.items(), key=lambda entry: entry[1]['worst'] / entry[0][4]):
    bad = row['worst'] < need
    failed += bad
    if bad or row['worst'] < need + .6:
        mark = ('FAIL' if bad else 'near') + ('(off)' if disabled else '')
        print(f"{mark:10} {row['worst']:5.2f}/{need} {kind:11} {where[:34]:34} {row['size']:4.1f}px a{row['alpha']:.2f} {row['text'][:22]} [{row['state']}, {len(row['states'])} states]")
print(f'\n{len(rows)} distinct styles measured, {failed} failing')
sys.exit(1 if failed else 0)
