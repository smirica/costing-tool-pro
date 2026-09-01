"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";

const windings = [
  { name: "PRIMARY 1", breakout: "1-2", turns: 46, material: "COPPER", size: "1 - 0.102 × 0.258", type: "Rectangle", each: 6.02351 },
  { name: "SHIELD", breakout: "SH", turns: 1, material: "COPPER", size: "0.005", type: "Foil", each: 0.2039 },
  { name: "SECONDARY 1", breakout: "3-4", turns: 27, material: "COPPER", size: "2 - 0.114 × 0.204", type: "Rectangle", each: 8.33134 },
];

const papers = [
  { name: "0.011 CEQUIN IF", use: "Layer paper / wrap", details: "Primary and secondary insulation" },
  { name: "0.01 NOMEX 410", use: "Shield / tube / wrap", details: "Multiple insulation layers" },
  { name: "0.007 GC155", use: "Outer wrap", details: "Secondary finishing wrap" },
];

const coilCount = 2;
const copper = windings.reduce((sum, row) => sum + row.each, 0) * coilCount;
const steel = 110;
const totalMetal = copper + steel;

type Theme = "light" | "dark";

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
  const [fileName, setFileName] = useState("");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "complete">("idle");
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

  useEffect(() => {
    let active = true;
    fetch("/api/access", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        setAccessState(result.authorized ? "granted" : "locked");
        if (!result.configured) setAccessError("Site access is being configured. Please try again shortly.");
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
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAccessError(result.error || "That password did not work.");
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
    setFileName(file.name);
    setPhase("idle");
  };

  const analyze = () => {
    if (!fileName) return;
    setPhase("analyzing");
    window.setTimeout(() => {
      setPhase("complete");
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 900);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files?.[0]);
  };

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
            Upload one winding sheet. The Reader organizes coil counts, winding
            details, insulation, and material weights into a reviewable record.
          </p>
          <div className="trust-row">
            <span>PDF &amp; image files</span>
            <span>Human review built in</span>
            <span>Azure-ready schema</span>
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
            <span className="upload-orb" aria-hidden="true">{fileName ? "✓" : "↑"}</span>
            <strong>{fileName || "Drop your file here"}</strong>
            <span>{fileName ? "Ready to analyze" : "or click to browse · PDF, PNG, JPG"}</span>
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(event) => selectFile(event.target.files?.[0])}
          />
          <button className="analyze-button" type="button" disabled={!fileName || phase === "analyzing"} onClick={analyze}>
            <span>{phase === "analyzing" ? "Reading document…" : phase === "complete" ? "Analyze again" : "Analyze winding sheet"}</span>
            <span aria-hidden="true">{phase === "analyzing" ? "···" : "→"}</span>
          </button>
          <p className="reader-note">Connection-ready prototype. The displayed extraction is seeded from the supplied sample until the Azure Reader endpoint is connected.</p>
        </div>
      </section>

      <section className="result-preview" ref={resultsRef} aria-label="Extraction result">
        <div className="preview-heading">
          <div>
            <span className="eyebrow">{phase === "complete" ? "EXTRACTION COMPLETE" : "SUPPLIED SAMPLE RESULT"}</span>
            <h2>21-1001L-U-1</h2>
            <p>1PH · 10 kVA · 60 Hz · 208V to 120V</p>
          </div>
          <span className="confidence"><i /> 92% high confidence</span>
        </div>

        <div className="description-band">
          <span>ITEM DESCRIPTION</span>
          <strong>1PH 10KVA 60 Hz 208V to 120V HOSPITAL ISOLATION TRANSFORMER</strong>
        </div>

        <div className="metric-grid">
          <article><span>Coils / transformer</span><strong>{coilCount}</strong><small>Transformer-level count</small></article>
          <article><span>Windings counted</span><strong>{windings.length}</strong><small>Primary, shield, secondary</small></article>
          <article><span>Total metal weight</span><strong>{totalMetal.toFixed(1)} <b>lb</b></strong><small>Copper + core steel</small></article>
        </div>

        <div className="section-head">
          <div><span className="section-number">01</span><h3>Winding breakdown</h3></div>
          <span className="quiet-pill">3 rows detected</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Winding</th><th>Break out</th><th>Turns</th><th>Wire material</th><th>Wire no. / size</th><th>Conductor</th><th>Weight / coil</th><th>Total weight</th></tr></thead>
            <tbody>
              {windings.map((row) => (
                <tr key={row.name}>
                  <td><strong>{row.name}</strong></td><td>{row.breakout}</td><td>{row.turns}</td>
                  <td><span className="material-label copper-label">{row.material}</span></td>
                  <td>{row.size}</td><td>{row.type}</td><td>{row.each.toFixed(3)} lb</td><td><strong>{(row.each * coilCount).toFixed(3)} lb</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="section-head">
          <div><span className="section-number">02</span><h3>Material weight</h3></div>
          <span className="quiet-pill">Costing basis</span>
        </div>
        <div className="material-grid">
          <article><span className="weight-icon copper-bg">Cu</span><p><small>Copper</small><strong>{copper.toFixed(2)} lb</strong><em>14.56 lb × 2 coils</em></p></article>
          <article><span className="weight-icon aluminum-bg">Al</span><p><small>Aluminum</small><strong>0.00 lb</strong><em>No aluminum detected</em></p></article>
          <article><span className="weight-icon steel-bg">Fe</span><p><small>Core steel</small><strong>{steel.toFixed(2)} lb</strong><em>M12 lamination steel</em></p></article>
          <article className="total-card"><span>Total</span><strong>{totalMetal.toFixed(2)} lb</strong><em>Metal weight for one transformer</em></article>
        </div>

        <div className="two-column">
          <section className="sub-card">
            <div className="section-head compact"><div><span className="section-number">03</span><h3>Papers &amp; tapes</h3></div><span className="quiet-pill">{papers.length} types</span></div>
            <div className="paper-list">
              {papers.map((paper) => <div key={paper.name}><span className="paper-index">0{papers.indexOf(paper) + 1}</span><p><strong>{paper.name}</strong><small>{paper.use} · {paper.details}</small></p></div>)}
            </div>
          </section>
          <section className="sub-card">
            <div className="section-head compact"><div><span className="section-number">04</span><h3>Core &amp; construction</h3></div><span className="quiet-pill verified">Verified</span></div>
            <dl className="spec-list">
              <div><dt>Steel grade</dt><dd>M12</dd></div><div><dt>Steel weight</dt><dd>110.00 lb</dd></div>
              <div><dt>Lamination thickness</dt><dd>0.014 in</dd></div><div><dt>Stack</dt><dd>2.75 in</dd></div>
              <div><dt>Coil length</dt><dd>7.875 in</dd></div><div><dt>Winding length</dt><dd>7.125 in</dd></div>
            </dl>
          </section>
        </div>

        <div className="review-bar">
          <div><span className="review-icon">✓</span><p><strong>Ready for engineering review</strong><small>Transformer coil count is applied once; repeated page values are not double-counted.</small></p></div>
          <button type="button" onClick={() => window.print()}>Print result</button>
        </div>
      </section>

      <footer><span>Winding Intelligence</span><span>Designed for faster, reviewable transformer costing</span></footer>
    </main>
  );
}
