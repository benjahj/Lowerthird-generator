# LT Fabrik — lower thirds fra slides

Lokal web-app der laver 16:9-slides om til lower thirds i valgfri størrelse.
Ingen AI, ingen API-nøgler, ingen dependencies — kun Node.js og en browser.

## Sådan bruges den

1. Dobbeltklik på **start.bat** (kræver Node.js) — eller byg/brug **LT-Fabrik.exe**
   (se nedenfor), som ikke kræver noget installeret. Browseren åbner på `http://localhost:8617`.
2. Vælg din slide-mappe i venstre side (mapper med billeder i projektmappen vises automatisk),
   brug "Vælg filer/mappe…" eller træk billeder ind. Understøtter jpg, png, webp, gif, bmp og avif.
3. Indtast størrelsen på **Format A** (fx stream 1920×216) og evt. **Format B** (fx LED 936×208).
   Teksten ombrydes ens på begge formater — aldrig mere tekst på det ene end det andet.
4. Kig previews igennem — justér pr. slide hvis nødvendigt (ombrydning, lodret placering, udelad).
5. Tryk **Gem alle i mappe…** (Chrome/Edge) eller **Download som ZIP** — én fil pr. slide pr. format.

## Hvad den gør automatisk

- **Fast ramme**: Alle slides sammenlignes pixel for pixel. Kanter der er ens på tværs af
  hele decket (fx logo-søjlen i højre side) genkendes som "ramme" og genskabes på hver
  lower third — så det ikke ser ud som et udklip. Kan finjusteres i panelet.
- **Tekst uden AI**: Baggrundsfarven estimeres pr. slide, og tekstlinjer/ord findes via
  billedanalyse. Teksten klippes ud som bitmaps, så den originale typografi, farver og
  understregninger bevares 1:1.
- **Ombrydning**: Ordene ombrydes til det antal linjer, der giver den største tekst i
  lower third-formatet. "Auto" foretrækker de originale linjeskift, når de er næsten
  lige så gode.
- **Baggrundstekstur**: Et tomt bånd fra sliden genbruges som baggrund, så papir-tekstur
  o.l. følger med (spejl-fliselagt, aldrig udtværet).
- **Foto-slides**: Slides der mest består af foto beskæres pænt til formatet i stedet
  (lodret placering kan justeres pr. slide).
- **Hjørne-elementer**: Sidetal o.l. kan beholdes i samme hjørne eller fjernes.
- **Vers-bevidst opdeling**: Slides med meget tekst deles i flere lower thirds
  (grænse: "Max tegn pr. del", brede tegn tæller mere). Der deles aldrig midt i
  et vers (hævede versnumre detekteres i billedet), et helt vers blandes aldrig
  med en stump af et andet, og skriftsteds-chippen gentages på alle dele. Dele
  af samme slide vises grupperet i preview og navngives `_del1`, `_del2` …
- **Pr. slide**: ombrydning, lodret placering, udelad — og indlejrede billeder
  kan slås fra ("billede: til/fra"), hvis beskæringen bliver skæv.

## Installér som Windows-program (anbefalet)

Hent **LT-Fabrik-Setup-x.y.z.exe** under
[Releases](https://github.com/benjahj/Lowerthird-generator/releases/latest) og kør den.
Programmet installeres med startmenu-genvej og **opdaterer sig selv automatisk**,
når der udgives en ny version her på GitHub.

- Første gang: tryk "Skift mappe-placering…" og vælg den mappe, hvor dine
  slide-mapper ligger — valget huskes.
- Windows SmartScreen kan advare første gang (installeren er usigneret) —
  vælg "Flere oplysninger" → "Kør alligevel".

**Udgiv en ny version** (udvikler): ret `"version"` i `package.json`, og kør
`publish-release.bat`. Den bygger installeren og lægger den på GitHub Releases —
alle installerede apps opdaterer sig selv derefter.

## Alternativ: enkelt exe uden installation

Kør **build-exe.bat** (kræver Node 22+). Det laver `LT-Fabrik.exe` (Node SEA),
som kan lægges direkte i en mappe med slide-mapper og dobbeltklikkes — ingen
installation, men heller ingen auto-opdatering.

## Teknik

- `server.js` — minimal statisk server + mappe-API (ingen npm-pakker).
- `app.js` — al analyse og rendering i browseren via canvas.
- Eksport skriver direkte til en valgt mappe (File System Access API) eller bygger en ZIP.
