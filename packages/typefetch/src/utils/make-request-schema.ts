import { z } from "zod";

type OptionalUndefinedBody<T extends z.ZodTypeAny> = T extends z.ZodUndefined
  ? z.ZodOptional<T>
  : T;

export const makeRequestSchema =
  <
    TPath extends z.ZodRawShape = {},
    TQuery extends z.ZodRawShape = {},
    TBody extends z.ZodTypeAny = z.ZodUndefined,
    THeaders extends z.ZodTypeAny = z.ZodOptional<
      z.ZodRecord<z.ZodString, z.ZodString>
    >,
  >() =>
  (
    defs: {
      path?: z.ZodObject<TPath>;
      query?: z.ZodObject<TQuery>;
      body?: TBody;
      headers?: THeaders;
    } = {},
  ) => {
    const pathSchema = (defs.path ??
      z.object({})) as unknown as z.ZodObject<TPath>;

    const querySchema = (defs.query ??
      z.object({})) as unknown as z.ZodObject<TQuery>;

    const rawBodySchema = (defs.body ?? z.undefined()) as TBody;

    const bodySchema = (
      defs.body ? rawBodySchema : rawBodySchema.optional()
    ) as OptionalUndefinedBody<TBody>;

    const headersSchema = (defs.headers ??
      z.record(z.string(), z.string()).optional()) as THeaders;

    return z.object({
      path: pathSchema.optional(),
      query: querySchema.optional(),
      body: bodySchema,
      headers: headersSchema,
    });
  };
