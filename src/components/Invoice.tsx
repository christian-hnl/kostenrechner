import type { PersonResult } from "../types";
import type { TripPlan } from "../trip";
import { eur, num } from "../App";
import { RouteMap } from "./RouteMap";
import { Donut, Legend, COST_COLORS } from "./Charts";

interface InvoiceProps {
  person: PersonResult;
  allPersons: PersonResult[];
  tripPlan?: TripPlan;
  geometry?: any;
  grandTotal: number;
  driverId?: string | null;
}

export function Invoice({ person, allPersons, tripPlan, geometry, grandTotal, driverId }: InvoiceProps) {
  if (!person) return null;

  const isDriver = driverId != null && person.personId === driverId;

  const sponsorMsg =
    person.sponsorBonus > 0
      ? `Du hast als Sponsor großzügig ${eur(person.sponsorBonus)} von anderen übernommen!`
      : person.sponsorBonus < 0
      ? `Jemand anderes hat netterweise ${eur(Math.abs(person.sponsorBonus))} deiner Kosten getilgt.`
      : "";

  const costParts = [
    { label: "Sprit", value: person.fuelCost, color: COST_COLORS.fuel },
    { label: "Verschleiß", value: person.perKmExtraCost, color: COST_COLORS.perKm },
    { label: "Umweg", value: person.detourCost, color: COST_COLORS.detour },
    { label: "Fixkosten", value: person.fixedExtraCost, color: COST_COLORS.fixed },
  ];
  const sharePct = grandTotal > 0 ? (person.total / grandTotal) * 100 : 0;
  const pricePerKm = person.personKm > 0 ? person.total / person.personKm : 0;
  const detourKm = person.sharedDetourKm ?? person.detourKm ?? 0;

  return (
    <div className="invoice-container">
      <div className="invoice-header">
        <h1>Abrechnung Fahrgemeinschaft</h1>
        <p className="invoice-date">{new Date().toLocaleDateString("de-DE")}</p>
      </div>

      <div className="invoice-to">
        <h3>Rechnung für:</h3>
        <h2>{person.name}</h2>
      </div>

      <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
        {/* Map 1: Mitfahrer */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ margin: "0 0 10px 0", color: "#334155" }}>Wer fährt mit wem?</h4>
          <div className="invoice-map-box" style={{ height: "250px", marginBottom: "10px" }}>
            {(tripPlan || geometry) && (
              <RouteMap 
                tripPlan={tripPlan} 
                geometry={geometry} 
                persons={allPersons} 
                lightMode 
                highlightSharedForPerson={person.personId} 
              />
            )}
          </div>
          <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
            <strong>Mitfahrer auf deiner Route:</strong>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "4px" }}>
              {allPersons.map(p => (
                <span key={p.personId} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: p.color }}></span>
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Map 2: Kosten */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ margin: "0 0 10px 0", color: "#334155" }}>Kosten-Auslastung</h4>
          <div className="invoice-map-box" style={{ height: "250px", marginBottom: "10px" }}>
            {(tripPlan || geometry) && (
              <RouteMap
                tripPlan={tripPlan}
                geometry={geometry}
                persons={allPersons}
                lightMode
                highlightCostForPerson={person.personId}
                driverId={driverId}
              />
            )}
          </div>
          <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
            {isDriver ? (
              <>
                <strong>Kosteneinstufung:</strong>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#10b981" }}></span>
                    Hauptroute (nur diese zahlst du als Fahrer)
                  </span>
                  <span style={{ marginTop: "2px" }}>
                    Umwege zum Abholen/Absetzen fährst du zwar, zahlst sie aber nicht – die tragen die jeweils verursachenden Mitfahrer.
                  </span>
                </div>
              </>
            ) : (
              <>
                <strong>Kosteneinstufung:</strong>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#ef4444" }}></span>
                    Teuer (Alleinfahrt / Umweg)
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#f59e0b" }}></span>
                    Geteilt (zu zweit)
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#10b981" }}></span>
                    Günstig (ab 3 Personen)
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="analysis-grid" style={{ marginBottom: "20px" }}>
        <div className="donut-wrap">
          <Donut
            parts={costParts}
            centerLabel={eur(person.total)}
            centerSub="deine Kosten"
          />
        </div>
        <div className="analysis-blocks">
          <Legend items={costParts.filter((p) => p.value > 0)} />
          <div className="stat-tiles" style={{ marginTop: "12px" }}>
            <div className="stat-tile">
              <div className="stat-label">Gefahrene Strecke</div>
              <div className="stat-value">{num(person.personKm)} km</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Spritverbrauch</div>
              <div className="stat-value">{num(person.liters)} L</div>
              <div className="stat-hint">dein Anteil</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Ø Preis je km</div>
              <div className="stat-value">{eur(pricePerKm)}</div>
              <div className="stat-hint">über deine Strecke</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Anteil Gesamtkosten</div>
              <div className="stat-value">{num(sharePct)} %</div>
              <div className="stat-hint">von {eur(grandTotal)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Umweg-Anteil</div>
              <div className="stat-value">{num(detourKm)} km</div>
              <div className="stat-hint">{person.detourCost > 0 ? eur(person.detourCost) : "kein Umweg"}</div>
            </div>
          </div>
        </div>
      </div>

      <table className="invoice-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Menge</th>
            <th style={{ textAlign: "right" }}>Betrag</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Benzin / Strom</strong>
              <div className="invoice-hint">Anteilig gefahrene Strecke</div>
            </td>
            <td>{num(person.personKm)} km</td>
            <td style={{ textAlign: "right" }}>{eur(person.fuelCost)}</td>
          </tr>
          
          {person.perKmExtraCost > 0 && (
            <tr>
              <td>
                <strong>Verschleiß & Co.</strong>
                <div className="invoice-hint">Abnutzung pro gefahrenem km</div>
              </td>
              <td>{num(person.personKm)} km</td>
              <td style={{ textAlign: "right" }}>{eur(person.perKmExtraCost)}</td>
            </tr>
          )}
          
          {person.detourCost > 0 && (
            <tr>
              <td>
                <strong>Anteiliger Gesamt-Umweg</strong>
                <div className="invoice-hint">
                  {person.dropoffDetourKm !== undefined && person.dropoffDetourKm > 0.1
                    ? `Dein Anteil am gemeinsamen Umweg (Theoretischer Einzelumweg: ${num(person.detourKm || 0)} km)`
                    : `Reiner Abhol-Umweg (${num(person.detourKm || 0)} km)`}
                </div>
              </td>
              <td>{person.sharedDetourKm ? num(person.sharedDetourKm) : num(person.detourKm || 0)} km</td>
              <td style={{ textAlign: "right" }}>{eur(person.detourCost)}</td>
            </tr>
          )}

          {person.extraDetails && person.extraDetails.map((ext, idx) => (
            <tr key={`ext-${idx}`}>
              <td>
                <strong>{ext.label}</strong>
                <div className="invoice-hint">Anteilige Pauschale</div>
              </td>
              <td>-</td>
              <td style={{ textAlign: "right" }}>{eur(ext.amount)}</td>
            </tr>
          ))}

          {person.sponsorBonus !== 0 && (
            <tr className={person.sponsorBonus < 0 ? "text-green" : "text-red"}>
              <td>
                <strong>Sponsoring / Tilgung</strong>
                <div className="invoice-hint">{sponsorMsg}</div>
              </td>
              <td>-</td>
              <td style={{ textAlign: "right" }}>
                {person.sponsorBonus > 0 ? "+" : ""}{eur(person.sponsorBonus)}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              <strong>Zu zahlender Betrag</strong>
            </td>
            <td style={{ textAlign: "right", fontSize: "1.3rem", fontWeight: "bold" }}>
              {eur(person.finalTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
      
      <div className="invoice-footer">
        <p>Vielen Dank für die Mitfahrt! Gesamtkosten der Fahrt: {eur(grandTotal)}</p>
      </div>
    </div>
  );
}
