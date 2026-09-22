// Palette — Kirki recon #3. Paste into the Console on a Kirki editor page. READ-ONLY.
// Finds the exact variableData object the canvas uses, then searches EVERY React component
// (main editor + canvas iframes) for the state that holds that same object.
(() => {
  const out = { vdFound: false, holders: [], propsChain: [], roots: 0, fibers: 0, calls: [] };
  const fk = (el) => Object.keys(el).find((x) => x.startsWith('__reactFiber$') || x.startsWith('__reactContainer$'));
  const docs = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
  // 1) grab the live variableData object from a canvas component's props
  let vd = null;
  for (const d of docs) { for (const el of d.querySelectorAll('[id]')) { const k = fk(el); if (!k) continue; let f = el[k]; for (let i = 0; f && i < 30; i++, f = f.return) { const p = f.memoizedProps; if (p && p.variableData && Array.isArray(p.variableData.data)) { vd = p.variableData; break; } } if (vd) break; } if (vd) break; }
  out.vdFound = !!vd; if (!vd) { window.__palRecon3 = out; return console.log('variableData not found', out); }
  const find = (o, depth, seen) => {                       // identity search → path or null
    if (o === vd) return '';
    if (!o || typeof o !== 'object' || depth > 7 || seen.has(o) || o instanceof Node) return null; seen.add(o);
    try { for (const k of Object.keys(o).slice(0, 120)) { if (k.startsWith('_owner') || k === 'return' || k === 'child' || k === 'sibling' || k === 'stateNode' || k === 'alternate') continue; const r = find(o[k], depth + 1, seen); if (r !== null) return k + (r ? '.' + r : ''); } } catch {}
    return null;
  };
  const name = (f) => (f.type && (f.type.displayName || f.type.name)) || (typeof f.type === 'string' ? f.type : f.type && f.type._context ? 'Context.Provider' : '?');
  // 2) collect all React roots
  const roots = new Set();
  for (const d of docs) for (const el of d.querySelectorAll('*')) { const k = Object.keys(el).find((x) => x.startsWith('__reactContainer$')); if (k) roots.add(el[k]); const k2 = el._reactRootContainer; if (k2 && k2._internalRoot) roots.add(k2._internalRoot.current); }
  if (!roots.size) for (const d of docs) { const el = d.querySelector('[id]'); const k = el && fk(el); if (k) { let f = el[k]; while (f.return) f = f.return; roots.add(f); } }
  out.roots = roots.size;
  // 3) walk every fiber
  const stack = [...roots];
  while (stack.length && out.fibers < 200000) {
    const f = stack.pop(); out.fibers++;
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
    if (typeof f.type === 'function' || (f.type && typeof f.type === 'object')) {
      let h = f.memoizedState, i = 0;
      while (h && typeof h === 'object' && 'memoizedState' in h && i < 100) {
        const p = find(h.memoizedState, 0, new WeakSet());
        if (p !== null) {
          const q = h.queue, tag = name(f) + '#' + i;
          out.holders.push({ component: tag, path: p, dispatch: !!(q && q.dispatch), reducer: q && q.lastRenderedReducer && (q.lastRenderedReducer.name || 'anon') });
          if (q && q.dispatch && !q.dispatch.__pal) { const o = q.dispatch; q.dispatch = function (a) { try { out.calls.push({ hook: tag, arg: typeof a === 'function' ? 'fn:' + String(a).slice(0, 500) : JSON.stringify(a).slice(0, 800) }); } catch {} return o.apply(this, arguments); }; q.dispatch.__pal = true; }
        }
        h = h.next; i++;
      }
      if (f.type && f.type._context && f.memoizedProps) { const p = find(f.memoizedProps.value, 0, new WeakSet()); if (p !== null) out.holders.push({ component: 'Context:' + (f.type._context.displayName || '?'), path: 'value.' + p }); }
      if (f.memoizedProps && f.memoizedProps.variableData === vd && out.propsChain.length < 12) out.propsChain.push(name(f));
    }
  }
  // 4) also look for plain-JS stores reachable from window (identity)
  for (const k of Object.keys(window)) { try { const p = find(window[k], 0, new WeakSet()); if (p !== null) out.holders.push({ global: k, path: p }); } catch {} }
  window.__palRecon3 = out;
  console.log('%cPalette recon 3 ready', 'color:#5741f3;font-weight:600', out);
  console.log('Now change ONE colour variable in Kirki, then run:  copy(JSON.stringify(__palRecon3))');
})();
