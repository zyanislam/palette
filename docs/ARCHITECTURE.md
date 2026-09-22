# Palette — Handover

Bring color variables from **Figma** or from an **image of a color chart** into **Kirki's Variables**, with names, hex, opacity and modes, in as few clicks as possible.

Status: **v1.0.0 built** — merge (10 tests), image import (15/15 on the sample chart), side panel, Figma plugin, end-to-end test against a mock Kirki. Version **1.1.0** (1.0.0 = first build; 1.1.0 = live update + sync) (user controls bumps: fixes → patch, features → minor).

---

## 1. Goals

- **Figma → Kirki in two actions**: run the Figma plugin (it copies and closes), then click **Import** in the Kirki side panel.
- **Image → Kirki**: paste or drop a color-chart screenshot; names, groups, hex and opacity are read automatically.
- **Always review before writing**: every color is selected by default and can be deselected (per row and per group).
- **Modes supported** (Kirki has modes; Figma modes and image columns map to them).
- **Existing Kirki variables are never replaced or removed** (decided). Incoming colours whose name already exists are **still added** as new variables with the same name; the user reviews duplicates later in Kirki.
- **Never lose data**: read, then merge, then write, with a local backup and **Undo import**.

Non-goals (v1): numbers, text styles, fonts, shadows. The design leaves room to add them later.

---

## 2. Components

```
┌──────────────┐  clipboard (tagged JSON)  ┌───────────────────────────┐   REST (nonce)   ┌────────┐
│ Figma plugin │ ────────────────────────▶ │ Chrome extension          │ ───────────────▶ │ Kirki  │
│ "Copy colors"│                           │ side panel on Kirki editor│ ◀─────────────── │  (WP)  │
└──────────────┘      image (paste/drop) ─▶│  • parse • review • merge │   read current   └────────┘
                                           └───────────────────────────┘
```

### 2.1 Figma plugin: "Palette — Copy colors"
- **No UI.** On run:
  1. `figma.variables.getLocalVariableCollectionsAsync()` and `getLocalVariablesAsync('COLOR')`.
  2. Resolve aliases to their final value per mode (follow `VARIABLE_ALIAS` chains, with cycle guard).
  3. Build the payload (§4.1), `figma.ui` is hidden; copy via a hidden iframe (`document.execCommand('copy')`), because plugins have no direct clipboard API.
  4. `figma.notify('Copied 15 colors to Palette')`, then `figma.closePlugin()`.
- Works on **all Figma plans** (plugin API, not the Enterprise-only REST API).
- Launch: ⌘/ → "Copy colors", or right-click → Plugins.
- Published privately or as a development plugin (manifest `editorType: ["figma"]`, no network access needed).

### 2.2 Chrome extension (MV3, side panel)
- Permissions: `sidePanel`, `scripting`, `activeTab`, `tabs`, `storage`, `clipboardRead`.
- Active only on Kirki editor URLs (`?action=kirki`).
- The panel opens → reads the clipboard → if a Palette payload is found, goes straight to Review. Otherwise it shows the empty state: "Paste an image or run the Figma plugin".
- Kirki calls run in the page (MAIN world via `chrome.scripting`) so they use the user's session and nonce.

---

## 3. Kirki API (confirmed on hola.kirki.io)

| Action | Request |
|---|---|
| Read | `GET /wp-json/kirki/v1/global-ui-saved-data?_method=get` → `{data:{globalColors, shadows, variableData}, success}` |
| Write | `POST /wp-json/kirki/v1/global-ui-saved-data?_method=put`, multipart form field `data` = JSON `{globalColors, shadows, variableData}` |
| Auth | header `x-wp-nonce` (from `wpApiSettings.nonce` or equivalent in the editor page), `credentials: include` |
| Ignore | `global-ui-controller` (editor UI state), `installed-app-list` |

