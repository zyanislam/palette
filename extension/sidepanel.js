/* Palette — side panel */
'use strict';
const $ = (id) => document.getElementById(id);
const M = window.PaletteMerge, P = window.PaletteImage;
const PREFIX = 'PALETTE1:';

const state = {
  tabId: null, host: '', editor: false,
  kirki: null,              // last GET data
  incoming: null,           // { source, label, modes, colors }
  modeMap: {},
  settings: { naming: 'smart', theme: 'system' },
  lastSig: null, busy: false,
};

// ---------- utilities ----------
function show(view) {
  ['vNoKirki', 'vEmpty', 'vBusy', 'vReview'].forEach((v) => { $(v).hidden = v !== view; });
  $('foot').hidden = view !== 'vReview';
  $('headSum').hidden = $('clearBtn').hidden = view !== 'vReview';
}
// "TAB" → "Tab", "MOBILE COLORS" → "Mobile Colors". Mixed-case text is left alone.
function niceCase(s) {
  s = String(s || '').trim();
  if (!/[A-Z]/.test(s) || s !== s.toUpperCase()) return s;
  // Title-case each word; 2-letter acronyms (BG, UI) stay as they are.
  return s.replace(/[A-Z]+/g, (w) => (w.length <= 2 ? w : w[0] + w.slice(1).toLowerCase()));
}
function banner(msg) { const b = $('banner'); b.textContent = msg; b.hidden = !msg; if (msg) setTimeout(() => { if (b.textContent === msg) b.hidden = true; }, 6000); }
let toastTimer;
function toast(msg, action, fn) {
  const t = $('toast'); t.innerHTML = ''; const s = document.createElement('span'); s.textContent = msg; t.append(s);
  if (action) { const b = document.createElement('button'); b.textContent = action; b.onclick = () => { t.hidden = true; fn(); }; t.append(b); }
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 12000 : 3500);
}
function sheet(title, bodyEl, okText = 'OK') {
  return new Promise((res) => {
    $('sheetTitle').textContent = title; const b = $('sheetBody'); b.innerHTML = ''; if (bodyEl) b.append(bodyEl);
    $('sheetOk').textContent = okText; $('sheet').hidden = false;
    const done = (v) => { $('sheet').hidden = true; $('sheetOk').onclick = $('sheetCancel').onclick = null; res(v); };
    $('sheetOk').onclick = () => done(true); $('sheetCancel').onclick = () => done(false);
  });
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const sig = (s) => { let h = 0; for (let i = 0; i < s.length; i += Math.max(1, s.length >> 12)) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };

const forcedTab = +new URLSearchParams(location.search).get('tab') || null; // used by tests
async function activeTab() {
  if (forcedTab) return chrome.tabs.get(forcedTab);
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t;
}
async function pageOp(op, payload) {
  if (state.tabId == null) throw new Error('No tab');
  const [r] = await chrome.scripting.executeScript({ target: { tabId: state.tabId }, world: 'MAIN', func: paletteKirkiOp, args: [op, payload ?? null] });
  const res = r && r.result;
  if (!res || !res.ok) throw new Error(res && res.error || 'Kirki did not respond');
  return res;
}

// ---------- settings ----------
async function loadSettings() {
  const s = await chrome.storage.local.get(['settings', 'lastSig']);
  Object.assign(state.settings, s.settings || {}); state.lastSig = s.lastSig || null;
  applyTheme();
  document.querySelectorAll('.seg').forEach((seg) => {
    const k = seg.dataset.setting;
    seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.v === state.settings[k]); });
  });
}
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('palette-theme', t); } catch {}
}
document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.settings[seg.dataset.setting] = b.dataset.v;
  seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  chrome.storage.local.set({ settings: state.settings });
  if (seg.dataset.setting === 'theme') applyTheme(); else renderReview();
}));
const menu = $('menu');
$('menuBtn').onclick = (e) => {
  e.stopPropagation();
  if (menu.hidden) { menu.hidden = false; requestAnimationFrame(() => menu.classList.add('open')); }
  else closeMenu();
};
function closeMenu() { menu.classList.remove('open'); setTimeout(() => { if (!menu.classList.contains('open')) menu.hidden = true; }, 280); }
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });

