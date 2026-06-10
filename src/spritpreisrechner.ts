import type { FuelType } from "./types";

export interface Station {
  id: string;
  name: string;
  brand: string;
  street: string;
  place: string;
  lat: number;
  lng: number;
  dist: number; // km Luftlinie
  price: number; // €/l
  isOpen: boolean;
}

const BASE = "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address";

/**
 * Fragt Tankstellen über die E-Control API (Spritpreisrechner Österreich) ab.
 * Keine API-Key erforderlich.
 */
export async function fetchStations(opts: {
  lat: number;
  lng: number;
  fuelType: FuelType;
  signal?: AbortSignal;
}): Promise<Station[]> {
  // Mapping unserer FuelTypes auf E-Control
  let ecType = "DIE";
  if (opts.fuelType === "e5" || opts.fuelType === "e10") {
    ecType = "SUP"; // Super 95
  }

  const params = new URLSearchParams({
    latitude: String(opts.lat),
    longitude: String(opts.lng),
    fuelType: ecType,
    includeClosed: "true",
  });

  const res = await fetch(`${BASE}?${params.toString()}`, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`E-Control API HTTP ${res.status}`);
  }
  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error("Ungültige Antwort von der E-Control API");
  }

  const stations: Station[] = data
    .filter((s: any) => s.prices && s.prices.length > 0)
    .map((s: any) => ({
      id: String(s.id),
      name: String(s.name ?? "Tankstelle"),
      brand: "", // E-Control liefert meist keine separate Brand
      street: String(s.location?.address ?? ""),
      place: String(s.location?.city ?? ""),
      lat: Number(s.location?.latitude ?? 0),
      lng: Number(s.location?.longitude ?? 0),
      dist: Number(s.distance ?? 0),
      price: Number(s.prices[0]?.amount ?? 0),
      isOpen: Boolean(s.open),
    }));

  stations.sort((a, b) => a.price - b.price);
  return stations;
}

export function cheapestOpen(stations: Station[]): Station | undefined {
  return stations.find((s) => s.isOpen) ?? stations[0];
}