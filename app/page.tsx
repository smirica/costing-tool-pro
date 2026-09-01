"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { analyzeDesignPacket, type DesignPacketResult } from "./design-packet-reader";
import { DesignPacketResultPanel, ResultTabs, WindingResultPanel, type ResultView } from "./result-panels";
import { AnalysisTimedOutError, analyzeWindingSheet, type WindingResult } from "./winding-reader";

type Theme = "light" | "dark";
type DocumentKind = "winding-sheet" | "design-packet";
type AnalysisPhase = "idle" | "submitting" | "analyzing" | "complete" | "failed" | "timed-out";
type AnalysisStage = "winding-sheet" | "design-packet";

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
  const [documentKind, setDocumentKind] = useState<DocumentKind>("winding-sheet");
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>("winding-sheet");
  const [activeResult, setActiveResult] = useState<ResultView>("winding");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [windingResult, setWindingResult] = useState<WindingResult | null>(null);
  const [designPacketResult, setDesignPacketResult] = useState<DesignPacketResult | null>(null);
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

  const clearAnalysis = () => {
    analysisControllerRef.current?.abort();
    analysisRunRef.current += 1;
    setSelectedFile(null);
    setWindingResult(null);
    setDesignPacketResult(null);
    setResultFileName("");
    analysisStartedAtRef.current = null;
    setElapsedSeconds(0);
    setPhase("idle");
    setAnalysisError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const changeDocumentKind = (kind: DocumentKind) => {
    if (kind === documentKind) return;
    clearAnalysis();
    setDocumentKind(kind);
    setAnalysisStage(kind);
    setActiveResult(kind === "design-packet" ? "design-packet" : "winding");
  };

  const selectFile = (file?: File) => {
    if (!file) return;
    if (documentKind === "design-packet" && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setAnalysisError("Design packets must be uploaded as PDF files.");
      return;
    }
    analysisControllerRef.current?.abort();
    analysisRunRef.current += 1;
    setSelectedFile(file);
    setWindingResult(null);
    setDesignPacketResult(null);
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
    setWindingResult(null);
    setDesignPacketResult(null);
    setResultFileName("");
    setAnalysisStage(documentKind);
    setPhase("submitting");
    setAnalysisError("");

    try {
      if (documentKind === "design-packet") {
        const nextResult = await analyzeDesignPacket(selectedFile, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (analysisRunRef.current === runId) setPhase(progress);
          },
          onStage: (stage) => {
            if (analysisRunRef.current === runId) setAnalysisStage(stage);
          },
        });
        if (analysisRunRef.current !== runId) return;        setDesignPacketResult(nextResult.designPacket);
        setWindingResult(nextResult.windingSheet);
        setActiveResult("design-packet");
      } else {
        const nextResult = await analyzeWindingSheet(selectedFile, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (analysisRunRef.current === runId) setPhase(progress);
          },
        });
        if (analysisRunRef.current !== runId) return;
        setWindingResult(nextResult);
        setActiveResult("winding");
      }

      setResultFileName(analyzedFileName);
      if (analysisStartedAtRef.current !== null) {
        setElapsedSeconds(Math.max(1, Math.ceil((Date.now() - analysisStartedAtRef.current) / 1000)));
      }
      setPhase("complete");
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (controller.signal.aborted || analysisRunRef.current !== runId) return;
      setAnalysisError(error instanceof Error ? error.message : "Azure document analysis failed.");
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
      if (analysisStartedAtRef.current !== null) setElapsedSeconds(Math.floor((Date.now() - analysisStartedAtRef.current) / 1000));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [isBusy]);

  const selectedLabel = documentKind === "design-packet" ? "design packet" : "winding sheet";
  const analyzerLabel = analysisStage === "design-packet" ? "DesignPacketAnalyzer" : "WindingSheetAnalyzer";
  const phaseLabel = phase === "submitting" ? `Submitting to ${analyzerLabel}`
    : phase === "analyzing" ? `${analyzerLabel} analysis in progress`
      : phase === "complete" ? "Analysis completed"
        : phase === "timed-out" ? "Analysis timed out"
          : phase === "failed" ? "Analysis failed"
            : selectedFile ? "Ready to analyze" : `Waiting for a ${selectedLabel}`;
  const buttonLabel = phase === "submitting" ? `Uploading ${selectedLabel}…`
    : phase === "analyzing" ? analysisStage === "design-packet" ? "Azure is reading packet fields…" : "Azure is reading winding pages…"
      : phase === "complete" ? "Analyze again" : `Analyze ${selectedLabel}`;
  const readerMessage = analysisError || (phase === "submitting"
    ? `Sending ${selectedFile?.name || `the ${selectedLabel}`} to Azure…`
    : phase === "analyzing"
      ? analysisStage === "design-packet"
        ? "Reading cover, stop points, notes, Other Parts, and locating winding pages."
        : documentKind === "design-packet"
          ? "Packet fields are complete. The detected winding page is now being sent to WindingSheetAnalyzer."
          : `Azure is processing ${selectedFile?.name || "the winding sheet"}. This can take several minutes.`
      : phase === "complete" ? `Completed ${resultFileName}.`
        : selectedFile ? `${selectedFile.name} is selected. Its results will replace this empty panel only after Azure succeeds.`
          : documentKind === "design-packet"
            ? "Connected to DesignPacketAnalyzer, with winding pages routed to WindingSheetAnalyzer."
            : "Connected to WindingSheetAnalyzer. Choose a file to begin.");
  const emptyPanelTitle = isBusy ? `Reading ${selectedFile?.name || selectedLabel}`
    : phase === "failed" || phase === "timed-out" ? `No result returned for ${selectedFile?.name || "this file"}`
      : selectedFile ? `${selectedFile.name} is ready` : `No ${selectedLabel} analyzed yet`;
  const emptyPanelDescription = isBusy
    ? "The page will keep checking the same Azure job. Previous document fields have been cleared."
    : phase === "failed" || phase === "timed-out"
      ? "The previous document is not shown. Review the message above, then retry when ready."
      : selectedFile ? `Select Analyze ${selectedLabel} to send this file to Azure.`
        : `Choose a ${documentKind === "design-packet" ? "PDF" : "PDF or image"} above. Extracted fields will appear here only after Azure reports success.`;

  const showDesignPacket = activeResult === "design-packet" && designPacketResult;
  const visibleResult = showDesignPacket || windingResult;
  const openResultView = (view: ResultView) => {
    setActiveResult(view);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (accessState !== "granted") {
    return (
      <main className="site-shell access-page">
        <div className="ambient ambient-one" /><div className="ambient ambient-two" />
        <nav className="topbar" aria-label="Site controls"><a className="brand" href="#access" aria-label="Winding Intelligence access"><span className="brand-mark">W</span><span>Winding Intelligence</span></a><ThemeToggle theme={theme} onToggle={toggleTheme} /></nav>
        <section className="access-card" id="access" aria-live="polite">
          <span className="access-lock" aria-hidden="true">W</span><span className="eyebrow">SECURE READER WORKSPACE</span>
          <h1>{accessState === "checking" ? "Checking access..." : "Enter the site password."}</h1>
          {accessState === "checking" ? <p className="access-status">One moment while we check this browser.</p> : (
            <>
              <p>This public site does not require a ChatGPT account. Enter the shared password to open the costing reader.</p>
              <form onSubmit={unlockSite}><label htmlFor="site-password">Password</label><div className="access-form-row"><input id="site-password" type="password" autoComplete="current-password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} autoFocus /><button type="submit" disabled={unlocking || !accessPassword}>{unlocking ? "Checking..." : "Unlock reader"}</button></div>{accessError && <p className="access-error" role="alert">{accessError}</p>}</form>
              <small>Access stays unlocked in this browser for up to 8 hours.</small>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Winding Intelligence home"><span className="brand-mark">W</span><span>Winding Intelligence</span></a>        <div className="top-actions"><span className="environment-pill"><i /> Reader workspace</span><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">DOCUMENT TO COSTING DATA</span>
          <h1>From design packet<br />to <em>cost-ready</em> data.</h1>
          <p>Upload a winding sheet or a complete design packet. The Reader keeps packet fields, Other Parts tables, and winding data reviewable and separate.</p>
          <div className="trust-row"><span>PDF &amp; image files</span><span>Human review built in</span><span>Two-stage Azure reading</span></div>
        </div>

        <div className="reader-column">
          <div className="reader-card">
            <div className="reader-card-head"><div><span className="step-label">STEP 01</span><h2>Add an engineering document</h2></div><span className="secure-chip">Private</span></div>
            <div className="document-kind-switch" role="group" aria-label="Document type">
              <button type="button" className={documentKind === "winding-sheet" ? "is-active" : ""} aria-pressed={documentKind === "winding-sheet"} onClick={() => changeDocumentKind("winding-sheet")}>Winding sheet</button>
              <button type="button" className={documentKind === "design-packet" ? "is-active" : ""} aria-pressed={documentKind === "design-packet"} onClick={() => changeDocumentKind("design-packet")}>Design packet</button>
            </div>
            <button className="drop-zone" type="button" onClick={() => inputRef.current?.click()} onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
              <span className="upload-orb" aria-hidden="true">{selectedFile ? "✓" : "↑"}</span><strong>{selectedFile?.name || "Drop your file here"}</strong>
              <span>{selectedFile ? `Ready for ${documentKind === "design-packet" ? "DesignPacketAnalyzer" : "WindingSheetAnalyzer"}` : documentKind === "design-packet" ? "or click to browse · PDF" : "or click to browse · PDF, PNG, JPG, TIFF"}</span>
            </button>
            <input ref={inputRef} className="sr-only" type="file" accept={documentKind === "design-packet" ? ".pdf,application/pdf" : ".pdf,.png,.jpg,.jpeg,.tif,.tiff"} onChange={(event) => selectFile(event.target.files?.[0])} />
            <button className="analyze-button" type="button" disabled={!selectedFile || isBusy} onClick={analyze}><span>{buttonLabel}</span><span aria-hidden="true">{isBusy ? "···" : "→"}</span></button>
            <div className={`analysis-state status-${phase}`} role="status" aria-live="polite"><i aria-hidden="true" /><strong>{phaseLabel}</strong></div>
            <p className={analysisError ? "reader-note reader-error" : "reader-note"}>{readerMessage}</p>
          </div>
          <button className="design-results-shortcut" type="button" disabled={!designPacketResult} onClick={() => openResultView("design-packet")}>
            <span><small>VIEW</small><strong>Design packet results</strong></span>
            <span>{designPacketResult ? `${designPacketResult.assemblies.length} Other Parts` : "Available after packet analysis"} <b aria-hidden="true">→</b></span>
          </button>
        </div>
      </section>

      {visibleResult ? (
        <section className="result-preview" ref={resultsRef} aria-label="Extraction result">
          <ResultTabs active={activeResult} hasWinding={Boolean(windingResult)} hasDesignPacket={Boolean(designPacketResult)} onChange={openResultView} />
          {showDesignPacket && designPacketResult
            ? <DesignPacketResultPanel result={designPacketResult} fileName={resultFileName} elapsedSeconds={elapsedSeconds} />
            : windingResult ? <WindingResultPanel result={windingResult} fileName={resultFileName} elapsedSeconds={elapsedSeconds} /> : null}
        </section>
      ) : (
        <section className="result-preview empty-preview" ref={resultsRef} aria-label="Extraction result" aria-live="polite">
          <div className="empty-preview-content">
            <span className={`empty-result-icon ${isBusy ? "is-busy" : ""}`} aria-hidden="true">{isBusy ? <i className="loading-spinner" /> : "—"}</span>
            <span className="eyebrow">{isBusy ? `AZURE READING · ${formatElapsed(elapsedSeconds)}` : phase === "failed" || phase === "timed-out" ? "NO RESULT RETURNED" : "EMPTY RESULT"}</span>
            <h2>{emptyPanelTitle}</h2><p>{emptyPanelDescription}</p>
          </div>
        </section>
      )}
      <footer><span>Winding Intelligence</span><span>Designed for faster, reviewable transformer costing</span></footer>
    </main>
  );
}