// Shell init: tab switching, sidebar toggle, sidebar resize.
// Extracted from inline <script> in index.html so the renderer can run
// under a strict CSP without `script-src 'unsafe-inline'`.
(function () {
  const app = document.getElementById('app');
  if (!app) return;

  const tabs = document.querySelectorAll<HTMLElement>('#tab-bar .tab-btn');
  const panels = document.querySelectorAll<HTMLElement>('.tab-panel');
  const drawerTitleEl = document.getElementById('drawer-title');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  if (!drawerTitleEl || !toggleBtn) return;
  const drawerTitle = drawerTitleEl;

  const titles: Record<string, string> = {
    nodes: 'Nodes',
    map: 'Map Layers',
    coverage: 'Coverage',
    planning: 'Planning',
    settings: 'Settings',
  };
  const resizeMapSoon = (): void => {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
  };

  function selectTab(btn: HTMLElement): void {
    tabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    panels.forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const tabKey = btn.dataset.tab ?? '';
    document.getElementById('tab-' + tabKey)?.classList.remove('hidden');
    drawerTitle.textContent = titles[tabKey] || (btn.textContent ?? '').trim();
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
  if (!handle || !app) return;

  const storageKey = 'meshcoreMapper_sidebarWidth';
  const savedWidth = parseInt(localStorage.getItem(storageKey) ?? '', 10);
  if (Number.isFinite(savedWidth)) {
    app.style.setProperty('--sidebar-w', Math.max(280, Math.min(620, savedWidth)) + 'px');
  }

  let dragging = false;
  let startX = 0;
  let startW = 0;
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (app.classList.contains('sidebar-collapsed')) return;
    dragging = true;
    startX = e.clientX;
    startW = parseInt(getComputedStyle(app).getPropertyValue('--sidebar-w'), 10);
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
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
    localStorage.setItem(storageKey, String(parseInt(getComputedStyle(app).getPropertyValue('--sidebar-w'), 10)));
  });
})();
