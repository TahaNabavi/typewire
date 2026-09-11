/** Packages whose `dependencies` must be empty, and why it matters for each. */
export const ALLOWED_DEP = {
  encryption: ['crypto-js', 'node-forge'],
  cli: ['jiti'],
}

/** Packages allowed dependencies, pinned to exactly which. */
export const MUST_BE_CLEAN = [
  ['typefetch', 'the core: every consumer pays for anything added here'],
  ['graphql', 'a transport must not cost more than the core it plugs into'],
  ['grpc', 'no protobuf runtime — that is the whole point of the codec seam'],
]
