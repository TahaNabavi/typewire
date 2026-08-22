/**
 * Every internal path the site links to, in one place.
 *
 * The nav, the footer, the sitemap and the breadcrumb builders all read from
 * here, so a route that moves is renamed once rather than hunted for in string
 * literals. Dynamic segments are functions so the caller cannot forget to
 * encode one.
 */
export const PATHS = {
  ROOT: "/",
  DOCS: "/docs",
  DOCS_PACKAGE: (slug: string) => `/docs/${slug}`,
  DOCS_PAGE: (slug: string, page: string) => `/docs/${slug}/${page}`,
  PACKAGES: "/packages",
  PACKAGE: (slug: string) => `/packages/${slug}`,
  EXAMPLES: "/examples",
  PLAYGROUND: "/playground",
  ROADMAP: "/roadmap",
  ADMIN: "/admin",
  ADMIN_LOGIN: "/admin/login",
} as const;
