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

fig, (a, b, c) = plt.subplots(1, 3, figsize=(7.05, 1.64), gridspec_kw={"width_ratios": [1, 1.25, 1]})

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

# (b) the measured meter: a Business (self_serve_business_prolite) weekly window's integer steps against
# the account's cumulative credits at the published rates (metered weights), two windows, 29 steps
m = d["meter"]
colors = [BLUE, ORANGE]
qhat = m["capacityCredits"]
xmax = max(p["credits"] for w in m["windows"] for p in w["points"]) * 1.04
for w, col in zip(m["windows"], colors):
    xs = [p["credits"] for p in w["points"]]
    ys = [p["u"] for p in w["points"]]
    label = f"window from {w['start'][5:10]} ({w['credits']:.0f} cr)"
    b.step(xs, ys, where="post", color=col, lw=1.1, zorder=3, label=label)
    b.plot(xs, ys, ls="none", marker="o", ms=2.2, color=col, zorder=4)
b.plot([0, xmax], [0, 100 * xmax / qhat], color=INK2, lw=0.7, ls=(0, (3, 2)), zorder=2)
b.text(xmax * 0.03, 100 * xmax * 0.52 / qhat, "fit: $\\hat Q$ = %s credits\nper window" % f"{qhat:,.0f}".replace(",", " "), ha="left", va="top", fontsize=5.8, color=INK2, linespacing=1.3)
w2 = m["windows"][-1]
astra = w2["byModel"].get("gpt-6-astra", 0)
if astra:
    b.text(0.03, 0.96, f"{w2['points'][-1]['u']} points in {w2['credits']:.0f} credits:\nSol 6.1 {100 * w2['byModel']['gpt-6.1-sol'] / w2['credits']:.0f}%, review {100 * w2['byModel']['codex-auto-review'] / w2['credits']:.0f}%, Astra {100 * astra / w2['credits']:.0f}%",
           transform=b.transAxes, fontsize=5.8, color=INK2, va="top", ha="left", linespacing=1.3)
b.set_xlim(0, xmax)
b.set_ylim(0, max(p["u"] for w in m["windows"] for p in w["points"]) * 1.45)
b.set_ylabel("weekly window used, %")
b.set_xlabel("credits at published rates since the window started", labelpad=2)
b.legend(loc="lower right", bbox_to_anchor=(1.0, 0.02), fontsize=5.6, frameon=False, handlelength=1.2, borderpad=0.2)
b.set_title("(b) The meter, measured: %.0f credits per point" % (qhat / 100))

# (c) hours against the number calibration must supply first: the 5-hour window's capacity in credits
sens = d["sensitivity"]
sol = d["sensitivitySol"]
qs = [x["q"] for x in sens]
c.plot(qs, [x["totalMinutes"] / 60 for x in sens], color=BLUE, lw=1.3, zorder=3, label="strong on Astra (as planned)")
c.plot(qs, [x["totalMinutes"] / 60 for x in sol], color=GREEN, lw=1.3, zorder=3, label="strong on Sol 6.1 / xhigh")
c.plot(qs, [x["workMinutes"] / 60 for x in sens], color=MUTED, lw=0.8, ls=(0, (3, 2)), zorder=2)
c.text(298, sens[-1]["workMinutes"] / 60 + 0.25, "work only", ha="right", va="bottom", fontsize=6, color=INK2)
ph = d["priors"]["windowCapacityCredits"][d["priors"]["planType"]]["primary"]
c.axvline(ph, color=INK2, lw=0.6, ls=(0, (1, 1.5)))
c.text(ph + 5, 0.40, f"Team / Plus,\nmeasured: {ph} cr", ha="left", va="top", fontsize=5.8, color=INK2, linespacing=1.2, transform=c.get_xaxis_transform())
c.axvline(d["lastWaitCapacity"], color=BLUE, lw=0.5, ls=(0, (1, 1.5)))
c.text(d["lastWaitCapacity"] + 5, 0.80, f"no waits\nfrom {d['lastWaitCapacity']} cr", ha="left", va="top", fontsize=5.8, color=BLUE, linespacing=1.2, transform=c.get_xaxis_transform())
c.set_ylim(0, max(x["totalMinutes"] for x in d["sensitivity"]) / 60 * 1.08)
c.set_xlim(60, 300)
c.set_ylabel("hours")
c.set_xlabel(r"credits per 5-hour window $\hat Q_1$ (weekly: 6.7 $\hat Q_1$)", labelpad=2)
c.legend(loc="upper right", bbox_to_anchor=(1.0, 1.0), fontsize=5.6, frameon=False, handlelength=1.2, borderpad=0.2)
c.set_title("(c) Hours vs. window capacity")

fig.tight_layout(pad=0.3, w_pad=1.4)
fig.savefig(os.path.join(HERE, "figure.pdf"))
print("wrote figure.pdf")
