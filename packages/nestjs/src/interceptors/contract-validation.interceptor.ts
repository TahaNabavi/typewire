import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { EndpointDefZ } from "@tahanabavi/typefetch";
import { from, Observable } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  PARSED_REQUEST_KEY,
  TYPEFETCH_ENDPOINT_METADATA,
  TYPEFETCH_MODULE_OPTIONS,
  TYPEFETCH_OPTIONS_METADATA,
} from "../constants";
import {
  decryptRequestBody,
  encryptResponseData,
} from "../encryption/encryption";
import {
  ContractResponseViolationException,
  formatZodIssues,
} from "../exceptions";
import type {
  ContractEndpointOptions,
  ParsedContractRequest,
  ResolvedContractOptions,
  TypeFetchModuleOptions,
} from "../types";
import { validateRequest } from "../validation/request-validator";

/**
 * Validates the request against the contract's `request` schema before the
 * handler runs, and the handler's return value against the `response`
 * schema after it runs (also stripping fields the contract does not
 * declare, so entities never leak extra data).
 *
 * Applied automatically by `@TypeFetchEndpoint()` / `@UseContract()`; it is
 * a no-op on handlers without contract metadata.
 */
@Injectable()
export class ContractValidationInterceptor implements NestInterceptor {
  private readonly logger = new Logger("TypeFetchContract");

  // Explicit injection tokens: the published build (esbuild) does not emit
  // `design:paramtypes` metadata, so by-type injection would break there.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional()
    @Inject(TYPEFETCH_MODULE_OPTIONS)
    private readonly moduleOptions?: TypeFetchModuleOptions,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const endpoint = this.reflector.get<EndpointDefZ | undefined>(
      TYPEFETCH_ENDPOINT_METADATA,
      context.getHandler(),
    );
    if (!endpoint) return next.handle();

    const options = this.resolveOptions(context);
    const request = context.switchToHttp().getRequest();

    // Decrypt request fields first, so validation (and the handler) see
    // plaintext — the inverse of what the client encrypted before sending.
    let body = request.body;
    if (endpoint.encryption?.request) {
      body = await this.decryptBody(endpoint, body);
      try {
        request.body = body;
      } catch {
        /* frozen request — parsed value still flows through validation */
      }
    }

    if (options.validateRequest) {
      const parsed = validateRequest(
        endpoint,
        {
          params: request.params ?? {},
          query: request.query ?? {},
          body,
          headers: request.headers ?? {},
          files: collectFiles(request),
        },
        { coerce: options.coerce },
      );

      request[PARSED_REQUEST_KEY] = parsed;
      this.syncRequest(request, parsed);
    }

    const encryptResponse = Boolean(endpoint.encryption?.response);
    if (!options.validateResponse && !encryptResponse) return next.handle();

