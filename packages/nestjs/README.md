# @tahanabavi/typewire-nestjs

NestJS integration for [`@tahanabavi/typefetch`](https://www.npmjs.com/package/@tahanabavi/typefetch) — bind routes and validate **request input** and **response output** on the backend using the **exact same Zod contracts** your frontend consumes.

One contract file. The typefetch client validates on the way out; typewire-nestjs validates on the way in — and guarantees your handlers return exactly what the contract promises.

```
        frontend                      shared contract                     backend
┌──────────────────────┐        ┌─────────────────────────┐        ┌──────────────────────┐
│  ApiClient(contracts)│ ─────▶ │ { method, path,         │ ◀───── │ @TypeFetchEndpoint(  │
│  api.user.getUser()  │        │   request:  z.object,   │        │   contracts.user.    │
│  ✓ input validated   │        │   response: z.object }  │        │   getUser)           │
│  ✓ output validated  │        └─────────────────────────┘        │  ✓ route from path   │
└──────────────────────┘                                           │  ✓ input validated   │
                                                                   │  ✓ output validated  │
                                                                   └──────────────────────┘
```

## Installation

```bash
npm install @tahanabavi/typewire-nestjs @tahanabavi/typefetch zod
```

Peer dependencies: `@nestjs/common` + `@nestjs/core` (v10 or v11), `rxjs`, `reflect-metadata`, `zod@^4`.

## Quick start

**The shared contract** (imported by both frontend and backend):

```ts
// contracts/user.contracts.ts
import { z } from "zod";
import type { Contracts } from "@tahanabavi/typefetch";

export const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({
        path: z.object({ id: z.string() }),
        query: z.object({ verbose: z.boolean().optional() }).optional(),
      }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    createUser: {
      method: "POST",
      path: "/users",
      auth: true,
      request: z.object({
        body: z.object({ name: z.string().min(2), age: z.number().int() }),
      }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
  },
} as const satisfies Contracts;
```

**The controller:**

```ts
import { Controller } from "@nestjs/common";
import {
  TypeFetchEndpoint,
  ContractInput,
  InferRequest,
  InferResponse,
} from "@tahanabavi/typewire-nestjs";
import { contracts } from "./contracts/user.contracts";

type GetUser = typeof contracts.user.getUser;
type CreateUser = typeof contracts.user.createUser;

@Controller()
export class UserController {
  // GET /users/:id — method + path come from the contract. No @Get, no drift.
  @TypeFetchEndpoint(contracts.user.getUser)
  async getUser(
    @ContractInput() input: InferRequest<GetUser>,
  ): Promise<InferResponse<GetUser>> {
    return { id: input.path.id, name: "Taha" };
  }

  @TypeFetchEndpoint(contracts.user.createUser, { httpCode: 200 })
  async createUser(
    @ContractInput() input: InferRequest<CreateUser>,
  ): Promise<InferResponse<CreateUser>> {
    return { id: "u-1", name: input.body.name };
  }
}
```

That's it. For every bound endpoint:

- **Route** — HTTP method and path are taken from the contract (`/users/:id` is the same param syntax NestJS uses). Use a prefix-less `@Controller()`, since contract paths are absolute.
- **Request validation** — `params`, `query`, `body`, and declared `headers` are validated against `endpoint.request`. Failures return a `400` whose body the typefetch client surfaces as a first-class `RichError` (see below).
- **Response validation** — the handler's return value is validated against `endpoint.response` **and stripped** of undeclared fields, so entities never leak extra data. A mismatch logs the issues and returns `500` — backend drift from the contract can't ship silently.

## Retrofitting existing routes: `@UseContract`

Keep your own route decorators and add only validation:

```ts
@Controller("users")
export class UserController {
  @Get(":id")
  @UseContract(contracts.user.getUser)
  getUser(@ContractPath() path: InferRequest<GetUser>["path"]) { ... }
}
```

## Param decorators

| Decorator            | Returns                                                        |
| -------------------- | -------------------------------------------------------------- |
| `@ContractInput()`   | The whole validated input, shaped like the contract's `request` schema — exactly what the frontend passed to the client method. |
| `@ContractPath()`    | Validated (and coerced) path params.                            |
| `@ContractQuery()`   | Validated (and coerced) query params.                           |
| `@ContractBody()`    | Validated body (the whole input for flat contracts).            |
| `@ContractHeaders()` | Validated headers part.                                         |

Native `@Param()`, `@Query()`, and `@Body()` also see the validated, coerced values — the interceptor mirrors them back onto the platform request.

## Wire-type coercion

HTTP turns everything in a URL into strings. The typefetch client serializes query/path values with `URLSearchParams` (`true` → `"true"`, arrays → repeated keys, `Date` → ISO string, nested objects → JSON). typewire-nestjs reverses that **against the contract schema** before validating, so contracts written for the client work unchanged on the server:

| Contract declares            | Wire value                  | Handler receives      |
| ---------------------------- | --------------------------- | --------------------- |
| `z.number()`                 | `"25"`                      | `25`                  |
| `z.boolean()`                | `"true"`                    | `true`                |
| `z.date()` (query **or** body) | `"2026-01-01T00:00:00.000Z"` | `Date`             |
| `z.array(z.string())`        | `?tags=a&tags=b` / `?tags=a` | `["a","b"]` / `["a"]` |
| `z.object({...})` in query   | `'{"a":1}'` (JSON string)   | `{ a: 1 }`            |
| `z.bigint()` in query        | `"9007199254740993"`        | `9007199254740993n`   |

Coercion never invents data — if a value can't be coerced it is passed through untouched and Zod reports the real error. Disable with `coerce: false` (per endpoint or globally).

## Error shapes (RichError-compatible)

Request validation failure → `400` with **all** part issues collected:

```json
{
  "statusCode": 400,
  "message": "Request validation failed",
  "code": "VALIDATION_ERROR",
  "errors": {
    "path.id": ["Too small: expected string to have >=1 characters"],
    "body.name": ["Too small: expected string to have >=2 characters"]
  }
}
```

On the frontend, `RichError` picks up `message`, `code`, and `errors` automatically — field errors from the backend arrive typed and addressable.

Response contract violation → `500` with `code: "RESPONSE_CONTRACT_VIOLATION"`. Issues are always logged server-side; include them in the body during development with `exposeResponseErrors: true`.

## Global configuration

The decorators work with zero setup. Import the module to change defaults app-wide:

```ts
@Module({
  imports: [
    TypeFetchModule.forRoot({
      validateRequest: true,          // default
      validateResponse: true,         // default
      coerce: true,                   // default
      exposeResponseErrors: process.env.NODE_ENV !== "production",
    }),
  ],
})
export class AppModule {}
```

Every option can also be overridden per endpoint: `@TypeFetchEndpoint(endpoint, { validateResponse: false })`.

## Honoring the contract's `auth` flag

The bound endpoint is available to guards via `getContractEndpoint()`:

```ts
import { getContractEndpoint } from "@tahanabavi/typewire-nestjs";

@Injectable()
export class ContractAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const endpoint = getContractEndpoint(context);
    if (!endpoint?.auth) return true; // public per contract
    return this.validateBearerToken(context); // your auth logic
  }
}

// app.module.ts
providers: [{ provide: APP_GUARD, useClass: ContractAuthGuard }]
```

## Flat (non-structured) contracts

A request schema that isn't shaped as `{ path, query, body, headers }` is "flat" — the client sends the whole input as the JSON body, and the server validates `req.body` against the whole schema. Both styles work with both decorators.

## Response envelope (mirror of `setResponseWrapper`)

The typefetch client can wrap every response in an envelope via `client.setResponseWrapper()`:

```ts
client.setResponseWrapper((successResponse) =>
  z.union([
    z.object({ success: z.literal(true), data: successResponse }),
    z.object({ success: z.literal(false), message: z.string() }),
  ]),
);
```

Enable the **matching** server side so the client's wrapper parses both branches:

```ts
TypeFetchModule.forRoot({ envelope: true })
```

- **Successful responses** are wrapped in `{ success: true, data }` — *after* contract-response validation (the envelope interceptor is global, so it runs outside the method-scoped validator).
- **Every error** — contract 400s, response-violation 500s, and any other `HttpException` — is formatted by a catch-all filter into `{ success: false, message, code?, errors? }`, keeping the original HTTP status. This matters: with a client wrapper active, an unwrapped error body would fail the client's schema parse, so the envelope must cover failures too.
- It applies to **all** routes (contract-bound or not), so the whole API has one shape.

Customize the shape (must match your client wrapper) or return errors as `200`:

```ts
TypeFetchModule.forRoot({
  envelope: {
    success: (data) => ({ ok: true, result: data }),
    error: (e) => ({ ok: false, reason: e.message, code: e.code }),
    errorStatus: 200, // default "preserve" keeps the real HTTP status
  },
})
```

`e` is `{ message, status, code?, errors? }`. Disabled by default; `ResponseEnvelopeInterceptor` and `ContractEnvelopeExceptionFilter` are also exported for manual wiring.

## File uploads (`bodyType: "form-data"`)

When a contract sets `bodyType: "form-data"` with file fields (`z.instanceof(File)` / `z.file()`), the request is multipart, not JSON. Add any NestJS file interceptor and typewire-nestjs handles the rest — **place it closest to the method so Multer parses the body before validation runs**:

```ts
import { UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";

@Controller()
class MediaController {
  @TypeFetchEndpoint(contracts.media.uploadAvatar)
  @UseInterceptors(AnyFilesInterceptor()) // ← runs before contract validation
  upload(@ContractInput() input: InferRequest<typeof contracts.media.uploadAvatar>) {
    // input.body.file  → the uploaded Multer file (passed through)
    // input.body.priority → coerced number, input.path.id → validated
    return { id: input.path.id, filename: input.body.file.originalname };
  }
}
```

How each form field is validated:

- **File fields** — a browser `instanceof File` check can't hold on the server, so the uploaded Multer file is **passed through** after a presence check that honors the field's optionality. `z.array(z.instanceof(File))` collects multiple files; a single upload to an array field is wrapped. Works with `FileInterceptor`, `FilesInterceptor`, `FileFieldsInterceptor`, and `AnyFilesInterceptor` alike.
- **Text fields** — multipart sends everything else as strings, so they're **coerced** toward the declared type (`"3"` → `3`, `"true"` → `true`) exactly like query params, then validated. Undeclared fields are dropped; a missing required file reports `body.<field>: ["Expected an uploaded file"]`.

## Field-level encryption (mirror of `encryptionMiddleware`)

When a contract endpoint sets an `encryption` config, the client's `encryptionMiddleware` encrypts the marked request fields before sending and decrypts the marked response fields on arrival. The backend mirrors it — **decrypting request fields before validation** and **encrypting response fields after validation** — using the same key material and the same algorithm (byte-compatible, via `crypto-js` / `node-forge`).

```ts
// shared contract
const contracts = {
  auth: {
    login: {
      method: "POST",
      path: "/login",
      encryption: {
        method: "AES",                 // AES | DES | RSA | Base64 | Custom
        request: { password: true },   // decrypt before validation
        response: { token: true },     // encrypt after validation
      },
      request: z.object({ body: z.object({ username: z.string(), password: z.string().min(6) }) }),
      response: z.object({ token: z.string(), user: z.string() }),
    },
  },
} as const;
```

Provide the **same `keyProvider`** the client uses:

```ts
TypeFetchModule.forRoot({
  encryption: {
    keyProvider: async () => ({ type: "symmetric", key: process.env.ENC_KEY! }),
    // RSA: () => ({ type: "rsa", publicKey, privateKey })
    // customHandlers: { encrypt, decrypt }  // for method: "Custom"
    // failClosed: true (default) — never leak plaintext on crypto failure
  },
})
```

Then handlers just work in plaintext:

```ts
@TypeFetchEndpoint(contracts.auth.login)
login(@ContractInput() input: InferRequest<typeof contracts.auth.login>) {
  // input.body.password is already decrypted AND validated (min(6) ran on plaintext)
  return { token: signJwt(input.body.username), user: input.body.username };
  // token is encrypted on the way out; the client decrypts it
}
```

Details that keep it interoperable:

- **Direction is mirrored** — the client encrypts requests / decrypts responses, so the server decrypts requests / encrypts responses.
- **Order matters** — request fields are decrypted *before* validation (so `min(6)` etc. run on plaintext), response fields are encrypted *after* validation.
- **Value serialization matches** — non-string values are `JSON.stringify`d before encryption and `safeJsonParse`d after decryption, exactly like the client, so numbers/objects round-trip.
- **Per-direction methods** — `method: { request: "AES", response: "Base64" }` is honored; a bare string applies to both. Deep maps (`{ profile: { pin: true } }`) and the `{ body: { ... } }` request style are supported.
- **`crypto-js` and `node-forge` are optional peers** — required lazily, only when encryption is used. `failClosed` (default `true`) turns any crypto failure into a `400 DECRYPTION_ERROR` / `500 ENCRYPTION_ERROR` rather than leaking plaintext.

## OpenAPI / Swagger from contracts

The same contracts generate a full OpenAPI 3.0 document — method, path, params, request body, and responses all derived from the Zod schemas, so **your API docs can never drift from what the client calls**.

```ts
import { NestFactory } from "@nestjs/core";
import { setupContractSwagger } from "@tahanabavi/typewire-nestjs";
import { contracts } from "./contracts";

const app = await NestFactory.create(AppModule);

setupContractSwagger(app, contracts, {
  path: "docs",
  info: { title: "My API", version: "1.0.0" },
});

await app.listen(3000);
// Swagger UI → http://localhost:3000/docs
// Raw JSON  → http://localhost:3000/docs-json
```

`@nestjs/swagger` is an **optional** peer dependency — install it only if you use `setupContractSwagger()`. Prefer to serve the document yourself? Build the plain object directly:

```ts
import { buildOpenApiDocument } from "@tahanabavi/typewire-nestjs";

const document = buildOpenApiDocument(contracts, { info: { title: "My API", version: "1.0.0" } });
// hand to SwaggerModule.setup(), write to disk, feed a client generator, ...
```

What the generator maps from each contract endpoint:

| Contract | OpenAPI |
| --- | --- |
| `path: "/users/:id"` | `/users/{id}` with a required `id` path parameter |
| `request.path` / `request.query` / `request.headers` | typed `parameters` (array query params → `explode: true`, matching repeated-key serialization) |
| `request.body` (or a flat request) | `requestBody` — `application/json`, or `multipart/form-data` when `bodyType: "form-data"` |
| `response` | the success response (`201` for POST, `200` otherwise) |
| `z.date()` / `z.bigint()` / file fields | `string`+`date-time` / `string`+`int64` / `string`+`binary` (never throws) |
| `auth: true` | `bearerAuth` security requirement + documented `401` |
| — | a shared `ContractValidationError` schema on every `400` |

Options: `bearerAuth` (default on), `includeValidationError` (default on), `servers`, and `successStatus(endpoint)` to override the documented success code.

## Exports

| Export | Kind | Purpose |
| ------ | ---- | ------- |
| `TypeFetchEndpoint` | decorator | Bind route + validation from a contract endpoint |
| `UseContract` | decorator | Validation only, on manually declared routes |
| `ContractInput` / `ContractPath` / `ContractQuery` / `ContractBody` / `ContractHeaders` | param decorators | Validated request data |
| `TypeFetchModule` | module | `forRoot()` global options |
| `ContractValidationInterceptor` | interceptor | Applied automatically; exported for advanced wiring |
| `ResponseEnvelopeInterceptor` / `ContractEnvelopeExceptionFilter` | interceptor / filter | Response-envelope success + error wrapping |
| `decryptRequestBody` / `encryptResponseData` / `encryptValue` / `decryptValue` | functions | Field-level encryption building blocks |
| `getContractEndpoint` | helper | Read the bound endpoint in guards/interceptors |
| `setupContractSwagger` | helper | Build + mount Swagger UI from contracts |
| `buildOpenApiDocument` | function | Contracts → plain OpenAPI 3.0 document |
| `InferRequest` / `InferResponse` / `ContractHandler` | types | End-to-end handler typing |
| `ContractValidationException` / `ContractResponseViolationException` | exceptions | Thrown on 400 / 500 |
| `formatZodIssues`, `coerceInput`, `validateRequest` | utilities | Building blocks for custom pipelines |
| `TYPEFETCH_ENDPOINT_METADATA`, `TYPEFETCH_OPTIONS_METADATA`, `TYPEFETCH_MODULE_OPTIONS`, `PARSED_REQUEST_KEY` | constants | Metadata & DI tokens |

## License

MIT © Taha Nabavi
