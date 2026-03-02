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
- Large generated catalog extension in `catalog_generated.js`
- Storage boundary only in `storage.js`
- Pool control in `pools.js`
- Cross-media graph seed in `graph_seed.js` + `graph.js`
- Artwork overrides in `artwork_overrides.js` (loaded before `artwork.js`)
- Generated artwork override extension in `artwork_overrides_generated.js`

## Artwork Sweep

To rescrape poster/cover artwork for all catalog titles:

```bash
cd "/Users/michael/Documents/New project/screenlit"
node scripts/scrub_artwork.js --refresh
```

Generated files:

- `artwork_overrides.js`: static map of `titleId -> imageUrl`
- `artwork_scrub_report.json`: coverage + missing list

## Mass Catalog Build

To generate the large catalog (2k+ titles) with matched cover/poster overrides:

```bash
cd "/Users/michael/Documents/New project/screenlit"
python3 scripts/build_mass_catalog.py
```

Generated files:

- `catalog_generated.js`: appended title list
- `artwork_overrides_generated.js`: image URL map for generated titles
- `catalog_build_report.json`: counts and build metadata

Automatic weekly refresh is configured in:

- `.github/workflows/catalog-refresh.yml`

## Behavioral guarantees

- Index replaces only the acted-on slot.
- Discover accepts input only on center tile.
- Left tile in Discover is clickable for retreat/revision.
- Motion uses opacity transitions only.
