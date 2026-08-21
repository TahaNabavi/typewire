import { RichError } from "../errors";
import type {
  AnyEndpointDefZ,
  EndpointDefZ,
  RequestParts,
  ResponseType,
} from "../types";
import { kindFromHttpStatus } from "../utils/error-kind";
import { decodeResponse, readErrorBody } from "../utils/response-body";
import type {
  TransportAdapter,
  TransportContext,
  TransportDecoded,
  TransportFailure,
  TransportRequest,
} from "./adapter";
import { TRANSPORT_API_VERSION } from "./adapter";

/**
 * The built-in HTTP transport
 * ===========================
 * Everything wire-specific that used to live inline in `ApiClient`. It is
 * registered by default and needs no package, because "an HTTP request" is what
 * the core already is.
 *
 * This file is deliberately a *verbatim* extraction: it is the regression net
 * for every transport added after it, so any behaviour change here would
 * invalidate the comparison.
 */

/** Response types whose bodies belong to the caller, undrained. */
const UNDRAINED_RESPONSE_TYPES = new Set<ResponseType>(["stream", "response"]);

/** Response types the `responseWrapper` / `responseTransform` pipeline applies to. */
const ENVELOPE_RESPONSE_TYPES = new Set<ResponseType>(["json", "text"]);

const REQUEST_PART_KEYS = new Set(["path", "query", "body", "headers", "header"]);

type ParsedRequestParts = {
  path?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  headers: Record<string, string>;
  isStructured: boolean;
};

function isObjectRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the input uses the `{ path, query, body, headers }` convention.
 *
 * Requires *every* key to be a known part, not merely one of them — an input
 * that happens to have a `body` field alongside domain fields is a plain
 * payload, not a structured request.
 */
function isStructuredRequestInput(input: unknown): input is Record<string, any> {
  if (!isObjectRecord(input)) return false;

  const keys = Object.keys(input);
  if (keys.length === 0) return false;

  return (
    keys.some((key) => REQUEST_PART_KEYS.has(key)) &&
    keys.every((key) => REQUEST_PART_KEYS.has(key))
  );
}

export function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!isObjectRecord(headers)) return {};

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    normalized[key] = String(value);
  }

  return normalized;
}

function extractRequestParts(input: any): ParsedRequestParts {
  if (isStructuredRequestInput(input)) {
    return {
      path: isObjectRecord(input.path) ? input.path : undefined,
      query: isObjectRecord(input.query) ? input.query : undefined,
      body: input.body,
      headers: normalizeHeaders(input.headers ?? input.header),
      isStructured: true,
    };
  }

  return { body: input, headers: {}, isStructured: false };
}

function applyPathParams(
  fullUrl: string,
  pathParams?: Record<string, any>,
): string {
  const url = new URL(fullUrl);

  const replacedPathname = url.pathname.replace(
    /:([A-Za-z0-9_]+)/g,
    (_, key: string) => {
      const value = pathParams?.[key];

      if (value === undefined || value === null) {
        throw new RichError({
          message: `Missing path param "${key}"`,
          code: "MISSING_PATH_PARAM",
          kind: "invalid_argument",
        });
      }

      return encodeURIComponent(String(value));
    },
  );

  return `${url.origin}${replacedPathname}${url.search}${url.hash}`;
}

function appendQueryValue(params: URLSearchParams, key: string, value: any) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(params, key, item);
    return;
  }

  if (value instanceof Date) {
    params.append(key, value.toISOString());
    return;
  }

  if (typeof value === "object") {
    params.append(key, JSON.stringify(value));
    return;
  }

  params.append(key, String(value));
}

function appendQueryParams(url: string, query?: Record<string, any>): string {
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(params, key, value);
  }

  const queryString = params.toString();
  if (!queryString) return url;

  return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
}

function appendFormValue(form: FormData, key: string, value: any) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) appendFormValue(form, key, item);
    return;
  }

  if (value instanceof Date) {
    form.append(key, value.toISOString());
    return;
  }

  const isBlob = typeof Blob !== "undefined" && value instanceof Blob;

  if (typeof value === "object" && !isBlob) {
    form.append(key, JSON.stringify(value));
    return;
  }

  form.append(key, value as any);
}

function buildBody(
  endpoint: EndpointDefZ,
  parts: ParsedRequestParts,
  input: any,
): BodyInit | undefined {
  const payload = parts.isStructured ? parts.body : input;

  if (endpoint.method === "GET" || payload === undefined) return undefined;

  if (endpoint.bodyType !== "form-data") return JSON.stringify(payload);

  if (typeof FormData !== "undefined" && payload instanceof FormData) {
    return payload;
  }

  const form = new FormData();

  if (isObjectRecord(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      appendFormValue(form, key, value);
    }
  } else if (payload != null) {
    form.append("value", String(payload));
  }

  return form;
}

