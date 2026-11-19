import agentDriver from '@openagt/agent-runner/module'
import type { DistributionItem } from '@openagt/hooks'
import DISTRIBUTION from '../distribution.js'
import { fakeRunHost } from './fake-runs.js'

/**
 * The demo's distribution (`demo.ts`), handed down to its dashboard (`OPENAGENT_DISTRIBUTION`):
 * the dashboard's own, with agent-driver's host the scripted one (`fake-runs.ts`).
 */
const DEMO: readonly DistributionItem[] = DISTRIBUTION.map(item =>
  item.package === '@openagt/agent-runner' ? { module: { ...agentDriver, hooks: { ...agentDriver.hooks, 'run.host': [fakeRunHost()] } } } : item,
)

export default DEMO
