export type RoadType = "stadt" | "landstrasse" | "autobahn";

export type FuelType = "e5" | "e10" | "diesel";

export interface Person {
  id: string;
  name: string;
}

/** Kilometer je Straßentyp – wird aus der Route automatisch erkannt, ist aber editierbar. */
export interface RoadKm {
  stadt: number;
  landstrasse: number;
  autobahn: number;
}

export interface Segment {
  id: string;
  label: string;
  /** Distanz aufgeschlüsselt nach Straßentyp (km). Summe = Gesamtdistanz der Etappe. */
  roadKm: RoadKm;
  /** IDs der Personen, die auf dieser Etappe im Auto sitzen (inkl. Fahrer). */
  presentIds: string[];
}

export function segmentDistance(seg: Segment): number {
  return seg.roadKm.stadt + seg.roadKm.landstrasse + seg.roadKm.autobahn;
}

/** Zusatzkosten neben dem reinen Sprit. Im UI einzeln an-/abschaltbar. */
export interface ExtraCost {
  id: string;
  label: string;
  enabled: boolean;
  /**
   * perKm  -> amount ist €/km, wird wie Sprit pro Etappe nach Anwesenheit verteilt.
   * fixed  -> amount ist ein fixer €-Betrag (Maut, Parken, …), wird global verteilt.
   */
  mode: "perKm" | "fixed";
  amount: number;
  /** Nur für mode === "fixed": wie der Fixbetrag aufgeteilt wird. */
  fixedSplit?: "gleich" | "nachKm";
}

export interface RoadMultipliers {
  stadt: number;
  landstrasse: number;
  autobahn: number;
}

export interface CalcConfig {
  /** Basisverbrauch in l/100km (Herstellerangabe / Erfahrungswert). */
  baseConsumption: number;
  /** Verbrauchs-Faktoren je Straßentyp, multipliziert mit dem Basisverbrauch. */
  roadMultipliers: RoadMultipliers;
  /** Spritpreis €/l (z.B. günstigste Tankstelle via Tankerkönig). */
  pricePerLiter: number;
  driverId: string | null;
  /** Zahlt der Fahrer bei den Spritkosten mit? */
  driverPays: boolean;
  fuelType: FuelType;
}

export interface PersonResult {
  personId: string;
  name: string;
  /** Gefahrene Kilometer dieser Person (Summe der Etappen, auf denen sie saß). */
  personKm: number;
  fuelCost: number;
  perKmExtraCost: number;
  fixedExtraCost: number;
  total: number;
}

export interface SegmentResult {
  segmentId: string;
  label: string;
  liters: number;
  fuelCost: number;
  perKmExtraCost: number;
  /** Personen, die für diese Etappe zahlen (nach Fahrer-Regel). */
  payerIds: string[];
  costPerPayer: number;
}

export interface CalcResult {
  perPerson: PersonResult[];
  perSegment: SegmentResult[];
  totalDistanceKm: number;
  totalLiters: number;
  totalFuelCost: number;
  totalPerKmExtra: number;
  totalFixedExtra: number;
  grandTotal: number;
  warnings: string[];
}
