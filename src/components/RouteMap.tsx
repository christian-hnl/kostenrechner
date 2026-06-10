import { useEffect, useRef } from "react";

interface Props {
  google: typeof window.google | null;
  directions: google.maps.DirectionsResult | null;
}

/** Zeigt die berechnete Route auf einer Google-Karte. */
export function RouteMap({ google, directions }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!google?.maps || !mapEl.current) return;
    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(mapEl.current, {
        center: { lat: 51.16, lng: 10.45 }, // Deutschland-Mitte
        zoom: 6,
        disableDefaultUI: true,
        zoomControl: true,
        styles: DARK_STYLE,
      });
      rendererRef.current = new google.maps.DirectionsRenderer({
        map: mapRef.current,
        polylineOptions: { strokeColor: "#4f8cff", strokeWeight: 5 },
      });
    }
    if (directions && rendererRef.current) {
      rendererRef.current.setDirections(directions);
    }
  }, [google, directions]);

  return <div ref={mapEl} className="map" />;
}

const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1f232c" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1f232c" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa3b2" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a2f3a" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a4150" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1115" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];
