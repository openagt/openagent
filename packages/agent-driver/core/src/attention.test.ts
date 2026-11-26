import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PICKED_AGENT } from '@openagt/hooks'
import { memorySettings } from '@openagt/hooks/testing'
import { agentAttention } from './attention.js'
import { agentOfItem, agentOfUpdate } from './attention-items.js'
import type { AgentState } from './setup.js'

/** No coding agent with a newer version out: the tests never ask npm. */
const NO_UPDATES = async () => []

const CLAUDE: AgentState = { agent: 'claude-code', label: 'Claude Code', list: 'claude', ready: true }
const CODEX_OUT: AgentState = { agent: 'codex', label: 'Codex', list: 'codex', ready: false, problem: '`codex` is not logged in.' }
const CLAUDE_MISSING: AgentState = { agent: 'claude-code', label: 'Claude Code', list: 'claude', ready: false, problem: '`claude` not found', fix: { kind: 'install', command: 'curl -fsSL https://claude.ai/install.sh | bash', problem: '`claude` not found' } }

test('with no coding agent that can run here, one to connect is about this computer, fixed by the window an account is added in', async () => {
  const items = await agentAttention({}, memorySettings(), async () => [CLAUDE_MISSING, CODEX_OUT], NO_UPDATES)
  assert.deepEqual(items, [
    {
      kind: 'setup',
      scope: 'computer',
      id: 'connect',
      words: 'Connect a coding agent',
      detail: 'Sessions run on Claude Code or Codex, with your own account. One is enough; add the other any time.',
      fix: { label: 'Connect a coding agent…', action: 'connect' },
    },
  ])
  assert.deepEqual(await agentAttention({}, memorySettings(), async () => [CLAUDE, CODEX_OUT], NO_UPDATES), [], 'one that can run is enough')
})

test("asked with the launcher's picks, what stops the agent they would run on is about the run to start: the one named, else the one picked for every next run, else the first", async () => {
  const settings = memorySettings()
  const states = async () => [CLAUDE, CODEX_OUT]
  assert.deepEqual(await agentAttention({ options: {} }, settings, states), [], 'the first can run')
  const codex = { kind: 'setup', scope: 'run', id: 'agent:codex', words: 'Codex is not logged in.', detail: '`codex` is not logged in.', fix: { label: 'Add account', action: 'connect' } }
  assert.deepEqual(await agentAttention({ options: { 'agent-driver': { driver: 'codex' } } }, settings, states), [codex])
  await settings.set(PICKED_AGENT, { driver: 'codex' })
  assert.deepEqual(await agentAttention({ options: {} }, settings, states), [codex])
  assert.deepEqual(await agentAttention({ options: { 'agent-driver': { driver: 'claude-code' } } }, settings, states), [], 'the run names its own')
  assert.equal(agentOfItem(codex.id), 'codex')
})

test("an agent whose program is missing is installed by its package's command, said under its words; while it installs, there is nothing to press", async () => {
  const items = await agentAttention({ options: {} }, memorySettings(), async () => [CLAUDE_MISSING, { ...CODEX_OUT, ready: true }])
  assert.deepEqual(items, [{ kind: 'setup', scope: 'run', id: 'agent:claude-code', words: 'Claude Code is not installed.', detail: '`curl -fsSL https://claude.ai/install.sh | bash`', fix: { label: 'Install Claude Code', action: 'install' } }])
  const installing = await agentAttention({ options: {} }, memorySettings(), async () => [{ ...CLAUDE_MISSING, fixing: 'install' }, { ...CODEX_OUT, ready: true }])
  assert.deepEqual(installing, [{ kind: 'setup', scope: 'run', id: 'agent:claude-code', words: 'Installing Claude Code…', detail: '`curl -fsSL https://claude.ai/install.sh | bash`' }])
  const failed = await agentAttention({ options: {} }, memorySettings(), async () => [{ ...CLAUDE_MISSING, failed: 'curl: (6) Could not resolve host' }, { ...CODEX_OUT, ready: true }])
  assert.equal(failed[0]?.detail, '`curl -fsSL https://claude.ai/install.sh | bash` curl: (6) Could not resolve host')
})

test('asked about this computer alone, each agent with a newer version out is a note, offering its update; while it updates there is nothing to press; never asked with a project or picks', async () => {
  const codex = { agent: 'codex', label: 'Codex', installed: '0.171.0', latest: '0.172.0', command: 'codex update' }
  const asked: string[] = []
  const updates = async () => (asked.push('read'), [codex])
  assert.deepEqual(await agentAttention({}, memorySettings(), async () => [CLAUDE], updates), [
    { kind: 'note', scope: 'computer', id: 'update:codex', words: 'Codex 0.172.0 is out', detail: 'Codex 0.172.0 is out. This computer has 0.171.0.', fix: { label: 'Update Codex to 0.172.0', action: 'update' } },
  ])
  assert.equal(agentOfUpdate('update:codex'), 'codex')
  assert.deepEqual(await agentAttention({}, memorySettings(), async () => [CLAUDE], async () => [{ ...codex, updating: true as const }]), [
    { kind: 'note', scope: 'computer', id: 'update:codex', words: 'Updating Codex…', detail: 'Codex 0.172.0 is out. This computer has 0.171.0.' },
  ])
  assert.deepEqual(await agentAttention({ options: {} }, memorySettings(), async () => [CLAUDE], updates), [])
  assert.deepEqual(await agentAttention({ project: { id: 'p', name: 'p', dir: '/p' } }, memorySettings(), async () => [CLAUDE], updates), [])
  assert.deepEqual(asked, ['read', ], 'only the reads about this computer ask')
})
