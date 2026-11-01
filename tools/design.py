"""Source of the drawn typeface: every glyph built from geometric primitives.

    python app/tools/design.py      -> app/glyphs_svg/<id>.svg + specimen.svg

One pen for the whole set, one cell (100 units high), shared vertical metrics.
Shapes follow the author's A16 sheet (number of loops, bars, dots, tails),
redrawn as clean geometry - nothing added that the author did not draw.
Coordinates below are written relative to the glyph's own left edge; the
script measures the ink and adds equal side bearings.
"""
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "glyphs_svg"

CELL = 100
T = 24          # top of the main body
B = 80          # baseline
M = 52          # middle
DOT_Y = 15      # row of dots above the body
PEN = 7
DOT_R = 4.8
SB = 7          # side bearing, each side
INK = "#1c1a18"


# ---------- primitives: each returns (svg element, sampled points for bbox) ----------

def _arc_pts(cx, cy, rx, ry, n=48):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]


def line(x1, y1, x2, y2):
    return (f'<path d="M{x1:g},{y1:g}L{x2:g},{y2:g}"/>', [(x1, y1), (x2, y2)])


def poly(*pts, closed=False):
    d = "M" + "L".join(f"{x:g},{y:g}" for x, y in pts) + ("Z" if closed else "")
    return (f'<path d="{d}"/>', list(pts))


def circle(cx, cy, r):
    return (f'<circle cx="{cx:g}" cy="{cy:g}" r="{r:g}"/>', _arc_pts(cx, cy, r, r))


def ellipse(cx, cy, rx, ry):
    return (f'<ellipse cx="{cx:g}" cy="{cy:g}" rx="{rx:g}" ry="{ry:g}"/>', _arc_pts(cx, cy, rx, ry))


def rrect(x, y, w, h, r):
    return (f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{r:g}"/>',
            [(x, y), (x + w, y + h)])


def dot(cx, cy=DOT_Y, r=DOT_R):
    # filled; bbox already includes radius, so subtract the pen added later
    return (f'<circle cx="{cx:g}" cy="{cy:g}" r="{r:g}" fill="{INK}" stroke="none"/>',
            _arc_pts(cx, cy, max(0.1, r - PEN / 2), max(0.1, r - PEN / 2)))


def ring(cx, cy=DOT_Y, r=4.6, w=3.4):
    return (f'<circle cx="{cx:g}" cy="{cy:g}" r="{r:g}" stroke-width="{w:g}"/>',
            _arc_pts(cx, cy, max(0.1, r + w / 2 - PEN / 2), max(0.1, r + w / 2 - PEN / 2)))


def path(d):
    """Absolute M L H V C Q Z only; points sampled along curves for the bbox."""
    pts, cur, start = [], (0.0, 0.0), (0.0, 0.0)
    for cmd, args in re.findall(r"([MLHVCQZ])([^MLHVCQZ]*)", d):
        n = [float(v) for v in re.findall(r"-?\d*\.?\d+", args)]
        if cmd == "M":
            cur = start = (n[0], n[1]); pts.append(cur)
            for i in range(2, len(n), 2):
                cur = (n[i], n[i + 1]); pts.append(cur)
        elif cmd == "L":
            for i in range(0, len(n), 2):
                cur = (n[i], n[i + 1]); pts.append(cur)
        elif cmd == "H":
            cur = (n[-1], cur[1]); pts.append(cur)
        elif cmd == "V":
            cur = (cur[0], n[-1]); pts.append(cur)
        elif cmd in "CQ":
            k = 6 if cmd == "C" else 4
            for i in range(0, len(n), k):
                ctrl = [cur] + [(n[i + j], n[i + j + 1]) for j in range(0, k, 2)]
                for s in range(1, 13):
                    t = s / 12
                    if cmd == "C":
                        p0, p1, p2, p3 = ctrl
                        x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t*t*p2[0] + t**3*p3[0]
                        y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t*t*p2[1] + t**3*p3[1]
                    else:
                        p0, p1, p2 = ctrl
                        x = (1-t)**2*p0[0] + 2*(1-t)*t*p1[0] + t*t*p2[0]
                        y = (1-t)**2*p0[1] + 2*(1-t)*t*p1[1] + t*t*p2[1]
                    pts.append((x, y))
                cur = ctrl[-1]
        elif cmd == "Z":
            cur = start
    return (f'<path d="{d}"/>', pts)


