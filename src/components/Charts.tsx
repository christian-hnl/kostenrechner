export interface ChartPart {
  label: string;
  value: number;
  color: string;
}

/** Shared colour scales so every diagram speaks the same visual language. */
export const COST_COLORS = {
  fuel: "#3b82f6",
  perKm: "#8b5cf6",
  detour: "#ef4444",
  fixed: "#f59e0b",
} as const;

export const ROAD_COLORS = {
  stadt: "#ef4444",
  dorf: "#f59e0b",
  landstrasse: "#10b981",
  autobahn: "#3b82f6",
} as const;

export const ROAD_LABELS = {
  stadt: "Stadt",
  dorf: "Dorf",
  landstrasse: "Landstraße",
  autobahn: "Autobahn",
} as const;

/** Colour for an occupancy count: solo = expensive (red) … full car = efficient (blue). */
export function occupancyColor(count: number): string {
  if (count <= 1) return "#ef4444";
  if (count === 2) return "#f59e0b";
  if (count === 3) return "#10b981";
  return "#3b82f6";
}

/** Horizontal stacked bar – width-proportional coloured segments. */
export function StackedBar({
  parts,
  total,
  height = 18,
  rounded = true,
}: {
  parts: ChartPart[];
  total?: number;
  height?: number;
  rounded?: boolean;
}) {
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div className="stacked-bar" style={{ height, borderRadius: rounded ? 999 : 4 }}>
      {sum > 0 && visible.length > 0 ? (
        visible.map((p, i) => (
          <div
            key={i}
            className="stacked-seg"
            style={{ width: `${(p.value / sum) * 100}%`, background: p.color }}
            title={`${p.label}: ${p.value.toFixed(2)}`}
          />
        ))
      ) : (
        <div className="stacked-seg" style={{ width: "100%", background: "rgba(148,163,184,0.18)" }} />
      )}
    </div>
  );
}

/** SVG donut built from parts. Center text inherits `currentColor`. */
export function Donut({
  parts,
  size = 132,
  thickness = 20,
  centerLabel,
  centerSub,
}: {
  parts: ChartPart[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const visible = parts.filter((p) => p.value > 0);
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total > 0 && visible.length > 0 ? (
          visible.map((p, i) => {
            const dash = (p.value / total) * C;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })
        ) : (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth={thickness} />
        )}
      </g>
      {centerLabel && (
        <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="donut-center" fill="currentColor">
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" className="donut-sub" fill="currentColor">
          {centerSub}
        </text>
      )}
    </svg>
  );
}

/** Occupancy profile: one cell per segment, width = km share, colour = people aboard. */
export function SegmentStrip({
  segments,
  height = 30,
}: {
  segments: { km: number; count: number; label?: string }[];
  height?: number;
}) {
  const total = segments.reduce((s, x) => s + x.km, 0);
  return (
    <div className="seg-strip" style={{ height }}>
      {total > 0 ? (
        segments.map((s, i) => {
          const frac = s.km / total;
          return (
            <div
              key={i}
              className="seg-strip-cell"
              style={{ width: `${frac * 100}%`, background: occupancyColor(s.count) }}
              title={`${s.label ? s.label + " · " : ""}${s.count} Pers. · ${s.km.toFixed(1)} km`}
            >
              {frac > 0.05 && <span>{s.count}</span>}
            </div>
          );
        })
      ) : (
        <div className="seg-strip-cell" style={{ width: "100%", background: "rgba(148,163,184,0.18)" }} />
      )}
    </div>
  );
}

/** Inline colour-swatch legend. */
export function Legend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  return (
    <div className={"chart-legend" + (className ? " " + className : "")}>
      {items.map((it, i) => (
        <span key={i} className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
