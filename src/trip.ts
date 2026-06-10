import type { PersonRecord } from "./db";
import { computeRoute, type RouteInfo } from "./routing";
import type { Segment } from "./types";

const uid = () => Math.random().toString(36).slice(2, 9);
const shortAddr = (a: string) => a.split(",")[0]?.trim() || a;

// Optimize the visiting order of a set of waypoints between a fixed origin and
// destination (TSP via OSRM Trip API). Returns indices into `waypoints`.
async function optimizeAddresses(
  origin: string,
  destination: string,
  waypoints: string[],
  routeOpts: { orsKey?: string; routeMode?: "fastest" | "shortest"; avoidHighways?: boolean }
): Promise<number[]> {
  if (waypoints.length <= 1) return waypoints.map((_, i) => i);
  const info = await computeRoute({ origin, destination, waypoints, optimize: true, ...routeOpts });
  return info.waypointOrder;
}

export interface TripPlan {
  segments: Segment[];
  info: RouteInfo;       // Actual route
  directInfo: RouteInfo; // Direct route for fair cost splitting
  orderedPassengers: PersonRecord[];
  passengerDetours: Record<string, number>;
  passengerStandardDetours: Record<string, number>;
}

interface Stop {
  address: string;
  label: string;
  pickup: string[];
  dropoff: string[];
}

