import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calculate } from "./calc";
import { cheapestOpen, fetchStations, type Station } from "./spritpreisrechner";
import { FuelMap } from "./components/FuelMap";
import { planTrip } from "./trip";
import type { TripPlan } from "./trip";
import { deletePerson, getPeople, savePerson, type PersonRecord } from "./db";
import { PlacesInput } from "./components/PlacesInput";
import { RouteMap } from "./components/RouteMap";
import { StackedBar, Donut, SegmentStrip, Legend, COST_COLORS, ROAD_COLORS } from "./components/Charts";
import { Invoice } from "./components/Invoice";
import { GeneralInvoice } from "./components/GeneralInvoice";
import {
  CarIcon,
  ClockIcon,
  EuroIcon,
  FuelIcon,
  LeafIcon,
  PinIcon,
  RouteIcon,
  UsersIcon,
} from "./components/icons";
import { segmentDistance } from "./types";
import type { CalcConfig, ExtraCost, FuelType, RoadType, Segment } from "./types";

const uid = () => Math.random().toString(36).slice(2, 9);

const ROAD_LABELS: Record<RoadType, string> = {
  stadt: "Stadt",
  dorf: "Dorf",
  landstrasse: "Landstraße",
  autobahn: "Autobahn",
};
const FUEL_LABELS: Record<FuelType, string> = {
  e5: "Super E5",
  e10: "Super E10",
  diesel: "Diesel",
};
const CO2_PER_L: Record<FuelType, number> = { e5: 2.37, e10: 2.32, diesel: 2.65 };

export const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const num = (n: number, d = 1) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

interface AppState {
  config: CalcConfig;
  extras: ExtraCost[];
  tk: { lat: string; lng: string; radiusKm: number };
  trip: { driverId: string | null; passengerIds: string[]; destination: string; roundTrip: boolean };
  segments: Segment[];
  directRoute?: any;
  passengerDetours?: Record<string, number>;
  passengerStandardDetours?: Record<string, number>;
  orsKey?: string;
  routeMode?: "fastest" | "shortest";
  avoidHighways?: boolean;
}

function defaultState(): AppState {
  return {
    config: {
      baseConsumption: 7,
      roadMultipliers: { stadt: 1.3, dorf: 1.15, landstrasse: 1.0, autobahn: 1.25 },
      pricePerLiter: 1.75,
      driverId: null,
      driverCostFactor: 1,
      fuelType: "e5",
    },
    extras: [
      { id: uid(), label: "Verschleiß/Service", enabled: false, mode: "perKm", amount: 0.1 },
      { id: uid(), label: "Maut/Vignette", enabled: false, mode: "fixed", amount: 0, fixedSplit: "gleich" },
      { id: uid(), label: "Parken", enabled: false, mode: "fixed", amount: 0, fixedSplit: "gleich" },
    ],
    tk: { lat: "", lng: "", radiusKm: 5 },
    trip: { driverId: null, passengerIds: [], destination: "", roundTrip: true },
    segments: [],
  };
}

const STORAGE_KEY = "kostenrechner.v4";

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const d = defaultState();
      
      // Migrate old state to support dorf
      if (parsed.config?.roadMultipliers && parsed.config.roadMultipliers.dorf === undefined) {
        parsed.config.roadMultipliers.dorf = 1.15;
      }
      if (parsed.segments) {
        for (const s of parsed.segments) {
          if (s.roadKm && s.roadKm.dorf === undefined) s.roadKm.dorf = 0;
        }
      }
      
      return {
        ...d,
        ...parsed,
        config: { ...d.config, ...parsed.config },
        trip: { ...d.trip, ...parsed.trip },
        tk: { ...d.tk, ...parsed.tk },
      };
    }
  } catch {
    /* ignore */
  }
  return defaultState();
}