    return next.handle().pipe(
      mergeMap((data) =>
        from(this.handleResponse(endpoint, data, options, encryptResponse)),
      ),
    );
  }

  private async handleResponse(
    endpoint: EndpointDefZ,
    data: unknown,
    options: ResolvedContractOptions,
    encryptResponse: boolean,
  ): Promise<unknown> {
    let result = data;

    if (options.validateResponse) {
      const parsed = endpoint.response.safeParse(data);
      if (!parsed.success) {
        const errors = formatZodIssues(parsed.error);
        this.logger.error(
          `Response contract violation on ${endpoint.method} ${endpoint.path}: ${JSON.stringify(errors)}`,
        );
        throw new ContractResponseViolationException(
          errors,
          options.exposeResponseErrors,
        );
      }
      result = parsed.data;
    }

    if (encryptResponse) {
      result = await this.encryptResponse(endpoint, result);
    }

    return result;
  }

  private async decryptBody(
    endpoint: EndpointDefZ,
    body: unknown,
  ): Promise<unknown> {
    const encryption = this.moduleOptions?.encryption;
    const failClosed = encryption?.failClosed ?? true;

    if (!encryption?.keyProvider) {
      if (failClosed) {
        throw new InternalServerErrorException({
          message: `Endpoint ${endpoint.path} requires request decryption but no encryption keyProvider is configured`,
          code: "ENCRYPTION_NOT_CONFIGURED",
        });
      }
      return body;
    }

    try {
      const keyMaterial = await encryption.keyProvider();
      return await decryptRequestBody(
        endpoint.encryption!,
        body,
        keyMaterial,
        encryption.customHandlers,
      );
    } catch (error) {
      if (failClosed) {
        throw new BadRequestException({
          message: "Failed to decrypt request payload",
          code: "DECRYPTION_ERROR",
        });
      }
      this.logger.error(
        `Request decryption failed on ${endpoint.path}: ${String(error)}`,
      );
      return body;
    }
  }

  private async encryptResponse(
    endpoint: EndpointDefZ,
    data: unknown,
  ): Promise<unknown> {
    const encryption = this.moduleOptions?.encryption;
    const failClosed = encryption?.failClosed ?? true;

    if (!encryption?.keyProvider) {
      if (failClosed) {
        throw new InternalServerErrorException({
          message: `Endpoint ${endpoint.path} requires response encryption but no encryption keyProvider is configured`,
          code: "ENCRYPTION_NOT_CONFIGURED",
        });
      }
      return data;
    }

    try {
      const keyMaterial = await encryption.keyProvider();
      return await encryptResponseData(
        endpoint.encryption!,
        data,
        keyMaterial,
        encryption.customHandlers,
      );
    } catch (error) {
      // Fail closed by default: never return plaintext that should be encrypted.
      this.logger.error(
        `Response encryption failed on ${endpoint.path}: ${String(error)}`,
      );
      if (failClosed) {
        throw new InternalServerErrorException({
          message: "Failed to encrypt response payload",
          code: "ENCRYPTION_ERROR",
        });
      }
      return data;
    }
  }

  private resolveOptions(context: ExecutionContext): ResolvedContractOptions {
    const endpointOptions =
      this.reflector.get<ContractEndpointOptions | undefined>(
        TYPEFETCH_OPTIONS_METADATA,
        context.getHandler(),
      ) ?? {};

    return {
      validateRequest: true,
      validateResponse: true,
      coerce: true,
      exposeResponseErrors: false,
      ...this.moduleOptions,
      ...endpointOptions,
    };
  }

  /**
   * Best-effort mirror of the validated values back onto the platform
   * request, so native `@Param()`/`@Query()`/`@Body()` decorators also see
   * coerced, validated data. `defineProperty` shadows prototype getters
   * (Express 5 defines `query` as a getter); if the platform still refuses,
   * the `@Contract*()` decorators keep working via `PARSED_REQUEST_KEY`.
   */
  private syncRequest(request: any, parsed: ParsedContractRequest): void {
    const assign = (key: string, value: unknown) => {
      try {
        Object.defineProperty(request, key, {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } catch {
        /* frozen platform request — decorators still serve parsed data */
      }
    };

    if (parsed.isStructured) {
      if (parsed.path) assign("params", parsed.path);
      if (parsed.query) assign("query", parsed.query);
      if (parsed.body !== undefined) assign("body", parsed.body);
    } else {
      assign("body", parsed.body);
    }
  }
}

/**
 * Normalize the uploaded files a NestJS file interceptor placed on the
 * request into a `{ fieldName: file | file[] }` map — regardless of which
 * interceptor produced them:
 *
 * - `FileInterceptor(field)` → `req.file` (a single file)
 * - `FilesInterceptor` / `AnyFilesInterceptor` → `req.files` (a flat array)
 * - `FileFieldsInterceptor` → `req.files` (an object keyed by field)
 *
 * A field that received several files becomes an array; a single file stays a
 * lone object — the form-data validator adapts either way to the contract.
 */
function collectFiles(request: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const single = request?.file;
  if (single && typeof single === "object") {
    out[single.fieldname ?? "file"] = single;
  }

  const many = request?.files;
  if (Array.isArray(many)) {
    for (const file of many) {
      const name = file?.fieldname ?? "file";
      if (out[name] === undefined) out[name] = file;
      else if (Array.isArray(out[name])) (out[name] as unknown[]).push(file);
      else out[name] = [out[name], file];
    }
  } else if (many && typeof many === "object") {
    for (const [name, group] of Object.entries(many)) {
      out[name] =
        Array.isArray(group) && group.length === 1 ? group[0] : group;
    }
  }

  return out;
}
