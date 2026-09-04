"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { analyzeDocument, type DesignPacketResult } from "./design-packet-reader";
import { DesignPacketResultPanel, ResultTabs, WindingResultPanel, type ResultView } from "./result-panels";
import { AnalysisTimedOutError, type WindingResult } from "./winding-reader";
import {
  COST_ANALYSIS_STORAGE_KEY,
  DOCUMENT_ANALYSIS_STORAGE_KEY,
  type SteelCostInputs,
} from "./cost-analysis-data";

type Theme = "light" | "dark";
type AnalysisPhase = "idle" | "submitting" | "analyzing" | "complete" | "failed" | "timed-out";
type PersistedDocumentAnalysis = {
  activeResult: ResultView;
  windingResult: WindingResult | null;
  designPacketResult: DesignPacketResult | null;
  resultFileName: string;
  elapsedSeconds: number;
};

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeSteelPartNumber(value: string) {
  return value.toUpperCase().replace(/\s+/g, "").replace(/^510[^A-Z0-9]?/, "510-");
}

function titledDescription(title: string, description: string) {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  let cleanDescription = description.replace(/\s+/g, " ").trim();
  const titleIndex = cleanTitle ? cleanDescription.toLowerCase().indexOf(cleanTitle.toLowerCase()) : -1;
  if (titleIndex >= 0) cleanDescription = cleanDescription.slice(titleIndex + cleanTitle.length).replace(/^[\s:\u2013\u2014-]+/, "");
  const coreIndex = cleanDescription.search(/\bcore\b/i);
  if (coreIndex > 0) cleanDescription = cleanDescription.slice(coreIndex);
  const values = [cleanTitle, cleanDescription].filter(Boolean);
  return values.filter((value, index) => index === 0 || value.toLowerCase() !== values[0].toLowerCase()).join(" - ");
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
    document.documentElement.dataset.theme = preferredTheme;
    const frame = window.requestAnimationFrame(() => setTheme(preferredTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(DOCUMENT_ANALYSIS_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedDocumentAnalysis;
      if (!saved.resultFileName || (!saved.designPacketResult && !saved.windingResult)) return;
      setActiveResult(saved.activeResult || (saved.designPacketResult ? "design-packet" : "winding"));
      setDesignPacketResult(saved.designPacketResult);
      setWindingResult(saved.windingResult);
      setResultFileName(saved.resultFileName);
      setElapsedSeconds(saved.elapsedSeconds || 0);
      setPhase("complete");
    } catch {
      window.sessionStorage.removeItem(DOCUMENT_ANALYSIS_STORAGE_KEY);
    }
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
    window.sessionStorage.removeItem(DOCUMENT_ANALYSIS_STORAGE_KEY);
    window.sessionStorage.removeItem(COST_ANALYSIS_STORAGE_KEY);
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
    setPhase("submitting");
    setAnalysisError("");

    try {
      const nextResult = await analyzeDocument(selectedFile, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (analysisRunRef.current === runId) setPhase(progress);
        },
      });
      if (analysisRunRef.current !== runId) return;
      if (!nextResult.designPacket && !nextResult.windingSheet) {
        const wasOther = nextResult.categories.some((category) => category.toLowerCase() === "other");
        throw new Error(wasOther
          ? "DesignPacketClassifier categorized this upload as Other. Choose a winding sheet or transformer design packet."
          : "DesignPacketClassifier completed, but no routed analyzer fields were returned.");
      }
      const nextActiveResult: ResultView = nextResult.designPacket ? "design-packet" : "winding";
      const finishedElapsed = analysisStartedAtRef.current === null
        ? 0
        : Math.max(1, Math.ceil((Date.now() - analysisStartedAtRef.current) / 1000));
      const saved: PersistedDocumentAnalysis = {
        activeResult: nextActiveResult,
        designPacketResult: nextResult.designPacket,
        windingResult: nextResult.windingSheet,
        resultFileName: analyzedFileName,
        elapsedSeconds: finishedElapsed,
      };

      setDesignPacketResult(nextResult.designPacket);
      setWindingResult(nextResult.windingSheet);
      setActiveResult(nextActiveResult);
      setResultFileName(analyzedFileName);
      setElapsedSeconds(finishedElapsed);
      window.sessionStorage.setItem(DOCUMENT_ANALYSIS_STORAGE_KEY, JSON.stringify(saved));
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

  const phaseLabel = phase === "submitting" ? "Submitting to DesignPacketClassifier"
    : phase === "analyzing" ? "DesignPacketClassifier analysis in progress"
      : phase === "complete" ? "Analysis completed"
        : phase === "timed-out" ? "Analysis timed out"
          : phase === "failed" ? "Analysis failed"
            : selectedFile ? "Ready to analyze" : "Waiting for a document";
  const buttonLabel = phase === "submitting" ? "Uploading document…"
    : phase === "analyzing" ? "Azure is classifying and extracting…"
      : phase === "complete" ? (selectedFile ? "Analyze again" : "Choose another file") : "Analyze document";
  const readerMessage = analysisError || (phase === "submitting"
    ? `Sending ${selectedFile?.name || "the document"} to Azure once…`
    : phase === "analyzing"
      ? "The classifier is routing each segment and its linked analyzers are returning fields in the same Azure job."
      : phase === "complete" ? `Completed ${resultFileName}.`
        : selectedFile ? `${selectedFile.name} is selected. Its results will replace this empty panel only after Azure succeeds.`
          : "Connected to DesignPacketClassifier. Choose a winding sheet or design packet to begin.");
  const emptyPanelTitle = isBusy ? `Reading ${selectedFile?.name || "document"}`
    : phase === "failed" || phase === "timed-out" ? `No result returned for ${selectedFile?.name || "this file"}`
      : selectedFile ? `${selectedFile.name} is ready` : "No document analyzed yet";
  const emptyPanelDescription = isBusy
    ? "The page will keep checking the same Azure job. Previous document fields have been cleared."
    : phase === "failed" || phase === "timed-out"
      ? "The previous document is not shown. Review the message above, then retry when ready."
      : selectedFile ? "Select Analyze document to send this file to Azure once."
        : "Choose a PDF or image above. The classifier will identify and route it automatically.";

  const showDesignPacket = Boolean(designPacketResult && (activeResult === "design-packet" || !windingResult));
  const visibleResult = designPacketResult || windingResult;
  const openResultView = (view: ResultView) => {
    setActiveResult(view);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openCostAnalysis = () => {
    if (!visibleResult) return;
    const steelParts = designPacketResult?.assemblies.flatMap((assembly) => assembly.parts
      .map((part) => ({ ...part, partNumber: normalizeSteelPartNumber(part.partNumber) }))
      .filter((part) => /^510(?:-|(?=[A-Z0-9]))/i.test(part.partNumber))
      .map((part) => ({
        ...part,
        title: assembly.title,
        description: titledDescription(assembly.title, part.description),
        sourceAssembly: assembly.otherPartNumber,
      }))) || [];
    const inputs: SteelCostInputs = {
      fileName: resultFileName,
      catalogNumber: designPacketResult?.header.catalogNumber || windingResult?.catalogNumber || "Catalog number not found",
      capturedAt: new Date().toISOString(),
      steelGrade: windingResult?.steelGrade || "",
      steelWeightLbs: windingResult?.steelWeight || 0,
      parts: steelParts,
    };
    window.sessionStorage.setItem(COST_ANALYSIS_STORAGE_KEY, JSON.stringify(inputs));
    window.location.assign("/cost-analysis");
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
              <form onSubmit={unlockSite}><label htmlFor="site-password">Password</label><div className="access-form-row"><input id="site-password" type="password" autoComplete="current-password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} /><button type="submit" disabled={unlocking || !accessPassword}>{unlocking ? "Checking..." : "Unlock reader"}</button></div>{accessError && <p className="access-error" role="alert">{accessError}</p>}</form>
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
          <p>Upload a winding sheet or a complete design packet. One classifier routes packet and winding fields into separate, reviewable results.</p>
          <div className="trust-row"><span>PDF &amp; image files</span><span>Human review built in</span><span>Single-pass Azure routing</span></div>
        </div>

        <div className="reader-column">
          <div className="reader-card">
            <div className="reader-card-head"><div><span className="step-label">STEP 01</span><h2>Add an engineering document</h2></div><span className="secure-chip">Private</span></div>
            <button className="drop-zone" type="button" onClick={() => inputRef.current?.click()} onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
              <span className="upload-orb" aria-hidden="true">{selectedFile || resultFileName ? "✓" : "↑"}</span><strong>{selectedFile?.name || resultFileName || "Drop your file here"}</strong>
              <span>{selectedFile ? "Ready for DesignPacketClassifier" : resultFileName ? "Results retained · choose a new file only when you want to replace them" : "or click to browse · PDF, PNG, JPG, TIFF"}</span>
            </button>
            <input ref={inputRef} className="sr-only" type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" onChange={(event) => selectFile(event.target.files?.[0])} />
            <button className="analyze-button" type="button" disabled={!selectedFile || isBusy} onClick={analyze}><span>{buttonLabel}</span><span aria-hidden="true">{isBusy ? "···" : "→"}</span></button>
            <div className={`analysis-state status-${phase}`} role="status" aria-live="polite"><i aria-hidden="true" /><strong>{phaseLabel}</strong></div>
            <p className={analysisError ? "reader-note reader-error" : "reader-note"}>{readerMessage}</p>
          </div>
          {visibleResult && (
            <button className="cost-analysis-launch" type="button" onClick={openCostAnalysis}>
              <span><small>NEXT STEP</small><strong>Open steel cost analysis</strong></span>
              <span aria-hidden="true">→</span>
            </button>
          )}
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
