import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_ENV, writeAgent } from '@openagt/agent-data'
import { accountsPath, addAccount } from '@openagt/skill-account-rotation'
import { agentNamed, runAgent } from './agent.js'
import { accountsOn } from './runner.js'

test('the agent a run is on is read off the environment by its id; the default is none; a word that is no id is refused', () => {
  assert.equal(agentNamed({}), undefined)
  assert.equal(agentNamed({ [AGENT_ENV]: '' }), undefined)
  assert.equal(agentNamed({ [AGENT_ENV]: 'default' }), undefined)
  assert.equal(agentNamed({ [AGENT_ENV]: ' reviewer ' }), 'reviewer')
  assert.throws(() => agentNamed({ [AGENT_ENV]: 'Not An Id' }), /no agent id/)
})

test('the agent named is read from the personal folder; one this computer does not have is the default agent, said; none named is the default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-run-agent-'))
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    await writeAgent({ id: 'reviewer', name: 'Reviewer', skills: ['ask', 'readability'], accounts: { github: 'octo-agent', claude: ['Dani'] } })
    const said: string[] = []
    const log = (line: string): void => void said.push(line)
    assert.deepEqual(await runAgent('reviewer', log), { id: 'reviewer', name: 'Reviewer', skills: ['ask', 'readability'], accounts: { github: 'octo-agent', claude: ['Dani'] } })
    assert.deepEqual(await runAgent(undefined, log), { id: 'default', name: 'Default', skills: ['ask', 'github'], accounts: {} })
    assert.deepEqual(said, [])
    assert.deepEqual(await runAgent('gone', log), { id: 'default', name: 'Default', skills: ['ask', 'github'], accounts: {} })
    assert.match(said[0]!, /no agent gone on this computer: the run is on the default agent/)
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    await rm(dir, { recursive: true, force: true })
  }
})

test('an agent\'s Claude and Codex accounts apply where this computer has them: the ones here, in the agent\'s order; none here, or none named, is every account of the computer\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-agent-accounts-'))
  const env = { XDG_CONFIG_HOME: dir }
  try {
    addAccount('Dani', 'x', accountsPath('claude', env))
    addAccount('Rom', 'y', accountsPath('claude', env))
    addAccount('Rom', 'z', accountsPath('codex', env))
    assert.deepEqual(accountsOn({ accounts: {} }, env), {})
    assert.deepEqual(accountsOn({ accounts: { claude: ['Rom', 'Dani', 'Nobody'], codex: ['Dani'] } }, env), { claude: ['Rom', 'Dani'] }, 'a Codex account not here: all of the computer\'s Codex accounts')
    assert.deepEqual(accountsOn({ accounts: { codex: ['Rom'] } }, env), { codex: ['Rom'] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
