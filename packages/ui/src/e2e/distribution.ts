import agentDriver from '@openagt/agent-runner/module'
import type { DashboardDistribution } from '../distribution-packages.js'
import { fakeRunHost } from './fake-runs.js'
import { DASHBOARD_PACKAGES } from '../test-distribution.js'

/**
 * The demo's distribution (`demo.ts`), handed down to its dashboard (`OPENAGENT_DISTRIBUTION`):
 * `@openagt/dashboard`'s packages, with agent-driver's host the scripted one (`fake-runs.ts`).
 */
const DEMO: DashboardDistribution = [...DASHBOARD_PACKAGES, { module: { ...agentDriver, hooks: { ...agentDriver.hooks, 'run.host': [fakeRunHost()] } } }]

export default DEMO
