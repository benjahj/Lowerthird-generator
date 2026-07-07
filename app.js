// LT Fabrik — laver lower thirds ud fra 16:9-slides. Ingen AI, ingen dependencies.
// Pipeline: (1) find den faste ramme ved at sammenligne alle slides,
// (2) find baggrundsfarve + tekstlinjer/ord pr. slide via billedanalyse,
// (3) klip tekst ud som bitmaps og ombryd dem, så de fylder lower third-formatet bedst.
// Ombrydningen vælges ÉN gang på tværs af alle aktive formater (stream + LED),
// så begge altid viser præcis samme tekst med samme linjeskift.
'use strict';

/* ---------------------------------- state ---------------------------------- */

const AW = 480;   // analyse-opløsning (bredde)
const AH = 270;   // analyse-opløsning (højde) — alle slides analyseres i dette net

const S = {
  slides: [],        // {name, src, w, h, small(ImageData), ana, ov:{mode,off,on}}
  frame: { l: 0, r: 0, t: 0, b: 0 }, // fast ramme, brøkdele af slide-dimensioner
  deckName: '',
  analyzed: false,
  renderToken: 0,
  manualFrame: false,
  formats: null, // frie output-formater (sat i init)
};

const $ = (id) => document.getElementById(id);

/* ------------------------------- små hjælpere ------------------------------ */

function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', !!err);
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 3800);
}

function setStatus(txt, busy = false, frac = null) {
  $('statusText').textContent = txt;
  $('tally').classList.toggle('busy', busy);
  const p = $('progress');
  p.classList.toggle('on', frac !== null);
  if (frac !== null) p.firstElementChild.style.width = Math.round(frac * 100) + '%';
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[a.length >> 1];
}

const debounce = (fn, ms) => {
  let h;
  return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
};

/* ------------------------------ bitmap-cache ------------------------------- */
// Fuldopløsnings-bitmaps dekodes on demand og genbruges via en lille LRU-cache,
// så store decks ikke æder al hukommelse.

// nøglen er selve slide-objektet (identitet) — et nyt deck med samme filnavne
// kan derfor aldrig få et gammelt decks bitmap serveret
const bmpCache = new Map();
let bmpTick = 0;

async function getBitmap(slide) {
  const hit = bmpCache.get(slide);
  if (hit) { hit.t = ++bmpTick; return hit.bmp; }
  let blob;
  if (slide.src.file) blob = slide.src.file;
  else blob = await (await fetch(slide.src.url)).blob();
  const bmp = await createImageBitmap(blob);
  bmpCache.set(slide, { bmp, t: ++bmpTick });
  if (bmpCache.size > 12) {
    let oldest = null;
    for (const [k, v] of bmpCache) if (!oldest || v.t < bmpCache.get(oldest).t) oldest = k;
    bmpCache.get(oldest).bmp.close();
    bmpCache.delete(oldest);
  }
  return bmp;
}

/* -------------------------------- indlæsning ------------------------------- */

// Ved opstart: genåbn sidste projekt (hvis slået til), ellers vis start-skærmen.
// Appen scanner IKKE selv PC'en for slides — man importerer dem selv.
async function loadServerFolders() {
  if (!S.slides.length && loadPrefs().reopen) {
    const recents = (await idbAll()).sort((a, b) => b.savedAt - a.savedAt);
    if (recents[0] && recents[0].blob) {
      hideStart();
      try { await openProjectBlob(recents[0].blob, recents[0].handle || null); return; }
      catch { /* faldt igennem — vis start */ }
    }
  }
  showStart();
}

// bruges kun af automatiserede tests (debug-hook) — loader en server-mappe direkte
async function loadServerFolder(dir, override) {
  const res = await fetch('/api/files?dir=' + encodeURIComponent(dir));
  const files = res.ok ? await res.json() : null;
  if (!Array.isArray(files) || !files.length) {
    toast('The folder could not be read — has it been moved or deleted?', true);
    return false;
  }
  const slides = files.map((name) => ({
    name,
    src: { url: dir.split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(name) },
    ov: { mode: 'auto', off: 0, on: true, img: true },
  }));
  S.deckName = dir.split('/').pop();
  S.deckKey = dir;
  try { localStorage.setItem('ltfabrik.lastFolder', dir); } catch { /* privat browsing */ }
  document.querySelectorAll('.folder-item').forEach((x) => x.classList.toggle('on', x.dataset.dir === dir));
  // per-slide justeringer: fra projektet (override) eller sidste session
  let saved = override || null;
  if (!saved) {
    try { saved = JSON.parse(localStorage.getItem('ltfabrik.deck.' + dir)); } catch { /* ignorér */ }
  }
  if (saved && saved.ov) {
    for (const sl of slides) {
      const o = saved.ov[sl.name];
      if (o) sl.ov = { ...sl.ov, ...o };
    }
  }
  await ingest(slides, saved && saved.frame ? saved.frame : null);
  return true;
}

/* --------------------------------- projekter -------------------------------- */
// Et projekt gemmes som en selvstændig .ltproj-FIL (en pakket container med
// alle indstillinger + per-slide justeringer + selve billederne). Filen kan
// flyttes til en anden PC og åbnes der. "Recent" holder en fuld kopi i en lokal
// IndexedDB-cache, så de kan genåbnes uden at pege på filen igen.

function markDirty() { if (!S.dirty) { S.dirty = true; updateProjectUI(); } }
function autoProjectName() { return `${S.deckName || 'Untitled'} — ${new Date().toLocaleDateString()}`; }

// dirty-markering ved per-slide ændringer (selve tilstanden bor nu i projekt-filen)
const saveDeckState = debounce(() => { markDirty(); }, 250);

/* --- IndexedDB: cache af seneste projekter (fuld blob + evt. fil-handle) --- */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ltfactory', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('recents', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll() {
  try {
    const db = await idbOpen();
    return await new Promise((res) => { const q = db.transaction('recents').objectStore('recents').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
  } catch { return []; }
}
async function idbPut(rec) {
  try { const db = await idbOpen(); await new Promise((res) => { const t = db.transaction('recents', 'readwrite'); t.objectStore('recents').put(rec); t.oncomplete = res; t.onerror = res; }); } catch { /* */ }
  // behold kun de 12 nyeste
  const all = (await idbAll()).sort((a, b) => b.savedAt - a.savedAt);
  for (const old of all.slice(12)) await idbDel(old.id);
}
async function idbDel(id) {
  try { const db = await idbOpen(); await new Promise((res) => { const t = db.transaction('recents', 'readwrite'); t.objectStore('recents').delete(id); t.oncomplete = res; t.onerror = res; }); } catch { /* */ }
}

function updateProjectUI() {
  const el = $('projName');
  const dirty = S.dirty && S.slides.length;
  el.textContent = S.projectName ? (dirty ? '● ' : '') + S.projectName : (dirty ? '● unsaved' : '');
  el.classList.toggle('none', !S.projectName && !dirty);
  refreshRecentsUI();
}

async function refreshRecentsUI() {
  const recents = (await idbAll()).sort((a, b) => b.savedAt - a.savedAt);
  const menu = $('miRecent');
  menu.innerHTML = '';
  if (!recents.length) { menu.innerHTML = '<div class="mi-empty">No recent projects</div>'; }
  for (const r of recents.slice(0, 8)) {
    const b = document.createElement('button');
    b.className = 'mi mi-recent' + (r.name === S.projectName ? ' on' : '');
    b.innerHTML = '<span class="nm"></span><span class="dt"></span><span class="del" title="Remove from recents">✕</span>';
    b.querySelector('.nm').textContent = r.name;
    b.querySelector('.dt').textContent = new Date(r.savedAt).toLocaleDateString();
    b.addEventListener('click', async (e) => {
      if (e.target.closest('.del')) { e.stopPropagation(); await idbDel(r.id); refreshRecentsUI(); return; }
      closeFileMenu(); openRecent(r);
    });
    menu.appendChild(b);
  }
  if (typeof buildStartRecent === 'function') buildStartRecent(recents);
}

/* ----------------------- .ltproj: byg / læs container ---------------------- */

async function slideBytes(sl) {
  if (sl.src.file) return new Uint8Array(await sl.src.file.arrayBuffer());
  return new Uint8Array(await (await fetch(sl.src.url)).arrayBuffer());
}

async function buildProjectBlob(name) {
  const zw = zipWriter();
  const meta = {
    app: 'LT Factory', format: 1, name, deckName: S.deckName, savedAt: Date.now(),
    settings: snapshotSettings(), frame: S.manualFrame ? S.frame : null, slides: [],
  };
  for (let i = 0; i < S.slides.length; i++) {
    const sl = S.slides[i];
    const file = `slides/${String(i).padStart(3, '0')}_${sl.name}`;
    zw.add(file, await slideBytes(sl));
    meta.slides.push({ name: sl.name, file, ov: sl.ov });
  }
  zw.add('ltproject.json', new TextEncoder().encode(JSON.stringify(meta)));
  return { blob: zw.finish(), meta };
}

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };

// minimal ZIP-læser (kun "store", som writeren producerer)
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 22 - 65536; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('Not a valid .ltproj file');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const map = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtra = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtra;
    map.set(name, u8.subarray(dataStart, dataStart + compSize));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return map;
}

async function openProjectBlob(blob, handle) {
  const files = readZip(new Uint8Array(await blob.arrayBuffer()));
  const metaU8 = files.get('ltproject.json');
  if (!metaU8) throw new Error('This file is not an LT Factory project.');
  const meta = JSON.parse(new TextDecoder().decode(metaU8));
  applySettings(meta.settings); saveSettings();
  const slides = (meta.slides || []).map((si) => {
    const data = files.get(si.file);
    const ext = (si.name.match(/\.[^.]+$/) || ['.jpg'])[0].toLowerCase();
    const type = MIME_BY_EXT[ext] || 'image/jpeg';
    const f = new File([data ? new Blob([data], { type }) : new Blob()], si.name, { type });
    return { name: si.name, src: { file: f }, ov: si.ov || { mode: 'auto', off: 0, on: true, img: true } };
  });
  S.deckName = meta.deckName || meta.name || 'Project';
  S.deckKey = null;
  S.projectName = meta.name || null;
  S.fileHandle = handle || null;
  hideStart();
  await ingest(slides, meta.frame || null);
  S.dirty = false;
  updateProjectUI();
}

/* ----------------------------- gem / åbn ----------------------------------- */

async function cacheRecent(name, blob, handle) {
  await idbPut({ id: (handle && handle.name) || name, name, deckName: S.deckName, savedAt: Date.now(), blob, handle: handle || null });
}

async function saveProjectAs() {
  if (!S.slides.length) { toast('Import some slides first.', true); return; }
  const name = S.projectName || S.deckName || 'project';
  setStatus('saving project…', true, 0);
  const { blob } = await buildProjectBlob(name);
  const suggested = name.replace(/[^\w æøåÆØÅ.-]+/g, ' ').trim() + '.ltproj';
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: suggested, types: [{ description: 'LT Factory project', accept: { 'application/octet-stream': ['.ltproj'] } }] });
    } catch { setStatus('ready', false, null); return; } // annulleret
    const w = await handle.createWritable(); await w.write(blob); await w.close();
    S.projectName = handle.name.replace(/\.ltproj$/i, '');
    S.fileHandle = handle;
    await cacheRecent(S.projectName, blob, handle);
    S.dirty = false; updateProjectUI();
    setStatus('ready', false, null);
    toast(`Project saved to "${handle.name}".`);
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = suggested; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    S.projectName = name; await cacheRecent(name, blob, null);
    S.dirty = false; updateProjectUI();
    setStatus('ready', false, null);
    toast('Project file downloaded.');
  }
}

async function saveProject() {
  if (!S.slides.length) { toast('Import some slides first.', true); return; }
  if (S.fileHandle) {
    try {
      setStatus('saving project…', true, 0);
      const { blob } = await buildProjectBlob(S.projectName || S.fileHandle.name.replace(/\.ltproj$/i, ''));
      const w = await S.fileHandle.createWritable(); await w.write(blob); await w.close();
      await cacheRecent(S.projectName || S.fileHandle.name, blob, S.fileHandle);
      S.dirty = false; updateProjectUI();
      setStatus('ready', false, null);
      toast('Project saved.');
      return;
    } catch { setStatus('ready', false, null); /* fald tilbage til Save as */ }
  }
  return saveProjectAs();
}

async function openRecent(rec) {
  try {
    if (rec.blob) { await openProjectBlob(rec.blob, rec.handle || null); return; }
    if (rec.handle) {
      if (rec.handle.queryPermission) {
        let p = await rec.handle.queryPermission({ mode: 'read' });
        if (p !== 'granted') p = await rec.handle.requestPermission({ mode: 'read' });
        if (p !== 'granted') { toast('Permission denied.', true); return; }
      }
      const file = await rec.handle.getFile();
      await openProjectBlob(file, rec.handle);
    }
  } catch (e) {
    toast('Could not open project: ' + e.message, true);
    await idbDel(rec.id); refreshRecentsUI();
  }
}

async function openProjectFile(file) {
  try { await openProjectBlob(file, null); await cacheRecent(S.projectName || file.name.replace(/\.ltproj$/i, ''), file, null); refreshRecentsUI(); }
  catch (e) { toast('Could not open project: ' + e.message, true); }
}

async function loadFiles(fileList) {
  const files = [...fileList]
    .filter((f) => /image\/(jpeg|png|webp|gif|bmp|avif)/.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!files.length) { toast('No image files found in what you dropped.', true); return; }
  const slides = files.map((f) => ({ name: f.name, src: { file: f }, ov: { mode: 'auto', off: 0, on: true, img: true } }));
  const batchName = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : 'My images';
  if (S.slides.length) {
    // import i flere omgange: nye billeder LÆGGES TIL det eksisterende sæt
    S.deckName = S.deckName + ' + ' + batchName;
    S.deckKey = null; // blandet sæt — per-mappe hukommelse gælder ikke
    await ingest([...S.slides, ...slides]);
  } else {
    S.deckName = batchName;
    S.deckKey = null;
    await ingest(slides);
  }
}

