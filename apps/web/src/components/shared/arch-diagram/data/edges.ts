import { EdgeSpec, SplitEdgeSpec } from '../types'

export const EDGES: EdgeSpec[] = [
  {
    from: 'contract',
    to: 'transports',

    kind: 'dependency',

    color: 'var(--cyan)',
    width: 1.4,
  },

  {
    from: 'contract',
    to: 'client',

    kind: 'dependency',

    color: 'var(--cyan)',
    width: 1.4,
  },

  {
    from: 'contract',
    to: 'server',

    kind: 'dependency',

    color: 'var(--cyan)',
    width: 1.4,
  },

  {
    from: 'server',
    to: 'nestjs',

    kind: 'integration',

    color: 'var(--wire-ws)',
    width: 1.4,
  },

  {
    from: 'querycore',
    to: 'frameworks',

    kind: 'runtime',

    color: 'var(--purple)',
    width: 1.4,
  },

  {
    from: 'cli',
    to: 'contract',

    kind: 'optional',

    color: 'var(--amber)',
    width: 1.2,

    dashed: true,
  },

  {
    from: 'permission',
    to: 'contract',

    kind: 'optional',

    color: 'var(--cyan)',
    width: 1.2,

    dashed: true,
  },

  {
    from: 'permission',
    to: 'nestjs',

    kind: 'optional',

    color: 'var(--cyan)',
    width: 1.2,

    dashed: true,
  },

  {
    from: 'encryption',
    to: 'nestjs',

    kind: 'optional',

    color: 'var(--cyan)',
    width: 1.2,

    dashed: true,
  },
  {
    from: 'encryption',
    to: 'contract',

    kind: 'optional',

    color: 'var(--cyan)',
    width: 1.2,

    dashed: true,
  },
  {
    from: 'encryption',
    to: 'typefetch',

    kind: 'optional',

    color: 'var(--cyan)',
    width: 1.2,

    dashed: true,
  },
]

export const SPLIT_EDGES: SplitEdgeSpec[] = [
  {
    from: 'transports',
    to: ['http', 'graphql', 'grpc'],

    kind: 'transport',

    color: 'var(--cyan)',
    width: 1.4,

    pulse: true,
    dur: 3,
  },

  {
    from: 'client',
    to: ['typefetch', 'typesocket'],

    kind: 'transport',

    color: 'var(--cyan)',
    width: 1.4,

    pulse: true,
    dur: 3,
  },

  {
    from: 'querycore',
    to: ['typefetch', 'typesocket'],

    kind: 'runtime',

    color: 'var(--purple)',
    width: 1.4,

    pulse: true,
    dur: 3,
  },

  {
    from: 'querycore',
    to: ['devtools'],

    kind: 'runtime',

    color: 'var(--purple)',
    width: 1.4,

    pulse: true,
    dur: 3,
  },

  {
    from: 'frameworks',
    to: ['react'],

    kind: 'integration',

    color: 'var(--purple)',
    width: 1.4,

    pulse: true,
    dur: 3,
  },

  {
    from: 'permission',
    to: ['typefetch', 'typesocket'],

    kind: 'optional',

    color: 'var(--cyan)',
    width: 1.2,

    dashed: true,
  },
]
