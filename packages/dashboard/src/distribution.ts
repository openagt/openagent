import type { DistributionPackage } from '@openagt/hooks'

/**
 * The modules OpenAgent runs (#2394): its `openagent` command serves the dashboard with them
 * (`bin.ts`), and hands this file down to every process the dashboard starts, a run's own among
 * them, which loads each package's `./module` from here, resolved from this package's install.
 * For now, the modules of the run pipeline.
 */
const DISTRIBUTION: readonly DistributionPackage[] = [
  // git-branches: the run's checkout, its branch read back, the checkout reclaimed.
  { package: '@openagt/skill-branches' },
  // github: the run's pull request read back.
  { package: '@openagt/skill-github' },
  // agent-driver: this computer's host, the agent's turns and the run's record.
  { package: '@openagt/agent-runner' },
]

export default DISTRIBUTION
