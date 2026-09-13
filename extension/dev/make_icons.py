# -*- coding: utf-8 -*-
"""无依赖生成扩展图标 PNG：圆角方块 + 书签缎带，4x 超采样抗锯齿"""
import zlib, struct, os

OUT = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\ozon-bookmark-manager\icons"
os.makedirs(OUT, exist_ok=True)

BLUE = (0, 91, 255)      # OZON 蓝
WHITE = (255, 255, 255)


def write_png(path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def in_round_rect(x, y, s, r):
    """x,y 为 0..1 归一化坐标"""
    if x < 0 or y < 0 or x > 1 or y > 1:
        return False
    # 四个角做圆角判定
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def in_poly(x, y, pts):
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1) + x1):
            inside = not inside
    return inside


def render(size, ss=4):
    r = 0.22                      # 圆角半径
    cx, hw = 0.5, 0.20            # 缎带中心与半宽
    top, bot, notch = 0.21, 0.80, 0.61
    ribbon = [(cx - hw, top), (cx + hw, top), (cx + hw, bot), (cx, notch), (cx - hw, bot)]

    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc_r = acc_g = acc_b = acc_a = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if not in_round_rect(x, y, size, r):
                        continue
                    if in_poly(x, y, ribbon):
                        c = WHITE
                    else:
                        c = BLUE
                    acc_r += c[0]; acc_g += c[1]; acc_b += c[2]; acc_a += 255
            n = ss * ss
            a = acc_a // n
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                # 未覆盖区域视为透明，按覆盖率归一化颜色
                cov = acc_a / (255 * n)
                row += bytes((int(acc_r / n / cov), int(acc_g / n / cov), int(acc_b / n / cov), a))
        rows.append(row)
    return rows


for s in (16, 32, 48, 128):
    write_png(os.path.join(OUT, f"icon{s}.png"), s, s, render(s, 4 if s >= 32 else 8))
    print("icon%d.png" % s)

print("done ->", OUT)
