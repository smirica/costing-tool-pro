import {
  analyzeWithAzure,
  resultFromObservation,
  type AnalysisProgress,
  type ContentUnderstandingObservation,
  type WindingResult,
} from "./winding-reader";

export type DesignPacketHeader = {
  catalogNumber: string;
  dateCreated: string;
  dateRevised: string;
};

export type StopPointColumn = {
  windingName: string;
  breakOuts: string;
  stopPoints: string;
};

export type DesignPacketPartRow = {
  partNumber: string;
  quantity: number | null;
  unitOfMeasure: string;
  description: string;
};

export type OtherPartsAssembly = {
  originallyFor: string;
  title: string;
  otherPartNumber: string;
  reportedTotalItems: number | null;
  parts: DesignPacketPartRow[];
};

export type DesignPacketResult = {
  analyzerId: string;
  apiVersion: string;
  header: DesignPacketHeader;
  stopPoints: StopPointColumn[];
  notes: string;
  windingSheetPages: number[];
  assemblies: OtherPartsAssembly[];
  confidence: number | null;
  warnings: string[];
};

export type DesignPacketAnalysisResult = {
  designPacket: DesignPacketResult;
  windingSheet: WindingResult | null;
};

type DesignPacketAnalysisOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
  onStage?: (stage: "design-packet" | "winding-sheet") => void;
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

function averageConfidence(observation: ContentUnderstandingObservation) {
  const values = Object.values(observation.fields)
    .map((field) => field.confidence)
    .filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function designPacketFromObservation(observation: ContentUnderstandingObservation): DesignPacketResult {
  const header = objectValue(observation.fields.DocumentHeader?.value);
  const stopPoints = arrayValue(observation.fields.StopPointsTable?.value).map((value) => {
    const row = objectValue(value);
    return {
      windingName: text(row.WindingName) || "Unnamed winding",
      breakOuts: text(row.BreakOuts),
      stopPoints: text(row.StopPoints),
    };
  });
  const windingSheetPages = Array.from(new Set(
    arrayValue(observation.fields.EmbeddedWindingSheetPageNumbers?.value)
      .map(numberValue)
      .filter((value): value is number => value !== null && Number.isInteger(value) && value > 0),
  )).sort((a, b) => a - b);
  const assembliesByNumber = new Map<string, OtherPartsAssembly>();
  for (const value of arrayValue(observation.fields.OtherPartsAssemblies?.value)) {
    const assembly = objectValue(value);
    const parts = arrayValue(assembly.PartsTable).map((partValue) => {
      const part = objectValue(partValue);
      return {
        partNumber: text(part.PartNumber),
        quantity: numberValue(part.Quantity),
        unitOfMeasure: text(part.UnitOfMeasure),
        description: text(part.Description),
      };
    }).filter((part) => Boolean(part.partNumber && part.quantity !== null && part.unitOfMeasure));
    const otherPartNumber = text(assembly.OtherPartNumber);
    if (!otherPartNumber || !parts.length) continue;
    const candidate: OtherPartsAssembly = {
      originallyFor: text(assembly.OriginallyFor),
      title: text(assembly.Title) || "Other parts",
      otherPartNumber,
      reportedTotalItems: numberValue(assembly.TotalItems),
      parts,
    };
    const key = otherPartNumber.toUpperCase().replace(/\s+/g, "");
    const current = assembliesByNumber.get(key);
    if (!current || candidate.parts.length > current.parts.length) {
      assembliesByNumber.set(key, candidate);
    }
  }
  const assemblies = Array.from(assembliesByNumber.values());

  return {
    analyzerId: observation.analyzerId,
    apiVersion: observation.apiVersion,
    header: {
      catalogNumber: text(header.CatalogNumber) || "Catalog number not found",
      dateCreated: text(header.DateCreated),
      dateRevised: text(header.DateRevised),
    },
    stopPoints,
    notes: String(observation.fields.Notes?.value ?? "").trim(),
    windingSheetPages,
    assemblies,
    confidence: averageConfidence(observation),
    warnings: observation.warnings,
  };
}

export async function analyzeDesignPacket(
  file: File,
  options: DesignPacketAnalysisOptions = {},
): Promise<DesignPacketAnalysisResult> {
  options.onStage?.("design-packet");
  const packetObservation = await analyzeWithAzure(file, {
    analyzerKind: "design-packet",
    signal: options.signal,
    onProgress: options.onProgress,
  });
  const designPacket = designPacketFromObservation(packetObservation);

  if (!designPacket.windingSheetPages.length) {
    return { designPacket, windingSheet: null };
  }

  options.onStage?.("winding-sheet");
  const windingObservation = await analyzeWithAzure(file, {
    analyzerKind: "winding-sheet",
    pageRange: designPacket.windingSheetPages.join(","),
    signal: options.signal,
    onProgress: options.onProgress,
  });

  return {
    designPacket,
    windingSheet: resultFromObservation(windingObservation),
  };
}