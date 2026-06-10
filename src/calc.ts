import { segmentDistance } from "./types";
import type {
  CalcConfig,
  CalcResult,
  ExtraCost,
  Person,
  PersonResult,
  Segment,
  SegmentResult,
} from "./types";

/**
 * Faire Aufteilung der Fahrtkosten.
 *
 * Grundidee: Es wird NICHT pauschal durch die Personenzahl geteilt. Stattdessen
 * werden die Kosten Etappe für Etappe nur auf die Personen verteilt, die auf
 * dieser Etappe tatsächlich im Auto saßen. Wer nur ein kurzes Stück mitfährt,
 * zahlt entsprechend weniger.
 *
 * Sprit pro Etappe = Distanz × (Basisverbrauch × Straßentyp-Faktor) × Spritpreis.
 */
export function calculate(
  config: CalcConfig,
  persons: Person[],
  segments: Segment[],
  extras: ExtraCost[],
): CalcResult {
  const warnings: string[] = [];

  if (config.pricePerLiter <= 0) {
    warnings.push("Spritpreis ist 0 oder negativ – Spritkosten werden mit 0 gerechnet.");
  }
  if (config.baseConsumption <= 0) {
    warnings.push("Verbrauch ist 0 oder negativ – bitte einen realistischen Wert angeben.");
  }

  const perPerson = new Map<string, PersonResult>();
  for (const p of persons) {
    perPerson.set(p.id, {
      personId: p.id,
      name: p.name,
      personKm: 0,
      fuelCost: 0,
      perKmExtraCost: 0,
      fixedExtraCost: 0,
      total: 0,
    });
  }

  const perKmExtraPerKm = extras
    .filter((e) => e.enabled && e.mode === "perKm")
    .reduce((sum, e) => sum + e.amount, 0);

  const perSegment: SegmentResult[] = [];
  let totalDistanceKm = 0;
  let totalLiters = 0;
  let totalFuelCost = 0;
  let totalPerKmExtra = 0;

  for (const seg of segments) {
    const present = seg.presentIds.filter((id) => perPerson.has(id));
    const distanceKm = segmentDistance(seg);
    const m = config.roadMultipliers;
    // Verbrauch aus der km-Mischung je Straßentyp – jeder Straßentyp mit eigenem Faktor.
    const weightedKm =
      seg.roadKm.stadt * m.stadt +
      seg.roadKm.landstrasse * m.landstrasse +
      seg.roadKm.autobahn * m.autobahn;
    const liters = (weightedKm * config.baseConsumption) / 100;
    const fuelCost = liters * Math.max(config.pricePerLiter, 0);
    const perKmExtraCost = distanceKm * perKmExtraPerKm;

    totalDistanceKm += distanceKm;
    totalLiters += liters;

    // Personen-Kilometer für jede anwesende Person (für Anzeige + Fixkosten-Verteilung).
    for (const id of present) {
      perPerson.get(id)!.personKm += distanceKm;
    }

    // Wer zahlt diese Etappe? Fahrer optional ausgenommen.
    let payers = present;
    if (!config.driverPays && config.driverId) {
      payers = present.filter((id) => id !== config.driverId);
    }

    if (distanceKm <= 0) {
      warnings.push(`Etappe "${seg.label}" hat keine Distanz und wird ignoriert.`);
    }
    if (present.length === 0 && distanceKm > 0) {
      warnings.push(`Etappe "${seg.label}" hat keine Insassen – Kosten werden niemandem zugeordnet.`);
    } else if (payers.length === 0 && distanceKm > 0) {
      warnings.push(
        `Auf Etappe "${seg.label}" sitzt nur der Fahrer (zahlt nicht) – diese Kosten trägt der Fahrer selbst.`,
      );
    }

    const costPerPayer = payers.length > 0 ? (fuelCost + perKmExtraCost) / payers.length : 0;

    if (payers.length > 0) {
      const fuelShare = fuelCost / payers.length;
      const extraShare = perKmExtraCost / payers.length;
      for (const id of payers) {
        const r = perPerson.get(id)!;
        r.fuelCost += fuelShare;
        r.perKmExtraCost += extraShare;
      }
      totalFuelCost += fuelCost;
      totalPerKmExtra += perKmExtraCost;
    }

    perSegment.push({
      segmentId: seg.id,
      label: seg.label,
      liters,
      fuelCost,
      perKmExtraCost,
      payerIds: payers,
      costPerPayer,
    });
  }

  // Fixkosten (Maut, Parken, …) auf alle Reisenden verteilen.
  const travelers = [...perPerson.values()].filter((r) => r.personKm > 0);
  const totalPersonKm = travelers.reduce((s, r) => s + r.personKm, 0);
  let totalFixedExtra = 0;

  for (const e of extras) {
    if (!e.enabled || e.mode !== "fixed" || e.amount === 0) continue;
    if (travelers.length === 0) {
      warnings.push(`Fixkosten "${e.label}" können nicht verteilt werden – keine Reisenden.`);
      continue;
    }
    totalFixedExtra += e.amount;
    const split = e.fixedSplit ?? "gleich";
    if (split === "nachKm" && totalPersonKm > 0) {
      for (const r of travelers) {
        r.fixedExtraCost += (e.amount * r.personKm) / totalPersonKm;
      }
    } else {
      const share = e.amount / travelers.length;
      for (const r of travelers) r.fixedExtraCost += share;
    }
  }

  const perPersonArr = [...perPerson.values()];
  for (const r of perPersonArr) {
    r.total = r.fuelCost + r.perKmExtraCost + r.fixedExtraCost;
  }

  return {
    perPerson: perPersonArr,
    perSegment,
    totalDistanceKm,
    totalLiters,
    totalFuelCost,
    totalPerKmExtra,
    totalFixedExtra,
    grandTotal: totalFuelCost + totalPerKmExtra + totalFixedExtra,
    warnings,
  };
}