### 3.1 Data shape
```jsonc
variableData.data = [
  { "title":"Colors", "key":"color",
    "modes":[{"title":"Default","key":"default"},{"title":"New Mode","key":"k-mzmrz83q"}],
    "variables":[
      {"id":"k-1pok7dpi","title":"Test","type":"color",
       "value":{"default":"rgba(250, 88, 13, 0.8)","k-mzmrz83q":"rgba(35, 22, 16, 0.8)"}}
    ]},
  { "title":"Numbers", "key":"size", ... },
  { "title":"Text Styles", "key":"text-style", ... },
  { "title":"Font Family", "key":"font-family", ... }
]
```
Facts:
- **The write replaces the whole document.** Always send everything back.
- Colors are `rgba(r, g, b, a)` strings (Kirki writes `1.00` or `0.8`; either format is accepted).
- Ids and mode keys are `k-` + 8 chars `[a-z0-9]` and must be unique. Variables are used as CSS `var(--k-xxxxxxxx)`.
- **Modes are shared**: adding a mode adds `{title,key}` to **every** collection.
- A variable may lack a value for a mode (Kirki falls back to default). We fill every mode anyway.
- The Colors collection is **flat** (no folders).

---

## 4. Data flow

### 4.1 Internal format (from both Figma and image)
```jsonc
{ "hx": "palette/1", "source": "figma" | "image",
  "modes": ["Light", "Dark"],                 // first = maps to Kirki default
  "colors": [
    { "name": "Text 02", "group": "Color/Text",
      "values": { "Light": {"hex":"000000","a":0.8}, "Dark": {"hex":"FFFFFF","a":0.8} },
      "confidence": 1, "flags": [] }
  ] }
```
The clipboard text is prefixed with `PALETTE1:` so the panel can recognise it instantly.

### 4.2 Import algorithm
1. **Read** current data (GET). Save a backup to `chrome.storage.local` under `backup:<host>:<timestamp>` (keep the last 5).
2. **Map modes**: incoming mode 1 → `default`. Others match existing Kirki modes by title (case-insensitive). If there's no match, the user chooses **Create "Dark"** or picks an existing mode.
3. **New modes** get a generated key, which is appended to `modes` in **all four** collections.
4. **Each selected color:**
   - Kirki title = naming rule (§6). Always → **New** variable with a generated id. Existing variables are never touched. If the title already exists in Kirki, the row gets a small "Same name exists" note (still selected by default).
   - `value[modeKey] = rgba(...)` for each mapped mode. For any Kirki mode without incoming data, copy the default value.
5. **Write** (PUT) the full document. Check `success:true`.
6. **Reload the editor** so Kirki's in-memory copy doesn't overwrite the import on its next save. If Kirki shows unsaved changes, ask first: "Save your work in Kirki first".
7. Toast: "Added 15 · 3 share a name with existing variables · Undo". Undo writes the backup back and reloads.

---

## 5. Image import

Input: paste (⌘V), drag and drop, or a file picker. PNG, JPG and WebP.

Pipeline (all local and offline, no API key):
1. Upscale ×2 if small, then grayscale plus threshold for OCR.
2. **Tesseract.js** (bundled worker, English) → words with bounding boxes.
3. **Row detection**: group words by line (y-overlap). Classify tokens:
   - hex: `/^#?[0-9A-F]{6}([0-9A-F]{2})?$/i`
   - percent: `/^\d{1,3}\s*%$/`, or a number followed by a `%` token
   - group heading: a line with `/` and no hex (e.g. `Color / Text`)
   - column header: a top line with no hex (`Name`, `Desktop`, `Dark`…). Columns other than "Name" become **modes**, matched by x-position.
   - name: the remaining text left of the first hex.
4. **Swatch check**: sample the pixels just left of each hex (the most common non-background colour) and compare with the hex that was read. If ΔE > 6 → flag ⚠️ "Check colour". This catches OCR errors like 0↔D and 8↔B.
5. **No hex text** (swatch-only charts): use the sampled colour with alpha 1, flagged "Estimated from image".
6. OCR fixes: O→0, I/l→1 inside hex tokens, and trim stray characters.

Tested against the user's sample chart: expected **15 colours** (2 ungrouped, 8 in Color/Text, 5 in Color/BG), mode "Desktop", with opacity 80/60/30% on Text 02–04 and Text light 02–04.

Later (optional setting): AI vision fallback for messy screenshots (needs an API key).

---

## 6. Naming rule (decided: smart)

