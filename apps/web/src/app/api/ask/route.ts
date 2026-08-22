import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { search, type Hit } from "@/features/docs/corpus";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

/**
 * Ask the docs.
 *
 * Two halves, and only one of them needs a key:
 *
 *   1. Retrieval always runs. It searches the same markdown the docs pages
 *      render, so every answer is anchored to a page a reader can open.
 *   2. Generation runs when ANTHROPIC_API_KEY is set. Without it the route
 *      still answers — it streams the retrieved sections themselves, labelled
 *      as excerpts. That is a worse answer, not a fake one, and it means the
 *      feature ships and works before anyone decides to pay for inference.
 *
 * Both halves stream, and both end in citations, so the client has one code
 * path and the page looks the same either way.
 */

const MODEL = "claude-opus-5";

const SYSTEM = `You answer questions about TypeWire, a family of contract-first TypeScript packages published under the @tahanabavi/* scope.

You will be given excerpts from TypeWire's own documentation. Answer only from those excerpts.

Rules:
- If the excerpts do not contain the answer, say so plainly and name the closest page. Never fill a gap from general knowledge about tRPC, Zod, GraphQL or any other library — a confident wrong answer about this project is worse than no answer.
- Be direct and short: a developer asked a question, not for an essay. Two or three sentences, plus a code block when the answer is a call.
- Use the project's own names exactly as the excerpts spell them (typefetch, typesocket, query-core, ErrorKind, contracts).
- Do not invent package names, options, or version numbers.
- Do not add a sources list; the page renders citations from the excerpts it gave you.`;

function contextFrom(hits: Hit[]): string {
  return hits
    .map(
      (hit, i) =>
        `<excerpt index="${i + 1}" package="${hit.packageName}" page="${hit.pageTitle}" heading="${hit.heading}">\n${hit.text}\n</excerpt>`,
    )
    .join("\n\n");
}

/** What the client needs to render a citation chip. */
function citationsFrom(hits: Hit[]) {
  return hits.map((hit) => ({
    label: `${hit.packageName} · ${hit.heading}`,
    href: hit.href,
  }));
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";

  // Twenty questions an hour per IP. Generation costs money; retrieval costs
  // CPU. Both are worth a ceiling.
  if (redis.configured) {
    const key = `ask:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
    const count = await redis.incr(key);
    await redis.exec(["EXPIRE", key, 3600]);
    if ((count ?? 0) > 20) {
      return NextResponse.json(
        { error: "That is a lot of questions in one hour. Try again shortly." },
        { status: 429 },
      );
    }
  }

  let body: { question?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (question.length < 3) {
    return NextResponse.json({ error: "Ask a longer question." }, { status: 400 });
  }

  const hits = search(question, 5);
  const citations = citationsFrom(hits);

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, event: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  // Nothing matched. Say that rather than asking a model to invent something.
  if (hits.length === 0) {
    const stream = new ReadableStream({
      start(controller) {
        send(controller, {
          type: "text",
          text: "Nothing in the docs matches that. Try naming a package (typefetch, typesocket, query-core) or a concept from the pages — transports, contracts, ErrorKind, middleware.",
        });
        send(controller, { type: "done", citations: [], mode: "empty" });
        controller.close();
      },
    });
    return sse(stream);
  }

  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    // Extractive fallback: the best-matching section, verbatim.
    const best = hits[0]!;
    const excerpt = best.text.length > 700 ? `${best.text.slice(0, 700)}…` : best.text;
    const stream = new ReadableStream({
      start(controller) {
        send(controller, {
          type: "text",
          text: `From ${best.packageName} › ${best.heading}:\n\n${excerpt}`,
        });
        send(controller, { type: "done", citations, mode: "excerpt" });
        controller.close();
      },
    });
    return sse(stream);
  }

  const client = new Anthropic({ apiKey: key });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const message = client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM,
          // Effort is deliberately low: this is retrieval-grounded Q&A over a
          // handful of excerpts, not a reasoning problem, and a docs box that
          // takes ten seconds to start is a docs box nobody uses.
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content: `${contextFrom(hits)}\n\nQuestion: ${question}`,
            },
          ],
        });

        for await (const event of message) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send(controller, { type: "text", text: event.delta.text });
          }
        }

        const final = await message.finalMessage();
        if (final.stop_reason === "refusal") {
          send(controller, {
            type: "text",
            text: "\n\nI could not answer that one. The cited pages below are the closest match.",
          });
        }
        send(controller, { type: "done", citations, mode: "generated" });
      } catch (error) {
        // A failed model call must not lose the retrieval work, which is the
        // part that was actually grounded.
        const best = hits[0]!;
        send(controller, {
          type: "text",
          text: `The assistant is unavailable right now. The closest page is ${best.packageName} › ${best.heading}:\n\n${best.text.slice(0, 500)}…`,
        });
        send(controller, { type: "done", citations, mode: "excerpt" });
        if (process.env.NODE_ENV !== "production") console.error("ask:", error);
      } finally {
        controller.close();
      }
    },
  });

  return sse(stream);
}

function sse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Vercel and nginx both buffer streamed responses without this.
      "X-Accel-Buffering": "no",
    },
  });
}
