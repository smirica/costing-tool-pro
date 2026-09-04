export const COST_ANALYSIS_STORAGE_KEY = "winding-intelligence-steel-cost-inputs";
export const DOCUMENT_ANALYSIS_STORAGE_KEY = "winding-intelligence-document-analysis";

export type SteelCostPart = {
  partNumber: string;
  quantity: number | null;
  unitOfMeasure: string;
  title: string;
  description: string;
  sourceAssembly: string;
};

export type SteelCostInputs = {
  fileName: string;
  catalogNumber: string;
  capturedAt: string;
  steelGrade: string;
  steelWeightLbs: number;
  parts: SteelCostPart[];
};

export type TempelPrice = {
  partNumber: string;
  description: string;
  tempelPartNumber: string;
  effectiveDate: string;
  snapshotDate: string;
  basePricePerLb: number | null;
  grossWeightPerThousand: number | null;
  netWeightPerThousand: number | null;
  surchargeCode: string;
  surchargePerLb: number | null;
  poPricePerLb: number | null;
};

export type VendorPrice = {
  partNumber: string;
  vendorNumber: string;
  stockNumber: string;
  description: string;
  buyUnit: string;
  buyFactor: number | null;
  lastCost: number | null;
  stockUnit: string;
  lastDate: string;
  quotePrice: number | null;
  quoteUnit: string;
  quoteFactor: number | null;
  snapshotDate: string;
};

export type SteelPriceBundle = {
  requestedPartNumber: string;
  matchedPartNumber: string;
  matchKind: "exact" | "closest" | "none";
  similarity: number | null;
  tempel: TempelPrice | null;
  vendor: VendorPrice | null;
  vendorAlternatives: VendorPrice[];
};

export type SteelPricingResponse = {
  sourceSummary: {
    tempelRows: number;
    vendorRows: number;
    tempelEffectiveDate: string;
    tempelSnapshotDate: string;
    vendorSnapshotDate: string;
  };
  matches: SteelPriceBundle[];
};

export type SteelMarketComparison = {
  requestedDate: string;
  purchasePeriod: string;
  purchaseIndex: number;
  latestPeriod: string;
  latestIndex: number;
  multiplier: number;
  changePercent: number;
};

export type SteelMarketResponse = {
  seriesId: string;
  title: string;
  units: string;
  seasonalAdjustment: string;
  provider: "BLS" | "FRED";
  sourceLabel: string;
  sourceUrl: string;
  latestPeriod: string;
  latestIndex: number;
  comparisons: SteelMarketComparison[];
  warning: string;
};
