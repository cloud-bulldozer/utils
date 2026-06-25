import { CronExpressionParser } from 'cron-parser';

const HOUR = 3.6e6;
const DAY = 8.64e7;
const WEEK = 6.048e8;

const RANGE_PRESETS = {
  '24h': { hours: 24 },
  '7d':  { days: 7 },
  '1mo': { days: 31 },
  '3mo': { days: 92 },
  '6mo': { days: 183 },
  '1yr': { days: 365 },
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function getDateRange(preset, customStart, customEnd) {
  if (preset === 'custom' && customStart && customEnd) {
    return { start: new Date(customStart), end: new Date(customEnd) };
  }
  const cfg = RANGE_PRESETS[preset] || RANGE_PRESETS['7d'];
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start);
  if (cfg.hours) end.setHours(end.getHours() + cfg.hours);
  if (cfg.days) end.setDate(end.getDate() + cfg.days);
  return { start, end };
}

export function computeRunTimes(cronExpr, start, end) {
  try {
    const interval = CronExpressionParser.parse(cronExpr, {
      currentDate: new Date(start.getTime() - 1),
      endDate: end,
      utc: true,
    });
    const runs = [];
    while (interval.hasNext()) {
      const d = interval.next().toDate();
      if (d > end) break;
      runs.push(d);
    }
    return runs;
  } catch {
    return [];
  }
}

export function computeAllRunTimes(jobs, start, end) {
  const map = new Map();
  for (const job of jobs) {
    map.set(job.short_name, computeRunTimes(job.cron, start, end));
  }
  return map;
}

export function computeTimeSlots(start, end) {
  const durationHrs = (end - start) / HOUR;
  let slotMs;
  if (durationHrs <= 24)        slotMs = HOUR;
  else if (durationHrs <= 168)  slotMs = HOUR * 3;
  else if (durationHrs <= 744)  slotMs = HOUR * 8;
  else if (durationHrs <= 2208) slotMs = DAY;
  else if (durationHrs <= 4392) slotMs = DAY * 2;
  else                          slotMs = WEEK;

  const slots = [];
  let t = start.getTime();
  const endMs = end.getTime();
  while (t < endMs) {
    slots.push(new Date(t));
    t += slotMs;
  }
  return { slots, slotMs };
}

export function computeConcurrency(runTimesMap, slots, slotMs) {
  const fineMs = Math.min(slotMs, HOUR);

  const rangeStart = slots[0].getTime();
  const rangeEnd = slots[slots.length - 1].getTime() + slotMs;
  const fineCount = Math.ceil((rangeEnd - rangeStart) / fineMs);
  const fineCon = new Array(fineCount).fill(0);
  const fineJobs = Array.from({ length: fineCount }, () => []);

  for (const [jobName, runs] of runTimesMap) {
    for (const runStart of runs) {
      const idx = Math.floor((runStart.getTime() - rangeStart) / fineMs);
      if (idx >= 0 && idx < fineCount) {
        fineCon[idx]++;
        fineJobs[idx].push(jobName);
      }
    }
  }

  const concurrency = new Array(slots.length).fill(0);
  const slotJobs = slots.map(() => []);

  for (let s = 0; s < slots.length; s++) {
    const sStart = slots[s].getTime();
    const sEnd = sStart + slotMs;
    const fFrom = Math.floor((sStart - rangeStart) / fineMs);
    const fTo = Math.min(fineCount - 1, Math.floor((sEnd - rangeStart - 1) / fineMs));

    let peak = 0;
    let peakIdx = fFrom;
    for (let i = fFrom; i <= fTo; i++) {
      if (fineCon[i] > peak) { peak = fineCon[i]; peakIdx = i; }
    }
    concurrency[s] = peak;
    slotJobs[s] = [...new Set(fineJobs[peakIdx])];
  }

  return { concurrency, slotJobs, fineCon, fineJobs, fineMs, rangeStart };
}

export function getConcurrencyLevel(count, thresholds) {
  if (count >= thresholds.danger) return 'danger';
  if (count >= thresholds.warn) return 'warn';
  return 'safe';
}

// --- Conflict detection on fine-grained hourly data, grouped by recurring pattern ---

