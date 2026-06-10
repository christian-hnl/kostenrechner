import type { FuelType } from "./types";

export interface Station {
  id: string;
  name: string;
  brand: string;
  street: string;
  place: string;
  dist: number; // km Luftlinie
  price: number; // €/l für den abgefragten Spritsorte
  isOpen: boolean;
}

const BASE = "https://creativecommons.tankerkoenig.de/json/list.php";

/**
 * Fragt Tankstellen in einem Umkreis ab und gibt sie nach Preis sortiert zurück
 * (günstigste zuerst). Benötigt einen kostenlosen API-Key von tankerkoenig.de.
 *
 * Hinweis: Die API liefert Distanz als Luftlinie. Für „günstigste Tankstelle am
 * Weg" Umkreis um Start/Ziel/Wegpunkt legen.
 */
export async function fetchStations(opts: {
  apiKey: string;
  lat: number;
  lng: number;
  radiusKm: number;
  fuelType: FuelType;
  signal?: AbortSignal;
}): Promise<Station[]> {
  const radius = Math.min(Math.max(opts.radiusKm, 1), 25); // API erlaubt 1–25 km
  const params = new URLSearchParams({
    lat: String(opts.lat),
    lng: String(opts.lng),
    rad: String(radius),
    sort: "price",
    type: opts.fuelType,
    apikey: opts.apiKey,
  });

  const res = await fetch(`${BASE}?${params.toString()}`, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`Tankerkönig HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.message || "Tankerkönig-Anfrage fehlgeschlagen");
  }

  const stations: Station[] = (data.stations as any[])
    .filter((s) => typeof s.price === "number" && s.price > 0)
    .map((s) => ({
      id: String(s.id),
      name: String(s.name ?? "Tankstelle"),
      brand: String(s.brand ?? ""),
      street: `${s.street ?? ""} ${s.houseNumber ?? ""}`.trim(),
      place: String(s.place ?? ""),
      dist: Number(s.dist ?? 0),
      price: Number(s.price),
      isOpen: Boolean(s.isOpen),
    }));

  stations.sort((a, b) => a.price - b.price);
  return stations;
}

export function cheapestOpen(stations: Station[]): Station | undefined {
  return stations.find((s) => s.isOpen) ?? stations[0];
}
