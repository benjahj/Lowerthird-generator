# LT Factory

**Turn your 16:9 slides into broadcast-ready lower thirds — automatically.**

Drop in a folder of sermon or presentation slides, and LT Factory rebuilds each
one as a lower third: logos and frames are kept, the text is re-laid out to fill
the format beautifully, and long slides are split into several parts — without
ever changing a single word. Works fully offline. Free.

## Download & install

**Windows**: download **LT-Factory-Setup-x.y.z.exe** from
[Releases](https://github.com/benjahj/Lowerthird-generator/releases/latest) and run it.
The app keeps itself up to date — when a new version is out, it simply asks
*"Would you like to update now?"*
*(Windows SmartScreen may warn the first time: choose "More info" → "Run anyway".)*

**Mac**: download **LT-Factory-x.y.z-mac.dmg** from the same page, open it and drag
the app to Applications. On first launch, open Terminal and run
`xattr -cr "/Applications/LT Factory.app"` (or right-click → Open on older macOS).

## Getting started

1. **Start screen** — open a recent project, start a new one (pick a slides
   folder), or import images. Double-click a recent project or select it and
   press Open.
2. **Adjust up top** — all project settings live in the **Output / Text / Frame**
   tabs at the top; the preview fills the rest of the window.
3. **Check the previews** — everything is analyzed automatically. Click any
   preview (or the ⛶ icon) to view it full screen and flip through with arrow keys.
4. **Export** — the button in the top-right saves every lower third. Done.

The app remembers everything between sessions: your settings, your last folder,
and every per-slide adjustment.

**Projects**: use the **File** menu in the top bar to Save / Save as…, reopen a
recent project, import, or clear. If you close the app with unsaved changes, it
asks whether to save first.

**Preferences** (File → Preferences, or Ctrl+,): choose a theme (Dark, Midnight,
Light), an accent color, toggle reduced motion, decide whether to reopen your
last project on launch, and set the default export file type.

## What it does for you

- **Your own formats (1–4)** — in the **Output** tab, define as many output
  formats as you need, each with its own name, size, file suffix and canvas
  (not locked to "stream/LED"). Every format always carries exactly the same
  text; line breaks and size adapt to each. Each preview is colour-labelled so
  you can tell them apart.
- **Transparent 16:9 option** — set *Canvas* to "16:9 · bottom" (or top/center)
  and each file comes out as a full 1920×1080 PNG with a transparent
  background, ready to drop into ProPresenter, vMix, OBS and similar.
- **The text is never altered** — every word is cut from the original slide as
  an image, so typography, colors and underlines stay exactly as designed.
  Perfect for scripture, where wording must be exact.
- **Smart splitting** — slides with lots of text become several lower thirds.
  Choose how in the **Text** tab: *Auto by length*, *One per item* (numbered or
  bulleted lists — 1. 2. •), or *One per line*. It never splits mid-verse, never
  mixes a whole verse with a fragment of the next, and the scripture reference is
  repeated on every part.
- **Logos stay put** — anything that is identical on every slide (logo bars,
  frames) is detected and recreated on every lower third, so nothing looks
  like a crop.
- **Photo slides** — slides that are mostly photo are cropped to the format
  with automatic focus detection.

## Handy controls

| Control | What it does |
|---|---|
| Click a preview / ⛶ | Full-screen view; ← → to flip through, Esc to close. All per-slide controls are available right in the viewer |
| Wrapping (per slide) | Auto, rewrap words, keep original lines, one line, or crop |
| vertical slider | Nudge the text/crop up or down (double-click resets) |
| Text color | Repaint all text in one color — globally or per slide (labels keep their original look) |
| image: on/off | Include or drop an embedded photo from the slide |
| exclude | Leave a slide out of the export |
| Clear / Add | Clear the loaded set, or add more images in several rounds |
| Max characters per part | How much text one lower third may hold before splitting |

Everything runs on your own computer — no internet needed, nothing is uploaded
anywhere.
