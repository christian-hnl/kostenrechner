import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calculate } from "./calc";
import { cheapestOpen, fetchStations, type Station } from "./tankerkoenig";
import { loadGoogleMaps } from "./googleMaps";
import { planTrip } from "./trip";
import { deletePerson, getPeople, savePerson, type PersonRecord } from "./db";
import { PlacesInput } from "./components/PlacesInput";
import { RouteMap } from "./components/RouteMap";
import { BarChart } from "./components/BarChart";
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
  landstrasse: "Landstraße",
  autobahn: "Autobahn",
};
const FUEL_LABELS: Record<FuelType, string> = {
  e5: "Super E5",
  e10: "Super E10",
  diesel: "Diesel",
};
const CO2_PER_L: Record<FuelType, number> = { e5: 2.37, e10: 2.32, diesel: 2.65 };

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (n: number, d = 1) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

interface AppState {
  config: CalcConfig;
  extras: ExtraCost[];
  tk: { lat: string; lng: string; radiusKm: number };
  keys: { gmaps: string; tankerkoenig: string };
  trip: { driverId: string | null; passengerIds: string[]; destination: string; roundTrip: boolean };
  segments: Segment[];
}

function defaultState(): AppState {
  return {
    config: {
      baseConsumption: 7,
      roadMultipliers: { stadt: 1.3, landstrasse: 1.0, autobahn: 1.25 },
      pricePerLiter: 1.75,
      driverId: null,
      driverPays: true,
      fuelType: "e10",
    },
    extras: [
      { id: uid(), label: "Verschleiß/Service", enabled: false, mode: "perKm", amount: 0.1 },
      { id: uid(), label: "Maut/Vignette", enabled: false, mode: "fixed", amount: 0, fixedSplit: "gleich" },
      { id: uid(), label: "Parken", enabled: false, mode: "fixed", amount: 0, fixedSplit: "gleich" },
    ],
    tk: { lat: "", lng: "", radiusKm: 5 },
    keys: { gmaps: "", tankerkoenig: "" },
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
      return {
        ...d,
        ...parsed,
        config: { ...d.config, ...parsed.config },
        trip: { ...d.trip, ...parsed.trip },
        keys: { ...d.keys, ...parsed.keys },
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
  const { config, extras, tk, keys, trip, segments } = state;
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
                  { id: uid(), label: "Anna (Start) → Ben abholen", roadKm: { stadt: 5, landstrasse: 25, autobahn: 160 }, presentIds: [anna.id] },
                  { id: uid(), label: "Ben → München", roadKm: { stadt: 10, landstrasse: 40, autobahn: 300 }, presentIds: [anna.id, ben.id] },
                  { id: uid(), label: "München → Ben (zurück)", roadKm: { stadt: 10, landstrasse: 40, autobahn: 300 }, presentIds: [anna.id, ben.id] },
                  { id: uid(), label: "Ben → Anna (zurück)", roadKm: { stadt: 5, landstrasse: 25, autobahn: 160 }, presentIds: [anna.id] },
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

  // ---------- Google Maps / Routenplanung ----------
  const [g, setG] = useState<typeof google | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ km: number; min: number } | null>(null);

  useEffect(() => {
    if (!keys.gmaps) return;
    loadGoogleMaps(keys.gmaps).then(setG).catch((e) => setRouteError(e.message));
  }, [keys.gmaps]);

  const planTripHandler = async () => {
    setRouteError(null);
    if (!keys.gmaps) return setRouteError("Bitte einen Google-Maps-API-Key eintragen (Einstellungen).");
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
      const gm = g ?? (await loadGoogleMaps(keys.gmaps));
      if (!g) setG(gm);
      const plan = await planTrip({
        google: gm,
        driver,
        passengers,
        destination: trip.destination,
        roundTrip: trip.roundTrip,
      });
      setDirections(plan.info.result);
      patch({ segments: plan.segments });
      setRouteInfo({
        km: plan.info.totalKm * (trip.roundTrip ? 2 : 1),
        min: plan.info.totalMin * (trip.roundTrip ? 2 : 1),
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
        { id: uid(), label: `Etappe ${segments.length + 1}`, roadKm: { stadt: 0, landstrasse: 0, autobahn: 0 }, presentIds: tripPersonIds },
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
    if (!keys.tankerkoenig) return setTkError("Bitte Tankerkönig-API-Key eintragen.");
    if (!isFinite(lat) || !isFinite(lng)) return setTkError("Bitte gültige Koordinaten angeben.");
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTkLoading(true);
    try {
      const list = await fetchStations({ apiKey: keys.tankerkoenig, lat, lng, radiusKm: tk.radiusKm, fuelType: config.fuelType, signal: ctrl.signal });
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
    () => calculate(calcConfig, tripPersons, segments, extras),
    [calcConfig, tripPersons, segments, extras],
  );
  const co2 = result.totalLiters * CO2_PER_L[config.fuelType];
  const costPerKm = result.totalDistanceKm > 0 ? result.grandTotal / result.totalDistanceKm : 0;
  const durationLabel = routeInfo ? `${Math.floor(routeInfo.min / 60)} h ${Math.round(routeInfo.min % 60)} min` : "–";
  const maxPersonTotal = Math.max(0, ...result.perPerson.map((p) => p.total));

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
              localStorage.removeItem(STORAGE_KEY);
              setState(defaultState());
              setStations([]);
              setDirections(null);
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
              <PlacesInput google={g} value={trip.destination} placeholder="Zieladresse"
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
            <label className="check">
              <input type="checkbox" checked={config.driverPays} onChange={(e) => patchConfig({ driverPays: e.target.checked })} />
              Fahrer zahlt bei den Spritkosten mit
            </label>
            <div className="btn-row">
              <button type="button" className="primary block" onClick={planTripHandler} disabled={routeBusy}>
                {routeBusy ? "Route wird berechnet…" : "Fahrt berechnen"}
              </button>
            </div>
            {routeError && <p className="error">{routeError}</p>}
            {!keys.gmaps && <p className="hint">Google-Maps-API-Key unter „Einstellungen" eintragen für Routing &amp; Karte.</p>}
          </section>

          {/* Gespeicherte Personen */}
          <section className="card">
            <h2><UsersIcon /> Gespeicherte Personen</h2>
            <p className="hint">Name + Wohnort einmal speichern – danach einfach oben auswählen. Gespeichert in der lokalen Datenbank (IndexedDB).</p>
            {people.map((p) => (
              <div className="db-person" key={p.id}>
                <input className="db-name" value={p.name} placeholder="Name"
                  onChange={(e) => updatePersonRecord(p.id, { name: e.target.value })} />
                <PlacesInput google={g} value={p.homeAddress} placeholder="Wohnort / Adresse"
                  onChange={(v) => updatePersonRecord(p.id, { homeAddress: v })} />
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
            <h2><EuroIcon /> Günstigste Tankstelle</h2>
            <p className="hint">Via Tankerkönig: günstigste offene Tankstelle im Umkreis wird als Spritpreis übernommen.</p>
            <div className="row">
              <label>Breite (lat)<input type="text" value={tk.lat} placeholder="52.52" onChange={(e) => patch({ tk: { ...tk, lat: e.target.value } })} /></label>
              <label>Länge (lng)<input type="text" value={tk.lng} placeholder="13.405" onChange={(e) => patch({ tk: { ...tk, lng: e.target.value } })} /></label>
              <label>Umkreis km<input type="number" min="1" max="25" value={tk.radiusKm} onChange={(e) => patch({ tk: { ...tk, radiusKm: parseInt(e.target.value) || 1 } })} /></label>
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

          <section className="card">
            <details className="advanced">
              <summary>Einstellungen / API-Keys</summary>
              <label>Google-Maps-API-Key
                <input type="password" value={keys.gmaps} placeholder="AIza…" onChange={(e) => patch({ keys: { ...keys, gmaps: e.target.value } })} />
              </label>
              <label>Tankerkönig-API-Key
                <input type="password" value={keys.tankerkoenig} placeholder="00000000-…" onChange={(e) => patch({ keys: { ...keys, tankerkoenig: e.target.value } })} />
              </label>
              <p className="hint">Keys &amp; Personen werden nur lokal im Browser gespeichert.</p>
            </details>
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
            {g ? <RouteMap google={g} directions={directions} /> : (
              <div className="map placeholder"><p>Karte erscheint nach „Fahrt berechnen" (Google-Maps-API-Key erforderlich).</p></div>
            )}
          </section>

          <section className="card">
            <h2><RouteIcon /> Etappen &amp; Mitfahrer</h2>
            <p className="hint">Automatisch aus der Route befüllt: km je Straßentyp und wer ab wo mitfährt. Alles editierbar.</p>
            <div className="matrix-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>Etappe</th>
                    <th className="kmcol">Stadt</th>
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
                      {(["stadt", "landstrasse", "autobahn"] as RoadType[]).map((rt) => (
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
            <BarChart format={eur} bars={result.perPerson.map((p) => ({ label: p.name, value: p.total, highlight: p.total === maxPersonTotal && maxPersonTotal > 0 }))} />
            <table className="result-table">
              <thead>
                <tr><th>Person</th><th>km</th><th>Sprit</th><th>pro km</th><th>fix</th><th>zu zahlen</th></tr>
              </thead>
              <tbody>
                {result.perPerson.map((r) => (
                  <tr key={r.personId}>
                    <td>{r.name}{trip.driverId === r.personId && <span className="badge">Fahrer</span>}</td>
                    <td>{num(r.personKm)}</td>
                    <td>{eur(r.fuelCost)}</td>
                    <td>{eur(r.perKmExtraCost)}</td>
                    <td>{eur(r.fixedExtraCost)}</td>
                    <td className="pay">{eur(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Gesamt</td><td></td>
                  <td>{eur(result.totalFuelCost)}</td>
                  <td>{eur(result.totalPerKmExtra)}</td>
                  <td>{eur(result.totalFixedExtra)}</td>
                  <td className="pay">{eur(result.grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        </main>
      </div>
    </div>
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
