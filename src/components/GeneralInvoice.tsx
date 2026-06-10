import type { PersonResult, CalcConfig } from "../types";
import type { TripPlan } from "../trip";
import { eur, num } from "../App";
import { RouteMap } from "./RouteMap";
import { StackedBar, Legend, COST_COLORS } from "./Charts";

interface GeneralInvoiceProps {
  persons: PersonResult[];
  config: CalcConfig;
  tripPlan?: TripPlan;
  geometry?: any;
  grandTotal: number;
  totalDistanceKm: number;
}

export function GeneralInvoice({ persons, tripPlan, geometry, grandTotal, totalDistanceKm }: GeneralInvoiceProps) {
  const totalPersonKm = persons.reduce((s, p) => s + p.personKm, 0);
  const avgOccupancy = totalDistanceKm > 0 ? totalPersonKm / totalDistanceKm : 0;
  const directKm = tripPlan?.directInfo?.totalKm ?? 0;
  const detourKm = Math.max(0, totalDistanceKm - directKm);
  const maxTotal = Math.max(...persons.map((p) => p.total), 0.0001);
  const costLegend = [
    { label: "Sprit", color: COST_COLORS.fuel },
    { label: "Verschleiß", color: COST_COLORS.perKm },
    { label: "Umweg", color: COST_COLORS.detour },
    { label: "Fixkosten", color: COST_COLORS.fixed },
  ];

  return (
    <div className="invoice-container">
      <div className="invoice-header">
        <h1>Allgemeine Fahrtübersicht</h1>
        <p className="invoice-date">{new Date().toLocaleDateString("de-DE")}</p>
      </div>

      <div className="invoice-map-box" style={{ height: "400px" }}>
        {(tripPlan || geometry) && (
          <RouteMap tripPlan={tripPlan} geometry={geometry} persons={persons} lightMode />
        )}
      </div>
      
      <div style={{ marginBottom: "20px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <strong>Legende:</strong>
        {persons.map(p => (
          <span key={p.personId} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: p.color }}></span>
            {p.name}
          </span>
        ))}
        {tripPlan?.directInfo && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "10px" }}>
            <span style={{ display: "inline-block", width: "20px", height: "4px", background: "#cbd5e1" }}></span>
            Direkter Weg (ohne Umweg)
          </span>
        )}
      </div>

      <div className="stat-tiles" style={{ marginBottom: "20px" }}>
        <div className="stat-tile">
          <div className="stat-label">Gesamtstrecke</div>
          <div className="stat-value">{num(totalDistanceKm)} km</div>
          {detourKm > 0.1 && <div className="stat-hint">davon {num(detourKm)} km Umweg</div>}
        </div>
        <div className="stat-tile">
          <div className="stat-label">Ø Besetzung</div>
          <div className="stat-value">{num(avgOccupancy)} Pers.</div>
          <div className="stat-hint">über die Strecke</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Ø Preis je km</div>
          <div className="stat-value">{totalDistanceKm > 0 ? eur(grandTotal / totalDistanceKm) : eur(0)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Mitfahrende</div>
          <div className="stat-value">{persons.length}</div>
        </div>
      </div>

      <h4 style={{ margin: "0 0 10px 0", color: "#334155" }}>Kostenverteilung je Person</h4>
      <div className="breakdown" style={{ marginBottom: "8px" }}>
        {persons.map((p) => (
          <div key={p.personId} className="breakdown-row">
            <span className="breakdown-name">
              <span
                className="chart-legend-swatch"
                style={{ background: p.color }}
              />
              {p.name}
            </span>
            <StackedBar
              total={maxTotal}
              parts={[
                { label: "Sprit", value: p.fuelCost, color: COST_COLORS.fuel },
                { label: "Verschleiß", value: p.perKmExtraCost, color: COST_COLORS.perKm },
                { label: "Umweg", value: p.detourCost, color: COST_COLORS.detour },
                { label: "Fixkosten", value: p.fixedExtraCost, color: COST_COLORS.fixed },
              ]}
            />
            <span className="breakdown-total">{eur(p.total)}</span>
          </div>
        ))}
      </div>
      <Legend items={costLegend} className="mt-8" />

      <table className="invoice-table" style={{ marginTop: "20px" }}>
        <thead>
          <tr>
            <th>Person</th>
            <th>Farbe</th>
            <th>Mitgefahrene Strecke</th>
            <th>Anteiliger Umweg</th>
            <th style={{ textAlign: "right" }}>Betrag</th>
          </tr>
        </thead>
        <tbody>
          {persons.map(p => (
            <tr key={p.personId}>
              <td>
                <strong>{p.name}</strong>
                {p.sponsorBonus !== 0 && (
                  <div className="invoice-hint">
                    {p.sponsorBonus > 0 ? `Sponsor (+${eur(p.sponsorBonus)})` : `Gesponsert (-${eur(Math.abs(p.sponsorBonus))})`}
                  </div>
                )}
              </td>
              <td>
                <span style={{ display: "inline-block", width: "24px", height: "8px", borderRadius: "4px", background: p.color }}></span>
              </td>
              <td>{num(p.personKm)} km</td>
              <td>
                {p.detourCost > 0 ? (
                  <span>{p.sharedDetourKm ? num(p.sharedDetourKm) : num(p.detourKm || 0)} km ({eur(p.detourCost)})</span>
                ) : (
                  <span style={{ color: "#94a3b8" }}>-</span>
                )}
              </td>
              <td style={{ textAlign: "right", fontWeight: "bold" }}>
                {eur(p.finalTotal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              <strong>Gesamte Fahrt</strong>
            </td>
            <td><strong>{num(totalDistanceKm)} km</strong></td>
            <td></td>
            <td style={{ textAlign: "right", fontSize: "1.2rem", fontWeight: "bold" }}>
              {eur(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
      
      <div className="invoice-footer">
        <p>Vielen Dank für die Mitfahrt!</p>
      </div>
    </div>
  );
}
