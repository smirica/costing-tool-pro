"use client";

import { useEffect, useState } from "react";
import { COST_ANALYSIS_STORAGE_KEY, type SteelCostInputs } from "../cost-analysis-data";
import { SteelCostWorkspace } from "./steel-cost-workspace";


export default function CostAnalysisPage() {
  const [inputs, setInputs] = useState<SteelCostInputs | null>(null);
  const [ready, setReady] = useState(false);
  const [sourceSummary, setSourceSummary] = useState<{ tempelRows: number; vendorRows: number } | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("winding-intelligence-theme");
    document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";
    fetch("/api/access", { cache: "no-store" })
      .then((response) => response.json())
      .then((value) => {
        if (!value.authorized) {
          window.location.replace("/");
          return;
        }
        const raw = window.sessionStorage.getItem(COST_ANALYSIS_STORAGE_KEY);
        if (raw) {
          try { setInputs(JSON.parse(raw) as SteelCostInputs); } catch { /* Ignore invalid browser state. */ }
        }
        fetch("/api/steel-pricing", {
          method: "POST",
          headers: { "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({ partNumbers: [] }),
        })
          .then((response) => response.ok ? response.json() : null)
          .then((pricing) => pricing?.sourceSummary && setSourceSummary(pricing.sourceSummary))
          .catch(() => { /* The full workspace reports pricing lookup errors after analysis. */ });
        setReady(true);
      })
      .catch(() => window.location.replace("/"));
  }, []);

  if (!ready) return <main className="site-shell cost-page"><section className="cost-empty"><span className="eyebrow">STEEL COST ANALYSIS</span><h1>Checking access…</h1></section></main>;

  return (
    <main className="site-shell cost-page">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <nav className="topbar" aria-label="Steel cost navigation">
        <a className="brand" href="/"><span className="brand-mark">W</span><span>Winding Intelligence</span></a>
        <a className="back-to-reader" href="/">← Back to document results</a>
      </nav>

      {!inputs ? (
        <section className="cost-empty">
          <span className="eyebrow">STEEL COST ANALYSIS</span>
          <h1>Analyze a document first.</h1>
          <p>This workspace receives 510-series parts from a design packet and steel weight from its linked winding sheet.</p>
          <div className="cost-empty-source" aria-live="polite">
            <span>Pricing catalogs</span>
            <strong>{sourceSummary ? `Tempel ${sourceSummary.tempelRows} active rows | Vendor ${sourceSummary.vendorRows.toLocaleString()} rows` : "Checking Tempel and vendor data..."}</strong>
            <small>Calculations appear after this localhost session returns one or more 510-series design-packet parts.</small>
          </div>
          <a className="cost-primary-link" href="/">Open document reader</a>
        </section>
      ) : (
        <SteelCostWorkspace inputs={inputs} />
      )}
      <footer><span>Winding Intelligence</span><span>Steel evidence stays separate from pricing assumptions</span></footer>
    </main>
  );
}
