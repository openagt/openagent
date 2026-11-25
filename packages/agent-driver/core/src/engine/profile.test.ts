import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { PLUGINS_WITHOUT_ENV, PROFILE_ENV, PROJECT_SKILLS_ENV } from './names.js'
import { sessionsHome } from '@openagt/git-branches'
import { PROFILES, chainStore, settingsIn } from '@openagt/hooks'
import { memorySettings } from '@openagt/hooks/testing'
import { accountsPath, addAccount } from '../accounts/accounts.js'
import { anyPick, profileNamed, runProfile, sessionPicksNamed } from './profile.js'
import { accountsOn, profileLoginFor } from './runner.js'
import { gitHostEnv } from './git-host.js'
import { testLogins } from './run-test-support.js'
import { git, handDownDistribution, removeRepo, testRepo } from './test-repo.js'

test('the profile a run is on is read off the environment by its id; Default is none; a word that is no id is refused', () => {
  assert.equal(profileNamed({}), undefined)
  assert.equal(profileNamed({ [PROFILE_ENV]: '' }), undefined)
  assert.equal(profileNamed({ [PROFILE_ENV]: 'default' }), undefined)
  assert.equal(profileNamed({ [PROFILE_ENV]: ' reviewer ' }), 'reviewer')
  assert.throws(() => profileNamed({ [PROFILE_ENV]: 'Not An Id' }), /no profile id/)
})

test("a session's picks are read off the environment: the plugins it goes without, which of the project's skills stay; nothing set is no pick, but the plugins set to nothing are none of them; a word that is no plugin's or skill's name is refused", () => {
  assert.deepEqual(sessionPicksNamed({}), {})
  assert.equal(anyPick(sessionPicksNamed({ [PROJECT_SKILLS_ENV]: ' ' })), false, 'blank is nothing said')
  assert.deepEqual(sessionPicksNamed({ [PLUGINS_WITHOUT_ENV]: '' }), { without: [] }, "the plugins set to nothing: none of them, over the profile's")
  assert.deepEqual(sessionPicksNamed({ [PROJECT_SKILLS_ENV]: 'all' }), { project: 'all' }, "every project skill, over the profile's")
  assert.deepEqual(sessionPicksNamed({ [PLUGINS_WITHOUT_ENV]: 'ask, tickets,ask', [PROJECT_SKILLS_ENV]: 'none' }), { without: ['ask', 'tickets'], project: 'none' })
  assert.deepEqual(sessionPicksNamed({ [PROJECT_SKILLS_ENV]: 'deploy,lint' }), { project: ['deploy', 'lint'] })
  assert.throws(() => sessionPicksNamed({ [PLUGINS_WITHOUT_ENV]: 'Not A Plugin' }), /OPENAGENT_PLUGINS_WITHOUT is no list of plugin names: Not A Plugin/)
  assert.throws(() => sessionPicksNamed({ [PROJECT_SKILLS_ENV]: '../x' }), /OPENAGENT_PROJECT_SKILLS is no list of skill names/)
})

test('the profile named is read through the store; one this computer does not have is Default, said; none named is Default; a store that cannot be read has only Default', async () => {
  const settings = memorySettings()
  const reviewer = { id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] } } }
  await settings.set(PROFILES, [reviewer])
  const said: string[] = []
  const log = (line: string): void => void said.push(line)
  assert.deepEqual(await runProfile('reviewer', settings, log), reviewer)
  assert.deepEqual(await runProfile(undefined, settings, log), { id: 'default', name: 'Default', options: {} })
  assert.deepEqual(said, [])
  assert.deepEqual(await runProfile('gone', settings, log), { id: 'default', name: 'Default', options: {} })
  assert.match(said[0]!, /no profile gone on this computer: the run is on Default/)
  // A chain with no backend refuses every read.
  assert.deepEqual(await runProfile('reviewer', settingsIn(chainStore([])), log), { id: 'default', name: 'Default', options: {} })
})

test('a profile\'s Claude and Codex accounts apply where this computer has them: the ones here, in the profile\'s order; none here, or none named, is every account of the computer\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-agent-accounts-'))
  const env = { XDG_CONFIG_HOME: dir }
  try {
    addAccount('Dani', 'x', accountsPath('claude', env))
    addAccount('Rom', 'y', accountsPath('claude', env))
    addAccount('Rom', 'z', accountsPath('codex', env))
    const claude = { accounts: testLogins('claude') }
    const codex = { accounts: testLogins('codex') }
    assert.equal(accountsOn({ options: {} }, claude, env), undefined)
    const both = { options: { 'agent-driver': { claude: ['Rom', 'Dani', 'Nobody'], codex: ['Dani'] } } }
    assert.deepEqual(accountsOn(both, claude, env), ['Rom', 'Dani'])
    assert.equal(accountsOn(both, codex, env), undefined, "a Codex account not here: all of the computer's Codex accounts")
    assert.deepEqual(accountsOn({ options: { 'agent-driver': { codex: ['Rom'] } } }, codex, env), ['Rom'])
    assert.equal(accountsOn(both, {}, env), undefined, 'an agent with no list of accounts takes none')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a profile's GitHub account applies where the project has a git host, and in a session with no project; in a project on another host, or a folder that is neither, the run goes as no account", async () => {
  const repo = await testRepo()
  const home = await mkdtemp(join(tmpdir(), 'oa-sessions-'))
  // The git host is the distribution's github, as OpenAgent hands its distribution down to a run.
  const handBack = await handDownDistribution(home, { '@openagt/github': dirname(createRequire(import.meta.url).resolve('@openagt/github/package.json')) })
  // The sessions home is beside the personal folder, under the configuration's.
  const config = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(home, 'config')
  try {
    await git(['remote', 'set-url', 'origin', 'git@github.com:someone/project.git'], repo)
    assert.equal(await profileLoginFor(repo, { options: { github: { account: 'octo-agent' } } }), 'octo-agent')
    assert.equal(await profileLoginFor(repo, { options: {} }), undefined)
    await git(['remote', 'set-url', 'origin', 'https://gitlab.com/someone/project.git'], repo)
    assert.equal(await profileLoginFor(repo, { options: { github: { account: 'octo-agent' } } }), undefined, 'not on GitHub')
    assert.equal(await profileLoginFor(home, { options: { github: { account: 'octo-agent' } } }), undefined, 'a folder that is no project and no session')
    assert.equal(await profileLoginFor(sessionsHome(), { options: { github: { account: 'octo-agent' } } }), 'octo-agent', 'a session with no project may reach GitHub all the same')
    assert.equal(await profileLoginFor(sessionsHome(), { options: {} }), undefined)
  } finally {
    if (config === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = config
    handBack()
    await removeRepo(repo)
    await rm(home, { recursive: true, force: true })
  }
})

test("a session with no project is given its account's environment by the distribution's git host, its folder being on none: no account named and none there, nothing and no refusal; one named that is not there, refused", async () => {
  const home = await mkdtemp(join(tmpdir(), 'oa-sessions-'))
  const handBack = await handDownDistribution(home, { '@openagt/github': dirname(createRequire(import.meta.url).resolve('@openagt/github/package.json')) })
  const config = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(home, 'config')
  try {
    assert.deepEqual(await gitHostEnv(sessionsHome()), { ok: true, env: {} })
    const refused = await gitHostEnv(sessionsHome(), 'stranger')
    assert.equal(refused.ok, false)
    assert.match(refused.ok ? '' : refused.error, /no GitHub account stranger/)
  } finally {
    if (config === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = config
    handBack()
    await rm(home, { recursive: true, force: true })
  }
})
