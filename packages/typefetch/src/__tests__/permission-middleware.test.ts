import {
  createPermissionMiddleware,
  PermissionDeniedError,
  type PermissionDecisionLike,
} from "../middlewares/permission";
import type { MiddlewareContext, PermissionRequirement } from "../types";

/**
 * A stand-in for `P.authorize` — the same structural shape, so these tests never
 * import `@tahanabavi/type-permission` (the point of the dependency boundary).
 * `held` is the set of flags the actor has.
 */
function fakeAuthorize(held: string[]) {
  const set = new Set(held);
  return (_perms: bigint, req: PermissionRequirement): PermissionDecisionLike => {
    const missing = (req.require ?? []).filter((f) => !set.has(f));
    const anyOk = !req.any?.length || req.any.some((f) => set.has(f));
    return {
      granted: missing.length === 0 && anyOk,
      missing,
      ...(anyOk ? {} : { missingAny: [...req.any!] }),
    };
  };
}

function makeCtx(permission?: PermissionRequirement): MiddlewareContext {
  return {
    url: "http://api.test/messages/1",
    init: { method: "DELETE" },
    endpoint: {
      method: "DELETE",
      path: "/messages/:id",
      permission,
      request: {} as never,
      response: {} as never,
    },
  } as MiddlewareContext;
}

const RESPONSE = { ok: true } as unknown as Response;

describe("createPermissionMiddleware (typefetch)", () => {
  it("passes through an endpoint with no permission key", async () => {
    const next = jest.fn(async () => RESPONSE);
    const mw = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
    });
    await expect(mw(makeCtx(undefined), next, undefined)).resolves.toBe(RESPONSE);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("passes through an empty requirement (no require, no any)", async () => {
    const next = jest.fn(async () => RESPONSE);
    const mw = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
    });
    await expect(mw(makeCtx({}), next, undefined)).resolves.toBe(RESPONSE);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next when the actor holds the required flags", async () => {
    const next = jest.fn(async () => RESPONSE);
    const mw = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize(["chat.MANAGE_MESSAGES"]),
    });
    const ctx = makeCtx({ require: ["chat.MANAGE_MESSAGES"] });
    await expect(mw(ctx, next, undefined)).resolves.toBe(RESPONSE);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("throws PermissionDeniedError and never calls next when denied", async () => {
    const next = jest.fn(async () => RESPONSE);
    const mw = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
    });
    const ctx = makeCtx({ require: ["chat.MANAGE_MESSAGES"], reason: "mods only" });

    const err = await mw(ctx, next, undefined).catch((e) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("PERMISSION_DENIED");
    expect(err.message).toBe("mods only");
    expect(err.missing).toEqual(["chat.MANAGE_MESSAGES"]);
    expect(err.method).toBe("DELETE");
    expect(err.path).toBe("/messages/:id");
    expect(next).not.toHaveBeenCalled();
  });

  it("reports missingAny when an `any` requirement fails", async () => {
    const next = jest.fn(async () => RESPONSE);
    const mw = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
    });
    const ctx = makeCtx({ any: ["post.publish", "post.moderate"] });

    const err = await mw(ctx, next, undefined).catch((e) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect(err.missingAny).toEqual(["post.publish", "post.moderate"]);
  });

  it("invokes onDeny before throwing", async () => {
    const onDeny = jest.fn();
    const mw = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
      onDeny,
    });
    await mw(makeCtx({ require: ["x.y"] }), async () => RESPONSE, undefined).catch(
      () => undefined,
    );
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onDeny.mock.calls[0][0]).toMatchObject({
      method: "DELETE",
      decision: { granted: false, missing: ["x.y"] },
    });
  });

  it("awaits an async getPermissions", async () => {
    const next = jest.fn(async () => RESPONSE);
    const mw = createPermissionMiddleware({
      getPermissions: async () => 0n,
      authorize: fakeAuthorize(["a.b"]),
    });
    await expect(
      mw(makeCtx({ require: ["a.b"] }), next, undefined),
    ).resolves.toBe(RESPONSE);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
