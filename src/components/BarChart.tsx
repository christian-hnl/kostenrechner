interface Bar {
  label: string;
  value: number;
  highlight?: boolean;
}

/** Schlichtes, abhängigkeitsfreies SVG-Balkendiagramm (horizontal). */
export function BarChart({ bars, format }: { bars: Bar[]; format: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="barchart">
      {bars.map((b, i) => (
        <div className="bar-row" key={i}>
          <span className="bar-label">{b.label}</span>
          <div className="bar-track">
            <div
              className={"bar-fill" + (b.highlight ? " hl" : "")}
              style={{ width: `${(b.value / max) * 100}%` }}
            />
          </div>
          <span className="bar-value">{format(b.value)}</span>
        </div>
      ))}
    </div>
  );
}