Kirki Colors is flat. Kirki uses the id in CSS, so the title is only a label (Variables panel and colour picker).
- Use the **plain name** (`Text 02`).
- Only when two **incoming** colours would get the same name, prefix the last group segment (`Light/Primary`, `Dark/Primary`).
- If the name already contains the group word, never repeat it (no `Text/Text 02`).
- Names can be edited inline on the review screen. The ⋮ menu offers: Smart (default) / Name only / Full path.

---

## 7. UI (same style as H of x: Inter, DM Sans for values, violet #5641F4, light/dark/auto)

**Empty state**: a drop zone with the text "Paste or drop a color chart", or "Run *Copy colors* in Figma", plus a small hint that shows the ⌘/ shortcut.

**Review screen**:
- Header: "15 colors · 1 mode" and the source (Figma / Image).
- Group sections (collapsible, one toggle per group). Rows show: checkbox (on), swatch (checkerboard behind it when alpha < 1), editable name, `FA580D`, `80%`, a small "Same name exists" note when Kirki already has that name (still added), and ⚠️ flags.
- **Modes bar** (only if there's more than one mode or it isn't the default): `Desktop → Default ▾`, `Dark → Create new ▾`.
- Sticky footer: a primary **Add 15 variables** button (the count updates live).

**Done**: a toast plus **Undo import**.

⋮ menu: naming rule, theme, restore backups, clear.

---

## 8. Edge cases

- The nonce has expired → re-read it from the page. If that fails, show "Reload the Kirki tab".
- Not a Kirki editor tab → the panel says so.
- Figma variables of type other than COLOR are ignored (v1).
- Alias to a variable in another library/file → use Figma's resolved value where available. Otherwise flag it.
- Two incoming colours with the same final name → the second gets a ` (2)` suffix and a flag.
- An image with no recognisable rows → "Couldn't find colours. Try a tighter crop".
- A very large palette (200+) → virtualised list.

---

## 9. Files (planned)

```
palette/
  extension/
    manifest.json  sidepanel.html/.css/.js  theme.js
    kirki.js        // MAIN-world read/merge/write/reload
    parse-figma.js  // clipboard payload → internal format
    parse-image.js  // OCR + layout + swatch check
    merge.js        // pure: (kirkiData, incoming, mapping) → newData   ← unit-tested
    vendor/tesseract/ (worker + eng traineddata)
    icons/ brand/ fonts/
  figma-plugin/
    manifest.json  code.js  ui.html (hidden copy helper)
  tests/
    merge.test.mjs  parse-image.test.mjs (user's chart as fixture)  figma-payload.test.mjs
  handover.md
```

## 10. Build order

1. `merge.js` + tests (against the real Kirki JSON captured in §3).
2. Kirki read/write + reload + backup/undo in the extension, with a hard-coded payload.
3. Review UI.
4. Figma plugin + clipboard detection.
5. Image import (Tesseract + swatch check) + fixture test.
6. Polish, icons, zip.

## 11. Open questions

1. Naming rule: A, B or C (§6)?
2. ~~Name~~ → **Palette**. Logo: **white squircle with the Kirki logo inside** (need the official Kirki SVG from the user).
3. ~~Update behaviour~~ → decided: existing variables are kept as they are; same-name colours are added alongside them.


---

## 12. Build notes (v1.0.0)

- Image OCR: two passes. Pass 1 = sparse text (PSM 11) on a 2× thresholded copy to find rows/columns. Pass 2 = re-read each name and hex cell alone (PSM 7; hex with a `0-9A-F#` whitelist).
- **The typed hex wins over the swatch** — screenshots shift colours through display profiles (sample: swatch read E7632E, real FA580D). The swatch is used only (a) to fix look-alike glyphs (0/C/D, 8/B…) when a look-alike reading matches it far better, (b) as a flagged estimate when no hex can be read.
- Group slash: Figma draws the " / " faintly; if OCR drops it, a wide gap between words is treated as a slash.
- "BG01" → "BG 01" when other names in the chart use a space before the number.
- Clipboard: the panel reads the clipboard when it gains focus (Figma payload `PALETTE1:` or an image); ⌘V always works. The same clipboard content is not re-offered after import/clear.
- After writing, the editor reloads so Kirki's in-memory copy can't overwrite the import. A backup (last 5 per site) is stored before every import; toast Undo + ⋮ → Restore a backup.
- Nonce: `wpApiSettings.nonce` → Kirki globals → `admin-ajax.php?action=rest-nonce`.
- Tests: `npm i && npm test` in `palette/` (merge + image). End-to-end harness (mock Kirki server + real extension) lives outside the zip.