// ryd alle indlæste slides (så man kan starte forfra eller skifte sæt)
function clearDeck() {
  S.renderToken++; // afbryd evt. igangværende analyse/render
  renderQueue.length = 0;
  for (const b of bmpCache.values()) { try { b.bmp.close(); } catch { /* i brug */ } }
  bmpCache.clear();
  S.slides = [];
  S.deckName = '';
  S.deckKey = null;
  S.analyzed = false;
  S.manualFrame = false;
  S.cardSig = null;
  S.totalParts = 0;
  $('exportDir').disabled = true;
  $('exportZip').disabled = true;
  $('exportBtn').disabled = true;
  document.querySelectorAll('.folder-item').forEach((x) => x.classList.remove('on'));
  try {
    localStorage.removeItem('ltfabrik.lastFolder');
    localStorage.removeItem('ltfabrik.lastProject');
  } catch { /* ignorér */ }
  S.projectName = null;
  S.dirty = false;
  updateProjectUI();
  buildCards(null);
  setStatus('ready — pick a folder', false, null);
}

async function ingest(slides, savedFrame) {
  hideStart();
  if (typeof closeFormatsDialog === 'function') closeFormatsDialog();
  if (S.pendingName) { S.projectName = S.pendingName; S.pendingName = null; }
  for (const b of bmpCache.values()) { try { b.bmp.close(); } catch { /* i brug */ } }
  bmpCache.clear();
  S.slides = slides;
  S.analyzed = false;
  S.manualFrame = false;
  S.cardSig = null;
  if (savedFrame) {
    // manuel ramme fra sidste session — auto-detektionen springes over
    S.frame = savedFrame;
    S.manualFrame = true;
    $('mLeft').value = (savedFrame.l * 100).toFixed(1);
    $('mRight').value = (savedFrame.r * 100).toFixed(1);
    $('mTop').value = (savedFrame.t * 100).toFixed(1);
    $('mBottom').value = (savedFrame.b * 100).toFixed(1);
  }
  $('exportDir').disabled = true;
  $('exportZip').disabled = true;
  $('exportBtn').disabled = true;
  buildCards(null);
  await analyzeDeck();
}

/* --------------------------- pas 1: ramme-detektion ------------------------- */
// Rammen (logo-søjler m.m.) kan skifte farvetema fra slide til slide, så ren
// pixel-stabilitet duer ikke. I stedet ledes efter PERSISTENTE KANTER: en
// kolonne/række hvor der er en tydelig kant på (næsten) alle slides — det er
// grænsen mellem indhold og fast ramme. Selve rammen croppes bagefter fra hver
// slides egen udgave, så temaskift følger med automatisk.

async function analyzeDeck() {
  const n = S.slides.length;
  if (!n) return;
  setStatus('analyzing…', true, 0);
  const token = ++S.renderToken;

  const cv = new OffscreenCanvas(AW, AH);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const colEdge = [], rowEdge = []; // pr. slide: andel af rækker/kolonner med kant
  // genbrugte buffere — allokeres én gang, ikke pr. slide
  const lum = new Float32Array(AW * AH);
  const colCnt = new Int32Array(AW);
  const rowCnt = new Int32Array(AH);

  let decoded = 0;
  for (let i = 0; i < n; i++) {
    if (token !== S.renderToken) return;
    const sl = S.slides[i];
    let bmp;
    try {
      bmp = await getBitmap(sl);
    } catch {
      sl._bad = true; // korrupt/udekodbar fil — springes over, resten fortsætter
      continue;
    }
    decoded++;
    sl.w = bmp.width;
    sl.h = bmp.height;
    cx.drawImage(bmp, 0, 0, AW, AH);
    sl.small = cx.getImageData(0, 0, AW, AH);
    const d = sl.small.data;

    for (let p = 0; p < AW * AH; p++) lum[p] = (77 * d[p * 4] + 150 * d[p * 4 + 1] + 29 * d[p * 4 + 2]) >> 8;
    colCnt.fill(0); rowCnt.fill(0);
    // ét række-ordnet gennemløb (cache-venligt) tæller både lodrette og
    // vandrette kanter
    for (let r = 0; r < AH; r++) {
      const o = r * AW;
      let cnt = 0;
      for (let c = 1; c < AW; c++) {
        if (Math.abs(lum[o + c] - lum[o + c - 1]) > 22) colCnt[c]++;
        if (r > 0 && Math.abs(lum[o + c] - lum[o - AW + c]) > 22) cnt++;
      }
      if (r > 0 && Math.abs(lum[o] - lum[o - AW]) > 22) cnt++;
      rowCnt[r] = cnt;
    }
    const ce = new Float32Array(AW);
    for (let c = 1; c < AW; c++) ce[c] = colCnt[c] / AH;
    const re = new Float32Array(AH);
    for (let r = 1; r < AH; r++) re[r] = rowCnt[r] / AW;
    colEdge.push(ce); rowEdge.push(re);
    setStatus(`analyzing ${i + 1}/${n}`, true, (i + 1) / (n * 2));
    if (i % 4 === 3) await new Promise((r) => setTimeout(r));
  }

  // filtrér filer der ikke kunne dekodes fra
  if (decoded < n) {
    const bad = S.slides.filter((sl) => sl._bad).map((sl) => sl.name);
    S.slides = S.slides.filter((sl) => !sl._bad);
    S.cardSig = null;
    buildCards(null);
    toast(`${bad.length} file(s) could not be read and were skipped: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}`, true);
    if (!S.slides.length) { setStatus('no usable images', false, null); return; }
  }

  if (!S.manualFrame) {
    if (colEdge.length >= 4) {
      // 10. percentil på tværs af slides: kanten skal findes på (næsten) alle
      const pct10 = (arrs, idx) => {
        const v = arrs.map((a) => a[idx]).sort((a, b) => a - b);
        return v[Math.floor(v.length * 0.1)];
      };
      const findSeam = (arrs, len, fromEdge) => {
        const zone = Math.floor(len * 0.14);
        if (fromEdge === 'end') { // yderste (mindste c) persistente kant i zonen ved slutningen
          for (let c = len - zone; c < len - 1; c++) if (pct10(arrs, c) >= 0.32) return (len - c) / len;
        } else { // yderste (største c) persistente kant i zonen ved starten
          for (let c = zone; c >= 2; c--) if (pct10(arrs, c) >= 0.32) return c / len;
        }
        return 0;
      };
      S.frame.l = findSeam(colEdge, AW, 'start');
      S.frame.r = findSeam(colEdge, AW, 'end');
      S.frame.t = findSeam(rowEdge, AH, 'start');
      S.frame.b = findSeam(rowEdge, AH, 'end');
    } else {
      S.frame = { l: 0, r: 0, t: 0, b: 0 };
    }
    $('mLeft').value = (S.frame.l * 100).toFixed(1);
    $('mRight').value = (S.frame.r * 100).toFixed(1);
    $('mTop').value = (S.frame.t * 100).toFixed(1);
    $('mBottom').value = (S.frame.b * 100).toFixed(1);
  }

  // pas 2: indholdsanalyse pr. slide + finjustering i fuld opløsning
  const n2 = S.slides.length;
  for (let i = 0; i < n2; i++) {
    if (token !== S.renderToken) return;
    const sl = S.slides[i];
    try {
      analyzeSlide(sl);
      await refineSlide(sl);
    } catch (e) {
      console.error('analyse fejlede for', sl.name, e);
      sl.ana = sl.ana || { photo: true, bg: [0, 0, 0], lines: [], decos: [], furniture: [], images: [], band: null, cx0: 0, cy0: 0, cw: AW, ch: AH, kx: (sl.w || 1920) / AW, ky: (sl.h || 1080) / AH };
    }
    sl._layout = null;
    setStatus(`reading content ${i + 1}/${n2}`, true, 0.5 + (i + 1) / (n2 * 2));
    if (i % 8 === 7) await new Promise((r) => setTimeout(r));
  }
  if (token !== S.renderToken) return; // nyt deck kan være indlæst under sidste await

  S.analyzed = true;
  $('exportDir').disabled = !window.showDirectoryPicker;
  $('exportZip').disabled = false;
  $('exportBtn').disabled = false;
  $('exportHint').textContent = window.showDirectoryPicker
    ? 'Saves one file per slide per format directly to a folder you choose.'
    : 'Your browser does not support direct folder access — use ZIP.';
  renderAll();
}

/* ------------------------- pas 2: indhold pr. slide ------------------------- */

