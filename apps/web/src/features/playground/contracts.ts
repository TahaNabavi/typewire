import { z } from "zod";

/**
 * The playground's contract — and the whole point of the playground.
 *
 * This file is imported by two places that never import each other:
 *
 *   ./console.tsx                          the browser, building a typed client
 *   src/app/api/playground/[...path]/      the server, implementing the routes
 *
 * Neither knows anything about the other. The only thing they share is this
 * object, which is the claim the entire site makes, running rather than
 * described. Change a field name here and both sides move — or fail to compile.
 *
 * It is deliberately small. A reader should be able to hold all of it in their
 * head while watching a request travel through the timeline beside it.
 */

export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["admin", "member"]),
});

export const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({
        path: z.object({ id: z.string().min(1) }),
      }),
      response: User,
      errors: {
        404: z.object({ code: z.literal("not_found"), id: z.string() }),
      },
    },

    listUsers: {
      method: "GET",
      path: "/users",
      request: z.object({
        query: z.object({
          role: z.enum(["admin", "member"]).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(10),
        }),
      }),
      response: z.object({
        items: z.array(User),
        total: z.number(),
      }),
    },

    createUser: {
      method: "POST",
      path: "/users",
      request: z.object({
        body: z.object({
          name: z.string().min(2, "name must be at least 2 characters"),
          email: z.email("must be a valid email address"),
          role: z.enum(["admin", "member"]).default("member"),
        }),
      }),
      response: User,
      errors: {
        409: z.object({ code: z.literal("email_taken"), email: z.string() }),
      },
    },
  },
} as const;

/** The literal source, shown beside the console so the two cannot drift. */
export const CONTRACT_SOURCE = `// src/features/playground/contracts.ts
export const User = z.object({
  id:    z.string(),
  name:  z.string(),
  email: z.string(),
  role:  z.enum(["admin", "member"]),
});

export const contracts = {
  user: {
    getUser: {
      method:   "GET",
      path:     "/users/:id",
      request:  z.object({ path: z.object({ id: z.string().min(1) }) }),
      response: User,
      errors:   { 404: z.object({ code: z.literal("not_found"), id: z.string() }) },
    },

    listUsers: {
      method:   "GET",
      path:     "/users",
      request:  z.object({ query: z.object({
        role:  z.enum(["admin", "member"]).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      }) }),
      response: z.object({ items: z.array(User), total: z.number() }),
    },

    createUser: {
      method:   "POST",
      path:     "/users",
      request:  z.object({ body: z.object({
        name:  z.string().min(2, "name must be at least 2 characters"),
        email: z.email("must be a valid email address"),
        role:  z.enum(["admin", "member"]).default("member"),
      }) }),
      response: User,
      errors:   { 409: z.object({ code: z.literal("email_taken"), email: z.string() }) },
    },
  },
} as const;`;

/** How the server implements the same object. */
export const SERVER_SOURCE = `// src/app/api/playground/[...path]/route.ts
import { contracts } from "@/features/playground/contracts";

// The route validates its own output against the contract's response schema
// before it answers — the server holds itself to the same object the client
// holds it to.
const parsed = contracts.user.getUser.response.safeParse(record);
if (!parsed.success) return badImplementation(parsed.error);
return Response.json(parsed.data);`;
