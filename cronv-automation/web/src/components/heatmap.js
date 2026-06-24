import { getConcurrencyLevel } from '../cron.js';

const COLORS = {
  safe:   { fill: 'rgba(62, 134, 53, 0.6)',  stroke: 'rgba(62, 134, 53, 0.9)' },
  warn:   { fill: 'rgba(240, 171, 0, 0.6)',   stroke: 'rgba(240, 171, 0, 0.9)' },
  danger: { fill: 'rgba(201, 25, 11, 0.6)',   stroke: 'rgba(201, 25, 11, 0.9)' },
};

export function drawHeatmap(canvas, concurrency, thresholds, maxSlotWidth) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();

  const displayWidth = Math.max(concurrency.length * maxSlotWidth, rect.width);
  const displayHeight = rect.height;

  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  if (concurrency.length === 0) return;

  const peak = Math.max(...concurrency, thresholds.danger + 2);
  const barWidth = displayWidth / concurrency.length;
  const chartTop = 16;
  const chartHeight = displayHeight - chartTop - 4;

  // Threshold lines
  [thresholds.warn, thresholds.danger].forEach((th, idx) => {
    const y = chartTop + chartHeight - (th / peak) * chartHeight;
    ctx.strokeStyle = idx === 0 ? 'rgba(240,171,0,0.3)' : 'rgba(201,25,11,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(displayWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // Bars
  for (let i = 0; i < concurrency.length; i++) {
    const val = concurrency[i];
    if (val === 0) continue;

    const level = getConcurrencyLevel(val, thresholds);
    const color = COLORS[level];
    const barHeight = (val / peak) * chartHeight;
    const x = i * barWidth;
    const y = chartTop + chartHeight - barHeight;

    ctx.fillStyle = color.fill;
    ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
    ctx.fillStyle = color.stroke;
    ctx.fillRect(x + 1, y, barWidth - 2, 2);
  }

  // Y-axis labels
  ctx.fillStyle = '#6a6e73';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${peak}`, 4, chartTop + 8);
  ctx.fillText('0', 4, chartTop + chartHeight - 2);
}
