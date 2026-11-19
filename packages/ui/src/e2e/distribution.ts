import agentDriver from '@openagt/agent-runner/module'
import type { DistributionItem } from '@openagt/hooks'
import { fakeRunHost } from './fake-runs.js'

/**
 * The demo's distribution (`demo.ts`), handed down to its dashboard (`OPENAGENT_DISTRIBUTION`):
 * the modules of the run pipeline, as `@openagt/dashboard` lists them, with agent-driver's host
 * the scripted one (`fake-runs.ts`).
 */
const DEMO: readonly DistributionItem[] = [
  { package: '@openagt/skill-branches' },
  { package: '@openagt/skill-github' },
  { module: { ...agentDriver, hooks: { ...agentDriver.hooks, 'run.host': [fakeRunHost()] } } },
]

export default DEMO
