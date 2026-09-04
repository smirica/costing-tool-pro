import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Winding Intelligence site", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Winding Intelligence/);
  assert.match(html, /Costing Reader/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("uses a server-checked password without requiring ChatGPT sign-in", async () => {
  const [page, layout, access, route] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/access.ts", root), "utf8"),
    readFile(new URL("app/api/access/route.ts", root), "utf8"),
  ]);
  assert.match(access, /WINDING_SITE_ACCESS_PASSWORD/);
  assert.match(route, /httpOnly:\s*true/);
  assert.match(route, /sameSite:\s*"strict"/);
  assert.match(route, /isSameOrigin/);
  assert.doesNotMatch(page, /pass_word1234/);
  assert.doesNotMatch(layout, /requireChatGPTUser|signin-with-chatgpt/);
});

test("defaults to light mode and provides a persistent theme switch", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(layout, /data-theme="light"/);
  assert.match(page, /winding-intelligence-theme/);
  assert.match(page, /Switch to \$\{nextTheme\} mode/);
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /html\[data-theme="dark"\]/);
});

test("connects uploads to Azure Content Understanding without exposing the key", async () => {
  const [page, reader, route, vite, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/winding-reader.ts", root), "utf8"),
    readFile(new URL("app/api/content-understanding/route.ts", root), "utf8"),
    readFile(new URL("vite.config.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(page, /analyzeDocument\(selectedFile,/);
  assert.match(reader, /fetch\("\/api\/content-understanding"/);
  assert.match(route, /Ocp-Apim-Subscription-Key/);
  assert.match(route, /hasSiteAccess/);
  assert.match(route, /isSameOrigin/);
  assert.match(route, /20 \* 1024 \* 1024/);
  assert.match(route, /Operation-Location/i);
  assert.match(route, /operationId/);
  assert.match(route, /status: "running"/);
  assert.match(reader, /MAX_ANALYSIS_MS = 10 \* 60 \* 1000/);
  assert.match(reader, /operationId=\$\{encodeURIComponent/);
  assert.doesNotMatch(route, /MAX_POLLS|pollAnalysis/);
  assert.doesNotMatch(page + reader, /sampleResult|21-1001L-U-1/);
  assert.match(page, /useState<WindingResult \| null>\(null\)/);
  assert.match(page, /analysisControllerRef\.current\?\.abort\(\)/);
  assert.match(page, /resultFileName/);
  assert.match(page, /formatElapsed\(elapsedSeconds\)/);
  assert.match(page, /analysisStartedAtRef/);
  assert.match(page, /loading-spinner/);
  assert.match(css, /@keyframes reader-spin/);
  assert.match(vite, /command === "serve"/);
  assert.doesNotMatch(page + reader, /CONTENT_UNDERSTANDING_KEY/);
});


test("uses one classifier operation and reads fields from routed segments", async () => {
  const [page, packetReader, reader, route, schemaText, envExample] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/design-packet-reader.ts", root), "utf8"),
    readFile(new URL("app/winding-reader.ts", root), "utf8"),
    readFile(new URL("app/api/content-understanding/route.ts", root), "utf8"),
    readFile(new URL("design-packet-content-understanding-schema.json", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);
  const schema = JSON.parse(schemaText);
  assert.equal(schema.fieldSchema.name, "DesignPacketAnalyzer");
  assert.ok(schema.fieldSchema.fields.DocumentHeader);
  assert.ok(schema.fieldSchema.fields.StopPointsTable);
  assert.ok(schema.fieldSchema.fields.Notes);
  assert.equal(schema.fieldSchema.fields.EmbeddedWindingSheetPageNumbers, undefined);
  assert.ok(schema.fieldSchema.fields.OtherPartsAssemblies);
  assert.match(schema.fieldSchema.description, /Ignore the Master Sheet completely/i);
  assert.doesNotMatch(schemaText, /WindingTableColumns|WireWeightLbsPerCoil/);
  assert.match(packetReader, /analysis\.observations\.filter\(isDesignPacketObservation\)/);
  assert.match(packetReader, /analysis\.observations\.filter\(isWindingObservation\)/);
  assert.match(packetReader, /pagesForCategory\(analysis, "Winding_Sheet"\)/);
  assert.doesNotMatch(reader, /analyzerKind|pageRange/);
  assert.match(route, /DEFAULT_ANALYZER_ID = "DesignPacketClassifier"/);
  assert.match(route, /observations/);
  assert.match(route, /segments/);
  assert.match(route, /segmentsByPath\.get\(normalizedPath\(path\)\)/);
  assert.match(route, /content\.category \|\| segment\?\.category/);
  assert.match(route, /segmentId\.includes\("\/"\)/);
  assert.match(packetReader, /pagesForWinding\(analysis, windingObservation\)/);
  assert.match(packetReader, /addNestedSourcePages\(field\.value, pages\)/);
  assert.match(packetReader, /field\.source\?\.matchAll/);
  assert.doesNotMatch(route, /AZURE_CONTENT_UNDERSTANDING_DESIGN_PACKET_ANALYZER_ID|query\.set\("range"/);
  assert.doesNotMatch(page, /design-results-shortcut/);
  assert.match(page, /DesignPacketResultPanel/);
  assert.doesNotMatch(page, /document-kind-switch|WindingSheetAnalyzer|DesignPacketAnalyzer/);
  assert.match(page, /DesignPacketClassifier/);
  assert.doesNotMatch(page + packetReader, /21-1732-TPFM|7A-17084|7B-17013/);
  assert.match(envExample, /AZURE_CONTENT_UNDERSTANDING_ANALYZER_ID=DesignPacketClassifier/);
  assert.doesNotMatch(envExample, /AZURE_CONTENT_UNDERSTANDING_DESIGN_PACKET_ANALYZER_ID/);
});

test("defines Azure Content Understanding routing for winding sheets, design packets, and other files", async () => {
  const classifierText = await readFile(new URL("document-routing-content-understanding-classifier.json", root), "utf8");
  const classifier = JSON.parse(classifierText);
  assert.equal(classifier.baseAnalyzerId, "prebuilt-document");
  assert.equal(classifier.config.enableSegment, true);
  assert.equal(classifier.config.segmentPerPage, false);
  assert.equal(classifier.config.contentCategories.Winding_Sheet.analyzerId, "WindingSheetAnalyzer");
  assert.equal(classifier.config.contentCategories.Design_Packet.analyzerId, "DesignPacketAnalyzer");
  assert.ok(classifier.config.contentCategories.Other);
  assert.equal(classifier.config.contentCategories.Other.analyzerId, undefined);
});

test("allows multipart uploads large enough for the documented 20 MB file limit", async () => {
  const nextConfig = await readFile(new URL("next.config.ts", root), "utf8");
  assert.match(nextConfig, /bodySizeLimit:\s*"25mb"/);
});


test("retains the analyzed packet across page navigation until a new file is selected", async () => {
  const [page, data] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/cost-analysis-data.ts", root), "utf8"),
  ]);
  assert.match(data, /DOCUMENT_ANALYSIS_STORAGE_KEY/);
  assert.match(page, /sessionStorage\.getItem\(DOCUMENT_ANALYSIS_STORAGE_KEY\)/);
  assert.match(page, /sessionStorage\.setItem\(DOCUMENT_ANALYSIS_STORAGE_KEY/);
  assert.match(page, /selectFile[\s\S]*sessionStorage\.removeItem\(DOCUMENT_ANALYSIS_STORAGE_KEY\)/);
  assert.match(page, /Results retained/);
});

test("hands every normalized 510 part to the priced workspace with clean title-first descriptions", async () => {
  const [page, workspace, packetReader] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/cost-analysis/steel-cost-workspace.tsx", root), "utf8"),
    readFile(new URL("app/design-packet-reader.ts", root), "utf8"),
  ]);
  assert.match(page, /normalizeSteelPartNumber\(part\.partNumber\)/);
  assert.match(page, /title:\s*assembly\.title/);
  assert.match(page, /description:\s*titledDescription\(assembly\.title, part\.description\)/);
  assert.match(page, /titleIndex[\s\S]*cleanDescription\.slice/);
  assert.match(workspace, /cleanDisplayDescription\(part\.description\)/);
  assert.match(workspace, /Tempel part number match/);
  assert.match(workspace, /Vendor item master match/);
  assert.match(workspace, /Would you like to use this closest match/);
  assert.match(workspace, /Tempel and vendor calculations/);
  assert.match(workspace, /Current Tempel calculated price/);
  assert.match(workspace, /Vendor Master cost/);
  assert.match(workspace, /Difference \(Tempel - vendor\)/);
  assert.match(workspace, /Vendor last-cost date/);
  assert.match(workspace, /Vendor Item Master: LAST DTE/);
  assert.match(workspace, /Source code; definition not provided/);
  assert.match(workspace, /PO price formula/);
  assert.match(packetReader, /recover510PartsFromMarkdown\(observation\.markdown\)/);
});

test("uses the live BLS steel index with a FRED fallback for market-adjusted vendor comparisons", async () => {
  const [route, workspace] = await Promise.all([
    readFile(new URL("app/api/steel-market/route.ts", root), "utf8"),
    readFile(new URL("app/cost-analysis/steel-cost-workspace.tsx", root), "utf8"),
  ]);
  assert.match(route, /SERIES_ID = "WPU1017"/);
  assert.match(route, /api\.bls\.gov\/publicAPI\/v2\/timeseries\/data/);
  assert.match(route, /api\.stlouisfed\.org\/fred\/series\/observations/);
  assert.match(route, /BLS_API_KEY/);
  assert.match(route, /FRED_API_KEY/);
  assert.match(route, /hasSiteAccess\(request\)/);
  assert.match(route, /Cross-origin market lookup is not allowed/);
  assert.match(workspace, /latest index.*index in the vendor last-cost month/i);
  assert.match(workspace, /Adjusted vendor estimate/);
  assert.match(workspace, /marketAdjustedVendorCost/);
});

test("loads the Tempel and vendor 510 snapshots behind the site access check", async () => {
  const [route, catalogText, envExample] = await Promise.all([
    readFile(new URL("app/api/steel-pricing/route.ts", root), "utf8"),
    readFile(new URL("app/steel-pricing-catalog.json", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);
  const catalog = JSON.parse(catalogText);
  const target = catalog.tempel.find((row) => row[0] === "510-EI1.7524M50");
  assert.ok(target);
  assert.equal(target[2], "0175 MS0250 285A");
  assert.equal(target[9].toFixed(4), "1.3174");
  const vendor = catalog.vendor.find((row) => row[0] === "510-EI1.7524M50" && row[1] === "09400");
  assert.ok(vendor);
  assert.equal(vendor[6], 0.16);
  assert.equal(vendor[8], "2026-05-12");
  const tempelTotal = 100 * target[6] / 1000 * target[9];
  const vendorTotal = 100 * vendor[6];
  assert.equal(tempelTotal.toFixed(2), "16.54");
  assert.equal(vendorTotal.toFixed(2), "16.00");
  assert.equal((tempelTotal - vendorTotal).toFixed(2), "0.54");
  assert.match(route, /hasSiteAccess\(request\)/);
  assert.match(route, /Cross-origin pricing lookup is not allowed/);
  assert.match(envExample, /BLS_API_KEY=/);
  assert.match(envExample, /FRED_API_KEY=/);
});
