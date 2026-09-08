import type { SteelCostPart, SteelPriceBundle } from "../cost-analysis-data";

export type Quote = { id: string; label: string; symbol: string; unit: string; status: string; price?: number; pricePerLb?: number; quotedAt?: string; error?: string };
export type HistoryPrice = { requestedDate: string; priceDate?: string; pricePerLb?: number; status: string; error?: string };
export type Quotes = { fetchedAt: string; quotes: Quote[]; steelHistory?: HistoryPrice[] };
const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const unit = (s: string) => {
  const u = s.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (["LB", "LBS", "POUND", "POUNDS"].includes(u)) return "lb";
  if (["EA", "EACH", "PCS", "PC", "PIECE", "PIECES"].includes(u)) return "each";
  if (["KG", "KGS"].includes(u)) return "kg";
  return u;
};
export function catalogWeight(part: SteelCostPart, bundle: SteelPriceBundle | null) {
  if (!positive(part.quantity)) return null;
  if (unit(part.unitOfMeasure) === "lb") return part.quantity;
  if (unit(part.unitOfMeasure) === "kg") return part.quantity * 2.2046226218488;
  if (unit(part.unitOfMeasure) === "each" && positive(bundle?.tempel?.netWeightPerThousand))
    return part.quantity * bundle.tempel.netWeightPerThousand / 1000;
  return null;
}
export function vendorUnitRate(bundle: SteelPriceBundle | null) {
  const v = bundle?.vendor;
  if (!v) return null;
  if (positive(v.quotePrice) && unit(v.quoteUnit) === "lb") return v.quotePrice / 100;
  if (!positive(v.lastCost)) return null;
  if (unit(v.stockUnit) === "lb") return v.lastCost;
  if (unit(v.stockUnit) === "kg") return v.lastCost / 2.2046226218488;
  if (unit(v.stockUnit) === "each" && positive(bundle?.tempel?.netWeightPerThousand))
    return v.lastCost / (bundle.tempel.netWeightPerThousand / 1000);
  if (unit(v.stockUnit) === "each" && positive(v.quoteFactor)) return v.lastCost * v.quoteFactor / 100;
  return null;
}
export function historicalBasis(bundle: SteelPriceBundle | null) {
  const candidates: { source: string; date: string; rate: number }[] = [];
  const vendor = vendorUnitRate(bundle);
  if (vendor && bundle?.vendor?.lastDate) candidates.push({ source: "Dongan vendor pricing data", date: bundle.vendor.lastDate, rate: vendor });
  if (positive(bundle?.tempel?.poPricePerLb) && bundle.tempel.effectiveDate)
    candidates.push({ source: "Tempel pricing data", date: bundle.tempel.effectiveDate, rate: bundle.tempel.poPricePerLb });
  const today = new Date().toISOString().slice(0, 10);
  return candidates.filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && Number.isFinite(Date.parse(c.date)) && c.date <= today)
    .sort((a,b) => b.date.localeCompare(a.date))[0] ?? null;
}
export function currentCost(parts: SteelCostPart[], bundles: (SteelPriceBundle | null)[], windingWeight: number, market: Quotes | null) {
  const weights = parts.map((p,i) => catalogWeight(p,bundles[i]));
  const totalCatalogWeight = weights.reduce<number>((sum,w) => sum + (w ?? 0),0);
  const canAllocate = parts.length === 1 || (weights.every(positive) && totalCatalogWeight > 0);
  const steel = market?.quotes.find(q => q.id === "steel" && q.status === "available");
  const rows = parts.map((part,i) => {
    const basis = historicalBasis(bundles[i]);
    const history = market?.steelHistory?.find(h => h.requestedDate === basis?.date && h.status === "available");
    const weight = positive(windingWeight) && canAllocate ? parts.length === 1 ? windingWeight : windingWeight * weights[i]! / totalCatalogWeight : null;
    const multiplier = positive(steel?.pricePerLb) && positive(history?.pricePerLb) ? steel.pricePerLb / history.pricePerLb : null;
    const rate = basis && multiplier != null ? basis.rate * multiplier : null;
    const cost = weight != null && rate != null ? weight * rate : null;
    return { part, basis, history, weight, catalogWeight: weights[i], multiplier, rate, cost };
  });
  const complete = rows.length > 0 && rows.every(r => r.cost != null);
  return { rows, steel, total: complete ? rows.reduce((sum,r) => sum + r.cost!,0) : null,
    reason: !positive(windingWeight) ? "A positive winding-sheet steel weight is required."
      : !canAllocate ? "Part weights are needed to allocate winding-sheet steel across multiple parts."
      : !complete ? "Waiting for an approved part match, a usable dated supplier rate, or market steel pricing history." : "" };
}