export function findConflicts(fineCon, fineJobs, fineMs, rangeStart, threshold, timezone = 'UTC') {
  const useLocal = timezone !== 'UTC';
  const tzOpts = useLocal ? {} : { timeZone: 'UTC' };
  const tzSuffix = useLocal ? '' : ' UTC';
  const _day = (d) => useLocal ? d.getDay() : d.getUTCDay();
  const _h = (d) => useLocal ? d.getHours() : d.getUTCHours();
  const _m = (d) => useLocal ? d.getMinutes() : d.getUTCMinutes();
  const fmtHM = (d) => `${String(_h(d)).padStart(2, '0')}:${String(_m(d)).padStart(2, '0')}`;

  const rawWindows = [];
  let current = null;

  for (let i = 0; i < fineCon.length; i++) {
    if (fineCon[i] >= threshold) {
      if (!current) {
        current = {
          startMs: rangeStart + i * fineMs,
          peak: fineCon[i],
          jobs: new Set(fineJobs[i]),
        };
      } else {
        current.peak = Math.max(current.peak, fineCon[i]);
        for (const j of fineJobs[i]) current.jobs.add(j);
      }
    } else if (current) {
      current.endMs = rangeStart + i * fineMs;
      current.jobs = [...current.jobs];
      rawWindows.push(current);
      current = null;
    }
  }
  if (current) {
    current.endMs = rangeStart + fineCon.length * fineMs;
    current.jobs = [...current.jobs];
    rawWindows.push(current);
  }

  if (rawWindows.length === 0) return [];

  const patternMap = new Map();
  for (const w of rawWindows) {
    const s = new Date(w.startMs);
    const e = new Date(w.endMs);
    const dayOfWeek = _day(s);
    const key = `${dayOfWeek}-${_h(s)}:${_m(s)}-${_h(e)}:${_m(e)}`;

    if (patternMap.has(key)) {
      const group = patternMap.get(key);
      group.occurrences.push({ start: s, end: e, peak: w.peak, jobs: w.jobs });
      group.peak = Math.max(group.peak, w.peak);
      for (const j of w.jobs) group.allJobs.add(j);
    } else {
      patternMap.set(key, {
        dayOfWeek,
        peak: w.peak,
        allJobs: new Set(w.jobs),
        occurrences: [{ start: s, end: e, peak: w.peak, jobs: w.jobs }],
      });
    }
  }

  const grouped = [];
  for (const [, g] of patternMap) {
    const isRecurring = g.occurrences.length > 1;
    const dayLabel = DAY_NAMES[g.dayOfWeek];
    const first = g.occurrences[0];
    const timeRange = `${fmtHM(first.start)} – ${fmtHM(first.end)}`;

    grouped.push({
      label: isRecurring
        ? `${dayLabel}s, ${timeRange}${tzSuffix}`
        : `${first.start.toLocaleDateString('en-US', { ...tzOpts, weekday: 'short', month: 'short', day: 'numeric' })}, ${timeRange}${tzSuffix}`,
      peak: g.peak,
      frequency: g.occurrences.length,
      jobs: [...g.allJobs],
      occurrences: g.occurrences,
      firstOccurrence: first.start,
    });
  }

  grouped.sort((a, b) => b.peak - a.peak || b.frequency - a.frequency);
  return grouped;
}

// --- Free slot discovery on fine-grained hourly data ---

