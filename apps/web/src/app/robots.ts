import type { MetadataRoute } from "next";

import { site } from "@/config/site";
import { absoluteUrl } from "@/lib/seo";

/**
 * Only /api is kept out of the index. Nothing under it is a page: they are JSON
 * handlers, a streaming answer endpoint and a cron target. A crawler that
 * indexes them spends its budget on responses no reader will ever land on.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: site.url,
  };
}
