import { NextRequest, NextResponse } from "next/server";
import { hasSiteAccess } from "../../access";

export const runtime = "edge";

const DEFAULT_ENDPOINT = "https://gator-content-understanding.services.ai.azure.com";
const DEFAULT_ANALYZER_ID = "DesignPacketClassifier";
const DEFAULT_API_VERSION = "2025-11-01";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const RESULT_PATH = "/contentunderstanding/analyzerResults/";
const JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff"]);
const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "jpe", "png", "tif", "tiff"]);
const VALUE_KEYS = [
  "value",
  "valueString",
  "valueDate",
  "valueTime",
  "valueNumber",
  "valueInteger",
  "valueBoolean",
  "valueArray",
  "valueObject",
] as const;

type AzureField = {
  value?: unknown;
  valueString?: string;
  valueDate?: string;
  valueTime?: string;
  valueNumber?: number;
  valueInteger?: number;
  valueBoolean?: boolean;
  valueArray?: unknown[];
  valueObject?: Record<string, unknown>;
  confidence?: number;
  source?: string;
  type?: string;
};

class ContentUnderstandingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const configured = (name: string) => process.env[name]?.trim() ?? "";

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function allowedFile(file: File) {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return ALLOWED_TYPES.has(file.type.toLowerCase()) || ALLOWED_EXTENSIONS.has(extension);
}

function azureMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: { message?: string }; message?: string };
  return String(value.error?.message || value.message || fallback).slice(0, 500);
}

function unwrapAzureValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(unwrapAzureValue);
  if (!raw || typeof raw !== "object") return raw ?? null;

  const object = raw as Record<string, unknown>;
  for (const key of VALUE_KEYS) {
    if (object[key] !== undefined) return unwrapAzureValue(object[key]);
  }

  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !["type", "confidence", "source", "span"].includes(key))
      .map(([key, value]) => [key, unwrapAzureValue(value)]),
  );
}

function normalizeFields(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, AzureField>).map(([name, field]) => [
      name,
      {
        value: unwrapAzureValue(field),
        confidence: typeof field?.confidence === "number" ? field.confidence : null,
        source: typeof field?.source === "string" ? field.source : undefined,
      },
    ]),
  );
}

function hasFields(content: Record<string, unknown>) {
  return content.fields && typeof content.fields === "object" && !Array.isArray(content.fields)
    ? Object.keys(content.fields).length > 0
    : false;
}

function normalizeResult(payload: unknown, analyzerId: string, apiVersion: string) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const result = root.result && typeof root.result === "object" ? root.result as Record<string, unknown> : root;
  const contents = Array.isArray(result.contents) ? result.contents as Array<Record<string, unknown>> : [];
  const warnings = Array.isArray(result.warnings)
    ? result.warnings.map((item) => typeof item === "string" ? item : azureMessage(item, "Azure analyzer warning.")).slice(0, 25)
    : [];
  const segments = contents.flatMap((content) => {
    const parentPath = typeof content.path === "string" ? content.path : "input1";
    const nested = Array.isArray(content.segments) ? content.segments as Array<Record<string, unknown>> : [];
    return nested.map((segment) => {
      const segmentId = String(segment.segmentId || "");
      const returnedPath = String(segment.path || "");
      return {
        path: returnedPath || (segmentId.includes("/") ? segmentId : segmentId ? `${parentPath}/${segmentId}` : parentPath),
        segmentId,
        category: String(segment.category || ""),
        startPageNumber: typeof segment.startPageNumber === "number" ? segment.startPageNumber : null,
        endPageNumber: typeof segment.endPageNumber === "number" ? segment.endPageNumber : null,
        confidence: typeof segment.confidence === "number" ? segment.confidence : null,
      };
    });
  });
  const normalizedPath = (value: unknown) => String(value || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  const segmentsByPath = new Map(segments.map((segment) => [normalizedPath(segment.path), segment]));
  const observations = contents.filter(hasFields).map((content) => {
    const path = String(content.path || "");
    const pathTail = normalizedPath(path).split("/").pop();
    const segment = segmentsByPath.get(normalizedPath(path))
      || segments.find((item) => normalizedPath(item.segmentId) === pathTail);
    return {
      analyzerId: String(content.analyzerId || ""),
      category: String(content.category || segment?.category || ""),
      path,
      startPageNumber: typeof content.startPageNumber === "number"
        ? content.startPageNumber
        : segment?.startPageNumber ?? null,
      endPageNumber: typeof content.endPageNumber === "number"
        ? content.endPageNumber
        : segment?.endPageNumber ?? null,
      markdown: typeof content.markdown === "string" ? content.markdown : "",
      fields: normalizeFields(content.fields),
      warnings,
    };
  });

  return {
    analyzerId: String(result.analyzerId || analyzerId),
    apiVersion: String(result.apiVersion || apiVersion),
    observations,
    segments,
    warnings,
  };
}

function azureSettings() {
  const endpoint = (configured("AZURE_CONTENT_UNDERSTANDING_ENDPOINT") || DEFAULT_ENDPOINT).replace(/\/+$/g, "");
  const analyzerId = configured("AZURE_CONTENT_UNDERSTANDING_ANALYZER_ID") || DEFAULT_ANALYZER_ID;
  const apiVersion = configured("AZURE_CONTENT_UNDERSTANDING_API_VERSION") || DEFAULT_API_VERSION;
  const key = configured("CONTENT_UNDERSTANDING_KEY");
  return { endpoint, analyzerId, apiVersion, key };
}

