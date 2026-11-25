import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { localHost } from '@openagt/agent-driver'
import type { RunHost } from '@openagt/hooks'
import { setDashboardContext, type DashboardContext } from './context.js'
import { registryPreferencesStore } from '../registry.js'
import type { DashboardOptions } from '../dashboard/server.js'
import { handDownTestDistribution } from '../test-distribution.js'

handDownTestDistribution()


/** What a resume in a test is written down as, one line per resume in the project's {@link RESUMED_FILE}: the run, its text and its answer. */
export const RESUMED_FILE = 'resumed.txt'

/**
 * This computer's host as a test has it: agent-driver's own, the runs' processes stood in for. A
 * start is refused, as no coding agent may start in a test; a resume is written down in the
 * project's {@link RESUMED_FILE}, `<id>|<text>|<answer>`, once the host found the run's record.
 */
export function testHost(): RunHost {
  return localHost({
    spawnRun: async () => {
      throw new Error('not wired in this test')
    },
    spawnResume: async (repo, run) => appendFile(join(repo, RESUMED_FILE), `${run.id}|${run.text ?? ''}|${run.answer ?? ''}\n`),
    ready: async () => ({ problems: [], warnings: [] }),
    loginFor: async () => undefined,
  })
}

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
    startedIn: () => ({ ok: false, error: 'not wired in this test' }),
    host: testHost(),
    otherHosts: async () => [],
    preferences: registryPreferencesStore(),
    openAgentUpdate: { read: async () => undefined },
    projectState: async () => ({ errors: [], notes: [] }),
    ...over,
  }
}

/**
 * The same wiring as {@link testDashboardContext}, as {@link startDashboard} takes it, on an
 * ephemeral port: a test asserting one route still stands up the same server the product does.
 */
export function testDashboardOptions(over: Partial<DashboardOptions> = {}): DashboardOptions {
  return { port: 0, context: testDashboardContext(), ...over }
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
