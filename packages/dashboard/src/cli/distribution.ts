import { fileURLToPath } from 'node:url'
import { DISTRIBUTION_ENV } from '@openagt/hooks'

/**
 * Hand this package's distribution down in `env`, under {@link DISTRIBUTION_ENV}: the path of its
 * file (`distribution.ts`). Set in the dashboard's own environment, so every process it starts
 * inherits it, and a run's process goes through the same modules as the dashboard that started it.
 */
export function handDownDistribution(env: NodeJS.ProcessEnv): void {
  env[DISTRIBUTION_ENV] = fileURLToPath(new URL('../distribution.js', import.meta.url))
}