export function findFreeSlots(fineCon, fineMs, rangeStart, maxConcurrency = 1, timezone = 'UTC') {
  const useLocal = timezone !== 'UTC';
  const tzOpts = useLocal ? {} : { timeZone: 'UTC' };
  const tzSuffix = useLocal ? '' : ' UTC';
  const _day = (d) => useLocal ? d.getDay() : d.getUTCDay();
  const _h = (d) => useLocal ? d.getHours() : d.getUTCHours();
  const _m = (d) => useLocal ? d.getMinutes() : d.getUTCMinutes();
  const fmtHM = (d) => `${String(_h(d)).padStart(2, '0')}:${String(_m(d)).padStart(2, '0')}`;

  const rawWindows = [];
  let current = null;

  for (let i = 0; i < fineCon.length; i++) {
    if (fineCon[i] <= maxConcurrency) {
      if (!current) {
        current = { startIdx: i, maxSeen: fineCon[i] };
      } else {
        current.maxSeen = Math.max(current.maxSeen, fineCon[i]);
      }
    } else if (current) {
      current.endIdx = i;
      rawWindows.push(current);
      current = null;
    }
  }
  if (current) {
    current.endIdx = fineCon.length;
    rawWindows.push(current);
  }

  const minHours = 2;
  const minSlots = Math.ceil((minHours * HOUR) / fineMs);
  const filtered = rawWindows.filter(w => (w.endIdx - w.startIdx) >= minSlots);

  const patternMap = new Map();
  for (const w of filtered) {
    const startMs = rangeStart + w.startIdx * fineMs;
    const endMs = rangeStart + w.endIdx * fineMs;
    const s = new Date(startMs);
    const e = new Date(endMs);
    const dayOfWeek = _day(s);
    const durationHrs = (endMs - startMs) / HOUR;

    const spansDays = durationHrs >= 24;
    const key = spansDays
      ? `multi-${dayOfWeek}-${_h(s)}:${_m(s)}`
      : `${dayOfWeek}-${_h(s)}:${_m(s)}-${Math.round(durationHrs)}`;

    if (patternMap.has(key)) {
      const group = patternMap.get(key);
      group.occurrences.push({ start: s, end: e, durationHrs, maxCon: w.maxSeen });
      group.maxCon = Math.max(group.maxCon, w.maxSeen);
      group.totalHours += durationHrs;
    } else {
      patternMap.set(key, {
        dayOfWeek,
        durationHrs,
        maxCon: w.maxSeen,
        occurrences: [{ start: s, end: e, durationHrs, maxCon: w.maxSeen }],
        totalHours: durationHrs,
      });
    }
  }

  const grouped = [];
  for (const [, g] of patternMap) {
    const isRecurring = g.occurrences.length > 1;
    const avgDuration = g.totalHours / g.occurrences.length;
    const dayLabel = DAY_NAMES[g.dayOfWeek];
    const first = g.occurrences[0];

    let label;
    if (avgDuration >= 24) {
      label = isRecurring
        ? `${dayLabel} ${fmtHM(first.start)} – ${DAY_NAMES[_day(first.end)]} ${fmtHM(first.end)}${tzSuffix}`
        : `${first.start.toLocaleDateString('en-US', { ...tzOpts, month: 'short', day: 'numeric' })} – ${first.end.toLocaleDateString('en-US', { ...tzOpts, month: 'short', day: 'numeric' })}`;
    } else {
      const timeRange = `${fmtHM(first.start)} – ${fmtHM(first.end)}`;
      label = isRecurring
        ? `${dayLabel}s, ${timeRange}${tzSuffix}`
        : `${first.start.toLocaleDateString('en-US', { ...tzOpts, weekday: 'short', month: 'short', day: 'numeric' })}, ${timeRange}${tzSuffix}`;
    }

    grouped.push({
      label,
      durationHrs: Math.round(avgDuration),
      maxConcurrency: g.maxCon,
      frequency: g.occurrences.length,
      occurrences: g.occurrences,
    });
  }

  grouped.sort((a, b) => b.durationHrs - a.durationHrs || a.maxConcurrency - b.maxConcurrency);
  return grouped.slice(0, 15);
}

// --- Filtering ---

export function filterJobs(jobs, activeVersions, searchQuery, hiddenJobs) {
  return jobs.filter(job => {
    if (!activeVersions.has(job.version)) return false;
    if (hiddenJobs && hiddenJobs.has(job.short_name)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return job.short_name.toLowerCase().includes(q) ||
             job.name.toLowerCase().includes(q) ||
             job.cron.includes(q);
    }
    return true;
  });
}

// --- Time header formatting ---

export function computeMajorDivisions(slots, slotMs, rangeKey, useLocal) {
  if (rangeKey === '24h') return [];

  const divisions = [];
  let lastLabel = null;

  for (let i = 0; i < slots.length; i++) {
    const d = slots[i];
    let label;
    if (rangeKey === '7d') {
      label = useLocal
        ? DAY_NAMES[d.getDay()]
        : DAY_NAMES[d.getUTCDay()];
    } else {
      const m = useLocal ? d.getMonth() : d.getUTCMonth();
      const y = useLocal ? d.getFullYear() : d.getUTCFullYear();
      label = `${MONTH_NAMES[m]} ${y}`;
    }

    if (label !== lastLabel) {
      divisions.push({ startIndex: i, label });
      lastLabel = label;
    }
  }

  for (let i = 0; i < divisions.length; i++) {
    const next = divisions[i + 1];
    divisions[i].span = next ? next.startIndex - divisions[i].startIndex : slots.length - divisions[i].startIndex;
  }

  return divisions;
}

export function formatSlotLabel(date, rangeKey, useLocal) {
  const opts = { timeZone: useLocal ? undefined : 'UTC' };
  const d = new Date(date);

  if (rangeKey === '24h') {
    return d.toLocaleTimeString('en-US', { ...opts, hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (rangeKey === '7d') {
    return d.toLocaleTimeString('en-US', { ...opts, hour: '2-digit', hour12: false });
  }
  if (rangeKey === '1mo') {
    return d.toLocaleDateString('en-US', { ...opts, day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { ...opts, month: 'short', day: 'numeric' });
}

export function shouldShowLabel(index, totalSlots) {
  if (totalSlots <= 30) return true;
  if (totalSlots <= 60) return index % 2 === 0;
  if (totalSlots <= 120) return index % 4 === 0;
  return index % 8 === 0;
}
