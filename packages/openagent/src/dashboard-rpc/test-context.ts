import { setDashboardContext } from './context.js'
import { registryPreferencesStore } from '../registry.js'
import { defaultQuotaSource } from '../dashboard/quota.js'
import type { DashboardContext } from '../dashboard/rpc-serve.js'
import type { DashboardOptions } from '../dashboard/server.js'

/**
 * What the dashboard host wires (D3), as a test would have it: every capability present, the two
 * that start work refusing, and the reads answering empty. There is one host and it wires every
 * capability, so an RPC reads its context as simply there — a missing field is a wiring bug, and
 * it throws. That makes this the one place a test says what the host would have wired, with only
 * the parts it cares about overridden.
 */
export function testDashboardContext(over: Partial<DashboardContext> = {}): DashboardContext {
  return {
    startAgent: () => ({ ok: false, error: 'not wired in this test' }),
    addProject: () => ({ ok: false, error: 'not wired in this test' }),
    startedIn: () => ({ ok: false, error: 'not wired in this test' }),
    removeProject: () => ({ ok: false, error: 'not wired in this test' }),
    eventsSource: () => undefined,
    remote: { target: () => undefined, list: () => [], working: () => false, rekey: () => {}, sent: () => true, home: async () => undefined, follow: async () => {}, machineNames: async () => () => undefined },
    preferences: registryPreferencesStore(),
    quota: defaultQuotaSource(),
    models: { read: async () => ({ 'claude-code': { models: [] }, codex: { models: [] } }) },
    projectErrors: () => ({ errors: [] }),
    bridgeBrowser: { status: async () => ({ state: 'off' }), start: async () => {}, stop: async () => {}, act: async () => {} },
    ...over,
  }
}

/**
 * The same wiring as {@link testDashboardContext}, in the shape {@link startDashboard} takes: a
 * test asserting one route still stands up the same server the product does.
 */
export function testDashboardOptions(over: Partial<DashboardOptions> = {}): DashboardOptions {
  const { startAgent, addProject, startedIn, removeProject, ...rest } = testDashboardContext()
  return { port: 0, onStart: startAgent, onAddProject: addProject, onStartedIn: startedIn, onRemoveProject: removeProject, ...rest, ...over }
}

/**
 * Wire the dashboard's capabilities for a test that calls an RPC directly.
 *
 * It sticks until the next call, where Telefunc's request context used to evaporate at the next
 * macrotask (F3) — so a test no longer has to call this immediately before the RPC under test.
 */
export function provideTestContext(over: Partial<DashboardContext> = {}): void {
  setDashboardContext(testDashboardContext(over))
}
