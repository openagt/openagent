import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountRotation } from '@openagt/hooks'
import { CodexDriver, type CodexDriverOptions } from './codex.js'
import module, { codexAgent } from './module.js'

// Codex as the coding agent a run is on: what its module fills `run.agent` with.

const personal = { memory: true, connectors: true, skills: true }
const notRoot = () => false

test("a run's driver has Codex's full access, in the run's environment, with this machine's setup parts and the accounts its turns take", () => {
  const agent = codexAgent()
  assert.deepEqual([agent.id, agent.label, agent.accounts?.list, agent.ownQuestionTool], ['codex', 'Codex', 'codex', undefined])
  const accounts: AccountRotation = { first: () => undefined, turn: async () => ({ text: '' }) }
  const driver = agent.driver({ env: { AGENT_ID: 'run-1' }, personal, accounts })
  assert.ok(driver instanceof CodexDriver)
  const opts = (driver as unknown as { opts: CodexDriverOptions }).opts
  assert.equal(opts.sandbox, 'danger-full-access', 'the default sandbox would keep the agent from pushing its branch and opening its pull request')
  assert.equal(opts.env?.['AGENT_ID'], 'run-1')
  assert.deepEqual(opts.personal, personal)
  assert.equal(opts.accounts, accounts)
  assert.equal(driver.namingModel, 'gpt-5.6-luna', 'a run is named on its smallest model')
  assert.deepEqual(module.hooks['run.agent']?.map(one => one.id), ['codex'])
})

test('ready: logged out stops a run, unless an account was added to its list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-agent-'))
  try {
    const probe = async (_bin: string, args: readonly string[]) => ({ ok: args[0] === '--version', output: args[0] === '--version' ? '1.0.0' : 'Not logged in' })
    const checks = { probe, isRoot: notRoot, agentsSkills: join(dir, 'no-such-dir') }
    assert.equal((await codexAgent(checks).ready({ personal, addedAccount: false })).problems.length, 1)
    assert.deepEqual((await codexAgent(checks).ready({ personal, addedAccount: true })).problems, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("ready: skills in ~/.agents/skills are no warning while runs load the person's skills, and a warning once this machine turns them off", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-agent-'))
  try {
    const agentsSkills = join(dir, 'agents-skills')
    await mkdir(join(agentsSkills, 'my-skill'), { recursive: true })
    const agent = codexAgent({ probe: async (_bin, args) => ({ ok: true, output: args[0] === '--version' ? '0.144.4' : 'Logged in' }), isRoot: notRoot, agentsSkills })
    assert.deepEqual(await agent.ready({ personal, addedAccount: false }), { problems: [], warnings: [] })
    const out = await agent.ready({ personal: { ...personal, skills: false }, addedAccount: false })
    assert.deepEqual(out.problems, [])
    assert.match(out.warnings[0]!, /no switch/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a session is picked back up in a terminal by Codex's own command, in the folder it ran in", () => {
  const agent = codexAgent()
  assert.equal(agent.resumeCommand?.({ id: 'sess-1', cwd: '/repo/w' }), "mkdir -p '/repo/w' && cd '/repo/w' && codex resume sess-1")
  assert.equal(agent.resumeCommand?.({ id: 'sess-1' }), 'codex resume sess-1')
})
