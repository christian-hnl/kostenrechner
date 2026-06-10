import type { PersonRecord } from "./db";
import { computeRoute, type RouteInfo } from "./googleMaps";
import type { Segment } from "./types";

const uid = () => Math.random().toString(36).slice(2, 9);
const shortAddr = (a: string) => a.split(",")[0]?.trim() || a;

export interface TripPlan {
  segments: Segment[];
  info: RouteInfo;
  /** Mitfahrer in optimierter Abhol-Reihenfolge. */
  orderedPassengers: PersonRecord[];
}

/**
 * Plant eine Fahrt vollautomatisch:
 * Start = Wohnort des Fahrers, Wegpunkte = Wohnorte der Mitfahrer (Abholpunkte), dann Ziel.
 * Jeder Mitfahrer sitzt ab seinem Abholpunkt bis zum Ziel im Auto – daraus ergibt sich
 * automatisch, wer wie viele Kilometer fährt (faire Aufteilung).
 */
export async function planTrip(opts: {
  google: typeof google;
  driver: PersonRecord;
  passengers: PersonRecord[];
  destination: string;
  roundTrip: boolean;
}): Promise<TripPlan> {
  const { driver, passengers, destination, roundTrip } = opts;

  const info = await computeRoute({
    google: opts.google,
    origin: driver.homeAddress,
    destination,
    waypoints: passengers.map((p) => p.homeAddress),
    optimize: true,
  });

  const orderedPassengers = info.waypointOrder.map((i) => passengers[i]).filter(Boolean);
  const n = orderedPassengers.length;
  const legs = info.legs; // n + 1 Teilstrecken (Fahrer → P1 → … → Ziel)
  const destShort = shortAddr(destination);

  const outStops = [`${driver.name} (Start)`, ...orderedPassengers.map((p) => p.name), destShort];

  const segments: Segment[] = [];

  // Hinfahrt: auf Etappe k sitzen Fahrer + die ersten k Mitfahrer im Auto.
  for (let k = 0; k <= n; k++) {
    const leg = legs[k];
    if (!leg) continue;
    segments.push({
      id: uid(),
      label: `${outStops[k]} → ${outStops[k + 1]}`,
      roadKm: { ...leg.roadKm },
      presentIds: [driver.id, ...orderedPassengers.slice(0, k).map((p) => p.id)],
    });
  }

  // Rückfahrt: gespiegelt – beim Ziel steigen alle ein, jeder wird an seinem Wohnort abgesetzt.
  if (roundTrip) {
    const retStops = [destShort, ...[...orderedPassengers].reverse().map((p) => p.name), `${driver.name} (Ziel)`];
    for (let j = 0; j <= n; j++) {
      const leg = legs[n - j];
      if (!leg) continue;
      segments.push({
        id: uid(),
        label: `${retStops[j]} → ${retStops[j + 1]} (zurück)`,
        roadKm: { ...leg.roadKm },
        presentIds: [driver.id, ...orderedPassengers.slice(0, n - j).map((p) => p.id)],
      });
    }
  }

  return { segments, info, orderedPassengers };
}
