import type { NextRequest } from "next/server";

export const SITE_ACCESS_COOKIE = "winding_intelligence_access";
export const SITE_ACCESS_MAX_AGE = 8 * 60 * 60;

const SESSION_MESSAGE = "winding-intelligence-access-v1";
const encoder = new TextEncoder();
const configuredPassword = () => process.env.WINDING_SITE_ACCESS_PASSWORD?.trim() ?? "";

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function constantTimeEqual(left: string, right: string) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function accessToken(password: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(SESSION_MESSAGE)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isSiteAccessConfigured() {
  return Boolean(configuredPassword());
}

export async function matchesSitePassword(candidate: string) {
  const password = configuredPassword();
  return Boolean(password) && constantTimeEqual(candidate, password);
}

export async function hasSiteAccess(request: NextRequest) {
  const password = configuredPassword();
  const cookie = request.cookies.get(SITE_ACCESS_COOKIE)?.value ?? "";
  return Boolean(password) && Boolean(cookie) && constantTimeEqual(cookie, await accessToken(password));
}

export async function createSiteAccessToken() {
  const password = configuredPassword();
  return password ? accessToken(password) : "";
}
