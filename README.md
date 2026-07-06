# LT Fabrik — lower thirds from slides

Local app that turns 16:9 slide images into lower thirds in any size you choose.
No AI, no API keys, no dependencies — and it works fully **offline**.

## Install as a Windows app (recommended)

Download **LT-Fabrik-Setup-x.y.z.exe** from
[Releases](https://github.com/benjahj/Lowerthird-generator/releases/latest) and run it.
The app installs with a start-menu shortcut and **keeps itself up to date**: when a
new version is published here, it asks *"Would you like to update now?"* with
**Update now** / **Remind me later**. Everything else works without internet.

- First run: click "Change folder location…" and pick the folder that contains
  your slide folders — the choice is remembered.
- Windows SmartScreen may warn the first time (the installer is unsigned) —
  choose "More info" → "Run anyway".

**Mac**: download **LT-Fabrik-x.y.z-mac.dmg** from the same Releases page, open it
and drag the app to Applications. Because the app is unsigned, macOS blocks the
first launch: open Terminal and run `xattr -cr "/Applications/LT Fabrik.app"`
(or on older macOS: right-click → Open). Auto-update only works on Windows — on
Mac, grab new versions manually from Releases.

**Publish a new version** (developer): bump `"version"` in `package.json`, commit,
and push a tag — GitHub Actions builds both the Windows installer and the Mac DMG
and attaches them to the release:

    git tag v1.2.3 && git push origin v1.2.3

Installed Windows apps will offer the update automatically. (`publish-release.bat`
still works for a Windows-only release from your own machine.)

## How to use it

1. Pick your slide folder in the left panel (folders with images are listed
   automatically), use "Choose files/folder…" or drag images in.
   Supports jpg, png, webp, gif, bmp and avif.
2. Set the size of **Format A** (e.g. stream 1920×216) and optionally
   **Format B** (e.g. LED screen 936×208). Both formats always carry exactly the
   same text — line breaks and text size adapt to each format.
3. Review the previews — click one to see it full size, and adjust per slide if
   needed (wrapping, vertical position, exclude, image on/off).
4. Press **Save all to folder…** (Chrome/Edge) or **Download as ZIP** — one file
   per slide per part per format.

## What it does automatically

- **Fixed frame**: all slides are compared pixel by pixel. Edges that are
  identical across the whole deck (e.g. a logo bar) are recognized as "frame"
  and recreated on every lower third — so nothing looks like a crop. Can be
  fine-tuned under Advanced.
- **Text without AI**: the background color is estimated per slide, and text
  lines/words are found through image analysis. Text is cut out as bitmaps, so
  the original typography, colors and underlines are preserved 1:1 — the text
  itself can never change.
- **Wrapping**: words are rewrapped into the line count that gives the largest
  text in the lower-third format, with balanced line lengths.
- **Background texture**: an empty band from the slide is reused as background,
  so paper texture etc. carries over (mirror-tiled, never smeared).
- **Photo slides**: slides that are mostly photo are cropped to the format
  instead, with automatic focus detection (vertical position adjustable per slide).
- **Corner furniture**: page numbers etc. can be kept in the same corner or removed.
- **Verse-aware splitting**: slides with lots of text are split into several
  lower thirds (limit: "Max characters per part"; wide glyphs count for more).
  It never splits in the middle of a verse (raised verse numbers are detected in
  the image), a whole verse is never mixed with a fragment of another, and the
  scripture chip is repeated on every part. Parts of the same slide are grouped
  in the preview and named `_part1`, `_part2` …

## Tech

- `server.js` — minimal static server + folder API (no npm packages). Also runs
  as a Node SEA executable and as a module inside the Electron app.
- `app.js` — all analysis and rendering in the browser via canvas.
- `electron-main.js` — installable app: window, internal server on a free port,
  auto-update via GitHub Releases.
- Export writes directly to a chosen folder (File System Access API) or builds a ZIP.
- Everything runs locally; the only network access is the optional update check.

### Run from source

`start.bat` (requires Node.js) starts a local server on `http://localhost:8617`.
`build-exe.bat` builds a standalone `LT-Fabrik.exe` (Node SEA) — no installation,
but no auto-update either.
