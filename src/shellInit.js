// Shell init — tab switching, sidebar toggle, sidebar resize.
// Extracted from inline <script> in index.html so the renderer can run
// under a strict CSP without `script-src 'unsafe-inline'`.
(function () {
  const app = document.getElementById('app');
  const tabs = document.querySelectorAll('#tab-bar .tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  const drawerTitle = document.getElementById('drawer-title');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const titles = {
    nodes: 'Nodes',
    map: 'Map Layers',
    coverage: 'Coverage',
    planning: 'Planning',
    settings: 'Settings',
  };
  const resizeMapSoon = () => {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
  };

  function selectTab(btn) {
    tabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    panels.forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    drawerTitle.textContent = titles[btn.dataset.tab] || btn.textContent.trim();
  }

  tabs.forEach(btn => {
    btn.addEventListener('click', () => selectTab(btn));
  });

  toggleBtn.addEventListener('click', () => {
    const collapsed = app.classList.toggle('sidebar-collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    toggleBtn.textContent = collapsed ? 'Show Panel' : 'Hide Panel';
    resizeMapSoon();
  });
})();

(function () {
  const handle = document.getElementById('sidebar-resizer');
  const app = document.getElementById('app');
  const storageKey = 'meshcoreMapper_sidebarWidth';
  const savedWidth = parseInt(localStorage.getItem(storageKey), 10);
  if (Number.isFinite(savedWidth)) {
    app.style.setProperty('--sidebar-w', Math.max(280, Math.min(620, savedWidth)) + 'px');
  }
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('mousedown', e => {
    if (app.classList.contains('sidebar-collapsed')) return;
    dragging = true; startX = e.clientX;
    startW = parseInt(getComputedStyle(app).getPropertyValue('--sidebar-w'), 10);
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.max(280, Math.min(620, startW + (e.clientX - startX)));
    app.style.setProperty('--sidebar-w', w + 'px');
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(storageKey, parseInt(getComputedStyle(app).getPropertyValue('--sidebar-w'), 10));
  });
})();
