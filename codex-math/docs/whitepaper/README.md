# Whitepaper: relay on Codex

`relay-codex-whitepaper.pdf` is the Codex counterpart of `docs/whitepaper/relay-whitepaper.pdf`: what the Codex harness meters (read from the binary with REA), what that changes in relay's mechanism, the model behind the Codex forecast and its calibration, and what is not claimed. Every number in its figure comes from the model code in `codex-math/lib/`, run on the same 30-task `example-plan.md` as the relay whitepaper, and (Figure 1b) from the live readings in `codex-math/evidence/live/`.

## Rebuild

From the repository root:

```bash
node codex-math/docs/whitepaper/data.mjs > codex-math/docs/whitepaper/data.json
python3 codex-math/docs/whitepaper/figures.py                                   # figure.pdf
cd codex-math/docs/whitepaper && pdflatex -jobname relay-codex-whitepaper whitepaper.tex
```

Needs Node 22+, Python 3 with matplotlib, and a TeX Live with `extsizes`, `mathpazo` and `helvet`. `node --test codex-math/test/*.test.mjs` checks that the page quotes what the model computes.

| File | What it is |
|---|---|
| `example-plan.md` | The 30-task plan behind Figure 1 (a copy of `docs/whitepaper/example-plan.md`). |
| `data.mjs` → `data.json` | Tier prices, lane credits, the exact credit distribution over every fix-round outcome, the walk on a Team/Plus account at the measured capacities, the capacity sensitivity, the Sol-6.1-as-strong alternative, and the measured meter (Figure 1b) computed from `evidence/live/readings.json` with `lib/calibration.mjs`. |
| `figures.py` → `figure.pdf` | Figure 1. |
| `whitepaper.tex` → `relay-codex-whitepaper.pdf` | The page. |
