import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from '@openagt/agent-data'
import type { RunHost, RunRef } from '@openagt/hooks'
import { fakeHost } from '@openagt/hooks/testing'
import { listTestProject } from '../test-projects.js'
import { provideTestContext } from './test-context.js'
import { sendMessage, sendStart, sendStop } from './control.js'
import type { StartAgentOptions } from '../dashboard/types.js'

test('sendStart hands the trimmed prompt, the picks and the project to the daemon\'s start, and refuses an empty prompt (#1774)', async () => {
  const calls: unknown[] = []
  provideTestContext({
    startAgent: (prompt: string, options: StartAgentOptions, projectId?: string) => {
      calls.push([prompt, options, projectId])
      return { ok: true, agentId: 'run-1' }
    },
  })
  assert.deepEqual(await sendStart('p1', '  /work-queue now \n', { options: { 'agent-driver': { driver: 'codex', model: 'gpt-5' } } }), { ok: true, agentId: 'run-1' })
  assert.deepEqual(await sendStart('p1', 'Read the docs'), { ok: true, agentId: 'run-1' })
  assert.deepEqual(calls, [['/work-queue now', { options: { 'agent-driver': { driver: 'codex', model: 'gpt-5' } } }, 'p1'], ['Read the docs', {}, 'p1']])
  assert.deepEqual(await sendStart('p1', '   '), { ok: false, error: 'a non-empty prompt is required' })
  assert.equal(calls.length, 2)
})

test("a Stop and what a person says to a run go to the host the run is on: the first of its project's other hosts that has it, else this computer's (#2394)", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-control-')))
  // A list of projects of its own: the other tests' processes change the one they share.
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await listTestProject(dir, '2026-11-19T00:00:00.000Z')
    const id = projectId(dir)
    const ON_ACTIONS = '2026-11-19T10-00-00-000Z'
    const HERE = '2026-11-19T11-00-00-000Z'
    const told: string[] = []
    const hostNamed = (name: string, has: (run: RunRef) => boolean): RunHost => ({
      ...fakeHost({ id: name }),
      find: async run => (has(run) ? { changedNothing: false } : undefined),
      stop: async run => void told.push(`${name} stop ${run.id} in ${run.project?.id}`),
      steer: async (run, line) => void told.push(`${name} ${line.kind === 'message' ? line.text : line.kind} ${run.id}`),
    })
    // A host that cannot say whether it has the run is taken to have none of it.
    const down: RunHost = { ...hostNamed('down', () => true), find: async () => Promise.reject(new Error('GitHub is down')) }
    const asked: (string | undefined)[] = []
    provideTestContext({
      host: hostNamed('here', () => true),
      otherHosts: async project => (asked.push(project?.id), [down, hostNamed('actions', run => run.id === ON_ACTIONS)]),
    })
    assert.deepEqual(await sendStop(id, ON_ACTIONS), { ok: true })
    assert.deepEqual(await sendMessage(id, 'and document it', ON_ACTIONS), { ok: true })
    assert.deepEqual(await sendStop(id, HERE), { ok: true })
    assert.deepEqual(await sendMessage(id, 'faster', HERE), { ok: true })
    assert.deepEqual(told, [`actions stop ${ON_ACTIONS} in ${id}`, `actions and document it ${ON_ACTIONS}`, `here stop ${HERE} in ${id}`, `here faster ${HERE}`])
    assert.ok(asked.every(project => project === id), "the hosts asked are the run's project's")
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
