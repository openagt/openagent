import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProvidedCommand } from '@openagt/agent-data'
import { accountsPath, addAccount } from '@openagt/skill-account-rotation'
import { accountsWiring } from './accounts.js'
import { loginsWiring } from './logins.js'
import { onPresetLogins, onPresetsList, sendCopyPresetLogins, sendRemovePreset, sendSavePreset } from './presets.js'
import { provideTestContext } from './test-context.js'
import { handDownTestDistribution } from '../test-distribution.js'

handDownTestDistribution()

// The presets through the dashboard's own calls, saved through the distribution's store: the
// personal folder under a temp $XDG_CONFIG_HOME, GitHub's accounts as the host's package would
// answer them, the coding agents' accounts in temp files.

async function withComputer(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-presets-rpc-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const before = { ...loginsWiring }
  const accountsBefore = { ...accountsWiring }
  Object.assign(accountsWiring, { path: (agent: string) => join(dir, `${agent}-accounts.json`), claudeJson: () => join(dir, 'none.json'), codexOwnHome: () => join(dir, 'codex'), codexWho: async () => ({}), codexUsage: async () => [], computer: () => 'Studio' })
  provideTestContext({ quota: { read: async () => ({ windows: [] }), stop: () => {} } })
  Object.assign(loginsWiring, {
    home: () => dir,
    gitHost: async () => ({ package: '@openagt/github', command: 'github', dir } as unknown as ProvidedCommand),
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

test('the presets and the accounts this computer knows; a preset saved, edited, and removed, Default never; what is not on this computer is refused', () =>
  withComputer(async dir => {
    addAccount('Dani', 'sk-ant-oat01-dani', accountsPath('claude', { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }))
    accountsWiring.path = () => accountsPath('claude', { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME })
    let view = await onPresetsList()
    assert.deepEqual(view.presets, [{ id: 'default', name: 'Default', options: {} }])
    assert.deepEqual(view.github, { host: 'github.com', accounts: ['octo', 'octo-agent'] }, 'a login GitHub no longer takes is not offered, and one more is added at the host')
    assert.ok(view.claude.some(account => account.id === 'Dani'))
    assert.deepEqual(view.claude.filter(account => account.loggedOut).length, 1, "this computer's own login, not logged in here, says so")
    assert.ok(view.plugins.includes('ask') && view.plugins.includes('logs'), 'the plugins a run gets a skill or a step from, wherever they are on')
    assert.equal(view.plugins.includes('store-git-repository'), false, 'not one a run gets nothing from')

    // Saved under the id its name gives, with the person; a second name that gives that id is refused, naming the preset that has it.
    const saved = await sendSavePreset({ name: 'Social Media', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'], model: 'opus' }, skills: { project: 'none' } } })
    assert.deepEqual(saved, { ok: true, id: 'social-media' })
    const kept = JSON.parse(readFileSync(join(dir, 'cfg', 'openagent', 'person', 'settings.json'), 'utf8'))
    assert.deepEqual(kept['presets.saved'], [{ id: 'social-media', name: 'Social Media', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] }, skills: { project: 'none' } } }], 'only the options a preset holds')
    assert.deepEqual(await sendSavePreset({ name: 'social media!', options: {} }), { ok: false, error: 'There is a preset Social Media already: pick another name.', field: 'name' })
    view = await onPresetsList()
    assert.deepEqual(view.presets.map(preset => preset.id), ['default', 'social-media'])
    // Edited under its own id, renamed too; Default keeps its name.
    assert.deepEqual(await sendSavePreset({ id: 'social-media', name: 'Social', options: { plugins: { without: ['logs', 'ask', 'logs'] } } }), { ok: true, id: 'social-media' })
    assert.deepEqual((await onPresetsList()).presets[1], { id: 'social-media', name: 'Social', options: { plugins: { without: ['logs', 'ask'] } } }, 'the plugins its runs go without')
    assert.deepEqual(await sendSavePreset({ id: 'social-media', name: 'Social', options: { plugins: { without: [] } } }), { ok: true, id: 'social-media' })
    assert.deepEqual((await onPresetsList()).presets[1], { id: 'social-media', name: 'Social', options: {} })
    assert.deepEqual(await sendSavePreset({ id: 'default', name: 'Default', options: { github: { account: 'octo' } } }), { ok: true, id: 'default' })
    assert.deepEqual((await onPresetsList()).presets[0], { id: 'default', name: 'Default', options: { github: { account: 'octo' } } })
    assert.deepEqual(await sendSavePreset({ id: 'default', name: 'Boss', options: {} }), { ok: false, error: 'Default keeps its name.', field: 'name' })
    assert.deepEqual(await sendSavePreset({ name: 'Default', options: {} }), { ok: false, error: 'There is a preset Default already: pick another name.', field: 'name' })
    // What is not here: a GitHub account OpenAgent lacks or no longer takes, a Claude account not on this computer, project skills that are no names, a preset gone.
    assert.match((await sendSavePreset({ name: 'Odd', options: { github: { account: 'stranger' } } }) as { error: string }).error, /no GitHub account stranger/)
    assert.match((await sendSavePreset({ name: 'Odd', options: { github: { account: 'stale' } } }) as { error: string }).error, /no GitHub account stale/)
    assert.match((await sendSavePreset({ name: 'Odd', options: { 'agent-driver': { claude: ['Nobody'] } } }) as { error: string }).error, /not on this computer/)
    assert.match((await sendSavePreset({ name: 'Odd', options: { skills: { project: ['Not A Skill'] } } }) as { error: string }).error, /none, or named by their names/)
    assert.match((await sendSavePreset({ name: 'Odd', options: { plugins: { without: ['store-git-repository'] } } }) as { error: string }).error, /not one a run gets anything from/)
    assert.match((await sendSavePreset({ name: 'Odd', options: { plugins: { without: ['nothing-here'] } } }) as { error: string }).error, /not one a run gets anything from/)
    assert.match((await sendSavePreset({ id: 'gone', name: 'Gone', options: {} }) as { error: string }).error, /gone/)
    assert.equal((await sendSavePreset({ name: '!!!', options: {} })).ok, false)

    assert.deepEqual(await sendRemovePreset('social-media'), { ok: true })
    assert.deepEqual((await onPresetsList()).presets.map(preset => preset.id), ['default'])
    assert.equal((await sendRemovePreset('default')).ok, false)
    assert.equal((await sendRemovePreset('../x')).ok, false)
  }))

test('a server copies the presets\' accounts to no device: it says none, and refuses the press', async () => {
  const before = process.env['OPENAGENT_SERVER']
  process.env['OPENAGENT_SERVER'] = '1'
  try {
    assert.deepEqual(await onPresetLogins(), [])
    assert.deepEqual(await sendCopyPresetLogins(), { ok: false, error: 'A server copies logins to no device.' })
  } finally {
    if (before === undefined) delete process.env['OPENAGENT_SERVER']
    else process.env['OPENAGENT_SERVER'] = before
  }
})
