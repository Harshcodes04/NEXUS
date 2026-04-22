/* ═══════════════════════════════════════════════════════════════════════════
   ACM — tle_import.js
   Live TLE Import Panel — fetches real-world satellite positions from
   CelesTrak and overlays them on the ground-track map.
   ═══════════════════════════════════════════════════════════════════════════ */

const TLEImport = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _panelOpen    = false;
  let _tleSatellites = [];       // currently imported TLE sats
  let _groups        = [];
  let _selectedGroup = 'stations';
  let _overlayOn     = false;
  let _svgGroup      = null;     // D3 group for TLE markers
  let _projection    = null;     // D3 mercator projection (re-built each render)

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _buildPanel();
    _injectStyles();
    _loadGroups();
  }

  // ── Panel HTML ────────────────────────────────────────────────────────────
  function _buildPanel() {
    if (document.getElementById('tle-panel')) return;

    // Topbar button
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) {
      const btn = document.createElement('button');
      btn.id    = 'tle-open-btn';
      btn.title = 'Live TLE Import — real-world satellite positions';
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
        TLE`;
      btn.addEventListener('click', togglePanel);
      // Insert before COMMAND button
      const cmdBtn = document.getElementById('cmd-open-btn');
      topbarRight.insertBefore(btn, cmdBtn);
    }

    // Slide-in panel
    const panel = document.createElement('div');
    panel.id = 'tle-panel';
    panel.innerHTML = `
      <div class="tle-panel-header">
        <div class="tle-panel-title">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
          LIVE TLE IMPORT
        </div>
        <button id="tle-panel-close" class="tle-close-btn">✕</button>
      </div>

      <div class="tle-section">
        <div class="tle-field-label">DATA SOURCE</div>
        <select id="tle-group-select" class="tle-select">
          <option value="stations">Loading…</option>
        </select>
      </div>

      <div class="tle-section">
        <div class="tle-field-label">LIMIT</div>
        <input id="tle-limit" type="number" min="5" max="200" value="30" class="tle-input">
      </div>

      <div class="tle-section tle-actions">
        <button id="tle-import-btn" class="tle-import-btn">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
          </svg>
          IMPORT FROM CELESTRAK
        </button>
        <button id="tle-overlay-btn" class="tle-overlay-btn" style="display:none;">
          OVERLAY: OFF
        </button>
      </div>

      <div id="tle-status" class="tle-status"></div>

      <div id="tle-list-container" class="tle-list-container" style="display:none;">
        <div class="tle-field-label" style="padding: 4px 12px 4px;">IMPORTED SATELLITES</div>
        <div id="tle-sat-list" class="tle-sat-list"></div>
      </div>

      <div class="tle-footer">
        <span class="tle-footer-label">Source: celestrak.org</span>
        <span id="tle-propagator-badge" class="tle-propagator-badge">SGP4</span>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('tle-panel-close')?.addEventListener('click', closePanel);
    document.getElementById('tle-import-btn')?.addEventListener('click', _doImport);
    document.getElementById('tle-overlay-btn')?.addEventListener('click', _toggleOverlay);
  }

  // ── Groups ────────────────────────────────────────────────────────────────
  async function _loadGroups() {
    try {
      const res = await fetch('/api/tle/groups');
      const data = await res.json();
      _groups = data.groups || [];

      // Update propagator badge
      const badge = document.getElementById('tle-propagator-badge');
      if (badge) badge.textContent = data.sgp4_available ? 'SGP4' : 'KEPLER';

      const sel = document.getElementById('tle-group-select');
      if (sel) {
        sel.innerHTML = _groups.map(g =>
          `<option value="${g.id}" ${g.id === _selectedGroup ? 'selected' : ''}>${g.label}</option>`
        ).join('');
        sel.addEventListener('change', e => { _selectedGroup = e.target.value; });
      }
    } catch (e) {
      console.warn('[TLE] Failed to load groups:', e.message);
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────
  async function _doImport() {
    const btn   = document.getElementById('tle-import-btn');
    const status= document.getElementById('tle-status');
    const limit = parseInt(document.getElementById('tle-limit')?.value || '30', 10);

    btn?.classList.add('loading');
    if (status) status.innerHTML = `<span class="tle-status-loading">Fetching from CelesTrak…</span>`;

    try {
      const res  = await fetch(`/api/tle/import?group=${_selectedGroup}&limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      _tleSatellites = data.satellites || [];

      if (status) status.innerHTML = `
        <span class="tle-status-ok">
          ✓ ${_tleSatellites.length} satellites imported · ${data.propagator.toUpperCase()}
        </span>`;

      _renderList();

      // Auto-enable overlay
      if (!_overlayOn) _toggleOverlay();

      const listCont = document.getElementById('tle-list-container');
      if (listCont) listCont.style.display = 'block';

      const overlayBtn = document.getElementById('tle-overlay-btn');
      if (overlayBtn) overlayBtn.style.display = 'block';

    } catch (e) {
      if (status) status.innerHTML = `<span class="tle-status-err">✕ ${e.message}</span>`;
    } finally {
      btn?.classList.remove('loading');
    }
  }

  // ── Overlay on ground track ────────────────────────────────────────────────
  function _toggleOverlay() {
    _overlayOn = !_overlayOn;
    const btn = document.getElementById('tle-overlay-btn');
    if (btn) btn.textContent = `OVERLAY: ${_overlayOn ? 'ON' : 'OFF'}`;
    if (btn) btn.classList.toggle('active', _overlayOn);

    if (_overlayOn) {
      _drawOverlay();
    } else {
      _clearOverlay();
    }
  }

  function _getProjection() {
    const container = document.getElementById('groundtrack-svg-container');
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const w = Math.max(rect.width, 200);
    const h = Math.max(rect.height, 100);
    return d3.geoMercator()
      .scale(w / 2 / Math.PI)
      .translate([w / 2, h / 2])
      .clipExtent([[0, 0], [w, h]]);
  }

  function _drawOverlay() {
    _clearOverlay();
    if (!_tleSatellites.length) return;

    const svgEl = document.getElementById('groundtrack-svg');
    if (!svgEl) return;
    const svg  = d3.select(svgEl);
    _projection = _getProjection();
    if (!_projection) return;

    _svgGroup = svg.append('g').attr('id', 'tle-overlay-group');

    _tleSatellites.forEach(sat => {
      const [x, y] = _projection([sat.lon, sat.lat]) || [null, null];
      if (x === null || isNaN(x) || isNaN(y)) return;

      // Diamond shape for TLE sats (distinct from sim sats which are circles)
      const size = 4;
      const pts  = `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`;

      _svgGroup.append('polygon')
        .attr('points', pts)
        .attr('fill', '#bc8cff')
        .attr('stroke', '#0d1117')
        .attr('stroke-width', 0.8)
        .attr('opacity', 0.85)
        .style('cursor', 'pointer')
        .append('title')
        .text(`${sat.name}\nNORAD: ${sat.norad}\nAlt: ${sat.alt_km} km\nLat: ${sat.lat}° Lon: ${sat.lon}°`);
    });

    // Legend marker
    _svgGroup.append('text')
      .attr('x', 8).attr('y', 18)
      .attr('fill', '#bc8cff')
      .attr('font-size', '9px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('letter-spacing', '1px')
      .text(`◆ LIVE TLE (${_tleSatellites.length})`);
  }

  function _clearOverlay() {
    const existing = document.getElementById('tle-overlay-group');
    if (existing) existing.remove();
    _svgGroup = null;
  }

  // ── Satellite list ────────────────────────────────────────────────────────
  function _renderList() {
    const list = document.getElementById('tle-sat-list');
    if (!list) return;

    if (!_tleSatellites.length) {
      list.innerHTML = '<div class="tle-empty">No satellites imported</div>';
      return;
    }

    list.innerHTML = _tleSatellites.map(sat => `
      <div class="tle-sat-row" data-norad="${sat.norad}">
        <div class="tle-sat-name">${sat.name}</div>
        <div class="tle-sat-meta">
          <span class="tle-sat-norad">${sat.norad}</span>
          <span class="tle-sat-pos">${sat.lat.toFixed(1)}° ${sat.lon.toFixed(1)}° · ${sat.alt_km} km</span>
        </div>
      </div>
    `).join('');
  }

  // ── Panel show/hide ───────────────────────────────────────────────────────
  function togglePanel() {
    _panelOpen ? closePanel() : openPanel();
  }

  function openPanel() {
    _panelOpen = true;
    const panel = document.getElementById('tle-panel');
    if (panel) panel.classList.add('open');
    document.getElementById('tle-open-btn')?.classList.add('active');
  }

  function closePanel() {
    _panelOpen = false;
    const panel = document.getElementById('tle-panel');
    if (panel) panel.classList.remove('open');
    document.getElementById('tle-open-btn')?.classList.remove('active');
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('tle-styles')) return;
    const s = document.createElement('style');
    s.id = 'tle-styles';
    s.textContent = `
      /* Topbar TLE button */
      #tle-open-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        background: transparent;
        border: 1px solid #30363d;
        color: #8b949e;
        font-size: 9px;
        letter-spacing: 1.5px;
        font-family: 'JetBrains Mono', monospace;
        padding: 5px 10px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      #tle-open-btn:hover, #tle-open-btn.active {
        border-color: #bc8cff;
        color: #bc8cff;
        background: rgba(188,140,255,0.08);
      }

      /* Slide-in Panel */
      #tle-panel {
        position: fixed;
        top: 84px;
        right: -320px;
        width: 300px;
        background: #161b22;
        border: 1px solid #30363d;
        border-right: none;
        z-index: 500;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        max-height: calc(100vh - 100px);
      }
      #tle-panel.open {
        right: 0;
      }

      .tle-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid #30363d;
        background: #21262d;
        flex-shrink: 0;
      }

      .tle-panel-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 9px;
        letter-spacing: 2px;
        color: #bc8cff;
        font-family: 'JetBrains Mono', monospace;
      }

      .tle-close-btn {
        background: transparent;
        border: none;
        color: #6e7681;
        cursor: pointer;
        font-size: 11px;
        padding: 2px 4px;
      }
      .tle-close-btn:hover { color: #e6edf3; }

      .tle-section {
        padding: 10px 12px 8px;
        border-bottom: 1px solid rgba(48,54,61,0.5);
        flex-shrink: 0;
      }

      .tle-field-label {
        font-size: 8px;
        letter-spacing: 1.5px;
        color: #6e7681;
        font-family: 'JetBrains Mono', monospace;
        margin-bottom: 5px;
      }

      .tle-select, .tle-input {
        width: 100%;
        background: #0d1117;
        border: 1px solid #30363d;
        color: #e6edf3;
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        padding: 5px 8px;
        outline: none;
        transition: border-color 0.2s;
      }
      .tle-select:focus, .tle-input:focus { border-color: #bc8cff; }
      .tle-select option { background: #21262d; }

      .tle-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .tle-import-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        width: 100%;
        padding: 8px;
        background: rgba(188,140,255,0.1);
        border: 1px solid #bc8cff;
        color: #bc8cff;
        font-size: 9px;
        letter-spacing: 1.5px;
        font-family: 'JetBrains Mono', monospace;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .tle-import-btn:hover { background: rgba(188,140,255,0.2); }
      .tle-import-btn.loading { opacity: 0.6; pointer-events: none; }

      .tle-overlay-btn {
        width: 100%;
        padding: 6px;
        background: transparent;
        border: 1px solid #30363d;
        color: #6e7681;
        font-size: 9px;
        letter-spacing: 1.5px;
        font-family: 'JetBrains Mono', monospace;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .tle-overlay-btn:hover { border-color: #bc8cff; color: #bc8cff; }
      .tle-overlay-btn.active {
        border-color: #bc8cff;
        color: #bc8cff;
        background: rgba(188,140,255,0.1);
      }

      .tle-status {
        padding: 6px 12px;
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        min-height: 24px;
        flex-shrink: 0;
      }
      .tle-status-ok      { color: #3fb950; }
      .tle-status-err     { color: #f85149; }
      .tle-status-loading { color: #d29922; }

      .tle-list-container {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .tle-sat-list {
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }

      .tle-sat-row {
        padding: 6px 12px;
        border-bottom: 1px solid rgba(48,54,61,0.4);
        cursor: pointer;
        transition: background 0.15s;
      }
      .tle-sat-row:hover { background: #21262d; }

      .tle-sat-name {
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        color: #bc8cff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tle-sat-meta {
        display: flex;
        gap: 8px;
        margin-top: 2px;
      }

      .tle-sat-norad {
        font-size: 9px;
        color: #6e7681;
        font-family: 'JetBrains Mono', monospace;
      }

      .tle-sat-pos {
        font-size: 9px;
        color: #8b949e;
        font-family: 'JetBrains Mono', monospace;
      }

      .tle-empty {
        padding: 12px;
        font-size: 10px;
        color: #6e7681;
        text-align: center;
      }

      .tle-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        border-top: 1px solid #30363d;
        background: #0d1117;
        flex-shrink: 0;
      }

      .tle-footer-label {
        font-size: 8px;
        color: #6e7681;
        font-family: 'JetBrains Mono', monospace;
      }

      .tle-propagator-badge {
        font-size: 8px;
        font-family: 'JetBrains Mono', monospace;
        background: rgba(188,140,255,0.15);
        border: 1px solid rgba(188,140,255,0.4);
        color: #bc8cff;
        padding: 1px 6px;
        letter-spacing: 1px;
      }
    `;
    document.head.appendChild(s);
  }

  return { init, openPanel, closePanel, togglePanel };
})();