function analyzeSlide(sl) {
  const d = sl.small.data;
  const L = Math.round(S.frame.l * AW), R = Math.round(S.frame.r * AW);
  const T = Math.round(S.frame.t * AH), B = Math.round(S.frame.b * AH);
  let cx0 = L, cx1 = AW - R, cy0 = T, cy1 = AH - B;
  const cw = cx1 - cx0, ch = cy1 - cy0;

  if (cw < 20 || ch < 20) {
    // rammen æder næsten hele billedet (ekstreme manuelle værdier)
    sl.ana = { photo: true, bg: [0, 0, 0], lines: [], decos: [], furniture: [], images: [], band: null, cx0: 0, cy0: 0, cw: AW, ch: AH, kx: sl.w / AW, ky: sl.h / AH };
    return;
  }

  // --- dominerende baggrundsfarve via grov histogram ---
  const bins = new Map();
  for (let y = cy0; y < cy1; y += 2) {
    for (let x = cx0; x < cx1; x += 2) {
      const p = (y * AW + x) * 4;
      const key = ((d[p] >> 4) << 8) | ((d[p + 1] >> 4) << 4) | (d[p + 2] >> 4);
      const b = bins.get(key) || [0, 0, 0, 0];
      b[0]++; b[1] += d[p]; b[2] += d[p + 1]; b[3] += d[p + 2];
      bins.set(key, b);
    }
  }
  let best = null;
  for (const b of bins.values()) { if (!best || b[0] > best[0]) best = b; }
  const bg = [best[1] / best[0], best[2] / best[0], best[3] / best[0]];

  let near = 0, samples = 0, edgy = 0;
  for (let y = cy0; y < cy1; y += 2) {
    for (let x = cx0 + 1; x < cx1; x += 2) {
      const p = (y * AW + x) * 4;
      const dist = Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]);
      if (dist <= 90) near++;
      const pl = p - 4;
      if (Math.abs(d[p] - d[pl]) + Math.abs(d[p + 1] - d[pl + 1]) + Math.abs(d[p + 2] - d[pl + 2]) > 55) edgy++;
      samples++;
    }
  }
  // foto hvis baggrundsfarven ikke dominerer ELLER billedet er detalje-rigt overalt
  const photo = near / samples < 0.5 || edgy / samples > 0.12;

  const ana = { photo, bg, lines: [], decos: [], furniture: [], images: [], band: null, cx0, cy0, cw, ch, kx: sl.w / AW, ky: sl.h / AH };
  sl.ana = ana;

  if (photo) {
    // fokus-profil til beskæring: kant-energi pr. række → det "vigtigste" område
    const rowE = new Float32Array(AH);
    for (let y = Math.max(cy0 + 1, 1); y < cy1; y++) {
      let e = 0;
      for (let x = cx0 + 1; x < cx1; x++) {
        const p = (y * AW + x) * 4, pl = p - 4, pu = p - AW * 4;
        const l = d[p] + d[p + 1] + d[p + 2];
        e += Math.abs(l - (d[pl] + d[pl + 1] + d[pl + 2])) + Math.abs(l - (d[pu] + d[pu + 1] + d[pu + 2]));
      }
      rowE[y] = e;
    }
    ana.rowE = rowE;
    return;
  }
  if (cw < 20 || ch < 20) return;

  // --- tekstmaske: alt der afviger tydeligt fra baggrunden ---
  const mask = new Uint8Array(AW * AH);
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const p = (y * AW + x) * 4;
      const dist = Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]);
      if (dist > 110) mask[y * AW + x] = 1;
    }
  }

  // --- dekorationsstriber langs venstre/højre kant af indholdet ---
  const colMaskFrac = (c) => { let s = 0; for (let y = cy0; y < cy1; y++) s += mask[y * AW + c]; return s / ch; };
  for (const side of ['l', 'r']) {
    let w = 0;
    const at = (i) => (side === 'l' ? cx0 + i : cx1 - 1 - i);
    while (w < cw * 0.18 && colMaskFrac(at(w)) > 0.55) w++;
    if (w >= Math.max(3, cw * 0.015)) {
      const x0 = side === 'l' ? cx0 : cx1 - w;
      ana.decos.push({ x0, x1: x0 + w, side });
      for (let y = cy0; y < cy1; y++) for (let x = x0; x < x0 + w; x++) mask[y * AW + x] = 0;
      if (side === 'l') cx0 += w; else cx1 -= w;
    }
  }

  // --- rækkeprofil → linjesegmenter ---
  const computeRowCnt = () => {
    const rc = new Int32Array(AH);
    for (let y = cy0; y < cy1; y++) { let s = 0; for (let x = cx0; x < cx1; x++) s += mask[y * AW + x]; rc[y] = s; }
    return rc;
  };
  const segsFrom = (rc) => {
    const rowOn = (y) => rc[y] > Math.max(3, 0.012 * cw);
    let raw = [];
    let y = cy0;
    while (y < cy1) {
      if (rowOn(y)) { const y0 = y; while (y < cy1 && rowOn(y)) y++; raw.push({ y0, y1: y }); } else y++;
    }
    const medH0 = median(raw.map((s) => s.y1 - s.y0));
    const merged = [];
    for (const s of raw) {
      const prev = merged[merged.length - 1];
      if (prev && s.y0 - prev.y1 <= Math.max(2, Math.round(0.3 * medH0))) prev.y1 = s.y1;
      else merged.push({ ...s });
    }
    return merged;
  };

  // --- pas A: skil store blokke (indlejrede fotos/kort) fra tekst ---
  // Et højt segment kolonne-opdeles ved brede tomme lodrette mellemrum; delblokke
  // der stadig er høje, er billeder og fjernes fra masken, så tekst ved siden af
  // kan analyseres som linjer bagefter.
  for (const seg of segsFrom(computeRowCnt())) {
    if (seg.y1 - seg.y0 <= 0.45 * ch) continue;
    const colGapBig = Math.max(8, Math.round(0.035 * cw));
    const colHas = new Uint8Array(cw);
    for (let x = cx0; x < cx1; x++) {
      for (let yy = seg.y0; yy < seg.y1; yy++) if (mask[yy * AW + x]) { colHas[x - cx0] = 1; break; }
    }
    let x = 0;
    while (x < cw) {
      if (!colHas[x]) { x++; continue; }
      const bx0 = x;
      let gap = 0, bx1 = x;
      while (x < cw) {
        if (colHas[x]) { gap = 0; bx1 = x + 1; } else { gap++; if (gap >= colGapBig) break; }
        x++;
      }
      // stram y-boks + pixel-tæthed for delblokken
      let by0 = seg.y1, by1 = seg.y0, pix = 0;
      for (let yy = seg.y0; yy < seg.y1; yy++) {
        for (let xx = cx0 + bx0; xx < cx0 + bx1; xx++) {
          if (mask[yy * AW + xx]) { pix++; if (yy < by0) by0 = yy; if (yy + 1 > by1) by1 = yy + 1; }
        }
      }
      if (by1 - by0 > 0.45 * ch) {
        const density = pix / ((bx1 - bx0) * (by1 - by0));
        if (density >= 0.4) {
          // massiv blok = indlejret foto/kort
          ana.images.push({ x0: cx0 + bx0, x1: cx0 + bx1, y0: by0, y1: by1 });
          for (let yy = by0; yy < by1; yy++) for (let xx = cx0 + bx0; xx < cx0 + bx1; xx++) mask[yy * AW + xx] = 0;
        } else {
          // spredt blok (teksturrevner o.l.): fjern kun tynde rækker — tætte
          // rækker (rigtig tekst) får lov at overleve til linjeanalysen
          for (let yy = by0; yy < by1; yy++) {
            let s = 0;
            for (let xx = cx0 + bx0; xx < cx0 + bx1; xx++) s += mask[yy * AW + xx];
            if (s < Math.max(3, 0.05 * (bx1 - bx0))) {
              for (let xx = cx0 + bx0; xx < cx0 + bx1; xx++) mask[yy * AW + xx] = 0;
            }
          }
        }
      }
      x = bx1 + colGapBig;
    }
  }

  const rowCnt = computeRowCnt();
  const segs = segsFrom(rowCnt);

  // --- pr. segment: x-udstrækning, klassifikation, ord ---
  for (const seg of segs) {
    let x0 = -1, x1 = -1, pixCount = 0;
    const colHas = new Uint8Array(cw + 4);
    for (let x = cx0; x < cx1; x++) {
      let s = 0;
      for (let yy = seg.y0; yy < seg.y1; yy++) s += mask[yy * AW + x];
      if (s > 0) { colHas[x - cx0] = 1; if (x0 < 0) x0 = x; x1 = x + 1; pixCount += s; }
    }
    if (x0 < 0) continue;
    const w = x1 - x0, h = seg.y1 - seg.y0;
    const density = pixCount / (w * h);
    if (pixCount < 20 || density < 0.05) continue; // støj/teksturrevner

    // sidetal og andet småt hjørne-inventar
    const inCornerY = seg.y0 > cy0 + 0.84 * ch || seg.y1 < cy0 + 0.14 * ch;
    const inCornerX = x1 < cx0 + 0.16 * cw || x0 > cx1 - 0.16 * cw;
    if (inCornerY && inCornerX && h < 0.07 * ch && w < 0.22 * cw) {
      ana.furniture.push({ x0, x1, y0: seg.y0, y1: seg.y1 });
      for (let yy = seg.y0; yy < seg.y1; yy++) for (let x = x0; x < x1; x++) mask[yy * AW + x] = 0;
      continue;
    }

    // store blokke: kun tætte blokke er billeder; spredte er tekstur-støj
    if (h > 0.45 * ch) {
      if (density >= 0.3) {
        ana.images.push({ x0, x1, y0: seg.y0, y1: seg.y1 });
        for (let yy = seg.y0; yy < seg.y1; yy++) for (let x = x0; x < x1; x++) mask[yy * AW + x] = 0;
      }
      continue;
    }

    // orddeling: sammenhængende tomme kolonne-huller ≥ 34 % af linjehøjden
    const gapMin = Math.max(2, Math.round(0.34 * h));
    const words = [];
    let wx = x0;
    while (wx < x1) {
      if (!colHas[wx - cx0]) { wx++; continue; }
      const wStart = wx;
      let gap = 0, wEnd = wx;
      while (wx < x1) {
        if (colHas[wx - cx0]) { gap = 0; wEnd = wx + 1; } else { gap++; if (gap >= gapMin) break; }
        wx++;
      }
      // stram y-boks + tæthed for ordet — tynde revne-stumper frasorteres
      let wy0 = seg.y1, wy1 = seg.y0, wpix = 0;
      for (let yy = seg.y0; yy < seg.y1; yy++) {
        for (let x = wStart; x < wEnd; x++) {
          if (mask[yy * AW + x]) { wpix++; if (yy < wy0) wy0 = yy; if (yy + 1 > wy1) wy1 = yy + 1; }
        }
      }
      if (wy1 > wy0 && wpix >= 6 && wpix / ((wEnd - wStart) * (wy1 - wy0)) >= 0.12) {
        words.push({ x0: wStart, x1: wEnd, y0: wy0, y1: wy1, dy: seg.y1 - wy1 });
      }
      wx = wEnd + gapMin;
    }
    if (words.length) ana.lines.push({ y0: seg.y0, y1: seg.y1, x0, x1, words });
  }

  // --- vandret bånd uden elementer → baggrundstekstur til output ---
  // Rækker der ikke er dækket af tekst/billeder/inventar. Svag tekstur (revner,
  // papirkorn) må gerne være der — det er netop den, vi vil genbruge.
  const covered = new Uint8Array(AH);
  const coverRange = (y0, y1) => { for (let yy = Math.max(0, y0 - 2); yy < Math.min(AH, y1 + 2); yy++) covered[yy] = 1; };
  for (const ln of ana.lines) coverRange(ln.y0, ln.y1);
  for (const im of ana.images) coverRange(im.y0, im.y1);
  for (const fu of ana.furniture) coverRange(fu.y0, fu.y1);
  let run = 0, bestRun = 0, bestEnd = 0;
  for (let yy = cy0; yy < cy1; yy++) {
    if (!covered[yy]) { run++; if (run > bestRun) { bestRun = run; bestEnd = yy + 1; } } else run = 0;
  }
  if (bestRun >= Math.max(8, 0.06 * ch)) ana.band = { y0: bestEnd - bestRun + 2, y1: bestEnd - 2 };

  ana.cx0 = cx0; ana.cw = cx1 - cx0;
}

/* ------------------------------ indstillinger ------------------------------ */

// Frie output-formater (1-4). Hver har navn, W, H, filnavn-endelse og canvas.
const DEFAULT_FORMATS = [
  { name: 'Stream', W: 1920, H: 216, suffix: '_stream', canvas: 'strip' },
  { name: 'LED', W: 936, H: 208, suffix: '_led', canvas: 'strip' },
];

function normFormats() {
  const seen = new Set();
  return S.formats.slice(0, 4).map((f, i) => {
    const name = (f.name || `Format ${i + 1}`).trim() || `Format ${i + 1}`;
    let suffix = (f.suffix || ('_' + name.toLowerCase().replace(/[^\w-]+/g, ''))).trim() || `_f${i + 1}`;
    if (!suffix.startsWith('_') && !suffix.startsWith('-')) suffix = '_' + suffix;
    while (seen.has(suffix)) suffix += (i + 1);
    seen.add(suffix);
    return {
      key: 'f' + i, name,
      W: Math.max(64, Math.round(+f.W) || 1920),
      H: Math.max(32, Math.round(+f.H) || 216),
      suffix, canvas: f.canvas || 'strip',
    };
  });
}

function getSettings() {
  return {
    formats: normFormats(),
    textColor: $('textColorMode').value === 'custom' ? $('textColor').value : null,
    split: $('splitMode').value,
    charLimit: Math.min(400, Math.max(40, +$('charLimit').value || 200)),
    pad: Math.max(0, +$('pad').value || 0),
    format: $('format').value,
    layout: $('layoutMode').value,
    align: $('alignH').value,
    maxScale: +$('maxScale').value,
    bgMode: $('bgMode').value,
    sidebar: $('sidebarMode').value,
    furniture: $('furnitureMode').value,
  };
}

function resolveMode(sl, s) {
  return sl.ov.mode === 'auto' ? (sl.ana.photo ? 'crop' : s.layout) : sl.ov.mode;
}

/* --------------------------- geometri pr. format ---------------------------- */
// Al placering (ramme, dekorationer, indlejrede billeder, tekstboks) beregnes som
// ren matematik pr. format, så tekst-ombrydningen kan vælges fælles for alle formater.

function geomFor(sl, s, fmt) {
  const a = sl.ana;
  const fw = sl.w, fh = sl.h;
  const sx = fw / AW, sy = fh / AH;
  const { W, H } = fmt;

  const frScale = H / fh;
  const fr = {
    l: Math.round(S.frame.l * fw), r: Math.round(S.frame.r * fw),
    t: Math.round(S.frame.t * fh), b: Math.round(S.frame.b * fh),
  };
  const show = s.sidebar === 'keep';
  const dl = show ? fr.l * frScale : 0, dr = show ? fr.r * frScale : 0;
  const dt = show ? fr.t * frScale : 0, db = show ? fr.b * frScale : 0;

  const scx = a.cx0 * sx, scy = a.cy0 * sy, scw = a.cw * sx, sch = a.ch * sy;
  const pad = s.pad * Math.min(1, W / 1920); // luft skalerer med formatets bredde
  const padV = Math.min(pad, H * 0.14);
  const box = { x0: dl + pad, x1: W - dr - pad, y0: dt + padV, y1: H - db - padV };

  const decoDraws = [];
  for (const dec of a.decos) {
    const w = (dec.x1 - dec.x0) * sx;
    const dw = w * (H / sch);
    if (dec.side === 'l') {
      decoDraws.push({ sx: dec.x0 * sx, sy: scy, sw: w, sh: sch, dx: dl, dy: 0, dw, dh: H });
      box.x0 = Math.max(box.x0, dl + dw + pad * 0.6);
    } else {
      decoDraws.push({ sx: dec.x0 * sx, sy: scy, sw: w, sh: sch, dx: W - dr - dw, dy: 0, dw, dh: H });
      box.x1 = Math.min(box.x1, W - dr - dw - pad * 0.6);
    }
  }

  const imgDraws = [];
  // indlejrede billeder kan fravælges pr. slide, hvis beskæringen bliver skæv
  for (const im of (sl.ov.img === false ? [] : a.images)) {
    const iw = (im.x1 - im.x0) * sx, ih = (im.y1 - im.y0) * sy;
    const sc = Math.min((box.y1 - box.y0) / ih, (box.x1 - box.x0) * 0.35 / iw);
    if (sc <= 0) continue;
    const dw = iw * sc, dh = ih * sc;
    const centerRight = (im.x0 + im.x1) / 2 > a.cx0 + a.cw / 2;
    const dy = box.y0 + (box.y1 - box.y0 - dh) / 2;
    if (centerRight) {
      imgDraws.push({ sx: im.x0 * sx, sy: im.y0 * sy, sw: iw, sh: ih, dx: box.x1 - dw, dy, dw, dh });
      box.x1 -= dw + pad * 0.7;
    } else {
      imgDraws.push({ sx: im.x0 * sx, sy: im.y0 * sy, sw: iw, sh: ih, dx: box.x0, dy, dw, dh });
      box.x0 += dw + pad * 0.7;
    }
  }

  const furnDraws = [];
  for (const fu of a.furniture) {
    const r = { x: fu.x0 * sx, y: fu.y0 * sy, w: (fu.x1 - fu.x0) * sx, h: (fu.y1 - fu.y0) * sy };
    const dw = r.w * frScale, dh = r.h * frScale;
    const dx = fu.x0 < a.cx0 + a.cw / 2 ? r.x * frScale : W - (fw - (r.x + r.w)) * frScale - dw;
    const dy = fu.y0 < a.cy0 + a.ch / 2 ? r.y * frScale : H - (fh - (r.y + r.h)) * frScale - dh;
    furnDraws.push({ sx: r.x, sy: r.y, sw: r.w, sh: r.h, dx, dy, dw, dh });
  }

  return { fr, show, dl, dr, dt, db, box, decoDraws, imgDraws, furnDraws, scx, scy, scw, sch, sx, sy };
}

/* ------------------- finjustering i fuld opløsning ------------------------- */
// Analysen kører i 480px-net (±4 px unøjagtighed ved 1920). Her strammes hvert
// ords boks og linjens baseline op mod originalbilledet, så tekst på samme
// række flugter pixelperfekt.

// genbrugt analyse-canvas — undgår ~8 MB allokering pr. slide gennem GC'en
let refCvs = null, refCtx = null;

