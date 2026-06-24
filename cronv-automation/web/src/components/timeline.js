import { drawHeatmap } from './heatmap.js';
import {
  formatSlotLabel,
  shouldShowLabel,
  computeMajorDivisions,
  getConcurrencyLevel,
} from '../cron.js';

const NAME_COL_W = 360;
const MIN_SLOT_W = 28;

const VERSION_COLORS = {
  '5.0':  '#4dabf7',
  '4.23': '#51cf66',
  '4.22': '#ff6b6b',
  '4.21': '#fcc419',
  '4.20': '#cc5de8',
  '4.19': '#20c997',
  '4.18': '#ff922b',
  '4.17': '#74c0fc',
  '4.16': '#da77f2',
  other:  '#868e96',
};

function versionColor(version) {
  return VERSION_COLORS[version] || VERSION_COLORS.other;
}

export function createTimeline(container, store, derived) {
  let lastDerived = derived;
  let pinnedSlot = null;

  function render(state) {
    const d = lastDerived;
    const { displayJobs, runTimes, slots, slotMs, concurrency, slotJobs } = d;
    const jobsToRender = displayJobs || d.filteredJobs;
    if (!slots || slots.length === 0 || !jobsToRender) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#6a6e73;">No data to display</div>';
      return;
    }

    const hiddenJobs = state.hiddenJobs || new Set();
    const scrollWidth = container.clientWidth;
    const slotsAreaWidth = scrollWidth - NAME_COL_W;
    const slotW = Math.max(MIN_SLOT_W, slotsAreaWidth / slots.length);
    const totalSlotsW = slots.length * slotW;
    const innerW = NAME_COL_W + totalSlotsW;

    const groups = groupByVersion(jobsToRender, state.versions);
    const useLocal = state.timezone !== 'UTC';
    const activeVersions = [...state.activeVersions].filter(v =>
      (jobsToRender || []).some(j => j.version === v)
    );

    let html = `<div class="scroll-inner" style="width:${innerW}px;">`;

    // ── Heatmap row ──
    html += `<div class="heatmap-row">
      <div class="heatmap-label">Concurrency</div>
      <div class="heatmap-canvas-wrap" style="width:${totalSlotsW}px">
        <canvas id="heatmap-canvas"></canvas>
      </div>
    </div>`;

    // ── Heatmap tooltip (hidden, positioned via JS) ──
    html += `<div class="heatmap-tooltip hidden" id="heatmap-tooltip"></div>`;

    // ── Heatmap detail strip (pinned on click) ──
    html += `<div class="heatmap-detail-strip hidden" id="heatmap-detail-strip"></div>`;

    // ── Version color legend ──
    html += `<div class="version-legend">`;
    for (const v of activeVersions) {
      const label = v === 'other' ? 'Other' : `OCP ${v}`;
      const color = versionColor(v);
      html += `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${label}</span>`;
    }
    html += `</div>`;

    // ── Two-row time header ──
    const majorDivs = computeMajorDivisions(slots, slotMs, state.dateRange, useLocal);
    const hasMajorRow = majorDivs.length > 0;

    html += `<div class="time-header-block" style="${hasMajorRow ? '' : 'height:var(--time-header-height)'}">`;
    if (hasMajorRow) {
      html += `<div class="time-header-major">
        <div class="time-header-name-major"></div>
        <div class="time-major-labels">`;
      for (let i = 0; i < majorDivs.length; i++) {
        const div = majorDivs[i];
        const w = div.span * slotW;
        const altClass = i % 2 === 1 ? ' major-alt' : '';
        html += `<div class="major-label${altClass}" style="width:${w}px">${div.label}</div>`;
      }
      html += `</div></div>`;
    }

    html += `<div class="time-header-row">
      <div class="time-header-name">Job Name</div>
      <div class="time-slots-header">`;
    for (let i = 0; i < slots.length; i++) {
      const show = shouldShowLabel(i, slots.length);
      const label = show ? formatSlotLabel(slots[i], state.dateRange, useLocal) : '';
      const dayClass = isDayBoundary(slots, i, slotMs, useLocal) ? ' day-start' : '';
      const monthClass = isMonthBoundary(slots, i, useLocal) ? ' month-start' : '';
      html += `<div class="time-slot-label${dayClass}${monthClass}" style="width:${slotW}px">${label}</div>`;
    }
    html += `</div></div>`;
    html += `</div>`; // close time-header-block

    // ── Version groups ──
    for (const [version, jobs] of groups) {
      if (jobs.length === 0) continue;
      const collapsed = state.collapsedGroups.has(version);
      const label = version === 'other' ? 'Other' : `OCP ${version}`;
      const color = versionColor(version);

      html += `<div class="version-group${collapsed ? ' collapsed' : ''}" data-version="${version}">`;
      html += `<div class="version-header-row" data-version="${version}">
        <div class="version-header-content">
          <span class="version-chevron">&#9660;</span>
          <span class="legend-dot" style="background:${color};width:8px;height:8px"></span>
          <span>${label}</span>
          <span class="version-header-count">(${jobs.length} jobs)</span>
        </div>
      </div>`;

      html += `<div class="version-jobs">`;
      for (const job of jobs) {
        const isHidden = hiddenJobs.has(job.short_name);
        const runs = isHidden ? [] : (runTimes.get(job.short_name) || []);
        html += renderJobRow(job, runs, slots, slotW, slotMs, d.start, d.end, useLocal, color, isHidden, majorDivs);
      }
      html += `</div></div>`;
    }

    // ── Now line ──
    const nowPos = getNowPosition(d.start, d.end, totalSlotsW);
    if (nowPos !== null) {
      html += `<div class="now-line" style="left:${NAME_COL_W + nowPos}px"></div>`;
    }

    // ── Column hover highlight ──
    html += `<div class="column-highlight hidden" id="column-highlight"></div>`;

    html += '</div>';
    html += `<div class="column-date-label hidden" id="column-date-label"></div>`;
    container.innerHTML = html;

    // ── Draw heatmap canvas ──
    const canvas = container.querySelector('#heatmap-canvas');
    if (canvas) {
      drawHeatmap(canvas, concurrency, state.thresholds, slotW);
    }

    // ── Heatmap hover tooltip ──
    const canvasWrap = container.querySelector('.heatmap-canvas-wrap');
    const tooltip = container.querySelector('#heatmap-tooltip');
    if (canvasWrap && tooltip) {
      canvasWrap.addEventListener('mousemove', (e) => {
        const rect = canvasWrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const slotIdx = Math.floor(x / slotW);
        if (slotIdx < 0 || slotIdx >= slots.length) { tooltip.classList.add('hidden'); return; }

        const count = concurrency[slotIdx];
        const jobs = slotJobs[slotIdx] || [];
        const level = getConcurrencyLevel(count, state.thresholds);
        const slotDate = slots[slotIdx];
        const slotEnd = new Date(slotDate.getTime() + slotMs);
        const tzOpts = { timeZone: useLocal ? undefined : 'UTC' };
        const timeLabel = `${slotDate.toLocaleString('en-US', { ...tzOpts, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} – ${slotEnd.toLocaleTimeString('en-US', { ...tzOpts, hour: '2-digit', minute: '2-digit', hour12: false })}${useLocal ? '' : ' UTC'}`;

        const MAX_TOOLTIP_JOBS = 5;
        const visibleJobs = jobs.slice(0, MAX_TOOLTIP_JOBS);
        const remaining = jobs.length - MAX_TOOLTIP_JOBS;

        const jobListHtml = visibleJobs.map(j => {
          const job = state.jobs.find(jj => jj.short_name === j);
          const ver = job ? job.version : 'other';
          const col = versionColor(ver);
          return `<div class="tooltip-job"><span class="tooltip-dot" style="background:${col}"></span>${escHtml(j)}</div>`;
        }).join('');

        const moreHtml = remaining > 0
          ? `<div class="tooltip-click-hint">Click to see all ${jobs.length} jobs</div>`
          : '';

        tooltip.innerHTML = `
          <div class="tooltip-header">
            <span class="tooltip-time">${timeLabel}</span>
            <span class="tooltip-badge tooltip-${level}">${count} job${count !== 1 ? 's' : ''}</span>
          </div>
          <div class="tooltip-jobs">${jobListHtml || '<span class="tooltip-empty">No jobs</span>'}</div>${moreHtml}`;
        tooltip.classList.remove('hidden');
        const heatRect = canvasWrap.getBoundingClientRect();
        tooltip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 270)}px`;
        tooltip.style.top = `${heatRect.bottom + 4}px`;
      });

      canvasWrap.addEventListener('mouseleave', () => {
        tooltip.classList.add('hidden');
      });

      // ── Heatmap click to pin detail strip ──
      const detailStrip = container.querySelector('#heatmap-detail-strip');
      canvasWrap.addEventListener('click', (e) => {
        const rect = canvasWrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const slotIdx = Math.floor(x / slotW);
        if (slotIdx < 0 || slotIdx >= slots.length) return;

        if (pinnedSlot === slotIdx) {
          pinnedSlot = null;
          detailStrip.classList.add('hidden');
          return;
        }
        pinnedSlot = slotIdx;

        const count = concurrency[slotIdx];
        const jobs = slotJobs[slotIdx] || [];
        const level = getConcurrencyLevel(count, state.thresholds);
        const slotDate = slots[slotIdx];
        const slotEnd = new Date(slotDate.getTime() + slotMs);
        const tzOpts = { timeZone: useLocal ? undefined : 'UTC' };
        const timeLabel = `${slotDate.toLocaleString('en-US', { ...tzOpts, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} – ${slotEnd.toLocaleTimeString('en-US', { ...tzOpts, hour: '2-digit', minute: '2-digit', hour12: false })}${useLocal ? '' : ' UTC'}`;

        const jobCols = jobs.map(j => {
          const job = state.jobs.find(jj => jj.short_name === j);
          const ver = job ? job.version : 'other';
          const col = versionColor(ver);
          const cron = job ? job.cron : '';
          return `<div class="strip-job">
            <span class="tooltip-dot" style="background:${col}"></span>
            <span class="strip-job-name">${escHtml(j)}</span>
            <code class="strip-job-cron">${escHtml(cron)}</code>
          </div>`;
        }).join('');

        detailStrip.innerHTML = `
          <div class="strip-header">
            <span class="strip-time">${timeLabel}</span>
            <span class="tooltip-badge tooltip-${level}">${count} concurrent</span>
            <button class="strip-dismiss">&times;</button>
          </div>
          <div class="strip-jobs">${jobCols || '<span class="tooltip-empty">No jobs in this slot</span>'}</div>`;
        detailStrip.classList.remove('hidden');

        detailStrip.querySelector('.strip-dismiss').onclick = () => {
          pinnedSlot = null;
          detailStrip.classList.add('hidden');
        };
      });
    }

    // ── Column hover highlight ──
    const scrollInner = container.querySelector('.scroll-inner');
    const colHighlight = container.querySelector('#column-highlight');
    const colDateLabel = container.querySelector('#column-date-label');
    if (scrollInner && colHighlight) {
      scrollInner.addEventListener('mousemove', (e) => {
        const rect = scrollInner.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const slotX = x - NAME_COL_W;
        if (slotX < 0 || slotX >= totalSlotsW) {
          colHighlight.classList.add('hidden');
          colDateLabel.classList.add('hidden');
          return;
        }
        const slotIdx = Math.floor(slotX / slotW);
        if (slotIdx < 0 || slotIdx >= slots.length) return;

        const left = NAME_COL_W + slotIdx * slotW;
        colHighlight.style.left = `${left}px`;
        colHighlight.style.width = `${slotW}px`;
        colHighlight.classList.remove('hidden');

        const tzOpts = { timeZone: useLocal ? undefined : 'UTC' };
        const dateStr = slots[slotIdx].toLocaleString('en-US', {
          ...tzOpts, weekday: 'short', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        colDateLabel.textContent = dateStr + (useLocal ? '' : ' UTC');

        const containerRect = container.getBoundingClientRect();
        colDateLabel.style.left = `${rect.left + left}px`;
        colDateLabel.style.top = `${containerRect.top + 6}px`;
        colDateLabel.classList.remove('hidden');
      });

      scrollInner.addEventListener('mouseleave', () => {
        colHighlight.classList.add('hidden');
        colDateLabel.classList.add('hidden');
      });
    }

    // ── Event: collapse/expand ──
    container.querySelectorAll('.version-header-row').forEach(el => {
      el.onclick = () => {
        const v = el.dataset.version;
        const collapsed = new Set(state.collapsedGroups);
        if (collapsed.has(v)) collapsed.delete(v); else collapsed.add(v);
        store.set({ collapsedGroups: collapsed });
      };
    });

    // ── Event: job checkbox toggle ──
    container.querySelectorAll('.job-checkbox').forEach(cb => {
      cb.onclick = (e) => {
        e.stopPropagation();
        const jobName = cb.dataset.job;
        const hidden = new Set(state.hiddenJobs);
        if (cb.checked) hidden.delete(jobName); else hidden.add(jobName);
        store.set({ hiddenJobs: hidden });
      };
    });

    // ── Event: job name click -> detail popover ──
    container.querySelectorAll('.job-name-cell').forEach(el => {
      el.onclick = (e) => {
        if (e.target.classList.contains('job-checkbox')) return;
        e.stopPropagation();
        const jobName = el.dataset.job;
        const job = state.jobs.find(j => j.short_name === jobName);
        if (job) store.set({ selectedJob: job });
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

function renderJobRow(job, runs, slots, slotW, slotMs, rangeStart, rangeEnd, useLocal, color, isHidden, majorDivs) {
  const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
  const startMs = rangeStart.getTime();
  const tzOpts = { timeZone: useLocal ? undefined : 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };

  let bgHtml = '';
  let majorIdx = 0;
  for (let i = 0; i < slots.length; i++) {
    const dayClass = isDayBoundary(slots, i, slotMs, useLocal) ? ' day-start' : '';
    const monthClass = isMonthBoundary(slots, i, useLocal) ? ' month-start' : '';
    let altClass = '';
    if (majorDivs && majorDivs.length > 0) {
      while (majorIdx < majorDivs.length - 1 && i >= majorDivs[majorIdx + 1].startIndex) majorIdx++;
      if (majorIdx % 2 === 1) altClass = ' major-alt-bg';
    }
    bgHtml += `<div class="slot-bg${dayClass}${monthClass}${altClass}" style="width:${slotW}px"></div>`;
  }

  let linesHtml = '';
  for (const run of runs) {
    const pct = ((run.getTime() - startMs) / rangeMs) * 100;
    const timeStr = run.toLocaleString('en-US', tzOpts);
    const tz = useLocal ? '' : ' UTC';
    const tip = `${job.short_name}\n${timeStr}${tz}\nSchedule: ${job.cron}`;
    linesHtml += `<span class="schedule-line" style="left:${pct}%;background:${color}" title="${escHtml(tip)}"></span>`;
  }

  const checked = isHidden ? '' : ' checked';
  const rowClass = isHidden ? ' job-row-hidden' : '';

  return `<div class="job-row${rowClass}">
    <div class="job-name-cell" data-job="${escHtml(job.short_name)}" title="${escHtml(job.short_name)}">
      <input type="checkbox" class="job-checkbox" data-job="${escHtml(job.short_name)}"${checked}>
      <span class="name-text">${escHtml(job.short_name)}</span>
      <span class="name-full">${escHtml(job.short_name)}</span>
    </div>
    <div class="job-slots">${bgHtml}${linesHtml}</div>
  </div>`;
}

function isDayBoundary(slots, index, slotMs, useLocal) {
  if (index === 0) return false;
  const prev = slots[index - 1];
  const curr = slots[index];
  if (useLocal) return prev.getDate() !== curr.getDate();
  return prev.getUTCDate() !== curr.getUTCDate();
}

function isMonthBoundary(slots, index, useLocal) {
  if (index === 0) return false;
  const prev = slots[index - 1];
  const curr = slots[index];
  if (useLocal) return prev.getMonth() !== curr.getMonth();
  return prev.getUTCMonth() !== curr.getUTCMonth();
}

function groupByVersion(jobs, versions) {
  const map = new Map();
  for (const v of (versions || [])) map.set(v, []);
  for (const job of jobs) {
    if (map.has(job.version)) map.get(job.version).push(job);
    else {
      if (!map.has('other')) map.set('other', []);
      map.get('other').push(job);
    }
  }
  return map;
}

function getNowPosition(start, end, totalWidth) {
  const now = Date.now();
  const s = start.getTime();
  const e = end.getTime();
  if (now < s || now > e) return null;
  return ((now - s) / (e - s)) * totalWidth;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
