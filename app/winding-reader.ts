export type ContentUnderstandingField = {
  value: unknown;
  confidence: number | null;
  source?: string;
};

export type ContentUnderstandingObservation = {
  analyzerId: string;
  apiVersion: string;
  category: string;
  path: string;
  startPageNumber: number | null;
  endPageNumber: number | null;
  markdown: string;
  fields: Record<string, ContentUnderstandingField>;
  warnings: string[];
};

export type ContentUnderstandingSegment = {
  path: string;
  segmentId: string;
  category: string;
  startPageNumber: number | null;
  endPageNumber: number | null;
  confidence: number | null;
};

export type ContentUnderstandingAnalysis = {
  analyzerId: string;
  apiVersion: string;
  observations: ContentUnderstandingObservation[];
  segments: ContentUnderstandingSegment[];
  warnings: string[];
};

export type WindingColumn = {
  name: string;
  columnType: string;
  countsAsWinding: boolean;
  sourcePage: number | null;
  breakout: string;
  noLoadVoltage: string;
  fullLoadVoltage: string;
  material: string;
  insulationClass: string;
  size: string;
  dimensions: string;
  bifilar: string;
  coilLength: number | null;
  marginEachEnd: number | null;
  windingLength: number | null;
  ductStickSize: string;
  totalTurns: number | null;
  turnsLayers: string;
  layerPaper: string;
  wraps: string;
  resistance: number | null;
  weightPerCoil: number | null;
  leads: string;
};

export type PaperTapeCell = {
  name: string;
  measurement: string;
  details: string;
  sourcePage: number | null;
};

export type WindingResult = {
  analyzerId: string;
  apiVersion: string;
  catalogNumber: string;
  documentTitle: string;
  pageCount: number | null;
  coilCount: number;
  columns: WindingColumn[];
  papers: PaperTapeCell[];
  steelGrade: string;
  steelWeight: number;
  laminationThickness: number | null;
  stack: number | null;
  tubeSpecifications: string[];
  coilfaceCrossover: string;
  marginCrossover: string;
  copperWeight: number;
  aluminumWeight: number;
  totalMetalWeight: number;
  confidence: number | null;
  warnings: string[];
};

type StartResponse = {
  status: "running";
  operationId: string;
  retryAfterMs?: number;
};

type RunningResponse = StartResponse;
type CompletedResponse = ContentUnderstandingAnalysis & {
  status: "succeeded";
  operationId: string;
};
type ErrorResponse = { error?: string };

export type AnalysisProgress = "submitting" | "analyzing";

export class AnalysisTimedOutError extends Error {
  constructor() {
    super("Azure has been analyzing this document for more than 10 minutes. No result was returned.");
    this.name = "AnalysisTimedOutError";
  }
}

const MAX_ANALYSIS_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_MS = 2000;
const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 10000;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const booleanValue = (value: unknown) => value === true || text(value).toLowerCase() === "true";

function normalizedColumn(value: unknown): WindingColumn {
  const row = objectValue(value);
  return {
    name: text(row.ColumnHeader) || "UNNAMED COLUMN",
    columnType: text(row.ColumnType) || "Other Non-Winding",
    countsAsWinding: booleanValue(row.CountsAsWinding),
    sourcePage: numberValue(row.SourcePage),
    breakout: text(row.BreakOut),
    noLoadVoltage: text(row.NoLoadVoltage),
    fullLoadVoltage: text(row.FullLoadVoltage),
    material: text(row.WireMaterial),
    insulationClass: text(row.WireInsulationClass),
    size: text(row.WireNumberOrSize),
    dimensions: text(row.WireDimensions),
    bifilar: text(row.Bifilar),
    coilLength: numberValue(row.CoilLengthInches),
    marginEachEnd: numberValue(row.MarginEachEndInches),
    windingLength: numberValue(row.WindingLengthInches),
    ductStickSize: text(row.DuctStickSize),
    totalTurns: numberValue(row.TotalTurns),
    turnsLayers: [text(row.TurnsLayersRow1), text(row.TurnsLayersRow2)].filter(Boolean).join(" | "),
    layerPaper: [text(row.LayerPaper), text(row.LayerPaperDetails1), text(row.LayerPaperDetails2)].filter(Boolean).join(" | "),
    wraps: [text(row.Wrap1), text(row.Wrap1Details), text(row.Wrap2), text(row.Wrap2Details)].filter(Boolean).join(" | "),
    resistance: numberValue(row.WireResistanceOhms),
    weightPerCoil: numberValue(row.WireWeightLbsPerCoil),
    leads: text(row.Leads),
  };
}

function materialWeight(columns: WindingColumn[], coilCount: number, pattern: RegExp) {
  return columns.reduce((sum, column) => {
    if (!pattern.test(column.material)) return sum;
    return sum + (column.weightPerCoil ?? 0) * coilCount;
  }, 0);
}