async function refineSlide(sl) {
  const a = sl.ana;
  if (!a || a.photo || !a.lines.length) return;
  const { kx, ky, bg } = a;
  const bmp = await getBitmap(sl);
  if (!refCvs || refCvs.width !== sl.w || refCvs.height !== sl.h) {
    refCvs = new OffscreenCanvas(sl.w, sl.h);
    refCtx = refCvs.getContext('2d', { willReadFrequently: true });
  }
  refCtx.drawImage(bmp, 0, 0);

  // ét samlet readback for alle linjer (getImageData pr. linje var dyrt)
  let uy0 = sl.h, uy1 = 0, ux0 = sl.w, ux1 = 0;
  for (const ln of a.lines) {
    uy0 = Math.min(uy0, Math.max(0, Math.floor((ln.y0 - 2) * ky)));
    uy1 = Math.max(uy1, Math.min(sl.h, Math.ceil((ln.y1 + 2) * ky)));
    ux0 = Math.min(ux0, Math.max(0, Math.floor((ln.x0 - 2) * kx)));
    ux1 = Math.max(ux1, Math.min(sl.w, Math.ceil((ln.x1 + 2) * kx)));
  }
  if (uy1 <= uy0 || ux1 <= ux0) return;
  const im = refCtx.getImageData(ux0, uy0, ux1 - ux0, uy1 - uy0);
  const d = im.data, uw = ux1 - ux0;
  // absolutte koordinater — scanninger holdes inden for egen linjes bånd,
  // så overlappende x-områder fra andre linjer aldrig blandes ind
  const on = (x, y) => {
    const p = ((y - uy0) * uw + (x - ux0)) * 4;
    return Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]) > 110;
  };

  for (const ln of a.lines) {
    const ly0 = Math.max(uy0, Math.floor((ln.y0 - 2) * ky));
    const ly1 = Math.min(uy1, Math.ceil((ln.y1 + 2) * ky));
    const lx0 = Math.max(ux0, Math.floor((ln.x0 - 2) * kx));
    const lx1 = Math.min(ux1, Math.ceil((ln.x1 + 2) * kx));
    if (ly1 <= ly0 || lx1 <= lx0) continue;
    for (const w of ln.words) {
      const wx0 = Math.max(lx0, Math.floor((w.x0 - 1) * kx));
      const wx1 = Math.min(lx1, Math.ceil((w.x1 + 1) * kx));
      let fx0 = -1, fx1 = -1, fy0 = -1, fy1 = -1;
      for (let y = ly0; y < ly1; y++) {
        for (let x = wx0; x < wx1; x++) {
          if (on(x, y)) {
            if (fx0 < 0 || x < fx0) fx0 = x;
            if (x + 1 > fx1) fx1 = x + 1;
            if (fy0 < 0) fy0 = y;
            fy1 = y + 1;
          }
        }
      }
      if (fx0 >= 0) w.f = { x0: fx0, y0: fy0, x1: fx1, y1: fy1 };

      // ægte baseline pr. ord: bunden af det tætteste sammenhængende række-bånd.
      // Underlængder (g/y/p), kommaer og understregninger er tynde spor/bånd
      // under båndet og forvrider derfor ikke målingen.
      if (w.f) {
        const h = w.f.y1 - w.f.y0;
        const counts = new Int32Array(h);
        let rowMax = 0;
        for (let yy = 0; yy < h; yy++) {
          let c = 0;
          for (let x = w.f.x0; x < w.f.x1; x++) if (on(x, w.f.y0 + yy)) c++;
          counts[yy] = c;
          if (c > rowMax) rowMax = c;
        }
        const thr = Math.max(1, 0.32 * rowMax);
        let bestLen = 0, bestEnd = -1, runLen = 0;
        for (let i = 0; i < h; i++) {
          if (counts[i] >= thr) { runLen++; if (runLen > bestLen) { bestLen = runLen; bestEnd = i; } }
          else runLen = 0;
        }
        w.base = bestEnd >= 0 ? w.f.y0 + bestEnd + 1 : w.f.y1;
      }
    }
    // linjens baseline = median af ordenes egne baselines (robust mod
    // underlængder og understregninger, som før forvred medianen af bokse-bunde)
    const ys = ln.words.filter((w) => w.f).map((w) => w.base || w.f.y1).sort((p, q) => p - q);
    if (ys.length) ln.fbase = ys[ys.length >> 1];

    // hævede versnumre (superscript) markerer, hvor et nyt vers begynder.
    // Et ord er versstart hvis det er helt hævet ("11.") eller starter med et
    // hævet præfiks ("14.But"): venstre-zonens laveste pixel ender tydeligt
    // over baselinen, men når dybere ned end anførselstegn gør.
    if (ln.fbase !== undefined) {
      const lineHf = Math.max(4, (ln.y1 - ln.y0) * ky);
      const segTopF = ln.y0 * ky;
      for (const w of ln.words) {
        if (!w.f) continue;
        // laveste pixel pr. kolonne i ordet (mod ordets egen dybde — robust
        // selv når understregninger forvrider linjens baseline-estimat)
        const nCols = w.f.x1 - w.f.x0;
        const colLow = new Int32Array(nCols).fill(-1);
        let deepest = -1;
        for (let ci = 0; ci < nCols; ci++) {
          const x = w.f.x0 + ci;
          for (let yy = Math.min(ly1 - 1, w.f.y1 + 2); yy >= ly0; yy--) {
            if (on(x, yy)) { colLow[ci] = yy; break; }
          }
          if (colLow[ci] > deepest) deepest = colLow[ci];
        }
        if (deepest < 0) continue;
        // helt hævet ord (fx "11."): sidder højt, er lavt og starter ved linjetop
        if (deepest <= segTopF + 0.68 * lineHf && (w.f.y1 - w.f.y0) <= 0.62 * lineHf
          && w.f.y0 <= segTopF + 0.25 * lineHf) { w.sup = true; continue; }
        // hævet talpræfiks ("14.But"): en indledende stribe kolonner, der alle
        // ender tydeligt over ordets dybeste punkt. Præfiksets egen bund skal
        // ligge midt i linjen (dybere end anførselstegn) og dets top ved
        // linjetoppen (modsat bindestreger). Mindst ét ciffer bredt.
        let pref = 0, prefDeep = -1, prefShallow = 1e9, prefTop = 1e9;
        const maxScan = Math.min(nCols, Math.round(1.6 * lineHf));
        for (let ci = 0; ci < maxScan; ci++) {
          const lw = colLow[ci];
          if (lw < 0) { if (pref > 0) break; else continue; }
          if (lw > deepest - 0.2 * lineHf) break;
          pref++;
          if (lw > prefDeep) prefDeep = lw;
          if (lw < prefShallow) prefShallow = lw;
          const x = w.f.x0 + ci;
          for (let yy = Math.max(ly0, w.f.y0 - 2); yy <= lw; yy++) {
            if (on(x, yy)) { if (yy < prefTop) prefTop = yy; break; }
          }
        }
        // mål mod linjens top (revner kan puste ord-boksen op) + kræv flad
        // ciffer-bund — teksturrevner skråner
        const relDeep = prefDeep - segTopF;
        if (pref >= 0.22 * lineHf
          && relDeep >= 0.33 * lineHf && relDeep <= 0.68 * lineHf
          && prefTop <= segTopF + 0.25 * lineHf
          && prefDeep - prefShallow <= 0.16 * lineHf) w.sup = true;
      }
    }
  }
  a._words = null;
}

/* --------------------------- fælles tekst-ombrydning ------------------------ */
// Alle mål herfra er i kildebilledets fulde opløsning.

function wordsOf(ana) {
  if (ana._words) return ana._words;
  const { kx, ky } = ana;
  const words = [], lineHs = [];
  ana.lines.forEach((ln, li) => {
    ln.words.forEach((w) => {
      if (!w.f) w.f = { x0: w.x0 * kx, y0: w.y0 * ky, x1: w.x1 * kx, y1: w.y1 * ky };
    });
    const ys = ln.words.map((w) => w.f.y1).sort((p, q) => p - q);
    const base = ln.fbase !== undefined ? ln.fbase : ys[ys.length >> 1];
    lineHs.push((ln.y1 - ln.y0) * ky);
    ln.words.forEach((w) => words.push({
      f: w.f, li, k: 1, sup: !!w.sup, lh: lineHs[lineHs.length - 1],
      x0: w.f.x0, x1: w.f.x1,
      w: w.f.x1 - w.f.x0, h: w.f.y1 - w.f.y0,
      above: base - w.f.y0, below: w.f.y1 - base,
    }));
  });
  const medLineH = median(lineHs);
  // over-høje linjer (fx sorte vers-chips eller kæmpe titler blandet med
  // brødtekst) skaleres ned mod teksthøjden — ens for HELE kildelinjen, så
  // ordene i linjen beholder deres indbyrdes størrelse
  const lineK = lineHs.map((h) => (h > 1.5 * medLineH ? (1.5 * medLineH) / h : 1));
  for (const wd of words) {
    const k = lineK[wd.li];
    if (k < 1) {
      wd.k = k;
      wd.w *= k; wd.h *= k; wd.above *= k; wd.below *= k; wd.lh *= k;
    }
  }
  ana._words = { words, medLineH, joinGap: 0.4 * medLineH, rowGap: 0.5 * medLineH, pad: Math.max(2, ana.kx) };
  return ana._words;
}

// Mellemrum: naturlig afstand fra kilden, men normaliseret — meget brede
// layout-huller fra sliden må ikke arves med over i lower third'en.
function natGapFn(ctx) {
  return (prev, cur) => {
    const base = Math.max(ctx.medLineH, (prev.h + cur.h) / 2);
    if (cur.li === prev.li && cur.x0 >= prev.x1) {
      const g = cur.x0 - prev.x1;
      // små huller = bogstaver i SAMME ord (fejl-opdelt) → bevar tæt, INTET
      // mellemrums-gulv (ellers bliver "lidt" til "li dt")
      if (g < 0.22 * base) return g;
      return Math.min(Math.max(g, 0.25 * base), 0.55 * base);
    }
    return ctx.joinGap;
  };
}

function rowMetrics(rows, wctx) {
  const natGap = natGapFn(wctx);
  let maxW = 0, totH = 0;
  for (const row of rows) {
    let w = 0, above = 0, below = 0;
    row.forEach((wd, i) => {
      w += wd.w + (i > 0 ? natGap(row[i - 1], wd) : 0);
      above = Math.max(above, wd.above);
      below = Math.max(below, wd.below);
    });
    maxW = Math.max(maxW, w);
    totH += above + Math.max(0, below);
  }
  totH += wctx.rowGap * (rows.length - 1);
  return { maxW, totH };
}

function scaleFor(m, boxW, boxH) {
  return Math.min(boxW / m.maxW, boxH / m.totH);
}

// Optimal ombrydning i k rækker: DP der minimerer den bredeste række, så
// linjerne bliver så lige lange som muligt.
function packK(words, k, wctx) {
  const n = words.length;
  if (k >= n) return words.map((w) => [w]);
  const natGap = natGapFn(wctx);
  const start = new Float64Array(n), end = new Float64Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) x += natGap(words[i - 1], words[i]);
    start[i] = x; x += words[i].w; end[i] = x;
  }
  const width = (i, j) => end[j] - start[i];
  const dp = Array.from({ length: k + 1 }, () => new Float64Array(n).fill(Infinity));
  const brk = Array.from({ length: k + 1 }, () => new Int32Array(n).fill(-1));
  for (let j = 0; j < n; j++) dp[1][j] = width(0, j);
  for (let r = 2; r <= k; r++) {
    for (let j = r - 1; j < n; j++) {
      for (let i = r - 1; i <= j; i++) {
        const v = Math.max(dp[r - 1][i - 1], width(i, j));
        if (v < dp[r][j]) { dp[r][j] = v; brk[r][j] = i; }
      }
    }
  }
  const rows = [];
  let j = n - 1;
  for (let r = k; r >= 1; r--) {
    const i = r === 1 ? 0 : brk[r][j];
    rows.unshift(words.slice(i, j + 1));
    j = i - 1;
  }
  return rows;
}

// Balanceret opdeling af en sekvens i k sammenhængende grupper: DP minimerer
// den største gruppes vægt (samme princip som linje-ombrydningen).
function balancedSplit(items, weights, k) {
  const m = items.length;
  if (k >= m) return items.map((it) => [it]);
  const pre = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) pre[i + 1] = pre[i] + weights[i];
  const dp = Array.from({ length: k + 1 }, () => new Float64Array(m).fill(Infinity));
  const brk = Array.from({ length: k + 1 }, () => new Int32Array(m).fill(-1));
  for (let j = 0; j < m; j++) dp[1][j] = pre[j + 1];
  for (let r = 2; r <= k; r++) {
    for (let j = r - 1; j < m; j++) {
      for (let i = r - 1; i <= j; i++) {
        const v = Math.max(dp[r - 1][i - 1], pre[j + 1] - pre[i]);
        if (v < dp[r][j]) { dp[r][j] = v; brk[r][j] = i; }
      }
    }
  }
  const groups = [];
  let j = m - 1;
  for (let r = k; r >= 1; r--) {
    const i = r === 1 ? 0 : brk[r][j];
    groups.unshift(items.slice(i, j + 1));
    j = i - 1;
  }
  return groups;
}

// Deler en slides tekst op i flere lower thirds, når der er for meget tekst.
// Budgettet er "tegn-ækvivalenter" målt på ordbredde ift. skrifthøjde — brede
// tegn tæller mere. Opdelingen er VERS-BEVIDST: der deles aldrig midt i et
// vers (markeret med hævede versnumre), og et helt vers blandes aldrig med en
// stump af et andet. Kun et vers, der alene er for langt, deles — og så står
// det alene på sine dele. Skriftsteds-chippen gentages på alle dele.
// Markerer ord der starter et "punkt/emne": hævede versnumre (w.sup) ELLER en
// kort indledende token på en linje efterfulgt af et tydeligt mellemrum
// (fx "1." "2." "•" "a)" "iv." — uden OCR, ud fra geometri).
function markItems(a, wctx) {
  if (a._items) return;
  a._items = true;
  const byLine = new Map();
  for (const w of wctx.words) { if (!byLine.has(w.li)) byLine.set(w.li, []); byLine.get(w.li).push(w); }
  for (const line of byLine.values()) {
    const first = line[0];
    if (!first || line.length < 2) continue;
    const lh = first.lh || first.h || 1;
    const gap = line[1].x0 - first.x1;
    // smalt begyndelses-ord + tydeligt mellemrum bagefter = punkt-markør
    if (first.w <= 2.3 * lh && gap >= 0.42 * lh) first.item = true;
  }
}

