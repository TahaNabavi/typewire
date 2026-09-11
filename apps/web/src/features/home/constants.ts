import { BunIcon, DenoIcon, NodeIcon, NpmIcon } from '@/components/shared/icons'

/** In the order a reader meets them: where it installs from, where it runs. */
export const RUNTIME_ICONS = [
  { label: 'npm', Icon: NpmIcon },
  { label: 'Node', Icon: NodeIcon },
  { label: 'Bun', Icon: BunIcon },
  { label: 'Deno', Icon: DenoIcon },
] as const
