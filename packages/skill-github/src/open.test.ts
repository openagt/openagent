import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import type { GhRunner } from './gh.js'
import { openRequest, requestNumber } from './open.js'
import { mergeRequest } from './merge.js'

// Opening and landing a request, with gh scripted: the assertion is about what is asked of GitHub
// and what the answer becomes. Real git only for the current branch.

const git = nodeGitRunner()

async function repo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'github-open-')))
  await git(['init', '-q', '-b', 'agent-fix'], dir)
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await writeFile(join(dir, 'a.txt'), 'a\n')
  await git(['add', '-A'], dir)
  await git(['commit', '-q', '-m', 'init'], dir)
  return dir
}

/** A gh that records every call: no request open at first, then the one it "created". */
function fakeGh(over: { merge?: (args: string[]) => Promise<string> } = {}): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = []
  let opened: { number: number; url: string } | undefined
  const gh: GhRunner = async args => {
    calls.push(args)
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(opened && args[args.indexOf('--head') + 1] === 'agent-fix' ? [{ number: opened.number, url: opened.url, state: 'OPEN', headRefName: 'agent-fix' }] : [])
    if (args[0] === 'pr' && args[1] === 'create') {
      opened = { number: 42, url: 'https://github.com/o/r/pull/42' }
      return `Creating pull request…\n${opened.url}\n`
    }
    if (args[0] === 'pr' && args[1] === 'merge') return over.merge ? over.merge(args) : ''
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
  return { gh, calls }
}

