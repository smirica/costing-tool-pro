"use client";

import type { DesignPacketResult, OtherPartsAssembly } from "./design-packet-reader";
import type { WindingResult } from "./winding-reader";

export type ResultView = "winding" | "design-packet";

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ResultTabs({ active, hasWinding, hasDesignPacket, onChange }: {
  active: ResultView;
  hasWinding: boolean;
  hasDesignPacket: boolean;
  onChange: (view: ResultView) => void;
}) {
  if (!hasDesignPacket) return null;
  return (
    <div className="result-view-tabs" role="group" aria-label="Result views">
      <button type="button" className={active === "design-packet" ? "is-active" : ""} disabled={!hasDesignPacket} onClick={() => onChange("design-packet")}>Design packet results</button>
      <button type="button" className={active === "winding" ? "is-active" : ""} disabled={!hasWinding} onClick={() => onChange("winding")}>Winding results</button>
    </div>
  );
}

export function WindingResultPanel({ result, fileName, elapsedSeconds }: { result: WindingResult; fileName: string; elapsedSeconds: number }) {
  const windingCount = result.columns.filter((column) => column.countsAsWinding).length;
  const confidenceLabel = result.confidence == null ? "Azure analyzer result" : `${Math.round(result.confidence * 100)}% average confidence`;
  const firstWinding = result.columns.find((column) => column.countsAsWinding);

  return (
    <>
      <div className="preview-heading">
        <div><span className="eyebrow">AZURE EXTRACTION COMPLETE</span><h2>{result.catalogNumber}</h2><p>{fileName} · {formatElapsed(elapsedSeconds)} processing time</p></div>
        <span className="confidence"><i /> {confidenceLabel}</span>
      </div>
      <div className="description-band"><span>DOCUMENT</span><strong>{result.documentTitle}</strong></div>
      <div className="metric-grid">
        <article><span>Coils / transformer</span><strong>{result.coilCount}</strong><small>Transformer-level count, applied once</small></article>
        <article><span>Windings counted</span><strong>{windingCount}</strong><small>Shield and External Duct excluded</small></article>
        <article><span>Total metal weight</span><strong>{result.totalMetalWeight.toFixed(1)} <b>lb</b></strong><small>Copper + aluminum + core steel</small></article>
      </div>
      <div className="section-head"><div><span className="section-number">01</span><h3>Winding table columns</h3></div><span className="quiet-pill">{result.columns.length} columns retained</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Column</th><th>Type</th><th>Page</th><th>Break out</th><th>Turns</th><th>Wire material</th><th>Wire no. / size</th><th>Weight / coil</th><th>Total weight</th></tr></thead>
          <tbody>
            {result.columns.map((row, index) => (
              <tr key={`${row.sourcePage ?? 0}-${index}-${row.name}`}>
                <td><strong>{row.name}</strong></td>
                <td><span className={row.countsAsWinding ? "column-kind winding-kind" : "column-kind"}>{row.columnType}</span></td>
                <td>{row.sourcePage ?? "—"}</td><td>{row.breakout || "—"}</td><td>{row.totalTurns ?? "—"}</td>
                <td>{row.material ? <span className="material-label copper-label">{row.material}</span> : "—"}</td>
                <td>{row.size || row.ductStickSize || "—"}</td>
                <td>{row.weightPerCoil === null ? "—" : `${row.weightPerCoil.toFixed(3)} lb`}</td>
                <td><strong>{row.weightPerCoil === null ? "—" : `${(row.weightPerCoil * result.coilCount).toFixed(3)} lb`}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section-head"><div><span className="section-number">02</span><h3>Material weight</h3></div><span className="quiet-pill">Calculated from grounded columns</span></div>
      <div className="material-grid">
        <article><span className="weight-icon copper-bg">Cu</span><p><small>Copper</small><strong>{result.copperWeight.toFixed(2)} lb</strong><em>Includes retained copper Shield columns</em></p></article>
        <article><span className="weight-icon aluminum-bg">Al</span><p><small>Aluminum</small><strong>{result.aluminumWeight.toFixed(2)} lb</strong><em>{result.aluminumWeight ? "Extracted aluminum columns" : "No aluminum detected"}</em></p></article>
        <article><span className="weight-icon steel-bg">Fe</span><p><small>Core steel</small><strong>{result.steelWeight.toFixed(2)} lb</strong><em>{result.steelGrade || "Steel grade not returned"}</em></p></article>
        <article className="total-card"><span>Total</span><strong>{result.totalMetalWeight.toFixed(2)} lb</strong><em>Metal weight for one transformer</em></article>
      </div>
      <div className="two-column">
        <section className="sub-card">
          <div className="section-head compact"><div><span className="section-number">03</span><h3>Papers &amp; tapes</h3></div><span className="quiet-pill">{result.papers.length} cells</span></div>
          <div className="paper-list">
            {result.papers.length ? result.papers.map((paper, index) => (
              <div key={`${paper.sourcePage ?? 0}-${index}-${paper.name}`}><span className="paper-index">{String(index + 1).padStart(2, "0")}</span><p><strong>{paper.name}</strong><small>{[paper.measurement, paper.details, paper.sourcePage ? `page ${paper.sourcePage}` : ""].filter(Boolean).join(" · ")}</small></p></div>
            )) : <p className="empty-result">No separate paper/tape cells returned.</p>}
          </div>
        </section>
        <section className="sub-card">
          <div className="section-head compact"><div><span className="section-number">04</span><h3>Core &amp; construction</h3></div><span className="quiet-pill verified">Extracted</span></div>
          <dl className="spec-list">
            <div><dt>Steel grade</dt><dd>{result.steelGrade || "—"}</dd></div>
            <div><dt>Steel weight</dt><dd>{result.steelWeight ? `${result.steelWeight.toFixed(2)} lb` : "—"}</dd></div>
            <div><dt>Lamination thickness</dt><dd>{result.laminationThickness === null ? "—" : `${result.laminationThickness} in`}</dd></div>
            <div><dt>Stack</dt><dd>{result.stack === null ? "—" : `${result.stack} in`}</dd></div>
            <div><dt>Coil length</dt><dd>{firstWinding?.coilLength == null ? "—" : `${firstWinding.coilLength} in`}</dd></div>
            <div><dt>Winding length</dt><dd>{firstWinding?.windingLength == null ? "—" : `${firstWinding.windingLength} in`}</dd></div>
          </dl>
        </section>
      </div>      <div className="review-bar"><div><span className="review-icon">✓</span><p><strong>Ready for engineering review</strong><small>{result.warnings.length ? result.warnings.join(" · ") : "Classifier-routed winding pages were extracted; Shield and External Duct columns are retained but not counted as windings."}</small></p></div><button type="button" onClick={() => window.print()}>Print result</button></div>
    </>
  );
}

function AssemblyTable({ assembly, index }: { assembly: OtherPartsAssembly; index: number }) {
  const countMatches = assembly.reportedTotalItems === null || assembly.reportedTotalItems === assembly.parts.length;
  return (
    <section className="assembly-card">
      <div className="assembly-heading">
        <div><span className="section-number">{String(index + 1).padStart(2, "0")}</span><p><strong>{assembly.otherPartNumber || "Part number not found"}</strong><span>{assembly.title}</span></p></div>
        <div className="assembly-meta">
          <span>Originally for <strong>{assembly.originallyFor || "—"}</strong></span>
          <span className={countMatches ? "count-check is-match" : "count-check is-mismatch"}>
            Returned <strong>{assembly.parts.length}</strong>
            {assembly.reportedTotalItems !== null ? <> · Printed total <strong>{assembly.reportedTotalItems}</strong></> : null}
          </span>
        </div>
      </div>
      <div className="table-wrap parts-table-wrap">
        <table className="parts-table">
          <thead><tr><th>Part number</th><th>Qty</th><th>UofM</th><th>Description</th></tr></thead>
          <tbody>
            {assembly.parts.length ? assembly.parts.map((part, partIndex) => (
              <tr className={!part.partNumber && part.description ? "continuation-row" : ""} key={`${assembly.otherPartNumber}-${partIndex}`}>
                <td><strong>{part.partNumber || "—"}</strong></td><td>{part.quantity ?? "—"}</td><td>{part.unitOfMeasure || "—"}</td><td>{part.description || "—"}</td>
              </tr>
            )) : <tr><td colSpan={4}>No populated part rows were returned.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DesignPacketResultPanel({ result, fileName, elapsedSeconds }: { result: DesignPacketResult; fileName: string; elapsedSeconds: number }) {
  const partRowCount = result.assemblies.reduce((sum, assembly) => sum + assembly.parts.length, 0);
  const confidenceLabel = result.confidence == null ? "Azure analyzer result" : `${Math.round(result.confidence * 100)}% average confidence`;
  return (
    <>
      <div className="preview-heading">
        <div><span className="eyebrow">DESIGN PACKET EXTRACTION COMPLETE</span><h2>{result.header.catalogNumber}</h2><p>{fileName} · {formatElapsed(elapsedSeconds)} classifier processing time</p></div>
        <span className="confidence"><i /> {confidenceLabel}</span>
      </div>
      <div className="design-metric-grid">
        <article><span>Other parts</span><strong>{result.assemblies.length}</strong><small>Assembly pages retained</small></article>
        <article><span>Parts table rows</span><strong>{partRowCount}</strong><small>Including description continuations</small></article>
        <article><span>Winding pages</span><strong>{result.windingSheetPages.length}</strong><small>{result.windingSheetPages.length ? `Routed pages: ${result.windingSheetPages.join(", ")}` : "No winding page detected"}</small></article>
      </div>
      <div className="section-head"><div><span className="section-number">01</span><h3>Cover sheet</h3></div><span className="quiet-pill">Master Sheet ignored</span></div>
      <dl className="packet-header-grid">
        <div><dt>Catalog number</dt><dd>{result.header.catalogNumber}</dd></div>
        <div><dt>Date created</dt><dd>{result.header.dateCreated || "—"}</dd></div>
        <div><dt>Date revised</dt><dd>{result.header.dateRevised || "—"}</dd></div>
      </dl>
      <div className="two-column packet-summary">
        <section className="sub-card">
          <div className="section-head compact"><div><span className="section-number">02</span><h3>Stop points</h3></div><span className="quiet-pill">{result.stopPoints.length} windings</span></div>
          <div className="table-wrap stop-points-wrap"><table className="stop-points-table"><thead><tr><th>Winding</th><th>Break outs</th><th>Stop points</th></tr></thead><tbody>
            {result.stopPoints.length ? result.stopPoints.map((row, index) => <tr key={`${row.windingName}-${index}`}><td><strong>{row.windingName}</strong></td><td>{row.breakOuts || "—"}</td><td>{row.stopPoints || "—"}</td></tr>) : <tr><td colSpan={3}>No stop-point columns were returned.</td></tr>}
          </tbody></table></div>
        </section>
        <section className="sub-card packet-notes"><div className="section-head compact"><div><span className="section-number">03</span><h3>Notes</h3></div><span className="quiet-pill">Combined</span></div><p>{result.notes || "No quality, testing, packaging, or shipping notes were returned."}</p></section>
      </div>
      <div className="section-head"><div><span className="section-number">04</span><h3>Other parts</h3></div><span className="quiet-pill">{result.assemblies.length} assemblies</span></div>
      <div className="other-parts-index">
        {result.assemblies.length ? result.assemblies.map((assembly, index) => <article key={`${assembly.otherPartNumber}-index-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p><strong>{assembly.otherPartNumber || "Number not found"}</strong><small>{assembly.title}</small></p></article>) : <p className="empty-result">No Other Parts assembly pages were returned.</p>}
      </div>
      <div className="assembly-list">{result.assemblies.map((assembly, index) => <AssemblyTable assembly={assembly} index={index} key={`${assembly.otherPartNumber}-${index}`} />)}</div>
      <div className="review-bar"><div><span className="review-icon">✓</span><p><strong>Ready for design review</strong><small>{result.warnings.length ? result.warnings.join(" · ") : "Design-packet and winding fields came back through one classifier operation and remain separately reviewable."}</small></p></div><button type="button" onClick={() => window.print()}>Print result</button></div>
    </>
  );
}
