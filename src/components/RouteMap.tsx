import React from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { TripPlan } from "../trip";
import type { PersonResult } from "../types";

interface Props {
  tripPlan?: TripPlan;
  geometry?: any;
  persons?: PersonResult[];
  lightMode?: boolean;
  highlightCostForPerson?: string;
  highlightSharedForPerson?: string;
  driverId?: string | null;
}

function BoundsFitter({ latLngs }: { latLngs: [number, number][] }) {
  const map = useMap();
  // Keep the latest bounds available to event handlers without re-binding them.
  const latLngsRef = React.useRef(latLngs);
  latLngsRef.current = latLngs;

  React.useEffect(() => {
    const fit = () => {
      const pts = latLngsRef.current;
      if (pts.length === 0) return;
      // Read the container's current (e.g. narrower print) size synchronously
      // before fitting, otherwise leaflet keeps a stale zoom and crops the route.
      map.invalidateSize({ animate: false, pan: false });
      map.fitBounds(pts, { padding: [30, 30], maxZoom: 15, animate: false });
    };
    fit();
    window.addEventListener('resize', fit);
    setTimeout(fit, 100);
    setTimeout(fit, 500);
    setTimeout(fit, 1200);

    // Re-fit right when print layout is applied so the whole route stays framed.
    // The page width changes under @media print; without this leaflet keeps the
    // on-screen center/zoom and crops the route in the PDF export.
    window.addEventListener('beforeprint', fit);
    const printMq = window.matchMedia('print');
    const onMqChange = (e: MediaQueryListEvent) => { if (e.matches) fit(); };
    printMq.addEventListener?.('change', onMqChange);

    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('beforeprint', fit);
      printMq.removeEventListener?.('change', onMqChange);
    };
  }, [map]);
  return null;
}

