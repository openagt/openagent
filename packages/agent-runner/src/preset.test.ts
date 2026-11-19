import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRESET_ENV, PROJECT_SKILLS_ENV, SKILLS_OFF_ENV, SKILLS_ON_ENV } from '@openagt/agent-data'
import { PRESETS, chainStore, settingsIn } from '@openagt/hooks'
import { memorySettings } from '@openagt/hooks/testing'
import { accountsPath, addAccount } from '@openagt/skill-account-rotation'
import { anySkillPick, presetNamed, runPreset, skillPicksNamed } from './preset.js'
import { accountsOn, presetLoginFor } from './runner.js'
import { git, handDownBasicSkills, removeRepo, testRepo } from './test-repo.js'

test('the preset a run is on is read off the environment by its id; Default is none; a word that is no id is refused', () => {
  assert.equal(presetNamed({}), undefined)
  assert.equal(presetNamed({ [PRESET_ENV]: '' }), undefined)
  assert.equal(presetNamed({ [PRESET_ENV]: 'default' }), undefined)
  assert.equal(presetNamed({ [PRESET_ENV]: ' reviewer ' }), 'reviewer')
  assert.throws(() => presetNamed({ [PRESET_ENV]: 'Not An Id' }), /no preset id/)
})

test('a session\'s picks of skills are read off the environment: names on, names off, which of the project\'s stay; nothing set is no pick; a word that is no skill name is refused', () => {
  assert.deepEqual(skillPicksNamed({}), {})
  assert.equal(anySkillPick(skillPicksNamed({ [PROJECT_SKILLS_ENV]: ' ', [SKILLS_ON_ENV]: ' ' })), false, 'blank is nothing said')
  assert.deepEqual(skillPicksNamed({ [PROJECT_SKILLS_ENV]: 'all' }), { project: 'all' }, 'every project skill, over the preset\'s')
  assert.deepEqual(skillPicksNamed({ [SKILLS_ON_ENV]: 'review, tickets,review', [SKILLS_OFF_ENV]: 'github', [PROJECT_SKILLS_ENV]: 'none' }), { on: ['review', 'tickets'], off: ['github'], project: 'none' })
  assert.deepEqual(skillPicksNamed({ [PROJECT_SKILLS_ENV]: 'deploy,lint' }), { project: ['deploy', 'lint'] })
  assert.throws(() => skillPicksNamed({ [SKILLS_OFF_ENV]: 'Not A Skill' }), /OPENAGENT_SKILLS_OFF is no list of skill names: Not A Skill/)
  assert.throws(() => skillPicksNamed({ [PROJECT_SKILLS_ENV]: '../x' }), /OPENAGENT_PROJECT_SKILLS is no list/)
})

test('the preset named is read through the store; one this computer does not have is Default, said; none named is Default; a store that cannot be read has only Default', async () => {
  const settings = memorySettings()
  const reviewer = { id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-agent' }, 'agent-driver': { claude: ['Dani'] } } }
  await settings.set(PRESETS, [reviewer])
  const said: string[] = []
  const log = (line: string): void => void said.push(line)
  assert.deepEqual(await runPreset('reviewer', settings, log), reviewer)
  assert.deepEqual(await runPreset(undefined, settings, log), { id: 'default', name: 'Default', options: {} })
  assert.deepEqual(said, [])
  assert.deepEqual(await runPreset('gone', settings, log), { id: 'default', name: 'Default', options: {} })
  assert.match(said[0]!, /no preset gone on this computer: the run is on Default/)
  // A chain with no backend refuses every read.
  assert.deepEqual(await runPreset('reviewer', settingsIn(chainStore([])), log), { id: 'default', name: 'Default', options: {} })
})

test('a preset\'s Claude and Codex accounts apply where this computer has them: the ones here, in the preset\'s order; none here, or none named, is every account of the computer\'s', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-agent-accounts-'))
  const env = { XDG_CONFIG_HOME: dir }
  try {
    addAccount('Dani', 'x', accountsPath('claude', env))
    addAccount('Rom', 'y', accountsPath('claude', env))
    addAccount('Rom', 'z', accountsPath('codex', env))
    assert.deepEqual(accountsOn({ options: {} }, env), {})
    assert.deepEqual(accountsOn({ options: { 'agent-driver': { claude: ['Rom', 'Dani', 'Nobody'], codex: ['Dani'] } } }, env), { claude: ['Rom', 'Dani'] }, 'a Codex account not here: all of the computer\'s Codex accounts')
    assert.deepEqual(accountsOn({ options: { 'agent-driver': { codex: ['Rom'] } } }, env), { codex: ['Rom'] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

handDownBasicSkills()

test('a preset\'s GitHub account applies where the project has a git host; in a session with no project, or a project on another host, the run goes as no account', async () => {
  const repo = await testRepo()
  const home = await mkdtemp(join(tmpdir(), 'oa-sessions-'))
  try {
    await git(['remote', 'set-url', 'origin', 'git@github.com:someone/project.git'], repo)
    assert.equal(await presetLoginFor(repo, { options: { github: { account: 'octo-agent' } } }), 'octo-agent')
    assert.equal(await presetLoginFor(repo, { options: {} }), undefined)
    await git(['remote', 'set-url', 'origin', 'https://gitlab.com/someone/project.git'], repo)
    assert.equal(await presetLoginFor(repo, { options: { github: { account: 'octo-agent' } } }), undefined, 'not on GitHub')
    assert.equal(await presetLoginFor(home, { options: { github: { account: 'octo-agent' } } }), undefined, 'no project at all')
  } finally {
    await removeRepo(repo)
    await rm(home, { recursive: true, force: true })
  }
})