export function resultFromObservation(observation: ContentUnderstandingObservation): WindingResult {
  const header = objectValue(observation.fields.DocumentHeader?.value);
  const construction = objectValue(observation.fields.MaterialsLaminationsTubesTable?.value);
  const columns = arrayValue(observation.fields.WindingTableColumns?.value).map(normalizedColumn);
  const coilCount = numberValue(header.CoilsPerTransformer) ?? 1;
  const steelWeight = numberValue(construction.SteelWeightLbs) ?? 0;
  const copperWeight = materialWeight(columns, coilCount, /\b(copper|cu)\b/i);
  const aluminumWeight = materialWeight(columns, coilCount, /\b(aluminum|aluminium|al)\b/i);
  const papers = arrayValue(observation.fields.PapersTapesTable?.value).map((value) => {
    const cell = objectValue(value);
    return {
      name: text(cell.MaterialName) || text(cell.CellText) || "Unlabeled material",
      measurement: text(cell.MeasurementKind),
      details: text(cell.QuantityText) || text(cell.CellText),
      sourcePage: numberValue(cell.SourcePage),
    };
  });
  const confidenceValues = Object.values(observation.fields)
    .map((field) => field.confidence)
    .filter((value): value is number => typeof value === "number");
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : null;

  return {
    analyzerId: observation.analyzerId,
    apiVersion: observation.apiVersion,
    catalogNumber: text(header.CatalogNumber) || "Catalog number not found",
    documentTitle: text(header.DocumentTitle) || "Winding sheet extraction",
    pageCount: numberValue(header.PageCount),
    coilCount,
    columns,
    papers,
    steelGrade: text(construction.SteelGrade),
    steelWeight,
    laminationThickness: numberValue(construction.LaminationThicknessInches),
    stack: numberValue(construction.StackInches),
    tubeSpecifications: arrayValue(construction.TubeSpecifications).map(text).filter(Boolean),
    coilfaceCrossover: text(construction.CoilfaceCrossover),
    marginCrossover: text(construction.MarginCrossover),
    copperWeight,
    aluminumWeight,
    totalMetalWeight: copperWeight + aluminumWeight + steelWeight,
    confidence,
    warnings: observation.warnings,
  };
}

function boundedRetry(value: unknown) {
  const milliseconds = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_RETRY_MS;
  return Math.min(Math.max(milliseconds, MIN_RETRY_MS), MAX_RETRY_MS);
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Analysis canceled", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Analysis canceled", "AbortError"));
    }, { once: true });
  });
}

async function readPayload(response: Response) {
  return response.json().catch(() => null) as Promise<RunningResponse | CompletedResponse | ErrorResponse | null>;
}

function responseError(payload: RunningResponse | CompletedResponse | ErrorResponse | null, fallback: string) {
  return payload && "error" in payload && payload.error ? payload.error : fallback;
}

export type AnalyzeOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
};

export async function analyzeWithAzure(
  file: File,
  options: AnalyzeOptions = {},
): Promise<ContentUnderstandingAnalysis> {
  options.onProgress?.("submitting");
  const form = new FormData();
  form.set("file", file, file.name);
  const startResponse = await fetch("/api/content-understanding", {
    method: "POST",
    body: form,
    headers: { accept: "application/json" },
    signal: options.signal,
  });
  const startPayload = await readPayload(startResponse);
  if (!startResponse.ok) {
    throw new Error(responseError(startPayload, "Azure document analysis could not be started."));
  }
  if (!startPayload || !("operationId" in startPayload) || !startPayload.operationId) {
    throw new Error("Azure did not return an analysis job ID.");
  }

  options.onProgress?.("analyzing");
  const deadline = Date.now() + MAX_ANALYSIS_MS;
  let retryAfterMs = boundedRetry("retryAfterMs" in startPayload ? startPayload.retryAfterMs : undefined);

  while (Date.now() < deadline) {
    await delay(retryAfterMs, options.signal);
    const resultResponse = await fetch(
      `/api/content-understanding?operationId=${encodeURIComponent(startPayload.operationId)}`,
      { headers: { accept: "application/json" }, cache: "no-store", signal: options.signal },
    );
    const resultPayload = await readPayload(resultResponse);
    if (resultResponse.status === 202) {
      retryAfterMs = boundedRetry(resultPayload && "retryAfterMs" in resultPayload ? resultPayload.retryAfterMs : undefined);
      continue;
    }
    if (!resultResponse.ok) {
      throw new Error(responseError(resultPayload, "Azure document analysis failed."));
    }
    if (!resultPayload || !("status" in resultPayload) || resultPayload.status !== "succeeded") {
      throw new Error("Azure returned an incomplete analysis result.");
    }
    return resultPayload as CompletedResponse;
  }

  throw new AnalysisTimedOutError();
}
