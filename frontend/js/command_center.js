/* =============================================================================
   COMMAND CENTER — frontend/js/command_center.js
   Interactive maneuver planner: satellite selector → strategy → ΔV → execute.
   ============================================================================= */

(function () {
  'use strict';

  const CMD = window.CommandCenter = {};

  /* ── State ─────────────────────────────────────────────────────────────── */
  let _satellites   = [];   // Latest snapshot satellite list
  let _maneuvers    = [];   // Latest maneuver cache
  let _selectedSat  = null; // Currently selected satellite object
  let _dvMagnitude  = 10.0; // m/s
  let _strategy     = 'PROGRADE';
  let _countdownTimer = null;

  const STRATEGIES = [
    { value: 'PROGRADE',    icon: '▲', label: 'Prograde',    desc: 'Along-track: raises apogee' },
    { value: 'RETROGRADE',  icon: '▼', label: 'Retrograde',  desc: 'Against track: lowers apogee' },
    { value: 'RADIAL_OUT',  icon: '◀', label: 'Radial Out',  desc: 'Away from Earth center' },
    { value: 'RADIAL_IN',   icon: '▶', label: 'Radial In',   desc: 'Toward Earth center' },
    { value: 'NORMAL_POS',  icon: '●', label: 'Normal +',    desc: 'Out-of-plane: raises inclination' },
    { value: 'NORMAL_NEG',  icon: '○', label: 'Normal −',    desc: 'Out-of-plane: lowers inclination' },
  ];

  /* ── Init ──────────────────────────────────────────────────────────────── */
  CMD.init = function () {
    _buildModal();
    _bindEvents();
  };

  /* ── Update with latest snapshot data ─────────────────────────────────── */
  CMD.updateData = function (satellites, maneuvers) {
    _satellites = satellites || [];
    _maneuvers  = maneuvers  || [];

    // Refresh selected sat from updated list
    if (_selectedSat) {
      const updated = _satellites.find(s => s.id === _selectedSat.id);
      if (updated) _selectedSat = updated;
    }

    _populateSatSelector();
    _refreshPreview();
  };

  /* ── Open modal ────────────────────────────────────────────────────────── */
  CMD.open = function (preSelectSatId) {
    const modal = document.getElementById('cmd-modal');
    if (!modal) return;

    _populateSatSelector(preSelectSatId);

    if (preSelectSatId) {
      _selectedSat = _satellites.find(s => s.id === preSelectSatId) || null;
    }

    modal.classList.add('visible');
    document.body.classList.add('modal-open');

    if (window.gsap) {
      gsap.fromTo('#cmd-modal-inner',
        { scale: 0.93, opacity: 0, y: 24 },
        { scale: 1, opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' }
      );
    }

    _refreshPreview();
    _clearStatus();
  };

  /* ── Close modal ───────────────────────────────────────────────────────── */
  CMD.close = function () {
    const modal = document.getElementById('cmd-modal');
    if (!modal) return;

    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }

    if (window.gsap) {
      gsap.to('#cmd-modal-inner', {
        scale: 0.94, opacity: 0, y: 16, duration: 0.25, ease: 'power2.in',
        onComplete: () => {
          modal.classList.remove('visible');
          document.body.classList.remove('modal-open');
          _resetUI();
        }
      });
    } else {
      modal.classList.remove('visible');
      document.body.classList.remove('modal-open');
      _resetUI();
    }
  };

  /* ── Build DOM ──────────────────────────────────────────────────────────── */
  function _buildModal() {
    if (document.getElementById('cmd-modal')) return; // Already built

    const el = document.createElement('div');
    el.id = 'cmd-modal';
    el.innerHTML = `
      <div id="cmd-modal-backdrop"></div>
      <div id="cmd-modal-inner">

        <!-- Header -->
        <div id="cmd-header">
          <div id="cmd-title">
            <span id="cmd-title-icon">🚀</span>
            <span>MANEUVER COMMAND CENTER</span>
          </div>
          <button id="cmd-close-btn" title="Close">✕</button>
        </div>

        <!-- Body: 2-column layout -->
        <div id="cmd-body">

          <!-- LEFT: Configuration panel -->
          <div id="cmd-left">

            <!-- Step 1: Select satellite -->
            <div class="cmd-section">
              <div class="cmd-section-label">
                <span class="cmd-step-bubble">1</span>
                SELECT SATELLITE
              </div>
              <select id="cmd-sat-select" class="cmd-select">
                <option value="">— Choose satellite —</option>
              </select>

              <!-- Mini sat info card -->
              <div id="cmd-sat-card" class="cmd-sat-card hidden">
                <div class="cmd-sat-card-row">
                  <span class="cmd-kv-label">STATUS</span>
                  <span id="cmd-sat-status" class="cmd-kv-value">—</span>
                </div>
                <div class="cmd-sat-card-row">
                  <span class="cmd-kv-label">FUEL</span>
                  <span id="cmd-sat-fuel" class="cmd-kv-value">—</span>
                </div>
                <div class="cmd-sat-card-row">
                  <span class="cmd-kv-label">ALT</span>
                  <span id="cmd-sat-alt" class="cmd-kv-value">—</span>
                </div>
                <div class="cmd-sat-card-row">
                  <span class="cmd-kv-label">LAT / LON</span>
                  <span id="cmd-sat-pos" class="cmd-kv-value">—</span>
                </div>
              </div>
            </div>

            <!-- Step 2: Strategy -->
            <div class="cmd-section">
              <div class="cmd-section-label">
                <span class="cmd-step-bubble">2</span>
                BURN STRATEGY
              </div>
              <div id="cmd-strategy-grid">
                ${STRATEGIES.map(s => `
                  <button class="cmd-strategy-btn ${s.value === _strategy ? 'active' : ''}"
                          data-strategy="${s.value}"
                          title="${s.desc}">
                    <span class="cmd-strategy-icon">${s.icon}</span>
                    <span class="cmd-strategy-name">${s.label}</span>
                  </button>
                `).join('')}
              </div>
              <div id="cmd-strategy-desc" class="cmd-strategy-desc">
                ${STRATEGIES.find(s => s.value === _strategy)?.desc || ''}
              </div>
            </div>

            <!-- Step 3: ΔV magnitude -->
            <div class="cmd-section">
              <div class="cmd-section-label">
                <span class="cmd-step-bubble">3</span>
                ΔV MAGNITUDE
              </div>
              <div id="cmd-dv-row">
                <input type="range" id="cmd-dv-slider" min="0.5" max="50" step="0.5" value="${_dvMagnitude}" class="cmd-slider">
                <div id="cmd-dv-display">
                  <input type="number" id="cmd-dv-input" value="${_dvMagnitude}" min="0.5" max="50" step="0.5" class="cmd-number-input">
                  <span class="cmd-unit">m/s</span>
                </div>
              </div>
              <div id="cmd-dv-preset-row">
                <button class="cmd-preset-btn" data-dv="1">1 m/s</button>
                <button class="cmd-preset-btn" data-dv="5">5 m/s</button>
                <button class="cmd-preset-btn" data-dv="10">10 m/s</button>
                <button class="cmd-preset-btn" data-dv="25">25 m/s</button>
              </div>
            </div>

          </div><!-- /cmd-left -->

          <!-- RIGHT: Live preview + execute -->
          <div id="cmd-right">

            <!-- Fuel preview gauge -->
            <div class="cmd-section">
              <div class="cmd-section-label" style="margin-bottom:10px;">
                <i data-lucide="activity"></i>
                MISSION PREVIEW
              </div>

              <!-- Fuel gauge ring -->
              <div id="cmd-gauge-wrap">
                <svg id="cmd-gauge-svg" viewBox="0 0 160 160" width="160" height="160">
                  <circle class="cmd-gauge-track" cx="80" cy="80" r="60" />
                  <circle class="cmd-gauge-fill" id="cmd-gauge-fill" cx="80" cy="80" r="60"
                          stroke-dasharray="0 377"
                          transform="rotate(-90 80 80)" />
                  <circle class="cmd-gauge-burn" id="cmd-gauge-burn" cx="80" cy="80" r="60"
                          stroke-dasharray="0 377"
                          transform="rotate(-90 80 80)" />
                  <text x="80" y="72" class="cmd-gauge-pct" id="cmd-gauge-pct-text">—</text>
                  <text x="80" y="90" class="cmd-gauge-unit">FUEL</text>
                </svg>
                <div id="cmd-gauge-legend">
                  <span class="cmd-legend-item"><span class="cmd-legend-dot" style="background:#58a6ff"></span> Remaining</span>
                  <span class="cmd-legend-item"><span class="cmd-legend-dot" style="background:#f85149"></span> Burn cost</span>
                </div>
              </div>

              <!-- Key metrics -->
              <div id="cmd-metrics-grid">
                <div class="cmd-metric-card">
                  <span class="cmd-metric-label">BURN COST</span>
                  <span class="cmd-metric-value text-red" id="cmd-metric-cost">—</span>
                </div>
                <div class="cmd-metric-card">
                  <span class="cmd-metric-label">AFTER BURN</span>
                  <span class="cmd-metric-value text-green" id="cmd-metric-after">—</span>
                </div>
                <div class="cmd-metric-card">
                  <span class="cmd-metric-label">COLLISION RISK</span>
                  <span class="cmd-metric-value" id="cmd-metric-risk">—</span>
                </div>
                <div class="cmd-metric-card">
                  <span class="cmd-metric-label">ACTIVE CDMs</span>
                  <span class="cmd-metric-value" id="cmd-metric-cdms">—</span>
                </div>
              </div>
            </div>

            <!-- Execute + status -->
            <div id="cmd-execute-section">
              <div id="cmd-status" class="cmd-status hidden"></div>

              <div id="cmd-countdown-wrap" class="hidden">
                <div id="cmd-countdown-label">SIGNAL DELAY</div>
                <div id="cmd-countdown-display">10</div>
                <div id="cmd-countdown-bar-wrap">
                  <div id="cmd-countdown-bar"></div>
                </div>
              </div>

              <button id="cmd-execute-btn" class="cmd-execute-btn" disabled>
                <i data-lucide="send"></i>
                SCHEDULE BURN
              </button>

              <div id="cmd-disclaimer">
                ⚠ Burn queued for T+10s to comply with signal propagation delay
              </div>
            </div>

          </div><!-- /cmd-right -->

        </div><!-- /cmd-body -->
      </div><!-- /cmd-modal-inner -->
    `;

    document.body.appendChild(el);
    if (window.lucide) lucide.createIcons({ nodes: [el] });
  }

  /* ── Bind Events ────────────────────────────────────────────────────────── */
  function _bindEvents() {
    // Use event delegation on body since modal is built dynamically
    document.addEventListener('click', (e) => {
      // Close button
      if (e.target.closest('#cmd-close-btn')) { CMD.close(); return; }

      // Backdrop click
      if (e.target.id === 'cmd-modal-backdrop') { CMD.close(); return; }

      // Strategy buttons
      const stratBtn = e.target.closest('.cmd-strategy-btn');
      if (stratBtn) {
        _strategy = stratBtn.dataset.strategy;
        document.querySelectorAll('.cmd-strategy-btn').forEach(b => b.classList.remove('active'));
        stratBtn.classList.add('active');
        const desc = STRATEGIES.find(s => s.value === _strategy)?.desc || '';
        const descEl = document.getElementById('cmd-strategy-desc');
        if (descEl) descEl.textContent = desc;
        _refreshPreview();
        return;
      }

      // Preset buttons
      const presetBtn = e.target.closest('.cmd-preset-btn');
      if (presetBtn) {
        _dvMagnitude = parseFloat(presetBtn.dataset.dv);
        _syncDvControls();
        _refreshPreview();
        return;
      }

      // Execute button
      if (e.target.closest('#cmd-execute-btn')) { _executeBurn(); return; }
    });

    document.addEventListener('change', (e) => {
      if (e.target.id === 'cmd-sat-select') {
        const satId = e.target.value;
        _selectedSat = _satellites.find(s => s.id === satId) || null;
        _updateSatCard();
        _refreshPreview();
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'cmd-dv-slider') {
        _dvMagnitude = parseFloat(e.target.value);
        const input = document.getElementById('cmd-dv-input');
        if (input) input.value = _dvMagnitude;
        _refreshPreview();
      }
      if (e.target.id === 'cmd-dv-input') {
        const val = Math.max(0.5, Math.min(50, parseFloat(e.target.value) || 0.5));
        _dvMagnitude = val;
        const slider = document.getElementById('cmd-dv-slider');
        if (slider) slider.value = val;
        _refreshPreview();
      }
    });

    // Keyboard: Escape closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('cmd-modal');
        if (modal && modal.classList.contains('visible')) CMD.close();
      }
    });
  }

  /* ── Populate satellite selector ────────────────────────────────────────── */
  function _populateSatSelector(preSelect) {
    const sel = document.getElementById('cmd-sat-select');
    if (!sel) return;
    const current = preSelect || sel.value;

    sel.innerHTML = '<option value="">— Choose satellite —</option>';
    _satellites.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const fuel = (s.fuel_kg || 0).toFixed(1);
      const statusEmoji = { NOMINAL:'🟢', EVADING:'🔴', RECOVERING:'🟡', EOL:'⚫' }[s.status] || '⚪';
      opt.textContent = `${statusEmoji} ${s.id}  —  ${fuel} kg fuel`;
      if (s.status === 'EOL') opt.disabled = true;
      sel.appendChild(opt);
    });

    if (current) sel.value = current;

    // Sync selected sat
    if (sel.value) {
      _selectedSat = _satellites.find(s => s.id === sel.value) || null;
      _updateSatCard();
    }
  }

  /* ── Update the mini satellite info card ────────────────────────────────── */
  function _updateSatCard() {
    const card = document.getElementById('cmd-sat-card');
    if (!card) return;

    if (!_selectedSat) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    const fuel = (_selectedSat.fuel_kg || 0).toFixed(2);
    const fuelPct = ((_selectedSat.fuel_kg || 0) / 50 * 100).toFixed(1);
    const alt = (_selectedSat.alt_km || 0).toFixed(0);
    const lat = (_selectedSat.lat || 0).toFixed(2);
    const lon = (_selectedSat.lon || 0).toFixed(2);

    const statusColors = { NOMINAL:'var(--green)', EVADING:'var(--red)', RECOVERING:'var(--amber)', EOL:'var(--text-dim)' };
    const statusColor = statusColors[_selectedSat.status] || 'var(--text-primary)';

    _setText('cmd-sat-status', _selectedSat.status, { color: statusColor });
    _setText('cmd-sat-fuel', `${fuel} kg  (${fuelPct}%)`, {
      color: parseFloat(fuelPct) > 60 ? 'var(--green)' : parseFloat(fuelPct) > 30 ? 'var(--amber)' : 'var(--red)'
    });
    _setText('cmd-sat-alt', `${alt} km`);
    _setText('cmd-sat-pos', `${lat}°, ${lon}°`);

    // Enable/disable execute button
    const execBtn = document.getElementById('cmd-execute-btn');
    if (execBtn) {
      const canFire = _selectedSat.status !== 'EOL' && _selectedSat.status !== 'EVADING';
      execBtn.disabled = !canFire;
      execBtn.title = canFire ? 'Schedule the burn' :
        _selectedSat.status === 'EOL' ? 'Satellite is EOL — no fuel' :
        'Satellite is already executing a maneuver';
    }
  }

  /* ── Refresh live fuel preview ──────────────────────────────────────────── */
  function _refreshPreview() {
    if (!_selectedSat) {
      _setGaugeEmpty();
      _setText('cmd-metric-cost', '—');
      _setText('cmd-metric-after', '—');
      _setText('cmd-metric-risk', '—');
      _setText('cmd-metric-cdms', '—');
      return;
    }

    const fuel = _selectedSat.fuel_kg || 0;
    const mass = 500 + fuel; // kg

    // Tsiolkovsky approximation: Δm = m * (1 - exp(-ΔV / (Isp * g0)))
    const ISP = 300, G0 = 9.80665;
    const fuelCost = mass * (1 - Math.exp(-_dvMagnitude / (ISP * G0)));
    const fuelAfter = Math.max(0, fuel - fuelCost);
    const pctNow  = (fuel       / 50) * 100;
    const pctAfter = (fuelAfter / 50) * 100;
    const costPct = ((fuelCost / 50) * 100);

    // Gauge
    _updateGauge(pctNow, costPct);

    _setText('cmd-metric-cost',  `-${fuelCost.toFixed(3)} kg`);
    _setText('cmd-metric-after', `${fuelAfter.toFixed(2)} kg`, {
      color: fuelAfter > 20 ? 'var(--green)' : fuelAfter > 5 ? 'var(--amber)' : 'var(--red)'
    });

    // Risk: check active CDMs for this satellite
    const satCDMs = _maneuvers && Array.isArray(_maneuvers)
      ? [] : [];  // maneuvers isn't cdms — use AppState
    const cdmCount = (typeof AppState !== 'undefined' && AppState.state.cdms)
      ? AppState.state.cdms.filter(c => c.satelliteId === _selectedSat.id).length
      : 0;
    const critCdms = (typeof AppState !== 'undefined' && AppState.state.cdms)
      ? AppState.state.cdms.filter(c => c.satelliteId === _selectedSat.id && c.missDistance < 0.1).length
      : 0;

    const riskLabel = critCdms > 0 ? '⚠ CRITICAL' : cdmCount > 0 ? '⚠ WARNING' : '✓ CLEAR';
    const riskColor = critCdms > 0 ? 'var(--red)' : cdmCount > 0 ? 'var(--amber)' : 'var(--green)';
    _setText('cmd-metric-risk', riskLabel, { color: riskColor });
    _setText('cmd-metric-cdms', `${cdmCount} active`);

    // Disable execute if insufficient fuel with small buffer
    const execBtn = document.getElementById('cmd-execute-btn');
    if (execBtn && !execBtn.disabled) {
      if (fuelCost > fuel) {
        execBtn.disabled = true;
        execBtn.title = 'Insufficient propellant for this ΔV';
        _showStatus('⚠ Insufficient fuel for the requested ΔV', 'warning');
      } else {
        execBtn.disabled = _selectedSat.status === 'EOL' || _selectedSat.status === 'EVADING';
        _clearStatus();
      }
    }
  }

  /* ── SVG gauge ──────────────────────────────────────────────────────────── */
  function _updateGauge(pctFuel, pctBurn) {
    const CIRC = 2 * Math.PI * 60; // ~377

    const fillEl  = document.getElementById('cmd-gauge-fill');
    const burnEl  = document.getElementById('cmd-gauge-burn');
    const pctText = document.getElementById('cmd-gauge-pct-text');

    const clampedFuel = Math.max(0, Math.min(100, pctFuel));
    const clampedBurn = Math.max(0, Math.min(clampedFuel, pctBurn));

    const fuelDash = (clampedFuel / 100) * CIRC;
    const burnDash = (clampedBurn / 100) * CIRC;
    const burnOffset = ((clampedFuel - clampedBurn) / 100) * CIRC;

    if (fillEl) {
      fillEl.style.strokeDasharray = `${fuelDash} ${CIRC}`;
      fillEl.style.stroke = clampedFuel > 60 ? 'var(--blue)' : clampedFuel > 30 ? 'var(--amber)' : 'var(--red)';
    }
    if (burnEl) {
      burnEl.style.strokeDasharray = `${burnDash} ${CIRC}`;
      burnEl.style.strokeDashoffset = `-${burnOffset}`;
    }
    if (pctText) {
      pctText.textContent = clampedFuel.toFixed(0) + '%';
      pctText.style.fill = clampedFuel > 60 ? 'var(--blue)' : clampedFuel > 30 ? 'var(--amber)' : 'var(--red)';
    }
  }

  function _setGaugeEmpty() {
    const fill = document.getElementById('cmd-gauge-fill');
    const burn = document.getElementById('cmd-gauge-burn');
    const txt  = document.getElementById('cmd-gauge-pct-text');
    if (fill) fill.style.strokeDasharray = '0 377';
    if (burn) burn.style.strokeDasharray = '0 377';
    if (txt) txt.textContent = '—';
  }

  /* ── Execute burn (call backend API) ────────────────────────────────────── */
  async function _executeBurn() {
    if (!_selectedSat) return;

    const btn = document.getElementById('cmd-execute-btn');
    if (btn) btn.disabled = true;

    // Show countdown
    _startCountdown(10, async () => {
      _showStatus('⌛ Transmitting burn command...', 'info');

      try {
        const BASE = (typeof API !== 'undefined' && API.BASE) ? API.BASE : '';
        const res = await fetch(`${BASE}/api/maneuvers/schedule-evasion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            satellite_id:   _selectedSat.id,
            strategy:       _strategy,
            dv_magnitude_ms: _dvMagnitude,
          })
        });

        const data = await res.json();

        if (res.ok) {
          _showStatus(
            `✅ Burn scheduled: ${_strategy} | ΔV=${_dvMagnitude} m/s | Fuel cost ≈ ${(data.fuel_cost_kg || 0).toFixed(3)} kg`,
            'success'
          );

          // GSAP celebration flash
          if (window.gsap) {
            gsap.fromTo('#cmd-modal-inner',
              { borderColor: 'var(--green)' },
              { borderColor: 'var(--border-dim)', duration: 1.5, ease: 'power2.out' }
            );
          }

          // Re-enable after 2s
          setTimeout(() => {
            if (btn) btn.disabled = false;
          }, 2000);

        } else {
          _showStatus(`❌ Error: ${data.detail || data.message || 'Unknown error'}`, 'error');
          if (btn) btn.disabled = false;
        }
      } catch (err) {
        _showStatus(`❌ Network error: ${err.message}`, 'error');
        if (btn) btn.disabled = false;
      }
    });
  }

  /* ── Countdown animation ────────────────────────────────────────────────── */
  function _startCountdown(seconds, onComplete) {
    const wrap  = document.getElementById('cmd-countdown-wrap');
    const disp  = document.getElementById('cmd-countdown-display');
    const bar   = document.getElementById('cmd-countdown-bar');

    if (wrap) wrap.classList.remove('hidden');

    let remaining = seconds;

    if (disp) disp.textContent = remaining;
    if (bar)  { bar.style.transition = 'none'; bar.style.width = '100%'; }

    // Animate bar smoothly
    requestAnimationFrame(() => {
      if (bar) {
        bar.style.transition = `width ${seconds}s linear`;
        bar.style.width = '0%';
      }
    });

    _countdownTimer = setInterval(() => {
      remaining--;
      if (disp) disp.textContent = remaining;

      if (remaining <= 0) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
        if (wrap) wrap.classList.add('hidden');
        onComplete();
      }
    }, 1000);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  function _syncDvControls() {
    const slider = document.getElementById('cmd-dv-slider');
    const input  = document.getElementById('cmd-dv-input');
    if (slider) slider.value = _dvMagnitude;
    if (input)  input.value  = _dvMagnitude;
  }

  function _setText(id, text, styles) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (styles) Object.assign(el.style, styles);
  }

  function _showStatus(msg, type) {
    const el = document.getElementById('cmd-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `cmd-status cmd-status-${type}`;
    el.classList.remove('hidden');
  }

  function _clearStatus() {
    const el = document.getElementById('cmd-status');
    if (el) el.classList.add('hidden');
  }

  function _resetUI() {
    _clearStatus();
    const wrap = document.getElementById('cmd-countdown-wrap');
    if (wrap) wrap.classList.add('hidden');
    const btn = document.getElementById('cmd-execute-btn');
    if (btn) btn.disabled = false;
  }

})();
