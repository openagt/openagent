import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeApp, rpcHost } from '@openagt/hooks/testing'
import { backupAttention } from './backup-attention.js'
import { data, share } from './server.js'

// Settings › Project › Project agent data's functions, on a real clone, with the person's folder
// under a temp $XDG_CONFIG_HOME and the project's remote a bare repository on this disk, which asks
// no account.

async function project(): Promise<{ dir: string; restore: () => Promise<void> }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-project-data-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
  const app = join(dir, 'app')
  await mkdir(app)
  return {
    dir: app,
    restore: async () => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test('the records switch: in your folder until turned on, and a remote that refuses turns it back off', async () => {
  const { dir, restore } = await project()
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } })
  const remote = await realpath(await mkdtemp(join(tmpdir(), 'openagent-records-remote-')))
  const branchesOn = (bare: string) => git(bare, 'for-each-ref', '--format=%(refname)', 'refs/heads').trim()
  const host = rpcHost({ root: dir, project: async () => ({ id: 'app', name: 'app', dir }) })
  const where = async () => {
    const read = await data(host, {})
    return `${read.place}${read.canShare ? '' : ', no remote'}`
  }
  try {
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 't@example.com')
    git(dir, 'config', 'user.name', 'T')
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
    assert.equal(await where(), 'personal, no remote')
    // Nothing to share with: refused, and the setting is not left on for a remote made later.
    assert.deepEqual(await share(host, { on: true }), { ok: false, error: 'this project has no remote to share with' })
    assert.equal(execFileSync('git', ['config', '--local', '--default', 'unset', '--get', 'agent-data.share'], { cwd: dir, encoding: 'utf8' }).trim(), 'unset')

    git(remote, 'init', '-q', '--bare')
    git(dir, 'remote', 'add', 'origin', remote)
    assert.equal(await where(), 'personal', 'a remote alone shares nothing')

    // Turned on: what is there goes out at once.
    assert.deepEqual(await share(host, { on: true }), { ok: true })
    assert.equal(await where(), 'repository')
    assert.equal(branchesOn(remote), 'refs/heads/agent-data')

    // Turned off: in your folder again.
    assert.deepEqual(await share(host, { on: false }), { ok: true })
    assert.equal(await where(), 'personal')

    // A remote that refuses the push: said in its words, and the switch is back to off.
    git(dir, 'remote', 'set-url', 'origin', join(remote, 'gone'))
    git(join(dir, '.branches', 'agent-data'), 'commit', '-q', '--allow-empty', '-m', 'kept here')
    const refused = await share(host, { on: true })
    assert.ok(!refused.ok && /could not be pushed/.test(refused.error))
    assert.equal(await where(), 'personal')
  } finally {
    await restore()
    await rm(remote, { recursive: true, force: true })
  }
})

test("a shared project at a git host with no account of OpenAgent's named needs the person, about this computer", async () => {
  const { dir, restore } = await project()
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const shop = { id: 'shop', name: 'shop', dir }
  const app = fakeApp({ projects: async () => [shop] })
  try {
    git('init', '-q', '-b', 'main')
    git('remote', 'add', 'origin', 'https://github.com/acme/shop.git')
    assert.deepEqual(await backupAttention({}, app), [], 'not shared: in the person\'s folder')
    git('config', 'agent-data.share', 'true')
    assert.deepEqual(await backupAttention({}, app), [
      { kind: 'setup', scope: 'computer', id: 'not-backed-up:shop', words: 'shop’s shared data is not backed up', detail: 'To github.com/acme/shop', fix: { label: 'Back up shop’s shared data…', settings: 'agent-data' } },
    ])
    assert.deepEqual(await backupAttention({ project: shop }, app), [], 'asked about the project, not said again')
  } finally {
    await restore()
  }
})
