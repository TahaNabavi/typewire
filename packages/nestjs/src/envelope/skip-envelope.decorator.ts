import { SetMetadata } from '@nestjs/common'
import { TYPEFETCH_SKIP_ENVELOPE_METADATA } from '../constants'

/**
 * Exempt a route from the global response envelope.
 *
 * `TypeFetchModule.forRoot({ envelope: true })` registers an app-wide
 * interceptor, which is right for an API whose client reads one wrapper shape —
 * and wrong for anything whose body shape is fixed by someone else: a health
 * check a load balancer parses, a webhook receipt, an OAuth callback, or a
 * transport that brings its own envelope (a GraphQL `{ data, errors }`, a
 * Connect error body).
 *
 * Applies to the success wrapper *and* the error branch, so a failing exempt
 * route answers with its own shape too.
 *
 * @example
 * ⁣@Get("/healthz")
 * ⁣@SkipEnvelope()
 * health() {
 *   return { status: "ok" };
 * }
 */
export const SkipEnvelope = () =>
  SetMetadata(TYPEFETCH_SKIP_ENVELOPE_METADATA, true)
