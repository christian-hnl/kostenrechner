import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  google: typeof window.google | null;
  placeholder?: string;
}

/** Adress-Eingabe mit Google-Places-Autocomplete (fällt auf reines Textfeld zurück). */
export function PlacesInput({ value, onChange, google, placeholder }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!google?.maps?.places || !inputRef.current) return;
    const ac = new google.maps.places.Autocomplete(inputRef.current, {
      fields: ["formatted_address", "name"],
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const text = place.formatted_address || place.name || inputRef.current?.value || "";
      onChangeRef.current(text);
    });
    return () => listener.remove();
  }, [google]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
