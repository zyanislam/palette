// Palette — Copy colors. Copies every local colour variable (names, groups, hex, opacity, modes)
// to the clipboard for the Palette Chrome extension, then closes. No UI unless copying fails.
const PREFIX = 'PALETTE1:';
const hex2 = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
const toHex = (c) => (hex2(c.r) + hex2(c.g) + hex2(c.b)).toUpperCase();
const round2 = (n) => Math.round(n * 100) / 100;

async function resolve(value, modeId, collectionOfVar, depth) {
  if (!value || depth > 12) return null;
  if (value.type === 'VARIABLE_ALIAS') {
    const target = await figma.variables.getVariableByIdAsync(value.id);
    if (!target) return null;
    const col = await collectionOfVar(target);
    const mId = col && col.modes.some((m) => m.modeId === modeId) ? modeId : col && col.defaultModeId;
    return resolve(target.valuesByMode[mId] || Object.values(target.valuesByMode)[0], modeId, collectionOfVar, depth + 1);
  }
  if (typeof value.r === 'number') return { hex: toHex(value), a: round2(value.a == null ? 1 : value.a) };
  return null;
}

async function run() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const vars = await figma.variables.getLocalVariablesAsync('COLOR');
  const colCache = new Map(cols.map((c) => [c.id, c]));
  const collectionOfVar = async (v) => {
    if (!colCache.has(v.variableCollectionId)) colCache.set(v.variableCollectionId, await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId));
    return colCache.get(v.variableCollectionId);
  };
  // Mode list: modes of multi-mode collections in order; single-mode collections map to the first mode.
  const modes = [];
  const colorCols = new Set(vars.map((v) => v.variableCollectionId));
  cols.filter((c) => colorCols.has(c.id)).forEach((c) => { if (c.modes.length > 1) c.modes.forEach((m) => { if (!modes.includes(m.name)) modes.push(m.name); }); });
  const firstName = modes[0] || (cols[0] && cols[0].modes[0] && cols[0].modes[0].name) || 'Default';
  if (!modes.length) modes.push(firstName);

  const colors = [];
  for (const v of vars) {
    const col = await collectionOfVar(v); if (!col) continue;
    const parts = v.name.split('/').map((s) => s.trim()).filter(Boolean);
    const name = parts.pop() || v.name;
    const group = parts.join('/');
    const values = {};
    for (const m of col.modes) {
      const r = await resolve(v.valuesByMode[m.modeId], m.modeId, collectionOfVar, 0);
      if (!r) continue;
      values[col.modes.length > 1 ? m.name : firstName] = r;
    }
    if (Object.keys(values).length) colors.push({ id: v.id, name, group, values });
  }
  return { v: 1, source: 'figma', file: figma.root.name, fileKey: figma.fileKey || figma.root.name, modes, colors };
}

run().then((payload) => {
  if (!payload.colors.length) { figma.notify('No colour variables found in this file'); figma.closePlugin(); return; }
  figma.showUI(__html__, { visible: false });
  figma.ui.onmessage = (msg) => {
    if (msg.type === 'copied') {
      figma.notify(`Copied ${payload.colors.length} colors for Palette — open the Palette panel in Kirki`);
      figma.closePlugin();
    } else if (msg.type === 'needs-click') {
      figma.ui.show(); figma.ui.resize(260, 110);
    }
  };
  figma.ui.postMessage({ type: 'copy', text: PREFIX + JSON.stringify(payload), count: payload.colors.length });
}).catch((e) => { figma.notify('Palette: ' + (e && e.message || e), { error: true }); figma.closePlugin(); });
