export * from './types'
export * from './errors'
export * from './client'
export * from './schemas'
// The transport seam. Public API: adapter packages compile against it, so
// breaking any of it is a major.
export {
  TRANSPORT_API_VERSION,
  type TransportAdapter,
  type TransportCapabilities,
  type TransportContext,
  type TransportDecoded,
  type TransportFailure,
  type TransportRequest,
  type TransportSendOptions,
} from './transport/adapter'
export { httpTransport } from './transport/http'
export { describeEndpoint } from './transport/describe'
export { isXhrAvailable, xhrRequest } from './transport/xhr'
export { parseContentDisposition, contentLengthOf } from './utils/response-body'
export { kindFromHttpStatus, kindFromThrown } from './utils/error-kind'
export * from './middlewares/logging'
export * from './middlewares/retry'
export * from './middlewares/auth'
export * from './middlewares/cache'
export * from './middlewares/permission'
export * from './utils/make-request-schema'
export * from './modules/tester/index'
