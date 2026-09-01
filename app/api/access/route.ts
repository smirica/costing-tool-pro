import { NextRequest, NextResponse } from "next/server";
import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_MAX_AGE,
  createSiteAccessToken,
  hasSiteAccess,
  isSiteAccessConfigured,
  matchesSitePassword,
} from "../../access";

export const runtime = "edge";

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { authorized: await hasSiteAccess(request), configured: isSiteAccessConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin access is not allowed." }, { status: 403 });
  }
  if (!isSiteAccessConfigured()) {
    return NextResponse.json({ error: "Site access has not been configured yet." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!(await matchesSitePassword(password))) {
    return NextResponse.json({ error: "That password did not match. Ask Stef for the current password." }, { status: 401 });
  }

  const response = NextResponse.json({ authorized: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SITE_ACCESS_COOKIE, await createSiteAccessToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SITE_ACCESS_MAX_AGE,
  });
  return response;
}
