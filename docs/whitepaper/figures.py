# Figures for the relay whitepaper, drawn from data.json (see data.mjs).
# python3 docs/whitepaper/figures.py  ->  docs/whitepaper/figure.pdf
import json
import os

import matplotlib

matplotlib.use("pdf")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "data.json")))

BLUE = "#2a78d6"     # series 1
ORANGE = "#eb6834"   # series 2
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#8a8984"
GRID = "#e6e5e1"
WAIT = "#f1f0ec"

# TeX Gyre Heros (a Helvetica clone, shipped with TeX Live) matches the paper's sans headings
from matplotlib import font_manager

GYRE = "/usr/share/texmf/fonts/opentype/public/tex-gyre"
for style in ("regular", "italic", "bold"):
    path = os.path.join(GYRE, f"texgyreheros-{style}.otf")
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)

plt.rcParams.update({
    "font.family": "TeX Gyre Heros",
    "mathtext.fontset": "custom",
    "mathtext.rm": "TeX Gyre Heros",
    "mathtext.it": "TeX Gyre Heros:italic",
    "mathtext.bf": "TeX Gyre Heros:bold",
    "pdf.fonttype": 3,
    "font.size": 7,
    "axes.titlesize": 7.5,
    "axes.labelsize": 7,
    "xtick.labelsize": 6.5,
    "ytick.labelsize": 6.5,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK2,
    "xtick.color": INK2,
    "ytick.color": INK2,
    "axes.titlecolor": INK,
    "axes.linewidth": 0.6,
    "xtick.major.width": 0.6,
    "ytick.major.width": 0.6,
    "xtick.major.size": 2.5,
    "ytick.major.size": 2.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "axes.grid.axis": "y",
    "grid.color": GRID,
    "grid.linewidth": 0.5,
    "axes.axisbelow": True,
    "axes.titlelocation": "left",
    "axes.titlepad": 6,
})

fig, (a, b, c) = plt.subplots(1, 3, figsize=(7.05, 1.68), gridspec_kw={"width_ratios": [1, 1.25, 1]})

# (a) usage over every fix-round outcome, exactly (2^L outcomes), in 2-point bins
U = d["usage"]
outs = d["outcomes"]
lo, hi, step = 104, 150, 2
edges = list(range(lo, hi + step, step))
mass = [0.0] * (len(edges) - 1)
for o in outs:
    i = min(int((o["usage"] - lo) // step), len(mass) - 1)
    mass[i] += o["prob"]
centers = [e + step / 2 for e in edges[:-1]]
a.bar(centers, mass, width=step * 0.82, color=BLUE, zorder=2)
top = max(mass)
a.plot([U["mean"], U["mean"]], [0, top * 1.08], color=INK2, lw=0.8, ls=(0, (3, 2)), zorder=3)
a.text(U["mean"] - 0.8, top * 1.12, rf"$E[U]={U['mean']:.1f}\%$", color=INK2, fontsize=6.5, ha="right", va="center")
a.text(lo + 1.2, top * 1.58, f"SD {U['sd']:.1f}%   5th–95th pct {U['q05']:.0f}–{U['q95']:.0f}%\n"
       "the mean is relay's forecast", fontsize=6, color=INK2, va="top", ha="left", linespacing=1.35)
a.set_xlim(lo, hi)
a.set_ylim(0, top * 1.65)
a.set_ylabel("probability")
a.set_xlabel(r"plan usage $U$ (% of a 5h window)", labelpad=2)
a.set_title(f"(a) Usage over {len(outs)} fix-round outcomes")

# (b) the expected run in time: usage of the current window, pause at the stop line, reset
tr = d["expected"]["trace"]
ts = [p["t"] / 60 for p in tr]
us = [p["used"] for p in tr]
stop = d["priors"]["stopLine"]
for i in range(1, len(tr)):
    if tr[i]["used"] == tr[i - 1]["used"] and tr[i]["t"] > tr[i - 1]["t"] + 1:
        b.axvspan(ts[i - 1], ts[i], color=WAIT, zorder=0, lw=0)
        b.text((ts[i - 1] + ts[i]) / 2, 50, "waiting\nfor reset", ha="center", va="center", fontsize=6, color=INK2)
b.plot(ts, us, color=BLUE, lw=1.4, zorder=3, solid_joinstyle="round")
b.axhline(stop, color=ORANGE, lw=0.8, ls=(0, (3, 2)), zorder=2)
b.text(0.05, stop + 2.5, f"stop line {stop}%", color=INK2, fontsize=6, va="bottom")
for e in d["expected"]["events"]:
    s, t = e["start"] / 60, e["end"] / 60
    b.annotate("", xy=(t, 104), xytext=(s, 104), arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.6, shrinkA=0, shrinkB=0))
    b.plot([s, s], [101.5, 106.5], color=MUTED, lw=0.6)
    b.text((s + t) / 2, 108, f"wave {e['wave']}", ha="center", va="bottom", fontsize=6, color=INK2)
b.plot([ts[-1], ts[-1]], [101.5, 106.5], color=MUTED, lw=0.6)
b.set_ylim(0, 118)
b.set_yticks([0, 25, 50, 75, 100])
b.set_xlim(0, ts[-1] * 1.02)
b.set_ylabel("% of the current 5h window")
b.set_xlabel("hours since start", labelpad=2)
b.set_title("(b) Run at expected weights: %d windows, %dh %02dm" % ((d["expected"]["windows"],) + divmod(d["expected"]["totalMinutes"], 60)))

# (c) what calibration decides: the rate moves the waits, not the work
sens = d["sensitivity"]
rs = [x["r"] for x in sens]
c.plot(rs, [x["totalMinutes"] / 60 for x in sens], color=BLUE, lw=1.4, zorder=3)
c.plot(rs, [x["workMinutes"] / 60 for x in sens], color=MUTED, lw=0.8, ls=(0, (3, 2)), zorder=2)
c.text(rs[-1], sens[-1]["workMinutes"] / 60 - 0.8, "work only", ha="right", va="top", fontsize=6, color=INK2)
ph = d["priors"]["pctPerUnit"]
c.axvline(ph, color=INK2, lw=0.6, ls=(0, (1, 1.5)))
c.text(ph - 0.03, 16.6, "placeholder", ha="right", va="top", fontsize=6, color=INK2)
first_wait = next(x for x in sens if x["waitMinutes"] > 0)
c.annotate("waits begin", xy=(first_wait["r"], first_wait["totalMinutes"] / 60), xytext=(0.45, 9.2), fontsize=6, color=INK2,
           arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.5, shrinkA=1, shrinkB=2))
prev = sens[0]["windows"]
for x in sens:
    if x["windows"] != prev:
        c.text(x["r"] - 0.03, x["totalMinutes"] / 60 + 0.5, f"window {x['windows']}", ha="right", va="bottom", fontsize=6, color=INK)
        prev = x["windows"]
c.set_ylim(0, 17.5)
c.set_xlim(rs[0], rs[-1])
c.set_ylabel("hours")
c.set_xlabel(r"calibrated rate $\hat r$ (% of window per unit)", labelpad=2)
c.set_title(r"(c) Hours vs. the calibrated rate")

fig.tight_layout(pad=0.3, w_pad=1.4)
fig.savefig(os.path.join(HERE, "figure.pdf"))
print("wrote figure.pdf")