# ---------- shared parts ----------

def window(x, y=T, s=B - T):
    """Text-end window: square with a centred cross."""
    return [rrect(x, y, s, s, 1.5), line(x + s / 2, y, x + s / 2, y + s), line(x, y + s / 2, x + s, y + s / 2)]


def tri_eye(x0, w):
    """Triangle on the baseline with an inscribed circle (surprise family)."""
    apex = (x0 + w / 2, T)
    h = B - T
    side = math.hypot(w / 2, h)
    r = (w * h / 2) / ((w + 2 * side) / 2)
    return [poly((x0, B), apex, (x0 + w, B), closed=True), circle(x0 + w / 2, B - r, r - 1.6)]


def loop_top(cx=10, r=9):
    return circle(cx, T + r, r)


# ---------- glyphs ----------

def g_1_1():  # удивлённое недоумение: треугольник с кругом и длинным основанием
    return tri_eye(20, 58) + [line(0, B, 98, B)]


def g_1_2():  # удивление
    return tri_eye(0, 58)


def g_1_3():  # восклицание: петля, ствол, отвод вправо-вверх
    return [loop_top(), path(f"M19,{T + 9}V{B}L42,{B - 22}")]


def g_a13_1():  # вопрос (ref, «2 = ?»): замкнутая петля сверху, спуск влево, черта по основанию
    r = 12
    return [circle(18, T + r, r), path(f"M30,{T + r}C30,{T + 34} 12,{B - 13} 3,{B}H42")]


def g_1_4():  # точка: верхняя петля слева, ствол, нижняя петля справа
    r = 11
    return [loop_top(), line(19, T + 9, 19, B), circle(19 + r, B - r, r)]


def g_1_5():  # ?!. : две петли внизу, V сходится между ними
    r = 13
    return [circle(r, B - r, r), circle(3 * r, B - r, r),
            poly((2, T), (2 * r, B - r + 3), (4 * r - 2, T))]


def g_1_6():  # !. : две петли столбиком, диагональ от нижней вправо-вверх
    return [circle(13, T + 13, 13), circle(14, B - 14, 14),
            line(14 + 14 * 0.72, B - 14 + 14 * 0.69, 52, T + 10)]


def g_1_7():  # ?! : треугольная петля вершиной вниз, верхние углы с отводами
    y = 46
    return [path(f"M12,{y}L27.5,{B - 6}Q32,{B + 1} 36.5,{B - 6}L52,{y}Z"),
            line(12, y, 0, y - 12), line(52, y, 64, y - 12)]


def g_1_8():  # ?. : две петли на длинной черте
    r = 12.5
    return [circle(36, B - r, r), circle(36, B - 3 * r + 1, r - 0.5), line(0, B, 72, B)]


def g_2_1():  # конец текста ?! : наклонённое окошко, две стороны продлены
    c, d = (46, 50), 30          # центр и полудиагональ ромба
    top, right, bottom, left = (c[0], c[1] - d), (c[0] + d, c[1]), (c[0], c[1] + d), (c[0] - d, c[1])
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    ext = 0.6
    tail_l = (left[0] + (left[0] - bottom[0]) * ext, left[1] + (left[1] - bottom[1]) * ext)
    tail_r = (right[0] + (right[0] - bottom[0]) * ext, right[1] + (right[1] - bottom[1]) * ext)
    return [poly(top, right, bottom, left, closed=True),
            line(*mid(top, left), *mid(right, bottom)), line(*mid(top, right), *mid(left, bottom)),
            line(*left, *tail_l), line(*right, *tail_r)]


def g_2_2():  # конец текста ! : окошко с диагональным отводом
    return window(0) + [line(B - T, B, B - T + 34, T - 2)]


def g_2_3():  # конец текста ? : окошко на длинной черте
    return window(18) + [line(0, B, 18 + (B - T) + 30, B)]


