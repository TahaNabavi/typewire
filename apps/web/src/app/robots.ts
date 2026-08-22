import type { MetadataRoute } from "next";

import { site } from "@/config/site";
import { absoluteUrl } from "@/lib/seo";

/**
 * Two things are kept out of the index, for two different reasons.
 *
 * /admin is private — the proxy already redirects an unauthenticated request,
 * and vercel.json sends `X-Robots-Tag: noindex` besides, so this is the third
 * of three fences rather than the only one.
 *
 * /api is not private, but nothing under it is a page: they are JSON handlers,
 * a streaming answer endpoint and a cron target. A crawler that indexes them
 * spends its budget on responses no reader will ever land on.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: site.url,
  };
}
