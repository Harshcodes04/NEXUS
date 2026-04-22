/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS — designer.js  |  Mission Designer Panel
   Walker constellation builder with live ground-track preview + deploy.
   ═══════════════════════════════════════════════════════════════════════════ */

const Designer = (() => {
  'use strict';

  let _open       = false;
  let _previewGrp = null;   // D3 group for preview dots
  let _designs    = [];
  let _debounce   = null;

  // ── Init ────────────────────────────────────────────────────────────────
  function init() {
    _buildPanel();
    _injectStyles();
    _loadDesigns();
  }

  // ── Panel markup ─────────────────────────────────────────────────────────
  function _buildPanel() {
    if (document.getElementById('designer-panel')) return;

    // Topbar button
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) {
      const btn = document.createElement('button');
      btn.id    = 'designer-open-btn';
      btn.title = 'Satellite Mission Designer';
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        DESIGN`;
      btn.addEventListener('click', toggle);
      const cmdBtn = document.getElementById('cmd-open-btn');
      topbarRight.insertBefore(btn, cmdBtn);
    }

    const panel = document.createElement('div');
    panel.id = 'designer-panel';
    panel.innerHTML = `
      <div class="dsp-header">
        <div class="dsp-title">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          MISSION DESIGNER
        </div>
        <button id="designer-close-btn" class="dsp-close">✕</button>
      </div>

      <!-- TABS -->
      <div class="dsp-tabs">
        <button class="dsp-tab active" data-tab="build">BUILD</button>
        <button class="dsp-tab" data-tab="library">LIBRARY</button>
      </div>

      <!-- BUILD TAB -->
      <div id="dsp-tab-build" class="dsp-tab-content">
        <div class="dsp-section">
          <div class="dsp-row">
            <div class="dsp-field">
              <label class="dsp-label">NAME</label>
              <input id="dsp-name" class="dsp-input" type="text" value="Alpha Constellation" maxlength="60">
            </div>
          </div>
          <div class="dsp-row two-col">
            <div class="dsp-field">
              <label class="dsp-label">PATTERN</label>
              <select id="dsp-pattern" class="dsp-select">
                <option value="delta">Walker Delta</option>
                <option value="star">Walker Star</option>
              </select>
            </div>
            <div class="dsp-field">
              <label class="dsp-label">TOTAL SATS</label>
              <input id="dsp-total" class="dsp-input" type="number" min="1" max="200" value="12">
            </div>
          </div>
          <div class="dsp-row two-col">
            <div class="dsp-field">
              <label class="dsp-label">PLANES</label>
              <input id="dsp-planes" class="dsp-input" type="number" min="1" max="50" value="3">
            </div>
            <div class="dsp-field">
              <label class="dsp-label">PHASING (F)</label>
              <input id="dsp-phasing" class="dsp-input" type="number" min="0" max="49" value="1">
            </div>
          </div>
        </div>

        <div class="dsp-section">
          <div class="dsp-field">
            <label class="dsp-label">ALTITUDE — <span id="dsp-alt-val">550</span> km</label>
            <input id="dsp-alt" class="dsp-slider" type="range" min="200" max="2000" value="550" step="10">
          </div>
          <div class="dsp-field">
            <label class="dsp-label">INCLINATION — <span id="dsp-inc-val">53.0</span>°</label>
            <input id="dsp-inc" class="dsp-slider" type="range" min="0" max="180" value="53" step="0.5">
          </div>
          <div class="dsp-field">
            <label class="dsp-label">MIN ELEVATION — <span id="dsp-el-val">5</span>°</label>
            <input id="dsp-el" class="dsp-slider" type="range" min="0" max="45" value="5" step="1">
          </div>
        </div>

        <!-- Metrics strip -->
        <div id="dsp-metrics" class="dsp-metrics">
          <div class="dsp-metric"><div class="dsp-metric-val" id="dsp-m-period">—</div><div class="dsp-metric-lbl">PERIOD min</div></div>
          <div class="dsp-metric"><div class="dsp-metric-val" id="dsp-m-footprint">—</div><div class="dsp-metric-lbl">FOOTPRINT °</div></div>
          <div class="dsp-metric"><div class="dsp-metric-val" id="dsp-m-revisit">—</div><div class="dsp-metric-lbl">REVISIT min</div></div>
          <div class="dsp-metric"><div class="dsp-metric-val" id="dsp-m-sats">—</div><div class="dsp-metric-lbl">SATS</div></div>
        </div>

        <div class="dsp-actions">
          <button id="dsp-preview-btn" class="dsp-btn-secondary">PREVIEW</button>
          <button id="dsp-save-btn" class="dsp-btn-primary">SAVE DESIGN</button>
        </div>
        <div id="dsp-status" class="dsp-status"></div>
      </div>

      <!-- LIBRARY TAB -->
      <div id="dsp-tab-library" class="dsp-tab-content" style="display:none;">
        <div id="dsp-library-list" class="dsp-library-list">
          <div class="dsp-empty">No designs saved yet.</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Tab switching
    panel.querySelectorAll('.dsp-tab').forEach(t => {
      t.addEventListener('click', () => {
        panel.querySelectorAll('.dsp-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const tab = t.dataset.tab;
        document.getElementById('dsp-tab-build').style.display   = tab === 'build'   ? 'flex' : 'none';
        document.getElementById('dsp-tab-library').style.display = tab === 'library' ? 'flex' : 'none';
        if (tab === 'library') _renderLibrary();
      });
    });

    document.getElementById('designer-close-btn')?.addEventListener('click', close);
    document.getElementById('dsp-preview-btn')?.addEventListener('click', _preview);
    document.getElementById('dsp-save-btn')?.addEventListener('click', _save);

    // Live sliders
    ['dsp-alt', 'dsp-inc', 'dsp-el'].forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener('input', () => {
        document.getElementById(`${id}-val`).textContent = el.value;
        _scheduleDebouncedPreview();
      });
    });

    ['dsp-total', 'dsp-planes', 'dsp-phasing', 'dsp-pattern'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', _scheduleDebouncedPreview);
    });
  }

  // ── Params helper ─────────────────────────────────────────────────────────
  function _getParams() {
    return {
      total_sats: parseInt(document.getElementById('dsp-total')?.value || 12),
      planes:     parseInt(document.getElementById('dsp-planes')?.value || 3),
      phasing:    parseInt(document.getElementById('dsp-phasing')?.value || 1),
      alt_km:     parseFloat(document.getElementById('dsp-alt')?.value || 550),
      inc_deg:    parseFloat(document.getElementById('dsp-inc')?.value || 53),
      pattern:    document.getElementById('dsp-pattern')?.value || 'delta',
      min_elevation: parseFloat(document.getElementById('dsp-el')?.value || 5),
    };
  }

  function _scheduleDebouncedPreview() {
    clearTimeout(_debounce);
    _debounce = setTimeout(_preview, 600);
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  async function _preview() {
    const p = _getParams();
    const qs = new URLSearchParams(p).toString();
    try {
      const res  = await fetch(`/api/designer/preview/walker?${qs}`);
      const data = await res.json();
      _updateMetrics(data.metrics);
      _drawPreview(data.positions);
    } catch (e) {
      console.warn('[Designer] Preview failed:', e.message);
    }
  }

  function _updateMetrics(m) {
    document.getElementById('dsp-m-period').textContent    = m.orbital_period_min ?? '—';
    document.getElementById('dsp-m-footprint').textContent = m.footprint_half_angle_deg ?? '—';
    document.getElementById('dsp-m-revisit').textContent   = m.approx_revisit_time_min ?? '—';
    document.getElementById('dsp-m-sats').textContent      = m.total_sats ?? '—';
  }

  function _drawPreview(positions) {
    _clearPreview();
    const svgEl = document.getElementById('groundtrack-svg');
    if (!svgEl || !positions?.length) return;

    const container = document.getElementById('groundtrack-svg-container');
    const rect = container?.getBoundingClientRect() || { width: 800, height: 400 };
    const proj = d3.geoMercator()
      .scale(rect.width / 2 / Math.PI)
      .translate([rect.width / 2, rect.height / 2]);

    const svg = d3.select(svgEl);
    _previewGrp = svg.append('g').attr('id', 'designer-preview-group');

    // Colour planes distinctly
    const planeCount = Math.max(...positions.map(p => p.plane));
    const colour = i => `hsl(${(i / planeCount) * 300}, 80%, 65%)`;

    positions.forEach(pos => {
      const [x, y] = proj([pos.lon, pos.lat]) || [null, null];
      if (!x || isNaN(x)) return;
      const c = colour(pos.plane - 1);

      _previewGrp.append('circle')
        .attr('cx', x).attr('cy', y).attr('r', 5)
        .attr('fill', c).attr('fill-opacity', 0.25)
        .attr('stroke', c).attr('stroke-width', 1.5);

      _previewGrp.append('circle')
        .attr('cx', x).attr('cy', y).attr('r', 2.5)
        .attr('fill', c);
    });

    // Legend
    _previewGrp.append('text')
      .attr('x', 8).attr('y', 34)
      .attr('fill', '#e6edf3').attr('font-size', '9px')
      .attr('font-family', 'JetBrains Mono, monospace').attr('letter-spacing', '1px')
      .text(`◆ DESIGN PREVIEW (${positions.length} sats)`);
  }

  function _clearPreview() {
    document.getElementById('designer-preview-group')?.remove();
    _previewGrp = null;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function _save() {
    const status = document.getElementById('dsp-status');
    const name   = document.getElementById('dsp-name')?.value?.trim();
    if (!name) { status.innerHTML = '<span class="dsp-err">Name required.</span>'; return; }

    if (status) status.innerHTML = '<span class="dsp-loading">Saving…</span>';
    try {
      const res  = await fetch('/api/designer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: '', params: _getParams() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      status.innerHTML = `<span class="dsp-ok">✓ ${data.message}</span>`;
      await _loadDesigns();
    } catch (e) {
      status.innerHTML = `<span class="dsp-err">✕ ${e.message}</span>`;
    }
  }

  // ── Library ───────────────────────────────────────────────────────────────
  async function _loadDesigns() {
    try {
      const res  = await fetch('/api/designer');
      const data = await res.json();
      _designs = data.designs || [];
      _renderLibrary();
    } catch (_) {}
  }

  function _renderLibrary() {
    const list = document.getElementById('dsp-library-list');
    if (!list) return;
    if (!_designs.length) {
      list.innerHTML = '<div class="dsp-empty">No designs saved yet. Build one!</div>';
      return;
    }
    list.innerHTML = _designs.map(d => `
      <div class="dsp-design-card">
        <div class="dsp-design-name">${d.name}</div>
        <div class="dsp-design-meta">
          ${d.metrics?.total_sats} sats · ${d.metrics?.planes} planes ·
          ${d.metrics?.alt_km} km · ${d.metrics?.inc_deg}° ·
          ${d.metrics?.pattern?.toUpperCase() || 'DELTA'}
        </div>
        <div class="dsp-design-stats">
          Period: ${d.metrics?.orbital_period_min} min ·
          Revisit: ~${d.metrics?.approx_revisit_time_min} min
        </div>
        <div class="dsp-card-actions">
          <button class="dsp-btn-deploy" data-id="${d.id}">▶ DEPLOY</button>
          <button class="dsp-btn-delete" data-id="${d.id}">✕</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.dsp-btn-deploy').forEach(btn => {
      btn.addEventListener('click', () => _deploy(btn.dataset.id));
    });
    list.querySelectorAll('.dsp-btn-delete').forEach(btn => {
      btn.addEventListener('click', () => _delete(btn.dataset.id));
    });
  }

  async function _deploy(id) {
    try {
      const res  = await fetch(`/api/designer/${id}/deploy`, { method: 'POST' });
      const data = await res.json();
      alert(data.message);
    } catch (e) {
      alert('Deploy failed: ' + e.message);
    }
  }

  async function _delete(id) {
    if (!confirm('Delete this design?')) return;
    await fetch(`/api/designer/${id}`, { method: 'DELETE' });
    await _loadDesigns();
  }

  // ── Panel open/close ──────────────────────────────────────────────────────
  function toggle() { _open ? close() : open(); }

  function open() {
    _open = true;
    document.getElementById('designer-panel')?.classList.add('open');
    document.getElementById('designer-open-btn')?.classList.add('active');
    _preview();
  }

  function close() {
    _open = false;
    document.getElementById('designer-panel')?.classList.remove('open');
    document.getElementById('designer-open-btn')?.classList.remove('active');
    _clearPreview();
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('designer-styles')) return;
    const s = document.createElement('style');
    s.id = 'designer-styles';
    s.textContent = `
      #designer-open-btn {
        display:flex;align-items:center;gap:5px;background:transparent;
        border:1px solid #30363d;color:#8b949e;font-size:9px;
        letter-spacing:1.5px;font-family:'JetBrains Mono',monospace;
        padding:5px 10px;cursor:pointer;transition:all .2s;
      }
      #designer-open-btn:hover,#designer-open-btn.active {
        border-color:#d2a8ff;color:#d2a8ff;background:rgba(210,168,255,.08);
      }
      #designer-panel {
        position:fixed;top:84px;right:-340px;width:320px;
        background:#161b22;border:1px solid #30363d;border-right:none;
        z-index:500;display:flex;flex-direction:column;
        max-height:calc(100vh - 100px);overflow:hidden;
        transition:right .3s cubic-bezier(.4,0,.2,1);
      }
      #designer-panel.open { right:0; }
      .dsp-header {
        display:flex;align-items:center;justify-content:space-between;
        padding:8px 12px;border-bottom:1px solid #30363d;background:#21262d;flex-shrink:0;
      }
      .dsp-title {
        display:flex;align-items:center;gap:6px;font-size:9px;
        letter-spacing:2px;color:#d2a8ff;font-family:'JetBrains Mono',monospace;
      }
      .dsp-close {
        background:transparent;border:none;color:#6e7681;cursor:pointer;font-size:11px;padding:2px 4px;
      }
      .dsp-close:hover{color:#e6edf3;}
      .dsp-tabs {
        display:flex;border-bottom:1px solid #30363d;flex-shrink:0;
      }
      .dsp-tab {
        flex:1;padding:7px;background:transparent;border:none;border-bottom:2px solid transparent;
        color:#6e7681;font-size:9px;letter-spacing:1.5px;font-family:'JetBrains Mono',monospace;
        cursor:pointer;transition:all .2s;
      }
      .dsp-tab.active { color:#d2a8ff;border-bottom-color:#d2a8ff; }
      .dsp-tab-content {
        flex:1;overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:0;
      }
      .dsp-section {
        padding:10px 12px 8px;border-bottom:1px solid rgba(48,54,61,.5);
        display:flex;flex-direction:column;gap:8px;flex-shrink:0;
      }
      .dsp-row { display:flex;gap:8px; }
      .dsp-row.two-col > .dsp-field { flex:1; }
      .dsp-field { display:flex;flex-direction:column;gap:3px; }
      .dsp-label {
        font-size:8px;letter-spacing:1.5px;color:#6e7681;
        font-family:'JetBrains Mono',monospace;
      }
      .dsp-input,.dsp-select {
        background:#0d1117;border:1px solid #30363d;color:#e6edf3;
        font-size:10px;font-family:'JetBrains Mono',monospace;
        padding:5px 7px;outline:none;width:100%;transition:border-color .2s;
      }
      .dsp-input:focus,.dsp-select:focus { border-color:#d2a8ff; }
      .dsp-select option { background:#21262d; }
      .dsp-slider {
        width:100%;accent-color:#d2a8ff;height:3px;cursor:pointer;
      }
      .dsp-metrics {
        display:grid;grid-template-columns:repeat(4,1fr);gap:0;
        border-bottom:1px solid rgba(48,54,61,.5);flex-shrink:0;
      }
      .dsp-metric {
        padding:8px 6px;text-align:center;
        border-right:1px solid rgba(48,54,61,.5);
      }
      .dsp-metric:last-child { border-right:none; }
      .dsp-metric-val {
        font-size:13px;font-family:'JetBrains Mono',monospace;
        color:#d2a8ff;font-weight:bold;
      }
      .dsp-metric-lbl {
        font-size:7px;letter-spacing:1px;color:#6e7681;
        font-family:'JetBrains Mono',monospace;margin-top:2px;
      }
      .dsp-actions {
        display:flex;gap:6px;padding:10px 12px;flex-shrink:0;
      }
      .dsp-btn-primary {
        flex:1;padding:8px;background:rgba(210,168,255,.12);
        border:1px solid #d2a8ff;color:#d2a8ff;font-size:9px;
        letter-spacing:1.5px;font-family:'JetBrains Mono',monospace;
        cursor:pointer;transition:all .2s;
      }
      .dsp-btn-primary:hover { background:rgba(210,168,255,.22); }
      .dsp-btn-secondary {
        padding:8px 14px;background:transparent;border:1px solid #30363d;
        color:#8b949e;font-size:9px;letter-spacing:1.5px;
        font-family:'JetBrains Mono',monospace;cursor:pointer;transition:all .2s;
      }
      .dsp-btn-secondary:hover { border-color:#d2a8ff;color:#d2a8ff; }
      .dsp-status {
        padding:4px 12px 8px;font-size:10px;font-family:'JetBrains Mono',monospace;
        min-height:20px;flex-shrink:0;
      }
      .dsp-ok      { color:#3fb950; }
      .dsp-err     { color:#f85149; }
      .dsp-loading { color:#d29922; }
      .dsp-library-list {
        flex:1;overflow-y:auto;min-height:0;padding:8px;
        display:flex;flex-direction:column;gap:8px;
      }
      .dsp-design-card {
        background:#0d1117;border:1px solid #30363d;padding:10px;
        transition:border-color .2s;
      }
      .dsp-design-card:hover { border-color:#d2a8ff; }
      .dsp-design-name {
        font-size:11px;color:#d2a8ff;font-family:'JetBrains Mono',monospace;
        margin-bottom:4px;
      }
      .dsp-design-meta,.dsp-design-stats {
        font-size:9px;color:#6e7681;font-family:'JetBrains Mono',monospace;
        margin-bottom:2px;
      }
      .dsp-card-actions {
        display:flex;gap:6px;margin-top:8px;
      }
      .dsp-btn-deploy {
        flex:1;padding:5px;background:rgba(63,185,80,.1);
        border:1px solid #3fb950;color:#3fb950;font-size:8px;
        letter-spacing:1px;font-family:'JetBrains Mono',monospace;cursor:pointer;
        transition:all .2s;
      }
      .dsp-btn-deploy:hover { background:rgba(63,185,80,.2); }
      .dsp-btn-delete {
        padding:5px 10px;background:transparent;border:1px solid #30363d;
        color:#6e7681;font-size:9px;cursor:pointer;transition:all .2s;
      }
      .dsp-btn-delete:hover { border-color:#f85149;color:#f85149; }
      .dsp-empty {
        padding:20px 12px;font-size:10px;color:#6e7681;
        text-align:center;font-family:'JetBrains Mono',monospace;
      }
    `;
    document.head.appendChild(s);
  }

  return { init, open, close, toggle };
})();
