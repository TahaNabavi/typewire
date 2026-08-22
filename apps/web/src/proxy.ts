import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE, verifySession } from "@/features/admin/auth";

/**
 * Everything under /admin requires a session. The check runs here so an
 * unauthenticated request never reaches a page that would query the database.
 *
 * This is Next 16's `proxy` convention — the former `middleware.ts`, renamed.
 */
export async function proxy(request: NextRequest) {
  const authenticated = await verifySession(request.cookies.get(ADMIN_COOKIE)?.value);
  if (authenticated) return NextResponse.next();

  const login = new URL("/admin/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin", "/admin/((?!login).*)"],
};