// ---------- context ----------
async function refresh() {
  const tab = await activeTab();
  state.tabId = tab ? tab.id : null; state.editor = false;
  try {
    const info = await pageOp('info');
    state.editor = info.isEditor; state.host = info.host;
  } catch { state.editor = false; }
  if (!state.editor) { show('vNoKirki'); return; }
  if (state.incoming) renderReview(); else if (!state.busy) show('vEmpty');
  await loadLinks();
  try { state.kirki = (await pageOp('get')).data; if (state.incoming) { suggestModes(); renderReview(); } }
  catch (e) { banner('Couldn\'t read Kirki variables: ' + e.message); }
}
chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((id, info) => { if (id === state.tabId && info.status === 'complete') refresh(); });

// ---------- input: clipboard / paste / drop / file ----------
async function tryClipboard() {
  if (!state.editor || state.busy || state.incoming || !document.hasFocus()) return;
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      if (it.types.includes('text/plain')) {
        const t = await (await it.getType('text/plain')).text();
        if (t.startsWith(PREFIX) && sig(t) !== state.lastSig) return loadFigma(t);
      }
      const img = it.types.find((x) => x.startsWith('image/'));
      if (img) {
        const blob = await it.getType(img);
        const s = 'img:' + blob.size + ':' + img;
        if (s !== state.lastSig) return loadImage(blob, s);
      }
    }
  } catch { /* clipboard not available until the panel has focus — ⌘V still works */ }
}
window.addEventListener('focus', tryClipboard);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tryClipboard(); });

document.addEventListener('paste', (e) => {
  if (e.target.closest && e.target.closest('input')) return;
  const dt = e.clipboardData; if (!dt) return;
  const t = dt.getData('text/plain');
  if (t && t.startsWith(PREFIX)) { e.preventDefault(); loadFigma(t); return; }
  const f = [...dt.files].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); loadImage(f, 'img:' + f.size + ':' + f.type); }
});
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) loadImage(f, 'img:' + f.size + ':' + f.type); });
$('file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadImage(f, 'img:' + f.size + ':' + f.type); e.target.value = ''; });

// ---------- Figma ----------
function loadFigma(text) {
  try {
    const p = JSON.parse(text.slice(PREFIX.length));
    if (!p || !Array.isArray(p.colors) || !Array.isArray(p.modes)) throw 0;
    p.colors.forEach((c) => { c.selected = true; c.flags = c.flags || []; });
    setIncoming({ source: 'figma', fileKey: p.fileKey, label: p.file ? 'from ' + p.file : 'from Figma', modes: p.modes, colors: p.colors }, sig(text));
  } catch { banner('That Figma data looks incomplete. Run the plugin again.'); }
}

// ---------- image ----------
// ---------- smooth progress ----------
// The bar eases toward the latest target and keeps creeping slowly between updates, so it never looks stuck.
const prog = { cur: 0, target: 0, raf: 0 };
function setProgress(t) { prog.target = Math.max(prog.target, Math.min(1, t)); if (!prog.raf) prog.raf = requestAnimationFrame(tickProgress); }
function tickProgress() {
  const ceiling = Math.min(0.99, prog.target + 0.08);            // creep a little past the last real update
  const goal = prog.cur < prog.target ? prog.target : ceiling;
  const speed = prog.cur < prog.target ? 0.12 : 0.004;
  prog.cur += (goal - prog.cur) * speed;
  const pct = prog.cur * 100;
  $('busyBar').style.width = pct + '%';
  $('busyPct').textContent = Math.round(pct) + '%';
  prog.raf = prog.target >= 1 && prog.cur > 0.995 ? 0 : requestAnimationFrame(tickProgress);
}
function resetProgress() { cancelAnimationFrame(prog.raf); prog.raf = 0; prog.cur = prog.target = 0; $('busy').classList.remove('done'); setProgress(0.02); }
function finishProgress() { setProgress(1); $('busy').classList.add('done'); return new Promise((r) => setTimeout(r, 380)); }

let worker = null;
let workerIdle = null;
function idleWorker() {   // free ~100 MB of memory when the reader hasn't been used for 3 minutes
  clearTimeout(workerIdle);
  workerIdle = setTimeout(async () => { if (worker && !state.busy) { const w = await worker; worker = null; w.terminate(); } }, 180000);
}
async function getWorker(progress) {
  idleWorker();
  if (worker) return worker;
  const url = (p) => chrome.runtime.getURL(p);
  worker = Tesseract.createWorker('eng', 1, {
    workerPath: url('vendor/tesseract/worker.min.js'), corePath: url('vendor/tesseract/tesseract-core-simd-lstm.js'), langPath: url('vendor/tesseract/lang'),
    workerBlobURL: false, gzip: true, cacheMethod: 'none',
    logger: (m) => { if (m.status === 'recognizing text' && progress) progress(m.progress); },
  });
  worker.catch(() => { worker = null; });
  return worker;
}
function toCanvas(img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0); return c; }