function partsOf(sl, s) {
  const a = sl.ana;
  if (!a || a.photo) return [null];
  const wctx = wordsOf(a);
  const all = wctx.words;
  if (!all.length) return [null];
  const mode = s.split || 'auto';
  if (mode === 'none') return [all];

  const limit = s.charLimit;
  const est = (wd) => Math.max(1, Math.round(wd.w / (0.55 * Math.max(wd.lh || wd.h, 1))));
  const sum = (ws) => ws.reduce((t, w) => t + est(w) + 1, 0);

  // skriftsteds-chip: første linje med præcis ét markant højere ord
  let header = [], body = all;
  if (a.lines.length > 1) {
    const firstLi = all[0].li;
    const firstLine = all.filter((w) => w.li === firstLi);
    if (firstLine.length === 1 && firstLine[0].h > 1.2 * wctx.medLineH) {
      header = firstLine;
      body = all.filter((w) => w.li !== firstLi);
    }
  }
  if (!body.length) return [all];

  const withHeader = (list) => list.map((p) => (header.length ? [...header, ...p] : p));

  // ÉN DEL PR. LINJE
  if (mode === 'line') {
    const lines = [];
    for (const w of body) {
      if (!lines.length || lines[lines.length - 1][0].li !== w.li) lines.push([]);
      lines[lines.length - 1].push(w);
    }
    return lines.length > 1 ? withHeader(lines) : [all];
  }

  // ÉN DEL PR. PUNKT/EMNE (opdel ved hvert versnummer ELLER punkt-markør)
  if (mode === 'item') {
    markItems(a, wctx);
    const items = [];
    let cur = [];
    for (const w of body) {
      if ((w.sup || w.item) && cur.length) { items.push(cur); cur = []; }
      cur.push(w);
    }
    if (cur.length) items.push(cur);
    if (items.length <= 1) return mode === 'item' && sum(all) > limit ? autoSplit() : [all];
    return withHeader(items);
  }

  // AUTO (balanceret efter længde) — original opførsel
  return autoSplit();

  function autoSplit() {
    if (sum(all) <= limit) return [all];
    const verses = [];
    let cur = [];
    for (const w of body) {
      if (w.sup && cur.length) { verses.push(cur); cur = []; }
      cur.push(w);
    }
    if (cur.length) verses.push(cur);
    const eff = Math.max(60, limit - sum(header));
    const vN = verses.map((v) => sum(v));
    const parts = [];
    let run = [], runN = [];
    const flushRun = () => {
      if (!run.length) return;
      const totalRun = runN.reduce((p, q) => p + q, 0);
      const k = Math.max(1, Math.ceil(totalRun / eff));
      for (const g of balancedSplit(run, runN, k)) parts.push(g.flat());
      run = []; runN = [];
    };
    verses.forEach((v, i) => {
      if (vN[i] > eff) {
        flushRun();
        const k = Math.ceil(vN[i] / eff);
        for (const g of balancedSplit(v, v.map((w) => est(w) + 1), k)) parts.push(g);
      } else { run.push(v); runN.push(vN[i]); }
    });
    flushRun();
    if (parts.length <= 1) return [all];
    return withHeader(parts);
  }
}

// Vælger ombrydning for ét format: den kandidat der giver størst tekst vinder.
// Ombrydningen må gerne være forskellig pr. format (færre linjer på stream,
// flere på LED) — kun tekstmængden (delene) er ens på tværs.
function chooseRows(sl, s, mode, geoms, subset) {
  const wctx = wordsOf(sl.ana);
  const words = subset || wctx.words;
  if (!words.length) return null;

  // brugeren kan tvinge et bestemt antal linjer pr. slide
  if (sl.ov.rows) return packK(words, sl.ov.rows, wctx);

  const score = (rows) => {
    const m = rowMetrics(rows, wctx);
    let worst = Infinity;
    for (const g of geoms) {
      const bw = g.box.x1 - g.box.x0, bh = g.box.y1 - g.box.y0;
      if (bw < 5 || bh < 5) return 0;
      // normalisér med formathøjden, så små og store formater vægtes ens
      worst = Math.min(worst, scaleFor(m, bw, bh) / (bh || 1));
    }
    return worst;
  };

  const origRows = [];
  for (const wd of words) {
    if (!origRows.length || origRows[origRows.length - 1][0].li !== wd.li) origRows.push([]);
    origRows[origRows.length - 1].push(wd);
  }

  const cands = [];
  const kMax = Math.min(4, words.length);
  for (let k = 1; k <= kMax; k++) { const rows = packK(words, k, wctx); cands.push({ rows, sc: score(rows) }); }
  const orig = { rows: origRows, sc: score(origRows) };

  if (mode === 'stack') return origRows;
  if (mode === 'oneline') return cands[0].rows;
  // foretræk færre linjer: en ekstra linje skal give mindst 5 % større tekst
  let best = cands[0];
  for (const c of cands) if (c.sc > best.sc * 1.05) best = c;
  if (mode === 'auto' && orig.sc >= 0.97 * best.sc) return origRows;
  return best.rows;
}

/* --------------------------------- rendering -------------------------------- */

// Genfarvning af tekst: ordets udklip laves om til en farvet silhuet, hvor
// afstanden fra slidens baggrundsfarve bliver alfakanal (bevarer antialiasing).
// Chips/labels (nedskalerede ord, k<1) beholder originalfarven.
let tintCvs = null, tintCtx = null;

function tintWord(bmp, sx, sy, sw, sh, bg, color) {
  const w = Math.max(1, Math.round(sw)), h = Math.max(1, Math.round(sh));
  if (!tintCvs || tintCvs.width < w || tintCvs.height < h) {
    tintCvs = new OffscreenCanvas(Math.max(w, tintCvs ? tintCvs.width : 1), Math.max(h, tintCvs ? tintCvs.height : 1));
    tintCtx = tintCvs.getContext('2d', { willReadFrequently: true });
  }
  tintCtx.imageSmoothingEnabled = true; tintCtx.imageSmoothingQuality = 'high';
  tintCtx.clearRect(0, 0, w, h);
  tintCtx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const im = tintCtx.getImageData(0, 0, w, h);
  const d = im.data;
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    const a2 = Math.max(0, Math.min(1, (dist - 45) / 90));
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(a2 * 255);
  }
  tintCtx.putImageData(im, 0, 0);
  return { cvs: tintCvs, w, h };
}

async function drawSlide(sl, s, fmt, canvas, rows, mode, pixScale = 1) {
  const bmp = await getBitmap(sl);
  const a = sl.ana;
  const { W, H } = fmt;
  const g = geomFor(sl, s, fmt);

  // pixScale < 1: preview tegnes i visningsopløsning; al geometri er i W×H
  canvas.width = Math.max(2, Math.round(W * pixScale));
  canvas.height = Math.max(2, Math.round(H * pixScale));
  const ctx = canvas.getContext('2d');
  if (pixScale !== 1) ctx.scale(pixScale, pixScale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // --- baggrund ---
  ctx.fillStyle = `rgb(${a.bg.map(Math.round).join(',')})`;
  ctx.fillRect(0, 0, W, H);

  if (mode === 'crop') {
    const cover = Math.max(W / g.scw, H / g.sch);
    const srcW = W / cover, srcH = H / cover;
    // auto-fokus: læg beskæringsvinduet dér, hvor billedet har mest detalje
    let focus = 0.5;
    if (a.rowE) {
      const syA = sl.h / AH;
      const hWin = Math.max(2, Math.round(srcH / syA));
      const y0 = a.cy0, y1 = a.cy0 + a.ch;
      if (y0 + hWin < y1) {
        // let top-bias: ansigter/hovedmotiv sidder oftest i den øverste del
        let sum = 0;
        for (let y = y0; y < y0 + hWin; y++) sum += a.rowE[y];
        let bestScore = -1, bestY = y0;
        for (let y = y0; y + hWin <= y1; y++) {
          if (y > y0) sum += a.rowE[y + hWin - 1] - a.rowE[y - 1];
          const rel = (y - y0) / (y1 - y0 - hWin);
          const score = sum * (1 - 0.25 * rel);
          if (score > bestScore) { bestScore = score; bestY = y; }
        }
        focus = (bestY - y0) / (y1 - y0 - hWin);
      }
    }
    const offY = Math.min(1, Math.max(0, focus + sl.ov.off / 200));
    const srcX = g.scx + (g.scw - srcW) / 2;
    const srcY = g.scy + (g.sch - srcH) * offY;
    ctx.drawImage(bmp, srcX, srcY, srcW, srcH, 0, 0, W, H);
  } else if (a.band && s.bgMode === 'auto') {
    // spejl-flisebelæg det tomme bånd, så teksturen bevares i naturlig skala.
    // Kun de midterste 60 % bruges — sidetal o.l. bor i hjørnerne.
    const sy = sl.h / AH;
    const bs = { x: g.scx + g.scw * 0.2, y: a.band.y0 * sy, w: g.scw * 0.6, h: Math.max(2, (a.band.y1 - a.band.y0) * sy) };
    const scale = W / bs.w;
    const tileH = Math.max(2, bs.h * scale);
    let ty = 0, flip = false;
    while (ty < H) {
      ctx.save();
      if (flip) { ctx.translate(0, ty + tileH); ctx.scale(1, -1); ctx.drawImage(bmp, bs.x, bs.y, bs.w, bs.h, 0, 0, W, tileH); }
      else ctx.drawImage(bmp, bs.x, bs.y, bs.w, bs.h, 0, ty, W, tileH);
      ctx.restore();
      ty += tileH; flip = !flip;
    }
  }

  if (mode !== 'crop') {
    for (const d of g.decoDraws) ctx.drawImage(bmp, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
    if (s.furniture === 'keep') for (const d of g.furnDraws) ctx.drawImage(bmp, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
    for (const d of g.imgDraws) ctx.drawImage(bmp, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);

    // --- tekst: fælles rækker, format-specifik skala ---
    if (rows && rows.length) {
      const wctx = wordsOf(a);
      const natGap = natGapFn(wctx);
      const m = rowMetrics(rows, wctx);
      const boxW = g.box.x1 - g.box.x0, boxH = g.box.y1 - g.box.y0;
      if (boxW > 5 && boxH > 5) {
        // aldrig mere end maxScale × kildens native opløsning
        const scale = Math.min(scaleFor(m, boxW, boxH), s.maxScale);
        // valgt tekstfarve: pr. slide, ellers global, ellers original
        const effColor = sl.ov.color || s.textColor || null;
        const totH = m.totH * scale;
        let y = g.box.y0 + (boxH - totH) / 2 + (sl.ov.off / 100) * (boxH - totH) / 2;
        for (const row of rows) {
          let rowW = 0, above = 0, below = 0;
          row.forEach((wd, i) => {
            rowW += wd.w + (i > 0 ? natGap(row[i - 1], wd) : 0);
            above = Math.max(above, wd.above);
            below = Math.max(below, wd.below);
          });
          below = Math.max(0, below);
          let x = s.align === 'center' ? g.box.x0 + (boxW - rowW * scale) / 2 : g.box.x0;
          // alle ord i rækken flugter på fælles baseline
          const baseline = y + above * scale;
          row.forEach((wd, i) => {
            if (i > 0) x += natGap(row[i - 1], wd) * scale;
            // udvid kilden et par px, så antialiasede kanter kommer med.
            // wd.k er individuel nedskalering af over-høje label-ord.
            const p = wctx.pad;
            const rawW = wd.f.x1 - wd.f.x0, rawH = wd.f.y1 - wd.f.y0;
            const ks = wd.k * scale;
            const dyPos = baseline - wd.above * scale - p * ks;
            if (effColor && wd.k === 1) {
              const t = tintWord(bmp, wd.f.x0 - p, wd.f.y0 - p, rawW + 2 * p, rawH + 2 * p, a.bg, effColor);
              ctx.drawImage(t.cvs, 0, 0, t.w, t.h,
                x - p * ks, dyPos, (rawW + 2 * p) * ks, (rawH + 2 * p) * ks);
            } else {
              ctx.drawImage(bmp, wd.f.x0 - p, wd.f.y0 - p, rawW + 2 * p, rawH + 2 * p,
                x - p * ks, dyPos, (rawW + 2 * p) * ks, (rawH + 2 * p) * ks);
            }
            x += wd.w * scale;
          });
          y = baseline + below * scale + wctx.rowGap * scale;
        }
      }
    }
  }

  // --- fast ramme tegnes til sidst (ovenpå) ---
  if (g.show) {
    const fw = sl.w, fh = sl.h;
    if (g.fr.r > 2) ctx.drawImage(bmp, fw - g.fr.r, 0, g.fr.r, fh, W - g.dr, 0, g.dr, H);
    if (g.fr.l > 2) ctx.drawImage(bmp, 0, 0, g.fr.l, fh, 0, 0, g.dl, H);
    if (g.fr.t > 2) ctx.drawImage(bmp, 0, 0, fw, g.fr.t, 0, 0, W, g.dt);
    if (g.fr.b > 2) ctx.drawImage(bmp, 0, fh - g.fr.b, fw, g.fr.b, 0, H - g.db, W, g.db);
  }
}

/* --------------------------- layout-cache pr. slide ------------------------- */
// Geometri, opdeling og ombrydning afhænger kun af indstillingerne og analysen
// — ikke af fx lodret-skyderen. Caches pr. slide med en indstillings-signatur,
// så en skyder-bevægelse kun koster selve tegningen.

function layoutSig(sl, s) {
  return JSON.stringify([s.formats.map((f) => [f.W, f.H, f.canvas]), s.pad, s.layout, s.align,
    s.maxScale, s.charLimit, s.split, s.sidebar, s.furniture, sl.ov.mode, sl.ov.img !== false, sl.ov.rows || 0]);
}

function layoutFor(sl, s) {
  const sig = layoutSig(sl, s);
  if (sl._layout && sl._layout.sig === sig) return sl._layout;
  const mode = resolveMode(sl, s);
  const geoms = s.formats.map((f) => geomFor(sl, s, f));
  const parts = mode !== 'crop' ? partsOf(sl, s) : [null];
  const rows = parts.map((part) => s.formats.map((_, fi) =>
    mode !== 'crop' && part ? chooseRows(sl, s, mode, [geoms[fi]], part) : null));
  sl._layout = { sig, mode, geoms, parts, rows };
  return sl._layout;
}

/* ------------------------- doven rendering af kort -------------------------- */
// Kun synlige kort renderes; resten markeres "dirty" og renderes først, når de
// scrolles ind. Gør indstillings-ændringer øjeblikkelige selv ved 200+ slides.

// preview tegnes i visningsopløsning (ikke fuld eksportstørrelse) — sparer
// ~4× tegnetid og op mod 1 GB canvas-hukommelse ved store decks
const previewScale = (fmt) => Math.min(1, (560 * (window.devicePixelRatio || 1)) / fmt.W);

const renderQueue = [];
let queuePumping = false;

function queueRender(sl) {
  if (!renderQueue.includes(sl)) renderQueue.push(sl);
  if (queuePumping) return;
  queuePumping = true;
  (async () => {
    let done = 0;
    while (renderQueue.length) {
      const x = renderQueue.shift();
      try { await renderOne(x); } catch (e) { console.error(x.name, e); }
      done++;
      if (renderQueue.length) setStatus(`rendering ${done}/${done + renderQueue.length}`, true, done / (done + renderQueue.length));
      await new Promise((r) => setTimeout(r));
    }
    queuePumping = false;
    setStatus(`ready · ${S.totalParts || S.slides.length} lower thirds`, false, null);
  })();
}

const cardObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const sl = e.target._slide;
    if (!sl) continue;
    sl._visible = e.isIntersecting;
    if (e.isIntersecting && sl._dirty) { sl._dirty = false; queueRender(sl); }
  }
}, { rootMargin: '600px' });

