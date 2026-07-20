import "reflect-metadata";
import { Controller, INestApplication, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Contracts } from "@tahanabavi/typefetch";
import request from "supertest";
import { z } from "zod";
import {
  ContractInput,
  InferRequest,
  InferResponse,
  TypeFetchEndpoint,
} from "../index";

const contracts = {
  media: {
    uploadAvatar: {
      method: "POST",
      path: "/users/:id/avatar",
      bodyType: "form-data",
      request: z.object({
        path: z.object({ id: z.string() }),
        body: z.object({
          // z.instanceof(File) in a browser contract; on Node we just need a
          // file field — the value is passed through, not instanceof-checked
          file: z.instanceof(Uint8Array),
          caption: z.string().optional(),
          priority: z.number().int(),
        }),
      }),
      response: z.object({
        id: z.string(),
        filename: z.string(),
        size: z.number(),
        priority: z.number(),
        caption: z.string().optional(),
      }),
    },
  },
} as const satisfies Contracts;

type UploadAvatar = typeof contracts.media.uploadAvatar;

@Controller()
class MediaController {
  // AnyFilesInterceptor is placed closest to the method so multipart is
  // parsed before the contract interceptor validates.
  @TypeFetchEndpoint(contracts.media.uploadAvatar)
  @UseInterceptors(AnyFilesInterceptor())
  upload(
    @ContractInput() input: InferRequest<UploadAvatar>,
  ): InferResponse<UploadAvatar> {
    // the file field is the Multer file object, passed through by validation
    const file = input.body.file as unknown as {
      originalname: string;
      size: number;
    };
    return {
      id: input.path.id,
      filename: file.originalname,
      size: file.size,
      priority: input.body.priority,
      caption: input.body.caption,
    };
  }
}

describe("form-data upload (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it("validates the multipart body: file passed through, text fields coerced", async () => {
    const res = await http()
      .post("/users/42/avatar")
      .field("caption", "my avatar")
      .field("priority", "3") // string on the wire -> coerced to number
      .attach("file", Buffer.from("fake-image-bytes"), "avatar.png")
      .expect(201);

    expect(res.body).toEqual({
      id: "42",
      filename: "avatar.png",
      size: Buffer.from("fake-image-bytes").length,
      priority: 3,
      caption: "my avatar",
    });
  });

  it("rejects a missing required file with a field error", async () => {
    const res = await http()
      .post("/users/42/avatar")
      .field("priority", "3")
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.errors["body.file"]).toEqual(["Expected an uploaded file"]);
  });

  it("rejects an invalid coerced text field", async () => {
    const res = await http()
      .post("/users/42/avatar")
      .field("priority", "not-a-number")
      .attach("file", Buffer.from("x"), "a.png")
      .expect(400);

    expect(res.body.errors["body.priority"]).toBeDefined();
  });
});
