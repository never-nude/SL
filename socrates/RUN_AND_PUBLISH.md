# DigitalBrain SOCRATES Transfer Guide

## 1) Run locally on the MacBook Air
```zsh
cd "$(dirname "$0")"
chmod +x DigitalBrain_StimFlow.command
./DigitalBrain_StimFlow.command
```

## 2) Open in Codex desktop
Open this folder in Codex:
- `DigitalBrain_SOCRATES_1772498015`

## 3) Publish to GitHub (existing repo)
If publishing to `never-nude/never-nude.github.io`:
```zsh
cd "$HOME"
git clone https://github.com/never-nude/never-nude.github.io.git
rsync -av --delete \
  --exclude='.git' \
  "<PATH_TO_UNZIPPED>/" \
  "$HOME/never-nude.github.io/"
cd "$HOME/never-nude.github.io"
git add .
git commit -m "SOCRATES milestone build 1772498015"
git push origin main
```

## Notes
- This package intentionally does **not** include a `.git` directory.
- `DigitalBrain_StimFlow.command` opens a cache-busted local URL automatically.
