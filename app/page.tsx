"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AnalysisTimedOutError, analyzeWindingSheet, type WindingResult } from "./winding-reader";

type Theme = "light" | "dark";
type AnalysisPhase = "idle" | "submitting" | "analyzing" | "complete" | "failed" | "timed-out";

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const nextTheme = theme === "light" ? "dark" : "light";
  return (
    <button className="theme-toggle" type="button" aria-label={`Switch to ${nextTheme} mode`} aria-pressed={theme === "dark"} onClick={onToggle}>
      <span aria-hidden="true">{theme === "light" ? "Light" : "Dark"}</span>
      <span className="theme-switch" aria-hidden="true"><i /></span>
    </button>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const analysisControllerRef = useRef<AbortController | null>(null);
  const analysisRunRef = useRef(0);
  const analysisStartedAtRef = useRef<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [result, setResult] = useState<WindingResult | null>(null);
  const [resultFileName, setResultFileName] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [analysisError, setAnalysisError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [accessState, setAccessState] = useState<"checking" | "locked" | "granted">("checking");
  const [accessPassword, setAccessPassword] = useState("");
  const [accessError, setAccessError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("winding-intelligence-theme");
    const preferredTheme: Theme = savedTheme === "dark" ? "dark" : "light";
    setTheme(preferredTheme);
    document.documentElement.dataset.theme = preferredTheme;
  }, []);

  useEffect(() => () => analysisControllerRef.current?.abort(), []);

  useEffect(() => {
    let active = true;
    fetch("/api/access", { cache: "no-store" })
      .then((response) => response.json())
      .then((value) => {
        if (!active) return;
        setAccessState(value.authorized ? "granted" : "locked");
        if (!value.configured) setAccessError("Site access is being configured. Please try again shortly.");
      })
      .catch(() => {
        if (!active) return;
        setAccessState("locked");
        setAccessError("The access check could not be completed. Please try again.");
      });
    return () => { active = false; };
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      window.localStorage.setItem("winding-intelligence-theme", next);
      return next;
    });
  };

  const unlockSite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessPassword || unlocking) return;
    setUnlocking(true);
    setAccessError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: accessPassword }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAccessError(value.error || "That password did not work.");
        return;
      }
      setAccessPassword("");
      setAccessState("granted");
    } catch {
      setAccessError("The password could not be checked. Please try again.");
    } finally {
      setUnlocking(false);
    }
  };

  const selectFile = (file?: File) => {
    if (!file) return;
    analysisControllerRef.current?.abort();
    analysisRunRef.current += 1;
    setSelectedFile(file);
    setResult(null);
    setResultFileName("");
    analysisStartedAtRef.current = null;
    setElapsedSeconds(0);
    setPhase("idle");
    setAnalysisError("");
  };

  const analyze = async () => {
    if (!selectedFile) return;
    analysisControllerRef.current?.abort();
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    const runId = analysisRunRef.current + 1;
    analysisRunRef.current = runId;
    const analyzedFileName = selectedFile.name;
    analysisStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setResult(null);
    setResultFileName("");
    setPhase("submitting");
    setAnalysisError("");
    try {
      const nextResult = await analyzeWindingSheet(selectedFile, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (analysisRunRef.current === runId) setPhase(progress);
        },
      });
      if (analysisRunRef.current !== runId) return;
      setResult(nextResult);
      setResultFileName(analyzedFileName);
      if (analysisStartedAtRef.current !== null) {
        setElapsedSeconds(Math.max(1, Math.ceil((Date.now() - analysisStartedAtRef.current) / 1000)));
      }
      setPhase("complete");
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (controller.signal.aborted || analysisRunRef.current !== runId) return;
      setAnalysisError(error instanceof Error ? error.message : "Azure winding-sheet analysis failed.");
      setPhase(error instanceof AnalysisTimedOutError ? "timed-out" : "failed");
    } finally {
      if (analysisRunRef.current === runId) analysisControllerRef.current = null;
    }
  };
  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files?.[0]);
  };

  const isBusy = phase === "submitting" || phase === "analyzing";

  useEffect(() => {
    if (!isBusy || analysisStartedAtRef.current === null) return;
    const updateElapsed = () => {
      if (analysisStartedAtRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - analysisStartedAtRef.current) / 1000));
      }
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [isBusy]);
  const windingCount = result?.columns.filter((column) => column.countsAsWinding).length ?? 0;
  const confidenceLabel = result?.confidence == null
    ? "Azure analyzer result"
    : `${Math.round(result.confidence * 100)}% average confidence`;
  const firstWinding = result?.columns.find((column) => column.countsAsWinding);
  const phaseLabel = phase === "submitting"
    ? "Submitting to Azure"
    : phase === "analyzing"
      ? "Azure analysis in progress"
      : phase === "complete"
        ? "Analysis completed"
        : phase === "timed-out"
          ? "Analysis timed out"
          : phase === "failed"
            ? "Analysis failed"
            : selectedFile
              ? "Ready to analyze"
              : "Waiting for a winding sheet";
  const buttonLabel = phase === "submitting"
    ? "Uploading winding sheet…"
    : phase === "analyzing"
      ? "Azure is reading every page…"
      : phase === "complete"
        ? "Analyze again"
        : "Analyze winding sheet";
  const readerMessage = analysisError
    || (phase === "submitting"
      ? `Sending ${selectedFile?.name || "the winding sheet"} to Azure…`
      : phase === "analyzing"
        ? `Azure is processing ${selectedFile?.name || "the winding sheet"}. This can take several minutes.`
        : phase === "complete"
          ? `Completed ${resultFileName}.`
          : selectedFile
            ? `${selectedFile.name} is selected. Its results will replace this empty panel only after Azure succeeds.`
            : "Connected to WindingSheetAnalyzer. Choose a file to begin.");
  const emptyPanelTitle = isBusy
    ? `Reading ${selectedFile?.name || "winding sheet"}`
    : phase === "failed" || phase === "timed-out"
      ? `No result returned for ${selectedFile?.name || "this file"}`
      : selectedFile
        ? `${selectedFile.name} is ready`
        : "No winding sheet analyzed yet";
  const emptyPanelDescription = isBusy
    ? "The page will keep checking the same Azure job. Previous document fields have been cleared."
    : phase === "failed" || phase === "timed-out"
      ? "The previous document is not shown. Review the message above, then retry when ready."
      : selectedFile
        ? "Select Analyze winding sheet to send this file to Azure."
        : "Choose a PDF or image above. Extracted fields will appear here only after Azure reports success.";

  if (accessState !== "granted") {
    return (
      <main className="site-shell access-page">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
        <nav className="topbar" aria-label="Site controls">
          <a className="brand" href="#access" aria-label="Winding Intelligence access"><span className="brand-mark">W</span><span>Winding Intelligence</span></a>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </nav>
        <section className="access-card" id="access" aria-live="polite">
          <span className="access-lock" aria-hidden="true">W</span>
          <span className="eyebrow">SECURE READER WORKSPACE</span>
          <h1>{accessState === "checking" ? "Checking access..." : "Enter the site password."}</h1>
          {accessState === "checking" ? <p className="access-status">One moment while we check this browser.</p> : (
            <>
              <p>This public site does not require a ChatGPT account. Enter the shared password to open the costing reader.</p>
              <form onSubmit={unlockSite}>
                <label htmlFor="site-password">Password</label>
                <div className="access-form-row">
                  <input id="site-password" type="password" autoComplete="current-password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} autoFocus />
                  <button type="submit" disabled={unlocking || !accessPassword}>{unlocking ? "Checking..." : "Unlock reader"}</button>
                </div>
                {accessError && <p className="access-error" role="alert">{accessError}</p>}
              </form>
              <small>Access stays unlocked in this browser for up to 8 hours.</small>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Winding Intelligence home">
          <span className="brand-mark">W</span>
          <span>Winding Intelligence</span>
        </a>
        <div className="top-actions">
          <span className="environment-pill"><i /> Reader workspace</span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">DOCUMENT TO COSTING DATA</span>
          <h1>From winding sheet<br />to <em>cost-ready</em> data.</h1>
          <p>
            Upload one winding sheet. The Reader organizes every page and table
            column into a reviewable transformer record.
          </p>
          <div className="trust-row">
            <span>PDF &amp; image files</span>
            <span>Human review built in</span>
            <span>Azure WindingSheetAnalyzer</span>
          </div>
        </div>

        <div className="reader-card">
          <div className="reader-card-head">
            <div>
              <span className="step-label">STEP 01</span>
              <h2>Add a winding sheet</h2>
            </div>
            <span className="secure-chip">Private</span>
          </div>
          <button
            className="drop-zone"
            type="button"
            onClick={() => inputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={(event) => event.preventDefault()}
          >
            <span className="upload-orb" aria-hidden="true">{selectedFile ? "✓" : "↑"}</span>
            <strong>{selectedFile?.name || "Drop your file here"}</strong>
            <span>{selectedFile ? "Ready for WindingSheetAnalyzer" : "or click to browse · PDF, PNG, JPG, TIFF"}</span>
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
          <button className="analyze-button" type="button" disabled={!selectedFile || isBusy} onClick={analyze}>
            <span>{buttonLabel}</span>
            <span aria-hidden="true">{isBusy ? "···" : "→"}</span>
          </button>
          <div className={`analysis-state status-${phase}`} role="status" aria-live="polite">
            <i aria-hidden="true" /><strong>{phaseLabel}</strong>
          </div>
          <p className={analysisError ? "reader-note reader-error" : "reader-note"}>{readerMessage}</p>
        </div>
      </section>

      {result ? (
      <section className="result-preview" ref={resultsRef} aria-label="Extraction result">
        <div className="preview-heading">
          <div>
            <span className="eyebrow">AZURE EXTRACTION COMPLETE</span>
            <h2>{result.catalogNumber}</h2>
            <p>{resultFileName} · {formatElapsed(elapsedSeconds)} processing time</p>
          </div>
          <span className="confidence"><i /> {confidenceLabel}</span>
        </div>

        <div className="description-band">
          <span>DOCUMENT</span>
          <strong>{result.documentTitle}</strong>
        </div>

        <div className="metric-grid">
          <article><span>Coils / transformer</span><strong>{result.coilCount}</strong><small>Transformer-level count, applied once</small></article>
          <article><span>Windings counted</span><strong>{windingCount}</strong><small>Shield and External Duct excluded</small></article>
          <article><span>Total metal weight</span><strong>{result.totalMetalWeight.toFixed(1)} <b>lb</b></strong><small>Copper + aluminum + core steel</small></article>
        </div>

        <div className="section-head">
          <div><span className="section-number">01</span><h3>Winding table columns</h3></div>
          <span className="quiet-pill">{result.columns.length} columns retained</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Column</th><th>Type</th><th>Page</th><th>Break out</th><th>Turns</th><th>Wire material</th><th>Wire no. / size</th><th>Weight / coil</th><th>Total weight</th></tr></thead>
            <tbody>
              {result.columns.map((row, index) => (
                <tr key={`${row.sourcePage ?? 0}-${index}-${row.name}`}>
                  <td><strong>{row.name}</strong></td>
                  <td><span className={row.countsAsWinding ? "column-kind winding-kind" : "column-kind"}>{row.columnType}</span></td>
                  <td>{row.sourcePage ?? "—"}</td>
                  <td>{row.breakout || "—"}</td>
                  <td>{row.totalTurns ?? "—"}</td>
                  <td>{row.material ? <span className="material-label copper-label">{row.material}</span> : "—"}</td>
                  <td>{row.size || row.ductStickSize || "—"}</td>
                  <td>{row.weightPerCoil === null ? "—" : `${row.weightPerCoil.toFixed(3)} lb`}</td>
                  <td><strong>{row.weightPerCoil === null ? "—" : `${(row.weightPerCoil * result.coilCount).toFixed(3)} lb`}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="section-head">
          <div><span className="section-number">02</span><h3>Material weight</h3></div>
          <span className="quiet-pill">Calculated from grounded columns</span>
        </div>
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
                <div key={`${paper.sourcePage ?? 0}-${index}-${paper.name}`}>
                  <span className="paper-index">{String(index + 1).padStart(2, "0")}</span>
                  <p><strong>{paper.name}</strong><small>{[paper.measurement, paper.details, paper.sourcePage ? `page ${paper.sourcePage}` : ""].filter(Boolean).join(" · ")}</small></p>
                </div>
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
        </div>

        <div className="review-bar">
          <div><span className="review-icon">✓</span><p><strong>Ready for engineering review</strong><small>{result.warnings.length ? result.warnings.join(" · ") : "All PDF pages are read; Shield and External Duct columns are retained but not counted as windings."}</small></p></div>
          <button type="button" onClick={() => window.print()}>Print result</button>
        </div>
      </section>
      ) : (
        <section className="result-preview empty-preview" ref={resultsRef} aria-label="Extraction result" aria-live="polite">
          <div className="empty-preview-content">
            <span className={`empty-result-icon ${isBusy ? "is-busy" : ""}`} aria-hidden="true">{isBusy ? <i className="loading-spinner" /> : "—"}</span>
            <span className="eyebrow">{isBusy ? `AZURE READING · ${formatElapsed(elapsedSeconds)}` : phase === "failed" || phase === "timed-out" ? "NO RESULT RETURNED" : "EMPTY RESULT"}</span>
            <h2>{emptyPanelTitle}</h2>
            <p>{emptyPanelDescription}</p>
          </div>
        </section>
      )}

      <footer><span>Winding Intelligence</span><span>Designed for faster, reviewable transformer costing</span></footer>
    </main>
  );
}
