# LT Fabrik

**Turn your 16:9 slides into broadcast-ready lower thirds — automatically.**

Drop in a folder of sermon or presentation slides, and LT Fabrik rebuilds each
one as a lower third: logos and frames are kept, the text is re-laid out to fill
the format beautifully, and long slides are split into several parts — without
ever changing a single word. Works fully offline. Free.

## Download & install

**Windows**: download **LT-Fabrik-Setup-x.y.z.exe** from
[Releases](https://github.com/benjahj/Lowerthird-generator/releases/latest) and run it.
The app keeps itself up to date — when a new version is out, it simply asks
*"Would you like to update now?"*
*(Windows SmartScreen may warn the first time: choose "More info" → "Run anyway".)*

**Mac**: download **LT-Fabrik-x.y.z-mac.dmg** from the same page, open it and drag
the app to Applications. On first launch, open Terminal and run
`xattr -cr "/Applications/LT Fabrik.app"` (or right-click → Open on older macOS).

## Getting started

1. **Pick your slides** — click "Change folder location…" once and choose the
   folder where your slide folders live. From then on, your folders appear in
   the left panel; click one, or just drag images into the window.
   (jpg, png, webp, gif, bmp, avif)
2. **Check the previews** — everything is analyzed automatically. Click any
   preview (or the ⛶ icon) to view it full screen and flip through all slides
   with the arrow keys.
3. **Save** — one button exports every lower third. Done.

The app remembers everything between sessions: your settings, your last folder,
and every per-slide adjustment.

## What it does for you

- **Two formats at once** — e.g. 1920×216 for your stream and 936×208 for an
  LED screen. Both always carry exactly the same text; line breaks and text
  size adapt to each format.
- **Transparent 16:9 option** — set *Canvas* to "16:9 · bottom" (or top/center)
  and each file comes out as a full 1920×1080 PNG with a transparent
  background, ready to drop into ProPresenter, vMix, OBS and similar.
- **The text is never altered** — every word is cut from the original slide as
  an image, so typography, colors and underlines stay exactly as designed.
  Perfect for scripture, where wording must be exact.
- **Smart splitting** — slides with lots of text become several lower thirds.
  It never splits mid-verse, never mixes a whole verse with a fragment of the
  next, and the scripture reference is repeated on every part.
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