/* ----------------------- 16:9-canvas med transparens ----------------------- */
// Ved canvas-tilstand lægges strippen på en gennemsigtig 16:9-flade
// (fx 1920×1080) i top, midt eller bund — resten er transparent (PNG).

const fullCanvasH = (fmt) => Math.round((fmt.W * 9) / 16);

const dimStr = (fmt) => (fmt.canvas && fmt.canvas !== 'strip'
  ? `${fmt.W}×${fullCanvasH(fmt)}` : `${fmt.W}×${fmt.H}`);

async function renderUnit(sl, s, fmt, canvas, rows, mode, pixScale = 1) {
  if (!fmt.canvas || fmt.canvas === 'strip') {
    return drawSlide(sl, s, fmt, canvas, rows, mode, pixScale);
  }
  const strip = new OffscreenCanvas(2, 2);
  await drawSlide(sl, s, fmt, strip, rows, mode, pixScale);
  const FH = fullCanvasH(fmt);
  canvas.width = Math.max(2, Math.round(fmt.W * pixScale));
  canvas.height = Math.max(2, Math.round(FH * pixScale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const y = fmt.canvas === 'top' ? 0 : fmt.canvas === 'middle' ? (FH - fmt.H) / 2 : FH - fmt.H;
  ctx.drawImage(strip, 0, Math.round(y * pixScale));
}

/* ------------------------------ preview-kort ------------------------------- */

function buildCards(counts) {
  cardObserver.disconnect();
  const grid = $('grid');
  grid.innerHTML = '';
  $('deckHead').style.display = S.slides.length ? '' : 'none';
  $('deckTitle').textContent = S.deckName;
  if (!S.slides.length) showStart();

  S.slides.forEach((sl, i) => {
    sl._cards = [];
    const nParts = counts ? counts[i] : 1;
    // alle dele af samme slide grupperes, så man kan se, at de hænger sammen
    const group = document.createElement('div');
    group.className = 'group' + (nParts > 1 ? ' multi' : '');
    if (nParts > 1) {
      const tag = document.createElement('div');
      tag.className = 'group-tag';
      tag.textContent = `1 slide → ${nParts} parts, shown in order`;
      group.appendChild(tag);
    }
    for (let pi = 0; pi < nParts; pi++) {
      const card = document.createElement('div');
      card.className = 'card';
      const partLbl = nParts > 1 ? ` · part ${pi + 1}/${nParts}` : '';
      // ét mærket felt pr. format, så man kan se hvad der er hvad
      const strips = S.formats.map((f, fi) =>
        `<div class="fstrip" style="--fc:${FMT_COLORS[fi % 4]}"><div class="fstrip-lab"><span class="dotc"></span><b class="lb-name"></b><span class="lb-dim"></span></div><canvas class="out" data-fi="${fi}"></canvas></div>`).join('');
      card.innerHTML = `
        <div class="mon"><span class="tick-a"></span><span class="tick-b"></span>${strips}</div>
        <div class="umd"><span class="id">PGM ${String(i + 1).padStart(3, '0')}${partLbl}</span><span class="fn"></span><button class="fsbtn" title="View fullscreen">⛶</button></div>`;
      card.querySelector('.fn').textContent = sl.name;
      card.querySelector('.fsbtn').addEventListener('click', () => openViewer(sl, pi));
      card.classList.toggle('off', !sl.ov.on);
      sl._cards.push(card);
      group.appendChild(card);
    }
    // fælles kontroller for hele sliden (alle dele følger med)
    const ctrls = document.createElement('div');
    ctrls.className = 'ctrls';
    ctrls.innerHTML = `
      <select>
        <option value="auto">Auto</option>
        <option value="wrap">Rewrap</option>
        <option value="stack">Lines</option>
        <option value="oneline">One line</option>
        <option value="crop">Crop</option>
      </select>
      <select class="rowsel" title="Force a specific number of lines">
        <option value="">Lines: auto</option>
        <option value="1">1 line</option>
        <option value="2">2 lines</option>
        <option value="3">3 lines</option>
        <option value="4">4 lines</option>
      </select>
      <div class="sl"><span>vertical</span><input type="range" min="-100" max="100" value="0"></div>
      <input type="color" class="colpick" title="Text color for this slide">
      <button class="skip colreset" title="Back to default color" style="display:none">↺</button>
      <button class="skip imgbtn" style="display:none"></button>
      <button class="skip exbtn">exclude</button>`;
    const sel = ctrls.querySelector('select');
    sel.value = sl.ov.mode;
    sel.addEventListener('change', () => { sl.ov.mode = sel.value; saveDeckState(); renderAllSoon(); });
    const rowSel = ctrls.querySelector('.rowsel');
    rowSel.value = sl.ov.rows ? String(sl.ov.rows) : '';
    rowSel.addEventListener('change', () => {
      sl.ov.rows = +rowSel.value || null;
      saveDeckState();
      renderOne(sl);
    });
    const rng = ctrls.querySelector('input[type=range]');
    rng.value = sl.ov.off;
    rng.title = 'Vertical position — double-click resets';
    rng.addEventListener('input', debounce(() => { sl.ov.off = +rng.value; saveDeckState(); renderOne(sl); }, 80));
    rng.addEventListener('dblclick', () => { rng.value = 0; sl.ov.off = 0; saveDeckState(); renderOne(sl); });
    // til/fra for indlejrede billeder — vises kun når sliden har nogen
    const imgBtn = ctrls.querySelector('.imgbtn');
    imgBtn.textContent = sl.ov.img === false ? 'image: off' : 'image: on';
    imgBtn.addEventListener('click', () => {
      sl.ov.img = sl.ov.img === false;
      imgBtn.textContent = sl.ov.img ? 'image: on' : 'image: off';
      saveDeckState();
      renderOne(sl);
    });
    // tekstfarve pr. slide — ↺ går tilbage til standard (original/global)
    const col = ctrls.querySelector('.colpick');
    const colReset = ctrls.querySelector('.colreset');
    col.value = sl.ov.color || '#ffffff';
    colReset.style.display = sl.ov.color ? '' : 'none';
    col.addEventListener('input', debounce(() => {
      sl.ov.color = col.value;
      colReset.style.display = '';
      saveDeckState();
      renderOne(sl);
    }, 120));
    colReset.addEventListener('click', () => {
      sl.ov.color = null;
      colReset.style.display = 'none';
      saveDeckState();
      renderOne(sl);
    });
    ctrls.querySelector('.exbtn').addEventListener('click', () => {
      sl.ov.on = !sl.ov.on;
      sl._cards.forEach((c) => c.classList.toggle('off', !sl.ov.on));
      ctrls.querySelector('.exbtn').textContent = sl.ov.on ? 'exclude' : 'include';
      saveDeckState();
    });
    sl._ctrls = ctrls;
    group.appendChild(ctrls);
    group._slide = sl;
    cardObserver.observe(group);
    grid.appendChild(group);
  });
}

async function renderOne(sl) {
  if (!S.analyzed || !sl.ana || !sl._cards) return;
  const s = getSettings();
  const L = layoutFor(sl, s);
  if (sl._ctrls) {
    const b = sl._ctrls.querySelector('.imgbtn');
    if (b) b.style.display = sl.ana.images && sl.ana.images.length && L.mode !== 'crop' ? '' : 'none';
  }

  const maxW = Math.max(...s.formats.map((f) => f.W));
  for (let pi = 0; pi < sl._cards.length; pi++) {
    const card = sl._cards[pi];
    const rows = L.rows[pi] || [];
    const strips = card.querySelectorAll('.fstrip');
    try {
      for (let fi = 0; fi < s.formats.length; fi++) {
        const fmt = s.formats[fi];
        const strip = strips[fi];
        if (!strip) continue;
        const cnv = strip.querySelector('canvas.out');
        // ombrydning er PR. FORMAT — kortere formater må have flere/færre linjer
        await renderUnit(sl, s, fmt, cnv, rows[fi] || null, L.mode, previewScale(fmt));
        cnv._ref = { sl, pi, fi };
        // smallere formater vises proportionalt mindre, så bredde-forhold ses
        cnv.style.width = Math.min(100, (fmt.W / maxW) * 100) + '%';
        strip.querySelector('.lb-name').textContent = fmt.name;
        strip.querySelector('.lb-dim').textContent = dimStr(fmt);
      }
      card.classList.add('lit'); // fade-in når kortet er tegnet
    } catch (e) {
      console.error(sl.name, e);
    }
  }
}

async function renderAll() {
  if (!S.analyzed) return;
  S.renderToken++;
  const s = getSettings();
  // gen-byg kort-gitteret hvis antallet af dele ELLER formater har ændret sig
  const counts = S.slides.map((sl) => layoutFor(sl, s).parts.length);
  const sig = s.formats.length + '|' + counts.join(',');
  if (sig !== S.cardSig) { S.cardSig = sig; buildCards(counts); }
  S.totalParts = counts.reduce((a, b) => a + b, 0);
  $('deckMeta').textContent = `${S.slides.length} slides → ${S.totalParts} lower thirds · ` + s.formats.map((f) => `${f.name} ${dimStr(f)}`).join(' + ');
  // markér alle som ændrede; kun de synlige renderes nu, resten ved scroll
  renderQueue.length = 0;
  for (const sl of S.slides) {
    sl._dirty = true;
    if (sl._visible) { sl._dirty = false; queueRender(sl); }
  }
  if (!renderQueue.length && !queuePumping) setStatus(`ready · ${S.totalParts} lower thirds`, false, null);
}

const renderAllSoon = debounce(renderAll, 200);

/* --------------------------------- eksport --------------------------------- */

function outName(sl, s, fmt, pi, nParts) {
  const base = sl.name.replace(/\.[^.]+$/, '');
  const png = s.format === 'png' || (fmt.canvas && fmt.canvas !== 'strip');
  return base + (nParts > 1 ? `_part${pi + 1}` : '') + fmt.suffix + (png ? '.png' : '.jpg');
}

async function slideBlob(sl, s, fmt, rows, mode) {
  const off = new OffscreenCanvas(fmt.W, fmt.H);
  await renderUnit(sl, s, fmt, off, rows, mode);
  // transparens kræver PNG — 16:9-canvas eksporteres altid som PNG
  const png = s.format === 'png' || (fmt.canvas && fmt.canvas !== 'strip');
  return off.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 });
}

function exportCount(s, list) {
  return list.reduce((t, sl) => t + layoutFor(sl, s).parts.length, 0) * s.formats.length;
}

async function* exportBlobs(s, list) {
  const seen = new Map(); // "slide.jpg"+"slide.png" må ikke overskrive hinanden
  for (const sl of list) {
    const { mode, parts, rows } = layoutFor(sl, s);
    for (let pi = 0; pi < parts.length; pi++) {
      for (let fi = 0; fi < s.formats.length; fi++) {
        const fmt = s.formats[fi];
        let name = outName(sl, s, fmt, pi, parts.length);
        const nSeen = seen.get(name) || 0;
        seen.set(name, nSeen + 1);
        if (nSeen) name = name.replace(/(\.[^.]+)$/, `_${nSeen + 1}$1`);
        yield { name, blob: await slideBlob(sl, s, fmt, rows[pi][fi], mode) };
      }
    }
  }
}

async function exportToDir() {
  if (!S.analyzed) { toast('Please wait for the analysis to finish before exporting.', true); return; }
  const s = getSettings();
  let dir;
  try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { return; }
  const list = S.slides.filter((x) => x.ov.on);
  const totalFiles = exportCount(s, list);
  setStatus('exporting…', true, 0);
  let done = 0;
  try {
    for await (const { name, blob } of exportBlobs(s, list)) {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      done++;
      setStatus(`exporting ${done}/${totalFiles}`, true, done / totalFiles);
    }
    setStatus('ready', false, null);
    toast(`${done} files saved to "${dir.name}".`);
  } catch (e) {
    setStatus('ready', false, null);
    toast('Export interrupted: ' + e.message, true);
  }
}

/* -- minimal ZIP-skriver (store, ingen komprimering — PNG/JPG er komprimeret) -- */

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// inkrementel writer: filer tilføjes én ad gangen, så eksporten aldrig holder
// hele sættet dobbelt i hukommelsen
function zipWriter() {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0, count = 0;
  return {
    add(name, data) {
      const nm = enc.encode(name);
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true); // UTF-8-flag: danske filnavne (æøå) pakkes rigtigt ud
      head.setUint32(14, crc, true);
      head.setUint32(18, data.length, true);
      head.setUint32(22, data.length, true);
      head.setUint16(26, nm.length, true);
      parts.push(head.buffer, nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true); // UTF-8-flag
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, nm.length, true);
      c.setUint32(42, offset, true);
      central.push(c.buffer, nm);
      offset += 30 + nm.length + data.length;
      count++;
    },
    finish() {
      const cdSize = central.reduce((t, b) => t + (b.byteLength || b.length), 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, count, true);
      end.setUint16(10, count, true);
      end.setUint32(12, cdSize, true);
      end.setUint32(16, offset, true);
      return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
    },
  };
}

