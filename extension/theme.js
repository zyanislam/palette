// Applied before the stylesheet paints to avoid a flash of the wrong theme.
try { const t = localStorage.getItem('palette-theme'); if (t && t !== 'system') document.documentElement.setAttribute('data-theme', t); } catch {}