async function loadImage(blob, s) {
  if (state.busy) return; state.busy = true;
  show('vBusy'); $('busyText').textContent = 'Reading colours…'; resetProgress();
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    setProgress(0.08);
    const w = await getWorker();
    setProgress(0.15);
    const res = await P.readChart(img, w, (pre) => toCanvas(pre), (p) => {
      if (p > 0.45) $('busyText').textContent = 'Checking names and codes…';
      setProgress(0.15 + p * 0.85);
    });
    await finishProgress();
    if (!res.colors.length) { show('vEmpty'); banner('Couldn\'t find colours in that image. Try a tighter crop of the colour table.'); return; }
    setIncoming({ source: 'image', label: 'from image', modes: res.modes, colors: res.colors }, s);
  } catch (e) {
    show('vEmpty'); banner('Couldn\'t read that image: ' + (e.message || e));
  } finally { state.busy = false; }
}

// ---------- review ----------
function setIncoming(inc, s) {
  state.animateIn = true;
  // Format everything: no ALL-CAPS labels.
  const ren = {}; inc.modes = inc.modes.map((m) => (ren[m] = niceCase(m)));
  inc.colors.forEach((c) => {
    c.name = niceCase(c.name);
    c.group = String(c.group || '').split('/').map(niceCase).join('/');
    const v = {}; for (const [k, val] of Object.entries(c.values || {})) v[ren[k] || niceCase(k)] = val; c.values = v;
  });
  // Only offer modes that at least one colour has a value for.
  const used = inc.modes.filter((m) => inc.colors.some((c) => c.values && c.values[m]));
  inc.modes = used.length ? used : inc.modes.slice(0, 1);
  // Stable source keys so a later import can tell what's new, changed or unchanged.
  inc.scope = inc.source === 'figma' ? `figma:${inc.fileKey || inc.label}:` : 'image:';
  inc.colors.forEach((c) => { c.key = inc.scope + (c.id || `${c.group || ''}/${c.name}`.toLowerCase()); });
  state.incoming = inc; state.pendingSig = s;
  suggestModes(); renderReview();
}
// A mode whose colours are identical to the first mode adds nothing — don't import it by default.
function sameAsFirst(m) {
  const inc = state.incoming, f = inc.modes[0];
  return inc.colors.every((c) => !c.values[m] || (c.values[f] && c.values[m].hex === c.values[f].hex && c.values[m].a === c.values[f].a));
}
function suggestModes() {
  const inc = state.incoming; if (!inc) return;
  state.modeMap = state.kirki ? M.suggestModeMap(state.kirki, inc.modes) : Object.fromEntries(inc.modes.map((m, i) => [m, i ? { create: m } : 'default']));
  inc.modes.slice(1).forEach((m) => { if (sameAsFirst(m) && typeof state.modeMap[m] === 'object') state.modeMap[m] = null; });
}
function kirkiModes() { const c = state.kirki && M.colorCollection(state.kirki.variableData); return (c && c.modes) || [{ title: 'Default', key: 'default' }]; }
function swatch(v) {
  const s = el('div', 'sw'); const i = el('i');
  i.style.background = v ? `rgba(${parseInt(v.hex.slice(0, 2), 16)},${parseInt(v.hex.slice(2, 4), 16)},${parseInt(v.hex.slice(4, 6), 16)},${v.a})` : 'transparent';
  s.append(i); return s;
}

async function loadLinks() { const k = 'links:' + state.host; state.links = (await chrome.storage.local.get(k))[k] || {}; return state.links; }
async function saveLinks(list) {
  const k = 'links:' + state.host; const links = { ...(await loadLinks()) };
  list.forEach((a) => { if (a.key) links[a.key] = a.id; });
  await chrome.storage.local.set({ [k]: links }); state.links = links;
}
// Work out new / changed / unchanged and set sensible defaults once per colour.
function classifyIncoming() {
  const inc = state.incoming; if (!inc || !state.kirki) { state.sync = null; return; }
  const memo = [inc, state.kirki, state.links, JSON.stringify(state.modeMap)];
  if (state._clsMemo && memo.every((x, i) => x === state._clsMemo[i])) return;   // nothing changed since last time
  state._clsMemo = memo;
  state.sync = M.classify(state.kirki, inc, state.links || {}, state.modeMap);
  inc.colors.forEach((c, i) => {
    const r = state.sync.rows[i]; c.status = r.status; c.diffs = r.diffs || []; c.updateId = r.status === 'changed' ? r.id : null;
    if (r.status === 'same') c.selected = false;
    else if (!c._defaulted) c.selected = r.status === 'new';   // updates are opt-in: existing variables never change unless you tick them
    c._defaulted = true;
  });
}

