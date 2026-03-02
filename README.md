# ScreenLit (clean working surface)

This folder contains a focused ScreenLit build aligned to the instrument model:

- `index.html`: fixed 3x3 Index workbench
- `discover.html`: fixed 3-slot Discover conveyor
- `entry.html`: Guest vs Profile lane selector

## Run locally

```bash
cd "/Users/michael/Documents/New project/screenlit"
python3 -m http.server 8147
```

Open:

- `http://127.0.0.1:8147/index.html`
- `http://127.0.0.1:8147/discover.html`
- `http://127.0.0.1:8147/entry.html`

## Architecture seams

- Shared catalog source: `window.SL_CATALOG` in `catalog.js`
- Storage boundary only in `storage.js`
- Pool control in `pools.js`
- Cross-media graph seed in `graph_seed.js` + `graph.js`

## Behavioral guarantees

- Index replaces only the acted-on slot.
- Discover accepts input only on center tile.
- Left tile in Discover is clickable for retreat/revision.
- Motion uses opacity transitions only.
