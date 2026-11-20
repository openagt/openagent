import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineModule, DISTRIBUTION_ENV, type RunAgent } from '@openagt/hooks'
import { codingAgent, codingAgents } from './agents.js'

// The coding agents a run can be on: those its distribution's modules bring, by their ids.

const agent = (id: string): RunAgent => ({
  id,
  label: id,
  ready: async () => ({ problems: [], warnings: [] }),
  driver: () => {
    throw new Error('these tests run no agent')
  },
})

const AGENTS = defineModule({ name: 'test-agents', hooks: { 'run.agent': [agent('claude-code'), agent('codex')] } })

test("a run named no coding agent is on its distribution's first; one named, on that one; one the distribution has not is refused, naming the ones it has", async () => {
  const modules = [{ module: AGENTS }]
  assert.equal((await codingAgent(undefined, modules)).id, 'claude-code')
  assert.equal((await codingAgent('codex', modules)).id, 'codex')
  await assert.rejects(codingAgent('cursor', modules), /^Error: No coding agent is named cursor: the coding agents are claude-code and codex\.$/)
  await assert.rejects(codingAgent(undefined, []), /No coding agent was handed down to this process/)
})

test('with no modules given, the agents are those of the distribution handed down to this process, read once for each file, and none where none was', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agents-'))
  const before = process.env[DISTRIBUTION_ENV]
  try {
    delete process.env[DISTRIBUTION_ENV]
    assert.deepEqual(await codingAgents(), [])
    const file = join(dir, 'distribution.mjs')
    await writeFile(
      file,
      [
        "const agent = id => ({ id, label: id, ready: async () => ({ problems: [], warnings: [] }), driver: () => { throw new Error('these tests run no agent') } })",
        "export default [{ module: { name: 'test-agents', hooks: { 'run.agent': [agent('claude-code'), agent('codex')] } } }]",
        '',
      ].join('\n'),
    )
    process.env[DISTRIBUTION_ENV] = file
    assert.deepEqual((await codingAgents()).map(one => one.id), ['claude-code', 'codex'])
    assert.equal(await codingAgents(), await codingAgents(), 'the same answer, not read again')
  } finally {
    if (before === undefined) delete process.env[DISTRIBUTION_ENV]
    else process.env[DISTRIBUTION_ENV] = before
    await rm(dir, { recursive: true, force: true })
  }
})
