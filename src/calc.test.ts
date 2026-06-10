import { describe, it, expect } from "vitest";
import { calculate } from "./calc";
import type { CalcConfig, ExtraCost, Person, RoadKm, RoadType, Segment } from "./types";

const A = "a";
const B = "b";
const C = "c";

const persons: Person[] = [
  { id: A, name: "A (Fahrer)" },
  { id: B, name: "B" },
  { id: C, name: "C" },
];

/** Hilfsfunktion: km auf einem einzigen Straßentyp. */
function km(type: RoadType, value: number): RoadKm {
  return { stadt: 0, dorf: 0, landstrasse: 0, autobahn: 0, [type]: value };
}

function cfg(over: Partial<CalcConfig> = {}): CalcConfig {
  return {
    baseConsumption: 8,
    roadMultipliers: { stadt: 1.5, dorf: 1.25, landstrasse: 1, autobahn: 1.25 },
    pricePerLiter: 2,
    driverId: A,
    driverCostFactor: 1,
    fuelType: "e10",
    ...over,
  };
}

describe("calculate – faire Aufteilung", () => {
  it("teilt eine Etappe gleichmäßig auf alle Insassen", () => {
    // 100 km Landstraße, Verbrauch 8 l/100km -> 8 l, * 2 €/l = 16 €
    const segs: Segment[] = [
      { id: "s1", label: "S1", roadKm: km("landstrasse", 100), presentIds: [A, B, C] },
    ];
    const r = calculate(cfg(), persons, segs, []);
    expect(r.totalLiters).toBeCloseTo(8);
    expect(r.totalFuelCost).toBeCloseTo(16);
    for (const p of r.perPerson) expect(p.total).toBeCloseTo(16 / 3);
  });

  it("rechnet nach Personen-km statt pauschal durch die Köpfe", () => {
    // Etappe 1: alle 3 fahren 100 km. Etappe 2: nur A & B fahren weitere 100 km.
    const segs: Segment[] = [
      { id: "s1", label: "S1", roadKm: km("landstrasse", 100), presentIds: [A, B, C] },
      { id: "s2", label: "S2", roadKm: km("landstrasse", 100), presentIds: [A, B] },
    ];
    const r = calculate(cfg(), persons, segs, []);
    // Jede Etappe kostet 16 €. S1 /3, S2 /2.
    const a = r.perPerson.find((p) => p.personId === A)!;
    const c = r.perPerson.find((p) => p.personId === C)!;
    expect(c.total).toBeCloseTo(16 / 3); // C nur erste Etappe
    expect(a.total).toBeCloseTo(16 / 3 + 16 / 2); // A beide Etappen
    expect(r.grandTotal).toBeCloseTo(32);
  });

  it("berücksichtigt den Straßentyp-Faktor", () => {
    const segs: Segment[] = [
      { id: "s1", label: "S1", roadKm: km("autobahn", 100), presentIds: [A] },
    ];
    const r = calculate(cfg(), persons, segs, []);
    // 8 * 1.25 = 10 l -> 20 €
    expect(r.totalFuelCost).toBeCloseTo(20);
  });

  it("rechnet den Verbrauch aus der km-Mischung je Straßentyp", () => {
    // 40 km Autobahn (×1.25), 50 km Landstraße (×1), 10 km Stadt (×1.5), Basis 8 l/100km.
    // weightedKm = 40*1.25 + 50*1 + 10*1.5 = 50 + 50 + 15 = 115 -> 115*8/100 = 9.2 l -> *2 = 18.40 €
    const segs: Segment[] = [
      {
        id: "s1",
        label: "S1",
        roadKm: { stadt: 10, dorf: 0, landstrasse: 50, autobahn: 40 },
        presentIds: [A],
      },
    ];
    const r = calculate(cfg(), persons, segs, []);
    expect(r.totalDistanceKm).toBeCloseTo(100);
    expect(r.totalLiters).toBeCloseTo(9.2);
    expect(r.totalFuelCost).toBeCloseTo(18.4);
  });

  it("nimmt den Fahrer aus, wenn driverPays = false", () => {
    const segs: Segment[] = [
      { id: "s1", label: "S1", roadKm: km("landstrasse", 100), presentIds: [A, B, C] },
    ];
    const r = calculate(cfg({ driverCostFactor: 0 }), persons, segs, []);
    const a = r.perPerson.find((p) => p.personId === A)!;
    expect(a.fuelCost).toBeCloseTo(0);
    // 16 € auf B und C
    const b = r.perPerson.find((p) => p.personId === B)!;
    expect(b.total).toBeCloseTo(8);
  });

  it("verteilt perKm-Zusatzkosten wie Sprit nach Anwesenheit", () => {
    const segs: Segment[] = [
      { id: "s1", label: "S1", roadKm: km("landstrasse", 100), presentIds: [A, B] },
    ];
    const extras: ExtraCost[] = [
      { id: "e1", label: "Verschleiß", enabled: true, mode: "perKm", amount: 0.1 },
    ];
    const r = calculate(cfg(), persons, segs, extras);
    expect(r.totalPerKmExtra).toBeCloseTo(10); // 100 km * 0.10
    const a = r.perPerson.find((p) => p.personId === A)!;
    expect(a.perKmExtraCost).toBeCloseTo(5);
  });

  it("teilt Fixkosten gleich bzw. nach km", () => {
    const segs: Segment[] = [
      { id: "s1", label: "S1", roadKm: km("landstrasse", 100), presentIds: [A, B, C] },
      { id: "s2", label: "S2", roadKm: km("landstrasse", 100), presentIds: [A, B] },
    ];
    const gleich: ExtraCost[] = [
      { id: "m", label: "Maut", enabled: true, mode: "fixed", amount: 30, fixedSplit: "gleich" },
    ];
    const rg = calculate(cfg(), persons, segs, gleich);
    for (const p of rg.perPerson) expect(p.fixedExtraCost).toBeCloseTo(10);

    const nachKm: ExtraCost[] = [
      { id: "m", label: "Maut", enabled: true, mode: "fixed", amount: 30, fixedSplit: "nachKm" },
    ];
    const rk = calculate(cfg(), persons, segs, nachKm);
    // personKm: A=200, B=200, C=100 -> total 500. C zahlt 30*100/500 = 6
    const c = rk.perPerson.find((p) => p.personId === C)!;
    expect(c.fixedExtraCost).toBeCloseTo(6);
  });

  it("ignoriert deaktivierte Zusatzkosten", () => {
    const segs: Segment[] = [
      { id: "s1", label: "S1", roadKm: km("landstrasse", 100), presentIds: [A] },
    ];
    const extras: ExtraCost[] = [
      { id: "e1", label: "Verschleiß", enabled: false, mode: "perKm", amount: 0.5 },
    ];
    const r = calculate(cfg(), persons, segs, extras);
    expect(r.totalPerKmExtra).toBe(0);
  });
});
