// Palette — pure merge logic (no DOM). Used by the side panel and by tests.
// Incoming format (see docs/ARCHITECTURE.md §4.1):
//   { modes: ['Light','Dark'], colors: [{ name, group, values: { Light: {hex:'FA580D', a:0.8} }, selected }] }
(function (root) {
  'use strict';

  const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
  function genId(taken) {
    let id;
    do {
      id = 'k-';
      for (let i = 0; i < 8; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    } while (taken.has(id));
    taken.add(id);
    return id;
  }

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '').trim();
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function fmtAlpha(a) {
    if (a == null || isNaN(a)) a = 1;
    a = Math.min(1, Math.max(0, a));
    if (a === 1) return '1.00';
    return String(Math.round(a * 100) / 100);
  }
  function toRgba(v) {
    const [r, g, b] = hexToRgb(v.hex);
    return `rgba(${r}, ${g}, ${b}, ${fmtAlpha(v.a)})`;
  }
  function parseRgba(s) {
    if (typeof s !== 'string') return null;
    let m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/i);
    if (m) return { hex: [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase(), a: m[4] == null ? 1 : +m[4] };
    m = s.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (m) return { hex: m[1].toUpperCase(), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
    return null;
  }

  const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const lastSeg = (g) => norm(String(g || '').split('/').filter((x) => x.trim()).pop() || '');

  // Naming: 'smart' (plain name; add last group segment only when incoming names clash),
  // 'name' (plain name), 'path' (full group path + name).
  function buildTitles(colors, rule = 'smart') {
    const plain = colors.map((c) => norm(c.name));
    if (rule === 'name') return plain;
    if (rule === 'path') return colors.map((c) => {
      const g = String(c.group || '').split('/').map(norm).filter(Boolean).join('/');
      return g ? `${g}/${norm(c.name)}` : norm(c.name);
    });
    const count = {};
    plain.forEach((p) => { const k = p.toLowerCase(); count[k] = (count[k] || 0) + 1; });
    return colors.map((c, i) => {
      const p = plain[i];
      if (count[p.toLowerCase()] < 2) return p;
      const seg = lastSeg(c.group);
      if (!seg || p.toLowerCase().includes(seg.toLowerCase())) return p;
      return `${seg}/${p}`;
    });
  }

  function colorCollection(vd) {
    return (vd && vd.data || []).find((c) => c.key === 'color');
  }

  // Suggest a Kirki mode for every incoming mode. First incoming → 'default'.
  // Others: match by title, else { create: title }.
  function suggestModeMap(kirki, incomingModes) {
    const col = colorCollection(kirki.variableData);
    const modes = (col && col.modes) || [{ title: 'Default', key: 'default' }];
    const used = new Set(['default']);
    const map = {};
    incomingModes.forEach((m, i) => {
      if (i === 0) { map[m] = 'default'; return; }
      const hit = modes.find((k) => !used.has(k.key) && k.title.trim().toLowerCase() === String(m).trim().toLowerCase());
      if (hit) { map[m] = hit.key; used.add(hit.key); } else map[m] = { create: m };
    });
    return map;
  }

  function existingTitles(kirki) {
    const col = colorCollection(kirki.variableData);
    return new Set(((col && col.variables) || []).map((v) => norm(v.title).toLowerCase()));
  }

  // kirki = the `data` object from GET global-ui-saved-data ({globalColors, shadows, variableData}).
  // modeMap: incomingMode → kirkiModeKey | {create: title} | null (skip that mode).
  // Returns { data, added: [{id,title}], newModes: [{title,key}], sameName: n }.
  function merge(kirki, incoming, modeMap, opts = {}) {
    const data = JSON.parse(JSON.stringify(kirki));
    data.globalColors = data.globalColors || [];
    data.shadows = data.shadows || [];
    data.variableData = data.variableData || { data: [] };
    const cols = data.variableData.data;
    let color = cols.find((c) => c.key === 'color');
    if (!color) {
      const modes = (cols[0] && JSON.parse(JSON.stringify(cols[0].modes))) || [{ title: 'Default', key: 'default' }];
      color = { title: 'Colors', key: 'color', modes, variables: [] };
      cols.unshift(color);
    }
    if (!color.modes || !color.modes.length) color.modes = [{ title: 'Default', key: 'default' }];

    const taken = new Set();
    cols.forEach((c) => { (c.modes || []).forEach((m) => taken.add(m.key)); (c.variables || []).forEach((v) => taken.add(v.id)); });

    // Resolve modes; create new ones in EVERY collection (Kirki modes are shared).
    const newModes = [];
    const resolved = {};
    for (const [inc, target] of Object.entries(modeMap || {})) {
      if (target && typeof target === 'object' && target.create) {
        const m = { title: norm(target.create) || 'Mode', key: genId(taken) };
        newModes.push(m);
        resolved[inc] = m.key;
      } else if (target) resolved[inc] = target;
    }
    if (newModes.length) cols.forEach((c) => { c.modes = (c.modes || []).concat(newModes.map((m) => ({ ...m }))); });

    const allModes = color.modes.map((m) => m.key);
    const selected = incoming.colors.filter((c) => c.selected !== false);
    const titles = buildTitles(selected, opts.naming || 'smart');
    const existing = existingTitles(kirki);
    const added = [];
    let sameName = 0;

    const updated = [];
    selected.forEach((c, i) => {
      // Sync: update a variable Palette created earlier (only when the user ticked it).
      if (c.updateId) {
        const v = color.variables.find((x) => x.id === c.updateId);
        if (v) {
          v.value = { ...(v.value || {}) };
          for (const [inc, key] of Object.entries(resolved)) if (c.values && c.values[inc]) v.value[key] = toRgba(c.values[inc]);
          updated.push({ id: v.id, title: v.title, key: c.key });
          return;
        }
      }
      const title = (c.title && norm(c.title)) || titles[i];
      if (existing.has(title.toLowerCase())) sameName++;
      const value = {};
      for (const [inc, key] of Object.entries(resolved)) {
        if (c.values && c.values[inc]) value[key] = toRgba(c.values[inc]);
      }
      const first = value.default || Object.values(value)[0];
      if (!first) return; // nothing to write
      if (!value.default) value.default = first;
      allModes.forEach((k) => { if (!value[k]) value[k] = value.default; });
      const v = { id: genId(taken), title, type: 'color', value };
      color.variables.push(v);
      added.push({ id: v.id, title, key: c.key });
    });

    return { data, added, updated, newModes, sameName };
  }

  // Sync: compare incoming colours with what Palette imported before.
  // links = { sourceKey: kirkiVariableId }. Returns per colour: status 'new' | 'changed' | 'same', plus old values.
  function classify(kirki, incoming, links, modeMap) {
    const col = colorCollection(kirki.variableData);
    const byId = new Map(((col && col.variables) || []).map((v) => [v.id, v]));
    const seen = new Set();
    const rows = incoming.colors.map((c) => {
      const id = c.key && links[c.key];
      const v = id && byId.get(id);
      if (!v) return { status: 'new' };
      seen.add(c.key);
      const diffs = [];
      for (const [inc, key] of Object.entries(modeMap || {})) {
        if (!key || typeof key === 'object' || !c.values[inc]) continue;
        const now = parseRgba(v.value && (v.value[key] || v.value.default));
        const want = c.values[inc];
        if (!now || now.hex !== want.hex.toUpperCase() || Math.abs(now.a - want.a) > 0.005) diffs.push({ mode: inc, from: now, to: want });
      }
      return { status: diffs.length ? 'changed' : 'same', id, diffs, title: v.title };
    });
    const removed = Object.entries(links || {}).filter(([k, id]) => !seen.has(k) && byId.has(id) && incoming.scope && k.startsWith(incoming.scope)).map(([k, id]) => byId.get(id).title);
    return { rows, removed };
  }

  const api = { merge, classify, buildTitles, suggestModeMap, existingTitles, toRgba, parseRgba, genId, colorCollection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaletteMerge = api;
})(typeof self !== 'undefined' ? self : this);
