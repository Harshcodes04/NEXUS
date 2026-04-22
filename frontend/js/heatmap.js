/* ═══════════════════════════════════════════════════════════════════════════
   ACM — heatmap.js
   Collision Risk Heatmap Overlay on Ground Track Map
   Fetches /api/heatmap every N seconds and paints a 72×36 risk grid
   onto a dedicated canvas layer beneath the debris & SVG layers.
   ═══════════════════════════════════════════════════════════════════════════ */

const Heatmap = (() => {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const REFRESH_MS   = 4000;   // poll interval
  const GRID_ROWS    = 36;
  const GRID_COLS    = 72;
  const CELL_DEG     = 5;

  // Heat colour ramp: 0 → transparent, 0.5 → amber, 1 → red
  const COLOR_STOPS = [
    { t: 0.00, r: 0,   g: 0,   b: 0,   a: 0   },
    { t: 0.10, r: 88,  g: 166, b: 255, a: 20  },  // faint blue at very low risk
    { t: 0.35, r: 210, g: 153, b: 34,  a: 100 },  // amber
    { t: 0.65, r: 248, g: 81,  b: 73,  a: 160 },  // red-orange
    { t: 1.00, r: 255, g: 30,  b: 30,  a: 220 },  // bright red
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  let _canvas    = null;
  let _ctx       = null;
  let _enabled   = false;
  let _grid      = null;          // last fetched grid [row][col]
  let _timer     = null;
  let _projection = null;         // shared D3 projection from GroundTrack
  let _width      = 0;
  let _height     = 0;
  let _opacity    = 0.55;

  // ── Projection bridge ─────────────────────────────────────────────────────
  // We re-use d3.geoMercator() with the same scale/translate as GroundTrack.
  // Both are calibrated in their own init; we just need to know the container size.

  function _getProjection() {
    const container = document.getElementById('groundtrack-svg-container');
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    _width  = Math.max(rect.width,  200);
    _height = Math.max(rect.height, 100);

    return d3.geoMercator()
      .scale(_width / 2 / Math.PI)
      .translate([_width / 2, _height / 2])
      .clipExtent([[0, 0], [_width, _height]]);
  }

  // ── Colour interpolation ──────────────────────────────────────────────────
  function _heat(value) {
    // Clamp
    const v = Math.max(0, Math.min(1, value));
    // Find bracket
    let lo = COLOR_STOPS[0];
    let hi = COLOR_STOPS[COLOR_STOPS.length - 1];
    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
      if (v >= COLOR_STOPS[i].t && v <= COLOR_STOPS[i + 1].t) {
        lo = COLOR_STOPS[i];
        hi = COLOR_STOPS[i + 1];
        break;
      }
    }
    const span = hi.t - lo.t || 1;
    const frac = (v - lo.t) / span;
    return {
      r: Math.round(lo.r + (hi.r - lo.r) * frac),
      g: Math.round(lo.g + (hi.g - lo.g) * frac),
      b: Math.round(lo.b + (hi.b - lo.b) * frac),
      a: (lo.a + (hi.a - lo.a) * frac) / 255 * _opacity,
    };
  }

  // ── Canvas init ───────────────────────────────────────────────────────────
  function _ensureCanvas() {
    if (_canvas) return true;

    const container = document.getElementById('groundtrack-svg-container');
    if (!container) return false;

    // Create the heatmap canvas at z-index 0 (below debris-canvas at z-index 1)
    _canvas = document.createElement('canvas');
    _canvas.id = 'heatmap-canvas';
    _canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 0;
      opacity: 1;
    `;
    // Insert as first child (behind debris-canvas and SVG)
    container.insertBefore(_canvas, container.firstChild);

    _ctx = _canvas.getContext('2d');
    _resizeCanvas();
    return true;
  }

  function _resizeCanvas() {
    const container = document.getElementById('groundtrack-svg-container');
    if (!container || !_canvas) return;
    const rect = container.getBoundingClientRect();
    _canvas.width  = Math.max(rect.width,  200);
    _canvas.height = Math.max(rect.height, 100);
    _width  = _canvas.width;
    _height = _canvas.height;
  }

  // ── Fetch & Render ────────────────────────────────────────────────────────
  async function _fetchAndRender() {
    if (!_enabled) return;
    try {
      const res  = await fetch('/api/heatmap');
      const data = await res.json();
      _grid = data.grid;
      _updateBadge(data.cdm_count, data.debris_count);
      _render();
    } catch (e) {
      console.warn('[Heatmap] Fetch failed:', e.message);
    }
  }

  function _render() {
    if (!_ctx || !_grid) return;

    _resizeCanvas();
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    if (!_enabled) return;

    const proj = _getProjection();
    if (!proj) return;

    // Render each 5°×5° cell as a filled rect on the canvas
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const val = _grid[row][col];
        if (val < 0.01) continue;  // skip empty cells

        // Cell lat/lon bounds
        const lat1 = -90 + row * CELL_DEG;
        const lat2 = lat1 + CELL_DEG;
        const lon1 = -180 + col * CELL_DEG;
        const lon2 = lon1 + CELL_DEG;

        // Project all 4 corners
        const [x1, y1] = proj([lon1, lat2]) || [0, 0];  // top-left (lat is flipped)
        const [x2, y2] = proj([lon2, lat1]) || [0, 0];  // bottom-right

        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);

        // Build gradient for a smoother look
        try {
          const grd = _ctx.createRadialGradient(
            x1 + w / 2, y1 + h / 2, 0,
            x1 + w / 2, y1 + h / 2, Math.max(w, h) * 0.9
          );
          const c = _heat(val);
          grd.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${(c.a * 1.5).toFixed(3)})`);
          grd.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
          _ctx.fillStyle = grd;
          // Expand cell slightly for bleeding/smoothness
          _ctx.fillRect(x1 - w * 0.1, y1 - h * 0.1, w * 1.2, h * 1.2);
        } catch (_) {
          // Flat fallback
          const c = _heat(val);
          _ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(3)})`;
          _ctx.fillRect(x1, y1, w, h);
        }
      }
    }
  }

  // ── Legend & Badge ────────────────────────────────────────────────────────
  function _buildLegendAndControls() {
    // Don't add twice
    if (document.getElementById('heatmap-controls')) return;

    const mapPanel = document.getElementById('map-panel');
    if (!mapPanel) return;

    const controls = document.createElement('div');
    controls.id = 'heatmap-controls';
    controls.innerHTML = `
      <button id="heatmap-toggle-btn" title="Toggle collision risk heatmap">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        HEATMAP
      </button>
      <div id="heatmap-legend" class="heatmap-legend" style="display:none;">
        <span class="heatmap-legend-label">LOW</span>
        <div class="heatmap-legend-ramp"></div>
        <span class="heatmap-legend-label">HIGH</span>
      </div>
      <div id="heatmap-badge" style="display:none;"></div>
    `;

    mapPanel.appendChild(controls);

    // Button handler
    document.getElementById('heatmap-toggle-btn')?.addEventListener('click', toggle);

    // Build gradient legend ramp
    const ramp = controls.querySelector('.heatmap-legend-ramp');
    if (ramp) {
      const stops = COLOR_STOPS
        .filter(s => s.a > 0)
        .map(s => `rgba(${s.r},${s.g},${s.b},${(s.a/255).toFixed(2)}) ${(s.t * 100).toFixed(0)}%`)
        .join(',');
      ramp.style.background = `linear-gradient(to right, ${stops})`;
    }
  }

  function _updateBadge(cdmCount, debrisCount) {
    const badge = document.getElementById('heatmap-badge');
    if (badge) {
      badge.textContent = `${cdmCount} CDMs · ${debrisCount} debris`;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function init() {
    _buildLegendAndControls();
    _injectStyles();

    // Resize on window resize
    window.addEventListener('resize', () => {
      if (_enabled) {
        _resizeCanvas();
        _render();
      }
    });
  }

  function toggle() {
    _enabled = !_enabled;
    const btn    = document.getElementById('heatmap-toggle-btn');
    const legend = document.getElementById('heatmap-legend');
    const badge  = document.getElementById('heatmap-badge');

    if (_enabled) {
      _ensureCanvas();
      btn?.classList.add('active');
      if (legend) legend.style.display = 'flex';
      if (badge)  badge.style.display  = 'block';

      _fetchAndRender();
      _timer = setInterval(_fetchAndRender, REFRESH_MS);
    } else {
      clearInterval(_timer);
      _timer = null;
      btn?.classList.remove('active');
      if (legend) legend.style.display = 'none';
      if (badge)  badge.style.display  = 'none';
      if (_ctx && _canvas) {
        _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
      }
    }
  }

  function enable()  { if (!_enabled) toggle(); }
  function disable() { if (_enabled)  toggle(); }

  // Force a re-render (e.g. called by main.js on data update)
  function refresh() {
    if (_enabled) _fetchAndRender();
  }

  // ── Inline Styles ─────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('heatmap-styles')) return;
    const style = document.createElement('style');
    style.id = 'heatmap-styles';
    style.textContent = `
      #heatmap-controls {
        position: absolute;
        bottom: 12px;
        left: 12px;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 6px;
        pointer-events: all;
      }

      #heatmap-toggle-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        background: rgba(22, 27, 34, 0.88);
        border: 1px solid #30363d;
        color: #8b949e;
        font-size: 9px;
        letter-spacing: 1.5px;
        font-family: 'JetBrains Mono', monospace;
        padding: 5px 10px;
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(4px);
      }

      #heatmap-toggle-btn:hover {
        border-color: #f85149;
        color: #f85149;
      }

      #heatmap-toggle-btn.active {
        border-color: #f85149;
        color: #f85149;
        background: rgba(248, 81, 73, 0.15);
      }

      #heatmap-toggle-btn svg {
        flex-shrink: 0;
      }

      .heatmap-legend {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(22, 27, 34, 0.88);
        border: 1px solid #30363d;
        padding: 5px 8px;
        backdrop-filter: blur(4px);
      }

      .heatmap-legend-label {
        font-size: 8px;
        letter-spacing: 1px;
        color: #6e7681;
        font-family: 'JetBrains Mono', monospace;
        flex-shrink: 0;
      }

      .heatmap-legend-ramp {
        width: 80px;
        height: 6px;
        flex-shrink: 0;
        border: 1px solid rgba(48,54,61,0.5);
      }

      #heatmap-badge {
        font-size: 9px;
        font-family: 'JetBrains Mono', monospace;
        color: #6e7681;
        background: rgba(22, 27, 34, 0.85);
        border: 1px solid #30363d;
        padding: 3px 8px;
        letter-spacing: 0.5px;
        backdrop-filter: blur(4px);
      }
    `;
    document.head.appendChild(style);
  }

  return { init, toggle, enable, disable, refresh };
})();
