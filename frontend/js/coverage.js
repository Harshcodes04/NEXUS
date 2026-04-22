/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS — coverage.js
   Ground Station LOS Coverage Matrix Panel.
   Polls /api/coverage every 3s and renders a live contact matrix.
   ═══════════════════════════════════════════════════════════════════════════ */

const Coverage = (() => {
  'use strict';

  const POLL_MS = 3000;
  let _timer    = null;
  let _built    = false;

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _injectStyles();
    _buildPanel();
    _start();
  }

  function _start() {
    _fetchAndRender();
    _timer = setInterval(_fetchAndRender, POLL_MS);
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function _fetchAndRender() {
    try {
      const res  = await fetch('/api/coverage');
      const data = await res.json();
      _render(data);
    } catch (e) {
      console.warn('[Coverage] fetch failed:', e.message);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function _render(data) {
    const container = document.getElementById('coverage-panel');
    if (!container) return;

    const { matrix, total_links, sats_in_contact, total_sats, sim_time } = data;

    container.innerHTML = `
      <!-- KPI strip -->
      <div class="cov-kpi-strip">
        <div class="cov-kpi">
          <div class="cov-kpi-val">${total_links}</div>
          <div class="cov-kpi-lbl">ACTIVE LINKS</div>
        </div>
        <div class="cov-kpi">
          <div class="cov-kpi-val" style="color:${sats_in_contact === total_sats ? '#3fb950' : '#d29922'}">${sats_in_contact}/${total_sats}</div>
          <div class="cov-kpi-lbl">SATS IN CONTACT</div>
        </div>
        <div class="cov-kpi">
          <div class="cov-kpi-val">${matrix.length}</div>
          <div class="cov-kpi-lbl">GROUND STATIONS</div>
        </div>
        <div class="cov-kpi-time">${sim_time.slice(11, 19)}Z</div>
      </div>

      <!-- Ground station cards -->
      <div class="cov-gs-grid">
        ${matrix.map(gs => _renderGSCard(gs)).join('')}
      </div>
    `;

    // Wire satellite click → select in AppState
    container.querySelectorAll('[data-sat-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.satId;
        if (typeof AppState !== 'undefined') AppState.selectSatellite(id);
      });
    });
  }

  function _renderGSCard(gs) {
    const { name, id } = gs.gs;
    const count = gs.count;
    const hasContact = count > 0;
    const borderColor = hasContact ? '#3fb950' : '#30363d';
    const dotColor    = hasContact ? '#3fb950' : '#6e7681';

    const rows = gs.visible.length
      ? gs.visible.map(v => `
          <div class="cov-sat-row" data-sat-id="${v.sat_id}" title="Click to select">
            <span class="cov-sat-id">${v.sat_id.replace('SAT-', '')}</span>
            <span class="cov-sat-status cov-status-${v.status.toLowerCase()}">${v.status}</span>
            <span class="cov-sat-el">${v.elevation_deg}°</span>
            <span class="cov-sat-range">${v.slant_range_km} km</span>
            <div class="cov-el-bar">
              <div class="cov-el-fill" style="width:${Math.min(100, (v.elevation_deg / 90) * 100).toFixed(1)}%"></div>
            </div>
          </div>`).join('')
      : `<div class="cov-no-contact">NO SATELLITES IN VIEW</div>`;

    return `
      <div class="cov-gs-card" style="border-left: 2px solid ${borderColor};">
        <div class="cov-gs-header">
          <div class="cov-gs-dot" style="background:${dotColor};${hasContact ? 'box-shadow:0 0 6px ' + dotColor : ''}"></div>
          <div class="cov-gs-name">${name}</div>
          <div class="cov-gs-id">${id}</div>
          <div class="cov-gs-count" style="color:${hasContact ? '#3fb950' : '#6e7681'}">${count} SAT${count !== 1 ? 'S' : ''}</div>
        </div>
        <div class="cov-sat-table">
          ${gs.visible.length ? `
          <div class="cov-sat-header">
            <span>SAT</span><span>STATUS</span><span>EL°</span><span>RANGE km</span><span></span>
          </div>` : ''}
          ${rows}
        </div>
      </div>
    `;
  }

  // ── Build container ────────────────────────────────────────────────────────
  function _buildPanel() {
    if (_built) return;
    _built = true;

    // Inject into charts-view if it exists
    const chartsView = document.getElementById('charts-view');
    if (!chartsView) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'coverage-panel';
    wrapper.className = 'coverage-panel';
    chartsView.appendChild(wrapper);
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('coverage-styles')) return;
    const s = document.createElement('style');
    s.id = 'coverage-styles';
    s.textContent = `
      .coverage-panel {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        background: rgba(13, 17, 23, 0.6);
        border: 1px solid #30363d;
        border-radius: 2px;
      }

      /* KPI strip */
      .cov-kpi-strip {
        display: flex;
        gap: 0;
        border: 1px solid #30363d;
        align-items: center;
      }
      .cov-kpi {
        flex: 1;
        padding: 8px 12px;
        border-right: 1px solid #30363d;
        text-align: center;
      }
      .cov-kpi-val {
        font-size: 20px;
        font-family: 'JetBrains Mono', monospace;
        color: #58a6ff;
        font-weight: bold;
        line-height: 1;
      }
      .cov-kpi-lbl {
        font-size: 7px;
        letter-spacing: 1.5px;
        color: #6e7681;
        font-family: 'JetBrains Mono', monospace;
        margin-top: 3px;
      }
      .cov-kpi-time {
        padding: 8px 14px;
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        color: #6e7681;
        white-space: nowrap;
      }

      /* Ground station grid */
      .cov-gs-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 8px;
      }

      .cov-gs-card {
        background: rgba(22, 27, 34, 0.8);
        border: 1px solid #30363d;
        padding: 0;
        transition: border-color 0.2s;
      }
      .cov-gs-card:hover { border-color: #58a6ff; }

      .cov-gs-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 7px 10px;
        border-bottom: 1px solid rgba(48,54,61,0.5);
        background: rgba(33, 38, 45, 0.6);
      }

      .cov-gs-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: box-shadow 0.3s;
      }

      .cov-gs-name {
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        color: #e6edf3;
        flex: 1;
      }

      .cov-gs-id {
        font-size: 8px;
        color: #6e7681;
        font-family: 'JetBrains Mono', monospace;
      }

      .cov-gs-count {
        font-size: 9px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: bold;
        letter-spacing: 0.5px;
      }

      .cov-sat-table {
        padding: 4px 0;
      }

      .cov-sat-header {
        display: grid;
        grid-template-columns: 60px 70px 40px 70px 1fr;
        padding: 3px 10px;
        font-size: 7px;
        letter-spacing: 1px;
        color: #6e7681;
        font-family: 'JetBrains Mono', monospace;
        border-bottom: 1px solid rgba(48,54,61,0.3);
      }

      .cov-sat-row {
        display: grid;
        grid-template-columns: 60px 70px 40px 70px 1fr;
        align-items: center;
        padding: 5px 10px;
        border-bottom: 1px solid rgba(48,54,61,0.2);
        cursor: pointer;
        transition: background 0.15s;
        gap: 2px;
      }
      .cov-sat-row:hover { background: rgba(88,166,255,0.05); }
      .cov-sat-row:last-child { border-bottom: none; }

      .cov-sat-id {
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        color: #58a6ff;
      }

      .cov-sat-status {
        font-size: 8px;
        letter-spacing: 0.5px;
        font-family: 'JetBrains Mono', monospace;
      }
      .cov-status-nominal   { color: #3fb950; }
      .cov-status-evading   { color: #bc8cff; }
      .cov-status-recovering{ color: #d29922; }
      .cov-status-eol       { color: #6e7681; }

      .cov-sat-el, .cov-sat-range {
        font-size: 9px;
        font-family: 'JetBrains Mono', monospace;
        color: #8b949e;
      }

      .cov-el-bar {
        height: 3px;
        background: rgba(48,54,61,0.6);
        border-radius: 1px;
        overflow: hidden;
      }
      .cov-el-fill {
        height: 100%;
        background: linear-gradient(to right, #3fb950, #58a6ff);
        border-radius: 1px;
        transition: width 0.4s ease;
      }

      .cov-no-contact {
        padding: 10px;
        font-size: 8px;
        letter-spacing: 1px;
        color: #6e7681;
        text-align: center;
        font-family: 'JetBrains Mono', monospace;
      }
    `;
    document.head.appendChild(s);
  }

  return { init };
})();
