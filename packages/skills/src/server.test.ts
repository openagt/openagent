import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PICKED_PROFILE, PROFILES } from '@openagt/hooks'
import { rpcKind, type ModuleOn } from '@openagt/hooks/rpc'
import { memorySettings, rpcHost } from '@openagt/hooks/testing'
import { commands, skillChoices } from './server.js'

// What the gear's Skills line picks from, and the commands the message box offers, as skills'
// server part reads them: the modules on as the host says them, the profiles in a memory store,
// the project's own skills in a real repository.

const git = async (root: string, ...args: string[]): Promise<string> =>
  (await promisify(execFile)('git', ['-c', 'user.name=tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root })).stdout

async function skill(root: string, name: string, command: boolean): Promise<void> {
  await mkdir(join(root, '.agents', 'skills', name), { recursive: true })
  await writeFile(join(root, '.agents', 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} it.\n${command ? 'disable-model-invocation: true\n' : ''}---\nDo it.\n`)
}

/** A repository on `main`, with an origin whose default branch is it. */
async function repository(): Promise<{ root: string; done: () => Promise<void> }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skills-server-')))
  const root = join(dir, 'shop')
  const origin = join(dir, 'origin.git')
  await mkdir(root)
  await git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  await git(root, 'init', '-q', '-b', 'main')
  await git(root, 'commit', '-q', '--allow-empty', '-m', 'first')
  await git(root, 'remote', 'add', 'origin', origin)
  await git(root, 'push', '-q', 'origin', 'main')
  await git(root, 'fetch', '-q', 'origin')
  await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  return { root, done: () => rm(dir, { recursive: true, force: true }) }
}

const MODULES: ModuleOn[] = [
  { name: 'github', plugin: false, skills: ['github'], steps: true },
  { name: 'git-branches', plugin: false, skills: [], steps: true },
  { name: 'ask', plugin: true, skills: ['ask'], steps: false },
  { name: 'notify', plugin: true, skills: [], steps: true },
  { name: 'store-git-repository', plugin: true, skills: [], steps: false },
]

test('both only read', () => {
  for (const fn of [skillChoices, commands]) assert.equal(rpcKind(fn), 'read')
})

test("a session picks from the plugins on that give its runs a skill or a step; the core modules' skills are no pick; the project's own skills, committed, are listed", async () => {
  const { root, done } = await repository()
  try {
    await skill(root, 'plan', true)
    await skill(root, 'style', false)
    await git(root, 'add', '-A')
    await git(root, 'commit', '-q', '-m', 'skills')
    const asked: unknown[] = []
    const host = rpcHost({ root, modulesOn: async opts => (asked.push(opts), MODULES) })
    const choices = await skillChoices(host, {})
    assert.deepEqual(choices, { core: ['github'], plugins: [{ name: 'ask', skills: ['ask'] }, { name: 'notify', skills: [] }], project: ['plan', 'style'], profile: {} })
    // A profile's editor asks for every plugin, off ones too.
    await skillChoices(host, { every: true })
    assert.deepEqual(asked, [{ every: false }, { every: true }])
    // With no project, no project skills.
    assert.deepEqual((await skillChoices(rpcHost({ root, project: async () => undefined, modulesOn: async () => MODULES }), {})).project, [])
  } finally {
    await done()
  }
})

test('what the profile in force has of the skills: the one named, else the one picked for every next run, else Default', async () => {
  const settings = memorySettings()
  await settings.set(PROFILES, [
    { id: 'quiet', name: 'Quiet', options: { skills: { project: 'none' } } },
    { id: 'lean', name: 'Lean', options: { plugins: { without: ['ask'] } } },
  ])
  const host = rpcHost({ settings, project: async () => undefined })
  assert.deepEqual((await skillChoices(host, {})).profile, {}, 'Default, as built in')
  await settings.set(PICKED_PROFILE, 'lean')
  assert.deepEqual((await skillChoices(host, {})).profile, { without: ['ask'] })
  assert.deepEqual((await skillChoices(host, { profile: 'quiet' })).profile, { project: 'none' })
  assert.deepEqual((await skillChoices(host, { profile: 'default' })).profile, {})
  assert.deepEqual((await skillChoices(host, { profile: 'gone' })).profile, {}, 'a profile not here is Default')
})

test("the box's commands are the project's command skills, each waiting while it is not on the branch runs start from; none with no project", async () => {
  const { root, done } = await repository()
  try {
    await skill(root, 'plan', true)
    await skill(root, 'style', false)
    await git(root, 'add', '-A')
    await git(root, 'commit', '-q', '-m', 'skills')
    await git(root, 'push', '-q', 'origin', 'main')
    await git(root, 'fetch', '-q', 'origin')
    await skill(root, 'ship', true)
    const host = rpcHost({ root })
    assert.deepEqual(await commands(host, {}), [{ name: 'plan', description: 'plan it.' }, { name: 'ship', description: 'ship it.', waiting: 'main' }])
    assert.deepEqual(await commands(rpcHost({ root, project: async () => undefined }), {}), [])
  } finally {
    await done()
  }
})