test('open: the request is opened with the given words on the current branch, and armed on request; a second open answers the open one', async () => {
  const dir = await repo()
  try {
    const { gh, calls } = fakeGh()
    const first = await openRequest(dir, { title: 'Fix it', body: 'Fixed.', merge: true, gh })
    assert.deepEqual(first, { ok: true, branch: 'agent-fix', request: { number: 42, url: 'https://github.com/o/r/pull/42' }, existing: false, merge: { outcome: 'auto-armed' } })
    assert.deepEqual(calls[0]!.slice(0, 6), ['pr', 'list', '--state', 'open', '--head', 'agent-fix'])
    assert.deepEqual(calls[1], ['pr', 'create', '--head', 'agent-fix', '--title', 'Fix it', '--body', 'Fixed.'])
    assert.deepEqual(calls[2], ['pr', 'merge', '42', '--squash', '--auto'])

    const again = await openRequest(dir, { title: 'ignored', gh })
    assert.deepEqual(again, { ok: true, branch: 'agent-fix', request: { number: 42, url: 'https://github.com/o/r/pull/42' }, existing: true })
    assert.equal(calls.filter(c => c[1] === 'create').length, 1, 'no second request')

    const named = await openRequest(dir, { branch: 'other', title: 'Other', gh })
    assert.equal(named.ok && named.branch, 'other')
    assert.deepEqual(calls.at(-1)!.slice(0, 8), ['pr', 'create', '--head', 'other', '--title', 'Other', '--body', ''])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a branch pushed to a fork, origin's push address, is opened from that fork", async () => {
  const dir = await repo()
  try {
    await git(['remote', 'add', 'origin', 'https://github.com/brillout/gemskills.git'], dir)
    await git(['remote', 'set-url', '--push', 'origin', 'https://github.com/brillout-agent/gemskills.git'], dir)
    const { gh, calls } = fakeGh()
    assert.equal((await openRequest(dir, { title: 'Fix it', gh })).ok, true)
    assert.deepEqual(calls.find(c => c[1] === 'create')!.slice(0, 4), ['pr', 'create', '--head', 'brillout-agent:agent-fix'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a draft is a draft unless the merge is armed; a detached working directory with no --branch is no-branch; a create gh refuses is open-failed with its line', async () => {
  const dir = await repo()
  try {
    const { gh, calls } = fakeGh()
    assert.equal((await openRequest(dir, { title: 'D', draft: true, gh })).ok, true)
    assert.ok(calls.find(c => c[1] === 'create')!.includes('--draft'))
    const { gh: gh2, calls: calls2 } = fakeGh()
    assert.equal((await openRequest(dir, { title: 'D', draft: true, merge: true, gh: gh2 })).ok, true)
    assert.ok(!calls2.find(c => c[1] === 'create')!.includes('--draft'))

    await git(['checkout', '-q', '--detach'], dir)
    assert.deepEqual(await openRequest(dir, { title: 'x', gh }), { ok: false, reason: 'no-branch' })

    const refusing: GhRunner = async args => {
      if (args[1] === 'list') return '[]'
      throw new Error('GraphQL: No commits between main and agent-fix')
    }
    assert.deepEqual(await openRequest(dir, { branch: 'agent-fix', title: 'x', gh: refusing }), { ok: false, reason: 'open-failed', branch: 'agent-fix', detail: 'GraphQL: No commits between main and agent-fix' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('where GitHub will not arm auto-merge: an already green request is merged at once, a repository without auto-merge gets the watcher, any other refusal is merge-failed beside the open request', async () => {
  const dir = await repo()
  try {
    const green = fakeGh({ merge: async args => (args.includes('--auto') ? Promise.reject(new Error('Pull request is in clean status')) : '') })
    const merged = await openRequest(dir, { title: 'x', merge: true, gh: green.gh })
    assert.deepEqual(merged.ok && merged.merge, { outcome: 'merged' })
    assert.deepEqual(green.calls.filter(c => c[1] === 'merge'), [['pr', 'merge', '42', '--squash', '--auto'], ['pr', 'merge', '42', '--squash']])

    const watched: string[] = []
    const off = fakeGh({ merge: async () => Promise.reject(new Error('Pull request auto-merge is not allowed for this repository')) })
    const watching = await openRequest(dir, { title: 'x', merge: true, gh: off.gh, watch: async (r, n) => void watched.push(`${r}#${n}`) })
    assert.deepEqual(watching.ok && watching.merge, { outcome: 'watching' })
    assert.deepEqual(watched, [`${dir}#42`])

    const other = fakeGh({ merge: async () => Promise.reject(new Error('Pull request is not mergeable')) })
    assert.deepEqual(await openRequest(dir, { title: 'x', merge: true, gh: other.gh }), { ok: false, reason: 'merge-failed', branch: 'agent-fix', request: { number: 42, url: 'https://github.com/o/r/pull/42' }, detail: 'Pull request is not mergeable' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('merge: a draft is marked ready, then the merge is armed as --merge arms it; a request not open is said; a view that fails is a failure', async () => {
  const calls: string[][] = []
  const gh = (view: unknown): GhRunner => async args => {
    calls.push(args)
    if (args[1] === 'view') return JSON.stringify(view)
    return ''
  }
  assert.deepEqual(await mergeRequest('/r', 5, { gh: gh({ state: 'OPEN', isDraft: true }) }), { outcome: 'auto-armed' })
  assert.deepEqual(calls, [['pr', 'view', '5', '--json', 'state,isDraft'], ['pr', 'ready', '5'], ['pr', 'merge', '5', '--squash', '--auto']])
  calls.length = 0
  assert.deepEqual(await mergeRequest('/r', 5, { gh: gh({ state: 'OPEN', isDraft: false }) }), { outcome: 'auto-armed' })
  assert.deepEqual(calls.map(c => c[1]), ['view', 'merge'])
  assert.deepEqual(await mergeRequest('/r', 5, { gh: gh({ state: 'MERGED' }) }), { outcome: 'not-open', state: 'MERGED' })
  const failing: GhRunner = async () => {
    throw new Error('gh: not logged in')
  }
  assert.deepEqual(await mergeRequest('/r', 5, { gh: failing }), { outcome: 'failed', error: 'gh: not logged in' })
  assert.equal(requestNumber('https://github.com/o/r/pull/42'), 42)
  assert.equal(requestNumber('https://github.com/o/r/pulls'), undefined)
})