async function startAnalysis(endpoint: string, key: string, analyzerId: string, apiVersion: string, file: File) {
  const expected = new URL(endpoint);
  if (expected.protocol !== "https:") throw new ContentUnderstandingError("The Azure endpoint must use HTTPS.", 503);

  const query = new URLSearchParams({ "api-version": apiVersion });
  const url = `${endpoint}/contentunderstanding/analyzers/${encodeURIComponent(analyzerId)}:analyzeBinary?${query.toString()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": file.type || "application/octet-stream",
      "x-ms-client-request-id": crypto.randomUUID(),
    },
    body: await file.arrayBuffer(),
  }).catch(() => null);

  if (!response) throw new ContentUnderstandingError("Azure Content Understanding could not be reached.", 502);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ContentUnderstandingError(
      azureMessage(payload, "Azure could not start document classification."),
      response.status === 429 ? 429 : 502,
    );
  }

  const operationLocation = response.headers.get("operation-location");
  if (!operationLocation) throw new ContentUnderstandingError("Azure did not return an analysis operation.", 502);
  const operationUrl = new URL(operationLocation);
  if (operationUrl.origin !== expected.origin || !operationUrl.pathname.startsWith(RESULT_PATH)) {
    throw new ContentUnderstandingError("Azure returned an unexpected analysis location.", 502);
  }
  const operationId = decodeURIComponent(operationUrl.pathname.slice(RESULT_PATH.length));
  if (!JOB_ID_PATTERN.test(operationId)) {
    throw new ContentUnderstandingError("Azure returned an invalid analysis operation.", 502);
  }
  return operationId;
}

function retryAfterMilliseconds(response: Response) {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return 2000;
  return Math.min(Math.max(seconds * 1000, 1000), 10000);
}

async function getAnalysisResult(endpoint: string, operationId: string, apiVersion: string, key: string) {
  const operationUrl = `${endpoint}${RESULT_PATH}${encodeURIComponent(operationId)}?api-version=${encodeURIComponent(apiVersion)}`;
  const response = await fetch(operationUrl, {
    headers: { "Ocp-Apim-Subscription-Key": key },
    cache: "no-store",
  }).catch(() => null);
  if (!response) throw new ContentUnderstandingError("Azure document classification was interrupted.", 502);

  const payload = await response.json().catch(() => null) as { status?: string } | null;
  if (!response.ok) {
    throw new ContentUnderstandingError(
      azureMessage(payload, "Azure could not return the analysis result."),
      response.status === 429 ? 429 : 502,
    );
  }

  const status = String(payload?.status ?? "").toLowerCase();
  if (status === "failed") {
    throw new ContentUnderstandingError(azureMessage(payload, "Azure could not analyze this document."), 422);
  }
  if (status === "succeeded") return { complete: true as const, payload };
  if (status === "running" || status === "notstarted") {
    return { complete: false as const, retryAfterMs: retryAfterMilliseconds(response) };
  }
  throw new ContentUnderstandingError("Azure returned an unknown analysis status.", 502);
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ContentUnderstandingError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: fallback }, { status: 502 });
}

export async function GET(request: NextRequest) {
  if (!(await hasSiteAccess(request))) {
    return NextResponse.json({ error: "Enter the site password first." }, { status: 401 });
  }
  const searchParams = new URL(request.url).searchParams;
  const { endpoint, analyzerId, apiVersion, key } = azureSettings();
  const operationId = searchParams.get("operationId")?.trim() ?? "";

  if (operationId) {
    if (!key) {
      return NextResponse.json({ error: "Add CONTENT_UNDERSTANDING_KEY to .env.local, then restart the site." }, { status: 503 });
    }
    if (!JOB_ID_PATTERN.test(operationId)) {
      return NextResponse.json({ error: "That Azure analysis operation is invalid." }, { status: 400 });
    }
    try {
      const result = await getAnalysisResult(endpoint, operationId, apiVersion, key);
      if (!result.complete) {
        return NextResponse.json(
          { status: "running", operationId, retryAfterMs: result.retryAfterMs },
          { status: 202, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) } },
        );
      }
      return NextResponse.json(
        { status: "succeeded", operationId, ...normalizeResult(result.payload, analyzerId, apiVersion) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return errorResponse(error, "Azure Content Understanding could not return this analysis.");
    }
  }

  return NextResponse.json(
    {
      configured: Boolean(endpoint && analyzerId && key),
      analyzerId,
      apiVersion,
      endpointHost: new URL(endpoint).host,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!(await hasSiteAccess(request))) {
    return NextResponse.json({ error: "Enter the site password before using Azure analysis." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin document analysis is not allowed." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The uploaded document could not be read." }, { status: 400 });
  }

  const { endpoint, analyzerId, apiVersion, key } = azureSettings();
  if (!key) {
    return NextResponse.json({ error: "Add CONTENT_UNDERSTANDING_KEY to .env.local, then restart the site." }, { status: 503 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a document to analyze." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Documents must be between 1 byte and 20 MB." }, { status: 413 });
  }
  if (!allowedFile(file)) {
    return NextResponse.json({ error: "Only PDF, JPG, PNG, and TIFF documents are supported." }, { status: 415 });
  }

  try {
    const operationId = await startAnalysis(endpoint, key, analyzerId, apiVersion, file);
    return NextResponse.json(
      { status: "running", operationId, analyzerId, apiVersion, retryAfterMs: 2000 },
      { status: 202, headers: { "Cache-Control": "no-store", "Retry-After": "2" } },
    );
  } catch (error) {
    return errorResponse(error, "Azure Content Understanding could not start this analysis.");
  }
}