/** The endpoint's declared headers, resolved against the input when a function. */
function resolveEndpointHeaders(
  endpoint: EndpointDefZ,
  input: unknown,
): Record<string, string> {
  const declared =
    typeof endpoint.headers === "function"
      ? endpoint.headers(input)
      : endpoint.headers;

  return normalizeHeaders(declared);
}

export const httpTransport: TransportAdapter<"http"> = {
  kind: "http",
  apiVersion: TRANSPORT_API_VERSION,

  capabilities: {
    uploadProgress: true,
    downloadProgress: true,
    responseTypes: [
      "json",
      "text",
      "blob",
      "arrayBuffer",
      "formData",
      "file",
      "stream",
      "response",
    ],
  },

  validate(endpoint: AnyEndpointDefZ, endpointId: string) {
    const http = endpoint as EndpointDefZ;

    if (!http.method) {
      throw new Error(
        `[typefetch] Endpoint "${endpointId}" is missing "method". ` +
          `Every http endpoint needs a method and a path.`,
      );
    }

    if (!http.path) {
      throw new Error(
        `[typefetch] Endpoint "${endpointId}" is missing "path". ` +
          `Every http endpoint needs a method and a path.`,
      );
    }
  },

  describe(endpoint: AnyEndpointDefZ) {
    const http = endpoint as EndpointDefZ;
    return {
      protocol: "HTTP",
      operation: http.method,
      target: http.path,
    };
  },

  resolveDriver(endpoint: AnyEndpointDefZ) {
    return (endpoint as EndpointDefZ).driver ?? "auto";
  },

  build(ctx: TransportContext): TransportRequest {
    const endpoint = ctx.endpoint as EndpointDefZ;
    const parts = extractRequestParts(ctx.input);

    let url = ctx.baseUrl + endpoint.path;
    url = applyPathParams(url, parts.path);
    url = appendQueryParams(url, parts.query);

    const body = buildBody(endpoint, parts, ctx.input);

    // Content-Type first so an endpoint or a call site can override it; auth
    // last so a token always wins. This order is load-bearing — it is what the
    // client did inline before transports were pluggable.
    const headers: Record<string, string> = {};

    if (endpoint.bodyType !== "form-data") {
      headers["Content-Type"] = "application/json";
    }

    Object.assign(
      headers,
      resolveEndpointHeaders(endpoint, ctx.input),
      parts.headers,
    );

    if (ctx.token) headers["Authorization"] = `Bearer ${ctx.token}`;

    return {
      url,
      init: { method: endpoint.method, headers, body } as RequestInit,
      parts: parts as RequestParts,
    };
  },

  async decode(res: Response, ctx: TransportContext): Promise<TransportDecoded> {
    const responseType = (ctx.endpoint as EndpointDefZ).responseType ?? "json";

    return {
      value: await decodeResponse(res, responseType),
      enveloped: ENVELOPE_RESPONSE_TYPES.has(responseType),
    };
  },

  async fail(res: Response, ctx: TransportContext): Promise<TransportFailure> {
    const endpoint = ctx.endpoint as EndpointDefZ;
    const responseType = endpoint.responseType ?? "json";

    // Read defensively and always as text first: a 502 from a proxy is an HTML
    // page and a 401 from a gateway is often empty, so `res.json()` here would
    // replace a perfectly good status-carrying error with a SyntaxError.
    const { body, wasJson } = await readErrorBody(res);

    // Fail open on typing: parse the declared schema when there is one, keep the
    // raw body when there is not. Error-typing must never throw over the real
    // error.
    const errorSchema = endpoint.errors?.[res.status];
    const parsed = errorSchema?.safeParse(body);
    const errorBody = body as any;

    return {
      error: {
        message: errorBody.message || res.statusText || `HTTP ${res.status}`,
        status: res.status,
        kind: kindFromHttpStatus(res.status),
        code: errorBody.code,
        title: errorBody.title,
        detail: errorBody.detail,
        errors: errorBody.errors,
        data: parsed?.success ? parsed.data : errorBody,
        dataParsed: parsed?.success === true,
        errorKey: parsed?.success === true ? res.status : undefined,
      },
      body,
      wasJson,
      enveloped: ENVELOPE_RESPONSE_TYPES.has(responseType),
    };
  },
};

/** Whether download progress may be counted for this endpoint's response type. */
export function allowsDownloadProgress(endpoint: AnyEndpointDefZ): boolean {
  const responseType = (endpoint as EndpointDefZ).responseType ?? "json";
  return !UNDRAINED_RESPONSE_TYPES.has(responseType);
}
