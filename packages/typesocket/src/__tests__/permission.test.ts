import { io as mockIo } from "socket.io-client";
import { z } from "zod";

import { SocketClient } from "../client";
import { defineSocketContracts } from "../contract";
import {
  createPermissionMiddleware,
  PermissionDeniedError,
  type PermissionDecisionLike,
} from "../permission";
import type { ClientToServerDef, PermissionRequirement } from "../types";

jest.mock("socket.io-client");

/** Structural stand-in for `P.authorize`; `held` is the actor's flag set. */
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

function def(permission?: PermissionRequirement): ClientToServerDef {
  return {
    direction: "client->server",
    permission,
    request: z.object({}),
  } as ClientToServerDef;
}

describe("createPermissionMiddleware (typesocket) — the authorizer", () => {
  const frame = (permission?: PermissionRequirement) => ({
    eventId: "chat.deleteMessage",
    event: "chat.deleteMessage",
    def: def(permission),
    payload: {},
  });

  it("allows an event with no permission key", () => {
    const auth = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
    });
    expect(() => auth(frame(undefined))).not.toThrow();
  });

  it("allows when the actor holds the flags", () => {
    const auth = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize(["chat.MANAGE_MESSAGES"]),
    });
    expect(() => auth(frame({ require: ["chat.MANAGE_MESSAGES"] }))).not.toThrow();
  });

  it("throws PermissionDeniedError with the missing flags", () => {
    const onDeny = jest.fn();
    const auth = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
      onDeny,
    });
    let thrown: PermissionDeniedError | undefined;
    try {
      auth(frame({ require: ["chat.MANAGE_MESSAGES"], reason: "mods only" }));
    } catch (e) {
      thrown = e as PermissionDeniedError;
    }
    expect(thrown).toBeInstanceOf(PermissionDeniedError);
    expect(thrown!.code).toBe("PERMISSION_DENIED");
    expect(thrown!.message).toBe("mods only");
    expect(thrown!.missing).toEqual(["chat.MANAGE_MESSAGES"]);
    expect(thrown!.eventId).toBe("chat.deleteMessage");
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("reports missingAny when an `any` requirement fails", () => {
    const auth = createPermissionMiddleware({
      getPermissions: () => 0n,
      authorize: fakeAuthorize([]),
    });
    expect(() => auth(frame({ any: ["a.x", "a.y"] }))).toThrow(PermissionDeniedError);
  });
});

/* ============================================================================
 * Client wiring — the guard actually blocks an emit
 * ========================================================================== */

function createMockSocket() {
  const listeners = new Map<string, Array<(...a: any[]) => void>>();
  const sent: Array<{ event: string; payload: unknown }> = [];
  const socket: any = {
    connected: true,
    id: "mock",
    on(event: string, h: (...a: any[]) => void) {
      (listeners.get(event) ?? listeners.set(event, []).get(event)!).push(h);
      return socket;
    },
    off: () => socket,
    removeAllListeners: () => (listeners.clear(), socket),
    emit(event: string, payload: unknown) {
      sent.push({ event, payload });
      return socket;
    },
    connect: () => ((socket.connected = true), socket),
    disconnect: () => ((socket.connected = false), socket),
    get volatile() {
      return socket;
    },
    sent,
  };
  return socket;
}

const contracts = defineSocketContracts({
  chat: {
    deleteMessage: {
      direction: "client->server",
      permission: { require: ["chat.MANAGE_MESSAGES"] },
      request: z.object({ id: z.string() }),
      ack: z.object({ ok: z.boolean() }),
    },
    ban: {
      direction: "client->server",
      permission: { require: ["guild.KICK"] },
      request: z.object({ userId: z.string() }),
    },
    send: {
      direction: "client->server",
      request: z.object({ text: z.string() }),
    },
  },
});

describe("permission guard wired into the client", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let held: string[];

  const makeClient = () =>
    new SocketClient({ url: "http://x", onValidationError: () => {} }, contracts, {
      authorizeOutbound: createPermissionMiddleware({
        getPermissions: () => 0n,
        authorize: fakeAuthorize(held),
      }),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    held = [];
    socket = createMockSocket();
    (mockIo as unknown as jest.Mock).mockReturnValue(socket);
  });

  it("throws synchronously on a denied fire-and-forget emit, nothing sent", () => {
    const client = makeClient();
    client.connect();
    expect(() => client.modules.chat.ban({ userId: "u1" })).toThrow(
      PermissionDeniedError,
    );
    expect(socket.sent).toHaveLength(0);
  });

  it("rejects a denied ack emit, nothing sent", async () => {
    const client = makeClient();
    client.connect();
    await expect(
      client.modules.chat.deleteMessage({ id: "m1" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(socket.sent).toHaveLength(0);
  });

  it("lets the frame through once the actor holds the flag", () => {
    held = ["chat.MANAGE_MESSAGES", "guild.KICK"];
    const client = makeClient();
    client.connect();
    expect(() => client.modules.chat.ban({ userId: "u1" })).not.toThrow();
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]!.event).toBe("chat.ban");
  });

  it("never blocks an event with no permission key", () => {
    const client = makeClient();
    client.connect();
    expect(() => client.modules.chat.send({ text: "hi" })).not.toThrow();
    expect(socket.sent).toHaveLength(1);
  });
});
