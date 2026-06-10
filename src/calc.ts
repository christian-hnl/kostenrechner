import { segmentDistance } from "./types";
import type { RouteInfo } from "./routing";
import type {
  CalcConfig,
  CalcResult,
  ExtraCost,
  Person,
  PersonResult,
  Segment,
  SegmentResult,
} from "./types";

export function calculate(
  config: CalcConfig,
  persons: Person[],
  segments: Segment[],
  extras: ExtraCost[],
  directRoute?: RouteInfo,
  passengerDetours?: Record<string, number>,
  passengerStandardDetours?: Record<string, number>
): CalcResult {
  const warnings: string[] = [];

  if (config.pricePerLiter <= 0) {
    warnings.push("Spritpreis ist 0 oder negativ – Spritkosten werden mit 0 gerechnet.");
  }

  const PALETTE = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e"];
  let colorIndex = 0;

  const perPerson = new Map<string, PersonResult & { weight: number }>();
  for (const p of persons) {
    let color = "#475569"; // driver
    if (p.id !== config.driverId) {
      color = PALETTE[colorIndex % PALETTE.length];
      colorIndex++;
    }

    perPerson.set(p.id, {
      personId: p.id,
      name: p.name,
      personKm: 0,
      fuelCost: 0,
      perKmExtraCost: 0,
      fixedExtraCost: 0,
      detourCost: 0,
      total: 0,
      sponsorBonus: 0,
      finalTotal: 0,
      weight: 0,
      color,
      extraDetails: [],
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

  // 1. Calculate actual segment-based totals
  for (const seg of segments) {
    const present = seg.presentIds.filter((id) => perPerson.has(id));
    const distanceKm = segmentDistance(seg);
    const m = config.roadMultipliers;
    
    const weightedKm = seg.roadKm.stadt * m.stadt + seg.roadKm.dorf * m.dorf + seg.roadKm.landstrasse * m.landstrasse + seg.roadKm.autobahn * m.autobahn;
    const liters = (weightedKm * config.baseConsumption) / 100;
    const fuelCost = liters * Math.max(config.pricePerLiter, 0);
    const perKmExtraCost = distanceKm * perKmExtraPerKm;

    totalDistanceKm += distanceKm;
    totalLiters += liters;

    for (const id of present) perPerson.get(id)!.personKm += distanceKm;

    const presentWeight = present.reduce((sum, id) => sum + (id === config.driverId ? config.driverCostFactor : 1), 0);

    if (present.length === 0 && distanceKm > 0) warnings.push(`Etappe "${seg.label}" hat keine Insassen.`);
    
    const costPerPayer = presentWeight > 0 ? (fuelCost + perKmExtraCost) / presentWeight : 0;

    if (presentWeight > 0) {
      for (const id of present) {
        const weight = id === config.driverId ? config.driverCostFactor : 1;
        const ratio = weight / presentWeight;
        const r = perPerson.get(id)!;
        r.fuelCost += fuelCost * ratio;
        r.perKmExtraCost += perKmExtraCost * ratio;
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
      payerIds: present,
      costPerPayer,
    });
  }

  // 2. Maximal Fair Marginal Detour Allocation
  let directFuelCost = totalFuelCost;
  let detourCost = 0;

  if (directRoute && config.driverId && persons.length > 1 && passengerDetours) {
    let dWeightedKm = 0;
    for (const leg of directRoute.legs) {
      const r = leg.roadKm;
      const m = config.roadMultipliers;
      dWeightedKm += r.stadt * m.stadt + r.dorf * m.dorf + r.landstrasse * m.landstrasse + r.autobahn * m.autobahn;
    }
    
    const dLiters = (dWeightedKm * config.baseConsumption) / 100;
    directFuelCost = dLiters * Math.max(config.pricePerLiter, 0);
    const dPerKmExtraCost = directRoute.totalKm * perKmExtraPerKm;
    const directTotalCost = directFuelCost + dPerKmExtraCost;
    const actualTotalCost = totalFuelCost + totalPerKmExtra;

    detourCost = Math.max(0, actualTotalCost - directTotalCost);

    // Override the segment-based personal costs
    for (const r of perPerson.values()) {
      r.fuelCost = 0;
      r.perKmExtraCost = 0;
    }

    const activePersons = [...perPerson.values()].filter(p => p.personKm > 0 || p.personId === config.driverId);
    
    // Distribute Direct Cost
    let totalBaseWeight = 0;
    for (const p of activePersons) {
      const w = p.personId === config.driverId ? config.driverCostFactor : 1;
      p.weight = p.personKm * w;
      totalBaseWeight += p.weight;
    }

    if (totalBaseWeight > 0) {
      for (const p of activePersons) {
        const share = p.weight / totalBaseWeight;
        p.fuelCost = directFuelCost * share;
        p.perKmExtraCost = dPerKmExtraCost * share;
      }
    }

    // Distribute Detour Cost
    const passengers = activePersons.filter(p => p.personId !== config.driverId);
    let sumStandalone = 0;
    
    for (const p of passengers) {
      const dKm = passengerDetours?.[p.personId] || 0;
      const stdKm = passengerStandardDetours?.[p.personId] || 0;
      p.detourKm = dKm;
      p.standardDetourKm = stdKm;
      p.dropoffDetourKm = Math.max(0, dKm - stdKm);
      sumStandalone += dKm;
    }

    const driverResult = activePersons.find(p => p.personId === config.driverId);
    if (driverResult) {
      driverResult.detourKm = 0;
      driverResult.standardDetourKm = 0;
      driverResult.dropoffDetourKm = 0;
    }

    if (detourCost > 0) {
      for (const p of passengers) {
        if (sumStandalone > 0) {
          p.detourCost = detourCost * ((p.detourKm || 0) / sumStandalone);
        } else {
          p.detourCost = detourCost / passengers.length;
        }
      }
    }
  }

  // 3. Fixed Costs
  const travelers = [...perPerson.values()].filter((r) => r.personKm > 0);
  const totalPersonKm = travelers.reduce((s, r) => s + r.personKm, 0);
  let totalFixedExtra = 0;

  for (const e of extras) {
    if (!e.enabled || e.mode !== "fixed" || e.amount === 0) continue;
    if (travelers.length === 0) continue;
    
    totalFixedExtra += e.amount;
    const split = e.fixedSplit ?? "gleich";
    if (split === "nachKm" && totalPersonKm > 0) {
      for (const r of travelers) {
        const share = (e.amount * r.personKm) / totalPersonKm;
        r.fixedExtraCost += share;
        if (share > 0) r.extraDetails.push({ label: e.label || "Pauschale", amount: share });
      }
    } else {
      const share = e.amount / travelers.length;
      for (const r of travelers) {
        r.fixedExtraCost += share;
        if (share > 0) r.extraDetails.push({ label: e.label || "Pauschale", amount: share });
      }
    }
  }

  const perPersonArr = [...perPerson.values()].map(({ weight, ...rest }) => rest);
  for (const r of perPersonArr) {
    r.total = r.fuelCost + r.perKmExtraCost + r.detourCost + r.fixedExtraCost;
    r.sponsorBonus = 0;
    r.finalTotal = r.total;
  }

  // 4. Sponsoring
  if (config.sponsorId && config.sponsorPercent && config.sponsorPercent > 0) {
    const sponsor = perPersonArr.find(r => r.personId === config.sponsorId);
    if (sponsor) {
      let totalDiscountGiven = 0;
      for (const r of perPersonArr) {
        if (r.personId !== config.sponsorId && r.total > 0) {
          const discount = r.total * (config.sponsorPercent / 100);
          r.sponsorBonus = -discount;
          r.finalTotal = r.total - discount;
          totalDiscountGiven += discount;
        }
      }
      sponsor.sponsorBonus = totalDiscountGiven;
      sponsor.finalTotal = sponsor.total + totalDiscountGiven;
    }
  }

  return {
    perPerson: perPersonArr,
    perSegment,
    totalDistanceKm,
    totalLiters,
    totalFuelCost,
    totalPerKmExtra,
    totalFixedExtra,
    directFuelCost,
    detourCost,
    grandTotal: totalFuelCost + totalPerKmExtra + totalFixedExtra,
    warnings,
  };
}
