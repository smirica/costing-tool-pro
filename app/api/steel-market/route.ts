import { NextRequest, NextResponse } from "next/server";
import { hasSiteAccess } from "../../access";

export const runtime = "edge";

const SERIES_ID = "WPU1017";
const SERIES_TITLE = "Producer Price Index by Commodity: Metals and Metal Products: Steel Mill Products";
const UNITS = "Index 1982=100";
const SEASONAL_ADJUSTMENT = "Not seasonally adjusted";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Observation = { date: string; value: number };

const configured = (name: string) => process.env[name]?.trim() ?? "";

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function requestStartYear(dates: string[]) {
  const currentYear = new Date().getUTCFullYear();
  const earliestYear = Math.min(...dates.map((value) => Number(value.slice(0, 4))), currentYear);
  return Math.max(currentYear - 19, earliestYear);
}

function validMonthlyObservations(values: Observation[]) {
  return values
    .filter((value) => Number.isFinite(value.value) && /^\d{4}-\d{2}-01$/.test(value.date))
    .sort((left, right) => left.date.localeCompare(right.date));
}

async function fromBls(startYear: number): Promise<Observation[]> {
  const registrationKey = configured("BLS_API_KEY");
  const body: Record<string, unknown> = {
    seriesid: [SERIES_ID],
    startyear: String(startYear),
    endyear: String(new Date().getUTCFullYear()),
  };
  if (registrationKey) body.registrationkey = registrationKey;
  const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as {
    status?: string;
    message?: string[];
    Results?: { series?: { seriesID?: string; data?: { year?: string; period?: string; value?: string }[] }[] };
  };
  if (!response.ok || payload.status !== "REQUEST_SUCCEEDED") throw new Error(payload.message?.join(" ") || "BLS request failed.");
  const series = payload.Results?.series?.find((value) => value.seriesID?.toUpperCase() === SERIES_ID);
  return validMonthlyObservations((series?.data || []).flatMap((value) => {
    const month = value.period?.match(/^M(0[1-9]|1[0-2])$/)?.[1];
    const numeric = Number(value.value);
    return month && value.year && Number.isFinite(numeric) ? [{ date: `${value.year}-${month}-01`, value: numeric }] : [];
  }));
}

async function fromFred(startYear: number): Promise<Observation[]> {
  const apiKey = configured("FRED_API_KEY");
  if (!apiKey) throw new Error("FRED_API_KEY is not configured.");
  const query = new URLSearchParams({
    series_id: SERIES_ID,
    api_key: apiKey,
    file_type: "json",
    observation_start: `${startYear}-01-01`,
  });
  const response = await fetch(`https://api.stlouisfed.org/fred/series/observations?${query}`);
  const payload = await response.json() as { error_message?: string; observations?: { date?: string; value?: string }[] };
  if (!response.ok) throw new Error(payload.error_message || "FRED request failed.");
  return validMonthlyObservations((payload.observations || []).flatMap((value) => {
    const numeric = Number(value.value);
    return value.date && Number.isFinite(numeric) ? [{ date: value.date, value: numeric }] : [];
  }));
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin market lookup is not allowed." }, { status: 403 });
  if (!await hasSiteAccess(request)) return NextResponse.json({ error: "Site access is required." }, { status: 401 });

  const body = await request.json().catch(() => null) as { purchaseDates?: unknown } | null;
  const purchaseDates = Array.isArray(body?.purchaseDates)
    ? Array.from(new Set(body.purchaseDates.filter((value): value is string => typeof value === "string" && DATE_PATTERN.test(value)))).slice(0, 40)
    : [];
  if (!purchaseDates.length) return NextResponse.json({ error: "At least one valid vendor date is required." }, { status: 400 });

  const startYear = requestStartYear(purchaseDates);
  let observations: Observation[] = [];
  let provider: "BLS" | "FRED" = "BLS";
  let warning = "";
  try {
    observations = await fromBls(startYear);
    if (!observations.length) throw new Error("BLS returned no monthly observations.");
  } catch {
    provider = "FRED";
    warning = "The BLS request was unavailable, so the FRED copy of the same BLS series is shown.";
    observations = await fromFred(startYear).catch(() => []);
  }
  if (!observations.length) return NextResponse.json({ error: "No steel market observations were available from BLS or FRED." }, { status: 502 });

  const latest = observations.at(-1)!;
  const comparisons = purchaseDates.flatMap((requestedDate) => {
    const purchasePeriod = `${requestedDate.slice(0, 7)}-01`;
    const purchase = observations.find((value) => value.date === purchasePeriod);
    if (!purchase || purchase.value <= 0) return [];
    const multiplier = latest.value / purchase.value;
    return [{
      requestedDate,
      purchasePeriod,
      purchaseIndex: purchase.value,
      latestPeriod: latest.date,
      latestIndex: latest.value,
      multiplier,
      changePercent: (multiplier - 1) * 100,
    }];
  });

  return NextResponse.json({
    seriesId: SERIES_ID,
    title: SERIES_TITLE,
    units: UNITS,
    seasonalAdjustment: SEASONAL_ADJUSTMENT,
    provider,
    sourceLabel: provider === "BLS" ? "U.S. Bureau of Labor Statistics" : "FRED (BLS series)",
    sourceUrl: provider === "BLS" ? `https://data.bls.gov/timeseries/${SERIES_ID}` : `https://fred.stlouisfed.org/series/${SERIES_ID}`,
    latestPeriod: latest.date,
    latestIndex: latest.value,
    comparisons,
    warning,
  }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
