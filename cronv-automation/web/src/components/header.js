export function createHeader(container, store) {
  function render(state) {
    const age = state.generatedAt
      ? formatAge(new Date(state.generatedAt))
      : '—';

    container.innerHTML = `
      <div class="header-left">
        <div class="header-logo">PS</div>
        <span class="header-title">PerfScale CI Schedule</span>
        <span class="header-subtitle">${state.totalJobs || 0} periodic jobs</span>
      </div>
      <div class="header-right">
        <span class="header-badge"><span class="dot"></span> Data: ${age}</span>
        <div class="tz-segmented">
          <button class="tz-option${state.timezone === 'UTC' ? ' active' : ''}" data-tz="UTC">UTC</button>
          <button class="tz-option${state.timezone !== 'UTC' ? ' active' : ''}" data-tz="local">Local</button>
        </div>
      </div>
    `;

    container.querySelectorAll('.tz-option').forEach(btn => {
      btn.onclick = () => store.set({ timezone: btn.dataset.tz });
    });
  }

  store.subscribe(render);
  render(store.get());

  setInterval(() => render(store.get()), 60_000);
}

function formatAge(date) {
  const diffMs = Date.now() - date.getTime();
  if (isNaN(diffMs)) return 'unknown';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
