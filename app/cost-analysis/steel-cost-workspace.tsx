"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SteelCostInputs,
  SteelCostPart,
  SteelMarketComparison,
  SteelMarketResponse,
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

function month(value: string) {
  if (!value) return "No month";
  return new Date(`${value.slice(0, 7)}-01T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function cleanDisplayDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const coreIndex = normalized.search(/\bcore\b/i);
  return coreIndex > 0 ? normalized.slice(coreIndex) : normalized;
}

function marketComparisonForDate(market: SteelMarketResponse | null, value: string) {
  return market?.comparisons.find((comparison) => comparison.requestedDate === value) || null;
}

function marketBarWidth(value: number, comparison: SteelMarketComparison) {
  return `${Math.max(8, value / Math.max(comparison.purchaseIndex, comparison.latestIndex) * 100)}%`;
}

function tempelEstimate(part: SteelCostPart, price: TempelPrice | null) {
  if (!price || part.quantity == null || price.poPricePerLb == null) return null;
  const unit = part.unitOfMeasure.toUpperCase();
  const weight = /^(LB|LBS|POUND|POUNDS)$/.test(unit)
    ? part.quantity
    : price.netWeightPerThousand == null ? null : part.quantity * price.netWeightPerThousand / 1000;
  return weight == null ? null : { weight, cost: weight * price.poPricePerLb };
}

function vendorEstimate(part: SteelCostPart, price: VendorPrice | null) {
  if (!price || part.quantity == null || price.lastCost == null || price.lastCost <= 0) return null;
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
  const [market, setMarket] = useState<SteelMarketResponse | null>(null);
  const [marketError, setMarketError] = useState("");
  const [decisions, setDecisions] = useState<Record<number, "accepted" | "rejected">>({});

  useEffect(() => {
    const controller = new AbortController();
    setPricingError("");
    fetch("/api/steel-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ partNumbers: inputs.parts.map((part) => part.partNumber) }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json().catch(() => null);
        if (!response.ok) throw new Error(value?.error || "Pricing data could not be loaded.");
        setPricing(value as SteelPricingResponse);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPricingError(error instanceof Error ? error.message : "Pricing data could not be loaded.");
      });
    return () => controller.abort();
  }, [inputs.parts]);

  useEffect(() => {
    const purchaseDates = Array.from(new Set(pricing?.matches
      .map((match) => match.vendor?.lastDate || "")
      .filter(Boolean) || []));
    if (!purchaseDates.length) {
      setMarket(null);
      setMarketError("");
      return;
    }
    const controller = new AbortController();
    setMarketError("");
    fetch("/api/steel-market", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ purchaseDates }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = await response.json().catch(() => null);
        if (!response.ok) throw new Error(value?.error || "The steel market benchmark could not be loaded.");
        setMarket(value as SteelMarketResponse);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMarketError(error instanceof Error ? error.message : "The steel market benchmark could not be loaded.");
      });
    return () => controller.abort();
  }, [pricing]);

  const calculations = useMemo(() => inputs.parts.map((part, index) => {
    const bundle = chosenBundle(pricing?.matches[index], decisions[index]);
    const tempel = tempelEstimate(part, bundle?.tempel || null);
    const vendor = vendorEstimate(part, bundle?.vendor || null);
    const difference = tempel && vendor ? tempel.cost - vendor.cost : null;
    const marketComparison = marketComparisonForDate(market, bundle?.vendor?.lastDate || "");
    const marketAdjustedVendorCost = vendor && marketComparison ? vendor.cost * marketComparison.multiplier : null;
    return { part, bundle, tempel, vendor, difference, marketComparison, marketAdjustedVendorCost, selectedCost: tempel?.cost ?? vendor?.cost ?? null };
  }), [decisions, inputs.parts, market, pricing]);

  const estimatedTotal = calculations.reduce((sum, item) => sum + (item.selectedCost || 0), 0);
  const pricedRows = calculations.filter((item) => item.selectedCost != null).length;
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
        <article><span>Winding-sheet steel</span><strong>{pounds(inputs.steelWeightLbs)}</strong><small>Physical steel weight kept separate from item pricing</small></article>
        <article><span>Steel grade</span><strong>{inputs.steelGrade || "—"}</strong><small>Used to review the matching price family</small></article>
        <article className="pending-total"><span>Estimated steel cost</span><strong>{pricedRows ? money(estimatedTotal) : "—"}</strong><small>{pricedRows ? `${pricedRows} priced row${pricedRows === 1 ? "" : "s"} · Tempel first, vendor fallback` : "Waiting for a usable exact or approved closest match"}</small></article>
      </section>

      <section className="cost-workspace">
        {pricingError && <p className="pricing-error" role="alert">{pricingError}</p>}
        <div className="cost-section-heading"><div><span>01</span><h2>Steel calculation basis</h2></div><small>Part pricing and winding weight remain separate</small></div>
        <div className="steel-basis-card">
          <div><span>Winding-sheet reference</span><strong>{pounds(inputs.steelWeightLbs)}</strong><small>{inputs.steelGrade || "Grade not returned"}</small></div>
          <p>The 510 item identifies the pricing record. Tempel estimates use the design-packet quantity and the schedule&apos;s net weight per 1,000. Winding-sheet steel weight remains a cross-check and is not substituted into the item calculation.</p>
        </div>

        <div className="cost-section-heading"><div><span>02</span><h2>Design-packet 510 parts</h2></div><small>{inputs.parts.length} row{inputs.parts.length === 1 ? "" : "s"} returned</small></div>
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

        <div className="cost-section-heading"><div><span>03</span><h2>Tempel and vendor calculations</h2></div><small>Latest source dates and formulas shown</small></div>
        <div className="price-comparison-list">
          {calculations.some((item) => item.bundle) ? calculations.map((item, index) => item.bundle && (
            <article className="price-comparison-card" key={`calculation-${item.part.partNumber}-${index}`}>
              <header><div><span>{item.bundle.matchKind === "closest" ? "APPROVED CLOSEST MATCH" : "EXACT PART MATCH"}</span><h3>{item.part.partNumber}</h3></div>{item.bundle.matchKind === "closest" && <small>Using {item.bundle.matchedPartNumber}</small>}</header>
              <dl className="price-result-summary" aria-label="Tempel and vendor price summary">
                <div><dt>Current Tempel calculated price</dt><dd>{money(item.tempel?.cost)}</dd></div>
                <div><dt>Vendor Master cost</dt><dd>{money(item.vendor?.cost)}</dd></div>
                <div><dt>Difference (Tempel - vendor)</dt><dd className={item.difference != null && item.difference > 0 ? "is-higher" : ""}>{signedMoney(item.difference)}</dd></div>
                <div><dt>Vendor last-cost date</dt><dd>{item.bundle.vendor ? date(item.bundle.vendor.lastDate) : "—"}</dd></div>
              </dl>
              <div className="price-comparison-grid">
                <section>
                  <h4>Tempel active schedule</h4>
                  {item.bundle.tempel ? <>
                    <dl>
                      <div><dt>Tempel part number</dt><dd>{item.bundle.tempel.tempelPartNumber || "—"}</dd></div>
                      <div><dt>Effective date</dt><dd>{date(item.bundle.tempel.effectiveDate)}</dd></div>
                      <div><dt>Snapshot date</dt><dd>{date(item.bundle.tempel.snapshotDate)}</dd></div>
                      <div><dt>Base price / lb</dt><dd>{money(item.bundle.tempel.basePricePerLb, 4)}</dd></div>
                      <div><dt>Surcharge / lb</dt><dd>{money(item.bundle.tempel.surchargePerLb, 4)}</dd></div>
                      <div><dt>Surcharge code</dt><dd>{item.bundle.tempel.surchargeCode || "—"}<small>Source code; definition not provided</small></dd></div>
                      <div><dt>PO price / lb</dt><dd>{money(item.bundle.tempel.poPricePerLb, 4)}</dd></div>
                    </dl>
                    <div className="source-formula-note">
                      <span>PO price formula</span>
                      <strong>{money(item.bundle.tempel.basePricePerLb, 4)} base + {money(item.bundle.tempel.surchargePerLb, 4)} surcharge = {money(item.bundle.tempel.poPricePerLb, 4)} / lb</strong>
                      <small>Values imported from Tempel columns “wef 01NOV2024,” “SC/lb,” and “PO Price/lb.”</small>
                    </div>
                    <div className="calculation-line">
                      <span>Weight</span><strong>{item.tempel ? pounds(item.tempel.weight) : "Not calculated"}</strong>
                      <small>{item.part.quantity ?? "—"} {item.part.unitOfMeasure || "units"} × {number(item.bundle.tempel.netWeightPerThousand)} net lb / 1,000</small>
                    </div>
                    <div className="calculation-line total"><span>Tempel estimate</span><strong>{money(item.tempel?.cost)}</strong><small>{item.tempel ? `${number(item.tempel.weight, 2)} lb × ${money(item.bundle.tempel.poPricePerLb, 4)} / lb` : "Quantity, unit, weight, or PO price is missing"}</small></div>
                  </> : <p className="source-empty">No Tempel part-number match.</p>}
                </section>
                <section>
                  <h4>Vendor item master</h4>
                  {item.bundle.vendor ? <>
                    <dl>
                      <div><dt>Vendor</dt><dd>{item.bundle.vendor.vendorNumber || "—"}</dd></div>
                      <div><dt>Vendor stock number</dt><dd>{item.bundle.vendor.stockNumber || "—"}</dd></div>
                      <div><dt>Last cost date</dt><dd>{date(item.bundle.vendor.lastDate)}<small>Vendor Item Master: LAST DTE</small></dd></div>
                      <div><dt>Snapshot date</dt><dd>{date(item.bundle.vendor.snapshotDate)}</dd></div>
                      <div><dt>Last cost</dt><dd>{money(item.bundle.vendor.lastCost, 4)} / {item.bundle.vendor.stockUnit || "stock unit"}</dd></div>
                      <div><dt>Quoted price</dt><dd>{money(item.bundle.vendor.quotePrice, 2)} / {item.bundle.vendor.quoteUnit || "quote unit"}</dd></div>
                    </dl>
                    <div className="calculation-line total"><span>Vendor estimate</span><strong>{money(item.vendor?.cost)}</strong><small>{item.vendor ? `${item.part.quantity} × ${money(item.bundle.vendor.lastCost, 4)} latest positive cost` : "No positive last cost available for a direct estimate"}</small></div>
                    {item.bundle.vendorAlternatives.length > 1 && <small className="alternatives-note">{item.bundle.vendorAlternatives.length - 1} additional vendor record{item.bundle.vendorAlternatives.length === 2 ? "" : "s"} retained for review.</small>}
                  </> : <p className="source-empty">No vendor item master match.</p>}
                </section>
              </div>
            </article>
          )) : <p className="source-empty comparison-empty">{pricing ? "No exact match or approved closest match is available for calculation." : "Pricing calculations will appear after the source lookup finishes."}</p>}
        </div>

        <div className="cost-section-heading"><div><span>04</span><h2>Steel market benchmark</h2></div><small>BLS steel mill products index · monthly</small></div>
        <div className="market-benchmark-list">
          {calculations.some((item) => item.vendor) ? calculations.map((item, index) => item.vendor && (
            <article className="market-benchmark-card" key={`market-${item.part.partNumber}-${index}`}>
              <header>
                <div><span>MARKET-ADJUSTED REFERENCE</span><h3>{item.part.partNumber}</h3></div>
                {market && <small>Latest complete month: {month(market.latestPeriod)}</small>}
              </header>
              {item.marketComparison ? <>
                <div className="market-kpis">
                  <div><span>Index at vendor date</span><strong>{number(item.marketComparison.purchaseIndex, 1)}</strong><small>{month(item.marketComparison.purchasePeriod)}</small></div>
                  <div><span>Latest index</span><strong>{number(item.marketComparison.latestIndex, 1)}</strong><small>{month(item.marketComparison.latestPeriod)}</small></div>
                  <div><span>Market multiplier</span><strong>{number(item.marketComparison.multiplier, 3)}×</strong><small>{item.marketComparison.changePercent >= 0 ? "+" : ""}{number(item.marketComparison.changePercent, 1)}%</small></div>
                  <div><span>Adjusted vendor estimate</span><strong>{money(item.marketAdjustedVendorCost)}</strong><small>{money(item.vendor.cost)} × {number(item.marketComparison.multiplier, 3)}</small></div>
                </div>
                <div className="market-index-bars" aria-label={`Steel index comparison for ${item.part.partNumber}`}>
                  <div><span><b>{month(item.marketComparison.purchasePeriod)}</b><em>{number(item.marketComparison.purchaseIndex, 1)}</em></span><i><u style={{ width: marketBarWidth(item.marketComparison.purchaseIndex, item.marketComparison) }} /></i></div>
                  <div><span><b>{month(item.marketComparison.latestPeriod)}</b><em>{number(item.marketComparison.latestIndex, 1)}</em></span><i><u style={{ width: marketBarWidth(item.marketComparison.latestIndex, item.marketComparison) }} /></i></div>
                </div>
                <p className="market-method">The index is a broad market benchmark, not a quoted electrical-steel price. Multiplier = latest index ÷ index in the vendor last-cost month. The adjusted estimate remains separate from the selected Tempel/vendor cost.</p>
                {market?.warning && <p className="market-warning">{market.warning}</p>}
              </> : <p className="source-empty">{marketError || (market ? "No monthly index was available for this vendor date." : "Loading the steel market benchmark…")}</p>}
              {market && <footer><span>{market.sourceLabel} · {market.seriesId} · {market.units} · {market.seasonalAdjustment}</span><a href={market.sourceUrl} target="_blank" rel="noreferrer">View source</a></footer>}
            </article>
          )) : <p className="source-empty comparison-empty">A market adjustment appears when a dated positive Vendor Master cost is available.</p>}
        </div>

        <div className="cost-section-heading source-order-heading"><div><span>05</span><h2>Price-source order</h2></div><small>Every result keeps its source date and unit</small></div>
        <ol className="price-waterfall">
          <li><span>1</span><div><strong>Tempel active schedule</strong><small>Exact 510 match using base price plus surcharge and the schedule&apos;s net weight.</small></div></li>
          <li><span>2</span><div><strong>Latest valid vendor cost</strong><small>Newest positive dated record for the exact item, with vendor and stock units shown.</small></div></li>
          <li><span>3</span><div><strong>Closest part review</strong><small>A suggested part is never priced until the user answers yes.</small></div></li>
          <li><span>4</span><div><strong>No-match review</strong><small>Missing price, weight, unit, or grade remains visible instead of becoming an assumed cost.</small></div></li>
        </ol>
      </section>
    </>
  );
}
