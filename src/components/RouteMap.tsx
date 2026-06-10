import React from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
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
}

function BoundsFitter({ latLngs }: { latLngs: [number, number][] }) {
  const map = useMap();
  React.useEffect(() => {
    if (latLngs.length === 0) return;
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(latLngs, { padding: [20, 20], animate: false });
    };
    fit();
    window.addEventListener('resize', fit);
    // Also fit after a short delay for printing bounds adjustment
    setTimeout(fit, 100);
    setTimeout(fit, 500);
    return () => window.removeEventListener('resize', fit);
  }, [latLngs, map]);
  return null;
}

export function RouteMap({ tripPlan, geometry, persons, lightMode, highlightCostForPerson, highlightSharedForPerson }: Props) {
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

  const { lines, bounds } = React.useMemo(() => {
    const linesArr: { id: string; positions: [number, number][]; color: string; dashArray?: string; dashOffset?: string; weight: number; isFallback?: boolean; isDirect?: boolean; opacity?: number }[] = [];
    const latLngsArr: [number, number][] = [];

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

    if (highlightCostForPerson && tripPlan?.segments) {
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

    return { lines: linesArr, bounds: latLngsArr };
  }, [tripPlan, geometry, colors, lightMode, highlightCostForPerson, highlightSharedForPerson]);

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
            lineCap: "square",
            lineJoin: "round"
          }}
        />
      ))}

      <BoundsFitter latLngs={bounds} />

    </MapContainer>
  );
}
