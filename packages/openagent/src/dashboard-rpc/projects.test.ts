import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addProject, listProjects } from '../registry.js'
import { PROJECT_HOOKS_FILE } from '../project-hooks.js'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { projectErrorStore } from '../project-errors.js'
import { provideTestContext } from './test-context.js'
import { onCommands, onProjects, onRecordsReach, sendAddProject, sendRemoveProject, sendShareRecords } from './projects.js'

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

test('onProjects carries each project’s recorded errors, and nothing when there are none (#1500)', async () => {
  const { dir, restore } = await registered()
  try {
    const errors = projectErrorStore(() => new Date('2026-08-20T10:00:00.000Z'))
    provideTestContext({ projectErrors: errors.read })

    const clean = await onProjects()
    assert.equal(clean.length, 1)
    assert.equal('errors' in clean[0]!, false, 'a healthy project has no errors field at all')

    errors.set(dir, 'data-sync', 'the data branch could not be pushed: permission denied')
    const [stranded] = await onProjects()
    assert.deepEqual(stranded?.errors, [
      { code: 'data-sync', message: 'the data branch could not be pushed: permission denied', since: '2026-08-20T10:00:00.000Z' },
    ])

    assert.equal('local' in stranded!, false, 'a project whose data reaches its remote carries no note')
    errors.setReach(dir, 'no-remote')
    assert.equal((await onProjects())[0]?.local, 'no-remote')
    errors.setReach(dir, 'kept')
    assert.equal((await onProjects())[0]?.local, 'kept')
    errors.setReach(dir, 'origin')
    assert.equal('local' in (await onProjects())[0]!, false)
  } finally {
    await restore()
  }
})

// The launcher's "start from" chip is offered only where the pick would be obeyed: a real
// repository, its start line and its branches changed one step at a time.
test('onCommands names the two branches an agent can start from only when the start line passes BASE on, the repository has a remote and the folder is on a branch', async () => {
  const { dir, restore } = await registered()
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } })
  const hooks = (line: string) => writeFile(join(dir, PROJECT_HOOKS_FILE), `start: ${line}\n`)
  const TAKES = `agent-runner run --detach "$PROMPT" \${BASE:+--base "$BASE"}`
  try {
    provideTestContext()
    const id = (await listProjects())[0]!.id
    const startFrom = async () => (await onCommands(id))?.startFrom
    await mkdir(join(dir, OPENAGENT_DIR), { recursive: true })
    git('init', '-q', '-b', 'main')
    git('commit', '-q', '--allow-empty', '-m', 'first')
    git('checkout', '-q', '-b', 'my/work')
    await hooks(TAKES)
    assert.equal(await startFrom(), undefined, 'no remote: one place to start from, nothing to pick')
    assert.equal((await onCommands(id))?.address, undefined, 'no remote: no name another machine knows the project by')

    git('remote', 'add', 'origin', 'https://example.com/x.git')
    git('update-ref', 'refs/remotes/origin/main', 'main')
    assert.deepEqual(await startFrom(), { main: 'main', local: 'my/work' })

    git('checkout', '-q', 'main')
    assert.deepEqual(await startFrom(), { main: 'main', local: 'main' }, 'on the default branch itself: the local one may hold commits that are not pushed')

    await hooks('agent-runner run --detach "$PROMPT" ${PUBLISH:+--publish "$PUBLISH"}')
    assert.equal(await startFrom(), undefined, 'a line that does not pass BASE on: a pick would do nothing')
    await hooks('./start.sh "$PROMPT" "$BASE"')
    assert.deepEqual(await startFrom(), { main: 'main', local: 'main' }, 'a person\'s own line that names $BASE takes the pick')
    await hooks('./start.sh "$PROMPT" "$BASELINE"')
    assert.equal(await startFrom(), undefined, 'another variable whose name begins the same is not BASE')

    await hooks(TAKES)
    git('checkout', '-q', '--detach')
    assert.equal(await startFrom(), undefined, 'the folder is on no branch')

    await rm(join(dir, PROJECT_HOOKS_FILE))
    git('checkout', '-q', 'main')
    assert.deepEqual(await onCommands(id), { commands: [], startHook: false, gitHost: false, remote: true, address: 'example.com/x' })
    assert.equal(await onCommands('no-such-project'), null)
  } finally {
    await restore()
  }
})

test('the records switch: kept on this machine until turned on, and a remote that refuses turns it back off', async () => {
  const { dir, restore } = await registered()
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } })
  const remote = await realpath(await mkdtemp(join(tmpdir(), 'openagent-records-remote-')))
  const branchesOn = (bare: string) => git(bare, 'for-each-ref', '--format=%(refname)', 'refs/heads').trim()
  try {
    provideTestContext()
    const id = (await listProjects())[0]!.id
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 't@example.com')
    git(dir, 'config', 'user.name', 'T')
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
    assert.equal(await onRecordsReach(id), 'no-remote')
    assert.equal(await onRecordsReach('no-such-project'), null)
    // Nothing to share with: refused, and the setting is not left on for a remote made later.
    assert.deepEqual(await sendShareRecords(id, true), { ok: false, error: 'this project has no remote to share with' })
    assert.equal(execFileSync('git', ['config', '--local', '--default', 'unset', '--get', 'agent-data.share'], { cwd: dir, encoding: 'utf8' }).trim(), 'unset')

    git(remote, 'init', '-q', '--bare')
    git(dir, 'remote', 'add', 'origin', remote)
    assert.equal(await onRecordsReach(id), 'kept', 'a remote alone shares nothing')

    // Turned on: what is there goes out at once.
    assert.deepEqual(await sendShareRecords(id, true), { ok: true })
    assert.equal(await onRecordsReach(id), 'origin')
    assert.equal(branchesOn(remote), 'refs/heads/agent-data')

    // Turned off: kept again.
    assert.deepEqual(await sendShareRecords(id, false), { ok: true })
    assert.equal(await onRecordsReach(id), 'kept')

    // A remote that refuses the push: said in its words, and the switch is back to off.
    git(dir, 'remote', 'set-url', 'origin', join(remote, 'gone'))
    git(join(dir, '.branches', 'agent-data'), 'commit', '-q', '--allow-empty', '-m', 'kept here')
    const refused = await sendShareRecords(id, true)
    assert.ok(!refused.ok && /could not be pushed/.test(refused.error))
    assert.equal(await onRecordsReach(id), 'kept')

    assert.deepEqual(await sendShareRecords('no-such-project', true), { ok: false, error: 'this project has no local path on this server' })
  } finally {
    await restore()
    await rm(remote, { recursive: true, force: true })
  }
})

test('sendAddProject hands the person\u2019s answer on the records to the daemon, as a yes only when it is one', async () => {
  const seen: [string, boolean][] = []
  provideTestContext({
    addProject: (path, share) => {
      seen.push([path, share])
      return { ok: true, alreadyActivated: false }
    },
  })
  await sendAddProject(' /repos/a ', true)
  await sendAddProject('/repos/b', false)
  await sendAddProject('/repos/c', 'yes' as unknown as boolean)
  assert.deepEqual(seen, [['/repos/a', true], ['/repos/b', false], ['/repos/c', false]])
  assert.deepEqual(await sendAddProject('  ', true), { ok: false, error: 'a project path is required' })
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
