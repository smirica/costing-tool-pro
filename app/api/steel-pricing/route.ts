import { NextRequest, NextResponse } from "next/server";
import catalogJson from "../../steel-pricing-catalog.json";
import { hasSiteAccess } from "../../access";
import type { SteelPriceBundle, TempelPrice, VendorPrice } from "../../cost-analysis-data";

export const runtime = "edge";

type Catalog = {
  metadata: {
    tempelSnapshotDate: string;
    tempelEffectiveDate: string;
    vendorSnapshotDate: string;
  };
  tempel: [string, string, string, string, number | null, number | null, number | null, string, number | null, number | null][];
  vendor: [string, string, string, string, string, number | null, number | null, string, string, number | null, string, number | null][];
};

const catalog = catalogJson as Catalog;
const normalizePartNumber = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function tempelPrice(row: Catalog["tempel"][number]): TempelPrice {
  return {
    partNumber: row[0],
    description: row[1],
    tempelPartNumber: row[2],
    effectiveDate: row[3],
    snapshotDate: catalog.metadata.tempelSnapshotDate,
    basePricePerLb: row[4],
    grossWeightPerThousand: row[5],
    netWeightPerThousand: row[6],
    surchargeCode: row[7],
    surchargePerLb: row[8],
    poPricePerLb: row[9],
  };
}

function vendorPrice(row: Catalog["vendor"][number]): VendorPrice {
  return {
    partNumber: row[0],
    vendorNumber: row[1],
    stockNumber: row[2],
    description: row[3],
    buyUnit: row[4],
    buyFactor: row[5],
    lastCost: row[6],
    stockUnit: row[7],
    lastDate: row[8],
    quotePrice: row[9],
    quoteUnit: row[10],
    quoteFactor: row[11],
    snapshotDate: catalog.metadata.vendorSnapshotDate,
  };
}

const tempelByPart = new Map<string, TempelPrice>();
for (const row of catalog.tempel) tempelByPart.set(normalizePartNumber(row[0]), tempelPrice(row));

const vendorsByPart = new Map<string, VendorPrice[]>();
for (const row of catalog.vendor) {
  const key = normalizePartNumber(row[0]);
  const list = vendorsByPart.get(key) || [];
  list.push(vendorPrice(row));
  vendorsByPart.set(key, list);
}

function dateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function vendorRank(value: VendorPrice) {
  if ((value.lastCost || 0) > 0) return 2;
  if ((value.quotePrice || 0) > 0) return 1;
  return 0;
}

function rankedVendors(partNumber: string) {
  return [...(vendorsByPart.get(partNumber) || [])].sort((left, right) =>
    vendorRank(right) - vendorRank(left)
    || dateValue(right.lastDate) - dateValue(left.lastDate)
    || Number(right.vendorNumber === "09400") - Number(left.vendorNumber === "09400"));
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + Number(left[row - 1] !== right[column - 1]),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

const availablePartNumbers = Array.from(new Set([...tempelByPart.keys(), ...vendorsByPart.keys()]));

function closestPartNumber(requested: string) {
  let best = "";
  let bestScore = 0;
  for (const candidate of availablePartNumbers) {
    const score = 1 - editDistance(requested, candidate) / Math.max(requested.length, candidate.length, 1);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= 0.72 ? { partNumber: best, similarity: bestScore } : null;
}

function priceBundle(requestedPartNumber: string): SteelPriceBundle {
  const requested = normalizePartNumber(requestedPartNumber);
  const exact = tempelByPart.has(requested) || vendorsByPart.has(requested);
  const closest = exact ? null : closestPartNumber(requested);
  const matchedPartNumber = exact ? requested : closest?.partNumber || "";
  const vendors = matchedPartNumber ? rankedVendors(matchedPartNumber) : [];

  return {
    requestedPartNumber,
    matchedPartNumber: tempelByPart.get(matchedPartNumber)?.partNumber || vendors[0]?.partNumber || "",
    matchKind: exact ? "exact" : closest ? "closest" : "none",
    similarity: closest?.similarity || null,
    tempel: tempelByPart.get(matchedPartNumber) || null,
    vendor: vendors[0] || null,
    vendorAlternatives: vendors.slice(0, 5),
  };
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin pricing lookup is not allowed." }, { status: 403 });
  }
  if (!await hasSiteAccess(request)) {
    return NextResponse.json({ error: "Site access is required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { partNumbers?: unknown } | null;
  const partNumbers = Array.isArray(body?.partNumbers)
    ? body.partNumbers.filter((value): value is string => typeof value === "string" && value.length <= 80).slice(0, 100)
    : [];

  return NextResponse.json({
    sourceSummary: {
      tempelRows: catalog.tempel.length,
      vendorRows: catalog.vendor.length,
      tempelEffectiveDate: catalog.metadata.tempelEffectiveDate,
      tempelSnapshotDate: catalog.metadata.tempelSnapshotDate,
      vendorSnapshotDate: catalog.metadata.vendorSnapshotDate,
    },
    matches: partNumbers.map(priceBundle),
  });
}