def g_2_4():  # конец текста
    return window(0)


def g_2_5():  # F: круг с одной перекладиной
    r = (B - T) / 2 + 1.5
    return [circle(r, M, r), line(0, M, 2 * r, M)]


def g_2_6():  # группа гласных a: две точки, черта, чаша
    y = 32
    return [line(0, y, 62, y), poly((14, y), (14, B), (48, B), (48, y)), dot(22), dot(40)]


def g_2_7():  # T/D: Z с двумя кружками
    return [poly((0, T), (50, T), (0, B), (50, B)), circle(12, T + 15, 7.5), circle(38, B - 15, 7.5)]


def g_2_8():  # L: ствол, наверху плавно загибается вправо и чуть вниз (ʃ, не Г)
    return [path(f"M5,{B}V{T + 16}C5,{T + 2} 20,{T - 2} 27,{T + 8}")]


def g_3_1():  # e: обратная E с двумя точками
    return [poly((4, T + 8), (32, T + 8), (32, B), (2, B)), line(8, M + 2, 32, M + 2), dot(6), dot(30)]


def g_3_2():  # K/G: два ствола со сдвигом и овал между ними
    return [line(4, 36, 4, B + 4), line(42, T - 4, 42, 70), ellipse(23, 54, 19, 10)]


def g_3_3():  # o/u/ö/ü/ø: восьмёрка с перекладиной и две точки
    return [circle(24, 40, 10.5), circle(24, B - 13.5, 13.5), line(2, 52, 46, 50), dot(14), dot(34)]


def g_3_4():  # u: чаша, высокий правый ствол с ножкой
    return [path(f"M4,44V{B - 12}Q4,{B} 14,{B}Q24,{B} 24,{B - 12}"), path(f"M24,{T - 4}V{B}H32")]


def g_3_5():  # A/Ä: прямоугольный треугольник, правый ствол открыт вверх
    return [poly((0, T), (0, B), (46, B), closed=True), line(0, T, 46, B), line(46, B, 46, T + 6)]


def g_3_6():  # i: черта, ствол из середины, две точки
    y = 32
    return [line(0, y, 46, y), line(23, y, 23, B), dot(8), dot(38)]


def g_3_7():  # снежинка S/С/З: шестилучевая звезда (не X)
    cx, cy, r = 26, M, 25
    dx, dy = r * math.sin(math.radians(55)), r * math.cos(math.radians(55))
    return [line(cx, T - 2, cx, B + 2), line(cx - dx, cy - dy, cx + dx, cy + dy), line(cx + dx, cy - dy, cx - dx, cy + dy)]


def g_3_8():  # B: почти круглый овал с двумя перекладинами
    cx, cy, rx, ry = 33, (T + B) / 2, 33, 29
    chord = lambda y: rx * math.sqrt(1 - ((y - cy) / ry) ** 2)
    return [ellipse(cx, cy, rx, ry)] + [line(cx - chord(y), y, cx + chord(y), y) for y in (44, 61)]


def g_3_9():  # прямоугольник с верхней полосой и двумя точками
    y = 30
    return [rrect(0, y, 66, B - y, 1.5), line(0, y + 13, 66, y + 13), dot(16), dot(50)]


def g_4_1():  # sch/Ж/j: S-образный знак с гачеком и хвостом вниз
    return [path("M8,38C8,26 32,25 32,37C32,47 22,50 15,53C4,58 4,78 19,80C25,81 31,79 34,76"),
            path("M19,80C24,86 25,93 19,97C15,99 11,97 10,95"),
            poly((12, 10), (20, 17), (28, 10))]


def g_4_2():  # R: вытянутая петля, левый ствол до основания, нога
    return [ellipse(19, 45, 15, 21), line(4, 45, 4, B), line(10, 62, 34, B)]


def g_4_3():  # D: диагональ и чаша на ней
    return [line(0, B, 38, T - 2), path(f"M18,{M}H36C54,{M} 54,{B} 36,{B}H0")]


def g_4_4():  # S-подобный с двумя кружками
    return [path(f"M38,33C30,26 6,26 6,40C6,52 36,50 36,66C36,83 8,84 2,72"), ring(12), ring(32)]


