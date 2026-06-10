import type { PersonResult, CalcConfig } from "../types";
import type { TripPlan } from "../trip";
import { eur, num } from "../App";
import { RouteMap } from "./RouteMap";

interface GeneralInvoiceProps {
  persons: PersonResult[];
  config: CalcConfig;
  tripPlan?: TripPlan;
  geometry?: any;
  grandTotal: number;
  totalDistanceKm: number;
}

export function GeneralInvoice({ persons, tripPlan, geometry, grandTotal, totalDistanceKm }: GeneralInvoiceProps) {
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

      <table className="invoice-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Farbe</th>
            <th>Mitgefahrene Strecke</th>
            <th>Zusätzlicher Umweg</th>
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
                {p.detourKm !== undefined && p.detourKm > 0 ? (
                  <span>{num(p.detourKm)} km ({eur(p.detourCost)})</span>
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
