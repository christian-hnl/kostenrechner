import type { RoadKm } from "./types";

let loadPromise: Promise<typeof google> | null = null;
let loadedKey: string | null = null;

/** Lädt das Google-Maps-JS-SDK (einmalig) mit Places-Bibliothek. */
export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (!apiKey) return Promise.reject(new Error("Kein Google-Maps-API-Key."));
  if ((window as any).google?.maps && loadedKey === apiKey) {
    return Promise.resolve((window as any).google);
  }
  if (loadPromise && loadedKey === apiKey) return loadPromise;

  loadedKey = apiKey;
  loadPromise = new Promise((resolve, reject) => {
    document.getElementById("gmaps-script")?.remove();
    const cb = "__gmapsCb";
    (window as any)[cb] = () => resolve((window as any).google);
    const script = document.createElement("script");
    script.id = "gmaps-script";
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&libraries=places&language=de&region=DE&callback=${cb}`;
    script.onerror = () =>
      reject(new Error("Google Maps konnte nicht geladen werden – API-Key/Abrechnung prüfen."));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export interface RouteLeg {
  from: string;
  to: string;
  distanceKm: number;
  durationMin: number;
  /** Automatisch erkannte km-Aufteilung nach Straßentyp. */
  roadKm: RoadKm;
}

export interface RouteInfo {
  legs: RouteLeg[];
  totalKm: number;
  totalMin: number;
  /** Optimierte Reihenfolge der übergebenen Wegpunkte (Index in das waypoints-Array). */
  waypointOrder: number[];
  result: google.maps.DirectionsResult;
}

/**
 * Erkennt für jede Etappe automatisch, wie viele km auf Stadt / Landstraße / Autobahn
 * entfallen – anhand der Durchschnittsgeschwindigkeit jedes einzelnen Teilstücks (Step).
 * >= 90 km/h ≈ Autobahn, 55–90 ≈ Landstraße, darunter ≈ Stadt.
 */
function legRoadKm(leg: google.maps.DirectionsLeg): RoadKm {
  const km: RoadKm = { stadt: 0, landstrasse: 0, autobahn: 0 };
  for (const step of leg.steps ?? []) {
    const meters = step.distance?.value ?? 0;
    const secs = step.duration?.value ?? 1;
    const kmh = meters / 1000 / (secs / 3600);
    const distKm = meters / 1000;
    if (kmh >= 90) km.autobahn += distKm;
    else if (kmh >= 55) km.landstrasse += distKm;
    else km.stadt += distKm;
  }
  return {
    stadt: Math.round(km.stadt * 10) / 10,
    landstrasse: Math.round(km.landstrasse * 10) / 10,
    autobahn: Math.round(km.autobahn * 10) / 10,
  };
}

/** Berechnet eine Route inkl. Zwischenstopps. Jede Teilstrecke (Leg) wird zu einer Etappe. */
export async function computeRoute(opts: {
  google: typeof google;
  origin: string;
  destination: string;
  waypoints: string[];
  /** Reihenfolge der Wegpunkte (Abholpunkte) automatisch optimieren. */
  optimize?: boolean;
}): Promise<RouteInfo> {
  const service = new opts.google.maps.DirectionsService();
  const res = await service.route({
    origin: opts.origin,
    destination: opts.destination,
    optimizeWaypoints: opts.optimize ?? false,
    waypoints: opts.waypoints
      .filter((w) => w.trim())
      .map((location) => ({ location, stopover: true })),
    travelMode: opts.google.maps.TravelMode.DRIVING,
  });

  const route = res.routes[0];
  if (!route) throw new Error("Keine Route gefunden.");

  const shorten = (addr: string) => addr.split(",")[0]?.trim() || addr;
  const legs: RouteLeg[] = route.legs.map((leg) => ({
    from: shorten(leg.start_address),
    to: shorten(leg.end_address),
    distanceKm: (leg.distance?.value ?? 0) / 1000,
    durationMin: (leg.duration?.value ?? 0) / 60,
    roadKm: legRoadKm(leg),
  }));

  return {
    legs,
    totalKm: legs.reduce((s, l) => s + l.distanceKm, 0),
    totalMin: legs.reduce((s, l) => s + l.durationMin, 0),
    waypointOrder: route.waypoint_order ?? opts.waypoints.map((_, i) => i),
    result: res,
  };
}
