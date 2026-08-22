import { NextResponse } from "next/server";

import { ADMIN_COOKIE, cookieOptions } from "@/features/admin/auth";

export const runtime = "nodejs";

/** Sign out. A GET so a plain link can do it — there is nothing to protect. */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/admin/login", request.url), { status: 303 });
  response.cookies.set(ADMIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
