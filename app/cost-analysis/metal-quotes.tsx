"use client";
import { useEffect, useState } from "react";
import type { Quotes } from "./current-cost";
const usd = (v: number) => v.toLocaleString(undefined, {style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:4});
export function MetalQuotes({ dates = "", onData, hidden = false }: { dates?: string; onData?: (data: Quotes | null) => void; hidden?: boolean }) {
  const [result,setResult] = useState<{key:string;data:Quotes} | null>(null);
  const [error,setError] = useState("");
  const [reload,setReload] = useState(0);
  const [finished,setFinished] = useState("");
  const key = dates + ":" + reload;
  const loading = finished !== key;
  const data = result?.key === key ? result.data : null;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/metal-quotes?dates="+encodeURIComponent(dates),{cache:"no-store",signal:controller.signal})
      .then(async response => {
        const body = await response.json();
        if(!response.ok) throw new Error(body.error || "Market prices unavailable.");
        if(!controller.signal.aborted){setResult({key,data:body});setError("");onData?.(body);}
      })
      .catch(reason => {if(!controller.signal.aborted){setError(reason instanceof Error ? reason.message : "Market prices unavailable.");onData?.(null);}})
      .finally(() => {if(!controller.signal.aborted)setFinished(key);});
    return () => controller.abort();
  },[dates,key,onData]);
  if (hidden) return null;
  return <section className="commodity-strip" aria-label="Current commodity prices">
    <div className="commodity-strip-title"><strong>Market prices</strong><small>Yahoo Finance via yfinance</small></div>
    <div className="commodity-strip-quotes" aria-live="polite">{data ? data.quotes.map(q =>
      <div key={q.id}><span>{q.label} <b>{q.symbol}</b></span><strong>{q.pricePerLb != null && q.status === "available" ? usd(q.pricePerLb)+" / lb" : "Unavailable"}</strong>
        <small>{q.quotedAt ? new Date(q.quotedAt).toLocaleString() : q.error}</small></div>
    ) : <p>{loading ? "Fetching latest prices…" : error}</p>}</div>
    <div className="commodity-strip-action"><button type="button" disabled={loading} onClick={() => {onData?.(null);setReload(v => v+1);}}>{loading ? "Loading…" : "Reload prices"}</button><small>Quotes may be delayed</small></div>
  </section>;
}

