#!/usr/bin/env python3
"""地块素材生成器（v5.4）。

美术方向：**材质，不是符号**。
每一格是独立裁剪的六边形，画在它上面的低频特征（等高线、街区、田垄、
长波浪）在相邻格之间接不上，玩家看到的是"一格一张贴纸"。
所以这里只画高频细节：颗粒、短笔触、小色块、细碎波纹——
近看有质地，远看是统一的纸面，跨格也不会穿帮。

**线宽纪律**：画布 3 倍超采样，任何线条 width ≥ 3，否则缩放回 96×110
不足 1px 会断成虚线（水面像横格纸就是这么来的）。

产出：
  game/assets/terrain/<key>.png        96×110（六角格外接矩形，clip-path 裁边）
  docs/ui/terrain-tiles-preview.png    一览图

用法：python tools/terrain-tiles.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 96, 110
SS = 3
PX = SS   # 最终 1px

BASE = {
    'plain': '#EDEAE0', 'forest': '#CBDCC0', 'hill': '#DDD1B6', 'town': '#D0C9BA',
    'air':   '#D9DDE3', 'road':   '#F4F1E7', 'ford': '#B6D2E5', 'river': '#A5C7DE',
    'shoal': '#9FC4DC', 'deep':   '#6E93B4', 'port': '#A9B4A6', 'rail':  '#BCB1A0',
}
NAME = {
    'plain': '平原', 'forest': '林地', 'hill': '丘陵', 'town': '城市', 'air': '机场',
    'road': '道路', 'ford': '渡口', 'river': '河流', 'shoal': '浅海', 'deep': '深海',
    'port': '港口', 'rail': '铁路',
}


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(c, f):
    return tuple(max(0, min(255, round(x * f))) for x in c)


def paper_grain(img, rng, amount=3.6):
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            n = rng.uniform(-amount, amount)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, round(r + n))),
                        max(0, min(255, round(g + n))),
                        max(0, min(255, round(b + n * 0.9))))


def speckle(d, rng, w, h, color, count, rmin, rmax, alpha):
    for _ in range(count):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(rmin, rmax)
        d.ellipse([x - r, y - r, x + r, y + r], fill=color + (alpha,))


def strokes(d, rng, w, h, color, count, length, width, alpha, angle=None):
    """短笔触：丘陵的晕渝线、平原的短茬都是它。"""
    for _ in range(count):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        a = angle if angle is not None else rng.uniform(0, math.tau)
        L = length * rng.uniform(0.6, 1.4)
        d.line([(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)],
               fill=color + (alpha,), width=width)


# ── 各地形：全部只做高频 ────────────────────────────────

def draw_plain(d, rng, w, h):
    """平原：收割后的短茬 + 极淡的斑驳。没有长线条。"""
    c = shade(hex2rgb(BASE['plain']), 0.93)
    speckle(d, rng, w, h, shade(hex2rgb(BASE['plain']), 0.975), 200, PX * 0.45, PX * 0.8, 18)
    strokes(d, rng, w, h, c, 220, PX * 2.6, PX, 55, angle=math.radians(22))
    speckle(d, rng, w, h, shade(hex2rgb(BASE['plain']), 1.02), 100, PX, PX * 1.6, 22)


def draw_forest(d, rng, w, h):
    """林地：密集的小树冠。大小有变化、明暗各半，远看是一层树冠质感。"""
    dark = shade(hex2rgb(BASE['forest']), 0.55)
    mid = shade(hex2rgb(BASE['forest']), 0.72)
    hi = shade(hex2rgb(BASE['forest']), 0.92)
    for _ in range(150):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(w * 0.008, w * 0.018)
        d.ellipse([x - r, y - r * 1.05, x + r, y + r * 1.05], fill=dark + (205,))
        d.ellipse([x - r * 0.72, y - r * 0.86, x + r * 0.55, y + r * 0.1], fill=mid + (215,))
        if rng.random() < 0.45:
            d.ellipse([x - r * 0.4, y - r * 0.72, x + r * 0.18, y - r * 0.2], fill=hi + (120,))
    speckle(d, rng, w, h, shade(hex2rgb(BASE['forest']), 0.9), 90, PX * 0.5, PX, 40)


def draw_hill(d, rng, w, h):
    """丘陵：密集的短斜线（晕渝），明暗交替成坡。不用粗等高线。"""
    dark = shade(hex2rgb(BASE['hill']), 0.70)
    light = shade(hex2rgb(BASE['hill']), 1.05)
    # 两条很淡的明暗带，模拟迎光/背光坡；用模糊避免硬边
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    for i in range(3):
        y0 = h * (0.12 + i * 0.30)
        dl.ellipse([-w * 0.2, y0 - h * 0.10, w * 1.2, y0 + h * 0.10], fill=(255, 250, 235, 55))
        dl.ellipse([-w * 0.2, y0 + h * 0.10, w * 1.2, y0 + h * 0.26], fill=(90, 74, 44, 40))
    layer = layer.filter(ImageFilter.GaussianBlur(10))
    d._image.paste(layer, (0, 0), layer)
    strokes(d, rng, w, h, dark, 300, PX * 3.0, PX, 58, angle=math.radians(58))
    strokes(d, rng, w, h, light, 110, PX * 2.4, PX, 45, angle=math.radians(58))


def draw_town(d, rng, w, h):
    """城市：密排的屋顶。小块、有亮边和暗缝，远看是"建筑密度"而不是街区图。"""
    roof = (178, 165, 140)
    roof2 = (160, 148, 124)
    edge = (210, 202, 182)
    d.rectangle([0, 0, w, h], fill=(214, 206, 188, 255))
    step_x, step_y = w * 0.120, h * 0.100
    y = -step_y * 0.5
    row = 0
    while y < h:
        # 每一行整体错开半格，并有一点点竖直抖动：
        # 行与行完全对齐就会出现"砖墙"的横缝，这是城市贴图最容易翻车的地方。
        x = -step_x * (0.5 if row % 2 else 0) + rng.uniform(-1, 1) * PX
        yj = y + rng.uniform(-0.10, 0.10) * step_y
        while x < w:
            bw = step_x * rng.uniform(0.62, 0.92)
            bh = step_y * rng.uniform(0.55, 0.86)
            # 约 12% 的位置留空：院落、空地、被炸掉的街区。
            # 没有这种缺口，整片看上去就是一张砌好的砖。
            if rng.random() > 0.12:
                col = roof if rng.random() < 0.55 else roof2
                d.rectangle([x + PX, yj + PX, x + bw, yj + bh], fill=col + (200,))
                d.line([(x + PX, yj + PX), (x + bw, yj + PX)], fill=edge + (55,), width=PX)
            x += step_x
        y += step_y
        row += 1


def draw_air(d, rng, w, h):
    """机场：混凝土。细颗粒 + 极淡的伸缩缝 + 一条短中线。"""
    d.rectangle([0, 0, w, h], fill=shade(hex2rgb(BASE['air']), 0.93) + (255,))
    speckle(d, rng, w, h, shade(hex2rgb(BASE['air']), 0.84), 220, PX * 0.6, PX * 1.3, 45)
    speckle(d, rng, w, h, (255, 255, 252), 90, PX * 0.6, PX * 1.2, 50)
    for gy in range(1, 3):
        y = h * gy / 3
        d.line([(0, y), (w, y)], fill=shade(hex2rgb(BASE['air']), 0.80) + (40,), width=PX)
    d.rectangle([w * 0.47, h * 0.30, w * 0.53, h * 0.70], fill=(252, 252, 246, 120))


def draw_road(d, rng, w, h):
    """道路：碎石路面质感。两条浅车辙暗示走向，不做整条路。"""
    d.rectangle([0, 0, w, h], fill=(228, 216, 190, 255))
    speckle(d, rng, w, h, (196, 180, 150), 300, PX * 0.6, PX * 1.6, 70)
    speckle(d, rng, w, h, (244, 238, 220), 120, PX * 0.5, PX * 1.2, 60)
    # 车辙：两道很淡的纵向浅沟
    for cx in (w * 0.44, w * 0.58):
        d.line([(cx, -4), (cx + w * 0.02, h + 4)], fill=(206, 190, 160, 70), width=PX * 3)


def draw_river(rng, w, h):
    """河流：细碎波纹。用很多短弧，不画长波浪。"""
    img = Image.new('RGBA', (w, h), hex2rgb(BASE['river']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(90):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(PX * 3, PX * 7)
        d.arc([x, y - L * 0.25, x + L, y + L * 0.25], 200, 340,
              fill=shade(hex2rgb(BASE['river']), 0.72) + (135,), width=PX * 2)
        d.arc([x, y - L * 0.25 - PX * 1.6, x + L, y + L * 0.25 - PX * 1.6], 200, 340,
              fill=(240, 248, 252, 60), width=PX)
    return img


def draw_shoal(rng, w, h):
    img = Image.new('RGBA', (w, h), hex2rgb(BASE['shoal']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(110):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(PX * 2.5, PX * 6)
        d.arc([x, y - L * 0.2, x + L, y + L * 0.2], 200, 340,
              fill=shade(hex2rgb(BASE['shoal']), 0.78) + (120,), width=PX * 2)
    speckle(d, rng, w, h, (236, 230, 204), 140, PX * 0.8, PX * 1.8, 45)
    return img


def draw_deep(rng, w, h):
    img = Image.new('RGBA', (w, h), hex2rgb(BASE['deep']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(60):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(PX * 4, PX * 9)
        d.arc([x, y - L * 0.2, x + L, y + L * 0.2], 200, 340,
              fill=(160, 190, 210, 80), width=PX * 2)
    return img


def draw_ford(rng, w, h):
    """渡口：水 + 一片浅滩碎石。不做横贯的浅滩带。"""
    img = Image.new('RGBA', (w, h), hex2rgb(BASE['ford']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(80):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(PX * 2.5, PX * 6)
        d.arc([x, y - L * 0.2, x + L, y + L * 0.2], 200, 340,
              fill=shade(hex2rgb(BASE['ford']), 0.76) + (115,), width=PX * 2)
    # 浅滩：一片集中的浅色碎石，位置随机但不横贯
    cx, cy = w * rng.uniform(0.35, 0.65), h * rng.uniform(0.40, 0.60)
    for _ in range(70):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0, 1) ** 0.5
        x = cx + math.cos(a) * w * 0.22 * rr
        y = cy + math.sin(a) * h * 0.12 * rr
        r = rng.uniform(PX * 0.7, PX * 1.6)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(226, 232, 212, 90))
    for _ in range(10):
        x, y = rng.uniform(w * 0.30, w * 0.70), rng.uniform(h * 0.42, h * 0.58)
        r = PX * rng.uniform(1.2, 1.8)
        d.ellipse([x - r, y - r * 0.8, x + r, y + r * 0.8], fill=(98, 96, 86, 150))
    return img


def draw_port(rng, w, h):
    """港口：混凝土 + 铺装缝 + 系缆桩。不画整块水面。"""
    img = Image.new('RGBA', (w, h), hex2rgb(BASE['port']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    joint = shade(hex2rgb(BASE['port']), 0.82)
    speckle(d, rng, w, h, joint, 180, PX * 0.6, PX * 1.3, 45)
    for gx in range(1, 4):
        d.line([(w * gx / 4, 0), (w * gx / 4, h)], fill=joint + (38,), width=PX)
    for gy in range(1, 4):
        d.line([(0, h * gy / 4), (w, h * gy / 4)], fill=joint + (38,), width=PX)
    for i in range(4):
        x = w * (0.14 + i * 0.24)
        d.ellipse([x - PX * 1.9, h * 0.5 - PX * 1.9, x + PX * 1.9, h * 0.5 + PX * 1.9],
                  fill=(66, 72, 64, 170))
    return img


def draw_rail(rng, w, h):
    """铁路：道砟 + 枕木 + 钢轨。枕木间距压到格内能看出"这是一段轨道"。"""
    img = Image.new('RGBA', (w, h), hex2rgb(BASE['rail']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    ballast = shade(hex2rgb(BASE['rail']), 0.84)
    speckle(d, rng, w, h, ballast, 320, PX * 0.5, PX * 1.4, 65)
    for i in range(4):
        y = h * (i + 0.5) / 4
        d.rectangle([w * 0.30, y - PX * 1.4, w * 0.70, y + PX * 1.4], fill=(98, 86, 72, 185))
    for gx in (0.42, 0.58):
        d.line([(w * gx, 0), (w * gx, h)], fill=(128, 134, 138, 215), width=PX * 2)
    return img


# ── 冬季变体（第 3 章）────────────────────────────────
# 同一套"材质"方向，只换配色与几笔积雪：雪地不是纯白，
# 是"白里带一点冷灰 + 露出地面的深色斑"；树冠压雪、屋顶压雪、
# 河面结冰裂纹、路面两道车辙。
WINTER_BASE = {
    'plain': '#F1F0EA', 'forest': '#D9DFD6', 'hill': '#E7E4DA', 'town': '#E4E1D8',
    'road':  '#EFEDE6', 'river': '#C9D8DE', 'ford':  '#D3DFE2', 'rail':  '#DAD7CE',
}


def w_snow(d, rng, w, h, color=(255, 255, 255), count=260, alpha=70, rmax=0.02):
    """积雪：白色小斑，位置随机、大小不一。"""
    for _ in range(count):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(w * 0.004, w * rmax)
        d.ellipse([x - r, y - r * 0.7, x + r, y + r * 0.7], fill=color + (alpha,))


def draw_plain_w(d, rng, w, h):
    """雪原：雪面 + 露出来的枯草茬（深色短笔触）。"""
    w_snow(d, rng, w, h, count=200, alpha=60)
    strokes(d, rng, w, h, (150, 148, 138), 150, PX * 2.2, PX, 55, angle=math.radians(22))
    speckle(d, rng, w, h, (206, 204, 194), 140, PX * 0.5, PX * 1.2, 45)


def draw_forest_w(d, rng, w, h):
    """雪林：深色树干/树冠 + 顶部积雪。远看是深绿底上的白点。"""
    dark = (78, 88, 76)
    mid = (66, 80, 66)
    for _ in range(110):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(w * 0.011, w * 0.020)
        # 树冠：深绿圆斑；上半截压雪；右下留一点暗面
        d.ellipse([x - r, y - r, x + r, y + r], fill=dark + (200,))
        d.ellipse([x - r * 0.95, y - r * 0.95, x + r * 0.95, y + r * 0.05],
                  fill=(246, 248, 245, 205))
        d.ellipse([x - r * 0.45, y + r * 0.15, x + r * 0.6, y + r * 0.8], fill=mid + (165,))
    w_snow(d, rng, w, h, count=90, alpha=70)


def draw_hill_w(d, rng, w, h):
    """雪山：雪面 + 裸露的深色岩脊（短斜线成组）。"""
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    for i in range(3):
        y0 = h * (0.20 + i * 0.26)
        dl.ellipse([-w * 0.2, y0, w * 1.2, y0 + h * 0.16], fill=(232, 236, 240, 90))
        dl.ellipse([-w * 0.2, y0 + h * 0.10, w * 1.2, y0 + h * 0.20], fill=(120, 126, 130, 45))
    layer = layer.filter(ImageFilter.GaussianBlur(10))
    d._image.paste(layer, (0, 0), layer)
    strokes(d, rng, w, h, (120, 118, 112), 260, PX * 2.6, PX, 60, angle=math.radians(58))
    w_snow(d, rng, w, h, count=120, alpha=80)


def draw_town_w(d, rng, w, h):
    """雪镇：屋顶压雪（白顶 + 深色檐口），街道被雪盖住。"""
    d.rectangle([0, 0, w, h], fill=(238, 235, 228, 255))
    step_x, step_y = w * 0.120, h * 0.100
    y = -step_y * 0.5
    row = 0
    while y < h:
        x = -step_x * (0.5 if row % 2 else 0) + rng.uniform(-1, 1) * PX
        yj = y + rng.uniform(-0.10, 0.10) * step_y
        while x < w:
            bw = step_x * rng.uniform(0.62, 0.92)
            bh = step_y * rng.uniform(0.55, 0.86)
            if rng.random() > 0.12:
                # 屋顶整体压雪：白顶 + 一圈细灰檐口，才是"雪镇"而不是"条形码"
                d.rectangle([x + PX, yj + PX, x + bw, yj + bh], fill=(250, 250, 248, 235))
                d.rectangle([x + PX, yj + PX, x + bw, yj + bh], outline=(168, 170, 168, 150), width=PX)
                # 屋脊：一条浅灰线，暗示坡屋顶
                my = yj + bh * 0.55
                d.line([(x + PX, my), (x + bw, my)], fill=(196, 198, 196, 110), width=PX)
                # 少数屋顶露出深色檐（不是每栋都有）
                if rng.random() < 0.35:
                    d.line([(x + PX, yj + bh), (x + bw, yj + bh)], fill=(96, 100, 100, 120), width=PX * 2)
            x += step_x
        y += step_y
        row += 1
    w_snow(d, rng, w, h, count=90, alpha=70)


def draw_road_w(d, rng, w, h):
    """雪路：两道压出来的车辙，中间是被压实的深色雪。"""
    d.rectangle([0, 0, w, h], fill=(238, 236, 229, 255))
    for cx in (w * 0.40, w * 0.60):
        # 压出来的车辙：断续的浅灰，不是两条实线
        y = -6
        while y < h + 6:
            seg = rng.uniform(PX * 4, PX * 10)
            d.line([(cx, y), (cx + w * 0.015, y + seg)], fill=(186, 184, 176, 120), width=PX * 4)
            d.line([(cx, y), (cx + w * 0.015, y + seg)], fill=(150, 148, 140, 70), width=PX * 2)
            y += seg + rng.uniform(PX * 2, PX * 6)
    speckle(d, rng, w, h, (255, 255, 255), 120, PX * 0.6, PX * 1.6, 90)
    w_snow(d, rng, w, h, count=80, alpha=50)


def draw_river_w(rng, w, h):
    """冰河：结冰的河面 + 裂纹。不是水，是冰。"""
    img = Image.new('RGBA', (w, h), hex2rgb(WINTER_BASE['river']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    # 冰面下的暗流：几道很淡的蓝灰弧
    for _ in range(40):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(PX * 4, PX * 9)
        d.arc([x, y - L * 0.15, x + L, y + L * 0.15], 200, 340,
              fill=(168, 188, 198, 70), width=PX * 2)
    # 裂纹：细的折线
    for _ in range(9):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        pts = [(x, y)]
        for _ in range(rng.randint(3, 6)):
            x += rng.uniform(-w * 0.12, w * 0.12)
            y += rng.uniform(-h * 0.08, h * 0.08)
            pts.append((x, y))
        d.line(pts, fill=(236, 244, 248, 150), width=PX * 2)
    w_snow(d, rng, w, h, count=70, alpha=110, rmax=0.03)
    return img


def draw_ford_w(rng, w, h):
    """冬季渡口：冰面上一条被踩出来的过河点（深色碎石 + 雪）。"""
    img = Image.new('RGBA', (w, h), hex2rgb(WINTER_BASE['ford']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(36):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        L = rng.uniform(PX * 3, PX * 8)
        d.arc([x, y - L * 0.15, x + L, y + L * 0.15], 200, 340,
              fill=(172, 192, 200, 70), width=PX * 2)
    cx, cy = w * 0.5, h * 0.5
    for _ in range(70):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0, 1) ** 0.5
        x = cx + math.cos(a) * w * 0.24 * rr
        y = cy + math.sin(a) * h * 0.12 * rr
        r = rng.uniform(PX * 0.7, PX * 1.6)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(150, 150, 142, 120))
    w_snow(d, rng, w, h, count=80, alpha=110, rmax=0.025)
    return img


def draw_rail_w(rng, w, h):
    """雪中铁路：道砟露出来，枕木与钢轨压出两道深槽。"""
    img = Image.new('RGBA', (w, h), hex2rgb(WINTER_BASE['rail']) + (255,))
    d = ImageDraw.Draw(img, 'RGBA')
    speckle(d, rng, w, h, (150, 146, 136), 260, PX * 0.5, PX * 1.4, 70)
    w_snow(d, rng, w, h, count=150, alpha=90)
    for i in range(4):
        y = h * (i + 0.5) / 4
        d.rectangle([w * 0.30, y - PX * 1.4, w * 0.70, y + PX * 1.4], fill=(104, 96, 86, 200))
    for gx in (0.42, 0.58):
        d.line([(w * gx, 0), (w * gx, h)], fill=(140, 146, 150, 220), width=PX * 2)
    return img


WINTER_BUILDERS = {'plain': draw_plain_w, 'forest': draw_forest_w, 'hill': draw_hill_w,
                   'town': draw_town_w, 'road': draw_road_w}
WINTER_CANVAS = {'river': draw_river_w, 'ford': draw_ford_w, 'rail': draw_rail_w}


def build_winter(key):
    rng = random.Random(0x5EED ^ hash(key) & 0xffff)
    w, h = W * SS, H * SS
    if key in WINTER_CANVAS:
        img = WINTER_CANVAS[key](rng, w, h)
    else:
        img = Image.new('RGBA', (w, h), hex2rgb(WINTER_BASE[key]) + (255,))
        WINTER_BUILDERS[key](ImageDraw.Draw(img, 'RGBA'), rng, w, h)
    img = img.resize((W, H), Image.LANCZOS)
    flat = Image.new('RGB', (W, H), hex2rgb(WINTER_BASE[key]))
    flat.paste(img, (0, 0), img)
    img = flat
    MUTE = 0.12
    img = Image.blend(img, Image.new('RGB', (W, H), hex2rgb(WINTER_BASE[key])), MUTE)
    paper_grain(img, rng, amount=3.0)
    return img


BUILDERS = {'plain': draw_plain, 'forest': draw_forest, 'hill': draw_hill,
            'town': draw_town, 'air': draw_air, 'road': draw_road}
SELF_CANVAS = {'river': draw_river, 'shoal': draw_shoal, 'deep': draw_deep,
               'ford': draw_ford, 'port': draw_port, 'rail': draw_rail}


def build(key):
    rng = random.Random(0xC0FFEE ^ hash(key) & 0xffff)
    w, h = W * SS, H * SS
    if key in SELF_CANVAS:
        img = SELF_CANVAS[key](rng, w, h)
    else:
        img = Image.new('RGBA', (w, h), hex2rgb(BASE[key]) + (255,))
        BUILDERS[key](ImageDraw.Draw(img, 'RGBA'), rng, w, h)
    img = img.resize((W, H), Image.LANCZOS)
    # 先按底色合成一次，再转 RGB：半透明笔触直接丢掉 alpha 会在
    # 缩放后留下深色噪点（"撒胡椒"就是这么来的），合成一遍才干净。
    flat = Image.new('RGB', (W, H), hex2rgb(BASE[key]))
    flat.paste(img, (0, 0), img)
    img = flat
    # 降噪：向底色回混 MUTE。纹理在 1:1 下看是细节，缩到 47px 的六角格里
    # 就变成噪点——这一步是为了"远看干净、近看有东西"。
    MUTE = 0.14
    base_img = Image.new('RGB', (W, H), hex2rgb(BASE[key]))
    img = Image.blend(img, base_img, MUTE)
    paper_grain(img, rng, amount=3.0)
    return img


def pick_font(size):
    for name in ('msyh.ttc', 'simhei.ttf', 'simsun.ttc', 'arial.ttf'):
        p = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts', name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def preview(images):
    cell_w, cell_h = W + 18, H + 40
    cols = 4
    rows = math.ceil(len(images) / cols)
    sheet = Image.new('RGB', (cols * cell_w, rows * cell_h), (247, 244, 234))
    dd = ImageDraw.Draw(sheet)
    font = pick_font(15)
    small = pick_font(11)
    for i, (key, img) in enumerate(images):
        x = (i % cols) * cell_w + 9
        y = (i // cols) * cell_h + 9
        sheet.paste(img, (x, y))
        dd.rectangle([x, y, x + W, y + H], outline=(198, 192, 176))
        dd.text((x + 1, y + H + 5), NAME[key], fill=(58, 54, 46), font=font)
        dd.text((x + 42, y + H + 7), key, fill=(120, 114, 100), font=small)
    sheet.save(os.path.join(ROOT, 'docs', 'ui', 'terrain-tiles-preview.png'))


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if __name__ == '__main__':
    import sys as _sys
    if '--winter' in _sys.argv:
        outdir = os.path.join(ROOT, 'game', 'assets', 'terrain', 'winter')
        os.makedirs(outdir, exist_ok=True)
        made = []
        for key in WINTER_BASE:
            img = build_winter(key)
            path = os.path.join(outdir, key + '.png')
            img.save(path, optimize=True)
            made.append((key, img))
            print(f'  {key:7s} {W}x{H}  {os.path.getsize(path) / 1024:.1f} KB')
        cell_w, cell_h = W + 18, H + 40
        cols = 4
        rows = math.ceil(len(made) / cols)
        sheet = Image.new('RGB', (cols * cell_w, rows * cell_h), (247, 244, 234))
        dd = ImageDraw.Draw(sheet)
        font, small = pick_font(15), pick_font(11)
        for i, (key, img) in enumerate(made):
            x = (i % cols) * cell_w + 9
            y = (i // cols) * cell_h + 9
            sheet.paste(img, (x, y))
            dd.rectangle([x, y, x + W, y + H], outline=(198, 192, 176))
            dd.text((x + 1, y + H + 5), NAME[key] + '（冬）', fill=(58, 54, 46), font=font)
        sheet.save(os.path.join(ROOT, 'docs', 'ui', 'terrain-winter-preview.png'))
        total = sum(os.path.getsize(os.path.join(outdir, k + '.png')) for k in WINTER_BASE)
        print(f'共 {len(WINTER_BASE)} 张冬季地块，{total / 1024:.1f} KB → game/assets/terrain/winter/')
        _sys.exit(0)
    outdir = os.path.join(ROOT, 'game', 'assets', 'terrain')
    os.makedirs(outdir, exist_ok=True)
    made = []
    for key in BASE:
        img = build(key)
        path = os.path.join(outdir, key + '.png')
        img.save(path, optimize=True)
        made.append((key, img))
        print(f'  {key:7s} {W}x{H}  {os.path.getsize(path) / 1024:.1f} KB')
    preview(made)
    total = sum(os.path.getsize(os.path.join(outdir, k + '.png')) for k in BASE)
    print(f'共 {len(BASE)} 张，{total / 1024:.1f} KB → game/assets/terrain/')
