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
