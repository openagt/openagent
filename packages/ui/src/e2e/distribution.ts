import agentDriver from '@openagt/agent-driver/module'
import type { DashboardDistribution } from '../distribution-packages.js'
import { fakeRunHost } from './fake-runs.js'
import { DASHBOARD_PACKAGES } from '../test-distribution.js'

/**
 * The demo's distribution (`demo.ts`), handed down to its dashboard (`OPENAGENT_DISTRIBUTION`):
 * `@openagt/dashboard`'s packages, with agent-driver's host the scripted one (`fake-runs.ts`). Its
 * module is given, and its package named with it, so the rest of the package (its accounts card
 * and command) is the real one.
 */
const DEMO: DashboardDistribution = [
  ...DASHBOARD_PACKAGES,
  { package: '@openagt/agent-driver', for: 'computer', module: { ...agentDriver, hooks: { ...agentDriver.hooks, 'run.host': [fakeRunHost()] } } },
]

export default DEMO
