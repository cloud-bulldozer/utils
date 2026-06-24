export function createSidebar(container, store, derived) {
  let lastDerived = derived;

  function render(state) {
    const d = lastDerived;
    const versionCounts = {};
    for (const job of (d.filteredJobs || [])) {
      versionCounts[job.version] = (versionCounts[job.version] || 0) + 1;
    }

    const items = (state.versions || [])
      .filter(v => state.activeVersions.has(v))
      .map(v => {
        const count = versionCounts[v] || 0;
        const label = v === 'other' ? 'Other' : `OCP ${v}`;
        return `<div class="sidebar-item" data-version="${v}">
          <span>${label}</span>
          <span class="sidebar-count">${count}</span>
        </div>`;
      }).join('');

    const totalFiltered = d.filteredJobs?.length || 0;
    const totalConflicts = d.conflicts?.length || 0;

    container.innerHTML = `
      <div class="sidebar-title">Versions</div>
      ${items}
      <div class="sidebar-summary">
        ${totalFiltered} jobs shown<br>
        ${totalConflicts} conflict${totalConflicts !== 1 ? 's' : ''} detected
      </div>
    `;

    container.querySelectorAll('.sidebar-item').forEach(el => {
      el.onclick = () => {
        const target = document.querySelector(`.version-group[data-version="${el.dataset.version}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }

  return {
    update(state, newDerived) {
      lastDerived = newDerived;
      render(state);
    },
    init() {
      render(store.get());
    },
  };
}
