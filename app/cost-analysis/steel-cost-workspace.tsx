"use client";

import { useEffect, useMemo, useState } from "react";
import { MetalQuotes } from "./metal-quotes";
import { currentCost, historicalBasis, vendorUnitRate, type Quotes } from "./current-cost";
import type {
  SteelCostInputs,
  SteelCostPart,
  SteelPriceBundle,
  SteelPricingResponse,
  TempelPrice,
  VendorPrice,
} from "../cost-analysis-data";

function pounds(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} lb`;
}

function money(value: number | null | undefined, digits = 2) {
  return value == null ? "—" : value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function signedMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function number(value: number | null | undefined, digits = 4) {
  return value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function date(value: string) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function cleanDisplayDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const coreIndex = normalized.search(/\bcore\b/i);
  return coreIndex > 0 ? normalized.slice(coreIndex) : normalized;
}

function tempelEstimate(part: SteelCostPart, price: TempelPrice | null) {
  if (!price || !part.quantity || price.poPricePerLb == null) return null;
  const u = part.unitOfMeasure.trim().toUpperCase();
  const weight = /^(LB|LBS|POUND|POUNDS)$/.test(u) ? part.quantity
    : /^(EA|EACH|PCS|PC|PIECE|PIECES)$/.test(u) && price.netWeightPerThousand != null
      ? part.quantity * price.netWeightPerThousand / 1000 : null;
  return weight == null ? null : { weight, cost: weight * price.poPricePerLb };
}

function vendorEstimate(part: SteelCostPart, price: VendorPrice | null) {
  if (!price || part.quantity == null || price.lastCost == null || price.lastCost <= 0) return null;
  const normal = (u: string) => u.trim().toUpperCase().replace(/^EA$/, "EACH").replace(/^LBS$/, "LB");
  if (normal(part.unitOfMeasure) !== normal(price.stockUnit)) return null;
  return { cost: part.quantity * price.lastCost };
}

function chosenBundle(bundle: SteelPriceBundle | undefined, decision: string | undefined) {
  if (!bundle || bundle.matchKind === "none") return null;
  if (bundle.matchKind === "exact") return bundle;
  return decision === "accepted" ? bundle : null;
}

export function SteelCostWorkspace({ inputs }: { inputs: SteelCostInputs }) {
  const [pricing, setPricing] = useState<SteelPricingResponse | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [market, setMarket] = useState<Quotes | null>(null);
  const [decisions, setDecisions] = useState<Record<number, "accepted" | "rejected">>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/steel-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ partNumbers: inputs.parts.map((part) => part.partNumber) }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json().catch(() => null);
        if (!response.ok) throw new Error(value?.error || "Pricing data could not be loaded.");
        if (controller.signal.aborted) return;
        setPricingError("");
        setPricing(value as SteelPricingResponse);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPricingError(error instanceof Error ? error.message : "Pricing data could not be loaded.");
      });
    return () => controller.abort();
  }, [inputs.parts]);

  const bundles = useMemo(() => inputs.parts.map((_, index) => chosenBundle(pricing?.matches[index], decisions[index])), [inputs.parts, pricing, decisions]);
  const marketDates = useMemo(() => Array.from(new Set(bundles.map(bundle => historicalBasis(bundle)?.date).filter((d): d is string => Boolean(d)))).sort().join(","), [bundles]);
  const today = currentCost(inputs.parts, bundles, inputs.steelWeightLbs, market);
  const calculations = inputs.parts.map((part, index) => {
    const bundle = bundles[index];
    const tempel = tempelEstimate(part, bundle?.tempel || null);
    const vendor = vendorEstimate(part, bundle?.vendor || null);
    return { part, bundle, tempel, vendor, difference: tempel && vendor ? tempel.cost - vendor.cost : null };
  });
  const sourceStatus = pricing
    ? `Tempel ${pricing.sourceSummary.tempelRows} rows · Vendor ${pricing.sourceSummary.vendorRows.toLocaleString()} rows`
    : pricingError ? "Pricing lookup unavailable" : "Loading pricing snapshots…";

  return (
    <>
      <header className="cost-header">
        <div><span className="eyebrow">STEP 02 · STEEL COST ANALYSIS</span><h1>{inputs.catalogNumber}</h1><p>{inputs.fileName}</p></div>
        <span className={`database-status ${pricing ? "is-ready" : ""}`}><i /> {sourceStatus}</span>
      </header>

      <section className="cost-metrics" aria-label="Steel cost input summary">
        <article><span>510-series rows</span><strong>{inputs.parts.length}</strong><small>Part numbers returned from the design packet</small></article>
        <article><span>Winding-sheet steel</span><strong>{pounds(inputs.steelWeightLbs)}</strong><small>Weight used for today’s steel estimate</small></article>
        <article><span>Steel grade</span><strong>{inputs.steelGrade || "—"}</strong><small>Used to review the matching price family</small></article>
        <article className="pending-total"><span>Estimated steel cost today</span><strong>{money(today.total)}</strong><small>{today.total != null ? "Winding-sheet weight × market-adjusted supplier rate" : today.reason}</small></article>
      </section>

      <MetalQuotes dates={marketDates} onData={setMarket} hidden />
      <section className="cost-workspace">
        {pricingError && <p className="pricing-error" role="alert">{pricingError}</p>}
        <div className="cost-section-heading"><div><span>01</span><h2>Design-packet 510 parts</h2></div><small>{inputs.parts.length} row{inputs.parts.length === 1 ? "" : "s"} returned</small></div>
        <div className="table-wrap cost-table-wrap">
          <table className="cost-parts-table">
            <thead><tr><th>Part number</th><th>Quantity</th><th>Design packet unit</th><th>Description</th><th>Price status</th></tr></thead>
            <tbody>
              {inputs.parts.length ? inputs.parts.map((part, index) => {
                const bundle = pricing?.matches[index];
                const decision = decisions[index];
                const status = bundle?.matchKind === "exact"
                  ? bundle.tempel ? "Tempel part number match" : "Vendor item master match"
                  : bundle?.matchKind === "closest" ? `Closest match: ${bundle.matchedPartNumber}`
                    : pricing ? "No Tempel or vendor match" : "Checking pricing data";
                return (
                  <tr key={`${part.sourceAssembly}-${part.partNumber}-${index}`}>
                    <td><strong>{part.partNumber}</strong><small>Assembly {part.sourceAssembly || "—"}</small></td>
                    <td>{part.quantity ?? "—"}</td>
                    <td>{part.unitOfMeasure || "—"}</td>
                    <td>{cleanDisplayDescription(part.description) || "—"}</td>
                    <td>
                      <span className={`price-status ${bundle?.matchKind || "pending"}`}>{status}</span>
                      {bundle?.matchKind === "closest" && (
                        <div className="closest-choice">
                          <p>Would you like to use this closest match for the cost estimate?</p>
                          <button type="button" className={decision === "accepted" ? "is-selected" : ""} onClick={() => setDecisions((current) => ({ ...current, [index]: "accepted" }))}>Yes, use it</button>
                          <button type="button" className={decision === "rejected" ? "is-selected" : ""} onClick={() => setDecisions((current) => ({ ...current, [index]: "rejected" }))}>No</button>
                          {bundle.similarity != null && <small>{Math.round(bundle.similarity * 100)}% part-number similarity</small>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              }) : <tr><td colSpan={5}>No 510-series part was returned from the design packet. Re-analyze the packet before choosing a weight-based fallback.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="cost-section-heading"><div><span>02</span><h2>Tempel and vendor calculations</h2></div><small>Historical supplier prices and item quantities</small></div>
        <div className="price-comparison-list">
          {calculations.some((item) => item.bundle) ? calculations.map((item, index) => item.bundle && (
            <article className="price-comparison-card" key={`calculation-${item.part.partNumber}-${index}`}>
              <header><div><span>{item.bundle.matchKind === "closest" ? "APPROVED CLOSEST MATCH" : "EXACT PART MATCH"}</span><h3>{item.part.partNumber}</h3></div>{item.bundle.matchKind === "closest" && <small>Using {item.bundle.matchedPartNumber}</small>}</header>
              <dl className="price-result-summary" aria-label="Tempel and vendor price summary">
                <div><dt>Historical Tempel item cost</dt><dd>{money(item.tempel?.cost)}</dd></div>
                <div><dt>Historical Dongan item cost</dt><dd>{money(item.vendor?.cost)}</dd></div>
                <div><dt>Difference (Tempel - vendor)</dt><dd className={item.difference != null && item.difference > 0 ? "is-higher" : ""}>{signedMoney(item.difference)}</dd></div>
                <div><dt>Vendor last-cost date</dt><dd>{item.bundle.vendor ? date(item.bundle.vendor.lastDate) : "—"}</dd></div>
              </dl>
              <div className="price-comparison-grid">
                <section>
                  <div className="pricing-source-heading"><h4>Tempel pricing data</h4><a href="/api/pricing-source?source=tempel" target="_blank" rel="noreferrer">View source data ↗</a></div>
                  {item.bundle.tempel ? <>
                    <dl>
                      <div><dt>Tempel part number</dt><dd>{item.bundle.tempel.tempelPartNumber || "—"}</dd></div>
                      <div><dt>Effective date</dt><dd>{date(item.bundle.tempel.effectiveDate)}</dd></div>
                      <div><dt>Base price / lb</dt><dd>{money(item.bundle.tempel.basePricePerLb, 4)}</dd></div>
                      <div><dt>Surcharge / lb</dt><dd>{money(item.bundle.tempel.surchargePerLb, 4)}</dd></div>
                      <div><dt>PO price / lb</dt><dd>{money(item.bundle.tempel.poPricePerLb, 4)}</dd></div>
                    </dl>
                    <div className="calculation-line">
                      <span>Catalog weight for design-packet quantity</span><strong>{item.tempel ? pounds(item.tempel.weight) : "Not calculated"}</strong>
                      <p className="formula-explanation">{/^(LB|LBS|POUND|POUNDS)$/i.test(item.part.unitOfMeasure) ? "The design-packet quantity is already in pounds." : <>{number(item.bundle.tempel.netWeightPerThousand)} lb per 1,000 pieces ÷ 1,000 = {number((item.bundle.tempel.netWeightPerThousand ?? 0) / 1000, 6)} lb per piece.<br />{item.part.quantity ?? "—"} pieces × {number((item.bundle.tempel.netWeightPerThousand ?? 0) / 1000, 6)} lb per piece = {item.tempel ? pounds(item.tempel.weight) : "unavailable"}.</>}</p>
                    </div>
                    <div className="calculation-line total"><span>Historical Tempel item cost</span><strong>{money(item.tempel?.cost)}</strong><small>{item.tempel ? `${number(item.tempel.weight, 2)} lb × ${money(item.bundle.tempel.poPricePerLb, 4)} / lb` : "Quantity, unit, weight, or PO price is missing"}</small></div>
                  </> : <p className="source-empty">No Tempel part-number match.</p>}
                </section>
                <section>
                  <div className="pricing-source-heading"><h4>Dongan vendor pricing data</h4><a href="/api/pricing-source?source=vendor" target="_blank" rel="noreferrer">View source data ↗</a></div>
                  {item.bundle.vendor ? <>
                    <dl>
                      <div><dt>Vendor</dt><dd>{item.bundle.vendor.vendorNumber || "—"}</dd></div>
                      <div><dt>Vendor stock number</dt><dd>{item.bundle.vendor.stockNumber || "—"}</dd></div>
                      <div><dt>Last cost date</dt><dd>{date(item.bundle.vendor.lastDate)}<small>Vendor Item Master: LAST DTE</small></dd></div>
                      <div><dt>Last cost</dt><dd>{money(item.bundle.vendor.lastCost, 4)} / {item.bundle.vendor.stockUnit || "stock unit"}</dd></div>
                      <div><dt>Quoted price</dt><dd>{money(item.bundle.vendor.quotePrice, 2)} / {item.bundle.vendor.quoteUnit || "quote unit"}</dd></div>
                    </dl>
                    <div className="calculation-line total"><span>Historical Dongan item cost</span><strong>{money(item.vendor?.cost)}</strong><small>{item.vendor ? `${item.part.quantity} × ${money(item.bundle.vendor.lastCost, 4)} per ${item.bundle.vendor.stockUnit}` : "A positive last cost and matching stock unit are required"}</small></div>
                    {item.bundle.vendorAlternatives.length > 1 && <small className="alternatives-note">{item.bundle.vendorAlternatives.length - 1} additional vendor record{item.bundle.vendorAlternatives.length === 2 ? "" : "s"} retained for review.</small>}
                  </> : <p className="source-empty">No vendor item master match.</p>}
                </section>
              </div>
            </article>
          )) : <p className="source-empty comparison-empty">{pricing ? "No exact match or approved closest match is available for calculation." : "Pricing calculations will appear after the source lookup finishes."}</p>}
        </div>

        <div className="cost-section-heading"><div><span>03</span><h2>How today’s estimate is calculated</h2></div><small>Yahoo Finance via yfinance · HRC=F</small></div>
        {inputs.parts.length > 1 && <p className="estimate-method">Winding-sheet weight is allocated across parts in proportion to their catalog weights. All parts need usable weights and rates before a total is shown.</p>}
        <div className="market-benchmark-list">
          {today.rows.map((row,index) => <article className="market-benchmark-card" key={index}>
            <header><div><span>CURRENT-COST ESTIMATE</span><h3>{row.part.partNumber}</h3></div><small>{row.basis?.source ?? "Supplier rate unavailable"}</small></header>
            {row.basis && <p className="estimate-method">Historical supplier rate: <strong>{money(row.basis.rate,4)} / lb</strong>, dated {date(row.basis.date)}.
              {bundles[index]?.vendor && row.basis.source.startsWith("Dongan") && vendorUnitRate(bundles[index]) != null && /^(EA|EACH)$/i.test(bundles[index]!.vendor!.stockUnit) && <> {money(bundles[index]!.vendor!.lastCost,4)} per piece ÷ {number((bundles[index]!.tempel?.netWeightPerThousand ?? 0)/1000,6)} lb per piece.</>}
            </p>}
            <div className="market-kpis">
              <div><span>Market price of steel at supplier date</span><strong>{money(row.history?.pricePerLb,4)} / lb</strong><small>{row.history?.priceDate ? date(row.history.priceDate) + " daily close" : "Historical quote unavailable"}</small></div>
              <div><span>Latest market price of steel</span><strong>{money(today.steel?.pricePerLb,4)} / lb</strong><small>{today.steel?.quotedAt ? new Date(today.steel.quotedAt).toLocaleString() : "Waiting for quote"}</small></div>
              <div><span>Market adjustment</span><strong>{row.multiplier != null ? number(row.multiplier,4)+"×" : "—"}</strong><small>Latest price ÷ historical price</small></div>
              <div><span>Estimated rate today</span><strong>{money(row.rate,4)} / lb</strong><small>Supplier rate × market adjustment</small></div>
            </div>
            <div className="today-cost-equation">
              <span>{inputs.parts.length === 1 ? "Winding-sheet steel weight" : "Allocated winding-sheet steel weight"}</span>
              <strong>{row.cost != null ? pounds(row.weight!)+" × "+money(row.rate,4)+" / lb = "+money(row.cost) : today.reason}</strong>
              {inputs.parts.length > 1 && row.weight != null && <p>Allocation: {pounds(inputs.steelWeightLbs)} × this part’s share of the combined catalog weight = {pounds(row.weight)}.</p>}
            </div>
            <footer><span>Latest available quote; may be delayed. Historical dates use the preceding trading close if needed (up to 7 days).</span><a href="https://finance.yahoo.com/quote/HRC%3DF/" target="_blank" rel="noreferrer">HRC=F on Yahoo Finance ↗</a></footer>
          </article>)}
        </div>
      </section>
    </>
  );
}

