interface MeterProps {
  value: number;
  label?: string;
  tone?: 'auto' | 'accent';
}

/** Horizontal usage bar. Turns amber/red as the value grows (unless tone="accent"). */
export function Meter({ value, label, tone = 'auto' }: MeterProps) {
  const v = Math.max(0, Math.min(100, value));
  const level = tone === 'accent' ? 'ok' : v >= 90 ? 'high' : v >= 70 ? 'mid' : 'ok';
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`meter-fill meter-${level}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Small line chart of recent samples (0..100). */
export function Sparkline({ values, height = 44 }: { values: readonly number[]; height?: number }) {
  const w = 200;
  const max = 60;
  const points = values.map((v, i) => {
    const x = (i / (max - 1)) * w;
    const y = height - (Math.max(0, Math.min(100, v)) / 100) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const offset = max - values.length;
  const shift = (offset / (max - 1)) * w;
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="usage history">
      {points.length > 1 && (
        <g transform={`translate(${shift} 0)`}>
          <polyline points={`0,${height} ${points.join(' ')} ${w - shift},${height}`} className="sparkline-area" />
          <polyline points={points.join(' ')} className="sparkline-line" />
        </g>
      )}
    </svg>
  );
}
