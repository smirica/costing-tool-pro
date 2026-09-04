import {
  analyzeWithAzure,
  resultFromObservation,
  type AnalysisProgress,
  type ContentUnderstandingAnalysis,
  type ContentUnderstandingField,
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

export type ClassifiedDocumentResult = {
  designPacket: DesignPacketResult | null;
  windingSheet: WindingResult | null;
  categories: string[];
};

type ClassifiedDocumentOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
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
const normalizedCategory = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

type RecoveredMarkdownPart = DesignPacketPartRow & {
  title: string;
  otherPartNumber: string;
};

function cleanMarkdownCell(value: string) {
  return text(value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'"));
}

function markdownContext(markdown: string, rowIndex: number, description: string) {
  const context = cleanMarkdownCell(markdown.slice(Math.max(0, rowIndex - 1500), rowIndex));
  const titles = Array.from(context.matchAll(/\b([A-Z][A-Za-z&/ -]{1,40} Assembly)\b/gi));
  const assemblyNumbers = Array.from(context.matchAll(/\b(?:\d+[A-Z]|[A-Z]\d+)-\d{3,}\b/gi));
  return {
    title: titles.at(-1)?.[1] || (/\bLAM\b/i.test(description) ? "Core Assembly" : "Other parts"),
    otherPartNumber: assemblyNumbers.at(-1)?.[0] || "Recovered 510 parts",
  };
}

function recoveredMarkdownRow(markdown: string, rawCells: string[], rowIndex: number): RecoveredMarkdownPart | null {
  const cells = rawCells.map(cleanMarkdownCell).filter(Boolean);
  const partIndex = cells.findIndex((cell) => /\b510(?:[\s.-]*[A-Z0-9])/i.test(cell));
  if (partIndex < 0) return null;

  const partMatch = cells[partIndex].match(/\b510(?:[\s.-]*[A-Z0-9][A-Z0-9./-]*)/i);
  if (!partMatch) return null;
  const partNumber = partMatch[0].replace(/\s+/g, "").replace(/^510[.-]?/i, "510-").toUpperCase();
  const quantityIndex = cells.findIndex((cell, index) => index !== partIndex && /^\d+(?:\.\d+)?$/.test(cell.replace(/,/g, "")));
  const unitIndex = cells.findIndex((cell, index) => index !== partIndex && /^(?:EA|EACH|PC|PCS|PIECE|PIECES|LB|LBS|POUND|POUNDS|M)$/i.test(cell));
  const quantity = quantityIndex >= 0 ? numberValue(cells[quantityIndex]) : null;
  const unitOfMeasure = unitIndex >= 0 ? cells[unitIndex].toUpperCase() : "";
  const description = cells
    .filter((_, index) => index !== partIndex && index !== quantityIndex && index !== unitIndex)
    .join(" ")
    .replace(partMatch[0], "")
    .trim();
  const context = markdownContext(markdown, rowIndex, description);
  return { partNumber, quantity, unitOfMeasure, description, ...context };
}

export function recover510PartsFromMarkdown(markdown: string): RecoveredMarkdownPart[] {
  if (!markdown) return [];
  const candidates: RecoveredMarkdownPart[] = [];
  const add = (cells: string[], rowIndex: number) => {
    const part = recoveredMarkdownRow(markdown, cells, rowIndex);
    if (part) candidates.push(part);
  };

  for (const match of markdown.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (cell) => cell[1]);
    if (cells.length) add(cells, match.index);
  }
  for (const match of markdown.matchAll(/^.*\b510(?:[\s.-]*[A-Z0-9]).*$/gim)) {
    const line = match[0];
    const cells = line.includes("|")
      ? line.split("|").filter((cell) => cell.trim() && !/^\s*:?-+:?\s*$/.test(cell))
      : line.split(/\t+|\s{2,}/).filter(Boolean);
    add(cells.length > 1 ? cells : [line], match.index);
  }

  const unique = new Map<string, RecoveredMarkdownPart>();
  for (const candidate of candidates) {
    const key = candidate.partNumber.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const current = unique.get(key);
    const score = (value: RecoveredMarkdownPart) => Number(value.quantity !== null) + Number(Boolean(value.unitOfMeasure)) + Number(Boolean(value.description));
    if (!current || score(candidate) > score(current)) unique.set(key, candidate);
  }
  return Array.from(unique.values());
}

function averageConfidence(observation: ContentUnderstandingObservation) {
  const values = Object.values(observation.fields)
    .map((field) => field.confidence)
    .filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function mergeValues(fieldName: string, current: unknown, incoming: unknown): unknown {
  if (current === null || current === undefined || current === "") return incoming;
  if (incoming === null || incoming === undefined || incoming === "") return current;
  if (Array.isArray(current) && Array.isArray(incoming)) return [...current, ...incoming];
  if (typeof current === "object" && typeof incoming === "object" && !Array.isArray(current) && !Array.isArray(incoming)) {
    const merged = { ...current as Record<string, unknown> };
    for (const [name, value] of Object.entries(incoming as Record<string, unknown>)) {
      merged[name] = mergeValues(name, merged[name], value);
    }
    return merged;
  }
  if (fieldName === "Notes" && typeof current === "string" && typeof incoming === "string" && current !== incoming) {
    return `${current.trim()}\n\n${incoming.trim()}`.trim();
  }
  return current;
}

function mergeObservations(
  analysis: ContentUnderstandingAnalysis,
  observations: ContentUnderstandingObservation[],
): ContentUnderstandingObservation | null {
  if (!observations.length) return null;
  const fields: Record<string, ContentUnderstandingField> = {};
  for (const observation of observations) {
    for (const [name, field] of Object.entries(observation.fields)) {
      const current = fields[name];
      fields[name] = current ? {
        value: mergeValues(name, current.value, field.value),
        confidence: Math.max(current.confidence ?? 0, field.confidence ?? 0) || null,
        source: current.source || field.source,
      } : field;
    }
  }
  const starts = observations.map((item) => item.startPageNumber).filter((value): value is number => value !== null);
  const ends = observations.map((item) => item.endPageNumber).filter((value): value is number => value !== null);
  return {
    analyzerId: observations.find((item) => item.analyzerId)?.analyzerId || analysis.analyzerId,
    apiVersion: analysis.apiVersion,
    category: observations[0].category,
    path: observations.map((item) => item.path).filter(Boolean).join(","),
    startPageNumber: starts.length ? Math.min(...starts) : null,
    endPageNumber: ends.length ? Math.max(...ends) : null,
    markdown: observations.map((item) => item.markdown).filter(Boolean).join("\n\n"),
    fields,
    warnings: analysis.warnings,
  };
}

function isWindingObservation(observation: ContentUnderstandingObservation) {
  const category = normalizedCategory(observation.category);
  const analyzer = normalizedCategory(observation.analyzerId);
  return category === "windingsheet" || analyzer.includes("windingsheet")
    || Boolean(observation.fields.WindingTableColumns || observation.fields.MaterialsLaminationsTubesTable);
}

function isDesignPacketObservation(observation: ContentUnderstandingObservation) {
  const category = normalizedCategory(observation.category);
  const analyzer = normalizedCategory(observation.analyzerId);
  return category === "designpacket" || analyzer.includes("designpacketanalyzer")
    || Boolean(observation.fields.StopPointsTable || observation.fields.OtherPartsAssemblies);
}

function pagesForCategory(analysis: ContentUnderstandingAnalysis, categoryName: string) {
  const pages = new Set<number>();
  const target = normalizedCategory(categoryName);
  const ranges = [
    ...analysis.segments.filter((segment) => normalizedCategory(segment.category) === target),
    ...analysis.observations.filter((observation) => normalizedCategory(observation.category) === target),
  ];
  for (const range of ranges) {
    if (range.startPageNumber === null || range.endPageNumber === null) continue;
    for (let page = range.startPageNumber; page <= range.endPageNumber; page += 1) pages.add(page);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function addPageRange(pages: Set<number>, start: number | null, end: number | null) {
  if (start === null || end === null || start < 1 || end < start) return;
  for (let page = start; page <= end; page += 1) pages.add(page);
}

function addNestedSourcePages(value: unknown, pages: Set<number>) {
  if (Array.isArray(value)) {
    for (const item of value) addNestedSourcePages(item, pages);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    if (normalizedCategory(name) === "sourcepage") {
      const page = numberValue(item);
      if (page !== null && page >= 1) pages.add(page);
    }
    addNestedSourcePages(item, pages);
  }
}

function pagesForWinding(
  analysis: ContentUnderstandingAnalysis,
  observation: ContentUnderstandingObservation | null,
) {
  const pages = new Set(pagesForCategory(analysis, "Winding_Sheet"));
  if (!observation) return Array.from(pages).sort((a, b) => a - b);

  addPageRange(pages, observation.startPageNumber, observation.endPageNumber);
  for (const field of Object.values(observation.fields)) {
    addNestedSourcePages(field.value, pages);
    for (const match of field.source?.matchAll(/\bD\((\d+),/g) ?? []) {
      const page = Number(match[1]);
      if (Number.isInteger(page) && page >= 1) pages.add(page);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

export function designPacketFromObservation(
  observation: ContentUnderstandingObservation,
  windingSheetPages: number[] = [],
): DesignPacketResult {
  const header = objectValue(observation.fields.DocumentHeader?.value);
  const stopPoints = arrayValue(observation.fields.StopPointsTable?.value).map((value) => {
    const row = objectValue(value);
    return {
      windingName: text(row.WindingName) || "Unnamed winding",
      breakOuts: text(row.BreakOuts),
      stopPoints: text(row.StopPoints),
    };
  });
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
    if (!current || candidate.parts.length > current.parts.length) assembliesByNumber.set(key, candidate);
  }

  const existingPartNumbers = new Set(Array.from(assembliesByNumber.values())
    .flatMap((assembly) => assembly.parts)
    .map((part) => part.partNumber.replace(/[^A-Z0-9]/gi, "").toUpperCase()));
  for (const recovered of recover510PartsFromMarkdown(observation.markdown)) {
    const normalizedPartNumber = recovered.partNumber.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (existingPartNumbers.has(normalizedPartNumber)) continue;
    let target = Array.from(assembliesByNumber.values()).find((assembly) =>
      assembly.otherPartNumber.toUpperCase() === recovered.otherPartNumber.toUpperCase()
      || assembly.title.toLowerCase() === recovered.title.toLowerCase());
    if (!target) {
      target = {
        originallyFor: "",
        title: recovered.title,
        otherPartNumber: recovered.otherPartNumber,
        reportedTotalItems: null,
        parts: [],
      };
      let key = recovered.otherPartNumber.toUpperCase().replace(/\s+/g, "");
      while (assembliesByNumber.has(key)) key = `${key}-RECOVERED`;
      assembliesByNumber.set(key, target);
    }
    target.parts.push({
      partNumber: recovered.partNumber,
      quantity: recovered.quantity,
      unitOfMeasure: recovered.unitOfMeasure,
      description: recovered.description,
    });
    existingPartNumbers.add(normalizedPartNumber);
  }

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
    assemblies: Array.from(assembliesByNumber.values()),
    confidence: averageConfidence(observation),
    warnings: observation.warnings,
  };
}

export async function analyzeDocument(
  file: File,
  options: ClassifiedDocumentOptions = {},
): Promise<ClassifiedDocumentResult> {
  const analysis = await analyzeWithAzure(file, options);
  const designObservation = mergeObservations(analysis, analysis.observations.filter(isDesignPacketObservation));
  const windingObservation = mergeObservations(analysis, analysis.observations.filter(isWindingObservation));
  const categories = Array.from(new Set([
    ...analysis.segments.map((segment) => segment.category),
    ...analysis.observations.map((observation) => observation.category),
  ].filter(Boolean)));

  return {
    designPacket: designObservation
      ? designPacketFromObservation(designObservation, pagesForWinding(analysis, windingObservation))
      : null,
    windingSheet: windingObservation ? resultFromObservation(windingObservation) : null,
    categories,
  };
}
