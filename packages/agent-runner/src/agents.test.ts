import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DISTRIBUTION_ENV } from '@openagt/hooks'
import { codingAgent, codingAgents } from './agents.js'
import { TEST_AGENTS } from './run-test-support.js'
import { handDownAgents } from './test-repo.js'

// The coding agents a run can be on: those its distribution's modules bring, by their ids.

test("a run named no coding agent is on its distribution's first; one named, on that one; one the distribution has not is refused, naming the ones it has", async () => {
  const modules = [{ module: TEST_AGENTS }]
  assert.equal((await codingAgent(undefined, modules)).id, 'claude-code')
  assert.equal((await codingAgent('codex', modules)).id, 'codex')
  await assert.rejects(codingAgent('cursor', modules), /^Error: No coding agent is named cursor: the coding agents are claude-code and codex\.$/)
  await assert.rejects(codingAgent(undefined, []), /No coding agent was handed down to this process/)
})

test('with no modules given, the agents are those of the distribution handed down to this process, and none where none was', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agents-'))
  const before = process.env[DISTRIBUTION_ENV]
  try {
    delete process.env[DISTRIBUTION_ENV]
    assert.deepEqual(await codingAgents(), [])
    const handBack = await handDownAgents(dir)
    try {
      assert.deepEqual((await codingAgents()).map(agent => agent.id), ['claude-code', 'codex'])
    } finally {
      handBack()
    }
  } finally {
    if (before === undefined) delete process.env[DISTRIBUTION_ENV]
    else process.env[DISTRIBUTION_ENV] = before
    await rm(dir, { recursive: true, force: true })
  }
})
