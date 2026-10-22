# Figures for the Codex whitepaper, drawn from data.json (see data.mjs).
# python3 codex-math/docs/whitepaper/figures.py  ->  codex-math/docs/whitepaper/figure.pdf
import json
import os

import matplotlib

matplotlib.use("pdf")
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "data.json")))

BLUE = "#2a78d6"
ORANGE = "#eb6834"
GREEN = "#2f9e63"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#8a8984"
GRID = "#e6e5e1"
WAIT = "#f1f0ec"

GYRE = "/usr/share/texmf/fonts/opentype/public/tex-gyre"
have_gyre = False
for style in ("regular", "italic", "bold"):
    path = os.path.join(GYRE, f"texgyreheros-{style}.otf")
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)
        have_gyre = True

plt.rcParams.update({
    "font.family": "TeX Gyre Heros" if have_gyre else "DejaVu Sans",
    "mathtext.fontset": "custom" if have_gyre else "dejavusans",
    "mathtext.rm": "TeX Gyre Heros" if have_gyre else "DejaVu Sans",
    "mathtext.it": "TeX Gyre Heros:italic" if have_gyre else "DejaVu Sans:italic",
    "mathtext.bf": "TeX Gyre Heros:bold" if have_gyre else "DejaVu Sans:bold",
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

fig, (a, b, c) = plt.subplots(1, 3, figsize=(7.05, 1.72), gridspec_kw={"width_ratios": [1, 1.25, 1]})

# (a) the price ladder: credits per unit by tier on Codex against relay's Claude weights, and where the plan's credits go
tiers = ["cheap", "mid", "strong"]
claude = [d["claudeRatios"][t] for t in tiers]
codex = [d["ratios"][t] for t in tiers]
x = range(3)
a.bar([i - 0.19 for i in x], claude, width=0.36, color=MUTED, zorder=2, label="Claude Code (relay prior)")
a.bar([i + 0.19 for i in x], codex, width=0.36, color=BLUE, zorder=2, label="Codex (credits)")
a.set_yscale("log")
a.set_ylim(0.6, 700)
a.set_xticks(list(x))
models = {t: d["profiles"][t]["model"].replace("gpt-6", "6") for t in tiers}
a.set_xticklabels([f"{t}\n{models[t]}" for t in tiers])
for i, v in enumerate(codex):
    a.text(i + 0.19, v * 1.25, f"{v:.0f}" if v >= 10 else "1", ha="center", va="bottom", fontsize=6, color=INK)
for i, v in enumerate(claude):
    a.text(i - 0.19, v * 1.25, f"{v:.0f}", ha="center", va="bottom", fontsize=6, color=INK2)
a.set_ylabel("cost of one unit, cheap = 1 (log)")
units = d["plan"]["units"]
bt = d["credits"]["byTier"]
a.text(0.02, 0.98, f"the plan: strong is {100 * bt['strong']['units'] / units:.0f}% of the units,\n{100 * bt['strong']['credits'] / d['credits']['mean']:.0f}% of the credits",
       transform=a.transAxes, fontsize=6, color=INK2, va="top", ha="left", linespacing=1.3)
a.legend(loc="upper left", bbox_to_anchor=(0.0, 0.80), fontsize=5.6, frameon=False, handlelength=1.0, borderpad=0.2)
a.set_title("(a) Tier prices: 1 : 3 : 7 became 1 : %.0f : %.0f" % (d["ratios"]["mid"], d["ratios"]["strong"]))

# (b) the walk on a Plus account: both windows, pauses at the primary stop line
tr = d["expected"]["trace"]
ts = [p["t"] / 60 for p in tr]
prim = [p["used"]["primary"] for p in tr]
sec = [p["used"]["secondary"] for p in tr]
for w in d["expected"]["waits"]:
    s = w["at"] / 60
    e = (w["at"] + w["minutes"]) / 60
    b.axvspan(s, e, color=WAIT, zorder=0, lw=0)
b.plot(ts, prim, color=BLUE, lw=1.3, zorder=3, label="5-hour window")
b.plot(ts, sec, color=ORANGE, lw=1.3, zorder=3, label="weekly window")
stop_p = d["priors"]["stopLines"]["primary"]["critical"]
stop_s = d["priors"]["stopLines"]["secondary"]["critical"]
b.axhline(stop_p, color=BLUE, lw=0.7, ls=(0, (3, 2)), zorder=2)
b.axhline(stop_s, color=ORANGE, lw=0.7, ls=(0, (3, 2)), zorder=2)
b.text(0.2, stop_p - 3, f"stop line {stop_p}%", color=BLUE, fontsize=5.8, va="top")
b.text(ts[-1] * 0.99, stop_s + 1.5, f"stop line {stop_s}%", color=ORANGE, fontsize=5.8, va="bottom", ha="right")
waits = d["expected"]["waits"]
if waits:
    w0 = waits[0]
    b.text((w0["at"] + w0["minutes"] / 2) / 60, 40, "waiting\nfor reset", ha="center", va="center", fontsize=5.6, color=INK2)
for e in d["expected"]["events"]:
    s, t = e["start"] / 60, e["end"] / 60
    b.annotate("", xy=(t, 106), xytext=(s, 106), arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.6, shrinkA=0, shrinkB=0))
    b.plot([s, s], [103.5, 108.5], color=MUTED, lw=0.6)
    b.text((s + t) / 2, 110, f"wave {e['wave']}", ha="center", va="bottom", fontsize=6, color=INK2)
b.plot([ts[-1], ts[-1]], [103.5, 108.5], color=MUTED, lw=0.6)
b.set_ylim(0, 122)
b.set_yticks([0, 25, 50, 75, 100])
b.set_xlim(0, ts[-1] * 1.02)
b.set_ylabel("% of the window used")
b.set_xlabel("hours since start", labelpad=2)
b.legend(loc="lower right", bbox_to_anchor=(1.0, 0.02), fontsize=5.6, frameon=False, handlelength=1.2, borderpad=0.2)
h, m = divmod(d["expected"]["totalMinutes"], 60)
b.set_title("(b) Plus, placeholder capacity: %d windows, %dh %02dm" % (d["expected"]["windows"]["primary"]["windowsUsed"], h, m))

# (c) hours against the number calibration must supply first: the 5-hour window's capacity in credits
sens = d["sensitivity"]
sol = d["sensitivitySol"]
qs = [x["q"] for x in sens]
c.plot(qs, [x["totalMinutes"] / 60 for x in sens], color=BLUE, lw=1.3, zorder=3, label="strong on Astra (as planned)")
c.plot(qs, [x["totalMinutes"] / 60 for x in sol], color=GREEN, lw=1.3, zorder=3, label="strong on Sol 6.1 / xhigh")
c.plot(qs, [x["workMinutes"] / 60 for x in sens], color=MUTED, lw=0.8, ls=(0, (3, 2)), zorder=2)
c.text(qs[-1], sens[-1]["workMinutes"] / 60 + 0.6, "work only", ha="right", va="bottom", fontsize=6, color=INK2)
ph = d["priors"]["windowCapacityCredits"][d["priors"]["planType"]]["primary"]
c.axvline(ph, color=INK2, lw=0.6, ls=(0, (1, 1.5)))
c.text(ph + 15, 38, "placeholder", ha="left", va="top", fontsize=6, color=INK2)
c.axvline(d["lastWaitCapacity"], color=BLUE, lw=0.5, ls=(0, (1, 1.5)))
c.text(d["lastWaitCapacity"] + 15, 20, f"no waits\nfrom {d['lastWaitCapacity']} cr", ha="left", va="top", fontsize=5.8, color=BLUE, linespacing=1.2)
c.set_ylim(0, 42)
c.set_xlim(60, qs[-1])
c.set_ylabel("hours")
c.set_xlabel(r"credits per 5-hour window $\hat Q_1$ (weekly: 6 $\hat Q_1$)", labelpad=2)
c.legend(loc="upper right", fontsize=5.6, frameon=False, handlelength=1.2, borderpad=0.2)
c.set_title("(c) Hours vs. window capacity")

fig.tight_layout(pad=0.3, w_pad=1.4)
fig.savefig(os.path.join(HERE, "figure.pdf"))
print("wrote figure.pdf")
