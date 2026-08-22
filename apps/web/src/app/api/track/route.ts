import { NextResponse } from "next/server";

import { deviceFrom, recordPageview, referrerHost, visitorHash } from "@/features/analytics/analytics";

export const runtime = "nodejs";

/**
 * Pageview ingest.
 *
 * Called by the beacon on every route change. The client sends only the path —
 * everything else (country, IP for hashing, user agent) comes from request
 * headers, so a forged body cannot inflate anything but its own path counter.
 */
export async function POST(request: Request) {
  const headers = request.headers;
  const userAgent = headers.get("user-agent") ?? "";
  const device = deviceFrom(userAgent);

  // Bots get counted nowhere. The panel exists to show people, not crawlers.
  if (device === "bot") return NextResponse.json({ ok: true, skipped: "bot" });

  let path = "/";
  try {
    const body = (await request.json()) as { path?: unknown };
    if (typeof body.path === "string" && body.path.startsWith("/")) {
      path = body.path.slice(0, 512);
    }
  } catch {
    /* an unparseable body still counts as a view of "/" */
  }

  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "0.0.0.0";

  const host = headers.get("host") ?? "";

  await recordPageview({
    path,
    referrer: referrerHost(headers.get("referer"), host),
    // Vercel resolves geo at the edge and forwards it as a header.
    country: headers.get("x-vercel-ip-country") ?? "??",
    device,
    visitor: await visitorHash(ip, userAgent),
  });

  return NextResponse.json({ ok: true });
}
