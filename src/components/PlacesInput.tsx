import { useState, useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

interface PhotonFeature {
  properties: {
    name?: string;
    city?: string;
    postcode?: string;
    street?: string;
    housenumber?: string;
    country?: string;
  };
}

export function PlacesInput({ value, onChange, placeholder }: Props) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  
  const timerRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sync external value changes (like when switching driver/passenger)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Handle clicking outside to close the dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = async (q: string) => {
    if (q.trim().length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      setSuggestions(data.features || []);
      setIsOpen((data.features || []).length > 0);
    } catch (e) {
      console.error("Photon API Error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val); // Update parent state immediately
    
    if (timerRef.current) window.clearTimeout(timerRef.current);
    
    timerRef.current = window.setTimeout(() => {
      fetchSuggestions(val);
    }, 400); // Debounce 400ms
  };

  const handleSelect = (feature: PhotonFeature) => {
    const p = feature.properties;
    
    const parts = [];
    if (p.street) {
      parts.push(`${p.street} ${p.housenumber || ""}`.trim());
    } else if (p.name) {
      parts.push(p.name);
    }
    
    if (p.postcode || p.city) {
      parts.push(`${p.postcode || ""} ${p.city || ""}`.trim());
    }

    const formatted = parts.filter(Boolean).join(", ");
    
    setQuery(formatted);
    onChange(formatted);
    setIsOpen(false);
  };

  return (
    <div className="places-container" ref={wrapperRef}>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={handleInputChange}
        onFocus={() => { if (suggestions.length > 0) setIsOpen(true); }}
      />
      {loading && <div className="places-loading"></div>}
      
      {isOpen && (
        <ul className="places-dropdown">
          {suggestions.map((s, i) => {
            const p = s.properties;
            const title = p.name || p.street || p.city || "Unbekannt";
            const subparts = [p.postcode, p.city, p.street, p.country].filter(Boolean);
            const subtitle = Array.from(new Set(subparts)).join(", ");
            
            return (
              <li key={i} className="places-item" onClick={() => handleSelect(s)}>
                <span className="places-item-title">{title}</span>
                <span className="places-item-subtitle">{subtitle}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
