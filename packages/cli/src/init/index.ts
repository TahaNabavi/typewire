export { runInit } from './run'
export type { InitFileResult, InitOptions } from './run'

export { detectProject, envAccessor, installCommand } from './detect'
export type { Framework, PackageManager, ProjectInfo } from './detect'

export { FEATURES, PACKAGES, availableFeatures, packagesFor } from './features'
export type { Feature, FeatureId } from './features'

export { buildPlan } from './plan'
export type { InitPlan, PlanOptions, PlannedFile } from './plan'

export { resolveSelection } from './prompt'

import { runInit } from './run'
import type { InitFileResult } from './run'
import type { InitCommandOptions } from '../types'

/**
 * The pre-wizard entry point.
 *
 * Runs non-interactively with the detected defaults, which is what the old
 * command did — it never asked anything.
 *
 * @deprecated Use {@link runInit}.
 */
export function runInitCommand(
  options: InitCommandOptions = {}
): Promise<InitFileResult[]> {
  return runInit({ ...options, yes: true })
}
