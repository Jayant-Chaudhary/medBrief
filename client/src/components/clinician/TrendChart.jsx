import { useMemo, useState } from 'react';
import { statusOf } from '../../utils/clinical.js';
import { formatShortDate, formatDate } from '../../utils/format.js';

const VIEW_W = 680;
const VIEW_H = 200;
const PAD = { top: 18, right: 54, bottom: 28, left: 44 };

/**
 * Longitudinal line chart for a single metric.
 *
 * One series, so there is no legend — the row heading names it. Colour comes
 * from the metric's clinical status, the grid stays recessive, and a hover
 * crosshair reads out the exact value at each visit. A table view is always
 * available underneath for screen readers and print.
 */
export function TrendChart({ series = [], unit = '', status = 'pending', reference }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const tone = statusOf(status);

  const geometry = useMemo(() => {
    if (series.length === 0) return null;

    const values = series.map((point) => point.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    // Pad the domain so the line never touches the frame; guard flat series.
    const span = rawMax - rawMin || Math.abs(rawMax) * 0.1 || 1;
    const min = rawMin - span * 0.25;
    const max = rawMax + span * 0.25;

    const plotW = VIEW_W - PAD.left - PAD.right;
    const plotH = VIEW_H - PAD.top - PAD.bottom;

    const x = (index) =>
      PAD.left + (series.length === 1 ? plotW / 2 : (index / (series.length - 1)) * plotW);
    const y = (value) => PAD.top + plotH - ((value - min) / (max - min)) * plotH;

    const points = series.map((point, index) => ({ ...point, cx: x(index), cy: y(point.value) }));
    const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.cx},${point.cy}`).join(' ');
    const area = `${line} L${points.at(-1).cx},${PAD.top + plotH} L${points[0].cx},${PAD.top + plotH} Z`;

    return { points, line, area, min, max, plotH, ticks: [max, (max + min) / 2, min] };
  }, [series]);

  if (!geometry) {
    return <p className="px-1 py-6 text-center text-body-sm text-ink-3">No historical readings yet.</p>;
  }

  const { points, line, area, plotH, ticks } = geometry;
  const active = hoverIndex == null ? null : points[hoverIndex];
  const latest = points.at(-1);
  const gradientId = `trend-${status}`;

  function onMove(event) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    // Map the pointer into viewBox space before finding the nearest point.
    const cursorX = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.cx - cursorX) < Math.abs(points[nearest].cx - cursorX)) nearest = index;
    });
    setHoverIndex(nearest);
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Trend of ${series.length} readings, latest ${latest.value} ${unit}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone.stroke} stopOpacity="0.16" />
            <stop offset="100%" stopColor={tone.stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive gridlines and value ticks */}
        {ticks.map((value, index) => {
          const ty = PAD.top + (index / (ticks.length - 1)) * plotH;
          return (
            <g key={value}>
              <line x1={PAD.left} y1={ty} x2={VIEW_W - PAD.right} y2={ty} strokeWidth="1" className="stroke-slate-200" />
              <text x={PAD.left - 8} y={ty + 4} textAnchor="end" fontSize="12" className="tabular fill-slate-500 font-medium">
                {formatTick(value)}
              </text>
            </g>
          );
        })}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={tone.stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {active && (
          <line
            x1={active.cx}
            y1={PAD.top}
            x2={active.cx}
            y2={PAD.top + plotH}
            stroke={tone.stroke}
            strokeWidth="1.5"
            strokeDasharray="3 3"
            opacity="0.75"
          />
        )}

        {points.map((point, index) => (
          <g key={point.date}>
            <circle
              cx={point.cx}
              cy={point.cy}
              r={hoverIndex === index || index === points.length - 1 ? 5.5 : 4}
              fill={tone.stroke}
              className="stroke-white"
              strokeWidth="2"
            />
            <text x={point.cx} y={VIEW_H - 8} textAnchor="middle" fontSize="12" className="fill-slate-500 font-medium">
              {formatShortDate(point.date)}
            </text>
          </g>
        ))}

        {/* Direct label on the latest reading — never a number on every point. */}
        <text
          x={latest.cx + 10}
          y={latest.cy + 4}
          fontSize="12"
          fontWeight="600"
          fill={tone.stroke}
          className="tabular"
        >
          {latest.value}
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-body-sm text-ink-3">
          {active ? (
            <>
              <span className="text-ink-2">{formatDate(active.date)}</span> ·{' '}
              <span className="tabular font-medium text-ink">
                {active.value} {unit}
              </span>
            </>
          ) : (
            <>
              {series.length} readings{reference ? ` · target ${reference}` : ''}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          className="text-label-md text-cypress underline-offset-2 hover:underline"
        >
          {showTable ? 'Hide values' : 'View values'}
        </button>
      </div>

      {showTable && (
        <table className="mt-2 w-full text-body-sm">
          <caption className="sr-only">Historical readings</caption>
          <thead>
            <tr className="text-left text-label-sm uppercase text-ink-3">
              <th scope="col" className="py-1 font-semibold">
                Date
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...series].reverse().map((point) => (
              <tr key={point.date}>
                <td className="py-1.5 text-ink-2">{formatDate(point.date)}</td>
                <td className="py-1.5 text-right tabular text-ink">
                  {point.value} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatTick(value) {
  return Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(1));
}

export default TrendChart;
