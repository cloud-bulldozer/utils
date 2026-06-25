const DATE_RANGES = [
  { key: '24h', label: '24h' },
  { key: '7d',  label: '7 days' },
  { key: '1mo', label: '1 month' },
  { key: '3mo', label: '3 months' },
  { key: '6mo', label: '6 months' },
  { key: '1yr', label: '1 year' },
];

export function createToolbar(container, store) {
  function render(state) {
    const searchInput = container.querySelector('.search-box input');
    const wasSearchFocused = searchInput && document.activeElement === searchInput;
    const cursorPos = wasSearchFocused ? searchInput.selectionStart : null;

    const rangePills = DATE_RANGES.map(r =>
      `<button class="pill${state.dateRange === r.key ? ' active' : ''}" data-range="${r.key}">${r.label}</button>`
    ).join('');

    const versionPills = (state.versions || []).map(v => {
      const count = (state.jobs || []).filter(j => j.version === v).length;
      const active = state.activeVersions.has(v);
      return `<button class="pill${active ? ' active' : ''}" data-version="${v}">
        ${v === 'other' ? 'Other' : v}<span class="count">(${count})</span>
      </button>`;
    }).join('');

    const allActive = state.versions?.length === state.activeVersions.size;

    container.innerHTML = `
      <div class="toolbar-row">
        <span class="toolbar-label">Range</span>
        <div class="pill-group">${rangePills}</div>
        <div class="search-box${state.searchQuery ? ' has-query' : ''}">
          <span class="search-icon">&#x1F50D;</span>
          <input type="text" placeholder="Search jobs..." value="${escHtml(state.searchQuery || '')}">
          <button class="search-clear">&times;</button>
        </div>
      </div>
      <div class="toolbar-row">
        <span class="toolbar-label">Version</span>
        <button class="version-toggle-all" data-action="${allActive ? 'none' : 'all'}">
          ${allActive ? 'Deselect all' : 'Select all'}
        </button>
        <div class="pill-group">${versionPills}</div>
      </div>
    `;

    container.querySelectorAll('[data-range]').forEach(btn => {
      btn.onclick = () => store.set({ dateRange: btn.dataset.range });
    });

    container.querySelectorAll('[data-version]').forEach(btn => {
      btn.onclick = () => {
        const vers = new Set(state.activeVersions);
        const v = btn.dataset.version;
        if (vers.has(v)) vers.delete(v); else vers.add(v);
        store.set({ activeVersions: vers });
      };
    });

    container.querySelector('.version-toggle-all').onclick = (e) => {
      const action = e.currentTarget.dataset.action;
      store.set({
        activeVersions: action === 'all'
          ? new Set(state.versions)
          : new Set(),
      });
    };

    const input = container.querySelector('.search-box input');
    input.oninput = () => store.set({ searchQuery: input.value });
    container.querySelector('.search-clear').onclick = () => {
      store.set({ searchQuery: '' });
    };

    if (wasSearchFocused && input) {
      input.focus();
      if (cursorPos !== null) input.setSelectionRange(cursorPos, cursorPos);
    }
  }

  store.subscribe(render);
  render(store.get());
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
