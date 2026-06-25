import cronstrue from 'cronstrue';
import { computeRunTimes } from '../cron.js';

export function createJobDetail(container, store) {
  function render(state) {
    const job = state.selectedJob;
    if (!job) {
      container.classList.add('hidden');
      return;
    }
    container.classList.remove('hidden');

    let humanCron = '';
    try {
      humanCron = cronstrue.toString(job.cron, { use24HourTimeFormat: true });
    } catch {
      humanCron = job.cron;
    }

    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + 90);
    const nextRuns = computeRunTimes(job.cron, now, future).slice(0, 5);

    const useLocal = state.timezone !== 'UTC';
    const tzOpts = { timeZone: useLocal ? undefined : 'UTC' };
    const runItems = nextRuns.map(d =>
      `<li>${d.toLocaleString('en-US', {
        ...tzOpts, weekday: 'short', year: 'numeric', month: 'short',
        day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })} ${useLocal ? '' : 'UTC'}</li>`
    ).join('');

    container.innerHTML = `
      <button class="popover-close">&times;</button>
      <div class="popover-name">${escHtml(job.short_name)}</div>
      <div class="popover-full-name">${escHtml(job.name)}</div>
      <div class="popover-field">
        <span class="popover-field-label">Schedule</span>
        <span class="popover-field-value"><code>${escHtml(job.cron)}</code></span>
      </div>
      <div class="popover-field">
        <span class="popover-field-label">Meaning</span>
        <span class="popover-field-value">${escHtml(humanCron)}</span>
      </div>
      <div class="popover-field">
        <span class="popover-field-label">Version</span>
        <span class="popover-field-value"><span class="version-badge">OCP ${escHtml(job.version)}</span></span>
      </div>
      <div class="popover-field" style="align-items:flex-start">
        <span class="popover-field-label">Next runs</span>
        <ul class="next-runs-list">${runItems || '<li>No upcoming runs</li>'}</ul>
      </div>
    `;

    container.querySelector('.popover-close').onclick = () => {
      store.set({ selectedJob: null });
    };

    positionPopover(container);
  }

  document.addEventListener('click', (e) => {
    if (store.get().selectedJob && !container.contains(e.target) && !e.target.closest('.job-name-cell')) {
      store.set({ selectedJob: null });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.get().selectedJob) {
      store.set({ selectedJob: null });
    }
  });

  store.subscribe(render);
  render(store.get());
}

function positionPopover(el) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const top = Math.max(10, Math.min(vh / 2 - rect.height / 2, vh - rect.height - 10));
  const left = Math.max(10, Math.min(vw / 2 - rect.width / 2, vw - rect.width - 10));

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
