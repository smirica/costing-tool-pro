import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ error: "yfinance is configured for localhost. A hosted Python service is required for deployed quotes." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

