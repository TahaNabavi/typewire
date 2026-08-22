"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Sends one pageview per route change. No cookie, no identifier, no consent
 * banner owed — see lib/analytics.ts for how a visitor is counted without
 * being identified.
 *
 * `sendBeacon` where available so a view still lands when the tab is closing.
 */
export function AnalyticsBeacon() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;

    // The panel is mine, not an audience — do not count my own visits.
    if (pathname.startsWith("/admin")) return;

    const body = JSON.stringify({ path: pathname });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
        return;
      }
    } catch {
      /* fall through to fetch */
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
