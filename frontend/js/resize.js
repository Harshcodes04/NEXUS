/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS — resize.js
   Initialises Split.js on all panel boundaries so every panel is
   drag-resizable. Handles view-mode changes and window resize.
   ═══════════════════════════════════════════════════════════════════════════ */

const ResizeManager = (() => {
  'use strict';

  const splits = [];   // active Split instances

  // ── Defaults ──────────────────────────────────────────────────────────────
  const GUTTER_SIZE = 5;
  const SNAP_OFFSET = 40;  // px before snapping to edge

  function _gutter(size, direction) {
    const g = document.createElement('div');
    g.className = `gutter gutter-${direction}`;
    return g;
  }

  // ── Init all splits ───────────────────────────────────────────────────────
  function init() {
    if (typeof Split === 'undefined') {
      console.warn('[Resize] Split.js not loaded — panels will not be resizable.');
      return;
    }

    _initChartsHorizontal();   // charts-spec ↔ extras-sidebar
    _initChartRow1();          // bullseye ↔ fuel
    _initChartRow2();          // gantt ↔ telemetry
    _initMainVertical();       // chart-row-1 ↔ chart-row-2

    // Re-notify D3/canvas on drag end
    splits.forEach(sp => {
      if (sp && sp.onDragEnd) {
        sp.onDragEnd(() => _notifyResize());
      }
    });

    window.addEventListener('resize', _notifyResize);
  }

  // charts-spec (main 4 panels) ↔ extras-sidebar (horizontal)
  function _initChartsHorizontal() {
    const left  = document.getElementById('charts-spec');
    const right = document.getElementById('extras-sidebar');
    if (!left || !right) return;

    // Remove the fixed width on extras-sidebar so Split.js can control it
    right.style.width   = '';
    right.style.flexShrink = '';

    const sp = Split([left, right], {
      sizes:      [75, 25],
      minSize:    [300, 200],
      gutterSize: GUTTER_SIZE,
      snapOffset: SNAP_OFFSET,
      direction:  'horizontal',
      gutter:     _gutter,
      onDragEnd:  _notifyResize,
    });
    splits.push(sp);
  }

  // chart-row-1: bullseye ↔ fuel (horizontal)
  function _initChartRow1() {
    const row = document.getElementById('chart-row-1');
    if (!row) return;
    const panels = row.querySelectorAll(':scope > .panel');
    if (panels.length < 2) return;

    const sp = Split(Array.from(panels), {
      sizes:      [60, 40],
      minSize:    [200, 160],
      gutterSize: GUTTER_SIZE,
      snapOffset: SNAP_OFFSET,
      direction:  'horizontal',
      gutter:     _gutter,
      onDragEnd:  _notifyResize,
    });
    splits.push(sp);
  }

  // chart-row-2: gantt ↔ telemetry (horizontal)
  function _initChartRow2() {
    const row = document.getElementById('chart-row-2');
    if (!row) return;
    const panels = row.querySelectorAll(':scope > .panel');
    if (panels.length < 2) return;

    const sp = Split(Array.from(panels), {
      sizes:      [60, 40],
      minSize:    [200, 180],
      gutterSize: GUTTER_SIZE,
      snapOffset: SNAP_OFFSET,
      direction:  'horizontal',
      gutter:     _gutter,
      onDragEnd:  _notifyResize,
    });
    splits.push(sp);
  }

  // chart-row-1 ↔ chart-row-2 (vertical split inside charts-spec)
  function _initMainVertical() {
    const spec = document.getElementById('charts-spec');
    if (!spec) return;
    const rows = [
      document.getElementById('chart-row-1'),
      document.getElementById('chart-row-2'),
    ];
    if (!rows[0] || !rows[1]) return;

    // Remove flex: 1 inline style so Split.js controls heights via %
    rows[0].style.flex = '';
    rows[1].style.flex = '';

    // Split.js needs the parent to be flex column
    spec.style.display       = 'flex';
    spec.style.flexDirection = 'column';
    spec.style.height        = '100%';

    const sp = Split(rows, {
      sizes:      [50, 50],
      minSize:    [120, 120],
      gutterSize: GUTTER_SIZE,
      snapOffset: SNAP_OFFSET,
      direction:  'vertical',
      gutter:     _gutter,
      onDragEnd:  _notifyResize,
    });
    splits.push(sp);
  }

  // ── Notify all D3 + canvas renderers to resize ────────────────────────────
  function _notifyResize() {
    // Ground track
    if (typeof GroundTrack !== 'undefined' && GroundTrack.resize) {
      GroundTrack.resize();
    }
    // Bullseye
    if (typeof Bullseye !== 'undefined' && Bullseye.resize) {
      Bullseye.resize();
    }
    // Gantt
    if (typeof Gantt !== 'undefined' && Gantt.resize) {
      Gantt.resize();
    }
    // Heatmap
    if (typeof Heatmap !== 'undefined' && Heatmap.refresh) {
      Heatmap.refresh();
    }
    // Analytics charts
    if (typeof Analytics !== 'undefined' && Analytics.resize) {
      Analytics.resize();
    }
    // Dispatch generic event so any module can listen
    window.dispatchEvent(new Event('nexus-resize'));
  }

  // Call this when switching view modes
  function onViewChange(mode) {
    setTimeout(_notifyResize, 50);
  }

  return { init, onViewChange, notifyResize: _notifyResize };
})();