function renderReview() {
  const inc = state.incoming; if (!inc) return;
  classifyIncoming();
  show('vReview');
  const animate = state.animateIn; state.animateIn = false;
  $('vReview').classList.toggle('enter', !!animate);
  if (animate) { $('foot').classList.remove('rise'); void $('foot').offsetWidth; $('foot').classList.add('rise'); }
  $('headSum').hidden = $('clearBtn').hidden = false;
  const sel = inc.colors.filter((c) => c.selected !== false && c.status !== 'same');
  const nAdd = sel.filter((c) => c.status !== 'changed').length, nUpd = sel.filter((c) => c.status === 'changed').length;
  const cnt = (st) => inc.colors.filter((c) => c.status === st).length;
  $('sumCount').textContent = `${inc.colors.length} color${inc.colors.length === 1 ? '' : 's'}`;
  $('sumSrc').textContent = inc.label || '';
  const parts = [];
  if (nAdd) parts.push(`Add ${nAdd}`); if (nUpd) parts.push(`Update ${nUpd}`);
  $('importBtn').textContent = !parts.length ? 'Nothing selected' : nUpd ? parts.join(' · ') : `Add ${nAdd} variable${nAdd === 1 ? '' : 's'}`;
  $('importBtn').disabled = !parts.length;
  const syncBar = $('syncBar');
  if (state.sync && (cnt('changed') || cnt('same'))) {
    syncBar.hidden = false; syncBar.innerHTML = '';
    [['new', 'new'], ['changed', 'changed'], ['same', 'up to date']].forEach(([st, label]) => { const n = cnt(st); if (n) { const b = el('span', 'pill ' + st); b.append(el('b', null, String(n)), document.createTextNode(' ' + label)); syncBar.append(b); } });
  } else syncBar.hidden = true;

  // modes
  const modes = $('modes'); modes.innerHTML = '';
  const km = kirkiModes();
  const showModes = inc.modes.length > 1 || km.length > 1;
  modes.hidden = !showModes;
  if (showModes) {
    modes.append(el('div', 'modes-title', 'Modes'));
    inc.modes.forEach((m) => {
      const row = el('div', 'mode-row');
      row.append(el('span', 'from', m), el('span', 'arrow', '→'));
      const s = el('select');
      km.forEach((k) => { const o = el('option', null, k.title); o.value = k.key; s.append(o); });
      const oNew = el('option', null, `New mode “${m}”`); oNew.value = '__new'; s.append(oNew);
      const oSkip = el('option', null, 'Don\'t import'); oSkip.value = '__skip'; s.append(oSkip);
      const cur = state.modeMap[m];
      s.value = cur && typeof cur === 'object' ? '__new' : cur || '__skip';
      s.onchange = () => { state.modeMap[m] = s.value === '__new' ? { create: m } : s.value === '__skip' ? null : s.value; renderReview(); };
      row.append(s); modes.append(row);
      if (m !== inc.modes[0] && sameAsFirst(m)) row.append(el('div', 'mode-note', `Same colours as ${inc.modes[0]}`));
    });
  }

  // groups
  const titles = M.buildTitles(inc.colors, state.settings.naming);
  const existing = state.kirki ? M.existingTitles(state.kirki) : new Set();
  const groups = $('groups'); groups.innerHTML = '';
  const byGroup = new Map();
  inc.colors.forEach((c, i) => { if (c.status === 'same') return; const g = c.group || ''; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(i); });
  const first = inc.modes[0];
  for (const [g, idx] of byGroup) {
    const box = el('div', 'group'); const head = el('div', 'group-head');
    const gn = el('div', 'group-name');
    if (g) { const parts = g.split('/'); gn.append(parts.slice(0, -1).map((p) => p + ' / ').join('')); const b = el('b', null, parts.at(-1)); gn.append(b); }
    else gn.append(el('b', null, byGroup.size > 1 ? 'Ungrouped' : 'Colors'));
    const allOn = idx.every((i) => inc.colors[i].selected !== false);
    const tg = el('button', 'group-toggle', allOn ? 'Deselect all' : 'Select all');
    tg.onclick = () => { idx.forEach((i) => { inc.colors[i].selected = !allOn; }); renderReview(); };
    head.append(gn, tg); box.append(head);
    const card = el('div', 'card');
    idx.forEach((i) => {
      const c = inc.colors[i]; const on = c.selected !== false;
      const row = el('div', 'row' + (on ? '' : ' off'));
      const ck = el('button', 'check' + (on ? ' on' : '')); ck.setAttribute('aria-label', on ? 'Deselect' : 'Select');
      ck.onclick = () => { c.selected = !on; renderReview(); };
      const v = c.values[first] || Object.values(c.values)[0];
      const nm = el('div', 'name'); const inp = el('input'); inp.value = c.title || titles[i]; inp.spellcheck = false;
      inp.onchange = () => { c.title = inp.value.trim() || titles[i]; renderReview(); };
      nm.append(inp);
      const title = (c.title || titles[i]).toLowerCase();
      if (c.flags && c.flags.includes('estimated')) nm.append(el('div', 'note warn', 'Code not readable — estimated from the swatch'));
      else if (c.status !== 'changed' && existing.has(title)) nm.append(el('div', 'note', 'Also in Kirki · both kept'));
      const val = el('div', 'val');
      if (v) {
        const hx = el('input', 'hex'); hx.value = v.hex; hx.maxLength = 7; hx.spellcheck = false;
        hx.onchange = () => { const h = hx.value.replace('#', '').toUpperCase(); if (/^[0-9A-F]{6}$/.test(h)) { v.hex = h; c.flags = (c.flags || []).filter((f) => f !== 'estimated'); } renderReview(); };
        const al = el('input', 'alpha'); al.value = Math.round(v.a * 100); al.inputMode = 'numeric';
        al.onchange = () => { const n = Math.max(0, Math.min(100, parseInt(al.value, 10))); if (!isNaN(n)) v.a = n / 100; renderReview(); };
        val.append(hx, al, el('span', 'pct', '%'));
      }
      row.append(ck, swatch(v), nm, val);
      // Second line (full width, wraps): what changed + other modes' values when they differ.
      const chip = (label, x) => { const ch = el('span', 'mchip'); const i = el('i'); if (x) { i.style.background = '#' + x.hex; i.style.opacity = x.a; } ch.append(document.createTextNode(label), i, document.createTextNode(x ? x.hex + (x.a < 1 ? ' ' + Math.round(x.a * 100) + '%' : '') : '—')); return ch; };
      const info = el('div', 'row-info');
      if (c.status === 'changed') { info.append(el('span', 'badge', 'Changed')); info.append(chip('was ', c.diffs[0].from)); }
      inc.modes.slice(1).filter((m) => c.values[m] && state.modeMap[m] && v && (c.values[m].hex !== v.hex || c.values[m].a !== v.a)).forEach((m) => info.append(chip(m + ' ', c.values[m])));
      if (info.childNodes.length) row.append(info);
      card.append(row);
    });
    box.append(card); groups.append(box);
  }
  const same = inc.colors.filter((c) => c.status === 'same');
  if (same.length) {
    const det = el('details', 'same-box'); const sm = el('summary', null, `${same.length} already up to date`);
    det.append(sm); const card = el('div', 'card');
    same.forEach((c) => { const row = el('div', 'row mini'); const v = c.values[inc.modes[0]] || Object.values(c.values)[0]; row.append(el('span'), swatch(v), el('div', 'name', c.title || c.name), el('div', 'val', v ? v.hex : '')); card.append(row); });
    det.append(card); groups.append(det);
  }
  if (state.sync && state.sync.removed.length) {
    const box = el('div', 'removed'); box.append(el('b', null, 'No longer in the source'), el('div', null, state.sync.removed.join(', ')), el('div', 'note', 'Kept in Kirki — remove them there if you don\'t need them.'));
    groups.append(box);
  }
  if (animate) {
    let i = 0;
    $('vReview').querySelectorAll('.modes, .group-head, .row').forEach((n) => { n.style.animationDelay = Math.min(i++ * 22, 520) + 'ms'; });
    setTimeout(() => $('vReview').classList.remove('enter'), 1200);
  }
}
$('clearBtn').onclick = () => { if (state.pendingSig) remember(state.pendingSig); state.incoming = null; show('vEmpty'); };
function remember(s) { state.lastSig = s; chrome.storage.local.set({ lastSig: s }); }

