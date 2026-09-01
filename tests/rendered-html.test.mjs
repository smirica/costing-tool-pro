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
  assert.match(page, /analyzeWindingSheet\(selectedFile,/);
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


test("supports focused design-packet extraction and winding-page routing", async () => {
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
  assert.ok(schema.fieldSchema.fields.EmbeddedWindingSheetPageNumbers);
  assert.ok(schema.fieldSchema.fields.OtherPartsAssemblies);
  assert.match(schema.fieldSchema.description, /Ignore the Master Sheet completely/i);
  assert.doesNotMatch(schemaText, /WindingTableColumns|WireWeightLbsPerCoil/);
  assert.match(packetReader, /analyzerKind: "design-packet"/);
  assert.match(packetReader, /pageRange: designPacket\.windingSheetPages\.join/);
  assert.match(reader, /form\.set\("analyzerKind"/);
  assert.match(reader, /analyzerKind=\$\{encodeURIComponent\(analyzerKind\)\}/);
  assert.match(reader, /form\.set\("pageRange"/);
  assert.match(route, /AZURE_CONTENT_UNDERSTANDING_DESIGN_PACKET_ANALYZER_ID/);
  assert.match(route, /azureSettings\(analyzerKind\)/);
  assert.match(route, /query\.set\("range", pageRange\)/);
  assert.match(page, /Design packet results/);
  assert.match(page, /DesignPacketResultPanel/);
  assert.match(page, /document-kind-switch/);
  assert.doesNotMatch(page + packetReader, /21-1732-TPFM|7A-17084|7B-17013/);
  assert.match(envExample, /AZURE_CONTENT_UNDERSTANDING_DESIGN_PACKET_ANALYZER_ID=DesignPacketAnalyzer/);
});
