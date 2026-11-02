import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { checkProviders, syncProjectData } from './daemon-services.js'
import { projectErrorStore } from './project-errors.js'
import { writeSharing } from '@openagt/agent-data'

const git = promisify(execFile)

/**
 * The data-sync error state (#1599/#1500): one project's sync turn sets the project's `data-sync`
 * error when the branch cannot converge with origin, and clears it the first time it does. Real
 * git, because the two outcomes are git's own: no remote at all, then a bare remote added.
 */
test('a project whose data branch cannot reach a remote carries a data-sync error until a sync converges (#1599)', async () => {
  const project = await mkdtemp(join(tmpdir(), 'openagent-sync-proj-'))
  const remote = await mkdtemp(join(tmpdir(), 'openagent-sync-remote-'))
  try {
    await git('git', ['init', '-q', '-b', 'main'], { cwd: project })
    await git('git', ['config', 'user.email', 'test@example.com'], { cwd: project })
    await git('git', ['config', 'user.name', 'Test'], { cwd: project })
    await git('git', ['config', 'commit.gpgsign', 'false'], { cwd: project })
    const errors = projectErrorStore()
    const logs: string[] = []

    // No remote: the branch is born locally and the project is local only — a note, not an error.
    await syncProjectData(project, errors, m => logs.push(m))
    assert.deepEqual(errors.read(project), { errors: [], local: 'no-remote' })
    assert.ok(!logs.some(m => m.includes('data sync')), 'nothing failed, so the daemon log names no failed sync')

    // The user adds a remote: the records are still kept here, and the remote holds nothing of them.
    await git('git', ['init', '-q', '--bare'], { cwd: remote })
    await git('git', ['remote', 'add', 'origin', remote], { cwd: project })
    await syncProjectData(project, errors, m => logs.push(m))
    assert.deepEqual(errors.read(project), { errors: [], local: 'kept' })
    assert.equal((await git('git', ['for-each-ref', 'refs/heads'], { cwd: remote })).stdout.trim(), '')
    assert.equal(logs.length, 0, 'a project that keeps its records says nothing in the daemon log')

    // The person shares them: the next turn converges and the note is gone.
    await writeSharing(project, true)
    await syncProjectData(project, errors, () => {})
    assert.deepEqual(errors.read(project), { errors: [] })
    assert.match((await git('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: remote })).stdout, /refs\/heads\/agent-data/)

    // A remote that cannot be reached is the error it always was.
    await git('git', ['remote', 'set-url', 'origin', join(remote, 'gone')], { cwd: project })
    await git('git', ['commit', '-q', '--allow-empty', '-m', 'local'], { cwd: join(project, '.branches', 'agent-data') })
    await syncProjectData(project, errors, m => logs.push(m))
    assert.equal(errors.read(project).errors[0]?.code, 'data-sync')
    assert.equal('local' in errors.read(project), false)

    // Kept again, then shared while the remote is still out of reach: the failed turn also says
    // the records are no longer kept, so the note of the turn before does not outlive it.
    await writeSharing(project, false)
    await syncProjectData(project, errors, () => {})
    assert.deepEqual(errors.read(project), { errors: [], local: 'kept' })
    await writeSharing(project, true)
    await syncProjectData(project, errors, () => {})
    assert.equal(errors.read(project).errors[0]?.code, 'data-sync')
    assert.equal('local' in errors.read(project), false)
  } finally {
    await rm(project, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

/**
 * The provider error (#1820): two packages declaring the same kind with no line in the project's
 * package.json is a state the user must fix, shown as the project's `provider` error; the line
 * clears it at the next turn.
 */
test('a project where two packages provide the same kind carries a provider error until its package.json names one (#1820)', async () => {
  const project = await mkdtemp(join(tmpdir(), 'openagent-providers-'))
  try {
    const manifest = (named?: Record<string, string>) => JSON.stringify({ devDependencies: { a: '*', b: '*' }, ...(named ? { openagent: named } : {}) })
    await writeFile(join(project, 'package.json'), manifest())
    for (const name of ['a', 'b']) {
      await mkdir(join(project, 'node_modules', name), { recursive: true })
      await writeFile(join(project, 'node_modules', name, 'package.json'), JSON.stringify({ name, bin: { [name]: 'cmd.cjs' }, openagent: { tickets: name } }))
      await writeFile(join(project, 'node_modules', name, 'cmd.cjs'), '')
    }
    const errors = projectErrorStore()
    await checkProviders(project, errors)
    const [unsettled] = errors.list(project)
    assert.equal(unsettled?.code, 'provider')
    assert.equal(unsettled?.message, '2 packages provide tickets: a, b; name one under "openagent" in package.json')

    await writeFile(join(project, 'package.json'), manifest({ tickets: 'b' }))
    await checkProviders(project, errors)
    assert.deepEqual(errors.list(project), [])
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
