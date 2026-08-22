/**
 * The environment this deployment was given, read once.
 *
 * Everything here is optional and everything here is public — verification
 * tokens are meta tags, and the site URL is inlined into the client bundle.
 * Secrets (ADMIN_SECRET, DATABASE_URL, API keys) are deliberately absent: they
 * are read at the point of use, on the server, so they can never be reached
 * from a module a client component imports.
 */
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  /** Search Console → add property → "HTML tag" → the content value. */
  GOOGLE_SITE_VERIFICATION: process.env.GOOGLE_SITE_VERIFICATION ?? "",
  BING_SITE_VERIFICATION: process.env.BING_SITE_VERIFICATION ?? "",
} as const;