async function exportZip() {
  if (!S.analyzed) { toast('Please wait for the analysis to finish before exporting.', true); return; }
  const s = getSettings();
  const list = S.slides.filter((x) => x.ov.on);
  const totalFiles = exportCount(s, list);
  setStatus('packing zip…', true, 0);
  const zw = zipWriter();
  let packed = 0;
  for await (const { name, blob } of exportBlobs(s, list)) {
    zw.add(name, new Uint8Array(await blob.arrayBuffer()));
    packed++;
    setStatus(`packing ${packed}/${totalFiles}`, true, packed / totalFiles);
  }
  const zip = zw.finish();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = (S.deckName || 'lower-thirds').replace(/[^\w æøåÆØÅ-]+/g, ' ').trim() + '_lower-thirds.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  setStatus('ready', false, null);
  toast(`ZIP with ${packed} files downloaded.`);
}

/* ---------------------------------- events --------------------------------- */

const SETTING_IDS = ['pad', 'format', 'layoutMode', 'alignH', 'maxScale', 'charLimit',
  'bgMode', 'sidebarMode', 'furnitureMode', 'textColorMode', 'textColor', 'splitMode'];
const NO_RENDER = new Set(['format']); // bruges først ved eksport
const ON_COMMIT = new Set(['pad', 'charLimit']); // tal: render ved Enter/blur

const FMT_COLORS = ['#f0a62b', '#3d9bff', '#39c26f', '#9b7bff'];

function updateFormatSummary() {
  const el = $('formatSummary');
  if (!el) return;
  el.innerHTML = '';
  S.formats.forEach((f, i) => {
    const span = document.createElement('span');
    span.className = 'fs-item';
    span.style.setProperty('--fc', FMT_COLORS[i % 4]);
    span.innerHTML = `<span class="fs-dot"></span><b></b><span class="fs-dim"></span>`;
    span.querySelector('b').textContent = f.name || `Format ${i + 1}`;
    span.querySelector('.fs-dim').textContent = `${f.W}×${(f.canvas && f.canvas !== 'strip') ? Math.round(f.W * 9 / 16) : f.H}`;
    el.appendChild(span);
  });
}

// dynamisk format-editor (i formats-dialogen)
function buildFormatEditor() {
  updateFormatSummary();
  const list = $('formatListDlg');
  if (!list) return;
  list.innerHTML = '';
  S.formats.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'format-row';
    row.style.setProperty('--fc', FMT_COLORS[i % 4]);
    row.innerHTML = `
      <div class="fmt-swatch"></div>
      <label class="fld grow"><span>Name</span><input type="text" class="f-name"></label>
      <label class="fld"><span>Width</span><input type="number" class="f-w" min="64" step="2"></label>
      <span class="times">×</span>
      <label class="fld"><span>Height</span><input type="number" class="f-h" min="32" step="2"></label>
      <label class="fld"><span>File suffix</span><input type="text" class="f-suffix"></label>
      <label class="fld"><span>Canvas</span>
        <select class="f-canvas">
          <option value="strip">Strip only</option>
          <option value="top">16:9 top</option>
          <option value="middle">16:9 center</option>
          <option value="bottom">16:9 bottom</option>
        </select>
      </label>
      <button class="x" title="Remove format" ${S.formats.length <= 1 ? 'disabled' : ''}>✕</button>`;
    row.querySelector('.f-name').value = f.name || '';
    row.querySelector('.f-w').value = f.W;
    row.querySelector('.f-h').value = f.H;
    row.querySelector('.f-suffix').value = f.suffix || '';
    row.querySelector('.f-canvas').value = f.canvas || 'strip';
    const upd = (render) => { saveFormats(); markDirty(); if (render) renderAllSoon(); };
    row.querySelector('.f-name').addEventListener('input', (e) => { f.name = e.target.value; upd(false); });
    row.querySelector('.f-suffix').addEventListener('input', (e) => { f.suffix = e.target.value; upd(false); });
    row.querySelector('.f-w').addEventListener('change', (e) => { f.W = +e.target.value; upd(true); });
    row.querySelector('.f-h').addEventListener('change', (e) => { f.H = +e.target.value; upd(true); });
    row.querySelector('.f-canvas').addEventListener('change', (e) => { f.canvas = e.target.value; upd(true); });
    row.querySelector('.x').addEventListener('click', () => {
      if (S.formats.length <= 1) return;
      S.formats.splice(i, 1); buildFormatEditor(); saveFormats(); markDirty(); renderAllSoon();
    });
    list.appendChild(row);
  });
}
function addFormat(f) {
  if (S.formats.length >= 4) { toast('Up to 4 formats.', true); return; }
  const n = S.formats.length + 1;
  S.formats.push(f || { name: `Format ${n}`, W: 1920, H: 1080, suffix: `_f${n}`, canvas: 'strip' });
  buildFormatEditor(); saveFormats(); markDirty(); renderAllSoon();
}
function saveFormats() { try { localStorage.setItem('ltfactory.formats', JSON.stringify(S.formats)); } catch { /* */ } }

// øvrige indstillinger huskes mellem sessioner
function snapshotSettings() {
  const o = { formats: S.formats.map((f) => ({ ...f })) };
  for (const id of SETTING_IDS) o[id] = $(id).value;
  return o;
}
function applySettings(o) {
  if (!o) return;
  if (Array.isArray(o.formats) && o.formats.length) { S.formats = o.formats.map((f) => ({ ...f })); buildFormatEditor(); saveFormats(); }
  for (const id of SETTING_IDS) { if (id in o) $(id).value = o[id]; }
  $('textColorRow').style.display = $('textColorMode').value === 'custom' ? '' : 'none';
}
function saveSettings() {
  try { localStorage.setItem('ltfabrik.settings.v1', JSON.stringify(snapshotSettings())); } catch { /* privat browsing */ }
}
function restoreSettings() {
  // formater
  try { const f = JSON.parse(localStorage.getItem('ltfactory.formats')); if (Array.isArray(f) && f.length) S.formats = f; } catch { /* */ }
  if (!S.formats) S.formats = DEFAULT_FORMATS.map((f) => ({ ...f }));
  buildFormatEditor();
  // øvrige felter
  let o = null;
  try { o = JSON.parse(localStorage.getItem('ltfabrik.settings.v1')); } catch { /* ignorér */ }
  if (o) for (const id of SETTING_IDS) { if (id in o) $(id).value = o[id]; }
  $('textColorRow').style.display = $('textColorMode').value === 'custom' ? '' : 'none';
}

for (const id of SETTING_IDS) {
  $(id).addEventListener(ON_COMMIT.has(id) ? 'change' : 'input', () => {
    if (id === 'textColorMode') $('textColorRow').style.display = $('textColorMode').value === 'custom' ? '' : 'none';
    saveSettings();
    markDirty();
    if (!NO_RENDER.has(id)) renderAllSoon();
  });
}

$('addFormat').addEventListener('click', () => addFormat());
document.querySelectorAll('.format-tools .chip').forEach((c) => {
  c.addEventListener('click', () => addFormat({
    name: c.dataset.name, W: +c.dataset.w, H: +c.dataset.h,
    suffix: '_' + c.dataset.name.toLowerCase().replace(/[^\w-]+/g, ''), canvas: c.dataset.canvas || 'strip',
  }));
});

// formats-dialog: opsætning ved projektstart (mode 'new') eller senere rettelser ('edit')
function openFormatsDialog(mode) {
  buildFormatEditor();
  const isNew = mode === 'new';
  $('formatsTitle').textContent = isNew ? 'New project' : 'Edit formats';
  $('formatsIntro').style.display = isNew ? '' : 'none';
  $('setupNameRow').style.display = isNew ? '' : 'none';
  $('setupFoot').style.display = isNew ? '' : 'none';
  $('editFoot').style.display = isNew ? 'none' : '';
  if (isNew) $('setupName').value = '';
  $('formatsDlg').classList.add('on');
  if (isNew) setTimeout(() => $('setupName').focus(), 30);
}
function closeFormatsDialog() { $('formatsDlg').classList.remove('on'); }
$('editFormats').addEventListener('click', () => openFormatsDialog('edit'));
$('formatsClose').addEventListener('click', closeFormatsDialog);
$('fmtDone').addEventListener('click', closeFormatsDialog);
$('formatsDlg').addEventListener('click', (e) => { if (e.target === $('formatsDlg')) closeFormatsDialog(); });
// i "new" mode: navnet gemmes og slides vælges herfra
$('fmtChooseFolder').addEventListener('click', () => { S.pendingName = $('setupName').value.trim() || null; $('dirPick').click(); });
$('fmtImportFiles').addEventListener('click', () => { S.pendingName = $('setupName').value.trim() || null; $('filePick').click(); });

/* ------------------- fullscreen-viewer med navigation ---------------------- */
// Åbnes med ⛶ på et kort eller ved klik på et preview. Viser enheden (slide-del)
// i fuld opløsning med begge formater, og der bladres med pile/piletaster.

let viewUnits = [];
let viewIdx = -1;

function buildViewUnits(s) {
  const u = [];
  for (const sl of S.slides) {
    if (!sl.ov.on || !sl.ana) continue;
    const L = layoutFor(sl, s);
    for (let pi = 0; pi < L.parts.length; pi++) u.push({ sl, pi });
  }
  return u;
}

async function showUnit(idx) {
  if (!viewUnits.length) return;
  viewIdx = (idx + viewUnits.length) % viewUnits.length;
  const { sl, pi } = viewUnits[viewIdx];
  const s = getSettings();
  const L = layoutFor(sl, s);
  const rows = L.rows[pi] || [];
  // byg ét mærket felt pr. format (dynamisk 1-4)
  const stack = $('lightStack');
  const maxW = Math.max(...s.formats.map((f) => f.W));
  stack.innerHTML = s.formats.map((f, fi) =>
    `<div class="lstrip" style="--fc:${FMT_COLORS[fi % 4]};width:${Math.min(100, (f.W / maxW) * 100)}%">
       <div class="lstrip-lab"><span class="dotc"></span><b></b><span class="ld"></span></div>
       <canvas></canvas></div>`).join('');
  const strips = stack.querySelectorAll('.lstrip');
  for (let fi = 0; fi < s.formats.length; fi++) {
    const fmt = s.formats[fi];
    await renderUnit(sl, s, fmt, strips[fi].querySelector('canvas'), rows[fi] || null, L.mode, 1);
    strips[fi].querySelector('b').textContent = fmt.name;
    strips[fi].querySelector('.ld').textContent = dimStr(fmt);
  }
  const partLbl = L.parts.length > 1 ? ` · part ${pi + 1}/${L.parts.length}` : '';
  $('lightMeta').textContent =
    `${viewIdx + 1}/${viewUnits.length} · ${sl.name}${partLbl} · ← → navigate · Esc close`;
  syncViewerCtrls(sl);
}

// hold viewer-kontrollerne og kort-kontrollerne i takt med sl.ov
function syncCardCtrls(sl) {
  const c = sl._ctrls;
  if (!c) return;
  c.querySelector('select').value = sl.ov.mode;
  c.querySelector('.rowsel').value = sl.ov.rows ? String(sl.ov.rows) : '';
  c.querySelector('input[type=range]').value = sl.ov.off;
  c.querySelector('.colpick').value = sl.ov.color || '#ffffff';
  c.querySelector('.colreset').style.display = sl.ov.color ? '' : 'none';
  c.querySelector('.imgbtn').textContent = sl.ov.img === false ? 'image: off' : 'image: on';
  c.querySelector('.exbtn').textContent = sl.ov.on ? 'exclude' : 'include';
  sl._cards.forEach((cd) => cd.classList.toggle('off', !sl.ov.on));
}

function syncViewerCtrls(sl) {
  $('lvMode').value = sl.ov.mode;
  $('lvRows').value = sl.ov.rows ? String(sl.ov.rows) : '';
  $('lvOff').value = sl.ov.off;
  $('lvColor').value = sl.ov.color || '#ffffff';
  $('lvColorReset').style.display = sl.ov.color ? '' : 'none';
  const hasImg = sl.ana && sl.ana.images && sl.ana.images.length && resolveMode(sl, getSettings()) !== 'crop';
  $('lvImg').style.display = hasImg ? '' : 'none';
  $('lvImg').textContent = sl.ov.img === false ? 'image: off' : 'image: on';
  $('lvSkip').textContent = sl.ov.on ? 'exclude' : 'include';
}

async function openViewer(sl, pi) {
  if (!S.analyzed) return;
  viewUnits = buildViewUnits(getSettings());
  const idx = viewUnits.findIndex((u) => u.sl === sl && u.pi === pi);
  $('lightbox').classList.add('on');
  const lb = $('lightbox');
  if (lb.requestFullscreen) lb.requestFullscreen().catch(() => { /* fallback: overlay */ });
  await showUnit(idx < 0 ? 0 : idx);
}

function closeViewer() {
  $('lightbox').classList.remove('on');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* allerede ude */ });
}

const viewerOpen = () => $('lightbox').classList.contains('on');

$('grid').addEventListener('click', (e) => {
  const cnv = e.target.closest('canvas.out');
  if (cnv && cnv._ref) openViewer(cnv._ref.sl, cnv._ref.pi);
});
$('lightPrev').addEventListener('click', (e) => { e.stopPropagation(); showUnit(viewIdx - 1); });
$('lightNext').addEventListener('click', (e) => { e.stopPropagation(); showUnit(viewIdx + 1); });
$('lightClose').addEventListener('click', (e) => { e.stopPropagation(); closeViewer(); });
$('lightbox').addEventListener('click', (e) => {
  if (!e.target.closest('.light-btn') && !e.target.closest('#lightCtrls')) closeViewer();
});
document.addEventListener('keydown', (e) => {
  if (!viewerOpen()) return;
  // piletaster i kontrollerne (fx skyderen) må ikke også bladre
  const inCtrls = e.target && e.target.closest && e.target.closest('#lightCtrls');
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft' && !inCtrls) showUnit(viewIdx - 1);
  else if (e.key === 'ArrowRight' && !inCtrls) showUnit(viewIdx + 1);
});

// per-slide justeringer direkte i vieweren
const lvUnit = () => viewUnits[viewIdx] || {};