export function RouteMap({ tripPlan, geometry, persons, lightMode, highlightCostForPerson, highlightSharedForPerson, driverId }: Props) {
  const tileUrl = lightMode
    ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

  const colors = React.useMemo(() => {
    const map = new Map<string, string>();
    if (persons) {
      persons.forEach(p => map.set(p.personId, p.color));
    }
    return map;
  }, [persons]);

  const { lines, bounds, stops } = React.useMemo(() => {
    const linesArr: { id: string; positions: [number, number][]; color: string; dashArray?: string; dashOffset?: string; weight: number; isFallback?: boolean; isDirect?: boolean; opacity?: number }[] = [];
    const latLngsArr: [number, number][] = [];
    const stopsArr: { pos: [number, number]; label: string; kind: "start" | "mid" | "end" }[] = [];

    // Always push ALL segments to bounds so the map ALWAYS frames the entire trip
    if (tripPlan?.segments) {
      tripPlan.segments.forEach(seg => {
        if (seg.geometry && seg.geometry.coordinates) {
          seg.geometry.coordinates.forEach((c: [number, number]) => latLngsArr.push([c[1], c[0]]));
        }
      });
    } else if (geometry && geometry.coordinates) {
      geometry.coordinates.forEach((c: [number, number]) => latLngsArr.push([c[1], c[0]]));
    }

    const toLatLngs = (coords: [number, number][]) => coords.map(c => [c[1], c[0]] as [number, number]);

    // ALWAYS draw the full trip as a faint background line so context is never lost
    if (tripPlan?.segments && (highlightCostForPerson || highlightSharedForPerson)) {
      tripPlan.segments.forEach(seg => {
        if (seg.geometry && seg.geometry.coordinates) {
          linesArr.push({
            id: `backbone-${seg.id}`,
            positions: toLatLngs(seg.geometry.coordinates),
            color: lightMode ? "#cbd5e1" : "#475569",
            weight: 8,
            opacity: 0.7
          });
        }
      });
    }

    if (tripPlan?.directInfo?.geometry) {
      linesArr.push({
        id: "direct",
        positions: toLatLngs(tripPlan.directInfo.geometry.coordinates),
        color: lightMode ? "#cbd5e1" : "#334155",
        weight: 6,
        isDirect: true
      });
    }

    if (!tripPlan && geometry) {
      linesArr.push({
        id: "fallback",
        positions: toLatLngs(geometry.coordinates),
        color: "#3b82f6",
        weight: 5,
        isFallback: true
      });
    }

    const driverCostHighlight = !!(highlightCostForPerson && driverId && highlightCostForPerson === driverId);

    if (driverCostHighlight && tripPlan) {
      // The driver only pays for the main route — never for detours others cause.
      // Draw the direct route as the driver's cost; the detours stay faint backbone.
      const mainGeo = tripPlan.directInfo?.geometry;
      if (mainGeo && mainGeo.coordinates) {
        linesArr.push({
          id: "driver-cost-main",
          positions: toLatLngs(mainGeo.coordinates),
          color: "#10b981",
          weight: 7,
          opacity: 0.95
        });
      } else if (tripPlan.segments) {
        // Fallback (no direct geometry): flat green over the whole ridden route.
        tripPlan.segments.forEach((seg) => {
          if (!seg.geometry || !seg.geometry.coordinates) return;
          linesArr.push({
            id: `driver-cost-${seg.id}`,
            positions: toLatLngs(seg.geometry.coordinates),
            color: "#10b981",
            weight: 6,
            opacity: 0.9
          });
        });
      }
    } else if (highlightCostForPerson && tripPlan?.segments) {
      tripPlan.segments.forEach((seg) => {
        if (!seg.geometry || !seg.geometry.coordinates) return;
        if (!seg.presentIds.includes(highlightCostForPerson)) return;
        const positions = toLatLngs(seg.geometry.coordinates);

        const share = 1 / seg.presentIds.length;
        let costColor = "#10b981"; // Green (cheap)
        if (share > 0.5) costColor = "#ef4444"; // Red (expensive)
        else if (share > 0.33) costColor = "#f59e0b"; // Orange

        linesArr.push({
          id: `hl-cost-${seg.id}`,
          positions,
          color: costColor,
          weight: 6,
          opacity: 0.9
        });
      });
    } else if (highlightSharedForPerson && tripPlan?.segments) {
      tripPlan.segments.forEach((seg) => {
        if (!seg.geometry || !seg.geometry.coordinates) return;
        if (!seg.presentIds.includes(highlightSharedForPerson)) return;
        const positions = toLatLngs(seg.geometry.coordinates);
        
        seg.presentIds.forEach((pid, pIdx) => {
          const color = colors.get(pid) || "#3b82f6";
          const dashArray = `10, ${10 * (seg.presentIds.length - 1)}`;
          const dashOffset = `${pIdx * 10}`;
          
          linesArr.push({
            id: `${seg.id}-${pid}`,
            positions,
            color,
            weight: 6,
            dashArray: seg.presentIds.length > 1 ? dashArray : undefined,
            dashOffset: seg.presentIds.length > 1 ? dashOffset : undefined,
            opacity: 1
          });
        });
      });
    } else if (tripPlan?.segments) {
      tripPlan.segments.forEach((seg) => {
        if (!seg.geometry || !seg.geometry.coordinates) return;
        const positions = toLatLngs(seg.geometry.coordinates);
        
        seg.presentIds.forEach((pid, pIdx) => {
          const color = colors.get(pid) || "#3b82f6";
          const dashArray = `10, ${10 * (seg.presentIds.length - 1)}`;
          const dashOffset = `${pIdx * 10}`;
          
          linesArr.push({
            id: `${seg.id}-${pid}`,
            positions,
            color,
            weight: 6,
            dashArray: seg.presentIds.length > 1 ? dashArray : undefined,
            dashOffset: seg.presentIds.length > 1 ? dashOffset : undefined,
            opacity: 1
          });
        });
      });
    }

    // Derive stop markers from the segment endpoints so the route reads as an
    // ordered sequence of places instead of an anonymous line.
    if (tripPlan?.segments) {
      const segs = tripPlan.segments.filter(s => s.geometry?.coordinates?.length);
      if (segs.length) {
        const fc = segs[0].geometry.coordinates[0];
        stopsArr.push({ pos: [fc[1], fc[0]], label: segs[0].label.split("→")[0]?.trim() || "Start", kind: "start" });
        segs.forEach((seg, i) => {
          const cs = seg.geometry.coordinates;
          const lc = cs[cs.length - 1];
          stopsArr.push({
            pos: [lc[1], lc[0]],
            label: seg.label.split("→")[1]?.trim() || "",
            kind: i === segs.length - 1 ? "end" : "mid",
          });
        });
      }
    }

    return { lines: linesArr, bounds: latLngsArr, stops: stopsArr };
  }, [tripPlan, geometry, colors, lightMode, highlightCostForPerson, highlightSharedForPerson, driverId]);

  return (
    <MapContainer
      className="map"
      center={[51.16, 10.45]}
      zoom={6}
      style={{ height: "100%", minHeight: "400px", width: "100%", borderRadius: "8px", zIndex: 0 }}
      zoomControl={!lightMode}
      attributionControl={!lightMode}
    >
      <TileLayer
        url={tileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
      />
      
      {lines.map((l) => (
        <Polyline
          key={l.id}
          positions={l.positions}
          pathOptions={{
            color: l.color,
            weight: l.weight,
            dashArray: l.dashArray,
            dashOffset: l.dashOffset,
            opacity: l.opacity ?? (l.isDirect ? 0.6 : 0.9),
            lineCap: "round",
            lineJoin: "round"
          }}
        />
      ))}

      {stops.map((s, i) => {
        const fill = s.kind === "start" ? "#10b981" : s.kind === "end" ? "#ef4444" : "#ffffff";
        const stroke = s.kind === "mid" ? "#2563eb" : "#ffffff";
        return (
          <CircleMarker
            key={`stop-${i}`}
            center={s.pos}
            radius={s.kind === "mid" ? 5 : 7}
            pathOptions={{ color: stroke, weight: 2, fillColor: fill, fillOpacity: 1 }}
          >
            {s.label && (
              <Tooltip direction="top" offset={[0, -6]}>{s.label}</Tooltip>
            )}
          </CircleMarker>
        );
      })}

      <BoundsFitter latLngs={bounds} />

    </MapContainer>
  );
}
