import { NextResponse } from "next/server";

import { ADMIN_COOKIE, adminConfigured, checkPassword, cookieOptions, createSession } from "@/features/admin/auth";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

/** Crude but sufficient: five attempts per IP per 15 minutes. */
async function rateLimited(ip: string): Promise<boolean> {
  if (!redis.configured) return false;
  const key = `login:${ip}:${Math.floor(Date.now() / 900_000)}`;
  const attempts = await redis.incr(key);
  await redis.exec(["EXPIRE", key, 900]);
  return (attempts ?? 0) > 5;
}

export async function POST(request: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD and ADMIN_SECRET are not set on this deployment." },
      { status: 503 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  if (await rateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/admin");

  if (!(await checkPassword(password))) {
    const url = new URL("/admin/login", request.url);
    url.searchParams.set("error", "1");
    return NextResponse.redirect(url, { status: 303 });
  }

  const session = await createSession();
  if (!session) {
    return NextResponse.json({ error: "ADMIN_SECRET is not set." }, { status: 503 });
  }

  const response = NextResponse.redirect(
    new URL(next.startsWith("/admin") ? next : "/admin", request.url),
    { status: 303 },
  );
  response.cookies.set(ADMIN_COOKIE, session, cookieOptions);
  return response;
}

/** Sign out. */
export async function DELETE(request: Request) {
  const response = NextResponse.redirect(new URL("/admin/login", request.url), { status: 303 });
  response.cookies.set(ADMIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
