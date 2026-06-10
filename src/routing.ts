import type { RoadKm } from "./types";

export interface RouteLeg {
  from: string;
  to: string;
  distanceKm: number;
  durationMin: number;
  roadKm: RoadKm;
  geometry?: any;
}

export interface RouteInfo {
  legs: RouteLeg[];
  totalKm: number;
  totalMin: number;
  waypointOrder: number[];
  geometry: any; // GeoJSON coordinates
}

const geocodePromises = new Map<string, Promise<[number, number]>>();

export function geocode(address: string): Promise<[number, number]> {
  const cacheKey = address.trim().toLowerCase();
  if (geocodePromises.has(cacheKey)) {
    return geocodePromises.get(cacheKey)!;
  }

  const promise = (async () => {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Fehler bei der Adressauflösung");
    const data = await res.json();
    if (!data.features || data.features.length === 0) throw new Error(`Adresse nicht gefunden: ${address}`);
    
    const coords = data.features[0].geometry.coordinates; // [lon, lat]
    return [parseFloat(coords[0]), parseFloat(coords[1])] as [number, number];
  })();

  geocodePromises.set(cacheKey, promise);
  return promise;
}

// OSRM Steps -> RoadKm
function calculateRoadKmFromSteps(steps: any[]): RoadKm {
  const km: RoadKm = { stadt: 0, dorf: 0, landstrasse: 0, autobahn: 0 };
  for (const step of steps) {
    const meters = step.distance || 0;
    const secs = step.duration || 1;
    const kmh = meters / 1000 / (secs / 3600);
    const distKm = meters / 1000;
    if (kmh >= 90) km.autobahn += distKm;
    else if (kmh >= 55) km.landstrasse += distKm;
    else if (kmh >= 35) km.dorf += distKm;
    else km.stadt += distKm;
  }
  return {
    stadt: Math.round(km.stadt * 10) / 10,
    dorf: Math.round(km.dorf * 10) / 10,
    landstrasse: Math.round(km.landstrasse * 10) / 10,
    autobahn: Math.round(km.autobahn * 10) / 10,
  };
}

export async function computeRouteORS(opts: {
  origin: string;
  destination: string;
  waypoints: string[];
  orsKey: string;
  routeMode: "fastest" | "shortest";
  avoidHighways: boolean;
}, coords: [number, number][]): Promise<RouteInfo> {
  const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
  
  const body: any = {
    coordinates: coords,
    preference: opts.routeMode,
    instructions: true,
  };
  
  if (opts.avoidHighways) {
    body.options = { avoid_features: ["highways"] };
  }
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": opts.orsKey.trim(),
    },
    body: JSON.stringify(body)
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`ORS Fehler: ${res.status} ${errorText}`);
  }
  
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error("ORS lieferte keine Route");
  
  const segments = feature.properties.segments || [];
  const shorten = (addr: string) => addr.split(",")[0]?.trim() || addr;
  const allAddresses = [opts.origin, ...opts.waypoints.filter(w => w.trim()), opts.destination];
  
  const legs: RouteLeg[] = segments.map((seg: any, i: number) => {
    let geometry = null;
    if (seg.steps && seg.steps.length > 0) {
      const firstStep = seg.steps[0];
      const lastStep = seg.steps[seg.steps.length - 1];
      if (firstStep.way_points && lastStep.way_points) {
        const startIdx = firstStep.way_points[0];
        const endIdx = lastStep.way_points[1];
        if (feature.geometry && feature.geometry.coordinates) {
          geometry = {
            type: "LineString",
            coordinates: feature.geometry.coordinates.slice(startIdx, endIdx + 1)
          };
        }
      }
    }
    
    return {
      from: shorten(allAddresses[i] || ""),
      to: shorten(allAddresses[i + 1] || ""),
      distanceKm: (seg.distance || 0) / 1000,
      durationMin: (seg.duration || 0) / 60,
      roadKm: calculateRoadKmFromSteps(seg.steps || []),
      geometry
    };
  });
  
  return {
    legs,
    totalKm: legs.reduce((s, l) => s + l.distanceKm, 0),
    totalMin: legs.reduce((s, l) => s + l.durationMin, 0),
    waypointOrder: opts.waypoints.map((_, i) => i),
    geometry: feature.geometry,
  };
}

