import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import type { Plugin } from "vite";

// Local Vite adapter: Python cannot execute inside a Cloudflare Worker.
export function yfinancePlugin(password: string, python?: string): Plugin {
  const pending = new Map<string, Promise<string>>();
  return {
    name: "local-yfinance",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/metal-quotes", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const fail = (status: number, error: string) => { res.statusCode = status; res.end(JSON.stringify({ error })); };
        if (req.method !== "GET") return fail(405, "Use GET.");
        const origin = req.headers.origin;
        try {
          if (origin && new URL(origin).host !== req.headers.host) return fail(403, "Same-origin requests only.");
        } catch { return fail(403, "Invalid origin."); }
        const cookie = (req.headers.cookie || "").split(";").map((v) => v.trim()).find((v) => v.startsWith("winding_intelligence_access="))?.split("=")[1] || "";
        const token = createHmac("sha256", password).update("winding-intelligence-access-v1").digest("base64url");
        const supplied = Buffer.from(cookie);
        const expected = Buffer.from(token);
        if (!password || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return fail(401, "Sign in to view market prices.");
        const dates = Array.from(new Set((new URL(req.url || "/", "http://localhost").searchParams.get("dates") || "").split(",").filter(Boolean))).sort();
        if (dates.length > 40 || dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return fail(400, "Invalid supplier dates.");
        const key = JSON.stringify(dates);
        // Coalesce identical in-flight requests; no completed price cache.
        const operation = pending.get(key) ?? new Promise<string>((accept, reject) => {
          execFile(python || resolve(".venv-yfinance", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
            [resolve("scripts/metal-quotes.py"), key], { timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true },
            (error, stdout) => {
              if (error) return reject(error);
              try { JSON.parse(stdout); accept(stdout); } catch (error) { reject(error); }
            });
        }).finally(() => { pending.delete(key); });
        pending.set(key, operation);
        void operation.then((body) => res.end(body), () => fail(502, "The local yfinance adapter is unavailable. Check the Python setup, then Reload."));
      });
    },
  };
}

