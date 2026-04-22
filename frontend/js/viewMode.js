/* ═══════════════════════════════════════════════════════════════════════════
   NEXUS — View Mode Switcher
   Handles switching between Projection and Charts modes
   ═══════════════════════════════════════════════════════════════════════════ */

const ViewMode = (() => {
  let currentMode = 'projection';
  
  function init() {
    const projectionBtn = document.getElementById('mode-projection');
    const chartsBtn = document.getElementById('mode-charts');
    
    if (projectionBtn) {
      projectionBtn.addEventListener('click', () => switchMode('projection'));
    }
    
    if (chartsBtn) {
      chartsBtn.addEventListener('click', () => switchMode('charts'));
    }

    const analyticsBtn = document.getElementById('mode-analytics');
    if (analyticsBtn) {
      analyticsBtn.addEventListener('click', () => switchMode('analytics'));
    }
    
    // Initialize lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }
  
  function switchMode(mode) {
    if (mode === currentMode) return;
    
    const projectionView  = document.getElementById('projection-view');
    const chartsView      = document.getElementById('charts-view');
    const analyticsView   = document.getElementById('analytics-view');
    const projectionBtn   = document.getElementById('mode-projection');
    const chartsBtn       = document.getElementById('mode-charts');
    const analyticsBtn    = document.getElementById('mode-analytics');
    const modeDisplay     = document.getElementById('current-mode-display');
    
    // Hide all views, deactivate all buttons
    [projectionView, chartsView, analyticsView].forEach(v => v?.classList.remove('active'));
    [projectionBtn, chartsBtn, analyticsBtn].forEach(b => b?.classList.remove('active'));

    if (mode === 'projection') {
      projectionView?.classList.add('active');
      projectionBtn?.classList.add('active');
    } else if (mode === 'charts') {
      chartsView?.classList.add('active');
      chartsBtn?.classList.add('active');
    } else if (mode === 'analytics') {
      analyticsView?.classList.add('active');
      analyticsBtn?.classList.add('active');
    }
    
    // Update mode display
    if (modeDisplay) {
      modeDisplay.textContent = mode.toUpperCase();
    }
    
    // Trigger resize events for charts
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      
      if (mode === 'charts' && typeof Bullseye !== 'undefined') Bullseye.resize();
      if (typeof Gantt !== 'undefined') Gantt.resize();
      if (typeof Telemetry !== 'undefined') Telemetry.init();
      if (typeof Fuel !== 'undefined') Fuel.init();
      if (mode === 'analytics' && typeof Analytics !== 'undefined') Analytics.resize();
    }, 100);
    
    currentMode = mode;
    
    // Emit event for other modules
    if (typeof emit !== 'undefined') {
      emit('view-mode-changed', mode);
    }
  }
  
  function getCurrentMode() {
    return currentMode;
  }
  
  return { init, switchMode, getCurrentMode };
})();
