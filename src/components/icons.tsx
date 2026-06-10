interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const RouteIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h6" />
  </svg>
);

export const FuelIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 21h12V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
    <path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3" />
    <path d="M3 10h12" />
  </svg>
);

export const EuroIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M17 6.5a6 6 0 1 0 0 11" />
    <path d="M5 10h7M5 14h7" />
  </svg>
);

export const LeafIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M11 20A7 7 0 0 1 4 13c0-5 4-8 16-9 0 9-3 16-9 16z" />
    <path d="M8 17c2-4 5-6 9-7" />
  </svg>
);

export const UsersIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 6a3 3 0 0 1 0 6M15 14a6 6 0 0 1 6 6" />
  </svg>
);

export const CarIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 13l2-5a2 2 0 0 1 2-1h6a2 2 0 0 1 2 1l2 5" />
    <path d="M3 13h18v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <circle cx="7.5" cy="16" r="0.5" />
    <circle cx="16.5" cy="16" r="0.5" />
  </svg>
);

export const PinIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z" />
    <circle cx="12" cy="11" r="2" />
  </svg>
);

export const ClockIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
