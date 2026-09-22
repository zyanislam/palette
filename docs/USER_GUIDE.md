# Palette — User Guide

## 1. Install

### Chrome extension
1. Get the code (clone this repo or unzip a release) into a folder you'll keep.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension` folder.
5. Click the puzzle icon in the toolbar and **pin** Palette.

To update later: pull/replace the files, then press the ↻ reload button on the Palette card in `chrome://extensions`.

### Figma plugin (optional — only for Figma imports)
1. Open the **Figma desktop app**.
2. **Plugins → Development → Import plugin from manifest…**
3. Choose `figma-plugin/manifest.json`.

The plugin works on all Figma plans and has no network access.

## 2. Open the panel
1. Log in to WordPress and open a page in the **Kirki editor** (URL contains `?action=kirki`).
2. Click the **Palette** icon — the side panel opens on the right.

The panel only works on Kirki editor pages, because it uses your logged-in editor session to read and save variables.

## 3. Import from Figma
1. In Figma, open the file that contains your colour variables.
2. Run **Palette — Copy colors** (press **⌘/** or **Ctrl+/**, type "Palette", Enter). It copies and closes; a toast shows how many colours were copied.
3. Switch to Kirki and open the Palette panel. The colours are picked up from the clipboard automatically (allow clipboard access if Chrome asks).
4. Review (see §5) and click **Add N variables**.

Aliased variables are resolved to their final colour for each mode.

## 4. Import from an image
1. Take a screenshot of a colour table/chart (name, hex, opacity columns; one column per mode is fine).
2. With the panel focused, **paste (⌘V / Ctrl+V)** or **drag and drop** the image onto it.
3. Text is read on your device — nothing is uploaded.
4. Check the results carefully, fix anything misread, then click **Add N variables**.

Tips for better reading: use a sharp, un-scaled screenshot, with good contrast and hex values visible as text.

## 5. Review before adding
- Every colour is selected by default. Untick single rows or whole groups you don't want.
- Check the **mode mapping** — which source mode goes to which Kirki mode. New modes can be created.
- Colours whose name already exists in Kirki are **marked**; they are added alongside the existing one, never overwriting it.
- Click **Add N variables**. Kirki updates with the new variables.

## 6. Undo and backups
- Every import saves a backup first.
- Click **Undo** in the confirmation toast to revert immediately.
- Later: panel menu **⋮ → Restore a backup…** and pick a point in time.

## 7. Troubleshooting
| Problem | Fix |
|---|---|
| Panel says it's not a Kirki page | Open the editor page (`?action=kirki`) and reload it. |
| Figma colours don't appear | Re-run the Figma plugin, then click into the panel so it can read the clipboard; allow clipboard permission. |
| Save fails / 403 | Your WordPress session expired — reload the editor and log in again. |
| Image values are wrong | Use a higher-resolution screenshot; edit the rows before adding. |
| Changes not visible in Kirki | Reload the editor page. |
| Extension not updating | Reload it in `chrome://extensions`. |

## 8. Privacy
Palette has no server. Image reading runs locally; data goes only between your browser and your own WordPress site. Backups are stored in Chrome's local extension storage.
