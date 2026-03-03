# Switchboard — AANG — 20260226-073353

Paste this entire message as the FIRST post in the new thread: Switchboard.

## What this is
- Goal: scanner-like 'lighting up' per stimulus (BOLD-like timecourse)
- Nodes = AAL regions; Edges = coupling (functional connectivity), not axons
- Truth tiers: TEMPLATE_META_ANALYTIC / EMPIRICAL_TASK_FMRI / SIMULATED_PROPAGATION

## Files
- model/switchboard/stimuli.template.json
- model/switchboard/connectivity.spec.json
- model/switchboard/README.md
- model/switchboard/ANCHOR.txt

## ANCHOR (verbatim)

SWITCHBOARD_ANCHOR
TS: 20260226-060216

Repo root: $HOME/dev/never-nude.github.io
Serve (local): python3 -m http.server 1099 --bind 0.0.0.0
Local URLs:
  http://127.0.0.1:1099/model/?cb=...
  http://127.0.0.1:1099/model/mobile/?cb=...

Goal:
- Scanner-like “lighting up” per stimulus (BOLD-like timecourse)
- “Speaking” edges = coupling (not axons)
- Truth tier labels: TEMPLATE vs EMPIRICAL vs SIMULATED

Next steps:
1) Produce TEMPLATE stimulus maps by parcellating NeuroQuery/Neurosynth maps into AAL weights.
2) Produce BASELINE coupling matrix from a small resting-state dataset (starter), then upgrade later.
3) Integrate Switchboard UI into the existing model without breaking the current build.


## README (verbatim)

# Switchboard

This folder defines the *data contracts* for stimulus-driven brain activity.

- **Nodes**: time-varying activation (BOLD-like).
- **Edges**: coupling (functional connectivity), not literal axons.

Truth tiers:
- TEMPLATE_META_ANALYTIC: derived from literature meta-analysis maps (NeuroQuery/Neurosynth).
- EMPIRICAL_TASK_FMRI: derived from a specific OpenNeuro task dataset.
- SIMULATED_PROPAGATION: network diffusion on top of a seed pattern.

Files:
- `stimuli.template.json` — stimulus definitions + seed weights (to be replaced with derived AAL weights)
- `connectivity.spec.json` — contract for coupling matrices
- `ANCHOR.txt` — operational truth probe / “where is the project”

Build marker: 20260226-060216