export async function planTrip(opts: {
  driver: PersonRecord;
  passengers: PersonRecord[];
  destination: string;
  roundTrip: boolean;
  orsKey?: string;
  routeMode?: "fastest" | "shortest";
  avoidHighways?: boolean;
}): Promise<TripPlan> {
  const { driver, passengers, destination, roundTrip, orsKey, routeMode, avoidHighways } = opts;

  // 1. Direct Route (Driver -> Destination and back if roundTrip)
  const directWps = roundTrip ? [destination] : [];
  const directDest = roundTrip ? driver.homeAddress : destination;

  const directInfo = await computeRoute({
    origin: driver.homeAddress,
    destination: directDest,
    waypoints: directWps,
    optimize: false,
    orsKey, routeMode, avoidHighways
  });

  // 2. Determine optimized pickup order
  let orderedPassengers = [...passengers];
  if (passengers.length > 1) {
    const pickupInfo = await computeRoute({
      origin: driver.homeAddress,
      destination,
      waypoints: passengers.map(p => p.homeAddress),
      optimize: true,
      orsKey, routeMode, avoidHighways
    });
    orderedPassengers = pickupInfo.waypointOrder.map(i => passengers[i]).filter(Boolean);
  }

  // 3. Build exact sequence of stops
  const routeOpts = { orsKey, routeMode, avoidHighways };
  const stops: Stop[] = [];
  stops.push({ address: driver.homeAddress, label: `${driver.name} (Start)`, pickup: [driver.id], dropoff: [] });

  for (const p of orderedPassengers) {
    stops.push({ address: p.homeAddress, label: `${p.name} (Abholung)`, pickup: [p.id], dropoff: [] });
  }

  // Outbound drop-offs: optimize the order of custom drop-off locations from the
  // last pickup towards the destination, instead of blindly following pickup order.
  const lastPickupAddr = orderedPassengers.length > 0
    ? orderedPassengers[orderedPassengers.length - 1].homeAddress
    : driver.homeAddress;

  const dropoffPassengers = orderedPassengers.filter(p => p.outboundDropoff?.trim());
  const atDestIds = orderedPassengers.filter(p => !p.outboundDropoff?.trim()).map(p => p.id);

  const outOrder = await optimizeAddresses(
    lastPickupAddr,
    destination,
    dropoffPassengers.map(p => p.outboundDropoff!.trim()),
    routeOpts
  );
  for (const i of outOrder) {
    const p = dropoffPassengers[i];
    stops.push({ address: p.outboundDropoff!.trim(), label: `${p.name} (Absetzen Hinweg)`, pickup: [], dropoff: [p.id] });
  }

  if (!roundTrip) {
    stops.push({ address: destination, label: "Ziel", pickup: [], dropoff: atDestIds });
  } else {
    stops.push({ address: destination, label: "Ziel", pickup: [], dropoff: [] });

    // Return pickups (Rück-Abholung): only passengers dropped off on the way there,
    // optimized from the destination towards the driver's home.
    const returnPickupPassengers = orderedPassengers.filter(p => p.outboundDropoff?.trim());
    const rpOrder = await optimizeAddresses(
      destination,
      driver.homeAddress,
      returnPickupPassengers.map(p => p.outboundDropoff!.trim()),
      routeOpts
    );
    const orderedReturnPickups = rpOrder.map(i => returnPickupPassengers[i]);
    for (const p of orderedReturnPickups) {
      stops.push({ address: p.outboundDropoff!.trim(), label: `${p.name} (Rück-Abholung)`, pickup: [p.id], dropoff: [] });
    }

    // Return drop-offs (Rück-Absetzen): everyone, optimized from the last return
    // pickup towards the driver's home.
    const returnDropoffOrigin = orderedReturnPickups.length > 0
      ? orderedReturnPickups[orderedReturnPickups.length - 1].outboundDropoff!.trim()
      : destination;
    const rdOrder = await optimizeAddresses(
      returnDropoffOrigin,
      driver.homeAddress,
      orderedPassengers.map(p => p.returnDropoff?.trim() || p.homeAddress),
      routeOpts
    );
    for (const i of rdOrder) {
      const p = orderedPassengers[i];
      const dropAddr = p.returnDropoff?.trim() || p.homeAddress;
      stops.push({ address: dropAddr, label: `${p.name} (Rück-Absetzen)`, pickup: [], dropoff: [p.id] });
    }
    stops.push({ address: driver.homeAddress, label: `${driver.name} (Ziel)`, pickup: [], dropoff: [driver.id] });
  }

  // Combine adjacent stops with the exact same address to avoid 0km legs
  const mergedStops: Stop[] = [];
  for (const s of stops) {
    if (mergedStops.length > 0 && mergedStops[mergedStops.length - 1].address === s.address) {
      const prev = mergedStops[mergedStops.length - 1];
      prev.label += ` & ${s.label}`;
      prev.pickup.push(...s.pickup);
      prev.dropoff.push(...s.dropoff);
    } else {
      mergedStops.push(s);
    }
  }

  // 4. Calculate final actual route
  const actualOrigin = mergedStops[0].address;
  const actualDest = mergedStops[mergedStops.length - 1].address;
  const actualWaypoints = mergedStops.slice(1, -1).map(s => s.address);

  const info = await computeRoute({
    origin: actualOrigin,
    destination: actualDest,
    waypoints: actualWaypoints,
    optimize: false,
    orsKey, routeMode, avoidHighways
  });

  // 4b. Calculate standalone detours for each passenger
  const passengerDetours: Record<string, number> = {};
  const passengerStandardDetours: Record<string, number> = {};
  if (passengers.length > 0) {
    const promises = passengers.map(async (p) => {
      // 1. Spezial-Umweg (Full Route with custom dropoffs)
      const wps: string[] = [];
      wps.push(p.homeAddress);
      if (p.outboundDropoff?.trim()) wps.push(p.outboundDropoff.trim());
      
      let finalDest = destination;
      if (roundTrip) {
        if (p.outboundDropoff?.trim()) wps.push(destination, p.outboundDropoff.trim());
        else wps.push(destination);
        const dropAddr = p.returnDropoff?.trim() || p.homeAddress;
        wps.push(dropAddr);
        finalDest = driver.homeAddress;
      }
      
      const pInfoPromise = computeRoute({
        origin: driver.homeAddress,
        destination: finalDest,
        waypoints: wps,
        optimize: false,
        orsKey, routeMode, avoidHighways
      });

      // 2. Standard-Umweg (nur Abholung Wohnort)
      const stdWps: string[] = [p.homeAddress];
      let stdDest = destination;
      if (roundTrip) {
        stdWps.push(destination, p.homeAddress);
        stdDest = driver.homeAddress;
      }
      const pStdPromise = computeRoute({
        origin: driver.homeAddress,
        destination: stdDest,
        waypoints: stdWps,
        optimize: false,
        orsKey, routeMode, avoidHighways
      });
      
      const [pInfo, pStd] = await Promise.all([pInfoPromise, pStdPromise]);
      
      passengerDetours[p.id] = Math.max(0, pInfo.totalKm - directInfo.totalKm);
      passengerStandardDetours[p.id] = Math.max(0, pStd.totalKm - directInfo.totalKm);
    });
    await Promise.all(promises);
  }

  // 5. Build segments & simulate who is in the car
  const segments: Segment[] = [];
  const inCar = new Set<string>();
  inCar.add(driver.id);

  for (let i = 0; i < info.legs.length; i++) {
    const stop = mergedStops[i];
    stop.dropoff.forEach(id => inCar.delete(id));
    stop.pickup.forEach(id => inCar.add(id));
    
    const presentIds = Array.from(inCar);
    const leg = info.legs[i];
    
    if (leg && leg.distanceKm > 0) {
      segments.push({
        id: uid(),
        label: `${shortAddr(mergedStops[i].address)} → ${shortAddr(mergedStops[i+1].address)}`,
        roadKm: { ...leg.roadKm },
        presentIds,
        geometry: leg.geometry
      });
    }
  }

  return { segments, info, directInfo, orderedPassengers, passengerDetours, passengerStandardDetours };
}
