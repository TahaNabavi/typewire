import { NextResponse } from "next/server";

import { withDb } from "@/lib/db";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

/**
 * Feedback submissions.
 *
 * The form still offers the prefilled GitHub issue — that is the public,
 * traceable path. This stores the same submission so it survives someone
 * closing the tab before pressing submit on GitHub.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";

  // Three submissions per hour per IP.
  if (redis.configured) {
    const key = `fb:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
    const count = await redis.incr(key);
    await redis.exec(["EXPIRE", key, 3600]);
    if ((count ?? 0) > 3) {
      return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
    }
  }

  let body: { package?: unknown; reaction?: unknown; message?: unknown; handle?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (message.length < 3) {
    return NextResponse.json({ error: "Tell us a little more." }, { status: 400 });
  }

  const pkg = typeof body.package === "string" ? body.package.slice(0, 120) : null;
  const reaction = typeof body.reaction === "string" ? body.reaction.slice(0, 40) : null;
  const handle = typeof body.handle === "string" ? body.handle.slice(0, 80) : null;

  const stored = await withDb(async (db) => {
    await db.feedback.create({
      data: { package: pkg, reaction, message, handle },
    });
    return true;
  }, false);

  return NextResponse.json({ ok: true, stored });
}
