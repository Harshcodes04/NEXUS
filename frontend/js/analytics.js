/* ═══════════════════════════════════════════════════════════════════════════
   ACM — analytics.js
   Mission Analytics Dashboard — Historical Data Visualization
   Pulls from /api/analytics/* endpoints and renders with D3.
   ═══════════════════════════════════════════════════════════════════════════ */

const Analytics = (() => {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  let _summary     = null;
  let _alerts      = [];
  let _fuelData    = {};          // { satId: [{ t, fuel_kg }] }
  let _selectedSat = null;
  let _satellites  = [];          // live satellite list from snapshots
  let _refreshTimer = null;

  const REFRESH_INTERVAL = 15000; // 15 s auto-refresh

  // colour palette indexed by satellite index
  const SAT_COLORS = [
    '#58a6ff', '#3fb950', '#d29922', '#f85149',
    '#bc8cff', '#39c5cf', '#ffa657', '#79c0ff'
  ];

  // ── Public API ───────────────────────────────────────────────────────────

  function init() {
    _buildTooltip();
    _bindRefreshBtn();
    _bindSatSelect();
    refresh();                          // initial load
    _refreshTimer = setInterval(refresh, REFRESH_INTERVAL);

    // Listen for live satellite list from main.js snapshots
    document.addEventListener('analytics-satellites', (e) => {
      _satellites = e.detail || [];
      _repopulateSatSelect();
    });
  }

  async function refresh() {
    const btn = document.getElementById('analytics-refresh-btn');
    if (btn) btn.classList.add('loading');

    try {
      const [summary, alertsRes] = await Promise.all([
        _fetchJSON('/api/analytics/summary'),
        _fetchJSON('/api/analytics/alerts?limit=200'),
      ]);

      _summary = summary;
      _alerts  = alertsRes?.alerts || [];

      _renderKPIs();
      _renderCDMTimeline();
      _renderSatBarChart();
      _renderManeuverScatter();
      _renderAlertLog();

      // Fuel: load for selected sat (or first available)
      if (_selectedSat) {
        await _loadAndRenderFuel(_selectedSat);
      } else if (_satellites.length > 0) {
        _selectedSat = _satellites[0].id;
        _repopulateSatSelect();
        await _loadAndRenderFuel(_selectedSat);
      }

    } catch (err) {
      console.warn('[Analytics] Refresh failed:', err.message);
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }

  // Called from main.js handleDataUpdate — keeps sat list fresh
  function updateSatellites(satellites) {
    _satellites = satellites || [];
    _repopulateSatSelect();
  }

  // ── Tooltip helper ───────────────────────────────────────────────────────

  function _buildTooltip() {
    if (document.getElementById('analytics-tooltip')) return;
    const tt = document.createElement('div');
    tt.id = 'analytics-tooltip';
    document.body.appendChild(tt);
  }

  function _showTooltip(html, event) {
    const tt = document.getElementById('analytics-tooltip');
    if (!tt) return;
    tt.innerHTML = html;
    tt.classList.add('visible');
    _moveTooltip(event);
  }

  function _moveTooltip(event) {
    const tt = document.getElementById('analytics-tooltip');
    if (!tt) return;
    const x = event.clientX + 14;
    const y = event.clientY - 10;
    tt.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    tt.style.top  = Math.min(y, window.innerHeight - 120) + 'px';
  }

  function _hideTooltip() {
    const tt = document.getElementById('analytics-tooltip');
    if (tt) tt.classList.remove('visible');
  }

  // ── KPI Strip ────────────────────────────────────────────────────────────

  function _renderKPIs() {
    if (!_summary) return;
    const t = _summary.totals;

    const kpis = [
      { id: 'kpi-cdms',     label: 'Total CDMs',      value: t.cdms,                   sub: `${t.critical_cdms} critical`, color: 'kpi-red',    icon: 'alert-triangle' },
      { id: 'kpi-burns',    label: 'Maneuvers',        value: t.maneuvers,              sub: `${t.evasions} evasions`,      color: 'kpi-amber',  icon: 'zap' },
      { id: 'kpi-dv',       label: 'Total ΔV',         value: t.total_dv_ms.toFixed(1), sub: 'm/s',                         color: 'kpi-teal',   icon: 'activity' },
      { id: 'kpi-fuel',     label: 'Fuel Burned',      value: t.total_fuel_kg.toFixed(2), sub: 'kg across fleet',           color: 'kpi-green',  icon: 'fuel' },
      { id: 'kpi-alerts',   label: 'Mission Alerts',   value: t.alerts,                 sub: 'all time',                    color: 'kpi-purple', icon: 'bell' },
    ];

    const strip = document.getElementById('analytics-kpi-strip');
    if (!strip) return;

    strip.innerHTML = kpis.map(k => `
      <div class="analytics-kpi-card ${k.color}" id="${k.id}">
        <span class="kpi-label">${k.label}</span>
        <span class="kpi-value">${k.value}</span>
        <span class="kpi-sub">${k.sub}</span>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  }

  // ── CDM Timeline (Bar chart by hour bucket) ───────────────────────────────

  function _renderCDMTimeline() {
    const container = document.getElementById('analytics-cdm-chart');
    if (!container || !_summary) return;

    const rawData = _summary.cdm_over_time || [];
    if (!rawData.length) {
      container.innerHTML = _emptyState('database', 'No CDM history yet');
      return;
    }

    container.innerHTML = '<div class="analytics-svg-container"><svg id="cdm-timeline-svg"></svg></div>';
    const svg = d3.select('#cdm-timeline-svg');
    const rect = container.getBoundingClientRect();
    const W = rect.width  || 400;
    const H = rect.height || 180;
    const margin = { top: 10, right: 12, bottom: 30, left: 36 };
    const iW = W - margin.left - margin.right;
    const iH = H - margin.top  - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(rawData.map(d => d.hour_bucket))
      .range([0, iW])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(rawData, d => d.count) * 1.15])
      .range([iH, 0]);

    // Grid
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).tickSize(-iW).tickFormat('').ticks(4));

    // Bars
    g.selectAll('.cdm-bar')
      .data(rawData)
      .join('rect')
        .attr('class', d => d.min_miss < 0.1 ? 'cdm-bar critical' : 'cdm-bar')
        .attr('x',      d => x(d.hour_bucket))
        .attr('y',      d => y(d.count))
        .attr('width',  x.bandwidth())
        .attr('height', d => iH - y(d.count))
        .on('mouseover', (event, d) => {
          _showTooltip(`
            <div class="tt-title">${d.hour_bucket}Z</div>
            <div class="tt-row"><span class="tt-label">CDMs</span><span class="tt-val">${d.count}</span></div>
            <div class="tt-row"><span class="tt-label">Min Miss</span><span class="tt-val">${(d.min_miss * 1000).toFixed(1)} km</span></div>
          `, event);
        })
        .on('mousemove', _moveTooltip)
        .on('mouseout',  _hideTooltip);

    // Axes
    const tickCount = Math.max(1, Math.floor(iW / 80));
    const tickData  = rawData.filter((_, i) => i % Math.ceil(rawData.length / tickCount) === 0);

    g.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).tickValues(tickData.map(d => d.hour_bucket)).tickFormat(d => d.slice(8)))
      .select('.domain').remove();

    g.append('g')
      .attr('class', 'axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')))
      .select('.domain').remove();
  }

  // ── Per-Satellite Bar Chart ────────────────────────────────────────────────

  function _renderSatBarChart() {
    const container = document.getElementById('analytics-sat-bars');
    if (!container || !_summary) return;

    const perSat = _summary.per_satellite_cdms || [];
    if (!perSat.length) {
      container.innerHTML = _emptyState('satellite', 'No satellite data yet');
      return;
    }

    // Merge CDM + burn data
    const burnMap = {};
    (_summary.per_satellite_burns || []).forEach(b => {
      burnMap[b.satellite_id] = { burns: b.burn_count, dv: b.total_dv };
    });

    const data = perSat.map(s => ({
      id:    s.satellite_id,
      cdms:  s.cdm_count,
      burns: (burnMap[s.satellite_id]?.burns) || 0,
      dv:    (burnMap[s.satellite_id]?.dv)    || 0,
    })).slice(0, 10); // top 10

    container.innerHTML = '<div class="analytics-svg-container"><svg id="sat-bars-svg"></svg></div>';
    const svg = d3.select('#sat-bars-svg');
    const rect = container.getBoundingClientRect();
    const W = rect.width  || 300;
    const H = rect.height || 180;
    const margin = { top: 10, right: 12, bottom: 40, left: 36 };
    const iW = W - margin.left - margin.right;
    const iH = H - margin.top  - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const groups   = d3.scaleBand().domain(data.map(d => d.id)).range([0, iW]).padding(0.25);
    const subkeys  = ['cdms', 'burns'];
    const subBands = d3.scaleBand().domain(subkeys).range([0, groups.bandwidth()]).padding(0.05);
    const y        = d3.scaleLinear()
      .domain([0, d3.max(data, d => Math.max(d.cdms, d.burns)) * 1.2 || 1])
      .range([iH, 0]);

    const colors = { cdms: '#58a6ff', burns: '#d29922' };

    // Grid
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).tickSize(-iW).tickFormat('').ticks(4));

    // Grouped bars
    data.forEach(d => {
      subkeys.forEach(key => {
        g.append('rect')
          .attr('class', `sat-bar-${key}`)
          .attr('x',      groups(d.id) + subBands(key))
          .attr('y',      y(d[key]))
          .attr('width',  subBands.bandwidth())
          .attr('height', iH - y(d[key]))
          .on('mouseover', (event) => {
            _showTooltip(`
              <div class="tt-title">${d.id}</div>
              <div class="tt-row"><span class="tt-label">CDMs</span><span class="tt-val">${d.cdms}</span></div>
              <div class="tt-row"><span class="tt-label">Burns</span><span class="tt-val">${d.burns}</span></div>
              <div class="tt-row"><span class="tt-label">ΔV</span><span class="tt-val">${(d.dv || 0).toFixed(1)} m/s</span></div>
            `, event);
          })
          .on('mousemove', _moveTooltip)
          .on('mouseout',  _hideTooltip);
      });
    });

    // Axes
    g.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(groups).tickFormat(d => d.replace(/^SAT-/, '')))
      .select('.domain').remove();

    g.append('g')
      .attr('class', 'axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')))
      .select('.domain').remove();

    // Legend
    const legend = g.append('g').attr('transform', `translate(0,${iH + 26})`);
    const items = [
      { label: 'CDMs',  color: colors.cdms  },
      { label: 'Burns', color: colors.burns  },
    ];
    items.forEach((item, i) => {
      const lg = legend.append('g').attr('transform', `translate(${i * 70}, 0)`);
      lg.append('rect').attr('width', 8).attr('height', 8).attr('fill', item.color).attr('y', -8);
      lg.append('text').attr('x', 12).attr('y', 0)
        .attr('fill', '#6e7681').attr('font-size', 9).text(item.label);
    });
  }

  // ── Maneuver Scatter (ΔV vs fuel cost) ─────────────────────────────────

  async function _renderManeuverScatter() {
    const container = document.getElementById('analytics-scatter');
    if (!container) return;

    let maneuvers = [];
    try {
      const res = await _fetchJSON('/api/analytics/maneuvers?limit=500');
      maneuvers = res?.maneuvers || [];
    } catch { /* ignore */ }

    if (!maneuvers.length) {
      container.innerHTML = _emptyState('scatter-chart', 'No maneuver data yet');
      return;
    }

    container.innerHTML = '<div class="analytics-svg-container"><svg id="maneuver-scatter-svg"></svg></div>';
    const svg = d3.select('#maneuver-scatter-svg');
    const rect = container.getBoundingClientRect();
    const W = rect.width  || 300;
    const H = rect.height || 180;
    const margin = { top: 10, right: 12, bottom: 30, left: 40 };
    const iW = W - margin.left - margin.right;
    const iH = H - margin.top  - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([0, d3.max(maneuvers, d => d.dv_ms) * 1.1 || 1])
      .range([0, iW]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(maneuvers, d => d.fuel_cost_kg) * 1.15 || 0.1])
      .range([iH, 0]);

    // Build satellite colour map
    const satIds    = [...new Set(maneuvers.map(d => d.satellite_id))];
    const colorMap  = {};
    satIds.forEach((id, i) => colorMap[id] = SAT_COLORS[i % SAT_COLORS.length]);

    // Grid
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).tickSize(-iW).tickFormat('').ticks(4));

    // Dots
    g.selectAll('.maneuver-dot')
      .data(maneuvers)
      .join('circle')
        .attr('class', 'maneuver-dot')
        .attr('cx', d => x(d.dv_ms))
        .attr('cy', d => y(d.fuel_cost_kg))
        .attr('r',  4)
        .attr('fill', d => colorMap[d.satellite_id] || '#58a6ff')
        .on('mouseover', (event, d) => {
          _showTooltip(`
            <div class="tt-title">${d.satellite_id}</div>
            <div class="tt-row"><span class="tt-label">Type</span><span class="tt-val">${d.burn_type}</span></div>
            <div class="tt-row"><span class="tt-label">ΔV</span><span class="tt-val">${d.dv_ms.toFixed(2)} m/s</span></div>
            <div class="tt-row"><span class="tt-label">Fuel</span><span class="tt-val">${d.fuel_cost_kg.toFixed(4)} kg</span></div>
            <div class="tt-row"><span class="tt-label">Strategy</span><span class="tt-val">${d.strategy || '—'}</span></div>
          `, event);
        })
        .on('mousemove', _moveTooltip)
        .on('mouseout',  _hideTooltip);

    // Axes
    g.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d => d.toFixed(1)))
      .select('.domain').remove();

    g.append('g')
      .attr('class', 'axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d => d.toFixed(3)))
      .select('.domain').remove();

    // Axis labels
    g.append('text')
      .attr('x', iW / 2).attr('y', iH + 28)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6e7681').attr('font-size', 8)
      .text('ΔV (m/s)');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -iH / 2).attr('y', -30)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6e7681').attr('font-size', 8)
      .text('Fuel (kg)');
  }

  // ── Fuel Depletion Timeline ───────────────────────────────────────────────

  async function _loadAndRenderFuel(satId) {
    const container = document.getElementById('analytics-fuel-chart');
    if (!container || !satId) return;

    container.innerHTML = _loadingState();

    try {
      const res = await _fetchJSON(`/api/analytics/fuel/${satId}?limit=500`);
      const data = res?.fuel_timeline || [];
      _fuelData[satId] = data;
      _renderFuelChart(satId, data, container);
    } catch {
      container.innerHTML = _emptyState('fuel', 'No fuel data');
    }
  }

  function _renderFuelChart(satId, data, container) {
    if (!data || !data.length) {
      container.innerHTML = _emptyState('fuel', 'No fuel snapshots yet');
      return;
    }

    container.innerHTML = '<div class="analytics-svg-container"><svg id="fuel-line-svg"></svg></div>';
    const svg = d3.select('#fuel-line-svg');
    const rect = container.getBoundingClientRect();
    const W = rect.width  || 340;
    const H = rect.height || 180;
    const margin = { top: 10, right: 12, bottom: 30, left: 44 };
    const iW = W - margin.left - margin.right;
    const iH = H - margin.top  - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const parseTime = d3.isoParse || (s => new Date(s));
    const times  = data.map(d => new Date(d.t));
    const fuels  = data.map(d => +d.fuel_kg);

    const x = d3.scaleTime().domain(d3.extent(times)).range([0, iW]);
    const y = d3.scaleLinear().domain([0, d3.max(fuels) * 1.1 || 1]).range([iH, 0]);

    const color = SAT_COLORS[_satellites.findIndex(s => s.id === satId) % SAT_COLORS.length] || '#3fb950';

    // Area
    const area = d3.area()
      .x((_, i) => x(times[i]))
      .y0(iH)
      .y1((d) => y(+d.fuel_kg))
      .curve(d3.curveCatmullRom);

    g.append('path')
      .datum(data)
      .attr('class', 'fuel-area')
      .attr('d', area)
      .attr('fill', color);

    // Line
    const line = d3.line()
      .x((_, i) => x(times[i]))
      .y((d) => y(+d.fuel_kg))
      .curve(d3.curveCatmullRom);

    // Grid
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).tickSize(-iW).tickFormat('').ticks(4));

    g.append('path')
      .datum(data)
      .attr('class', 'fuel-line')
      .attr('d', line)
      .attr('stroke', color);

    // Hover overlay
    const bisect = d3.bisectLeft;
    const overlay = g.append('rect')
      .attr('width', iW).attr('height', iH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair');

    const vLine = g.append('line')
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke', '#6e7681').attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('display', 'none');

    overlay
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const xDate = x.invert(mx);
        const idx   = Math.min(bisect(times, xDate), data.length - 1);
        const d     = data[idx];
        if (!d) return;
        vLine.style('display', null).attr('x1', x(times[idx])).attr('x2', x(times[idx]));
        _showTooltip(`
          <div class="tt-title">${satId}</div>
          <div class="tt-row"><span class="tt-label">Fuel</span><span class="tt-val">${(+d.fuel_kg).toFixed(2)} kg</span></div>
          <div class="tt-row"><span class="tt-label">Time</span><span class="tt-val">${new Date(d.t).toISOString().slice(11,19)}Z</span></div>
        `, event);
      })
      .on('mouseout', () => {
        vLine.style('display', 'none');
        _hideTooltip();
      });

    // Axes
    g.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(4).tickFormat(d3.timeFormat('%H:%M')))
      .select('.domain').remove();

    g.append('g')
      .attr('class', 'axis')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d => d.toFixed(1)))
      .select('.domain').remove();
  }

  // ── Alert Log ─────────────────────────────────────────────────────────────

  function _renderAlertLog() {
    const container = document.getElementById('analytics-alert-log');
    if (!container) return;

    if (!_alerts.length) {
      container.innerHTML = _emptyState('bell-off', 'No alerts recorded');
      return;
    }

    container.innerHTML = _alerts.slice(0, 100).map(a => {
      const t = new Date(a.recorded_at).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
      return `
        <div class="analytics-alert-item level-${a.level}">
          <span class="analytics-alert-time">${t}</span>
          <span class="analytics-alert-msg">${a.message}</span>
          ${a.satellite_id ? `<span class="analytics-alert-sat">${a.satellite_id}</span>` : ''}
        </div>`;
    }).join('');
  }

  // ── Satellite selector ────────────────────────────────────────────────────

  function _repopulateSatSelect() {
    const sel = document.getElementById('analytics-sat-select');
    if (!sel || !_satellites.length) return;
    const current = sel.value || _selectedSat;
    sel.innerHTML = _satellites.map(s =>
      `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.id}</option>`
    ).join('');
    if (!_selectedSat && _satellites.length) {
      _selectedSat = _satellites[0].id;
      sel.value    = _selectedSat;
    }
  }

  function _bindSatSelect() {
    document.addEventListener('change', async (e) => {
      if (e.target.id !== 'analytics-sat-select') return;
      _selectedSat = e.target.value;
      await _loadAndRenderFuel(_selectedSat);
    });
  }

  function _bindRefreshBtn() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('#analytics-refresh-btn')) refresh();
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function _fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function _emptyState(icon, msg) {
    return `<div class="analytics-empty">
      <i data-lucide="${icon}"></i>
      <p>${msg}</p>
    </div>`;
  }

  function _loadingState() {
    return `<div class="analytics-loading">
      <div class="analytics-spinner"></div>
      <span>Loading…</span>
    </div>`;
  }

  // ── Resize ───────────────────────────────────────────────────────────────

  function resize() {
    if (!_summary) return;
    _renderCDMTimeline();
    _renderSatBarChart();
    _renderManeuverScatter();
    if (_selectedSat && _fuelData[_selectedSat]) {
      const container = document.getElementById('analytics-fuel-chart');
      if (container) _renderFuelChart(_selectedSat, _fuelData[_selectedSat], container);
    }
  }

  // ── Public ───────────────────────────────────────────────────────────────
  return { init, refresh, resize, updateSatellites };
})();
