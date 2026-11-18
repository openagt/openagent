import type { DistributionPackage } from '@openagt/hooks'

/**
 * The modules a run goes through, as OpenAgent's runs load them (#2394): the dashboard hands this
 * file down to every process it starts (`cli/distribution.ts`), a run's own among them, which
 * loads each package's `./module` from here. Until the dashboard is the distribution itself, with
 * every module listed, it lists the modules of the run pipeline that have a package.
 */
const DISTRIBUTION: readonly DistributionPackage[] = [
  // git-branches: the run's checkout, its branch read back, the checkout reclaimed.
  { package: '@openagt/skill-branches' },
  // github: the run's pull request read back.
  { package: '@openagt/skill-github' },
  // agent-driver: the agent's turns and the run's record.
  { package: '@openagt/agent-runner' },
]

export default DISTRIBUTION