### 12.1 Image reading v2 (tested on a 3-mode JPEG chart, 33 colours × 3 modes)
- Preprocess: grayscale + bilinear upscale (×3 below 1100 px wide, ×2 below 1800, else ×1.5), gamma 2.4 so faint grey text darkens, coloured swatch pixels blanked so they don't merge with the codes. No hard threshold.
- Header found by a fuzzy "Name" match, or as the row just above the first colour row.
- Opacity is re-read on its own (digits-only). If one column misses it, it's borrowed from a sibling column with the same colour (or when that column's swatch shows a checkerboard).
- An unreadable code in one column takes the matching code from a sibling column when the swatches agree.
- Headings are re-read from the table's left edge so "Color /" is kept.
- Shared pipeline `PaletteImage.readChart()` is used by both the panel and the tests.

### 12.2 Optimisation pass
- **Batched OCR:** cells needing a second look are cropped and stacked into one strip per kind (names / codes / opacity) → 4 OCR calls instead of ~230. 33×3 chart: 100 s → ~8 s.
- Two readings of a code that disagree strongly (6↔E) are settled by the swatch; small disagreements keep the focused reading.
- A focused name reading may never drop a word the first pass saw ("White 5").
- **Size:** one SIMD core (`tesseract-core-simd-lstm.js` + `.wasm`, next to the worker) instead of three base64 variants: extension 15 MB → ~6 MB.
- Reader is pre-warmed 1.5 s after the panel opens in Kirki and freed after 3 min idle.

### 12.3 Live update (no reload) + motion
- Recon (kirki-recon-3.js) found the owner: a React `useState` hook whose state **is** `variableData` (the same object the canvas receives as a prop). Editing a variable in Kirki calls its dispatch with the full new `variableData`, and Kirki then saves it itself.
- `kirki.js` finds that hook by identity (canvas prop → walk all React roots, including the canvas iframes → hook whose `memoizedState === variableData` with a `queue.dispatch`).
- Import: merge into the editor's **in-memory** variables (`liveState`), dispatch them (`live`), then poll GET for up to 3 s to confirm Kirki saved the new ids. If it didn't, Palette saves them itself. If the hook can't be found (Kirki update), it falls back to save + reload. Undo uses the same path.
- Motion: glowing Webflow-style progress bar (sweep, glowing head, eased/creeping progress, %), breathing logo, staggered entrance of the review list; honours reduced-motion.

### 12.4 Live update fixes
- Kirki keeps more than one in-memory copy (canvas state + a cache the Variables panel reads when it opens). Palette now updates the old variableData object **in place** (so every cache sees it) and dispatches to **every** hook holding it (directly or as `.variableData`).
- No more polling: Palette listens for Kirki's own save request (fetch/XHR to global-ui-saved-data PUT) and finishes the moment it completes; if Kirki doesn't save within 2.5 s, Palette saves. Typical Add time ≈ under 1 s (was 15–20 s from repeated GETs).
- The component search runs once per import (result reused by the live step).
- Loading bar: glowing dot removed; soft glow on the bar itself + light sweep.

### 12.5 Sync mode (v1.1.0)
- Every imported colour gets a **source key** (Figma: `figma:<fileKey>:<variableId>`; image: `image:<group>/<name>`), stored per site in `chrome.storage.local` as `links:<host>` → Kirki variable id.
- On the next import from the same source, `merge.classify()` marks each colour **new** (ticked), **changed** (unticked — updates are opt-in, shows "was …"), or **up to date** (hidden in a collapsed "N already up to date" list). Linked variables that are no longer in the source are listed as "No longer in the source" and **kept** in Kirki.
- A ticked change updates only that variable's values for the mapped modes (other modes keep their values). Button reads "Add N · Update M". Tests: 12 merge tests incl. classify + update; e2e re-import (1 new, 1 changed, 2 up to date).
