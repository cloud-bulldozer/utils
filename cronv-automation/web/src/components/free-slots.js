export function createFreeSlots(container) {
  let expandedIdx = null;
  let lastFreeSlots = null;

  function render(freeSlots, timezone) {
    if (freeSlots !== lastFreeSlots) {
      expandedIdx = null;
      lastFreeSlots = freeSlots;
    }
    const useLocal = timezone !== 'UTC';
    if (!freeSlots || freeSlots.length === 0) {
      container.innerHTML = `<div class="free-slots-panel">
        <div class="free-header">
          <span class="free-icon">&#9679;</span>
          <span>No significant free slots found</span>
        </div>
      </div>`;
      return;
    }

    let html = `<div class="free-slots-panel">
      <div class="free-header">
        <span class="free-icon">&#9679;</span>
        <span class="free-title">Available Scheduling Windows</span>
        <span class="free-badge">${freeSlots.length} found</span>
      </div>
      <div class="free-body">`;

    for (let i = 0; i < freeSlots.length; i++) {
      const slot = freeSlots[i];
      const isExpanded = expandedIdx === i;
      const conLabel = slot.maxConcurrency === 0 ? 'Empty' : `${slot.maxConcurrency} job${slot.maxConcurrency > 1 ? 's' : ''}`;
      const freqLabel = slot.frequency > 1 ? `${slot.frequency}x in range` : 'Once';

      html += `<div class="free-card ${isExpanded ? 'expanded' : ''}" data-idx="${i}">
        <div class="free-card-header">
          <div class="free-card-left">
            <span class="free-card-label">${escHtml(slot.label)}</span>
            <span class="free-card-meta">${slot.durationHrs}h window &middot; ${freqLabel}</span>
          </div>
          <div class="free-card-right">
            <span class="free-card-con ${slot.maxConcurrency === 0 ? 'con-empty' : 'con-low'}">${conLabel}</span>
            <span class="free-expand-chevron">${isExpanded ? '&#9650;' : '&#9660;'}</span>
          </div>
        </div>`;

      if (isExpanded && slot.occurrences) {
        html += `<div class="free-card-details">`;
        for (const occ of slot.occurrences) {
          html += `<div class="free-occ">
            <span class="free-occ-time">${formatOccTime(occ.start, useLocal)} – ${formatOccTime(occ.end, useLocal)}</span>
            <span class="free-occ-dur">${Math.round(occ.durationHrs)}h</span>
          </div>`;
        }
        html += `</div>`;
      }

      html += `</div>`;
    }

    html += `</div></div>`;
    container.innerHTML = html;

    container.querySelectorAll('.free-card').forEach(card => {
      card.querySelector('.free-card-header').onclick = () => {
        const idx = parseInt(card.dataset.idx);
        expandedIdx = expandedIdx === idx ? null : idx;
        render(freeSlots, timezone);
      };
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
