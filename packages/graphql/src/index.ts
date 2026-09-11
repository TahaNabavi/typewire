export { graphqlTransport } from './transport'
export {
  DocumentGenerationError,
  generateDocument,
  operationNameFrom,
  operationNameOf,
} from './document'
export { kindFromGraphqlCode } from './errors'
export type {
  GraphqlEndpointFields,
  GraphqlError,
  GraphqlResponseBody,
  GraphqlTransportConfig,
} from './types'

// Side-effect import: the module augmentation in `./types` is what adds
// `graphql` to typefetch's TransportRegistry, and it must be loaded even when a
// consumer imports only `graphqlTransport`.
import './types'
