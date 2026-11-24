import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addProject, listProjects } from '../registry.js'
import type { RunHost } from '@openagt/hooks'
import { fakeHost } from '@openagt/hooks/testing'
import type { ProjectState } from '../project-state.js'
import { provideTestContext } from './test-context.js'
import { onCommands, onProjects, onRunHosts, onStartBranches, onStartCheck, sendAddProject, sendRemoveProject } from './projects.js'
import { SESSIONS_ID } from '../project-address.js'

// Against the real registry, pointed at a temp $XDG_CONFIG_HOME so the user's own is never touched.
async function registered(): Promise<{ dir: string; restore: () => Promise<void> }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-projects-rpc-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
  const project = join(dir, 'app')
  await mkdir(project)
  await addProject(project, new Date().toISOString())
  return {
    dir: project,
    restore: async () => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test('onProjects carries what each project’s state says: its errors, and nothing when there are none; why its data stays here, if it does (#1500)', async () => {
  const { dir, restore } = await registered()
  try {
    let state: ProjectState = { errors: [] }
    const asked: string[] = []
    provideTestContext({ projectState: async project => (asked.push(project.path), state) })

    const clean = await onProjects()
    assert.equal(clean.length, 1)
    assert.equal('errors' in clean[0]!, false, 'a healthy project has no errors field at all')
    assert.deepEqual(asked, [dir], "each project's state is asked by its folder")

    const stranded = { id: 'store-git-branch:data-sync', title: 'Not syncing with the remote', message: 'the data branch could not be pushed: permission denied', since: '2026-08-20T10:00:00.000Z' }
    state = { errors: [stranded] }
    const [listed] = await onProjects()
    assert.deepEqual(listed?.errors, [stranded])
    assert.equal('local' in listed!, false, 'a project whose data reaches its remote carries no note')

    state = { errors: [], local: 'no-remote' }
    assert.equal((await onProjects())[0]?.local, 'no-remote')
    state = { errors: [], local: 'kept' }
    assert.equal((await onProjects())[0]?.local, 'kept')
  } finally {
    await restore()
  }
})

test('onStartBranches lists what origin has now, by asking origin: not the main branch, not the records\' branch, not this clone\'s old copies; and says so where origin cannot be read', async () => {
  const { dir, restore } = await registered()
  const origin = await realpath(await mkdtemp(join(tmpdir(), 'openagent-start-branches-')))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })
  try {
    provideTestContext()
    const id = (await listProjects())[0]!.id
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
    git(dir, 'remote', 'add', 'origin', origin)
    git(dir, 'push', '-q', 'origin', 'main', 'main:agent-data', 'main:agent-fix-it', 'main:feature/x', 'main:old')
    git(dir, 'fetch', '-q', 'origin')
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    git(origin, 'update-ref', '-d', 'refs/heads/old')
    // A branch only this clone has is no published one.
    git(dir, 'branch', 'mine')
    assert.deepEqual(await onStartBranches(id), { branches: ['agent-fix-it', 'feature/x'] })

    git(dir, 'remote', 'set-url', 'origin', join(origin, 'nowhere'))
    assert.deepEqual(await onStartBranches(id), {})
    assert.equal(await onStartBranches('no-such-project'), null)
  } finally {
    await restore()
    await rm(origin, { recursive: true, force: true })
  }
})

// The launcher's branch menu is offered only where the pick would be obeyed: a real
// repository, its branches changed one step at a time.
test('onCommands names the two branches an agent can start from only when the repository has a remote and the folder is on a branch', async () => {
  const { dir, restore } = await registered()
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } })
  try {
    provideTestContext()
    const id = (await listProjects())[0]!.id
    const startFrom = async () => (await onCommands(id))?.startFrom
    git('init', '-q', '-b', 'main')
    git('commit', '-q', '--allow-empty', '-m', 'first')
    git('checkout', '-q', '-b', 'my/work')
    assert.equal(await startFrom(), undefined, 'no remote: one place to start from, nothing to pick')
    assert.equal((await onCommands(id))?.address, undefined, 'no remote: no address, so no git host to push to')

    git('remote', 'add', 'origin', 'https://example.com/x.git')
    git('update-ref', 'refs/remotes/origin/main', 'main')
    assert.deepEqual(await startFrom(), { main: 'main', local: 'my/work' })

    git('checkout', '-q', 'main')
    assert.deepEqual(await startFrom(), { main: 'main', local: 'main' }, 'on the default branch itself: the local one may hold commits that are not pushed')

    git('checkout', '-q', '--detach')
    assert.equal(await startFrom(), undefined, 'the folder is on no branch')

    git('checkout', '-q', 'main')
    assert.deepEqual(await onCommands(id), { gitHost: false, remote: true, address: 'example.com/x', startFrom: { main: 'main', local: 'main' } })
    assert.equal(await onCommands('no-such-project'), null)
  } finally {
    await restore()
  }
})


