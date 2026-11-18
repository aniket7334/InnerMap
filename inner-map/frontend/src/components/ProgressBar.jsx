export default function ProgressBar({ value, max, tone = 'primary', label }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className={`progress-fill progress-${tone}`} style={{ width: `${pct}%` }} />
      <span className="progress-text">{pct}%</span>
    </div>
  );
}