export async function computeRoute(opts: {
  origin: string;
  destination: string;
  waypoints: string[];
  optimize?: boolean;
  orsKey?: string;
  routeMode?: "fastest" | "shortest";
  avoidHighways?: boolean;
}): Promise<RouteInfo> {
  const allAddresses = [opts.origin, ...opts.waypoints.filter(w => w.trim()), opts.destination];
  
  // Geocode all addresses sequentially to respect Nominatim limits
  const coords: [number, number][] = [];
  for (const addr of allAddresses) {
    coords.push(await geocode(addr));
  }

  // If NOT optimize and ORS key is present, use ORS
  if (!opts.optimize && opts.orsKey && opts.orsKey.trim().length > 5) {
    return computeRouteORS({
      ...opts,
      orsKey: opts.orsKey,
      routeMode: opts.routeMode || "fastest",
      avoidHighways: opts.avoidHighways || false,
    }, coords);
  }

  const coordsString = coords.map(c => `${c[0]},${c[1]}`).join(";");
  
  let url = "";
  let isTrip = false;
  
  if (opts.optimize && opts.waypoints.length > 0) {
    // Trip API (solves TSP)
    url = `https://router.project-osrm.org/trip/v1/driving/${coordsString}?source=first&destination=last&roundtrip=false&steps=true&geometries=geojson&overview=full`;
    isTrip = true;
  } else {
    // Route API (fixed order)
    url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?steps=true&geometries=geojson&overview=full`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error("Fehler bei der OSRM Routenberechnung");
  const data = await res.json();
  
  if (data.code !== "Ok") throw new Error(data.message || "Route konnte nicht berechnet werden");

  const route = isTrip ? data.trips[0] : data.routes[0];
  if (!route) throw new Error("Keine Route gefunden");

  // Determine waypoint order if optimized
  let waypointOrder = opts.waypoints.map((_, i) => i);
  if (isTrip && data.waypoints) {
    const wpIndices = data.waypoints.slice(1, -1);
    waypointOrder = wpIndices
      .map((wp: any, i: number) => ({ index: wp.waypoint_index, originalIndex: i }))
      .sort((a: any, b: any) => a.index - b.index)
      .map((x: any) => x.originalIndex);
  }

  const shorten = (addr: string) => addr.split(",")[0]?.trim() || addr;

  // Build legs based on the optimized order
  const orderedAddresses = [opts.origin];
  for (const idx of waypointOrder) {
    orderedAddresses.push(opts.waypoints[idx]);
  }
  orderedAddresses.push(opts.destination);

  const legs: RouteLeg[] = route.legs.map((leg: any, i: number) => {
    let coordinates: any[] = [];
    if (leg.steps) {
      for (const step of leg.steps) {
        if (step.geometry && step.geometry.coordinates) {
          coordinates.push(...step.geometry.coordinates);
        }
      }
    }
    
    return {
      from: shorten(orderedAddresses[i] || ""),
      to: shorten(orderedAddresses[i + 1] || ""),
      distanceKm: (leg.distance || 0) / 1000,
      durationMin: (leg.duration || 0) / 60,
      roadKm: calculateRoadKmFromSteps(leg.steps || []),
      geometry: coordinates.length > 0 ? { type: "LineString", coordinates } : null
    };
  });

  return {
    legs,
    totalKm: legs.reduce((s, l) => s + l.distanceKm, 0),
    totalMin: legs.reduce((s, l) => s + l.durationMin, 0),
    waypointOrder,
    geometry: route.geometry,
  };
}
