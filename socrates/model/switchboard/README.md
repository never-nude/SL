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
