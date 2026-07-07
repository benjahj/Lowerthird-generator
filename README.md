# LT Factory

**Turn 16:9 slides into broadcast-ready lower thirds — automatically, offline, and free.**

Drop in a folder of presentation slides and LT Factory rebuilds each one as a
lower third: it keeps logos and frames, re-lays out the text to fill your format
beautifully, and splits long slides into several parts — **without ever changing
a single word.** Everything runs on your own computer; nothing is uploaded.

- Works on **Windows and macOS**
- **No internet required** (only an optional update check)
- **No AI, no API keys, no accounts**
- Export as many **custom formats** as you need, in one click

---

## Table of contents

1. [Download & install](#download--install)
2. [Updating](#updating)
3. [Quick start](#quick-start)
4. [Output formats](#output-formats)
5. [How the text is handled](#how-the-text-is-handled)
6. [Splitting long slides](#splitting-long-slides)
7. [Logos, frames & photo slides](#logos-frames--photo-slides)
8. [Text color](#text-color)
9. [Per-slide controls](#per-slide-controls)
10. [Fullscreen viewer](#fullscreen-viewer)
11. [Projects (.ltproj)](#projects-ltproj)
12. [Exporting](#exporting)
13. [Preferences](#preferences)
14. [Keyboard shortcuts](#keyboard-shortcuts)
15. [Troubleshooting](#troubleshooting)
16. [Privacy](#privacy)
17. [FAQ](#faq)

---

## Download & install

Go to the [**latest release**](https://github.com/benjahj/Lowerthird-generator/releases/latest)
and download the installer for your system.

### Windows
1. Download **LT-Factory-Setup-x.y.z.exe** and run it.
2. Windows SmartScreen may warn the first time because the app is not
   code-signed. Choose **More info → Run anyway**. (This only happens once per
   machine; updates afterwards install silently.)
3. The app installs with a Start-menu shortcut and launches automatically.

### macOS
1. Download **LT-Factory-x.y.z-mac.dmg**, open it, and drag the app to
   **Applications**.
2. Because the app is not notarized, macOS blocks the first launch. Open the
   **Terminal** app and run:
   ```
   xattr -cr "/Applications/LT Factory.app"
   ```
   (On older macOS you can instead right-click the app → **Open**.)
3. Launch it from Applications as normal.

> These one-time warnings appear only because the app is unsigned — it is safe
> and fully open source. See [Troubleshooting](#troubleshooting) for details.

---

## Updating

**Windows** keeps itself up to date. When a new stable version is released, the
app asks:

> *A new version of LT Factory is available. Would you like to update now?*
> **Update now** · **Remind me later**

Choose *Update now* and it downloads in the background and restarts itself.
Beta/pre-release builds are ignored — you are only offered stable versions.

**macOS** does not auto-update; download new versions from the releases page.

---

## Quick start

1. **Start screen** — when the app opens you can:
   - **Continue a recent project** — select it and press **Open**, or
     double-click it.
   - **New project** — pick a folder of slides.
   - **Import files** — choose individual images (or drag them anywhere).
   - **Open project file** — load a saved `.ltproj`.
2. **Choose your formats** — in the **Output** tab at the top, set up the
   output sizes you need (see [Output formats](#output-formats)).
3. **Review the previews** — every slide is analyzed automatically. Click a
   preview (or the ⛶ icon) to see it full screen.
4. **Export** — press **Export** (top-right) → **Save to folder** or
   **Download ZIP**.

Supported image types: **JPG, PNG, WebP, GIF, BMP, AVIF.**

All settings live in the top tabs — **Output**, **Text**, **Frame** — so the
preview area fills the rest of the window. The panel can be collapsed with the
chevron on the right of the tab bar.

---

## Output formats

LT Factory is **not** limited to a fixed "stream + LED" pair. In the **Output**
tab you define **1 to 4 formats**, each with its own:

| Field | Meaning |
|---|---|
| **Name** | A label you choose (e.g. *Stream*, *LED wall*, *Lyrics*, *Vertical*) |
| **Width × Height** | The pixel size of the output |
| **File suffix** | Added to the file name for that format (e.g. `_stream`) |
| **Canvas** | *Strip only*, or a transparent 16:9 frame (see below) |

Use **+ Add format** or the **Quick add** buttons for common sizes. Every format
always carries **exactly the same text** — line breaks and text size adapt
independently to each format, so a wide strip and a narrow one both look right.
Each preview is colour-labelled with its format name and size so you can tell
them apart.

### Canvas: strip vs. transparent 16:9
- **Strip only** — the lower third is exported at exactly the size you set
  (e.g. 1920×216).
- **16:9 top / center / bottom** — the strip is placed on a full transparent
  1920×1080 (or matching 16:9) canvas, at the top, middle, or bottom. The rest
  is transparent, so it drops straight into ProPresenter, vMix, OBS, Resolve,
  etc. as an overlay. These are always exported as **PNG** (for transparency).

---

## How the text is handled

The text on your slides is **never re-typed or re-rendered.** LT Factory finds
the text on each slide through image analysis and cuts it out as small bitmap
pieces, so the **original font, weight, colours, italics and underlines are
preserved pixel-for-pixel.** This is essential for scripture, quotes, names and
anything where the wording must be exact — the app cannot introduce a typo,
because it never reads or rewrites the words.

It then re-arranges those pieces to fill your chosen format. The **Text** tab
controls how:

- **Wrapping**
  - *Auto (best)* — picks the line arrangement that makes the text as large as
    possible.
  - *Rewrap words* — always re-flows words to balance the lines.
  - *Keep lines* — keeps the slide's original line breaks.
  - *One line* — forces everything onto a single line.
- **Alignment** — Centered or Left.
- **Max text size** — how much the text may be enlarged versus the original
  (1×–3×), so small source text can still fill a big format.

---

## Splitting long slides

Slides with a lot of text become **several** lower thirds instead of one cramped
strip. Choose the behaviour under **Text → Split slides**:

- **Auto by length** — splits into as many parts as needed to keep each part
  readable, balancing the amount of text per part. Controlled by
  **Max characters**.
- **One per item** — if the slide is a numbered or bulleted list (`1.` `2.`,
  `•`, `a)` …), each item becomes its own lower third.
- **One per line** — every line on the slide becomes its own lower third.
- **Never split** — always keep the whole slide as one.

Splitting is **content-aware**: it never breaks in the middle of a verse, never
mixes a whole verse with a fragment of the next one, and repeats the scripture
reference (the chip like `John 3:16 (NIV)`) on every part. Parts of the same
slide are grouped together in the preview and numbered `_part1`, `_part2`, …

---

## Logos, frames & photo slides

- **Fixed frame / logo** — LT Factory compares all your slides and detects the
  edges that are identical across the whole deck (a logo bar, a coloured border,
  a watermark). These are **recreated on every lower third**, so nothing looks
  like a crop. You can keep or hide them under **Frame → Fixed frame/logo**, and
  fine-tune the detected edges with the **Frame %** fields.
- **Photo slides** — slides that are mostly a photo are **cropped** to your
  format instead of having text extracted, with automatic focus detection. Use
  the per-slide *vertical* slider to nudge the crop.
- **Page numbers & corner marks** — kept in their corner or removed
  (**Frame → Page numbers**).
- **Background** — *Auto* reuses the slide's own paper/texture as the background
  so it never looks flat; or choose a solid colour.

---

## Text color

Under **Text → Text color** you can repaint **all** text in a single colour
(labels and reference chips keep their original look). You can also override the
colour **per slide** using the colour swatch on each card or in the fullscreen
viewer; the ↺ button returns that slide to the default. If no colour is chosen,
the original slide colours are kept.

---

## Per-slide controls

Each preview card (and the fullscreen viewer) has controls that apply to that
one slide:

| Control | What it does |
|---|---|
| **Wrapping** | Override the global wrapping for this slide (incl. *Crop*) |
| **Lines** | Force a specific number of lines (1–4) or leave it *auto* |
| **vertical** | Move the text/crop up or down (double-click to reset) |
| **colour swatch** | Set this slide's text colour; ↺ resets to default |
| **image: on/off** | Include or drop an embedded photo from the slide |
| **exclude** | Leave this slide out of the export |

---

## Fullscreen viewer

Click any preview or its **⛶** icon to open the fullscreen viewer. There you can:

- See every format stacked and colour-labelled.
- Flip through all slides/parts with the **← →** arrow keys or the on-screen
  arrows.
- Adjust the same per-slide controls right in the viewer.
- Close with **Esc**, the ✕, or a click on the background.

---

## Projects (.ltproj)

A **project** bundles everything into a single portable file:

- all your output formats and settings,
- every per-slide adjustment,
- **and the slide images themselves.**

Because the images are inside the file, a `.ltproj` opens correctly **on any
computer** — move it to another PC and continue exactly where you left off.

- **File → Save / Save as…** writes a `.ltproj` file to a location you choose.
- **File → Open project file…** (or drag a `.ltproj` in) loads one.
- **Recent projects** are listed in the File menu and on the start screen, and
  reopen instantly. The last one you used reopens automatically on launch
  (can be turned off in Preferences).
- A dot (●) next to the project name means there are unsaved changes. Closing
  the app with unsaved changes prompts you to save first.

---

## Exporting

Press **Export** (top-right):

- **Save to folder** — writes one image per slide, per part, per format directly
  into a folder you choose (Chrome/Edge/installed app).
- **Download ZIP** — packages everything into a single ZIP.

File names are built from the slide name + part + format suffix, for example
`slide-03_part1_stream.png`. Transparent 16:9 formats are always PNG; otherwise
you can pick PNG or JPG under **Frame → File type**.

---

## Preferences

Open with **File → Preferences** or **Ctrl+,**:

- **Theme** — Dark, Midnight (pure black/OLED), or Light.
- **Accent** — pick the highlight colour.
- **Reduce motion** — turn off fades and animations.
- **Reopen last project** — resume automatically on launch, or start clean.
- **Default file type** — PNG or JPG for new exports.

All preferences are remembered between sessions.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl + S** | Save project |
| **Ctrl + ,** | Open Preferences |
| **← / →** | Previous / next in the fullscreen viewer |
| **Esc** | Close viewer or dialog |
| Double-click a slider | Reset it |

---

## Troubleshooting

**"Windows protected your PC" / macOS "unidentified developer".**
These appear because the app is not code-signed/notarized (a paid certificate
that a free hobby tool doesn't have). The app is safe and open source. On
Windows choose *More info → Run anyway*; on macOS run the `xattr` command shown
[above](#macos). It's a one-time step per machine.

**A logo looks soft in a short strip.**
Fitting a full 1080-pixel-tall slide into, say, a 216-pixel strip shrinks the
logo about 5×, which softens fine detail — that's unavoidable at that size. If
you need the logo crisp, add a taller format (e.g. 1080p, or a transparent 16:9
canvas) where it isn't shrunk as much.

**A slide split oddly, or the frame was detected wrong.**
Use the per-slide **Wrapping**/**Lines**/**vertical** controls, or adjust the
**Frame %** fields under the Frame tab and press **Re-analyze**.

**One image failed to load.**
Corrupt or unsupported files are skipped automatically with a notice; the rest
of the deck still works.

---

## Privacy

Everything happens **locally on your computer.** Your slides never leave the
machine — there is no upload, no cloud, no analytics, no account. The only
network request the app ever makes is an optional check for a newer version on
GitHub; if you're offline, it simply skips that and keeps working.

---

## FAQ

**Can it change or fix the wording on a slide?**
No — by design. The text is copied as an image, so it is always identical to the
original. This guarantees exact scripture and quotes.

**How many formats can I export at once?**
Up to four, each fully custom. They all carry the same text.

**Do the two/three/four formats always match?**
Yes. The wording is identical across every format; only the line breaks and text
size adapt to each size.

**Can I combine slides from several folders?**
Yes — use **Import files/folder** repeatedly to add to the current set, or
**Clear all** to start over.

**Where are my recent projects stored?**
In the app's local storage on that computer. The portable copy is the `.ltproj`
file you save — that's the one to back up or move between machines.
