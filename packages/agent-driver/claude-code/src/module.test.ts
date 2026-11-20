import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AccountRotation } from '@openagt/hooks'
import { ClaudeCodeDriver, type ClaudeCodeDriverOptions } from './claude-code.js'
import module, { claudeCodeAgent } from './module.js'

// Claude Code as the coding agent a run is on: what its module fills `run.agent` with.

const personal = { memory: true, connectors: false, skills: false }
const notRoot = () => false

test("a run's driver bypasses Claude Code's permission prompts, in the run's environment, with this machine's setup parts and the accounts its turns take", () => {
  const agent = claudeCodeAgent()
  assert.deepEqual([agent.id, agent.label, agent.accounts, agent.ownQuestionTool], ['claude-code', 'Claude Code', 'claude', true])
  const accounts: AccountRotation = { first: () => undefined, turn: async () => ({ text: '' }) }
  const driver = agent.driver({ env: { AGENT_ID: 'run-1' }, personal, accounts })
  assert.ok(driver instanceof ClaudeCodeDriver)
  const opts = (driver as unknown as { opts: ClaudeCodeDriverOptions }).opts
  assert.equal(opts.permissionMode, 'bypassPermissions')
  assert.equal(opts.env?.['AGENT_ID'], 'run-1')
  assert.deepEqual(opts.personal, personal)
  assert.equal(opts.accounts, accounts)
  assert.equal(driver.namingModel, 'haiku', 'a run is named on its smallest model')
  assert.deepEqual(module.hooks['run.agent']?.map(one => one.id), ['claude-code'])
})

test('ready: only its CLI is asked; logged out stops a run, unless an account was added to its list', async () => {
  const probed: string[] = []
  const answers = (loggedIn: boolean) => async (bin: string, args: readonly string[]) => {
    probed.push(bin)
    return { ok: true, output: args[0] === '--version' ? '2.1.0' : JSON.stringify({ loggedIn }) }
  }
  assert.deepEqual(await claudeCodeAgent({ probe: answers(true), isRoot: notRoot }).ready({ personal, addedAccount: false }), { problems: [], warnings: [] })
  assert.ok(probed.every(bin => bin === 'claude'), `only the coding agent's CLI is asked, not ${probed.join(', ')}`)
  const out = await claudeCodeAgent({ probe: answers(false), isRoot: notRoot }).ready({ personal, addedAccount: false })
  assert.match(out.problems[0]!, /claude auth login/)
  assert.deepEqual(await claudeCodeAgent({ probe: answers(false), isRoot: notRoot }).ready({ personal, addedAccount: true }), { problems: [], warnings: [], ownLoggedOut: true })
})
