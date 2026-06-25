const PAGE_SIZE = 5;

export function createConflicts(banner, store) {
  let expanded = false;
  let expandedRow = null;
  let page = 0;
  let lastConflicts = null;

  function render(conflicts, thresholds, timezone) {
    if (conflicts !== lastConflicts) {
      page = 0;
      expandedRow = null;
      lastConflicts = conflicts;
    }
    const useLocal = timezone !== 'UTC';
    if (!conflicts || conflicts.length === 0) {
      banner.innerHTML = `<div class="conflicts-banner safe">
        <div class="conflicts-summary">
          <span class="conflicts-icon">&#10003;</span>
          <span>No scheduling conflicts detected</span>
        </div>
      </div>`;
      return;
    }

    const totalConflicts = conflicts.length;
    const peakMax = Math.max(...conflicts.map(c => c.peak));
    const severityLabel = peakMax >= thresholds.danger ? 'Critical' : 'Warning';
    const severityClass = peakMax >= thresholds.danger ? 'danger' : 'warn';

    let html = `<div class="conflicts-banner ${severityClass}">
      <div class="conflicts-summary" id="conflicts-toggle">
        <span class="conflicts-icon">&#9888;</span>
        <span class="conflicts-text">
          <strong>${totalConflicts} scheduling conflict${totalConflicts > 1 ? 's' : ''}</strong>
          <span class="conflicts-severity">&middot; ${severityLabel} &middot; Peak: ${peakMax} concurrent</span>
        </span>
        <span class="conflicts-expand-hint">${expanded ? 'Hide' : 'Show details'} &#9660;</span>
      </div>`;

    if (expanded) {
      const totalPages = Math.ceil(totalConflicts / PAGE_SIZE);
      const start = page * PAGE_SIZE;
      const pageItems = conflicts.slice(start, start + PAGE_SIZE);

      html += `<div class="conflicts-table">
        <div class="conflicts-table-header">
          <div class="ct-col ct-rank">#</div>
          <div class="ct-col ct-time">Time Pattern</div>
          <div class="ct-col ct-peak">Peak</div>
          <div class="ct-col ct-freq">Frequency</div>
          <div class="ct-col ct-jobs">Jobs</div>
        </div>`;

      for (let i = 0; i < pageItems.length; i++) {
        const c = pageItems[i];
        const rank = start + i + 1;
        const rowExpanded = expandedRow === rank;
        const level = c.peak >= thresholds.danger ? 'danger' : 'warn';
        const freqLabel = c.frequency > 1 ? `${c.frequency}x` : 'Once';

        html += `<div class="conflicts-row ${level}" data-rank="${rank}">
          <div class="ct-col ct-rank">
            <span class="ct-rank-num">${rank}</span>
          </div>
          <div class="ct-col ct-time">
            <span class="ct-time-label">${escHtml(c.label)}</span>
          </div>
          <div class="ct-col ct-peak">
            <span class="ct-peak-badge ct-${level}">${c.peak}</span>
          </div>
          <div class="ct-col ct-freq">${freqLabel}</div>
          <div class="ct-col ct-jobs">
            <span class="ct-jobs-count">${c.jobs.length} job${c.jobs.length > 1 ? 's' : ''}</span>
            <span class="ct-expand-btn">${rowExpanded ? '&#9650;' : '&#9660;'}</span>
          </div>
        </div>`;

        if (rowExpanded) {
          html += `<div class="conflicts-job-list">`;
          for (const j of c.jobs) {
            html += `<div class="ct-job-item">&bull; ${escHtml(j)}</div>`;
          }
          if (c.occurrences && c.occurrences.length > 0) {
            html += `<div class="ct-occ-header">Occurrences:</div>`;
            for (const occ of c.occurrences.slice(0, 5)) {
              html += `<div class="ct-occ-item">${formatOccTime(occ.start, useLocal)} – ${formatOccTime(occ.end, useLocal)} (peak: ${occ.peak})</div>`;
            }
            if (c.occurrences.length > 5) {
              html += `<div class="ct-occ-more">+${c.occurrences.length - 5} more</div>`;
            }
          }
          html += `</div>`;
        }
      }

      html += `</div>`;

      if (totalPages > 1) {
        html += `<div class="conflicts-pagination">
          <button class="ct-page-btn" data-dir="prev" ${page === 0 ? 'disabled' : ''}>&laquo; Prev</button>
          <span class="ct-page-info">Page ${page + 1} of ${totalPages}</span>
          <button class="ct-page-btn" data-dir="next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next &raquo;</button>
        </div>`;
      }
    }

    html += `</div>`;
    banner.innerHTML = html;

    banner.querySelector('#conflicts-toggle')?.addEventListener('click', () => {
      expanded = !expanded;
      if (!expanded) { expandedRow = null; page = 0; }
      render(conflicts, thresholds, timezone);
    });

    banner.querySelectorAll('.conflicts-row').forEach(row => {
      row.addEventListener('click', () => {
        const rank = parseInt(row.dataset.rank);
        expandedRow = expandedRow === rank ? null : rank;
        render(conflicts, thresholds, timezone);
      });
    });

    banner.querySelectorAll('.ct-page-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.dir === 'prev' && page > 0) page--;
        else if (btn.dataset.dir === 'next') page++;
        expandedRow = null;
        render(conflicts, thresholds, timezone);
      });
    });
  }

  return { update: render };
}

function formatOccTime(date, useLocal) {
  return date.toLocaleDateString('en-US', {
    timeZone: useLocal ? undefined : 'UTC', weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
