import "reflect-metadata";
import { Controller, Get, INestApplication, Post } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { definePermissions } from "@tahanabavi/type-permission";
import { z } from "zod";
import request from "supertest";
import {
  ContractInput,
  createPermissionGuard,
  InferRequest,
  InferResponse,
  RequirePermission,
  TypeFetchEndpoint,
} from "../index";

// The shared bit map — in a real app this is the file both ends import.
const P = definePermissions({
  chat: {
    VIEW_CHANNEL: { bit: 0 },
    SEND_MESSAGES: { bit: 1, requires: ["chat.VIEW_CHANNEL"] },
    MANAGE_MESSAGES: { bit: 2, implies: ["chat.SEND_MESSAGES"] },
  },
});

// The contract — the `permission` key is written once, right here.
const contracts = {
  message: {
    list: {
      method: "GET",
      path: "/messages",
      // No permission key → the guard must never block this route.
      request: z.object({}),
      response: z.object({ ok: z.boolean() }),
    },
    remove: {
      method: "DELETE",
      path: "/messages/:id",
      permission: { require: ["chat.MANAGE_MESSAGES"], reason: "mods only" },
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ removed: z.string() }),
    },
  },
} as const;

@Controller()
class MessageController {
  @TypeFetchEndpoint(contracts.message.list)
  list(): InferResponse<typeof contracts.message.list> {
    return { ok: true };
  }

  @TypeFetchEndpoint(contracts.message.remove)
  remove(
    @ContractInput() input: InferRequest<typeof contracts.message.remove>,
  ): InferResponse<typeof contracts.message.remove> {
    return { removed: input.path.id };
  }

  // A plain route with no contract, guarded via the decorator instead.
  @Post("purge")
  @RequirePermission({ require: ["chat.MANAGE_MESSAGES"] })
  purge(): { purged: boolean } {
    return { purged: true };
  }
}

/** Read the actor's bits from a header the test sets; absent → no permissions. */
const PERMS_HEADER = "x-perms";
const denials: string[][] = [];

describe("createPermissionGuard (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const PermissionGuard = createPermissionGuard({
      getPermissions: (req) => {
        const raw = req.headers[PERMS_HEADER];
        return typeof raw === "string" && raw.length
          ? P.decode(raw, "decimal")
          : 0n;
      },
      authorize: P.authorize, // passed straight through — proves the types compose
      onDeny: ({ decision }) => denials.push(decision.missing ?? []),
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const withPerms = (names: Parameters<typeof P.from>[0]) =>
    P.encode(P.from(names), "decimal");

  it("allows a route with no permission key regardless of perms", async () => {
    await request(app.getHttpServer()).get("/messages").expect(200, { ok: true });
  });

  it("rejects when the actor lacks the required flag", async () => {
    const res = await request(app.getHttpServer())
      .delete("/messages/42")
      .expect(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(res.body.message).toBe("mods only"); // the requirement's reason
    expect(res.body.missing).toEqual(["chat.MANAGE_MESSAGES"]);
  });

  it("allows when the actor holds the required flag", async () => {
    await request(app.getHttpServer())
      .delete("/messages/42")
      .set(PERMS_HEADER, withPerms(["chat.MANAGE_MESSAGES"]))
      .expect(200, { removed: "42" });
  });

  it("rejects a partial holder (has SEND but not MANAGE)", async () => {
    await request(app.getHttpServer())
      .delete("/messages/42")
      .set(PERMS_HEADER, withPerms(["chat.VIEW_CHANNEL", "chat.SEND_MESSAGES"]))
      .expect(403);
  });

  it("enforces @RequirePermission on a contract-less route", async () => {
    await request(app.getHttpServer()).post("/purge").expect(403);
    await request(app.getHttpServer())
      .post("/purge")
      .set(PERMS_HEADER, withPerms(["chat.MANAGE_MESSAGES"]))
      .expect(201, { purged: true });
  });

  it("invoked the onDeny audit hook on each denial", () => {
    expect(denials.length).toBeGreaterThan(0);
    expect(denials).toContainEqual(["chat.MANAGE_MESSAGES"]);
  });
});