test('sendAddProject adds the path, trimmed, with the agents\u2019 records kept on this machine', async () => {
  const seen: [string, boolean][] = []
  provideTestContext({
    addProject: (path, share) => {
      seen.push([path, share])
      return { ok: true, alreadyActivated: false }
    },
  })
  await sendAddProject(' /repos/a ')
  assert.deepEqual(seen, [['/repos/a', false]])
  assert.deepEqual(await sendAddProject('  '), { ok: false, error: 'a project path is required' })
})

test('sendRemoveProject hands the project’s id to the daemon, with whether its files go too, and answers what it answers; no id is refused before the daemon is asked', async () => {
  const asked: string[] = []
  const cleanup = { removed: ['.openagent'], kept: [], failed: [] }
  provideTestContext({
    removeProject: (id, files) => {
      asked.push(files ? `${id} with files` : id)
      if (files) return { ok: true, cleanup }
      return id === 'busy-1' ? { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' } : { ok: true }
    },
  })
  assert.deepEqual(await sendRemoveProject('app-1', false), { ok: true })
  assert.deepEqual(await sendRemoveProject('app-2', true), { ok: true, cleanup })
  // Only a plain `true` deletes anything.
  assert.deepEqual(await sendRemoveProject('app-3', 'yes' as unknown as boolean), { ok: true })
  assert.deepEqual(await sendRemoveProject('busy-1', false), { ok: false, error: 'An agent is working in this project. Stop it, then remove the project.' })
  assert.deepEqual(await sendRemoveProject('', true), { ok: false, error: 'a project id is required' })
  assert.deepEqual(asked, ['app-1', 'app-2 with files', 'app-3', 'busy-1'])
})

test("the launcher's check is this computer's host's, for the agent picked, and a Start drawing near: the run's naming session is started for its project and agent", async () => {
  const { dir, restore } = await registered()
  try {
    const asked: unknown[] = []
    const host: RunHost = {
      ...fakeHost(),
      check: async request => {
        asked.push([request.project?.dir, request.options])
        if (request.options['agent-driver']?.driver === 'codex') throw new Error('the check broke')
        return { problems: ['Claude Code is not logged in.'], warnings: [], fix: { kind: 'log-in', command: 'claude login', problem: 'Claude Code is not logged in.' }, ownLoggedOut: true }
      },
    }
    provideTestContext({ host })
    const id = (await listProjects())[0]!.id
    assert.deepEqual(await onStartCheck(id), { problems: ['Claude Code is not logged in.'], warnings: [], fix: { kind: 'log-in', command: 'claude login', problem: 'Claude Code is not logged in.' } })
    assert.deepEqual(await onStartCheck(id, { 'agent-driver': { driver: 'codex' } }), { problems: [], warnings: ['the check broke'] }, 'a check that breaks is said, and stops nothing')
    assert.deepEqual(asked, [[dir, {}], [dir, { 'agent-driver': { driver: 'codex' } }]])
    provideTestContext({ host: fakeHost() })
    assert.equal(await onStartCheck(id), null, 'a host with no check says nothing')
  } finally {
    await restore()
  }
})

test('"Run on" offers the hosts beside this computer of the modules on in a project, and the launcher\'s check is the picked host\'s; a session with no project, or a project unknown here, has none (#2394)', async () => {
  const { dir, restore } = await registered()
  try {
    const asked: unknown[] = []
    const actions: RunHost = {
      ...fakeHost({ id: 'actions', label: 'GitHub Actions' }),
      check: async request => (asked.push([request.project?.dir, request.options]), { problems: ['Its repository has no workflow openagent-agent.yml yet.'], warnings: [] }),
    }
    const inProject: (string | undefined)[] = []
    provideTestContext({ host: fakeHost(), otherHosts: async project => (inProject.push(project?.dir), [actions]) })
    const id = (await listProjects())[0]!.id
    assert.deepEqual(await onRunHosts(id), [{ id: 'actions', label: 'GitHub Actions' }])
    assert.deepEqual(inProject, [dir])
    assert.deepEqual(await onStartCheck(id, { 'agent-driver': { driver: 'claude-code' } }, 'actions'), { problems: ['Its repository has no workflow openagent-agent.yml yet.'], warnings: [] })
    assert.deepEqual(asked, [[dir, { 'agent-driver': { driver: 'claude-code' } }]])
    assert.equal(await onStartCheck(id, { 'agent-driver': { driver: 'claude-code' } }, 'claude-web'), null, 'a host the project has not says nothing: the Start refuses it')
    assert.deepEqual(await onRunHosts(SESSIONS_ID), [])
    assert.deepEqual(await onRunHosts('nowhere-1'), [])
    assert.deepEqual(inProject, [dir, dir, dir], 'a session and an unknown project ask for none')
  } finally {
    await restore()
  }
})
