import { DISTRIBUTION_ENV } from '@openagt/hooks'

/**
 * Hand the distribution down in `env`, under {@link DISTRIBUTION_ENV}: `file`, the path of the file
 * of the distribution whose command runs this one (`@openagt/dashboard`'s, or the demo's). Set in
 * the dashboard's own environment, so every process it starts inherits it, and a run's process
 * goes through the same modules as the dashboard that started it. One this process inherited is
 * replaced: the dashboard serves its own command's modules.
 */
export function handDownDistribution(env: NodeJS.ProcessEnv, file: string): void {
  env[DISTRIBUTION_ENV] = file
}
