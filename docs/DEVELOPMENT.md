# Development

## Layout
```
extension/        Chrome MV3 extension (side panel)
  background.js   service worker: opens the panel, injects page scripts
  sidepanel.*     UI
  merge.js        merges incoming colours into Kirki's variable document
  parse-image.js  OCR-based colour-chart reader (Tesseract, vendored)
  kirki.js        Kirki REST read/write (runs in the page's MAIN world)
  theme.js        light / dark / auto
figma-plugin/     "Palette — Copy colors" Figma plugin
tests/            Node tests + fixtures
tools/            DevTools-console recon scripts used to study the Kirki editor (read-only)
docs/             Documentation
```

## Tests
```bash
npm install
npm test
```
Runs `tests/merge.test.mjs` and `tests/parse-image.test.mjs` (the latter OCRs the fixture charts).

## Loading your changes
Edit files, then press ↻ on the extension in `chrome://extensions` and reopen the panel. Figma plugin changes take effect on the next run.

## Versioning
Keep `package.json` and `extension/manifest.json` versions in sync. Fixes → patch, features → minor.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the Kirki API and data formats.
