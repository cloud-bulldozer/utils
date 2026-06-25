import './theme.css';
import { createStore } from './store.js';
import {
  getDateRange,
  computeAllRunTimes,
  computeTimeSlots,
  computeConcurrency,
  findConflicts,
  findFreeSlots,
  filterJobs,
} from './cron.js';
import { createHeader } from './components/header.js';
import { createToolbar } from './components/toolbar.js';
import { createSidebar } from './components/sidebar.js';
import { createConflicts } from './components/conflicts.js';
import { createFreeSlots } from './components/free-slots.js';
import { createTimeline } from './components/timeline.js';
import { createJobDetail } from './components/job-detail.js';

const DATA_URL = './crontab.json';
const REFRESH_INTERVAL = 5 * 60 * 1000;

const store = createStore({
  jobs: [],
  versions: [],
  generatedAt: '',
  totalJobs: 0,
  dateRange: '7d',
  customStart: null,
  customEnd: null,
  activeVersions: new Set(),
  searchQuery: '',
  collapsedGroups: new Set(),
  selectedJob: null,
  timezone: 'UTC',
  thresholds: { warn: 3, danger: 6 },
  hiddenJobs: new Set(),
});

function computeDerived(state) {
  const { start, end } = getDateRange(state.dateRange, state.customStart, state.customEnd);
  const displayJobs = filterJobs(state.jobs, state.activeVersions, state.searchQuery);
  const filtered = filterJobs(state.jobs, state.activeVersions, state.searchQuery, state.hiddenJobs);
  const runTimes = computeAllRunTimes(filtered, start, end);
  const { slots, slotMs } = computeTimeSlots(start, end);
  const {
    concurrency, slotJobs,
    fineCon, fineJobs, fineMs, rangeStart,
  } = computeConcurrency(runTimes, slots, slotMs);

  const conflicts = findConflicts(
    fineCon, fineJobs, fineMs, rangeStart, state.thresholds.danger, state.timezone,
  );
  const freeSlots = findFreeSlots(fineCon, fineMs, rangeStart, 1, state.timezone);

  return {
    start, end, displayJobs, filteredJobs: filtered,
    runTimes, slots, slotMs,
    concurrency, slotJobs,
    fineCon, fineJobs, fineMs, rangeStart,
    conflicts, freeSlots,
  };
}

let isFirstLoad = true;

async function loadData() {
  try {
    const resp = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const update = {
      jobs: data.jobs || [],
      versions: data.versions || [],
      generatedAt: data.generated_at || '',
      totalJobs: data.total_jobs || 0,
    };

    if (isFirstLoad) {
      update.activeVersions = new Set(data.versions || []);
      isFirstLoad = false;
    }

    store.set(update);
    return true;
  } catch (err) {
    console.error('Failed to load schedule data:', err);
    return false;
  }
}

async function init() {
  const loaded = await loadData();
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('hidden');

  if (!loaded) {
    document.getElementById('content-scroll').innerHTML =
      '<div style="padding:60px;text-align:center;color:#8a8d90;">' +
      '<p style="font-size:16px;margin-bottom:8px;">Could not load schedule data</p>' +
      '<p style="font-size:13px;">Make sure <code>crontab.json</code> is available.</p></div>';
    return;
  }

  createHeader(document.getElementById('app-header'), store);
  createToolbar(document.getElementById('toolbar'), store);
  createJobDetail(document.getElementById('job-detail-popover'), store);

  let derived = computeDerived(store.get());
  const state = store.get();

  const sidebar = createSidebar(document.getElementById('sidebar'), store, derived);
  const conflictsPanel = createConflicts(document.getElementById('conflicts-banner'), store);
  const freeSlotsPanel = createFreeSlots(document.getElementById('free-slots-container'));
  const timeline = createTimeline(document.getElementById('content-scroll'), store, derived);

  sidebar.init();
  conflictsPanel.update(derived.conflicts, state.thresholds, state.timezone);
  freeSlotsPanel.update(derived.freeSlots, state.timezone);
  timeline.init();

  store.subscribe((newState) => {
    derived = computeDerived(newState);
    sidebar.update(newState, derived);
    conflictsPanel.update(derived.conflicts, newState.thresholds, newState.timezone);
    freeSlotsPanel.update(derived.freeSlots, newState.timezone);
    timeline.update(newState, derived);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      const input = document.querySelector('.search-box input');
      if (input && document.activeElement !== input) {
        e.preventDefault();
        input.focus();
      }
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => store.set({}), 200);
  });

  setInterval(async () => {
    await loadData();
  }, REFRESH_INTERVAL);

  setInterval(() => {
    const nowLine = document.querySelector('.now-line');
    if (!nowLine) return;
    const st = store.get();
    const { start, end } = getDateRange(st.dateRange, st.customStart, st.customEnd);
    const { slots } = computeTimeSlots(start, end);
    const el = document.getElementById('content-scroll');
    const nameColW = 360;
    const slotW = Math.max(28, (el.clientWidth - nameColW) / slots.length);
    const totalSlotsW = slots.length * slotW;
    const now = Date.now();
    const s = start.getTime();
    const e = end.getTime();
    if (now < s || now > e) {
      nowLine.style.display = 'none';
    } else {
      nowLine.style.display = '';
      nowLine.style.left = `${nameColW + ((now - s) / (e - s)) * totalSlotsW}px`;
    }
  }, 60_000);
}

init();
