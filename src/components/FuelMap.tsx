import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Station } from "../spritpreisrechner";

// Leaflet default icon fix
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface FuelMapProps {
  center: { lat: number; lng: number };
  stations: Station[];
}

export function FuelMap({ center, stations }: FuelMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current).setView([center.lat, center.lng], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(mapInstanceRef.current);
    } else {
      mapInstanceRef.current.setView([center.lat, center.lng]);
    }
  }, [center]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Add new markers
    stations.forEach((s) => {
      if (s.lat && s.lng) {
        const popupContent = `
          <strong>${s.name}</strong><br/>
          ${s.street}, ${s.place}<br/>
          <strong>Preis: ${s.price.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</strong>
        `;
        const marker = L.marker([s.lat, s.lng])
          .bindPopup(popupContent)
          .addTo(mapInstanceRef.current!);
        markersRef.current.push(marker);
      }
    });

    // Auto-fit bounds if we have stations
    if (stations.length > 0) {
      const group = L.featureGroup(markersRef.current);
      mapInstanceRef.current.fitBounds(group.getBounds().pad(0.1));
    }
  }, [stations]);

  return <div ref={mapRef} style={{ width: "100%", height: "400px", borderRadius: "8px", zIndex: 0 }} />;
}
