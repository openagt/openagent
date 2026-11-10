import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProvidedCommand } from '@openagt/agent-data'
import { accountsPath, addAccount } from '@openagt/skill-account-rotation'
import { accountsWiring } from './accounts.js'
import { loginsWiring } from './logins.js'
import { onAgentLogins, onAgentsList, sendCopyAgentLogins, sendRemoveAgent, sendSaveAgent } from './agents.js'
import { provideTestContext } from './test-context.js'

// The agents through the dashboard's own calls: the personal folder under a temp $XDG_CONFIG_HOME,
// GitHub's accounts as the host's package would answer them, the coding agents' accounts in temp files.

async function withComputer(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-agents-rpc-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const before = { ...loginsWiring }
  const accountsBefore = { ...accountsWiring }
  Object.assign(accountsWiring, { path: (agent: string) => join(dir, `${agent}-accounts.json`), claudeJson: () => join(dir, 'none.json'), codexOwnHome: () => join(dir, 'codex'), codexWho: async () => ({}), codexUsage: async () => [], computer: () => 'Studio' })
  provideTestContext({ quota: { read: async () => ({ windows: [] }), stop: () => {} } })
  Object.assign(loginsWiring, {
    home: () => dir,
    gitHost: async () => ({ package: '@openagt/skill-github', command: 'github', dir } as unknown as ProvidedCommand),
    run: async (_root: string, _command: ProvidedCommand, args: readonly string[]) =>
      args[0] === 'accounts'
        ? { ok: true, output: { ok: true, host: 'github.com', name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts: [{ login: 'octo', terminal: false, runs: true, ok: true }, { login: 'octo-agent', terminal: false, runs: false, ok: true }, { login: 'stale', terminal: false, runs: false, ok: false }] } }
        : { ok: false, error: 'not asked here' },
  })
  try {
    await body(dir)
  } finally {
    Object.assign(loginsWiring, before)
    Object.assign(accountsWiring, accountsBefore)
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the agents, the skills to pick from and the accounts this computer knows; an agent saved, edited, and removed, the default never; what is not on this computer is refused', () =>
  withComputer(async dir => {
    addAccount('Dani', 'sk-ant-oat01-dani', accountsPath('claude', { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }))
    accountsWiring.path = () => accountsPath('claude', { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME })
    let view = await onAgentsList()
    assert.deepEqual(view.agents, [{ id: 'default', name: 'Default', skills: ['ask', 'github'], accounts: {}, projectSkills: true }])
    assert.deepEqual(view.skills[0], { title: 'Every agent starts with', skills: [{ name: 'ask', description: view.skills[0]!.skills[0]!.description }, { name: 'github', description: view.skills[0]!.skills[1]!.description }] })
    assert.ok(view.skills[0]!.skills.every(skill => skill.description.length > 0), 'each default skill says what it is')
    assert.ok(view.skills.some(group => group.skills.some(skill => skill.name === 'reply')), 'the catalogue is there')
    assert.deepEqual(view.github, { host: 'github.com', accounts: ['octo', 'octo-agent'] }, 'a login GitHub no longer takes is not offered, and one more is added at the host')
    assert.ok(view.claude.some(account => account.id === 'Dani'))

    // Saved under the id its name gives; a second one of that name is refused.
    const saved = await sendSaveAgent({ name: 'Social Media', skills: ['ask', 'reply'], accounts: { github: 'octo-agent', claude: ['Dani'] }, projectSkills: false })
    assert.deepEqual(saved, { ok: true, id: 'social-media' })
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cfg', 'openagent', 'agents', 'social-media.json'), 'utf8')), { name: 'Social Media', skills: ['ask', 'reply'], accounts: { github: 'octo-agent', claude: ['Dani'] }, projectSkills: false })
    assert.equal((await sendSaveAgent({ name: 'social media', skills: [], accounts: {}, projectSkills: true })).ok, false)
    view = await onAgentsList()
    assert.deepEqual(view.agents.map(agent => agent.id), ['default', 'social-media'])
    // Edited under its own id, renamed too; the default keeps its name.
    assert.deepEqual(await sendSaveAgent({ id: 'social-media', name: 'Social', skills: ['ask'], accounts: {}, projectSkills: true }), { ok: true, id: 'social-media' })
    assert.deepEqual((await onAgentsList()).agents[1], { id: 'social-media', name: 'Social', skills: ['ask'], accounts: {}, projectSkills: true })
    assert.deepEqual(await sendSaveAgent({ id: 'default', name: 'Default', skills: ['ask'], accounts: { github: 'octo' }, projectSkills: true }), { ok: true, id: 'default' })
    assert.deepEqual((await onAgentsList()).agents[0], { id: 'default', name: 'Default', skills: ['ask'], accounts: { github: 'octo' }, projectSkills: true })
    assert.equal((await sendSaveAgent({ id: 'default', name: 'Boss', skills: [], accounts: {}, projectSkills: true })).ok, false)
    assert.match((await sendSaveAgent({ name: 'Odd', skills: [], accounts: {}, projectSkills: 'no' as never }) as { error: string }).error, /yes or no/)
    // What is not here: a skill nothing carries, a GitHub account OpenAgent lacks or no longer takes, a Claude account not on this computer, an agent gone.
    assert.match((await sendSaveAgent({ name: 'Odd', skills: ['no-such-skill'], accounts: {}, projectSkills: true }) as { error: string }).error, /from the list/)
    assert.match((await sendSaveAgent({ name: 'Odd', skills: [], accounts: { github: 'stranger' }, projectSkills: true }) as { error: string }).error, /no GitHub account stranger/)
    assert.match((await sendSaveAgent({ name: 'Odd', skills: [], accounts: { github: 'stale' }, projectSkills: true }) as { error: string }).error, /no GitHub account stale/)
    assert.match((await sendSaveAgent({ name: 'Odd', skills: [], accounts: { claude: ['Nobody'] }, projectSkills: true }) as { error: string }).error, /not on this computer/)
    assert.match((await sendSaveAgent({ id: 'gone', name: 'Gone', skills: [], accounts: {}, projectSkills: true }) as { error: string }).error, /gone/)
    assert.equal((await sendSaveAgent({ name: '!!!', skills: [], accounts: {}, projectSkills: true })).ok, false)

    assert.deepEqual(await sendRemoveAgent('social-media'), { ok: true })
    assert.deepEqual((await onAgentsList()).agents.map(agent => agent.id), ['default'])
    assert.equal((await sendRemoveAgent('default')).ok, false)
    assert.equal((await sendRemoveAgent('../x')).ok, false)
  }))

test('a server copies the agents\' accounts to no device: it says none, and refuses the press', async () => {
  const before = process.env['OPENAGENT_SERVER']
  process.env['OPENAGENT_SERVER'] = '1'
  try {
    assert.deepEqual(await onAgentLogins(), [])
    assert.deepEqual(await sendCopyAgentLogins(), { ok: false, error: 'A server copies logins to no device.' })
  } finally {
    if (before === undefined) delete process.env['OPENAGENT_SERVER']
    else process.env['OPENAGENT_SERVER'] = before
  }
})
