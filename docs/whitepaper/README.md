# Whitepaper

`relay-whitepaper.pdf` is a one-page note on relay: the problem, the mechanism, the statistical model behind `relay forecast`, and what is not proven yet. Every number in its figure comes from relay's own code, run on `example-plan.md`.

Its scope is implementation orchestration and forecasting. The independent architecture-design workflow is documented in the [design guide](../guides/architecture-design.md). The plan forecast is not an estimate of an open-ended design or research conversation.

## Rebuild

From the repository root:

```bash
RELAY_HOME=$(mktemp -d) node docs/whitepaper/data.mjs > docs/whitepaper/data.json   # a clean home: no live budget reading
python3 docs/whitepaper/figures.py                          # figure.pdf
cd docs/whitepaper && pdflatex -jobname relay-whitepaper whitepaper.tex
```

Needs Node 20+, Python 3 with matplotlib, and a TeX Live with `extsizes`, `mathpazo` and `helvet`. The figure uses TeX Gyre Heros when TeX Live ships it and falls back to the default sans otherwise.

| File | What it is |
|---|---|
| `example-plan.md` | The 30-task plan behind Figure 1. `relay lanes` and `relay forecast` work on it. |
| `data.mjs` → `data.json` | Lane weights and fix-round probabilities, the exact usage distribution over every fix-round outcome, the expected run in time, and the rate sensitivity. Uses relay's model code. |
| `figures.py` → `figure.pdf` | Figure 1. |
| `whitepaper.tex` → `relay-whitepaper.pdf` | The page. |