// ---------- import ----------
async function backups() { const k = 'backups:' + state.host; return (await chrome.storage.local.get(k))[k] || []; }
async function saveBackup(data) {
  const k = 'backups:' + state.host; const list = await backups();
  list.unshift({ time: Date.now(), data }); await chrome.storage.local.set({ [k]: list.slice(0, 5) });
}
$('importBtn').onclick = async () => {
  const inc = state.incoming; if (!inc) return;
  const btn = $('importBtn'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Adding…';
  try {
    const fresh = (await pageOp('get')).data;       // always merge into the latest data
    await saveBackup(fresh);
    // Prefer the editor's in-memory variables (they include edits Kirki hasn't finished saving).
    let base = fresh;
    try { const ls = await pageOp('liveState'); if (ls.ok && ls.variableData) base = { ...fresh, variableData: ls.variableData }; } catch {}
    const r = M.merge(base, inc, state.modeMap, { naming: state.settings.naming });
    if (!r.added.length && !r.updated.length) throw new Error('Nothing to add');
    const how = await writeToKirki(r.data);
    await saveLinks([...r.added, ...r.updated]);
    if (state.pendingSig) remember(state.pendingSig);
    state.incoming = null; state.kirki = r.data; show('vEmpty');
    const extra = r.newModes.length ? ` · ${r.newModes.length} new mode${r.newModes.length > 1 ? 's' : ''}` : '';
    const pl = (n) => n + (n === 1 ? ' variable' : ' variables');
    const msg = [r.added.length && `Added ${pl(r.added.length)}`, r.updated.length && `updated ${pl(r.updated.length)}`].filter(Boolean).join(' · ');
    toast(`${msg[0].toUpperCase() + msg.slice(1)}${extra}${how === 'reload' ? '. Reloading Kirki…' : ''}`, 'Undo', () => restore(fresh));
  } catch (e) {
    banner('Import failed: ' + (e.message || e) + '. A backup was saved — use ⋮ → Restore a backup if anything looks wrong.');
    btn.textContent = label; btn.disabled = false;
  }
};
// Write to Kirki: first update the open editor live (Kirki then saves as if you'd edited it),
// verify it reached the server, and only fall back to save + reload if anything is off.
// Write to Kirki: update the open editor live (Kirki saves it as if you'd edited it; if it doesn't
// within 2.5 s, Palette saves it). Only if the editor can't be updated live: save + reload.
async function writeToKirki(data) {
  try {
    const r = await pageOp('live', { variableData: data.variableData, globalColors: data.globalColors, shadows: data.shadows });
    if (r.ok) return 'live';
  } catch { /* fall through */ }
  await pageOp('put', data);
  await pageOp('reload');
  return 'reload';
}
async function restore(data) {
  try { const how = await writeToKirki(data); toast(how === 'live' ? 'Restored.' : 'Restored. Reloading Kirki…'); }
  catch (e) { banner('Restore failed: ' + (e.message || e)); }
}
$('restoreBtn').onclick = async () => {
  closeMenu();
  if (!state.editor) return banner('Open a Kirki editor first.');
  const list = await backups();
  if (!list.length) return toast('No backups yet — one is made before every import.');
  const body = el('div'); body.append(el('p', null, 'Kirki\'s variables will go back to how they were at that moment.'));
  list.forEach((b, i) => {
    const row = el('label', 'backup'); const r = el('input'); r.type = 'radio'; r.name = 'bk'; r.value = i; if (!i) r.checked = true;
    const cnt = (M.colorCollection(b.data.variableData) || { variables: [] }).variables.length;
    row.append(r, document.createTextNode(`${new Date(b.time).toLocaleString()} · ${cnt} colours`)); body.append(row);
  });
  if (await sheet('Restore a backup', body, 'Restore')) {
    const i = +body.querySelector('input:checked').value; await restore(list[i].data);
  }
};
$('figmaHelpBtn').onclick = () => {
  closeMenu();
  const b = el('div');
  b.append(el('p', null, 'In the Figma desktop app: Plugins → Development → Import plugin from manifest… and pick figma-plugin/manifest.json from the Palette folder.'),
    el('p', null, 'Then run it any time with ⌘/ → "Palette — Copy colors". It copies every colour variable and closes; open this panel and they appear.'));
  sheet('Figma plugin', b, 'Got it');
};

// ---------- start ----------
(async () => {
  await loadSettings(); await refresh(); tryClipboard();
  // Warm the image reader in the background so the first import starts instantly.
  if (state.editor) setTimeout(() => { if (!worker) getWorker().catch(() => {}); }, 1500);
})();