def g_4_5():  # n: петля P сверху, перекладина и две ножки
    return [line(0, T, 0, B), circle(10, T + 10, 10), line(0, M, 46, M),
            line(24, M, 24, B), path(f"M44,{M}V{B - 6}Q44,{B} 50,{B}")]


def g_4_6():  # m: круг сверху над n
    return [circle(16, 38, 13), path(f"M4,{B}V58Q4,52 10,52H22Q28,52 28,58V{B}")]


def g_4_7():  # h/H: высокий ствол с засечкой и b
    return [line(4, T - 4, 4, B), line(-4, 64, 12, 64), line(18, 46, 18, B), circle(30, B - 12, 12)]


def g_5_1():  # повтор 3-9: прямоугольник, неполная внутренняя черта, две точки
    y = 30
    return [rrect(0, y, 64, B - y, 1.5), line(0, M, 46, M), dot(14), dot(48)]


def g_5_2():  # повтор 3-8: круг с двумя перекладинами
    r = (B - T) / 2 + 1.5
    return [circle(r, M, r), line(1, 45, 2 * r - 1, 45), line(1, 61, 2 * r - 1, 61)]


def g_5_3():  # повтор 4-3: крутая диагональ и широкая чаша
    return [line(0, B, 28, T - 4), path(f"M14,{M}H44C62,{M} 62,{B} 42,{B}H0")]


def g_5_4():  # повтор 2-6: черта с крючком слева, чаша, две точки
    y = 32
    return [path(f"M8,{y + 6}Q2,{y} 8,{y}H64"), poly((18, y), (18, B), (50, B), (50, y)), dot(24), dot(44)]


def g_5_5():  # повтор 4-4: узкая S с двумя точками
    return [path(f"M34,34C26,27 6,28 6,41C6,53 33,51 33,66C33,82 9,83 3,73"), dot(12, 15, 4.2), dot(30, 14, 4.2)]


def g_5_6():  # повтор 2-4: окошко
    return window(0)


GLYPHS = {name[2:].replace("_", "-"): fn for name, fn in globals().items() if name.startswith("g_")}


def render(parts):
    pts = [p for _, ps in parts for p in ps]
    x0 = min(p[0] for p in pts) - PEN / 2
    x1 = max(p[0] for p in pts) + PEN / 2
    width = round(x1 - x0 + 2 * SB, 1)
    dx = SB - x0
    body = "".join(el for el, _ in parts)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{CELL}" viewBox="0 0 {width:g} {CELL}">'
           f'<g transform="translate({dx:.2f} 0)" fill="none" stroke="{INK}" stroke-width="{PEN}" '
           f'stroke-linecap="round" stroke-linejoin="round">{body}</g></svg>\n')
    return width, svg


def main():
    OUT.mkdir(exist_ok=True)
    specimen, x, y, row = [], 10, 10, 0
    for gid, fn in GLYPHS.items():
        width, svg = render(fn())
        (OUT / f"{gid}.svg").write_text(svg, encoding="utf-8")
        if x + width > 1000:
            x, y = 10, y + CELL + 30
        inner = svg[svg.index(">") + 1: svg.rindex("</svg>")]
        specimen.append(f'<g transform="translate({x} {y})"><rect width="{width}" height="{CELL}" fill="none" stroke="#cfd8e6"/>'
                        f'<line x1="0" x2="{width}" y1="{B}" y2="{B}" stroke="#e6b8a8"/><line x1="0" x2="{width}" y1="{T}" y2="{T}" stroke="#cfd8e6"/>'
                        f'{inner}<text x="2" y="{CELL + 14}" font-size="12" font-family="sans-serif" fill="#a33">{gid}</text></g>')
        x += width + 14
    total_h = y + CELL + 30
    (ROOT / "tools" / "specimen.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="{total_h}" style="background:#fff">'
        f'<rect width="100%" height="100%" fill="#fff"/>{"".join(specimen)}</svg>\n', encoding="utf-8")
    print(f"{len(GLYPHS)} glyphs -> {OUT}")


if __name__ == "__main__":
    main()
