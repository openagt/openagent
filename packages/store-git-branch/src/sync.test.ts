import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { writeSharing } from '@openagt/agent-data'
import type { AppContext, AttentionItem, ProjectRef } from '@openagt/hooks'
import { fakeApp, memorySettings } from '@openagt/hooks/testing'
import { NOT_SYNCING, dataSync, type PullData } from './sync.js'

const git = promisify(execFile)

/** The app as a module's life is told it: the projects the module is on in, asked again each time. */
function appWith(projects: () => ProjectRef[], signal = new AbortController().signal): AppContext {
  return { projects: async () => projects(), store: undefined as never, settings: memorySettings(), signal }
}

/** Wait until `done` says so, asking every few milliseconds. */
async function until(done: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const by = Date.now() + 10_000
  while (!(await done())) {
    if (Date.now() > by) throw new Error(`never: ${what}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5))
  }
}

const shop: ProjectRef = { id: 'shop-1', name: 'shop', dir: '/work/shop' }
const blog: ProjectRef = { id: 'blog-1', name: 'blog', dir: '/work/blog' }

test('a turn as the app starts, then one a minute: a project whose data does not converge needs the person until a turn goes through, since the first that failed', async () => {
  const said = new Map<string, { ok: true } | { ok: false; error: string }>([[shop.dir, { ok: false, error: 'origin refused the push' }], [blog.dir, { ok: true }]])
  const pulled: string[] = []
  const pull: PullData = async dir => (pulled.push(dir), said.get(dir) ?? { ok: true })
  let clock = Date.parse('2026-11-20T10:00:00Z')
  const logged: string[] = []
  const sync = dataSync({ pull, everyMs: 10, now: () => new Date(clock), log: line => logged.push(line) })
  const attention = async (project: ProjectRef): Promise<AttentionItem[]> => sync.attention({ project }, fakeApp())
  sync.lifecycle.started?.(appWith(() => [shop, blog]))
  try {
    await until(() => pulled.includes(shop.dir) && pulled.includes(blog.dir), 'the first turn pulls every project the module is on in')
    assert.deepEqual(await attention(shop), [{ kind: 'setup', scope: 'project', id: 'data-sync', words: NOT_SYNCING, detail: 'origin refused the push', since: '2026-11-20T10:00:00.000Z' }])
    assert.deepEqual(await attention(blog), [])
    // Still failing a while later: since the first turn that failed, said in the words of the last.
    clock += 60_000
    said.set(shop.dir, { ok: false, error: 'origin is out of reach' })
    await until(async () => (await attention(shop))[0]?.detail === 'origin is out of reach', 'the next turn says what went wrong then')
    assert.equal((await attention(shop))[0]?.since, '2026-11-20T10:00:00.000Z')
    said.set(shop.dir, { ok: true })
    await until(async () => (await attention(shop)).length === 0, 'a turn that goes through takes it back')
    assert.deepEqual(await sync.attention({}, fakeApp()), [], 'no project, nothing to say')
    assert.deepEqual(logged, ['[openagent] the data of shop is not syncing: origin refused the push', '[openagent] the data of shop is not syncing: origin is out of reach'], 'told once for each new way it fails')
  } finally {
    await sync.lifecycle.stopping?.()
  }
})

test('a project taken off the list is pulled no more, and one no longer shared says nothing; a stop waits for the turn under way and ends the timer', async () => {
  let shared = [shop, blog]
  const pulled: string[] = []
  let release: () => void = () => {}
  let holding = false
  const pull: PullData = async dir => {
    pulled.push(dir)
    if (holding) await new Promise<void>(resolvePromise => (release = resolvePromise))
    return { ok: false, error: 'no remote answers' }
  }
  const sync = dataSync({ pull, everyMs: 10, log: () => {} })
  sync.lifecycle.started?.(appWith(() => shared))
  await until(async () => (await sync.attention({ project: blog }, fakeApp())).length === 1, 'both fail at first')
  await sync.lifecycle.projectRemoved?.(shop, appWith(() => shared))
  assert.deepEqual(await sync.attention({ project: shop }, fakeApp()), [], 'a removed project says nothing')
  pulled.length = 0
  await until(() => pulled.length >= 2, 'two more pulls')
  assert.ok(!pulled.includes(shop.dir), 'a removed project is not pulled again')
  shared = [shop]
  await sync.lifecycle.projectAdded?.(shop, appWith(() => shared))
  await until(() => pulled.includes(shop.dir), 'added again, it is pulled again')
  await until(async () => (await sync.attention({ project: blog }, fakeApp())).length === 0, 'a project no longer shared says nothing')
  // A stop in the middle of a turn waits for it.
  holding = true
  pulled.length = 0
  await until(() => pulled.length === 1, 'a turn under way')
  let stopped = false
  const stopping = Promise.resolve(sync.lifecycle.stopping?.()).then(() => (stopped = true))
  await new Promise(resolvePromise => setTimeout(resolvePromise, 30))
  assert.equal(stopped, false, 'the stop waits for the turn under way')
  holding = false
  release()
  await stopping
  pulled.length = 0
  await new Promise(resolvePromise => setTimeout(resolvePromise, 40))
  assert.deepEqual(pulled, [], 'no turn after the stop')
})

test('the real pull: a shared project converges with its remote, needs the person while the remote is out of reach, and converges again once it is back (#1599)', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'store-git-branch-sync-')))
  const project = join(base, 'project')
  const remote = join(base, 'remote.git')
  const onRemote = async (): Promise<string> => (await git('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: remote })).stdout
  try {
    await git('git', ['init', '-q', '-b', 'main', project])
    for (const [key, value] of [['user.email', 'test@example.com'], ['user.name', 'Test'], ['commit.gpgsign', 'false']]) await git('git', ['config', key!, value!], { cwd: project })
    await git('git', ['init', '-q', '--bare', remote])
    await git('git', ['remote', 'add', 'origin', remote], { cwd: project })
    await writeSharing(project, true)
    const ref: ProjectRef = { id: 'project-1', name: 'project', dir: project }
    // One turn as it starts, and none after it for a minute: each start below is one turn, and the
    // checkout is changed only between them.
    const sync = dataSync({ log: () => {} })
    const turn = async (done: () => Promise<boolean>, what: string): Promise<void> => {
      sync.lifecycle.started?.(appWith(() => [ref]))
      try {
        await until(done, what)
      } finally {
        await sync.lifecycle.stopping?.()
      }
    }
    await turn(async () => /refs\/heads\/agent-data/.test(await onRemote()), 'the first turn sends the data branch to the remote')
    assert.deepEqual(await sync.attention({ project: ref }, fakeApp()), [])
    await git('git', ['remote', 'set-url', 'origin', join(base, 'gone.git')], { cwd: project })
    await git('git', ['commit', '-q', '--allow-empty', '-m', 'made here'], { cwd: join(project, '.branches', 'agent-data') })
    await turn(async () => (await sync.attention({ project: ref }, fakeApp())).length === 1, 'a remote out of reach needs the person')
    assert.equal((await sync.attention({ project: ref }, fakeApp()))[0]?.words, NOT_SYNCING)
    await git('git', ['remote', 'set-url', 'origin', remote], { cwd: project })
    await turn(async () => (await sync.attention({ project: ref }, fakeApp())).length === 0, 'once it is back, a turn converges')
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 10 })
  }
})