$('lvMode').addEventListener('change', async () => {
  const { sl, pi } = lvUnit();
  if (!sl) return;
  sl.ov.mode = $('lvMode').value;
  saveDeckState();
  syncCardCtrls(sl);
  renderAllSoon(); // antal dele kan ændre sig → kort genopbygges
  viewUnits = buildViewUnits(getSettings());
  let idx = viewUnits.findIndex((u) => u.sl === sl && u.pi === pi);
  if (idx < 0) idx = viewUnits.findIndex((u) => u.sl === sl);
  await showUnit(idx < 0 ? Math.min(viewIdx, viewUnits.length - 1) : idx);
});
$('lvRows').addEventListener('change', async () => {
  const { sl } = lvUnit();
  if (!sl) return;
  sl.ov.rows = +$('lvRows').value || null;
  saveDeckState(); syncCardCtrls(sl); renderOne(sl);
  await showUnit(viewIdx);
});
$('lvOff').addEventListener('input', debounce(async () => {
  const { sl } = lvUnit();
  if (!sl) return;
  sl.ov.off = +$('lvOff').value;
  saveDeckState(); syncCardCtrls(sl); renderOne(sl);
  await showUnit(viewIdx);
}, 90));
$('lvColor').addEventListener('input', debounce(async () => {
  const { sl } = lvUnit();
  if (!sl) return;
  sl.ov.color = $('lvColor').value;
  saveDeckState(); syncCardCtrls(sl); renderOne(sl);
  await showUnit(viewIdx);
}, 150));
$('lvColorReset').addEventListener('click', async () => {
  const { sl } = lvUnit();
  if (!sl) return;
  sl.ov.color = null;
  saveDeckState(); syncCardCtrls(sl); renderOne(sl);
  await showUnit(viewIdx);
});
$('lvImg').addEventListener('click', async () => {
  const { sl } = lvUnit();
  if (!sl) return;
  sl.ov.img = sl.ov.img === false;
  saveDeckState(); syncCardCtrls(sl); renderOne(sl);
  await showUnit(viewIdx);
});
$('lvSkip').addEventListener('click', async () => {
  const { sl } = lvUnit();
  if (!sl) return;
  sl.ov.on = !sl.ov.on;
  saveDeckState(); syncCardCtrls(sl);
  viewUnits = buildViewUnits(getSettings());
  if (!viewUnits.length) { closeViewer(); return; }
  await showUnit(Math.min(viewIdx, viewUnits.length - 1));
});

$('clearDeck').addEventListener('click', clearDeck);

// File-menu i toppen
function closeFileMenu() { $('fileMenu').classList.remove('open'); }
$('fileBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('fileMenu').classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#fileMenu')) closeFileMenu();
});

function doSave() { saveProject(); }
$('miSave').addEventListener('click', () => { closeFileMenu(); saveProject(); });
$('miSaveAs').addEventListener('click', () => { closeFileMenu(); saveProjectAs(); });
$('miSaveFile').addEventListener('click', () => { closeFileMenu(); saveProjectAs(); });
$('miOpenFile').addEventListener('click', () => { closeFileMenu(); $('projFilePick').click(); });
$('miImportFiles').addEventListener('click', () => { closeFileMenu(); $('filePick').click(); });
$('miImportFolder').addEventListener('click', () => { closeFileMenu(); $('dirPick').click(); });
$('miClear').addEventListener('click', () => { closeFileMenu(); clearDeck(); });
$('projFilePick').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openProjectFile(f); e.target.value = ''; });

// Ctrl+S gemmer projektet, Ctrl+, åbner Preferences
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openPrefs(); }
});

/* -------------------------------- preferences ------------------------------- */

const ACCENTS = [
  { id: 'amber', c: '#f0a62b', hi: '#ffc15e' },
  { id: 'blue', c: '#3d9bff', hi: '#6fb8ff' },
  { id: 'green', c: '#39c26f', hi: '#57d98a' },
  { id: 'violet', c: '#9b7bff', hi: '#b79dff' },
  { id: 'red', c: '#ff5a5f', hi: '#ff8085' },
  { id: 'teal', c: '#2fc6c0', hi: '#5ad9d4' },
];
const DEFAULT_PREFS = { theme: 'dark', accent: 'amber', motion: false, reopen: true, format: 'png' };

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('ltfabrik.prefs')) || {}; } catch { /* */ }
  return { ...DEFAULT_PREFS, ...p };
}
function savePrefs(p) { try { localStorage.setItem('ltfabrik.prefs', JSON.stringify(p)); } catch { /* */ } }

function applyPrefs(p) {
  const root = document.documentElement;
  root.setAttribute('data-theme', p.theme);
  const acc = ACCENTS.find((a) => a.id === p.accent) || ACCENTS[0];
  root.style.setProperty('--accent', acc.c);
  root.style.setProperty('--accent-hi', acc.hi);
  root.classList.toggle('reduce-motion', !!p.motion);
  // default filtype spejles til eksport-kontrollen
  if ($('format').value !== p.format) { $('format').value = p.format; saveSettings(); }
}

function openPrefs() {
  const p = loadPrefs();
  // theme-segment
  $('prefTheme').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === p.theme));
  // accent-swatches
  const sw = $('prefAccent');
  sw.innerHTML = '';
  for (const a of ACCENTS) {
    const b = document.createElement('button');
    b.style.setProperty('--sw', a.c);
    b.className = a.id === p.accent ? 'on' : '';
    b.title = a.id;
    b.addEventListener('click', () => {
      const cur = loadPrefs(); cur.accent = a.id; savePrefs(cur); applyPrefs(cur);
      sw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    sw.appendChild(b);
  }
  $('prefMotion').checked = !!p.motion;
  $('prefReopen').checked = !!p.reopen;
  $('prefFormat').value = p.format;
  $('prefVersion').textContent = S.appVersion || 'local';
  $('prefsDlg').classList.add('on');
}

$('prefTheme').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    const p = loadPrefs(); p.theme = b.dataset.v; savePrefs(p); applyPrefs(p);
    $('prefTheme').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
});
$('prefMotion').addEventListener('change', () => { const p = loadPrefs(); p.motion = $('prefMotion').checked; savePrefs(p); applyPrefs(p); });
$('prefReopen').addEventListener('change', () => { const p = loadPrefs(); p.reopen = $('prefReopen').checked; savePrefs(p); });
$('prefFormat').addEventListener('change', () => { const p = loadPrefs(); p.format = $('prefFormat').value; savePrefs(p); applyPrefs(p); markDirty(); renderAllSoon(); });
$('prefsClose').addEventListener('click', () => $('prefsDlg').classList.remove('on'));
$('prefsDlg').addEventListener('click', (e) => { if (e.target === $('prefsDlg')) $('prefsDlg').classList.remove('on'); });
$('miPrefs').addEventListener('click', () => { closeFileMenu(); openPrefs(); });

// hent app-version til About (fra /api/caps hvis muligt)
fetch('/api/caps').then((r) => r.json()).then((c) => { if (c.version) S.appVersion = c.version; }).catch(() => {});

// advarsel ved lukning med usavede ændringer.
// I Electron håndteres det af en pæn dialog i main-processen; i browseren
// bruges standard-advarslen.
const IS_ELECTRON = navigator.userAgent.includes('Electron');
window.__ltDirty = () => !!(S.dirty && S.slides.length);
// ved lukning: gem lydløst hvis projektet allerede har en fil; ellers spring over
// (en fil-vælger midt i en lukning er upraktisk — brugeren blev allerede spurgt)
window.__ltQuickSave = async () => { if (S.fileHandle) await saveProject(); };
window.__ltHasFile = () => !!S.fileHandle;
if (!IS_ELECTRON) {
  window.addEventListener('beforeunload', (e) => {
    if (window.__ltDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}
// native fullscreen-Esc lukker fullscreen uden keydown — luk overlayet med
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && viewerOpen()) $('lightbox').classList.remove('on');
});

$('reanalyze').addEventListener('click', async () => {
  const pct = (id) => Math.min(0.25, Math.max(0, (+$(id).value || 0) / 100));
  S.frame = { l: pct('mLeft'), r: pct('mRight'), t: pct('mTop'), b: pct('mBottom') };
  $('mLeft').value = (S.frame.l * 100).toFixed(1);
  $('mRight').value = (S.frame.r * 100).toFixed(1);
  $('mTop').value = (S.frame.t * 100).toFixed(1);
  $('mBottom').value = (S.frame.b * 100).toFixed(1);
  S.manualFrame = true;
  saveDeckState();
  if (!S.slides.length) return;
  setStatus('re-analyzing…', true, 0);
  for (const sl of S.slides) if (sl.small) { analyzeSlide(sl); await refineSlide(sl); }
  renderAll();
});

$('exportDir').addEventListener('click', exportToDir);
$('exportZip').addEventListener('click', exportZip);

/* ------------------------------ ribbon tabs -------------------------------- */
$('ribbonTabs').querySelectorAll('.rtab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $('ribbonTabs').querySelectorAll('.rtab').forEach((t) => t.classList.toggle('on', t === tab));
    document.querySelectorAll('.rpanel').forEach((p) => p.classList.toggle('on', p.dataset.tab === tab.dataset.tab));
    document.body.classList.remove('ribbon-collapsed');
  });
});
$('ribbonToggle').addEventListener('click', () => document.body.classList.toggle('ribbon-collapsed'));

/* ------------------------------ export menu -------------------------------- */
$('exportBtn').addEventListener('click', (e) => {
  if ($('exportBtn').disabled) return;
  e.stopPropagation();
  $('exportMenu').classList.toggle('open');
});
$('exportDir').addEventListener('click', () => { $('exportMenu').classList.remove('open'); exportToDir(); });
$('exportZip').addEventListener('click', () => { $('exportMenu').classList.remove('open'); exportZip(); });
document.addEventListener('click', (e) => { if (!e.target.closest('#exportMenu')) $('exportMenu').classList.remove('open'); });

/* ------------------------------ start screen ------------------------------- */
async function showStart() {
  await refreshRecentsUI(); // fylder også startRecent
  $('startScreen').classList.add('on');
}
function hideStart() { $('startScreen').classList.remove('on'); }

let startSel = null; // valgt recent-record
function buildStartRecent(recents) {
  const list = $('startRecent');
  if (!list) return;
  list.innerHTML = '';
  startSel = null;
  $('startOpen').disabled = true;
  $('startOpen').closest('.start-actions').style.display = recents && recents.length ? '' : 'none';
  if (!recents || !recents.length) {
    list.innerHTML = '<div class="recent-empty">No recent projects yet.<br>Start a new one, or open a .ltproj file →</div>';
    return;
  }
  for (const r of recents) {
    const b = document.createElement('button');
    b.className = 'recent-item';
    b.innerHTML = '<div><div class="nm"></div><div class="sub"></div></div><span class="dt"></span><button class="del" title="Remove from recents">✕</button>';
    b.querySelector('.nm').textContent = r.name;
    b.querySelector('.sub').textContent = r.deckName || '';
    b.querySelector('.dt').textContent = new Date(r.savedAt).toLocaleDateString();
    b.addEventListener('click', async (e) => {
      if (e.target.closest('.del')) { e.stopPropagation(); await idbDel(r.id); refreshRecentsUI(); return; }
      list.querySelectorAll('.recent-item').forEach((x) => x.classList.toggle('on', x === b));
      startSel = r; $('startOpen').disabled = false;
    });
    b.addEventListener('dblclick', () => { hideStart(); openRecent(r); });
    list.appendChild(b);
  }
}
$('startOpen').addEventListener('click', () => { if (startSel) { hideStart(); openRecent(startSel); } });
// New project = opsætnings-vindue (formater) → derefter vælg slides
$('startNew').addEventListener('click', () => openFormatsDialog('new'));
$('startImport').addEventListener('click', () => $('filePick').click());
$('startOpenFile').addEventListener('click', () => $('projFilePick').click());
$('miStart').addEventListener('click', () => { closeFileMenu(); showStart(); });

/* ------------------------------ file pickers ------------------------------- */
$('filePick').addEventListener('change', (e) => { hideStart(); loadFiles(e.target.files); e.target.value = ''; });
$('dirPick').addEventListener('change', (e) => { hideStart(); loadFiles(e.target.files); e.target.value = ''; });
$('pickFiles').addEventListener('click', () => $('filePick').click());
$('pickDir').addEventListener('click', () => $('dirPick').click());

/* ------------------------------ drag & drop -------------------------------- */
async function handleDropEvent(e) {
  e.preventDefault();
  $('startDrop').classList.remove('over');
  const entries = [], plain = [];
  for (const it of e.dataTransfer.items || []) {
    const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if (entry) entries.push(entry);
    else { const f = it.getAsFile(); if (f) plain.push(f); }
  }
  if (!entries.length && !plain.length) plain.push(...e.dataTransfer.files);
  const files = [...plain];
  const walkEntry = (entry) => new Promise((resolve) => {
    if (entry.isFile) entry.file((f) => { files.push(f); resolve(); }, resolve);
    else if (entry.isDirectory) {
      const rd = entry.createReader();
      const readAll = () => rd.readEntries(async (es) => {
        if (!es.length) return resolve();
        for (const en of es) await walkEntry(en);
        readAll();
      }, resolve);
      readAll();
    } else resolve();
  });
  for (const entry of entries) await walkEntry(entry);
  // en .ltproj trukket ind åbnes som projekt
  const proj = files.find((f) => /\.ltproj$/i.test(f.name));
  if (proj) { hideStart(); openProjectFile(proj); return; }
  if (files.length) { hideStart(); loadFiles(files); }
}
window.addEventListener('dragover', (e) => { e.preventDefault(); if ($('startScreen').classList.contains('on')) $('startDrop').classList.add('over'); });
window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $('startDrop').classList.remove('over'); });
window.addEventListener('drop', handleDropEvent);

// debug-hook til automatiseret test
window.__lt = { S, loadServerFolder, renderAll, getSettings, resolveMode, geomFor, chooseRows, partsOf, layoutFor, slideBlob, drawSlide, zipWriter, buildProjectBlob, openProjectBlob, readZip };

applyPrefs(loadPrefs());
restoreSettings();
updateProjectUI();
loadServerFolders();
setStatus('ready — pick a folder', false, null);
