import agentDriver from '@openagt/agent-driver/module'
import claudeCode from '@openagt/agent-driver-claude-code/module'
import codex from '@openagt/agent-driver-codex/module'
import type { DashboardDistribution } from '../distribution-packages.js'
import { fakeRunHost, readyAgents } from './fake-runs.js'
import { DASHBOARD_PACKAGES } from '../test-distribution.js'

/**
 * The demo's distribution (`demo.ts`), handed down to its dashboard (`OPENAGENT_DISTRIBUTION`):
 * `@openagt/dashboard`'s packages, with agent-driver's host the scripted one (`fake-runs.ts`), and
 * the coding agents ready as its runs need them to be. Each module is given, and its package named
 * with it, so the rest of the package (its accounts card and command) is the real one.
 */
const SCRIPTED: Record<string, DashboardDistribution[number]> = {
  '@openagt/agent-driver-claude-code': { package: '@openagt/agent-driver-claude-code', for: 'computer', module: readyAgents(claudeCode) },
  '@openagt/agent-driver-codex': { package: '@openagt/agent-driver-codex', for: 'computer', module: readyAgents(codex) },
}

const DEMO: DashboardDistribution = [
  ...DASHBOARD_PACKAGES.map(entry => (entry.package !== undefined ? SCRIPTED[entry.package] : undefined) ?? entry),
  { package: '@openagt/agent-driver', for: 'computer', module: { ...agentDriver, hooks: { ...agentDriver.hooks, 'run.host': [fakeRunHost()] } } },
]

export default DEMO