export function App() {
  const [state, setState] = useState<AppState>(loadState);
  const { config, extras, tk, trip, segments } = state;
  const [people, setPeople] = useState<PersonRecord[]>([]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Personen aus der DB laden – beim ersten Start mit Demo-Daten füllen.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    (async () => {
      let list = await getPeople();
      if (list.length === 0) {
        const anna: PersonRecord = { id: uid(), name: "Anna", homeAddress: "Berlin" };
        const ben: PersonRecord = { id: uid(), name: "Ben", homeAddress: "Leipzig" };
        await savePerson(anna);
        await savePerson(ben);
        list = [anna, ben];
        setState((s) =>
          s.trip.driverId
            ? s
            : {
                ...s,
                trip: { ...s.trip, driverId: anna.id, passengerIds: [ben.id], destination: "München" },
                segments: [
                  { id: uid(), label: "Anna (Start) → Ben abholen", roadKm: { stadt: 5, dorf: 2, landstrasse: 25, autobahn: 160 }, presentIds: [anna.id] },
                  { id: uid(), label: "Ben → München", roadKm: { stadt: 10, dorf: 0, landstrasse: 40, autobahn: 300 }, presentIds: [anna.id, ben.id] },
                  { id: uid(), label: "München → Ben (zurück)", roadKm: { stadt: 10, dorf: 0, landstrasse: 40, autobahn: 300 }, presentIds: [anna.id, ben.id] },
                  { id: uid(), label: "Ben → Anna (zurück)", roadKm: { stadt: 5, dorf: 2, landstrasse: 25, autobahn: 160 }, presentIds: [anna.id] },
                ],
              },
        );
      }
      setPeople(list);
    })();
  }, []);

  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));
  const patchConfig = (p: Partial<CalcConfig>) =>
    setState((s) => ({ ...s, config: { ...s.config, ...p } }));
  const patchTrip = (p: Partial<AppState["trip"]>) =>
    setState((s) => ({ ...s, trip: { ...s.trip, ...p } }));

  // ---------- Personen-Datenbank ----------
  const addPersonRecord = async () => {
    const rec: PersonRecord = { id: uid(), name: `Person ${people.length + 1}`, homeAddress: "" };
    await savePerson(rec);
    setPeople((l) => [...l, rec].sort((a, b) => a.name.localeCompare(b.name, "de")));
  };
  const updatePersonRecord = async (id: string, p: Partial<PersonRecord>) => {
    const rec = people.find((x) => x.id === id);
    if (!rec) return;
    const next = { ...rec, ...p };
    setPeople((l) => l.map((x) => (x.id === id ? next : x)));
    await savePerson(next);
  };
  const removePersonRecord = async (id: string) => {
    await deletePerson(id);
    setPeople((l) => l.filter((x) => x.id !== id));
    patchTrip({
      driverId: trip.driverId === id ? null : trip.driverId,
      passengerIds: trip.passengerIds.filter((x) => x !== id),
    });
  };

  const selectDriver = (id: string) =>
    patchTrip({ driverId: id, passengerIds: trip.passengerIds.filter((x) => x !== id) });
  const togglePassenger = (id: string) =>
    patchTrip({
      passengerIds: trip.passengerIds.includes(id)
        ? trip.passengerIds.filter((x) => x !== id)
        : [...trip.passengerIds, id],
    });

  // ---------- Routenplanung ----------
  const [geometry, setGeometry] = useState<any>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ km: number; min: number } | null>(null);
  const [lastPlan, setLastPlan] = useState<TripPlan | null>(null);
  const [printPersonId, setPrintPersonId] = useState<string | null>(null);

  // Focus specific person print
  useEffect(() => {
    if (printPersonId !== null) {
      // Force leaflet map to invalidate size and tiles to load
      window.dispatchEvent(new Event('resize'));
      setTimeout(() => {
        window.print();
        setPrintPersonId(null);
      }, 2500); // Wait longer for all 9 maps (1 general + 8 individual) to render and load tiles
    }
  }, [printPersonId]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const planTripHandler = async () => {
    setRouteError(null);
    const driver = people.find((p) => p.id === trip.driverId);
    if (!driver) return setRouteError("Bitte einen Fahrer auswählen.");
    if (!driver.homeAddress.trim()) return setRouteError(`Wohnort von ${driver.name} fehlt.`);
    if (!trip.destination.trim()) return setRouteError("Bitte ein Ziel angeben.");
    const passengers = trip.passengerIds
      .map((id) => people.find((p) => p.id === id))
      .filter((p): p is PersonRecord => !!p);
    const missing = passengers.filter((p) => !p.homeAddress.trim());
    if (missing.length) return setRouteError(`Wohnort fehlt bei: ${missing.map((p) => p.name).join(", ")}`);

    setRouteBusy(true);
    try {
      const plan = await planTrip({
        driver,
        passengers,
        destination: trip.destination,
        roundTrip: trip.roundTrip,
        orsKey: state.orsKey,
        routeMode: state.routeMode || "fastest",
        avoidHighways: state.avoidHighways || false,
      });
      setLastPlan(plan);
      setGeometry(plan.info.geometry);
      patch({ segments: plan.segments, directRoute: plan.directInfo, passengerDetours: plan.passengerDetours, passengerStandardDetours: plan.passengerStandardDetours });
      setRouteInfo({
        km: plan.info.totalKm,
        min: plan.info.totalMin,
      });
    } catch (e: any) {
      setRouteError(e.message ?? "Route konnte nicht berechnet werden.");
    } finally {
      setRouteBusy(false);
    }
  };

  // ---------- Etappen (auto-befüllt, editierbar) ----------
  const updateSegment = (id: string, p: Partial<Segment>) =>
    patch({ segments: segments.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const updateRoadKm = (id: string, type: RoadType, value: number) =>
    patch({
      segments: segments.map((s) =>
        s.id === id ? { ...s, roadKm: { ...s.roadKm, [type]: value } } : s,
      ),
    });
  const removeSegment = (id: string) => patch({ segments: segments.filter((s) => s.id !== id) });
  const addSegment = () =>
    patch({
      segments: [
        ...segments,
        { id: uid(), label: `Etappe ${segments.length + 1}`, roadKm: { stadt: 0, dorf: 0, landstrasse: 0, autobahn: 0 }, presentIds: tripPersonIds },
      ],
    });
  const togglePresence = (segId: string, personId: string) =>
    patch({
      segments: segments.map((s) => {
        if (s.id !== segId) return s;
        const present = s.presentIds.includes(personId)
          ? s.presentIds.filter((x) => x !== personId)
          : [...s.presentIds, personId];
        return { ...s, presentIds: present };
      }),
    });

  // ---------- Zusatzkosten ----------
  const addExtra = () =>
    patch({
      extras: [
        ...extras,
        { id: uid(), label: "Eigener Posten", enabled: true, mode: "fixed", amount: 0, fixedSplit: "gleich" },
      ],
    });
  const updateExtra = (id: string, p: Partial<ExtraCost>) =>
    patch({ extras: extras.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const removeExtra = (id: string) => patch({ extras: extras.filter((e) => e.id !== id) });

  // ---------- Tankerkönig ----------
  const [stations, setStations] = useState<Station[]>([]);
  const [tkLoading, setTkLoading] = useState(false);
  const [tkError, setTkError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const useGeolocation = () => {
    if (!navigator.geolocation) return setTkError("Geolocation nicht verfügbar.");
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        patch({ tk: { ...tk, lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5) } }),
      (err) => setTkError(`Standort nicht verfügbar: ${err.message}`),
    );
  };
  const searchStations = async () => {
    setTkError(null);
    const lat = parseFloat(tk.lat);
    const lng = parseFloat(tk.lng);
    if (!isFinite(lat) || !isFinite(lng)) return setTkError("Bitte gültige Koordinaten angeben.");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTkLoading(true);
    try {
      const list = await fetchStations({ lat, lng, fuelType: config.fuelType, signal: ctrl.signal });
      setStations(list);
      const cheapest = cheapestOpen(list);
      if (cheapest) patchConfig({ pricePerLiter: cheapest.price });
      else setTkError("Keine Tankstellen mit Preis gefunden.");
    } catch (e: any) {
      if (e.name !== "AbortError") setTkError(e.message ?? "Fehler bei der Abfrage.");
    } finally {
      setTkLoading(false);
    }
  };

  // ---------- Berechnung ----------
  const tripPersons = useMemo(() => {
    const ids = [trip.driverId, ...trip.passengerIds].filter((x): x is string => !!x);
    const uniq = [...new Set(ids)];
    return uniq
      .map((id) => people.find((p) => p.id === id))
      .filter((r): r is PersonRecord => !!r)
      .map((r) => ({ id: r.id, name: r.name }));
  }, [trip, people]);
  const tripPersonIds = tripPersons.map((p) => p.id);

  const calcConfig = useMemo(() => ({ ...config, driverId: trip.driverId }), [config, trip.driverId]);
  const result = useMemo(
    () => calculate(calcConfig, people, segments, extras, state.directRoute, state.passengerDetours, state.passengerStandardDetours),
    [calcConfig, people, segments, extras, state.directRoute, state.passengerDetours, state.passengerStandardDetours],
  );
  const co2 = result.totalLiters * CO2_PER_L[config.fuelType];
  const costPerKm = result.totalDistanceKm > 0 ? result.grandTotal / result.totalDistanceKm : 0;
  const durationLabel = routeInfo ? `${Math.floor(routeInfo.min / 60)} h ${Math.round(routeInfo.min % 60)} min` : "–";
  const maxPersonTotal = Math.max(0, ...result.perPerson.map((p) => p.total));

  // ---------- Analyse-Kennzahlen ----------
  const analysis = useMemo(() => {
    const roadTotals: Record<RoadType, number> = { stadt: 0, dorf: 0, landstrasse: 0, autobahn: 0 };
    for (const s of segments) {
      roadTotals.stadt += s.roadKm.stadt;
      roadTotals.dorf += s.roadKm.dorf;
      roadTotals.landstrasse += s.roadKm.landstrasse;
      roadTotals.autobahn += s.roadKm.autobahn;
    }
    const totalPersonKm = result.perPerson.reduce((sum, p) => sum + p.personKm, 0);
    const avgOccupancy = result.totalDistanceKm > 0 ? totalPersonKm / result.totalDistanceKm : 0;
    const directKm = state.directRoute?.totalKm ?? 0;
    const detourKm = Math.max(0, result.totalDistanceKm - directKm);
    const detourPct = directKm > 0 ? (detourKm / directKm) * 100 : 0;
    const occSegments = segments
      .map((s) => ({
        km: segmentDistance(s),
        count: s.presentIds.filter((id) => tripPersonIds.includes(id)).length,
        label: s.label,
      }))
      .filter((s) => s.km > 0);
    return { roadTotals, totalPersonKm, avgOccupancy, directKm, detourKm, detourPct, occSegments };
  }, [segments, result.perPerson, result.totalDistanceKm, state.directRoute, tripPersonIds]);

  const costComposition = [
    { label: "Sprit", value: result.totalFuelCost, color: COST_COLORS.fuel },
    { label: "Verschleiß", value: result.totalPerKmExtra, color: COST_COLORS.perKm },
    { label: "Fixkosten", value: result.totalFixedExtra, color: COST_COLORS.fixed },
  ];

  const [copied, setCopied] = useState(false);
  const copySummary = async () => {
    const lines = [
      "Faire Fahrtkosten",
      `Strecke: ${num(result.totalDistanceKm)} km · ${num(result.totalLiters, 2)} l · ${eur(result.grandTotal)}`,
      "",
      ...result.perPerson.map((p) => `${p.name}: ${eur(p.total)} (${num(p.personKm)} km)`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const passengerChoices = people.filter((p) => p.id !== trip.driverId);

  return (
    <Fragment>
      <div className="app">
      <header className="topbar">
        <div className="brand">
          <CarIcon size={22} />
          <div>
            <h1>Fahrtkosten-Rechner</h1>
            <span>Automatisch fair – nach Wohnort &amp; gefahrenen Personen-Kilometern</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={copySummary}>{copied ? "Kopiert ✓" : "Zusammenfassung kopieren"}</button>
          <button type="button" className="ghost" onClick={() => {
            if (confirm("Eingaben (ohne gespeicherte Personen) zurücksetzen?")) {
              setState(s => ({ ...defaultState(), orsKey: s.orsKey, routeMode: s.routeMode, avoidHighways: s.avoidHighways }));
              setStations([]);
              setGeometry(null);
              setRouteInfo(null);
            }
          }}>Zurücksetzen</button>
        </div>
      </header>

      <div className="dashboard">
        <aside className="sidebar">
          {/* Fahrt planen */}
          <section className="card">
            <h2><RouteIcon /> Fahrt planen</h2>
            <label>Ziel
              <PlacesInput value={trip.destination} placeholder="Zieladresse"
                onChange={(v) => patchTrip({ destination: v })} />
            </label>
            <label>Fahrer
              <select value={trip.driverId ?? ""} onChange={(e) => selectDriver(e.target.value)}>
                <option value="" disabled>– wählen –</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div className="field-label">Mitfahrer</div>
            <div className="passenger-list">
              {passengerChoices.length === 0 && <span className="hint">Erst Personen speichern.</span>}
              {passengerChoices.map((p) => (
                <label key={p.id} className="chip">
                  <input type="checkbox" checked={trip.passengerIds.includes(p.id)}
                    onChange={() => togglePassenger(p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
            <div className="seg-toggle">
              <button type="button" className={trip.roundTrip ? "" : "active"} onClick={() => patchTrip({ roundTrip: false })}>Nur Hinfahrt</button>
              <button type="button" className={trip.roundTrip ? "active" : ""} onClick={() => patchTrip({ roundTrip: true })}>Hin &amp; zurück</button>
            </div>
            <label>
              Kostenfaktor Fahrer: {Math.round(config.driverCostFactor * 100)}%
              <input type="range" min="0" max="1" step="0.05" value={config.driverCostFactor}
                onChange={(e) => patchConfig({ driverCostFactor: parseFloat(e.target.value) })} />
              <span className="hint" style={{marginTop: "-4px"}}>100% = Fahrer zahlt regulär. 0% = Fahrer fährt kostenlos.</span>
            </label>
            <div className="btn-row" style={{marginTop: "1rem"}}>
              <button type="button" className="primary block" onClick={planTripHandler} disabled={routeBusy}>
                {routeBusy ? "Berechne..." : "Route & Kosten berechnen"}
              </button>
              {result && (
                <button type="button" className="block ghost" style={{ border: "1px solid var(--input-border)" }} onClick={() => setPrintPersonId("ALL")}>
                  🖨️ Allgemeine Übersicht (PDF)
                </button>
              )}
            </div>
          </section>
          
          <div className="card">
            <label style={{ marginBottom: "1rem", display: "block" }}>
              <strong style={{ color: "var(--accent)", fontSize: "1.05rem" }}>Kosten tilgen (Sponsoring)</strong>
              <div className="hint" style={{ marginTop: "4px" }}>Wer übernimmt die Kosten für andere?</div>
            </label>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.2rem", marginBottom: "0.5rem" }}>
              <select
                value={config.sponsorId || ""}
                onChange={(e) => patchConfig({ sponsorId: e.target.value || null })}
                style={{ flex: 1 }}
              >
                <option value="">Kein Sponsor</option>
                {tripPersons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {config.sponsorId && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={config.sponsorPercent || 0}
                    onChange={(e) => patchConfig({ sponsorPercent: parseInt(e.target.value) || 0 })}
                  />
                  <span>{config.sponsorPercent || 0}%</span>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2>⚙️ Profi-Routing (Optional)</h2>
            <p className="hint" style={{marginBottom: "12px"}}>Für Spezialfunktionen wird ein kostenloser OpenRouteService API-Key benötigt.</p>
            <label>
              OpenRouteService API Key
              <input type="text" value={state.orsKey || ""} onChange={e => patch({ orsKey: e.target.value })} placeholder="Token hier einfügen..." />
            </label>
            {state.orsKey && state.orsKey.trim().length > 10 && (
              <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <label className="check" style={{ margin: 0 }}>
                  <input type="checkbox" checked={state.routeMode === "shortest"} onChange={e => patch({ routeMode: e.target.checked ? "shortest" : "fastest" })} />
                  Kürzester Weg (statt schnellster)
                </label>
                <label className="check" style={{ margin: 0 }}>
                  <input type="checkbox" checked={state.avoidHighways} onChange={e => patch({ avoidHighways: e.target.checked })} />
                  Autobahn vermeiden
                </label>
              </div>
            )}
            {routeError && <p className="error">{routeError}</p>}
          </div>

          {/* Gespeicherte Personen */}
          <section className="card">
            <h2><UsersIcon /> Gespeicherte Personen</h2>
            <p className="hint">Name + Wohnort einmal speichern – danach einfach oben auswählen. Gespeichert in der lokalen Datenbank (IndexedDB).</p>
            {people.map((p) => (
              <div className="db-person" key={p.id} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: "0 0 100px" }}>
                  <input className="db-name" value={p.name || ""} placeholder="Name"
                    onChange={(e) => updatePersonRecord(p.id, { name: e.target.value })} />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <PlacesInput value={p.homeAddress} placeholder="Wohnort / Abholort"
                    onChange={(v) => updatePersonRecord(p.id, { homeAddress: v })} />
                  <PlacesInput value={p.outboundDropoff || ""} placeholder="Absetz-Ort Hinweg (leer = Ziel)"
                    onChange={(v) => updatePersonRecord(p.id, { outboundDropoff: v })} />
                  <PlacesInput value={p.returnDropoff || ""} placeholder="Absetz-Ort Rückweg (leer = Wohnort)"
                    onChange={(v) => updatePersonRecord(p.id, { returnDropoff: v })} />
                </div>
                <button type="button" className="del" onClick={() => removePersonRecord(p.id)}>✕</button>
              </div>
            ))}
            <div className="btn-row"><button type="button" onClick={addPersonRecord}>+ Person speichern</button></div>
          </section>

          {/* Fahrzeug & Sprit */}
          <section className="card">
            <h2><FuelIcon /> Fahrzeug &amp; Sprit</h2>
            <div className="row">
              <label>Verbrauch (l/100 km)
                <input type="number" step="0.1" min="0" value={config.baseConsumption}
                  onChange={(e) => patchConfig({ baseConsumption: parseFloat(e.target.value) || 0 })} />
              </label>
              <label>Spritsorte
                <select value={config.fuelType} onChange={(e) => patchConfig({ fuelType: e.target.value as FuelType })}>
                  {(Object.keys(FUEL_LABELS) as FuelType[]).map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}
                </select>
              </label>
              <label>Preis (€/l)
                <input type="number" step="0.001" min="0" value={config.pricePerLiter}
                  onChange={(e) => patchConfig({ pricePerLiter: parseFloat(e.target.value) || 0 })} />
              </label>
            </div>
            <details className="advanced">
              <summary>Verbrauchs-Faktoren je Straßentyp</summary>
              <div className="row">
                {(Object.keys(ROAD_LABELS) as RoadType[]).map((rt) => (
                  <label key={rt}>{ROAD_LABELS[rt]} ×
                    <input type="number" step="0.05" min="0" value={config.roadMultipliers[rt]}
                      onChange={(e) => patchConfig({ roadMultipliers: { ...config.roadMultipliers, [rt]: parseFloat(e.target.value) || 0 } })} />
                  </label>
                ))}
              </div>
            </details>
          </section>

          {/* Tankstelle */}
          <section className="card">
            <h2><EuroIcon /> Günstigste Tankstelle (E-Control Österreich)</h2>
            <p className="hint">Kostenlose und öffentliche API. Die günstigste Tankstelle wird als Spritpreis übernommen.</p>
            <div className="row">
              <label>Breite (lat)<input type="text" value={tk.lat || ""} placeholder="52.52" onChange={(e) => patch({ tk: { ...tk, lat: e.target.value } })} /></label>
              <label>Länge (lng)<input type="text" value={tk.lng || ""} placeholder="13.405" onChange={(e) => patch({ tk: { ...tk, lng: e.target.value } })} /></label>
              <label>Umkreis km<input type="number" min="1" max="25" value={tk.radiusKm || 5} onChange={(e) => patch({ tk: { ...tk, radiusKm: parseInt(e.target.value) || 1 } })} /></label>
            </div>
            <div className="btn-row">
              <button type="button" onClick={useGeolocation}>Standort nutzen</button>
              <button type="button" className="primary" onClick={searchStations} disabled={tkLoading}>{tkLoading ? "Suche…" : "Günstigste suchen"}</button>
            </div>
            {tkError && <p className="error">{tkError}</p>}
            {stations.length > 0 && (
              <ul className="stations">
                {stations.slice(0, 4).map((s, i) => (
                  <li key={s.id} className={i === 0 ? "best" : ""}>
                    <span><strong>{eur(s.price)}</strong> {s.brand || s.name}<small> · {s.place} · {num(s.dist)} km{s.isOpen ? "" : " · zu"}</small></span>
                    <button type="button" onClick={() => patchConfig({ pricePerLiter: s.price })}>nutzen</button>
                  </li>
                ))}
              </ul>
            )}
            {stations.length > 0 && tk.lat && tk.lng && (
              <div style={{ marginTop: "1rem", zIndex: 0, position: "relative" }}>
                <FuelMap center={{ lat: parseFloat(tk.lat), lng: parseFloat(tk.lng) }} stations={stations} />
              </div>
            )}
          </section>

          {/* Kostenarten */}
          <section className="card">
            <h2>Kostenarten</h2>
            <p className="hint">Sprit ist immer dabei. „pro km" wird nach Anwesenheit verteilt, „fix" auf alle Reisenden.</p>
            {extras.map((e) => (
              <div className="extra" key={e.id}>
                <label className="check">
                  <input type="checkbox" checked={e.enabled} onChange={(ev) => updateExtra(e.id, { enabled: ev.target.checked })} />
                  <input className="extra-label" value={e.label} onChange={(ev) => updateExtra(e.id, { label: ev.target.value })} />
                </label>
                <select value={e.mode} onChange={(ev) => updateExtra(e.id, { mode: ev.target.value as ExtraCost["mode"] })}>
                  <option value="perKm">€/km</option>
                  <option value="fixed">€ fix</option>
                </select>
                <input type="number" step="0.01" min="0" value={e.amount} onChange={(ev) => updateExtra(e.id, { amount: parseFloat(ev.target.value) || 0 })} />
                {e.mode === "fixed" && (
                  <select value={e.fixedSplit ?? "gleich"} onChange={(ev) => updateExtra(e.id, { fixedSplit: ev.target.value as ExtraCost["fixedSplit"] })}>
                    <option value="gleich">gleich</option>
                    <option value="nachKm">nach km</option>
                  </select>
                )}
                <button type="button" className="del" onClick={() => removeExtra(e.id)}>✕</button>
              </div>
            ))}
            <div className="btn-row"><button type="button" onClick={addExtra}>+ Posten</button></div>
          </section>
        </aside>

        <main className="main">
          <div className="kpis">
            <Kpi icon={<RouteIcon />} label="Strecke" value={`${num(result.totalDistanceKm)} km`} />
            <Kpi icon={<ClockIcon />} label="Fahrzeit" value={durationLabel} />
            <Kpi icon={<FuelIcon />} label="Verbrauch" value={`${num(result.totalLiters, 2)} l`} />
            <Kpi icon={<EuroIcon />} label="Gesamtkosten" value={eur(result.grandTotal)} accent />
            <Kpi icon={<EuroIcon />} label="Kosten / km" value={eur(costPerKm)} />
            <Kpi icon={<LeafIcon />} label="CO₂" value={`${num(co2, 1)} kg`} />
          </div>

          <section className="card">
            <h2><PinIcon /> Karte</h2>
            {geometry ? <RouteMap geometry={geometry} tripPlan={lastPlan || undefined} persons={result?.perPerson || undefined} /> : (
              <div className="map placeholder"><p>Karte erscheint nach „Fahrt berechnen".</p></div>
            )}
          </section>

          {segments.length > 0 && (
            <section className="card">
              <h2><RouteIcon /> Fahrt-Analyse</h2>
              <div className="analysis-grid">
                <div className="donut-wrap">
                  <Donut parts={costComposition} centerLabel={eur(result.grandTotal)} centerSub="Gesamt" />
                  <Legend
                    items={[
                      { label: "Sprit", color: COST_COLORS.fuel },
                      { label: "Verschleiß", color: COST_COLORS.perKm },
                      { label: "Fixkosten", color: COST_COLORS.fixed },
                    ]}
                  />
                </div>
                <div className="analysis-blocks">
                  <div>
                    <div className="analysis-block-title">Straßentypen</div>
                    <StackedBar
                      height={22}
                      parts={[
                        { label: "Stadt", value: analysis.roadTotals.stadt, color: ROAD_COLORS.stadt },
                        { label: "Dorf", value: analysis.roadTotals.dorf, color: ROAD_COLORS.dorf },
                        { label: "Landstraße", value: analysis.roadTotals.landstrasse, color: ROAD_COLORS.landstrasse },
                        { label: "Autobahn", value: analysis.roadTotals.autobahn, color: ROAD_COLORS.autobahn },
                      ]}
                    />
                    <Legend
                      className="mt-8"
                      items={[
                        { label: `Stadt ${num(analysis.roadTotals.stadt)} km`, color: ROAD_COLORS.stadt },
                        { label: `Dorf ${num(analysis.roadTotals.dorf)} km`, color: ROAD_COLORS.dorf },
                        { label: `Land ${num(analysis.roadTotals.landstrasse)} km`, color: ROAD_COLORS.landstrasse },
                        { label: `Autobahn ${num(analysis.roadTotals.autobahn)} km`, color: ROAD_COLORS.autobahn },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="analysis-block-title">Auslastungsprofil (Personen je Etappe)</div>
                    <SegmentStrip segments={analysis.occSegments} />
                  </div>
                  <div className="stat-tiles">
                    <div className="stat-tile">
                      <div className="stat-label">Ø Auslastung</div>
                      <div className="stat-value">{num(analysis.avgOccupancy, 2)}</div>
                      <div className="stat-hint">Personen pro km</div>
                    </div>
                    <div className="stat-tile">
                      <div className="stat-label">Umweg</div>
                      <div className="stat-value" style={{ color: analysis.detourKm > 0 ? "var(--warn)" : "var(--good)" }}>
                        {num(analysis.detourKm)} km
                      </div>
                      <div className="stat-hint">
                        {analysis.directKm > 0 ? `+${num(analysis.detourPct, 0)}% ggü. Direktweg` : "kein Direktweg bekannt"}
                      </div>
                    </div>
                    <div className="stat-tile">
                      <div className="stat-label">Kosten / km</div>
                      <div className="stat-value">{eur(costPerKm)}</div>
                      <div className="stat-hint">Schnitt über alle</div>
                    </div>
                    <div className="stat-tile">
                      <div className="stat-label">CO₂</div>
                      <div className="stat-value">{num(co2, 1)} kg</div>
                      <div className="stat-hint">{num(result.totalLiters, 1)} l verbraucht</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <h2><RouteIcon /> Etappen &amp; Mitfahrer</h2>
            <p className="hint">Automatisch aus der Route befüllt: km je Straßentyp und wer ab wo mitfährt. Alles editierbar.</p>
            <div className="matrix-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>Etappe</th>
                    <th className="kmcol">Stadt</th>
                    <th className="kmcol">Dorf</th>
                    <th className="kmcol">Land</th>
                    <th className="kmcol">Autob.</th>
                    <th className="kmcol">Σ km</th>
                    {tripPersons.map((p) => <th key={p.id} className="pcol">{p.name || "?"}</th>)}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {segments.length === 0 && (
                    <tr><td colSpan={6 + tripPersons.length} className="empty">Noch keine Etappen – „Fahrt berechnen" oder „+ Etappe".</td></tr>
                  )}
                  {segments.map((s) => (
                    <tr key={s.id}>
                      <td><input className="seg-label" value={s.label} onChange={(e) => updateSegment(s.id, { label: e.target.value })} /></td>
                      {(["stadt", "dorf", "landstrasse", "autobahn"] as RoadType[]).map((rt) => (
                        <td key={rt} className="kmcol">
                          <input type="number" min="0" step="0.1" className="seg-km" value={s.roadKm[rt]}
                            onChange={(e) => updateRoadKm(s.id, rt, parseFloat(e.target.value) || 0)} />
                        </td>
                      ))}
                      <td className="kmcol sum">{num(segmentDistance(s))}</td>
                      {tripPersons.map((p) => (
                        <td key={p.id} className="pcol">
                          <input type="checkbox" checked={s.presentIds.includes(p.id)} onChange={() => togglePresence(s.id, p.id)} />
                        </td>
                      ))}
                      <td><button type="button" className="del" onClick={() => removeSegment(s.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row"><button type="button" onClick={addSegment}>+ Etappe</button></div>
          </section>

          <section className="card">
            <h2><UsersIcon /> Wer zahlt was</h2>
            {result.warnings.length > 0 && (
              <ul className="warnings">{result.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
            )}
            <div className="breakdown">
              {result.perPerson
                .filter((p) => p.total > 0 || p.personId === config.driverId)
                .map((p) => (
                  <div className="breakdown-row" key={p.personId}>
                    <div className="breakdown-name">
                      <span className="swatch" style={{ background: p.color }} />
                      <span className="name-text">{p.name}</span>
                    </div>
                    <StackedBar
                      total={maxPersonTotal}
                      parts={[
                        { label: "Sprit", value: p.fuelCost, color: COST_COLORS.fuel },
                        { label: "Verschleiß", value: p.perKmExtraCost, color: COST_COLORS.perKm },
                        { label: "Umweg", value: p.detourCost, color: COST_COLORS.detour },
                        { label: "Fixkosten", value: p.fixedExtraCost, color: COST_COLORS.fixed },
                      ]}
                    />
                    <div className="breakdown-total">
                      {eur(p.finalTotal)}
                      <small>{num(p.personKm)} km</small>
                    </div>
                  </div>
                ))}
              <Legend
                items={[
                  { label: "Sprit", color: COST_COLORS.fuel },
                  { label: "Verschleiß", color: COST_COLORS.perKm },
                  { label: "Umweg", color: COST_COLORS.detour },
                  { label: "Fixkosten", color: COST_COLORS.fixed },
                ]}
              />
            </div>
            <table className="result-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Strecke</th>
                  <th>Sprit</th>
                  {extras.some((e) => e.enabled && e.mode === "perKm") && <th>Verschleiß</th>}
                  {extras.some((e) => e.enabled && e.mode === "fixed") && <th>Fixkosten</th>}
                  {result.detourCost > 0 && <th>Umweg</th>}
                  <th>Zu zahlen</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {result.perPerson.filter(r => r.personKm > 0 || r.personId === config.driverId).map((r) => {
                  const isDriver = r.personId === config.driverId;
                  const isExpanded = expandedRow === r.personId;
                  return (
                    <Fragment key={r.personId}>
                      <tr>
                        <td>
                          {r.name}
                          {isDriver && <span className="badge">Fahrer</span>}
                        </td>
                        <td>{num(r.personKm)} km</td>
                        <td>{eur(r.fuelCost)}</td>
                        {extras.some((e) => e.enabled && e.mode === "perKm") && <td>{eur(r.perKmExtraCost)}</td>}
                        {extras.some((e) => e.enabled && e.mode === "fixed") && <td>{eur(r.fixedExtraCost)}</td>}
                        {result.detourCost > 0 && <td>{r.detourCost > 0 ? eur(r.detourCost) : "-"}</td>}
                        <td className="pcol pay">
                           {eur(r.finalTotal)}
                           <br />
                           {r.sponsorBonus !== 0 && (
                             <small style={{ color: r.sponsorBonus < 0 ? "var(--good)" : "var(--warn)", display: "block", marginTop: "4px" }}>
                               {r.sponsorBonus > 0 ? "Zahlt " : "Spart "}{eur(Math.abs(r.sponsorBonus))}
                             </small>
                           )}
                         </td>
                         <td className="pcol">
                           <div style={{display: "flex", gap: "8px", justifyContent: "center"}}>
                             <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => setExpandedRow(expandedRow === r.personId ? null : r.personId)}>
                               {expandedRow === r.personId ? "▲ Zu" : "▼ Info"}
                             </button>
                             <button type="button" className="ghost" style={{ padding: "4px 8px" }} onClick={() => setPrintPersonId(r.personId)}>
                               🖨️ PDF
                             </button>
                           </div>
                         </td>
                      </tr>
                      {isExpanded && (
                        <tr className="details-row">
                          <td colSpan={10} style={{ padding: 0, borderBottom: "1px solid var(--card-border)" }}>
                            <div style={{ padding: "1.2rem", background: "rgba(0,0,0,0.3)", margin: "8px", borderRadius: "var(--radius-md)", borderLeft: "4px solid var(--accent)", textAlign: "left" }}>
                               <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem" }}><strong>Detail-Abrechnung für {r.name}:</strong></p>
                               <ul style={{ margin: 0, paddingLeft: "1.5rem", lineHeight: "1.6", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                                 <li><strong style={{color: "var(--text-main)"}}>Basis-Strecke:</strong> Fährt <strong>{num(r.personKm)} km</strong> der Strecke mit. Anteil an Basis-Kosten: <strong style={{color: "var(--text-main)"}}>{eur(r.fuelCost + r.perKmExtraCost)}</strong></li>
                                 {r.detourKm !== undefined && !isDriver && (
                                   <li>
                                     <strong style={{color: "var(--text-main)"}}>Umweg:</strong> {r.detourKm > 0 ? (
                                       r.dropoffDetourKm !== undefined && r.dropoffDetourKm > 0.1 ? (
                                         <span>Du verursachst insgesamt <strong>{num(r.detourKm)} km</strong> eigenen Umweg. Davon <strong style={{color: "var(--text-main)"}}>{num(r.standardDetourKm || 0)} km</strong> für deine reine Abholung und <strong style={{color: "var(--text-main)"}}>{num(r.dropoffDetourKm)} km</strong> extra für deine Sonder-Absetzorte! Anteil an den Umweg-Kosten: <strong style={{color: "var(--text-main)"}}>{eur(r.detourCost)}</strong></span>
                                       ) : (
                                         <span>Hat einen reinen Abhol-Umweg von <strong>{num(r.detourKm)} km</strong> verursacht. Anteil an gesamten Umweg-Kosten: <strong style={{color: "var(--text-main)"}}>{eur(r.detourCost)}</strong></span>
                                       )
                                     ) : <span>Hat keinen eigenen Umweg verursacht (0 km). Zahlt daher <strong style={{color: "var(--text-main)"}}>0,00 €</strong> vom restlichen Umweg.</span>}
                                   </li>
                                 )}
                                 {r.fixedExtraCost > 0 && (
                                   <li><strong style={{color: "var(--text-main)"}}>Fixkosten:</strong> Anteil an fixen Spesen (Maut/Parken): <strong style={{color: "var(--text-main)"}}>{eur(r.fixedExtraCost)}</strong></li>
                                 )}
                                 {r.sponsorBonus !== 0 && (
                                   <li><strong style={{color: r.sponsorBonus < 0 ? "var(--good)" : "var(--warn)"}}>Sponsoring:</strong> {r.sponsorBonus > 0 ? `Übernimmt freundlicherweise ${eur(r.sponsorBonus)} von anderen.` : `Bekommt ${eur(Math.abs(r.sponsorBonus))} von jemand anderem erlassen.`}</li>
                                 )}
                                 <li style={{marginTop: "0.5rem", color: "var(--text-main)"}}><strong>Summe:</strong> <strong style={{color: "var(--good-hover)"}}>{eur(r.finalTotal)}</strong></li>
                               </ul>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Gesamt</td>
                  <td>{num(result.totalDistanceKm)} km</td>
                  <td>{eur(result.totalFuelCost)}</td>
                  {extras.some((e) => e.enabled && e.mode === "perKm") && <td>{eur(result.totalPerKmExtra)}</td>}
                  {extras.some((e) => e.enabled && e.mode === "fixed") && <td>{eur(result.totalFixedExtra)}</td>}
                  {result.detourCost > 0 && <td>{eur(result.detourCost)}</td>}
                  <td className="pay">{eur(result.grandTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </section>
        </main>
      </div>
      </div>

      <div className="print-only">
        {printPersonId && printPersonId !== "ALL" && (
          <Invoice
            person={result.perPerson.find(p => p.personId === printPersonId)!}
            allPersons={result.perPerson}
            tripPlan={lastPlan || undefined}
            geometry={geometry}
            grandTotal={result.grandTotal}
            driverId={calcConfig.driverId}
          />
        )}
        {printPersonId === "ALL" && (
          <>
            <GeneralInvoice
              persons={result.perPerson}
              config={calcConfig}
              tripPlan={lastPlan || undefined}
              geometry={geometry}
              grandTotal={result.grandTotal}
              totalDistanceKm={result.totalDistanceKm}
            />
            {result.perPerson.map(p => (
              <div key={p.personId} style={{ pageBreakBefore: "always", paddingTop: "20px" }}>
                <Invoice
                  person={p}
                  allPersons={result.perPerson}
                  tripPlan={lastPlan || undefined}
                  geometry={geometry}
                  grandTotal={result.grandTotal}
                  driverId={calcConfig.driverId}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </Fragment>
  );
}

function Kpi({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className={"kpi" + (accent ? " accent" : "")}>
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-body">
        <span className="kpi-label">{label}</span>
        <strong className="kpi-value">{value}</strong>
      </div>
    </div>
  );
}
